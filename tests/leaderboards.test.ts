import { it, expect, vi } from 'vitest';
import { LevelStore } from '../server/levels/LevelStore';
import { MemoryArchive } from '../server/arkiv/archive';
import { levels } from '../server/data/campaign';
import { authFixture } from './authFixture';
import { rankingPage } from '../server/levels/ranking';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('counts distinct co-op chambers across revisions and merges legacy campaign progress', async () => {
  const f = await authFixture();
  try {
    const a = f.browser(),
      b = f.browser();
    const atlas = (await a.login()).data.user,
      nova = (await b.login('nova')).data.user;
    const campaign = f.levels.campaignSnapshots()[0];
    f.auth.recordCompletion([atlas.id], campaign.slot!);
    f.levels.recordWin([atlas.id], campaign.ref!.entityKey);
    // Historical publications may have revisions; newly certified levels remain immutable.
    const legacy = {
      id: crypto.randomUUID(),
      revision: 1,
      category: 'community' as const,
      ownerId: atlas.id,
      ownerName: 'Atlas',
      updatedAt: Date.now(),
      level: levels[0],
    };
    const first = await f.levels.archive.put(legacy);
    await f.levels.hydrate();
    f.levels.recordWin([atlas.id, nova.id], first.entityKey);
    const revised = await f.levels.archive.put({
      ...legacy,
      revision: 2,
      level: { ...levels[0], name: 'Revision 2' },
    });
    await f.levels.hydrate();
    f.levels.recordWin([atlas.id], revised.entityKey);
    const board = f.auth.globalLeaderboard(f.levels.completions(), nova.id);
    expect(board.entries.map((r) => [r.name, r.completed, r.isYou])).toEqual([
      ['Atlas', 2, false],
      ['Nova', 1, true],
    ]);
    expect(board.me?.rank).toBe(2);
    expect(JSON.stringify(board)).not.toContain(atlas.id);
  } finally {
    await f.close();
  }
});

it('keeps verified best scores while run publication is pending and separates solo from co-op', async () => {
  const archive = new MemoryArchive(),
    store = new LevelStore(':memory:', archive);
  try {
    await store.seed(levels);
    const snapshot = store.campaignSnapshots()[0];
    archive.put = async () => {
      throw new Error('offline');
    };
    const moves = [levels[0].solutionP1, levels[0].solutionP2] as const;
    await store.captureRun(
      snapshot,
      { id: 'a', displayName: 'Atlas' },
      1,
      [...moves],
      'solo',
      'creator',
    );
    expect(store.completions()).toEqual([]);
    expect(store.scores(snapshot.ref!.entityKey, 'a', 'solo').entries).toMatchObject([
      { rank: 1, name: 'Atlas', turns: 8, isYou: true },
    ]);
    expect(store.scores(snapshot.ref!.entityKey, 'a', 'coop').entries).toEqual([]);
    await store.captureRun(
      snapshot,
      { id: 'b', displayName: 'Nova' },
      2,
      [...moves],
      'coop',
      'live',
    );
    await store.captureRun(
      snapshot,
      { id: 'b', displayName: 'Nova' },
      2,
      [...moves],
      'coop',
      'live',
    );
    expect(store.completions()).toHaveLength(1);
    expect(store.scores(snapshot.ref!.entityKey, 'a', 'coop').total).toBe(1);
    expect(store.scores('different-revision', 'b', 'coop').entries).toEqual([]);
    expect(() =>
      store.captureRun(
        snapshot,
        { id: 'fake', displayName: 'Fake' },
        1,
        [['W'], ['W']],
        'coop',
        'live',
      ),
    ).toThrow('winning');
    expect(store.scores(snapshot.ref!.entityKey, 'a', 'coop').total).toBe(1);
  } finally {
    await store.drain();
    store.close();
  }
});

