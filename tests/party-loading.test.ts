import { it, expect, vi } from 'vitest';
import { CoopClient } from '../src/network/CoopClient';
import { JOIN_TIMEOUT_MS, type ServerMessage } from '../src/network/protocol';
import { LevelStore } from '../server/levels/LevelStore';
import { MemoryArchive } from '../server/arkiv/archive';
import { levels } from '../server/data/campaign';
it('shows server loading stages and elapsed time, allows slow reads past 20 seconds, and cleans up timers', async () => {
  vi.useFakeTimers();
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { code: number }) => void;
    onopen?: () => void;
    onerror?: () => void;
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
    constructor() {
      sockets.push(this);
    }
  }
  const sockets: Socket[] = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('location', { href: 'http://localhost:5173' });
  const changed = vi.fn(),
    client = new CoopClient(
      changed,
      async () => 'ticket',
      () => {},
      { kind: 'create', mode: 'coop', levelId: 'id', player: 1 },
    );
  try {
    expect(client.loadingMessage).toContain('sign-in');
    await Promise.resolve();
    const deliver = (m: ServerMessage) => sockets.at(-1)!.onmessage?.({ data: JSON.stringify(m) });
    deliver({ type: 'joining', stage: 'level', storage: 'arkiv' });
    expect(client.loadingMessage).toContain('Reading and verifying the chamber from Arkiv');
    await vi.advanceTimersByTimeAsync(25_000);
    expect(sockets).toHaveLength(1);
    expect(client.loadingMessage).toContain('(25s)');
    expect(sockets[0].readyState).toBe(1);
    deliver({ type: 'full', message: 'Archive unavailable. Retry.' });
    expect(client.status).toBe('full');
    expect(client.loadingMessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    client.retryJoin();
    await Promise.resolve();
    expect(sockets).toHaveLength(2);
    expect(client.notice).toBeNull();
    expect(client.status).toBe('connecting');
    deliver({ type: 'joining', stage: 'level', storage: 'test' });
    expect(client.loadingMessage).toContain('the archive');
    expect(client.loadingMessage).not.toContain('Arkiv');
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + 5000);
    expect(client.status).toBe('full');
    expect(client.notice).toContain('too long');
    expect(vi.getTimerCount()).toBe(0);
    client.retryJoin();
    await Promise.resolve();
    client.destroy();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    client.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
it('shares an in-flight availability check and retries a failed check without caching the failure', async () => {
  const archive = new MemoryArchive(),
    store = new LevelStore(':memory:', archive);
  let release!: () => void;
  const head = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return 10n;
  });
  archive.head = head;
  try {
    const a = store.refreshAvailability(),
      b = store.refreshAvailability();
    expect(head).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([a, b]);
    await store.refreshAvailability();
    expect(head).toHaveBeenCalledTimes(1);
  } finally {
    store.close();
  }
  const failed = new MemoryArchive(),
    retry = new LevelStore(':memory:', failed);
  failed.head = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(0n);
  try {
    await expect(retry.refreshAvailability()).rejects.toThrow('offline');
    await retry.refreshAvailability();
    expect(failed.head).toHaveBeenCalledTimes(2);
  } finally {
    retry.close();
  }
});
it('validates the selected solo level once while still checking replay revision identity', async () => {
  const archive = new MemoryArchive(),
    store = new LevelStore(':memory:', archive);
  await store.seed(levels);
  const read = vi.spyOn(archive, 'read');
  const { Sessions } = await import('../server/game/Sessions'),
    { AuthService } = await import('../server/auth/AuthService');
  const auth = new AuthService({ databasePath: ':memory:', demoEnabled: true }),
    hub = new Sessions(auth, store),
    messages: ServerMessage[] = [];
  try {
    await hub.join(
      { send: (m) => messages.push(m), close() {} },
      {
        id: 'a',
        displayName: 'A',
        walletAddress: null,
        ensName: null,
        kind: 'demo',
        completed: [],
      },
      { kind: 'create', mode: 'solo', levelId: store.campaign()[0].id, player: 1 },
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(messages.some((m) => m.type === 'state')).toBe(true);
    expect(messages.filter((m) => m.type === 'joining').map((m) => m.stage)).toEqual([
      'availability',
      'replay',
      'party',
    ]);
  } finally {
    hub.close();
    await store.drain();
    store.close();
    auth.close();
  }
});
