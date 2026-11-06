import { ImmediateTestRegistry } from './certificationFixture';
import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { creationExpiration } from '../server/arkiv/expiration';
import { AttemptEntities } from '../server/arkiv/schema';
import { generateKey } from 'arkiv-encryption';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  custom,
  bytesToHex,
  encodeEventTopics,
  encodeAbiParameters,
  decodeFunctionData,
  decodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  keccak256,
  parseTransaction,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { str, u64, bytes } from '@arkiv-network/sdk/schema';
import { ENTITY_EVENTS_ABI } from '@arkiv-network/sdk';
import { LevelCipher, CONTENT_TYPE } from '../server/arkiv/LevelCipher';
import { ArkivArchive } from '../server/arkiv/ArkivArchive';
import { MemoryArchive, type ArchiveRecord, type ArchiveRef } from '../server/arkiv/archive';
import { LevelStore } from '../server/levels/LevelStore';
import { levels } from '../server/data/campaign';
import { canonicalJSON } from '../server/arkiv/canonical';
import { type ThemePublication } from '../server/arkiv/ThemePublication';
import { authFixture } from './authFixture';

const record = (revision = 1): ArchiveRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  revision,
  category: 'community',
  ownerId: 'atlas',
  ownerName: 'Atlas',
  updatedAt: 0,
  level: structuredClone(levels[0]),
});
it('encrypts the entire level with fresh IVs, authenticates routing and rejects tampering/wrong keys', async () => {
  const raw = generateKey(),
    cipher = new LevelCipher(raw, 'test'),
    r = record(),
    expected = { id: r.id, revision: 1, category: 'community' };
  const first = await cipher.encrypt(r),
    second = await cipher.encrypt(r);
  expect(first).not.toEqual(second);
  expect(new TextDecoder().decode(first)).not.toContain(r.level.name);
  expect(canonicalJSON(await cipher.decrypt(first, expected))).toBe(canonicalJSON(r));
  await expect(new LevelCipher(generateKey(), 'test').decrypt(first, expected)).rejects.toThrow(
    'authentication',
  );
  await expect(new LevelCipher(raw, 'other').decrypt(first, expected)).rejects.toThrow(
    'authentication',
  );
  await expect(cipher.decrypt(first, { ...expected, revision: 2 })).rejects.toThrow(
    'authentication',
  );
  await expect(cipher.decrypt(first, { ...expected, category: 'campaign' })).rejects.toThrow(
    'authentication',
  );
  const tampered = first.slice();
  tampered[20] ^= 1;
  await expect(cipher.decrypt(tampered, expected)).rejects.toThrow('authentication');
});
it('restores campaign/custom publications from the archive and gates solutions by exact revision', async () => {
  const archive = new MemoryArchive();
  let store = new LevelStore(':memory:', archive, new ImmediateTestRegistry());
  await store.seed(levels);
  const owner = 'atlas',
    draft = await store.save(owner, 'Atlas', levels[0]);
  await store.publish(owner, draft.id, 1);
  const first = store.published(draft.id)!;
  await expect(store.solution('nova', first.ref!.entityKey)).rejects.toThrow('Complete');
  store.recordWin(['nova'], first.ref!.entityKey);
  expect((await store.solution('nova', first.ref!.entityKey)).solutionP1).toEqual(
    levels[0].solutionP1,
  );
  await expect(
    store.save(owner, 'Atlas', { ...levels[0], name: 'Changed' }, draft.id, 1),
  ).rejects.toThrow('locked');
  const campaignDraft = await store.save(owner, 'Atlas', { ...levels[0], name: 'Another chamber' });
  const promoted = await store.publish(owner, campaignDraft.id, 1, 'campaign');
  expect(promoted.id).toBe(campaignDraft.id);
  expect(store.campaign()).toHaveLength(levels.length + 1);
  expect(store.campaign()[levels.length].slot).toBe(levels.length + 1);
  const campaignKey = store.campaign()[levels.length].entityKey;
  expect(store.canReveal('nova', campaignKey)).toBe(false);
  await expect(store.template('atlas', campaignDraft.id, true)).rejects.toThrow('view-only');
  store.close();
  store = new LevelStore(':memory:', archive, new ImmediateTestRegistry());
  await store.hydrate();
  expect(store.campaign()).toHaveLength(levels.length + 1);
  expect(store.published(draft.id)?.level.name).toBe(levels[0].name);
  expect(store.get(owner, draft.id).readonly).toBe(true);
  store.close();
});
it('enforces campaign publishing and template access on authenticated server endpoints', async () => {
  const f = await authFixture();
  try {
    const a = f.browser(),
      b = f.browser();
    await a.login();
    await b.login('nova');
    expect((await a.request('levels/catalog')).data.canPublishCampaign).toBe(true);
    expect((await b.request('levels/catalog')).data.canPublishCampaign).toBe(false);
    const campaign = (await b.request('levels/catalog')).data.campaign[0];
    expect((await b.request(`levels/campaign/${campaign.id}/template`)).status).toBe(403);
    expect((await a.request(`levels/campaign/${campaign.id}/template`)).status).toBe(200);
    const draft = (await b.request('levels', { level: levels[0] })).data;
    expect(
      (await b.request(`levels/${draft.id}/publish`, { revision: 1, target: 'campaign' })).status,
    ).toBe(403);
    expect((await b.request(`levels/solution/${campaign.entityKey}`)).status).toBe(403);
    f.levels.recordWin([(await b.request('session')).data.user.id], campaign.entityKey);
    expect((await b.request(`levels/solution/${campaign.entityKey}`)).data.solutionP1).toEqual(
      levels[0].solutionP1,
    );
    expect((await b.request(`levels/campaign/${campaign.id}/template`)).status).toBe(200);
    expect((await b.request('levels/catalog')).data.campaign[0]).not.toHaveProperty('level');
  } finally {
    await f.close();
  }
});