it('pages an ordered ranking without losing the personal rank or leaking identity', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ accountId: String(i) }));
  const page = rankingPage(rows, '59', 1, (_row, rank, isYou) => ({ rank, isYou }));
  expect(page.entries).toHaveLength(25);
  expect(page.entries[0].rank).toBe(26);
  expect(page.me).toEqual({ rank: 60, isYou: true });
  expect(page.total).toBe(60);
});

it('improves a best score, ignores slower wins, and ranks earlier equal scores first', async () => {
  const archive = new MemoryArchive(),
    store = new LevelStore(':memory:', archive);
  const fast = {
    ...levels[0],
    width: 4,
    height: 4,
    walls: [],
    iceTiles: [],
    initialP1: [1, 1],
    initialP2: [4, 4],
    initialBoxesP1: [[2, 2]],
    initialBoxesP2: [[2, 2]],
    weldTargets: [[2, 2]],
    switchesP1: [[2, 2]],
    switchesP2: [[2, 2]],
    exitP1: [2, 1],
    exitP2: [3, 4],
    solutionP1: ['W', 'W', 'W', 'W', 'R'],
    solutionP2: ['W', 'W', 'W', 'W', 'L'],
  };
  try {
    await store.seed([fast]);
    const snapshot = store.campaignSnapshots()[0];
    const quick: [
      import('../src/core/types').Direction[],
      import('../src/core/types').Direction[],
    ] = [
      ['W', 'W', 'W', 'W', 'R'],
      ['W', 'W', 'W', 'W', 'L'],
    ];
    const slow: [import('../src/core/types').Direction[], import('../src/core/types').Direction[]] =
      [
        ['W', 'W', 'W', 'W', 'W', 'R'],
        ['W', 'W', 'W', 'W', 'W', 'L'],
      ];
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await store.captureRun(snapshot, { id: 'a', displayName: 'Atlas' }, 1, slow, 'coop', 'live');
    vi.mocked(Date.now).mockReturnValue(2000);
    await store.captureRun(snapshot, { id: 'b', displayName: 'Nova' }, 2, quick, 'coop', 'live');
    vi.mocked(Date.now).mockReturnValue(3000);
    await store.captureRun(snapshot, { id: 'a', displayName: 'Atlas' }, 1, quick, 'coop', 'live');
    vi.mocked(Date.now).mockReturnValue(4000);
    await store.captureRun(snapshot, { id: 'a', displayName: 'Atlas' }, 1, slow, 'coop', 'live');
    const board = store.scores(snapshot.ref!.entityKey, 'a', 'coop');
    expect(board.entries.map((row) => [row.name, row.turns, row.achievedAt])).toEqual([
      ['Nova', 5, 2000],
      ['Atlas', 5, 3000],
    ]);
    expect(board.me?.rank).toBe(2);
  } finally {
    vi.restoreAllMocks();
    await store.drain();
    store.close();
  }
});

