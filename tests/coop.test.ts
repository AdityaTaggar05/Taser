import { describe, it, expect } from 'vitest';
import { CoopRoom, type Peer } from '../server/CoopRoom';
import { levels } from '../server/data/campaign';
import { RemoteView } from '../src/network/RemoteView';
import {
  parseCommand,
  type ClientCommand,
  type ServerMessage,
  type SessionState,
} from '../src/network/protocol';
class TestPeer implements Peer {
  readonly accountId = crypto.randomUUID();
  messages: ServerMessage[] = [];
  closed = false;

  send(m: ServerMessage) {
    this.messages.push(structuredClone(m));
  }

  close() {
    this.closed = true;
  }

  get state() {
    return this.messages.filter((m): m is SessionState => m.type === 'state').at(-1)!;
  }

  get token() {
    return this.messages.find((m) => m.type === 'welcome')! as { type: 'welcome'; token: string };
  }
}
function setup() {
  let next = 0,
    now = 1000;
  const room = new CoopRoom(
    () => `token-${++next}`,
    () => now,
    100,
  );
  const a = new TestPeer(),
    b = new TestPeer();
  room.join(a, a.accountId);
  room.join(b, b.accountId);
  return {
    room,
    a,
    b,
    time: (n: number) => {
      now = n;
    },
  };
}
function send(
  room: CoopRoom,
  p: TestPeer,
  command: Omit<ClientCommand, 'revision'> & { direction?: string; index?: number },
) {
  room.receive(p, { ...command, revision: p.state.revision });
}
const frame = (p: TestPeer) => p.state.history.at(-1)!;
it('assigns two roles automatically, refuses a third, and keeps an active seat from being stolen', () => {
  const { room, a, b } = setup(),
    third = new TestPeer(),
    duplicate = new TestPeer();
  expect(a.state.player).toBe(1);
  expect(b.state.player).toBe(2);
  expect(a.state.partnerConnected).toBe(true);
  expect(room.join(third, third.accountId)).toBeNull();
  expect(third.closed).toBe(true);
  expect(third.messages.at(-1)?.type).toBe('full');
  expect(room.join(duplicate, a.accountId, a.token.token)).toBeNull();
  expect(duplicate.closed).toBe(true);
});
it('waits for a partner and does not queue inputs alone', () => {
  const room = new CoopRoom(() => 'only-player'),
    a = new TestPeer();
  room.join(a, a.accountId);
  send(room, a, { type: 'move', direction: 'U' });
  expect(frame(a).step).toBe(0);
  expect(a.state.pendingMove).toBeNull();
  expect(a.messages.at(-1)?.type).toBe('error');
});
it('keeps partner input queued when the other player bumps a wall', () => {
  const { room, a, b } = setup();
  send(room, b, { type: 'move', direction: 'D' });
  send(room, a, { type: 'move', direction: 'R' });
  expect(b.state.pendingMove).toBe('D');
  expect(a.state.partnerReady).toBe(true);
  expect(frame(a).step).toBe(0);
  send(room, a, { type: 'move', direction: 'U' });
  expect(frame(a).position).toEqual([1, 2]);
  expect(frame(b).position).toEqual([7, 2]);
  expect(frame(a).step).toBe(1);
});
it('allows move replacement and explicit cancellation without consuming turns', () => {
  const { room, a, b } = setup();
  send(room, a, { type: 'move', direction: 'U' });
  send(room, a, { type: 'move', direction: 'W' });
  expect(a.state.pendingMove).toBe('W');
  expect(b.state.partnerReady).toBe(true);
  send(room, a, { type: 'cancel' });
  expect(a.state.pendingMove).toBeNull();
  expect(b.state.partnerReady).toBe(false);
  send(room, a, { type: 'move', direction: 'W' });
  send(room, b, { type: 'move', direction: 'D' });
  expect(frame(a).position).toEqual([1, 1]);
  expect(frame(a).step).toBe(1);
});
it('rejects delayed commands from a previous turn or reset', () => {
  const { room, a, b } = setup(),
    old = a.state.revision;
  send(room, a, { type: 'move', direction: 'U' });
  send(room, b, { type: 'move', direction: 'D' });
  room.receive(a, { type: 'move', direction: 'R', revision: old });
  expect(a.state.pendingMove).toBeNull();
  expect(frame(a).step).toBe(1);
  send(room, b, { type: 'reset' });
  room.receive(a, { type: 'move', direction: 'U', revision: old });
  expect(frame(a).step).toBe(0);
  expect(a.state.pendingMove).toBeNull();
});
it('synchronizes undo, reset, and chamber changes and clears both pending inputs', () => {
  const { room, a, b } = setup();
  send(room, a, { type: 'move', direction: 'U' });
  send(room, b, { type: 'move', direction: 'D' });
  send(room, a, { type: 'move', direction: 'R' });
  send(room, b, { type: 'undo' });
  expect(frame(a).step).toBe(0);
  expect(frame(b).step).toBe(0);
  expect(a.state.pendingMove).toBeNull();
  send(room, b, { type: 'level', index: 4 });
  expect(a.state.levelIndex).toBe(4);
  expect(b.state.levelIndex).toBe(4);
  send(room, a, { type: 'move', direction: 'U' });
  send(room, b, { type: 'reset' });
  expect(a.state.pendingMove).toBeNull();
  expect(frame(a).step).toBe(0);
  send(room, a, { type: 'level', index: 99 });
  expect(a.state.levelIndex).toBe(4);
});
it('pauses on disconnect, clears queued moves, and restores the same seat and timeline', () => {
  const { room, a, b } = setup();
  send(room, a, { type: 'move', direction: 'U' });
  send(room, b, { type: 'move', direction: 'D' });
  send(room, a, { type: 'move', direction: 'R' });
  room.leave(b);
  expect(a.state.partnerConnected).toBe(false);
  expect(a.state.pendingMove).toBeNull();
  send(room, a, { type: 'move', direction: 'R' });
  expect(frame(a).step).toBe(1);
  const resume = new TestPeer();
  expect(room.join(resume, b.accountId, b.token.token)).toBe(2);
  expect(frame(resume).step).toBe(1);
  expect(a.state.partnerConnected).toBe(true);
});
it('resets an abandoned timeline before a replacement player joins', () => {
  const { room, a, b, time } = setup();
  send(room, a, { type: 'move', direction: 'U' });
  send(room, b, { type: 'move', direction: 'D' });
  room.leave(b);
  time(1101);
  room.expire();
  expect(frame(a).step).toBe(0);
  const replacement = new TestPeer();
  expect(room.join(replacement, replacement.accountId)).toBe(2);
  expect(frame(replacement).step).toBe(0);
  expect(a.state.partnerConnected).toBe(true);
});
it('uses the socket-assigned role, never a player number supplied in a command', () => {
  const { room, a, b } = setup();
  room.receive(a, { type: 'move', direction: 'U', revision: a.state.revision, player: 2 });
  expect(a.state.pendingMove).toBe('U');
  expect(b.state.pendingMove).toBeNull();
  expect(frame(b).step).toBe(0);
});
it('sends only own history, own queued move and partner readiness', () => {
  const { room, a, b } = setup();
  send(room, b, { type: 'move', direction: 'D' });
  expect(a.state.pendingMove).toBeNull();
  expect(a.state.partnerReady).toBe(true);
  expect(frame(a).boxes).toEqual([[2, 2]]);
  expect(frame(b).boxes).toEqual([[6, 2]]);
  expect(Object.keys(frame(a)).sort()).toEqual(['boxes', 'message', 'position', 'status', 'step']);
  expect(a.state).not.toHaveProperty('token');
  expect(a.state).not.toHaveProperty('partnerMove');
  expect(a.state).not.toHaveProperty('boxesP2');
});
it('rejects malformed protocol messages without changing the timeline', () => {
  const { room, a } = setup();
  for (const bad of [
    null,
    {},
    'move',
    { type: 'move', direction: 'toString', revision: 0 },
    { type: 'reset', revision: -1 },
    { type: 'move', direction: 'U', revision: 0.1 },
  ]) {
    expect(parseCommand(bad)).toBeNull();
    room.receive(a, bad);
  }
  expect(frame(a).step).toBe(0);
});
describe('server-authoritative level playthroughs', () => {
  for (let index = 0; index < levels.length; index++)
    it(`both clients win chamber ${index + 1}`, () => {
      const { room, a, b } = setup();
      send(room, a, { type: 'level', index });
      const l = levels[index];
      for (let k = 0; k < l.solutionP1.length; k++) {
        if (frame(a).status === 'VICTORY') break;
        send(room, a, { type: 'move', direction: l.solutionP1[k] });
        expect(frame(a).step).toBe(k);
        send(room, b, { type: 'move', direction: l.solutionP2[k] });
        expect(frame(a).step).toBe(k + 1);
        expect(frame(b).step).toBe(k + 1);
        expect(a.state.revision).toBe(b.state.revision);
        expect(a.state.pendingMove).toBeNull();
        expect(b.state.pendingMove).toBeNull();
      }
      expect(frame(a).status).toBe('VICTORY');
      expect(frame(b).status).toBe('VICTORY');
      expect(frame(a).position).toEqual(l.exitP1);
      expect(frame(b).position).toEqual(l.exitP2);
    });
});