/** Exercise real SDK encoding and local signing while simulating an RPC losing the send reply. */
function writerFixture(
  budgets: { maxTxFee?: string; dailyBudget?: string; theme?: ThemePublication } = {},
  input: ArchiveRecord = record(),
) {
  const directory = mkdtempSync(join(tmpdir(), 'taser-writer-')),
    path = join(directory, 'journal.sqlite'),
    privateKey = generatePrivateKey(),
    account = privateKeyToAccount(privateKey);
  const expiry = creationExpiration(input);
  let raw: TransactionSerialized | undefined,
    sends = 0,
    receiptAvailable = false,
    readbackAvailable = true,
    expiresAt =
      typeof expiry.expiresAt === 'bigint' && expiry.expiresAt > 0n
        ? expiry.expiresAt
        : 100n + expiry.minLifetime;
  const sent = new Map<Hex, TransactionSerialized>();
  const queries: unknown[] = [];
  const entityKey = ('0x' + 'ab'.repeat(32)) as Hex,
    blockHash = ('0x' + 'cd'.repeat(32)) as Hex;
  const transport = custom(
    {
      async request({ method, params }) {
        if (method === 'eth_chainId') return '0x76edaf';
        if (method === 'eth_blockNumber') return '0x64';
        if (method === 'eth_getTransactionCount') return '0x0';
        if (method === 'eth_gasPrice') return '0x3b9aca00';
        if (method === 'eth_getBalance') return '0x8ac7230489e80000';
        if (method === 'eth_estimateGas') return '0x493e0';
        if (method === 'arkiv_query') {
          queries.push(params);
          return { data: [], blockNumber: '0x64' };
        }
        if (method === 'eth_sendRawTransaction') {
          sends++;
          raw = (params as TransactionSerialized[])[0];
          sent.set(keccak256(raw), raw);
          const db = new DatabaseSync(path);
          const saved = db
            .prepare("SELECT phase,signed,tx_hash FROM arkiv_writes WHERE phase='submitting'")
            .get();
          db.close();
          expect(saved?.signed).toBe(raw);
          expect(saved?.tx_hash).toBe(keccak256(raw));
          throw new Error('Simulated lost response with a sensitive provider URL');
        }
        throw new Error('Unexpected fixture RPC ' + method);
      },
    },
    { retryCount: 0 },
  );
  const archive = new ArkivArchive(
    {
      accessKey: 'test-key',
      privateKey,
      encryptionKey: generateKey(),
      namespace: 'test',
      databasePath: path,
      maxTxFee: budgets.maxTxFee ?? '0.005',
      dailyBudget: budgets.dailyBudget ?? '0.03',
    },
    transport,
  );
  const reader = (
    archive as unknown as {
      reader: ReturnType<typeof import('@arkiv-network/sdk').createPublicClient>;
    }
  ).reader;
  vi.spyOn(reader, 'getBlock').mockImplementation(
    async (args) =>
      ({
        hash: args?.blockNumber === 0n ? '0x' + '00'.repeat(32) : blockHash,
        gasLimit: 30_000_000n,
        number: 100n,
      }) as never,
  );
  vi.spyOn(reader, 'getTransactionReceipt').mockImplementation(async ({ hash: txHash }) => {
    const raw = sent.get(txHash);
    if (!raw || !receiptAvailable) throw new Error('Receipt not available');
    const db = new DatabaseSync(path),
      plan = db
        .prepare('SELECT operation,body FROM arkiv_writes WHERE tx_hash=?')
        .get(keccak256(raw))!;
    db.close();
    const extension =
      String(plan.operation).startsWith('heart:') || String(plan.operation).startsWith('retain:');
    if (extension) expiresAt = BigInt(JSON.parse(String(plan.body)).expiresAt);
    const log = extension
      ? {
          topics: encodeEventTopics({
            abi: ENTITY_EVENTS_ABI,
            eventName: 'ExpiryExtended',
            args: { entityKey, owner: account.address },
          }),
          data: encodeAbiParameters([{ type: 'uint64' }], [expiresAt]),
        }
      : {
          topics: encodeEventTopics({
            abi: ENTITY_EVENTS_ABI,
            eventName: 'EntityCreated',
            args: { entityKey, owner: account.address },
          }),
          data: encodeAbiParameters([{ type: 'uint64' }, { type: 'uint8' }], [expiresAt, 1]),
        };
    return {
      status: 'success',
      transactionHash: keccak256(raw),
      blockNumber: 100n,
      blockHash,
      logs: [{ address: '0x4400000000000000000000000000000000000044', ...log }],
    } as never;
  });
  vi.spyOn(reader, 'getTransaction').mockImplementation(async ({ hash: txHash }) => {
    const serialized = sent.get(txHash!)!,
      tx = parseTransaction(serialized);
    return { ...tx, hash: keccak256(serialized), from: account.address, input: tx.data } as never;
  });
  vi.spyOn(reader, 'getEntity').mockImplementation(async () => {
    if (!readbackAvailable) throw new Error('Readback unavailable');
    const db = new DatabaseSync(path),
      plan = db.prepare('SELECT ciphertext FROM arkiv_writes LIMIT 1').get()!;
    db.close();
    if (budgets.theme) {
      const t = budgets.theme;
      return {
        $key: entityKey,
        $creator: account.address,
        $owner: account.address,
        $creationFlags: { readonly: true, permissionlessExtension: false },
        $expiresAt: 7_884_100n,
        namespace: str('test'),
        theme_id: str(t.themeId),
        version: str(t.version),
        swarm_reference: str(t.swarmReference),
        manifest_sha256: str(t.manifestSha256),
        release_sha256: str(t.releaseSha256),
        content_type: str('application/json'),
        payload: bytes(plan.ciphertext as Hex),
      } as never;
    }
    return {
      $key: entityKey,
      $creator: account.address,
      $owner: account.address,
      $creationFlags: { readonly: true, permissionlessExtension: false },
      $expiresAt: expiresAt,
      namespace: str('test'),
      record_id: str(input.id),
      revision: u64(input.revision),
      category: str(input.category),
      content_type: str(CONTENT_TYPE),
      ciphertext: bytes(plan.ciphertext as Hex),
    } as never;
  });
  return {
    archive,
    path,
    reader,
    queries,
    get raw() {
      return raw!;
    },
    get sends() {
      return sends;
    },
    receipt: (yes: boolean) => {
      receiptAvailable = yes;
    },
    readback: (yes: boolean) => {
      readbackAvailable = yes;
    },
    close: () => {
      archive.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
it('journals signed bytes before forwarding and reconciles a lost reply without a second send', async () => {
  const f = writerFixture();
  try {
    await expect(f.archive.put(record())).rejects.toThrow('could not be confirmed');
    expect(f.sends).toBe(1);
    await expect(f.archive.put(record(2))).rejects.toThrow();
    expect(f.sends).toBe(1);
    f.receipt(true);
    const ref = await f.archive.put(record());
    expect(ref.entityKey).toContain('abab');
    expect(f.sends).toBe(1);
    expect(canonicalJSON(await f.archive.read(ref))).toBe(canonicalJSON(record()));
    await f.archive.put(record());
    expect(f.sends).toBe(1);
  } finally {
    f.close();
  }
});
it('preserves receipt confirmation across readback failure and resumes verification without resending', async () => {
  const f = writerFixture();
  try {
    f.receipt(true);
    f.readback(false);
    await expect(f.archive.put(record())).rejects.toThrow();
    expect(f.sends).toBe(1);
    const db = new DatabaseSync(f.path);
    expect(db.prepare('SELECT phase FROM arkiv_writes').get()?.phase).toBe('receipt_confirmed');
    db.close();
    f.readback(true);
    await f.archive.put(record());
    expect(f.sends).toBe(1);
  } finally {
    f.close();
  }
});
it('rejects mutable or copied publisher data before returning decrypted content', async () => {
  const f = writerFixture();
  try {
    f.receipt(true);
    const ref = await f.archive.put(record());
    const original = await f.reader.getEntity(ref.entityKey as Hex);
    vi.mocked(f.reader.getEntity).mockResolvedValue({
      ...original,
      $creationFlags: { readonly: false, permissionlessExtension: false },
    } as never);
    await expect(f.archive.read(ref)).rejects.toThrow('Untrusted');
    vi.mocked(f.reader.getEntity).mockResolvedValue({
      ...original,
      $creator: privateKeyToAccount(generatePrivateKey()).address,
    } as never);
    await expect(f.archive.read(ref)).rejects.toThrow('Untrusted');
  } finally {
    f.close();
  }
});
it('stops before sending when either the per-transaction or daily approved fee cap is exceeded', async () => {
  for (const budgets of [{ maxTxFee: '0' }, { maxTxFee: '0.0001' }, { dailyBudget: '0.0005' }]) {
    const f = writerFixture(budgets);
    try {
      await expect(f.archive.put(record())).rejects.toThrow('fee budget');
      expect(f.sends).toBe(0);
      const db = new DatabaseSync(f.path);
      expect(db.prepare('SELECT signed,phase FROM arkiv_writes').get()).toMatchObject({
        signed: null,
        phase: 'prepared',
      });
      db.close();
    } finally {
      f.close();
    }
  }
});
it('refuses a new send when the signer balance cannot cover the maximum transaction fee', async () => {
  const f = writerFixture();
  try {
    vi.spyOn(f.reader, 'getBalance').mockResolvedValue(0n);
    await expect(f.archive.put(record())).rejects.toThrow('signer balance');
    expect(f.sends).toBe(0);
  } finally {
    f.close();
  }
});
it('retains legacy snapshots across a partial campaign migration and resumes without duplicates', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'taser-migrate-')),
    path = join(directory, 'accounts.sqlite'),
    archive = new MemoryArchive();
  let store = new LevelStore(path, archive, new ImmediateTestRegistry());
  try {
    const db = new DatabaseSync(path),
      legacy = JSON.stringify(levels[0]);
    db.prepare(
      'INSERT INTO custom_levels(id,owner_id,owner_name,draft,revision,published,published_revision,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    ).run(record().id, 'atlas', 'Atlas', legacy, 1, legacy, 1, 0);
    db.close();
    expect(store.community()).toEqual([]);
    expect(store.published(record().id)).toBeNull();
    const original = archive.put.bind(archive);
    let fail = true;
    vi.spyOn(archive, 'put').mockImplementation(async (r) => {
      if (fail && r.category === 'campaign' && r.campaignSlot === 3) throw new Error('Offline');
      return original(r);
    });
    await expect(store.migrate(levels)).rejects.toThrow('Offline');
    expect(archive.entries.size).toBe(2);
    store.close();
    store = new LevelStore(path, archive, new ImmediateTestRegistry());
    fail = false;
    await store.migrate(levels);
    expect(store.campaign()).toHaveLength(levels.length);
    expect(store.community()).toHaveLength(1);
    expect(store.published(record().id)?.level.solutionP1).toEqual(levels[0].solutionP1);
    const count = archive.entries.size;
    await store.migrate(levels);
    expect(archive.entries.size).toBe(count);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it('authenticates encrypted run provenance and lifetime without exposing move sequences', async () => {
  const cipher = new LevelCipher(generateKey(), 'test');
  const r: ArchiveRecord = {
    ...record(),
    id: 'f'.repeat(64),
    category: 'run',
    lifetimeDays: 2,
    run: { levelKey: '0x' + 'a'.repeat(64), role: 2, mode: 'solo', source: 'creator' },
  };
  const encrypted = await cipher.encrypt(r);
  expect(new TextDecoder().decode(encrypted)).not.toContain('solutionP2');
  expect(await cipher.decrypt(encrypted, { id: r.id, revision: 1, category: 'run' })).toEqual(r);
  await expect(
    cipher.decrypt(await cipher.encrypt({ ...r, run: { ...r.run!, role: 3 as 1 } }), {
      id: r.id,
      revision: 1,
      category: 'run',
    }),
  ).rejects.toThrow('validation');
  await expect(
    cipher.decrypt(await cipher.encrypt({ ...r, lifetimeDays: undefined }), {
      id: r.id,
      revision: 1,
      category: 'run',
    }),
  ).rejects.toThrow('validation');
});

it('loads supported level and run categories from a mixed archive across pages and still rejects untrusted levels', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'taser-catalog-')),
    privateKey = generatePrivateKey(),
    account = privateKeyToAccount(privateKey);
  const encryptionKey = generateKey(),
    cipher = new LevelCipher(encryptionKey, 'test');
  const queries: string[] = [];
  const rows = await Promise.all(
    Array.from({ length: 106 }, async (_, i) => {
      const category =
        i < 3 ? 'other' : i === 3 ? 'campaign' : i === 4 ? 'community' : i === 5 ? 'run' : 'draft';
      const r = {
        ...record(),
        category: category === 'other' ? 'draft' : category,
        ...(category === 'run'
          ? {
              id: 'f'.repeat(64),
              lifetimeDays: 2,
              run: { levelKey: '0x' + 'a'.repeat(64), role: 2, mode: 'solo', source: 'creator' },
            }
          : {}),
        ...(category === 'campaign' ? { campaignSlot: 1 } : {}),
      } as ArchiveRecord;
      return {
        key: ('0x' + (i + 1).toString(16).padStart(64, '0')) as Hex,
        creator: account.address,
        owner: account.address,
        creationFlags: 1,
        expiresAt: '0xffffff',
        attributes: [
          { name: 'arkiv.schema', type: 'str', value: 'weldpoint_levels_v1' },
          { name: 'namespace', type: 'str', value: 'test' },
          { name: 'record_id', type: 'str', value: r.id },
          { name: 'revision', type: 'u64', value: '0x1' },
          { name: 'category', type: 'str', value: category },
          { name: 'content_type', type: 'str', value: CONTENT_TYPE },
          {
            name: 'ciphertext',
            type: 'bytes',
            value: category === 'other' ? '0x00' : bytesToHex(await cipher.encrypt(r)),
          },
        ],
      };
    }),
  );
  const transport = custom(
    {
      async request({ method, params }) {
        if (method === 'eth_chainId') return '0x76edaf';
        if (method === 'eth_getBlockByNumber') return { hash: '0x' + '00'.repeat(32) };
        if (method === 'arkiv_query') {
          const [query, options] = params as unknown as [string, { limit: string }];
          queries.push(query);
          const categories = [...query.matchAll(/category = str\('([^']+)'\)/g)].map((m) => m[1]);
          const cursor = query.match(/\$key > key\((0x[0-9a-f]+)\)/)?.[1];
          const data = rows.filter(
            (row) =>
              (!categories.length ||
                categories.includes(
                  String(row.attributes.find((a) => a.name === 'category')!.value),
                )) &&
              (!cursor || row.key > cursor),
          );
          return { data: data.slice(0, Number(options.limit)), blockNumber: '0x64' };
        }
        throw new Error('Unexpected catalog RPC ' + method);
      },
    },
    { retryCount: 0 },
  );
  const archive = new ArkivArchive(
    {
      accessKey: 'test-key',
      privateKey,
      encryptionKey,
      namespace: 'test',
      databasePath: join(directory, 'journal.sqlite'),
      maxTxFee: '0',
      dailyBudget: '0',
    },
    transport,
  );
  try {
    const entries = await archive.list();
    expect(entries).toHaveLength(103);
    expect(new Set(entries.map((e) => e.record.category))).toEqual(
      new Set(['draft', 'community', 'campaign', 'run']),
    );
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query).toContain("namespace = str('test')");
      expect(query.toLowerCase()).toContain(account.address.toLowerCase());
      expect(query).toContain(
        "(category = str('draft') OR category = str('community') OR category = str('campaign') OR category = str('run'))",
      );
    }
    expect(queries[1]).toContain(rows[102].key);
    rows[3].creationFlags = 0;
    await expect(archive.list()).rejects.toThrow('Untrusted');
    rows[3].creationFlags = 1;
    rows[3].creator = privateKeyToAccount(generatePrivateKey()).address;
    await expect(archive.list()).rejects.toThrow('Untrusted');
    rows[3].creator = account.address;
    rows[3].attributes.find((a) => a.name === 'ciphertext')!.value = '0x00';
    await expect(archive.list()).rejects.toThrow('authentication');
  } finally {
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const themeRecord: ThemePublication = {
  category: 'theme',
  id: 'modern-gray@1.0.0',
  revision: 1,
  themeId: 'modern-gray',
  version: '1.0.0',
  swarmReference: 'a'.repeat(64),
  manifestSha256: 'b'.repeat(64),
  releaseSha256: 'c'.repeat(64),
  updatedAt: 0,
};
it('journals public theme pointers, reconciles unknown broadcasts without resending and verifies readback', async () => {
  const f = writerFixture({ theme: themeRecord });
  try {
    await expect(f.archive.putTheme(themeRecord)).rejects.toThrow();
    expect(f.sends).toBe(1);
    f.receipt(true);
    const ref = await f.archive.putTheme(themeRecord);
    expect(f.sends).toBe(1);
    expect(await f.archive.readTheme(ref.entityKey)).toEqual(themeRecord);
    await expect(
      f.archive.putTheme({ ...themeRecord, swarmReference: 'd'.repeat(64) }),
    ).rejects.toThrow(/different content/);
    expect(f.sends).toBe(1);
  } finally {
    f.close();
  }
});
it('enforces the configured write budget for theme publication', async () => {
  const f = writerFixture({ theme: themeRecord, maxTxFee: '0' });
  try {
    await expect(f.archive.putTheme(themeRecord)).rejects.toThrow(/budget/);
    expect(f.sends).toBe(0);
  } finally {
    f.close();
  }
});

it('scopes the level catalog query to level categories when other feature records share the namespace', async () => {
  const f = writerFixture();
  try {
    expect(await f.archive.list()).toEqual([]);
    const query = JSON.stringify(f.queries.at(-1));
    for (const value of ['category', 'draft', 'community', 'campaign'])
      expect(query).toContain(value);
  } finally {
    f.close();
  }
});

it('encodes two-hour level creation in the real SDK native transaction', async () => {
  const f = writerFixture();
  try {
    f.receipt(true);
    await f.archive.put(record());
    const decoded = decodeFunctionData({
      abi: parseAbi(['function execute((uint8 operation, bytes operationData)[] ops)']),
      data: parseTransaction(f.raw).data!,
    });
    const [create] = decodeAbiParameters(
      parseAbiParameters(
        '(uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, (bytes32 name, uint8 typeId, bytes value)[] attributes)',
      ),
      decoded.args![0][0].operationData,
    );
    expect(create.minLifetime).toBe(3600n);
    expect(create.expiresAt).toBe(0n);
    expect(create.creationFlags).toBe(1);
  } finally {
    f.close();
  }
});
it('extends from the real expiry, reconciles lost replies and deduplicates each account', async () => {
  const f = writerFixture();
  try {
    f.receipt(true);
    const ref = await f.archive.put(record());
    f.receipt(false);
    await expect(f.archive.extend(ref, 'atlas')).rejects.toThrow('could not be confirmed');
    expect(f.sends).toBe(2);
    await expect(f.archive.extend(ref, 'nova')).rejects.toThrow();
    expect(f.sends).toBe(2);
    f.receipt(true);
    expect((await f.archive.extend(ref, 'atlas')).expiresAt).toBe('5500');
    expect(f.sends).toBe(2);
    expect((await f.archive.inspect(ref)).ref.expiresAt).toBe('5500');
    expect((await f.archive.put(record())).expiresAt).toBe('5500');
    expect(f.sends).toBe(2);
    expect((await f.archive.extend(ref, 'atlas')).expiresAt).toBe('5500');
    expect(f.sends).toBe(2);
    expect((await f.archive.extend(ref, 'nova')).expiresAt).toBe('7300');
    expect(f.sends).toBe(3);
    const decoded = decodeFunctionData({
      abi: parseAbi(['function execute((uint8 operation, bytes operationData)[] ops)']),
      data: parseTransaction(f.raw).data!,
    });
    const [extension] = decodeAbiParameters(
      parseAbiParameters('(bytes32 entityKey, uint64 expiresAt, uint64 minLifetime)'),
      decoded.args![0][0].operationData,
    );
    expect(extension.expiresAt).toBe(7300n);
    expect(extension.minLifetime).toBe(0n);
  } finally {
    f.close();
  }
});
it('preserves extension receipt confirmation after failed readback and never sends again', async () => {
  const f = writerFixture();
  try {
    f.receipt(true);
    const ref = await f.archive.put(record());
    const original = vi.mocked(f.reader.getEntity).getMockImplementation()!;
    let calls = 0;
    vi.mocked(f.reader.getEntity).mockImplementation(async (...args) => {
      if (++calls > 1) throw new Error('unavailable');
      return original(...args);
    });
    await expect(f.archive.extend(ref, 'atlas')).rejects.toThrow();
    expect(f.sends).toBe(2);
    vi.mocked(f.reader.getEntity).mockImplementation(original);
    expect((await f.archive.extend(ref, 'atlas')).expiresAt).toBe('5500');
    expect(f.sends).toBe(2);
  } finally {
    f.close();
  }
});
it('rejects expired hearts and fee-exceeding extensions without broadcasting', async () => {
  const f = writerFixture();
  try {
    f.receipt(true);
    const ref = await f.archive.put(record());
    vi.spyOn(f.reader, 'getBlockNumber').mockResolvedValue(3700n);
    await expect(f.archive.extend(ref, 'atlas')).rejects.toThrow('expired');
    expect(f.sends).toBe(1);
    vi.mocked(f.reader.getBlockNumber).mockResolvedValue(100n);
    vi.spyOn(f.reader, 'getBalance').mockResolvedValue(0n);
    await expect(f.archive.extend(ref, 'atlas')).rejects.toThrow('fee');
    expect(f.sends).toBe(1);
  } finally {
    f.close();
  }
});

it('refuses an extension beyond Arkiv maximum lifetime before broadcast', async () => {
  const f = writerFixture();
  try {
    f.receipt(true);
    const ref = await f.archive.put(record()),
      row = await f.reader.getEntity(ref.entityKey as Hex);
    vi.mocked(f.reader.getEntity).mockResolvedValue({ ...row, $expiresAt: 7_884_100n } as never);
    await expect(f.archive.extend(ref, 'atlas')).rejects.toThrow('estimate failed');
    expect(f.sends).toBe(1);
  } finally {
    f.close();
  }
});

it('encodes a fixed two-minute attempt deadline in its own schema and reconciles without another send', async () => {
  const matchId = '11111111-1111-4111-8111-111111111111',
    moves = [[], []];
  const transcriptHash = createHash('sha256')
    .update(canonicalJSON({ previous: '', moves, outcome: 'active', sequence: 1 }))
    .digest('hex');
  const input: ArchiveRecord = {
    ...record(),
    id: matchId + ':1',
    category: 'attempt',
    level: { ...record().level, solutionP1: [], solutionP2: [] },
    attempt: {
      matchId,
      levelKey: '0x' + 'cd'.repeat(32),
      sequence: 1,
      previousHash: '',
      transcriptHash,
      outcome: 'active',
      expiresAt: '160',
    },
  };
  const f = writerFixture({}, input);
  try {
    await expect(f.archive.put(input)).rejects.toThrow('could not be confirmed');
    expect(f.sends).toBe(1);
    f.receipt(true);
    const ref = await f.archive.put(input);
    expect(ref.schema).toBe('attempt');
    expect(ref.expiresAt).toBe('160');
    expect(f.sends).toBe(1);
    expect(f.reader.getEntity).toHaveBeenCalledWith(ref.entityKey, AttemptEntities);
    expect(await f.archive.read(ref)).toEqual(input);
    const decoded = decodeFunctionData({
      abi: parseAbi(['function execute((uint8 operation, bytes operationData)[] ops)']),
      data: parseTransaction(f.raw).data!,
    });
    const [create] = decodeAbiParameters(
      parseAbiParameters(
        '(uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, (bytes32 name, uint8 typeId, bytes value)[] attributes)',
      ),
      decoded.args![0][0].operationData,
    );
    expect(create.minLifetime).toBe(0n);
    expect(create.expiresAt).toBe(160n);
    expect(create.creationFlags).toBe(1);
    await expect(f.archive.retain(ref, '1000')).rejects.toThrow('winning');
    expect(f.sends).toBe(1);
  } finally {
    f.close();
  }
});

it('reconciles an expired attempt receipt without rebroadcasting or blocking later writes', async () => {
  const matchId = '11111111-1111-4111-8111-111111111111',
    moves = [[], []];
  const transcriptHash = createHash('sha256')
    .update(canonicalJSON({ previous: '', moves, outcome: 'active', sequence: 1 }))
    .digest('hex');
  const input: ArchiveRecord = {
    ...record(),
    id: matchId + ':1',
    category: 'attempt',
    level: { ...record().level, solutionP1: [], solutionP2: [] },
    attempt: {
      matchId,
      levelKey: '0x' + 'cd'.repeat(32),
      sequence: 1,
      previousHash: '',
      transcriptHash,
      outcome: 'active',
      expiresAt: '160',
    },
  };
  const f = writerFixture({}, input);
  try {
    await expect(f.archive.put(input)).rejects.toThrow('could not be confirmed');
    expect(f.sends).toBe(1);
    vi.spyOn(f.reader, 'getBlockNumber').mockResolvedValue(200n);
    f.receipt(true);
    await expect(f.archive.reconcilePending()).resolves.toBeUndefined();
    const db = new DatabaseSync(f.path);
    expect(db.prepare('SELECT phase FROM arkiv_writes').get()!.phase).toBe('expired');
    db.close();
    await expect(f.archive.put(input)).rejects.toThrow('expired');
    expect(f.sends).toBe(1);
    await expect(f.archive.reconcilePending()).resolves.toBeUndefined();
  } finally {
    f.close();
  }
});

it('bounds winning-attempt extensions by the parent level and deduplicates their signed transaction', async () => {
  const matchId = '11111111-1111-4111-8111-111111111111',
    level = record().level,
    moves = [level.solutionP1, level.solutionP2];
  const transcriptHash = createHash('sha256')
    .update(canonicalJSON({ previous: '', moves, outcome: 'won', sequence: 1 }))
    .digest('hex');
  const input: ArchiveRecord = {
    ...record(),
    id: matchId + ':1',
    category: 'attempt',
    level,
    attempt: {
      matchId,
      levelKey: '0x' + 'cd'.repeat(32),
      sequence: 1,
      previousHash: '',
      transcriptHash,
      outcome: 'won',
      expiresAt: '160',
    },
  };
  const f = writerFixture({}, input);
  try {
    f.receipt(true);
    const ref = await f.archive.put(input),
      inspect = f.archive.inspect.bind(f.archive);
    vi.spyOn(f.archive, 'inspect').mockImplementation(async (value) =>
      value.entityKey === input.attempt!.levelKey
        ? { record: record(), ref: { entityKey: value.entityKey, expiresAt: '2000', txHash: '' } }
        : inspect(value),
    );
    await expect(f.archive.retain(ref, '2500')).rejects.toThrow('cannot exceed');
    expect(f.sends).toBe(1);
    const extended = await f.archive.retain(ref, '1200');
    expect(extended.schema).toBe('attempt');
    expect(extended.expiresAt).toBe('1200');
    expect(f.sends).toBe(2);
    expect(await f.archive.retain(ref, '1200')).toEqual(extended);
    expect(f.sends).toBe(2);
  } finally {
    f.close();
  }
});
