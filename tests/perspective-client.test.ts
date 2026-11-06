import { it, expect, vi } from 'vitest';
import { CoopClient } from '../src/network/CoopClient';
import type { ServerMessage, SessionState } from '../src/network/protocol';
import { levels } from '../server/data/campaign';
function state(): SessionState {
  return {
    type: 'state',
    player: 1,
    revision: 1,
    levelIndex: 0,
    study: { attempt: 1, player: 2, level: structuredClone(levels[0]) },
    history: [
      { step: 0, position: [1, 1], boxes: [[2, 2]], status: 'PLAYING_PHASE_1', message: 'Ready' },
    ],
    nextBoxes: null,
    shove: null,
    pendingMove: null,
    partnerReady: false,
    partnerConnected: true,
    moveErrors: { U: null, D: 'blocked', L: 'blocked', R: 'blocked', W: null },
  };
}
async function fixture() {
  let socket!: FakeSocket;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { code: number }) => void;
    onerror?: () => void;

    constructor() {
      socket = this;
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { href: 'http://localhost:5173/' });
  const changed = vi.fn(),
    client = new CoopClient(
      changed,
      async () => 'ticket',
      () => {},
      { kind: 'create', mode: 'coop', levelId: 'id', player: 1 },
    );
  await Promise.resolve();
  const deliver = (message: ServerMessage) => socket.onmessage?.({ data: JSON.stringify(message) });
  deliver(state());
  return {
    client,
    get socket() {
      return socket;
    },
    deliver,
    close: () => {
      client.destroy();
      vi.unstubAllGlobals();
    },
  };
}
it('switches locally without messages and closes/locks immediately on a sent move until the server confirms', async () => {
  const f = await fixture();
  try {
    expect(f.client.canStudy).toBe(true);
    expect(f.client.otherPerspective).toBeUndefined();
    f.client.togglePerspective();
    expect(f.client.otherPerspective?.player).toBe(2);
    f.client.togglePerspective();
    expect(f.client.otherPerspective).toBeUndefined();
    f.client.togglePerspective();
    expect(f.socket.sent).toHaveLength(0);
    expect(f.client.send({ type: 'move', direction: 'U', revision: 1 })).toBe(true);
    expect(f.client.canStudy).toBe(false);
    expect(f.client.otherPerspective).toBeUndefined();
    // An earlier partner-readiness broadcast cannot temporarily reopen the switch.
    f.deliver({ ...state(), partnerReady: true });
    f.client.togglePerspective();
    expect(f.client.otherPerspective).toBeUndefined();
    expect(f.client.canStudy).toBe(false);
    f.deliver({ ...state(), study: undefined, pendingMove: 'U' });
    expect(f.client.canStudy).toBe(false);
    f.deliver({ ...state(), study: undefined, pendingMove: null });
    expect(f.client.canStudy).toBe(false);
    f.deliver({ ...state(), revision: 2, study: { ...state().study!, attempt: 2 } });
    expect(f.client.canStudy).toBe(true);
    expect(f.client.otherPerspective).toBeUndefined();
  } finally {
    f.close();
  }
});
it('keeps study available when transmission fails or the server rejects the selection', async () => {
  const f = await fixture();
  try {
    f.client.togglePerspective();
    f.socket.readyState = 0;
    expect(f.client.send({ type: 'move', direction: 'U', revision: 1 })).toBe(false);
    expect(f.client.otherPerspective).toBeDefined();
    f.socket.readyState = 1;
    f.client.send({ type: 'move', direction: 'D', revision: 1 });
    expect(f.client.canStudy).toBe(false);
    f.deliver({ type: 'error', message: 'Path blocked.' });
    expect(f.client.canStudy).toBe(true);
    f.client.togglePerspective();
    expect(f.client.otherPerspective).toBeDefined();
    f.deliver({ ...state(), study: undefined });
    expect(f.client.otherPerspective).toBeUndefined();
    expect(f.client.canStudy).toBe(false);
  } finally {
    f.close();
  }
});
it('uses the resumed server lock when a connection drops before a move acknowledgement', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  try {
    f.client.send({ type: 'move', direction: 'U', revision: 1 });
    expect(f.client.canStudy).toBe(false);
    f.socket.readyState = 3;
    f.socket.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1500);
    f.deliver(state());
    expect(f.client.canStudy).toBe(true);
    f.client.send({ type: 'move', direction: 'U', revision: 1 });
    f.socket.readyState = 3;
    f.socket.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1500);
    f.deliver({ ...state(), study: undefined });
    expect(f.client.canStudy).toBe(false);
  } finally {
    f.close();
    vi.useRealTimers();
  }
});
