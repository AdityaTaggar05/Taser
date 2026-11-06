import { it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { generateKey } from 'arkiv-encryption';
import { BettingService, type AttemptObservation } from '../server/betting/BettingService';
import { MemoryArchive, type ArchiveRecord } from '../server/arkiv/archive';
import { LevelCipher } from '../server/arkiv/LevelCipher';
import { creationExpiration } from '../server/arkiv/expiration';
import { GameEngine } from '../src/core/engine';
import { levels } from '../server/data/campaign';
import { authFixture } from './authFixture';
async function fixture() {
  let now = 1_000_000,
    head = 10_000n;
  const db = new DatabaseSync(':memory:'),
    archive = new MemoryArchive();
  archive.head = async () => head;
  const level = structuredClone(levels[0]);
  const record: ArchiveRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    category: 'community',
    ownerId: 'author',
    ownerName: 'Author',
    updatedAt: now,
    level,
  };
  const ref = await archive.put(record),
    snapshot = { id: record.id, revision: 1, ref, level },
    engine = new GameEngine(level);
  const service = new BettingService(db, archive, () => now);
  const moves: AttemptObservation['moves'] = [[], []];
  const observation = (): AttemptObservation => ({
    level: structuredClone(level),
    state: structuredClone(engine.state),
    moves: structuredClone(moves),
    revision: engine.state.step,
  });
  const id = service.create(
    snapshot,
    [
      { id: 'p1', name: 'Atlas' },
      { id: 'p2', name: 'Nova' },
    ],
    observation(),
  );
  return {
    db,
    archive,
    snapshot,
    engine,
    service,
    id,
    observation,
    moves,
    advance: (ms: number) => {
      now += ms;
      head += BigInt(ms / 2000);
    },
    win: () => {
      for (let k = 0; k < level.solutionP1.length; k++) {
        const a = level.solutionP1[k],
          b = level.solutionP2[k];
        moves[0].push(a);
        moves[1].push(b);
        engine.executeStep(a, b);
      }
    },
    close: async () => {
      await service.drain();
      service.close();
      db.close();
    },
  };
}
it('locks predictions at start, blocks participant/duplicate stakes, and settles a conserved pool once', async () => {
  const f = await fixture();
  try {
    for (const amount of [-10, 0, 9, 101, 1.5, '25', null, Infinity])
      expect(() => f.service.predict(f.id, 'bad', 'escape', amount)).toThrow();
    expect(() => f.service.predict(f.id, 'bad', 'anything', 25)).toThrow();
    expect(() => f.service.predict(f.id, 'p1', 'escape', 25)).toThrow('Operators');
    f.service.predict(f.id, 'a', 'escape', 10);
    f.service.predict(f.id, 'b', 'escape', 20);
    f.service.predict(f.id, 'c', 'fail', 20);
    expect(() => f.service.predict(f.id, 'a', 'fail', 10)).toThrow('already');
    expect(f.service.balance('a')).toBe(990);
    f.service.lock(f.id);
    expect(() => f.service.predict(f.id, 'late', 'fail', 25)).toThrow('closed');
    f.service.settle(f.id, 'escape');
    f.service.settle(f.id, 'fail');
    expect(f.service.balance('a')).toBe(1007);
    expect(f.service.balance('b')).toBe(1013);
    expect(f.service.balance('c')).toBe(980);
    expect(['a', 'b', 'c'].reduce((n, id) => n + f.service.balance(id), 0)).toBe(3000);
    expect(f.service.view(f.id, 'a')!.prediction).toEqual({
      outcome: 'escape',
      amount: 10,
      payout: 17,
    });
    expect(f.service.view(f.id, 'p1')).toBeNull();
    expect(f.service.list('p2').matches).toEqual([]);
  } finally {
    await f.close();
  }
});
it('refunds pools with no winners and recovers in-flight wagers after a restart', async () => {
  const f = await fixture();
  try {
    f.service.predict(f.id, 'a', 'escape', 100);
    f.service.lock(f.id);
    f.service.settle(f.id, 'fail');
    expect(f.service.balance('a')).toBe(1000);
    const second = f.service.create(
      f.snapshot,
      [
        { id: 'p1', name: 'One' },
        { id: 'p2', name: 'Two' },
      ],
      f.observation(),
    );
    f.service.predict(second, 'a', 'fail', 50);
    f.service.lock(second);
    const restarted = new BettingService(f.db, f.archive);
    expect(restarted.balance('a')).toBe(1000);
    expect(restarted.status(second)).toBe('void');
    restarted.close();
  } finally {
    await f.close();
  }
});
it('delays both perspectives and never returns inputs, solutions, invitation codes or account IDs', async () => {
  const f = await fixture();
  try {
    expect(f.service.random('viewer').frame).toBeNull();
    f.advance(10_000);
    const match = f.service.view(f.id, 'viewer')!;
    expect(match.frame!.state.step).toBe(0);
    expect(match.frame!.level.solutionP1).toEqual([]);
    expect(match.frame!.level.solutionP2).toEqual([]);
    expect(match.frame!.level.weldTargets).toEqual([]);
    expect(match.frame!.level.midpointSwitchRequired).toBeUndefined();
    expect(match).not.toHaveProperty('participants');
    expect(match).not.toHaveProperty('snapshot');
    expect(match).not.toHaveProperty('code');
    expect(match).not.toHaveProperty('moves');
    f.service.lock(f.id);
    f.engine.executeStep('U', 'D');
    f.moves[0].push('U');
    f.moves[1].push('D');
    f.service.record(f.id, f.observation(), 'active');
    expect(f.service.view(f.id, 'viewer')!.frame!.state.step).toBe(0);
    f.advance(10_000);
    expect(f.service.view(f.id, 'viewer')!.frame!.state.step).toBe(1);
  } finally {
    await f.close();
  }
});
it('archives encrypted partial turns separately, freezes loss expiry and follows level hearts on a verified win', async () => {
  const f = await fixture();
  try {
    await f.service.flush();
    const first = (await f.archive.listAttempts())[0];
    expect(first.record.category).toBe('attempt');
    expect(first.ref.schema).toBe('attempt');
    expect(BigInt(first.ref.expiresAt)).toBe(10_060n);
    expect(creationExpiration(first.record).expiresAt).toBe(10_060n);
    const cipher = new LevelCipher(generateKey(), 'test');
    const encrypted = await cipher.encrypt(first.record);
    expect(
      await cipher.decrypt(encrypted, { id: first.record.id, revision: 1, category: 'attempt' }),
    ).toEqual(first.record);
    await expect(
      cipher.decrypt(
        await cipher.encrypt({
          ...first.record,
          attempt: { ...first.record.attempt!, transcriptHash: '0'.repeat(64) },
        }),
        { id: first.record.id, revision: 1, category: 'attempt' },
      ),
    ).rejects.toThrow('validation');
    expect(() => f.service.record(f.id, f.observation(), 'won')).toThrow('verified');
    f.service.lock(f.id);
    f.win();
    f.service.record(f.id, f.observation(), 'won');
    f.service.settle(f.id, 'escape');
    await f.service.flush();
    const won = (await f.archive.listAttempts()).find((e) => e.record.attempt!.outcome === 'won')!;
    expect(won.record.level.solutionP1).toEqual(levels[0].solutionP1);
    expect(won.ref.expiresAt).toBe(f.snapshot.ref.expiresAt);
    expect(
      await cipher.decrypt(await cipher.encrypt(won.record), {
        id: won.record.id,
        revision: 1,
        category: 'attempt',
      }),
    ).toEqual(won.record);
    const extended = await f.archive.extend(f.snapshot.ref, 'heart');
    await f.service.flush();
    expect((await f.archive.inspect(won.ref)).ref.expiresAt).toBe(extended.expiresAt);
    f.advance(122_000);
    await expect(f.archive.inspect(first.ref)).rejects.toThrow('expired');
    expect((await f.archive.inspect(won.ref)).record.attempt!.outcome).toBe('won');
    expect((await f.archive.list()).some((e) => e.record.category === 'attempt')).toBe(false);
  } finally {
    await f.close();
  }
});
it('keeps losses briefly without renewal, expires unsubmitted old turns, and voids inactive markets', async () => {
  const f = await fixture();
  try {
    f.service.predict(f.id, 'a', 'escape', 50);
    f.advance(122_000);
    f.service.sweep();
    expect(f.service.status(f.id)).toBe('void');
    expect(f.service.balance('a')).toBe(1000);
    await f.service.flush();
    expect(await f.archive.listAttempts()).toEqual([]);
    const id = f.service.create(
      f.snapshot,
      [
        { id: 'p1', name: 'One' },
        { id: 'p2', name: 'Two' },
      ],
      f.observation(),
    );
    f.service.lock(id);
    f.service.record(id, f.observation(), 'lost');
    f.service.settle(id, 'fail');
    await f.service.flush();
    const lost = (await f.archive.listAttempts()).find(
      (e) => e.record.attempt!.outcome === 'lost',
    )!;
    f.advance(122_000);
    f.service.sweep();
    await expect(f.archive.inspect(lost.ref)).rejects.toThrow('expired');
    expect(f.service.view(id, 'viewer')!.archive).toBe('expired');
    expect(f.service.view(id, 'viewer')!.frame).toBeNull();
  } finally {
    await f.close();
  }
});
it('keeps archive failures pending without interfering with predictions or balances', async () => {
  const f = await fixture();
  try {
    const write = vi.spyOn(f.archive, 'put').mockRejectedValueOnce(new Error('Offline'));
    f.service.predict(f.id, 'a', 'escape', 25);
    await f.service.flush();
    expect(f.service.view(f.id, 'a')!.archive).toBe('pending');
    expect(f.service.balance('a')).toBe(975);
    await f.service.flush();
    expect(f.service.view(f.id, 'a')!.archive).toBe('confirmed');
    expect(write).toHaveBeenCalledTimes(2);
  } finally {
    await f.close();
  }
});
it('authenticates prediction APIs, enforces origin checks and excludes participant accounts', async () => {
  const f = await authFixture();
  try {
    const anon = f.browser();
    expect((await anon.request('betting')).status).toBe(401);
    const viewer = f.browser();
    await viewer.login();
    const snapshot = f.levels.forPlay(f.levels.campaign()[0].id)!;
    const id = f.levels.betting.create(
      snapshot,
      [
        { id: 'p1', name: 'One' },
        { id: 'p2', name: 'Two' },
      ],
      {
        level: snapshot.level,
        state: new GameEngine(snapshot.level).state,
        moves: [[], []],
        revision: 0,
      },
    );
    expect((await viewer.request('betting/random')).data.id).toBe(id);
    expect(
      (
        await viewer.request(
          `betting/${id}/predict`,
          { outcome: 'escape', amount: 25 },
          { Origin: 'http://evil.invalid' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await viewer.request(`betting/${id}/predict`, { outcome: 'escape', amount: 25 })).data
        .balance,
    ).toBe(975);
    expect(
      (await viewer.request(`betting/${id}/predict`, { outcome: 'fail', amount: 25 })).status,
    ).toBe(409);
    f.levels.betting.lock(id);
    expect(
      (await viewer.request(`betting/${id}/predict`, { outcome: 'fail', amount: 25 })).status,
    ).toBe(409);
    const detail = (await viewer.request('betting/' + id)).data;
    expect(detail.prediction).toEqual({ outcome: 'escape', amount: 25, payout: null });
    expect(detail.frame).toBeNull();
  } finally {
    await f.close();
  }
});

it('requires both operators to opt in, forbids public undo and settles reset while keeping private play unchanged', async () => {
  const { Sessions } = await import('../server/game/Sessions');
  const { AuthService } = await import('../server/auth/AuthService');
  const { LevelStore } = await import('../server/levels/LevelStore');
  type Message = import('../src/network/protocol').ServerMessage;
  type State = import('../src/network/protocol').SessionState;
  class Peer {
    messages: Message[] = [];
    closed = false;
    send(m: Message) {
      this.messages.push(structuredClone(m));
    }
    close() {
      this.closed = true;
    }
    get state() {
      return this.messages.filter((m): m is State => m.type === 'state').at(-1)!;
    }
  }
  const user = (id: string): import('../src/auth/types').PlayerProfile => ({
    id,
    displayName: id,
    walletAddress: null,
    ensName: null,
    kind: 'demo',
    completed: [],
  });
  const auth = new AuthService({ databasePath: ':memory:', demoEnabled: true }),
    store = new LevelStore(':memory:', new MemoryArchive());
  await store.seed(levels);
  const hub = new Sessions(auth, store),
    host = new Peer(),
    guest = new Peer();
  try {
    const levelId = store.campaign()[0].id;
    await hub.join(host, user('host'), { kind: 'create', mode: 'coop', levelId, player: 1 });
    await hub.join(guest, user('guest'), { kind: 'invite', code: host.state.party!.code });
    expect(store.betting.list('viewer').matches).toEqual([]);
    hub.receive(host, { type: 'broadcast', enabled: true });
    expect(store.betting.list('viewer').matches).toEqual([]);
    hub.receive(guest, { type: 'broadcast', enabled: true });
    const id = host.state.party!.publicMatchId!;
    expect(id).toBeTruthy();
    store.betting.predict(id, 'viewer', 'fail', 25);
    for (const p of [host, guest]) hub.receive(p, { type: 'ready', ready: true });
    hub.receive(host, { type: 'start' });
    expect(store.betting.status(id)).toBe('locked');
    expect(() => store.betting.predict(id, 'late', 'escape', 25)).toThrow('closed');
    hub.receive(host, { type: 'move', direction: 'U', revision: host.state.revision });
    hub.receive(guest, { type: 'move', direction: 'D', revision: guest.state.revision });
    expect(host.state.history.at(-1)!.step).toBe(1);
    hub.receive(host, { type: 'undo', revision: host.state.revision });
    expect(host.messages.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('undo'),
    });
    expect(host.state.history.at(-1)!.step).toBe(1);
    hub.receive(host, { type: 'reset', revision: host.state.revision });
    expect(host.state.history.at(-1)!.status).toBe('OUT_OF_TIME');
    expect(store.betting.status(id)).toBe('fail');
    expect(store.betting.balance('viewer')).toBe(1000);
    await store.betting.flush();
    const records = await store.archive.listAttempts!();
    expect(records.filter((r) => r.record.attempt!.matchId === id)).toHaveLength(3);
    hub.receive(host, { type: 'lobby', revision: host.state.revision });
    expect(host.state.party!.publicMatchId).toBeUndefined();
    expect(host.state.party!.members.every((m) => !m.broadcast)).toBe(true);
    for (const p of [host, guest]) hub.receive(p, { type: 'ready', ready: true });
    hub.receive(host, { type: 'start' });
    hub.receive(host, { type: 'move', direction: 'U', revision: host.state.revision });
    hub.receive(guest, { type: 'move', direction: 'D', revision: guest.state.revision });
    hub.receive(host, { type: 'undo', revision: host.state.revision });
    expect(host.state.history.at(-1)!.step).toBe(0);
    expect(store.betting.status(id)).toBe('fail');
  } finally {
    hub.close();
    await store.drain();
    store.close();
    auth.close();
  }
});