it('authenticates leaderboard reads and hearts, rejects CSRF and stale revisions, and extends once per account', async () => {
  const f = await authFixture();
  try {
    const a = f.browser(),
      b = f.browser(),
      anonymous = f.browser();
    await a.login();
    await b.login('nova');
    const id = f.levels.campaign()[0].id,
      path = `levels/${id}`,
      before = (await a.request(path + '/leaderboard')).data;
    expect((await anonymous.request('levels/leaderboard')).status).toBe(401);
    expect(
      (await anonymous.request(path + '/heart', { entityKey: before.level.entityKey })).status,
    ).toBe(401);
    expect(
      (
        await a.request(
          path + '/heart',
          { entityKey: before.level.entityKey },
          { Origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect((await a.request(path + '/heart', { entityKey: '0x' + 'f'.repeat(64) })).status).toBe(
      409,
    );
    const [first, duplicate] = await Promise.all([
      a.request(path + '/heart', { entityKey: before.level.entityKey }),
      a.request(path + '/heart', { entityKey: before.level.entityKey }),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(first.data.hearts).toEqual({ count: 1, hearted: true, pending: false });
    expect(BigInt(first.data.expiry.expiresAt) - BigInt(before.expiry.expiresAt)).toBe(1800n);
    expect(duplicate.data.expiry.expiresAt).toBe(first.data.expiry.expiresAt);
    const second = await b.request(path + '/heart', { entityKey: before.level.entityKey });
    expect(second.data.hearts.count).toBe(2);
    expect(BigInt(second.data.expiry.expiresAt) - BigInt(before.expiry.expiresAt)).toBe(3600n);
    expect((await a.request(path + '/leaderboard?mode=invalid')).status).toBe(400);
    expect((await a.request('levels/leaderboard?page=-1')).status).toBe(400);
    const serialized = JSON.stringify((await a.request(path + '/leaderboard')).data);
    expect(serialized).not.toMatch(/solutionP1|ciphertext|account_id|privateKey/);
  } finally {
    await f.close();
  }
});

it('recovers a confirmed heart after a lost application response across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'taser-heart-')),
    path = join(directory, 'game.sqlite'),
    archive = new MemoryArchive();
  let store = new LevelStore(path, archive);
  try {
    await store.seed(levels);
    const id = store.campaign()[0].id,
      key = store.campaign()[0].entityKey,
      original = archive.extend.bind(archive);
    let fail = true;
    archive.extend = async (...args) => {
      const ref = await original(...args);
      if (fail) throw new Error('Lost response');
      return ref;
    };
    await expect(store.heart(id, 'a', key)).rejects.toThrow('Lost response');
    expect((await store.leaderboard(id, 'a')).hearts).toEqual({
      count: 0,
      hearted: false,
      pending: true,
    });
    store.close();
    store = new LevelStore(path, archive);
    await store.hydrate();
    fail = false;
    await store.flushHearts();
    const board = await store.leaderboard(id, 'a');
    expect(board.expiry.expiresAt).toBe('5400');
    expect(board.hearts).toEqual({ count: 1, hearted: true, pending: false });
    await store.heart(id, 'a', key);
    expect((await store.leaderboard(id, 'a')).expiry.expiresAt).toBe('5400');
  } finally {
    await store.drain();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('rejects expired boards and hearts while keeping global completion history', async () => {
  let head = 0n;
  const archive = new MemoryArchive();
  archive.head = async () => head;
  const store = new LevelStore(':memory:', archive);
  try {
    await store.seed(levels);
    const id = store.campaign()[0].id,
      key = store.campaign()[0].entityKey;
    store.recordWin(['a'], key);
    head = 3600n;
    await expect(store.leaderboard(id, 'a')).rejects.toThrow('expired');
    await expect(store.heart(id, 'a', key)).rejects.toThrow('expired');
    await store.hydrate();
    expect(store.completions()).toEqual([{ accountId: 'a', levelId: 'campaign:1' }]);
  } finally {
    await store.drain();
    store.close();
  }
});

it('recovers pending hearts in bounded sweeps without starvation from one unavailable publication', async () => {
  const archive = new MemoryArchive(),
    store = new LevelStore(':memory:', archive),
    extend = archive.extend.bind(archive);
  let recovering = false;
  try {
    await store.seed(levels);
    const campaign = store.campaign();
    archive.extend = async (ref, account) => {
      if (!recovering || ref.entityKey === campaign[0].entityKey) throw new Error('unavailable');
      return extend(ref, account);
    };
    for (const level of campaign.slice(0, 6))
      await expect(store.heart(level.id, 'a', level.entityKey)).rejects.toThrow('unavailable');
    recovering = true;
    await store.flushHearts();
    expect((await store.leaderboard(campaign[3].id, 'a')).hearts.hearted).toBe(true);
    expect((await store.leaderboard(campaign[4].id, 'a')).hearts.hearted).toBe(false);
    await store.flushHearts();
    expect((await store.leaderboard(campaign[5].id, 'a')).hearts.hearted).toBe(true);
    expect((await store.leaderboard(campaign[0].id, 'a')).hearts.pending).toBe(true);
  } finally {
    await store.drain();
    store.close();
  }
});