it('renders replay previews from own server projections without requiring partner history', () => {
  const { room, a, b } = setup();
  for (let k = 0; k < 4; k++) {
    send(room, a, { type: 'move', direction: levels[0].solutionP1[k] });
    send(room, b, { type: 'move', direction: levels[0].solutionP2[k] });
  }
  const forward = new RemoteView(levels[0], a.state),
    reverse = new RemoteView(levels[0], b.state);
  expect(forward.state.boxesP2).toEqual([]);
  expect(reverse.state.boxesP1).toEqual([]);
  expect(forward.nextBoxes(1)).toEqual([[5, 2]]);
  expect(reverse.nextBoxes(2)).toEqual([[3, 2]]);
  expect(forward.nextBoxes(2)).toBeNull();
  expect(reverse.nextBoxes(1)).toBeNull();
  expect(new RemoteView(levels[0], a.state, 2).nextBoxes(1)).toBeNull();
});

it('releases a slot immediately on a deliberate home exit and clears the shared timeline', () => {
  const { room, a, b } = setup();
  send(room, a, { type: 'move', direction: 'U' });
  send(room, b, { type: 'move', direction: 'D' });
  send(room, b, { type: 'move', direction: 'L' });
  room.release(a);
  expect(b.state.partnerConnected).toBe(false);
  expect(b.state.pendingMove).toBeNull();
  expect(frame(b).step).toBe(0);
  const replacement = new TestPeer();
  expect(room.join(replacement, replacement.accountId)).toBe(1);
  expect(b.state.partnerConnected).toBe(true);
  expect(frame(replacement).step).toBe(0);
  // A late close from the old socket cannot disconnect the replacement.
  room.leave(a);
  expect(replacement.state.partnerConnected).toBe(true);
});
it('lets a solo player leave for home without reserving their seat', () => {
  let id = 0;
  const room = new CoopRoom(() => `guest-${++id}`),
    first = new TestPeer();
  room.join(first, first.accountId);
  room.release(first);
  expect(room.join(new TestPeer(), crypto.randomUUID())).toBe(1);
  expect(room.join(new TestPeer(), crypto.randomUUID())).toBe(2);
});
it('binds reservations to accounts and never assigns both roles to the same account', () => {
  const { room, a, b } = setup();
  room.release(b);
  const duplicate = new TestPeer();
  expect(room.join(duplicate, a.accountId)).toBeNull();
  expect(duplicate.closed).toBe(true);
  room.leave(a);
  const intruder = new TestPeer();
  expect(room.join(intruder, intruder.accountId, a.token.token)).toBeNull();
  const resumed = new TestPeer();
  expect(room.join(resumed, a.accountId)).toBe(1);
});
it('awards completion to both authenticated identities only after a winning simulation', () => {
  const awards: Array<{ ids: string[]; level: number }> = [],
    room = new CoopRoom(
      () => crypto.randomUUID(),
      Date.now,
      100,
      (ids, level) => awards.push({ ids, level }),
    ),
    a = new TestPeer(),
    b = new TestPeer();
  room.join(a, a.accountId);
  room.join(b, b.accountId);
  expect(awards).toEqual([]);
  for (let k = 0; k < 8; k++) {
    send(room, a, { type: 'move', direction: levels[0].solutionP1[k] });
    send(room, b, { type: 'move', direction: levels[0].solutionP2[k] });
  }
  expect(awards).toEqual([{ ids: [a.accountId, b.accountId], level: 1 }]);
});
it('plays a verified custom snapshot, hides all author-only data and does not award campaign progress', () => {
  const custom = structuredClone(levels[0]);
  custom.name = 'My published chamber';
  let awards = 0;
  const room = new CoopRoom(
      () => crypto.randomUUID(),
      Date.now,
      100,
      () => awards++,
      (id) => (id === 'custom-id' ? { level: custom, revision: 7 } : null),
    ),
    a = new TestPeer(),
    b = new TestPeer();
  expect(room.join(a, a.accountId, undefined, 'custom-id')).toBe(1);
  expect(room.join(b, b.accountId, undefined, 'custom-id')).toBe(2);
  expect(a.state.customLevelId).toBe('custom-id');
  expect(a.state.customRevision).toBe(7);
  expect(a.state.levelIndex).toBe(-1);
  expect(a.state.level?.initialBoxesP2).toEqual([]);
  expect(a.state.level?.switchesP2).toEqual([]);
  expect(a.state.level?.exitP2).toEqual([0, 0]);
  expect(a.state.level?.weldTargets).toEqual([]);
  expect(a.state.level?.solutionP2).toEqual([]);
  expect(b.state.level?.initialBoxesP1).toEqual([]);
  expect(b.state.level?.switchesP1).toEqual([]);
  expect(b.state.level?.weldTargets).toEqual([]);
  // A later publication must not mutate this running puzzle.
  custom.name = 'Changed after join';
  for (let k = 0; k < 8; k++) {
    send(room, a, { type: 'move', direction: levels[0].solutionP1[k] });
    send(room, b, { type: 'move', direction: levels[0].solutionP2[k] });
  }
  expect(frame(a).status).toBe('VICTORY');
  expect(a.state.level?.name).toBe('My published chamber');
  expect(awards).toBe(0);
  send(room, a, { type: 'level', index: 1 });
  expect(a.state.customLevelId).toBeUndefined();
  expect(a.state.levelIndex).toBe(1);
});
it('rejects unpublished levels and prevents a custom link from silently replacing another active game', () => {
  const room = new CoopRoom(
      () => crypto.randomUUID(),
      Date.now,
      100,
      () => {},
      (id) => (id === 'known' ? { level: levels[0], revision: 1 } : null),
    ),
    bad = new TestPeer();
  expect(room.join(bad, bad.accountId, undefined, 'missing')).toBeNull();
  const a = new TestPeer(),
    b = new TestPeer();
  room.join(a, a.accountId);
  expect(room.join(b, b.accountId, undefined, 'known')).toBeNull();
  expect(a.state.partnerConnected).toBe(false);
});
it('resumes a seat after a shared chamber change even when the browser still has the original custom URL', () => {
  const room = new CoopRoom(
      () => crypto.randomUUID(),
      Date.now,
      100,
      () => {},
      () => ({ level: levels[0], revision: 1 }),
    ),
    a = new TestPeer(),
    b = new TestPeer();
  room.join(a, a.accountId, undefined, 'custom');
  room.join(b, b.accountId, undefined, 'custom');
  send(room, a, { type: 'level', index: 2 });
  room.leave(a);
  const resumed = new TestPeer();
  expect(room.join(resumed, a.accountId, a.token.token, 'custom')).toBe(1);
  expect(resumed.state.levelIndex).toBe(2);
});
it('honors P2-first selection, rejects collisions and preserves selected roles on reconnect', () => {
  const room = new CoopRoom(() => crypto.randomUUID()),
    p2 = new TestPeer(),
    collision = new TestPeer(),
    p1 = new TestPeer();
  expect(room.join(p2, p2.accountId, undefined, undefined, 2)).toBe(2);
  expect(p2.state.partnerConnected).toBe(false);
  expect(p2.state.level?.initialBoxesP1).toEqual([]);
  expect(room.join(collision, collision.accountId, undefined, undefined, 2)).toBeNull();
  expect(collision.messages.at(-1)).toMatchObject({
    type: 'full',
    message: expect.stringContaining('P2 is occupied'),
  });
  expect(room.join(p1, p1.accountId, undefined, undefined, 1)).toBe(1);
  send(room, p1, { type: 'move', direction: 'U' });
  send(room, p2, { type: 'move', direction: 'D' });
  room.leave(p2);
  const wrongRole = new TestPeer();
  expect(room.join(wrongRole, p2.accountId, p2.token.token, undefined, 1)).toBeNull();
  const restored = new TestPeer();
  expect(room.join(restored, p2.accountId, p2.token.token, undefined, 2)).toBe(2);
  expect(frame(restored).step).toBe(1);
  expect(restored.state.level?.initialBoxesP1).toEqual([]);
});
it('does not replace an active level when a role request or token is rejected', () => {
  const room = new CoopRoom(() => crypto.randomUUID()),
    a = new TestPeer();
  room.join(a, a.accountId, undefined, undefined, 2);
  const bad = new TestPeer();
  expect(room.join(bad, bad.accountId, a.token.token, 'missing', 1)).toBeNull();
  expect(a.state.levelIndex).toBe(0);
  expect(a.state.partnerConnected).toBe(false);
});
