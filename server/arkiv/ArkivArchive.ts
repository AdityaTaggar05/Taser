import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  chmodSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  ENTITY_EVENTS_ABI,
  type TxParams,
  type WalletArkivClient,
} from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { asc, eq, and, or, gt } from '@arkiv-network/sdk/query';
import { key, u64 } from '@arkiv-network/sdk/schema';
import {
  custom,
  http,
  hexToBytes,
  bytesToHex,
  keccak256,
  parseEther,
  parseTransaction,
  recoverTransactionAddress,
  decodeEventLog,
  MethodNotFoundRpcError,
  type Hex,
  type LocalAccount,
  type TransactionSerialized,
  type Transport,
} from 'viem';
import { getGasPrice } from 'viem/actions';
import { privateKeyToAccount } from 'viem/accounts';
import { LevelEntities } from './schema';
import { LevelCipher, CONTENT_TYPE } from './LevelCipher';
import {
  ArchiveError,
  type LevelArchive,
  type ArchiveRecord,
  type ArchiveWrite,
  type WriteStatus,
  type ArchiveRef,
  type ArchivedLevel,
  type MoveRecord,
  type ArchivedMove,
} from './archive';
import { canonicalJSON } from './canonical';
import {
  ThemeEntities,
  decodeThemePublication,
  validateThemePublication,
  type ThemePublication,
} from './ThemePublication';
type Publication = ArchiveWrite | ThemePublication;
import { creationExpiration, HEART_EXTENSION } from './expiration';

interface ExtensionIntent {
  entityKey: Hex;
  expiresAt: string;
}
const isExtension = (plan: Plan) => plan.operation.startsWith('heart:');
const NATIVE = '0x4400000000000000000000000000000000000044';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
interface Plan {
  operation: string;
  input_hash: string;
  body: string;
  salt: string;
  ciphertext: string;
  phase: 'prepared' | 'submitting' | 'receipt_confirmed' | 'verified' | 'reverted';
  signed: string | null;
  tx_hash: string | null;
  entity_key: string | null;
  expires_at: string | null;
  nonce: number | null;
  calldata: string | null;
  gas: string | null;
  gas_price: string | null;
  maximum_cost: string | null;
  day: string | null;
  genesis: string;
}
export interface ArkivOptions {
  accessKey: string;
  privateKey: Hex;
  encryptionKey: string;
  namespace: string;
  databasePath: string;
  maxTxFee: string;
  dailyBudget: string;
}
/** One dedicated signer, one host/process, durable pre-send journal, no automatic resends. */
export class ArkivArchive implements LevelArchive {
  readonly mode = 'arkiv';
  readonly signer: string;
  private account: LocalAccount;
  private chain;
  private rpc;
  private reader;
  private cipher: LevelCipher;
  private db: DatabaseSync;
  private lockPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private maxTxFee: bigint;
  private dailyBudget: bigint;

  constructor(
    private options: ArkivOptions,
    transport?: Transport,
  ) {
    if (!options.accessKey.trim() || !/^[-a-zA-Z0-9_]{1,64}$/.test(options.namespace))
      throw new ArchiveError(503, 'Invalid Arkiv server configuration.');
    this.account = privateKeyToAccount(options.privateKey);
    this.signer = this.account.address;
    this.chain = rabdi({ accessKey: options.accessKey });
    this.rpc = (
      transport ??
      http(undefined, {
        retryCount: 0,
        timeout: 15_000,
        fetchOptions: { cache: 'no-store', redirect: 'error' },
      })
    )({ chain: this.chain });
    this.reader = createPublicClient({
      chain: this.chain,
      cacheTime: 0,
      transport: custom(this.rpc, { retryCount: 0 }),
    });
    this.cipher = new LevelCipher(options.encryptionKey, options.namespace);
    this.maxTxFee = parseEther(options.maxTxFee);
    this.dailyBudget = parseEther(options.dailyBudget);
    // The application's existing deployment boundary is one Node server on one host.
    const directory = resolve('.data');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.lockPath = resolve(directory, `arkiv-${this.signer.toLowerCase()}.lock`);
    try {
      const pid = Number(readFileSync(this.lockPath, 'utf8'));
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (!alive) unlinkSync(this.lockPath);
    } catch {
      /* Absent or unreadable locks are handled by exclusive creation. */
    }
    try {
      const fd = openSync(this.lockPath, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
    } catch {
      throw new ArchiveError(
        503,
        'Another server holds this Arkiv signer. Stop it before starting this instance.',
      );
    }
    try {
      mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(options.databasePath);
      this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS arkiv_identity(name TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS arkiv_writes(operation TEXT PRIMARY KEY,input_hash TEXT NOT NULL,body TEXT NOT NULL,salt TEXT NOT NULL,ciphertext TEXT NOT NULL,phase TEXT NOT NULL,signed TEXT,tx_hash TEXT,entity_key TEXT,expires_at TEXT,nonce INTEGER,calldata TEXT,gas TEXT,gas_price TEXT,maximum_cost TEXT,day TEXT,genesis TEXT NOT NULL);`);
      chmodSync(options.databasePath, 0o600);
      const fingerprint = hash(options.encryptionKey.toLowerCase()),
        identity = `${this.signer.toLowerCase()}:${options.namespace}:${fingerprint}`;
      const prior = this.db
        .prepare("SELECT value FROM arkiv_identity WHERE name='configuration'")
        .get();
      if (prior && prior.value !== identity)
        throw new ArchiveError(
          503,
          'Arkiv signer, namespace or encryption key changed. Restore the original configuration or use a separate archive journal.',
        );
      this.db
        .prepare("INSERT OR IGNORE INTO arkiv_identity VALUES('configuration',?)")
        .run(identity);
    } catch (error) {
      unlinkSync(this.lockPath);
      throw error;
    }
  }

  private plan(operation: string) {
    return this.db
      .prepare('SELECT * FROM arkiv_writes WHERE operation=?')
      .get(operation) as unknown as Plan | undefined;
  }

  private async identity() {
    if ((await this.reader.getChainId()) !== 7794095)
      throw new ArchiveError(503, 'Arkiv RPC returned the wrong chain.');
    const genesis = (await this.reader.getBlock({ blockNumber: 0n })).hash;
    if (!genesis) throw new Error();
    const prior = this.db.prepare("SELECT value FROM arkiv_identity WHERE name='genesis'").get();
    if (prior && prior.value !== genesis)
      throw new ArchiveError(
        503,
        'Arkiv network reset detected. Reconcile the archive before reseeding.',
      );
    this.db.prepare("INSERT OR IGNORE INTO arkiv_identity VALUES('genesis',?)").run(genesis);
    return genesis;
  }

  private values(plan: Plan) {
    const r = JSON.parse(plan.body) as ArchiveWrite;
    return {
      namespace: this.options.namespace,
      record_id: r.id,
      revision: u64(r.revision),
      category: r.category,
      content_type: CONTENT_TYPE,
      ciphertext: hexToBytes(plan.ciphertext as Hex),
    };
  }
  private themeValues(plan: Plan) {
    const r = validateThemePublication(JSON.parse(plan.body));
    return {
      namespace: this.options.namespace,
      theme_id: r.themeId,
      version: r.version,
      swarm_reference: r.swarmReference,
      manifest_sha256: r.manifestSha256,
      release_sha256: r.releaseSha256,
      content_type: 'application/json',
      payload: hexToBytes(plan.ciphertext as Hex),
    };
  }
  private createPublication(
    wallet: Pick<ReturnType<typeof createWalletClient>, 'createEntity'>,
    plan: Plan,
    params?: TxParams,
  ) {
    return plan.operation.startsWith('theme:')
      ? wallet.createEntity(ThemeEntities, this.themeValues(plan), this.optionsFor(plan), params)
      : wallet.createEntity(LevelEntities, this.values(plan), this.optionsFor(plan), params);
  }
  async readTheme(entityKey: string) {
    await this.identity();
    const row = await this.reader.getEntity(entityKey as Hex, ThemeEntities);
    return decodeThemePublication(row, this.signer, this.options.namespace, entityKey);
  }
  putTheme(record: ThemePublication): Promise<ArchiveRef> {
    validateThemePublication(record);
    const task = this.queue.then(() => this.write(record));
    this.queue = task.catch(() => {});
    return task;
  }
  private optionsFor(plan: Plan) {
    const record = JSON.parse(plan.body) as ArchiveWrite;
    return {
      expiration: creationExpiration(record),
      flags: { readonly: true, permissionlessExtension: false },
      salt: BigInt(plan.salt),
    };
  }

  private trusted(row: Awaited<ReturnType<typeof this.entity>>, expected?: Plan) {
    if (
      row.$owner.toLowerCase() !== this.signer.toLowerCase() ||
      row.$creator.toLowerCase() !== this.signer.toLowerCase() ||
      !row.$creationFlags.readonly ||
      row.$creationFlags.permissionlessExtension ||
      row.namespace.value !== this.options.namespace ||
      row.content_type.value !== CONTENT_TYPE ||
      !['draft', 'community', 'campaign', 'run', 'move'].includes(row.category.value) ||
      row.revision.value < 1n ||
      row.revision.value > BigInt(Number.MAX_SAFE_INTEGER) ||
      (expected && row.ciphertext.value.toLowerCase() !== expected.ciphertext.toLowerCase())
    )
      throw new ArchiveError(503, 'Untrusted Arkiv level publication.');
  }

  private async entity(entityKey: string) {
    const row = await this.reader.getEntity(entityKey as Hex, LevelEntities);
    if (row.$key.toLowerCase() !== entityKey.toLowerCase())
      throw new ArchiveError(503, 'Arkiv returned a different entity identity.');
    return row;
  }

  private async decode(row: Awaited<ReturnType<typeof this.entity>>) {
    this.trusted(row);
    return this.cipher.decrypt(hexToBytes(row.ciphertext.value), {
      id: row.record_id.value,
      revision: Number(row.revision.value),
      category: row.category.value,
    });
  }

  async head() {
    try {
      await this.identity();
      return await this.reader.getBlockNumber({ cacheTime: 0 });
    } catch (error) {
      throw this.safe(error, 'Arkiv availability could not be checked.');
    }
  }

  async read(ref: ArchiveRef): Promise<ArchiveRecord> {
    try {
      await this.identity();
      const record = await this.decode(await this.entity(ref.entityKey));
      if (record.category === 'move') throw new ArchiveError(404, 'Not a level publication.');
      return record;
    } catch (error) {
      throw this.safe(error, 'Arkiv level could not be read. It may be expired or unavailable.');
    }
  }
  async inspect(ref: ArchiveRef): Promise<ArchivedLevel> {
    try {
      await this.identity();
      const row = await this.entity(ref.entityKey),
        record = await this.decode(row);
      if (record.category === 'move') throw new ArchiveError(404, 'Not a level publication.');
      if (row.$expiresAt <= (await this.reader.getBlockNumber({ cacheTime: 0 })))
        throw new ArchiveError(410, 'This publication has expired.');
      return { record, ref: { ...ref, expiresAt: row.$expiresAt.toString() } };
    } catch (error) {
      throw this.safe(
        error,
        'Arkiv publication could not be checked. It may be expired or unavailable.',
      );
    }
  }
  extend(ref: ArchiveRef, accountId: string): Promise<ArchiveRef> {
    const task = this.queue.then(async () => {
      try {
        const operation = `heart:${ref.entityKey.toLowerCase()}:${hash(accountId)}`;
        let plan = this.plan(operation);
        if (!plan) {
          await this.reconcilePending();
          const waiting = this.db
            .prepare(
              "SELECT body FROM arkiv_writes WHERE operation LIKE 'heart:%' AND phase='prepared'",
            )
            .all();
          if (
            waiting.some(
              (row) =>
                (JSON.parse(String(row.body)) as ExtensionIntent).entityKey.toLowerCase() ===
                ref.entityKey.toLowerCase(),
            )
          )
            throw new ArchiveError(
              503,
              'An earlier heart for this publication is awaiting confirmation. Retry shortly.',
            );
          const live = await this.inspect(ref);
          if (!['community', 'campaign'].includes(live.record.category))
            throw new ArchiveError(400, 'Only published levels can receive hearts.');
          const body = JSON.stringify({
            entityKey: ref.entityKey as Hex,
            expiresAt: (BigInt(live.ref.expiresAt) + HEART_EXTENSION.minLifetime).toString(),
          } satisfies ExtensionIntent);
          const genesis = await this.identity();
          this.db
            .prepare(
              "INSERT INTO arkiv_writes(operation,input_hash,body,salt,ciphertext,phase,genesis) VALUES(?,?,?,'0','','prepared',?)",
            )
            .run(operation, hash(body), body, genesis);
          plan = this.plan(operation)!;
        }
        // Verified operation IDs are permanent even if a later read becomes unavailable.
        if (plan.phase === 'verified')
          return {
            entityKey: plan.entity_key!,
            txHash: plan.tx_hash!,
            expiresAt: plan.expires_at!,
          };
        if (plan.phase !== 'prepared') return await this.reconcile(plan);
        await this.reconcilePending();
        return await this.submit(plan);
      } catch (error) {
        throw this.safe(
          error,
          'Arkiv heart could not be confirmed. Retry this same heart to reconcile it.',
        );
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private invoke(wallet: WalletArkivClient, plan: Plan, params?: TxParams) {
    if (isExtension(plan)) {
      const intent = JSON.parse(plan.body) as ExtensionIntent;
      return wallet.extendEntity(
        {
          entityKey: intent.entityKey,
          expiration: ExpirationTime.atBlock(BigInt(intent.expiresAt)),
        },
        params,
      );
    }
    return this.createPublication(wallet, plan, params);
  }
  async list(): Promise<ArchivedLevel[]> {
    try {
      await this.identity();
      const found: ArchivedLevel[] = [];
      let last: Hex | undefined;
      const scope = and(
        eq('namespace', this.options.namespace),
        or(
          eq('category', 'draft'),
          eq('category', 'community'),
          eq('category', 'campaign'),
          eq('category', 'run'),
        ),
      );
      // Limit discovery to the level and replay categories this release understands.
      // Bounded current-state traversal, not a historical snapshot. Fail on incomplete scans.
      for (let page = 0; page < 100; page++) {
        const query = this.reader
          .select('*')
          .from(LevelEntities, { onMismatch: 'throw' })
          .createdBy(this.account.address)
          .where(last ? and(scope, gt('$key', key(last))) : scope)
          .orderBy(asc('$key'))
          .limit(100);
        const result = await query.fetch();
        for (const row of result.entities) {
          const record = await this.decode(row);
          if (record.category === 'move') continue;
          const plan = this.plan(`${record.category}:${record.id}:${record.revision}`);
          found.push({
            record,
            ref: {
              entityKey: row.$key,
              expiresAt: row.$expiresAt.toString(),
              txHash:
                plan?.phase === 'verified' &&
                plan.entity_key?.toLowerCase() === row.$key.toLowerCase()
                  ? (plan.tx_hash ?? '')
                  : '',
            },
          });
        }
        if (result.entities.length < 100) return found;
        const next = result.entities.at(-1)!.$key;
        if (last && next <= last) throw new Error();
        last = next;
      }
      throw new ArchiveError(
        503,
        'Arkiv archive exceeds the current scan budget. No partial catalog was loaded.',
      );
    } catch (error) {
      throw this.safe(error, 'Arkiv catalog query failed.');
    }
  }
  async queryMoves(records: MoveRecord[]): Promise<ArchivedMove[]> {
    if (!records.length) return [];
    if (records.length > 32) throw new ArchiveError(400, 'Too many moves requested.');
    try {
      await this.identity();
      const result = await this.reader
        .select('*')
        .from(LevelEntities, { onMismatch: 'throw' })
        .createdBy(this.account.address)
        .where(
          and(
            eq('namespace', this.options.namespace),
            eq('category', 'move'),
            or(...records.map((record) => eq('record_id', record.id))),
          ),
        )
        .limit(100)
        .fetch();
      const seen = new Set<string>(),
        found: ArchivedMove[] = [];
      for (const row of result.entities) {
        const record = await this.decode(row);
        if (
          record.category !== 'move' ||
          seen.has(record.id) ||
          !records.some((expected) => canonicalJSON(expected) === canonicalJSON(record))
        )
          throw new ArchiveError(503, 'Move query returned inconsistent evidence.');
        seen.add(record.id);
        found.push({
          record,
          ref: { entityKey: row.$key, txHash: '', expiresAt: row.$expiresAt.toString() },
        });
      }
      return found;
    } catch (error) {
      throw this.safe(error, 'Arkiv move query unavailable. Please retry.');
    }
  }
  writeStatus(record: ArchiveWrite): WriteStatus | undefined {
    const p = this.plan(`${record.category}:${record.id}:${record.revision}`);
    if (!p) return;
    return {
      state: p.phase === 'verified' ? 'confirmed' : p.phase === 'reverted' ? 'failed' : 'pending',
      ...(p.tx_hash ? { txHash: p.tx_hash } : {}),
      ...(p.phase === 'verified' && p.entity_key ? { entityKey: p.entity_key } : {}),
    };
  }
  put(record: ArchiveWrite): Promise<ArchiveRef> {
    const task = this.queue.then(() => this.write(record));
    this.queue = task.catch(() => {});
    return task;
  }
  private async prepare(record: Publication): Promise<Plan> {
    const operation = `${record.category}:${record.id}:${record.revision}`,
      body = JSON.stringify(record),
      existing = this.plan(operation);
    if (existing) {
      if (canonicalJSON(JSON.parse(existing.body)) !== canonicalJSON(record))
        throw new ArchiveError(409, 'This archive revision already has different content.');
      return existing;
    }
    const genesis = await this.identity();
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM arkiv_writes').get()!;
    if (Number(count.n) >= 1_000_000)
      throw new ArchiveError(
        503,
        'Archive encryption key rotation is required before more writes.',
      );
    const ciphertext =
      record.category === 'theme'
        ? bytesToHex(new TextEncoder().encode(JSON.stringify(validateThemePublication(record))))
        : bytesToHex(await this.cipher.encrypt(record));
    // Level bodies remain encrypted; theme publications contain only reviewed public asset pointers.
    this.db
      .prepare(
        "INSERT INTO arkiv_writes(operation,input_hash,body,salt,ciphertext,phase,genesis) VALUES(?,?,?,?,?,'prepared',?)",
      )
      .run(
        operation,
        hash(body),
        body,
        BigInt('0x' + randomBytes(16).toString('hex')).toString(),
        ciphertext,
        genesis,
      );
    return this.plan(operation)!;
  }

  /** Capture exact SDK calldata and estimate, with both signing and mutating RPC disabled. */
  private async estimate(plan: Plan) {
    let estimate = 0n,
      calldata: Hex | undefined;
    const stop = new Error('captured');
    const allowed = new Set([
      'eth_chainId',
      'eth_blockNumber',
      'eth_getBlockByNumber',
      'eth_getTransactionCount',
      'eth_gasPrice',
      'eth_maxPriorityFeePerGas',
      'eth_estimateGas',
    ]);
    const rpc = this.rpc;
    const transport = custom(
      {
        async request(args) {
          if (args.method === 'eth_fillTransaction')
            throw new MethodNotFoundRpcError(new Error('Use estimate'));
          if (!allowed.has(args.method)) throw new Error('Blocked');
          if (args.method === 'eth_estimateGas') {
            const tx = (args.params as readonly Record<string, unknown>[])[0];
            calldata = tx.data as Hex;
            estimate = BigInt(
              (await rpc.request({
                method: 'eth_estimateGas',
                params: [tx as never, 'latest'],
              })) as string,
            );
            throw stop;
          }
          return rpc.request(args as never);
        },
      },
      { retryCount: 0 },
    );
    const unsigned = {
      ...this.account,
      signTransaction: async () => {
        throw new Error('Signing blocked');
      },
    } as LocalAccount;
    const wallet = createWalletClient({ account: unsigned, chain: this.chain, transport });
    try {
      await this.invoke(wallet, plan);
    } catch (error) {
      let cause: unknown = error;
      for (let depth = 0; cause && depth < 30; depth++) {
        if (cause === stop && estimate > 0n && calldata) return { estimate, calldata };
        cause = typeof cause === 'object' ? (cause as { cause?: unknown }).cause : undefined;
      }
    }
    throw new ArchiveError(
      503,
      'Unsigned Arkiv preparation or gas estimate failed. No transaction was sent.',
    );
  }
  async quote(record: Publication) {
    const plan = await this.prepare(record),
      { estimate } = await this.estimate(plan),
      gas = estimate * 2n > 1_000_000n ? estimate * 2n : 1_000_000n,
      gasPrice = await getGasPrice(this.reader);
    return { gas: gas.toString(), maximumFeeWei: (gas * gasPrice).toString(), signer: this.signer };
  }
  private async findPrior(
    record: Publication,
  ): Promise<Array<{ record: Publication; ref: ArchiveRef }>> {
    if (record.category === 'theme') {
      const prior = await this.reader
        .select('*')
        .from(ThemeEntities, { onMismatch: 'throw' })
        .createdBy(this.account.address)
        .where(
          and(
            eq('namespace', this.options.namespace),
            eq('theme_id', record.themeId),
            eq('version', record.version),
          ),
        )
        .limit(2)
        .fetch();
      return prior.entities.map((row) => ({
        record: decodeThemePublication(row, this.signer, this.options.namespace, row.$key),
        ref: { entityKey: row.$key, txHash: '', expiresAt: row.$expiresAt.toString() },
      }));
    }
    const prior = await this.reader
      .select('*')
      .from(LevelEntities, { onMismatch: 'throw' })
      .createdBy(this.account.address)
      .where(
        and(
          eq('namespace', this.options.namespace),
          eq('record_id', record.id),
          eq('revision', u64(record.revision)),
          eq('category', record.category),
        ),
      )
      .limit(2)
      .fetch();
    return Promise.all(
      prior.entities.map(async (row) => ({
        record: await this.decode(row),
        ref: { entityKey: row.$key, txHash: '', expiresAt: row.$expiresAt.toString() },
      })),
    );
  }
  private async write(record: Publication): Promise<ArchiveRef> {
    try {
      await this.identity();
      let plan = await this.prepare(record);
      if (plan.phase !== 'prepared') return await this.reconcile(plan);
      await this.reconcilePending();
      const prior = await this.findPrior(record);
      if (prior.length > 1)
        throw new ArchiveError(409, 'Duplicate archive revisions require reconciliation.');
      if (prior.length === 1) {
        if (canonicalJSON(prior[0].record) !== canonicalJSON(record))
          throw new ArchiveError(409, 'The remote archive revision has different content.');
        return prior[0].ref;
      }
      return await this.submit(plan);
    } catch (error) {
      throw this.safe(
        error,
        'Arkiv write could not be confirmed. Check the durable journal; do not submit another copy.',
      );
    }
  }
  private async submit(plan: Plan): Promise<ArchiveRef> {
    const blocked = this.db
      .prepare(
        "SELECT operation FROM arkiv_writes WHERE phase IN ('submitting','receipt_confirmed','reverted') AND operation!=? LIMIT 1",
      )
      .get(plan.operation);
    if (blocked)
      throw new ArchiveError(
        503,
        'An earlier Arkiv write needs reconciliation. New writes are paused.',
      );
    const { estimate, calldata } = await this.estimate(plan),
      gas = estimate * 2n > 1_000_000n ? estimate * 2n : 1_000_000n;
    const block = await this.reader.getBlock({ blockTag: 'latest' }),
      gasPrice = await getGasPrice(this.reader);
    const nonce = await this.reader.getTransactionCount({
      address: this.account.address,
      blockTag: 'latest',
    });
    if (
      (await this.reader.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending',
      })) !== nonce
    )
      throw new ArchiveError(503, 'The Arkiv signer has an unresolved pending transaction.');
    const maximumCost = gas * gasPrice,
      day = new Date().toISOString().slice(0, 10);
    const reserved = this.db
      .prepare('SELECT maximum_cost FROM arkiv_writes WHERE day=? AND maximum_cost IS NOT NULL')
      .all(day)
      .reduce((n, r) => n + BigInt(String(r.maximum_cost)), 0n);
    if (
      gas > block.gasLimit / 2n ||
      this.maxTxFee <= 0n ||
      this.dailyBudget <= 0n ||
      maximumCost > this.maxTxFee ||
      reserved + maximumCost > this.dailyBudget ||
      maximumCost >
        (await this.reader.getBalance({ address: this.account.address, blockTag: 'latest' }))
    )
      throw new ArchiveError(
        503,
        'Arkiv fee estimate exceeds the configured fee budget, signer balance or block gas limit. No transaction was sent.',
      );
    this.db
      .prepare(
        'UPDATE arkiv_writes SET nonce=?,calldata=?,gas=?,gas_price=?,maximum_cost=?,day=? WHERE operation=?',
      )
      .run(
        nonce,
        calldata,
        gas.toString(),
        gasPrice.toString(),
        maximumCost.toString(),
        day,
        plan.operation,
      );
    plan = this.plan(plan.operation)!;
    const rpc = this.rpc,
      archive = this;
    const wallet = createWalletClient({
      account: this.account,
      chain: this.chain,
      cacheTime: 0,
      transport: custom(
        {
          async request(args) {
            if (args.method === 'eth_sendRawTransaction') {
              const raw = (args.params as readonly TransactionSerialized[])[0],
                tx = parseTransaction(raw),
                from = await recoverTransactionAddress({ serializedTransaction: raw });
              if (
                from.toLowerCase() !== archive.signer.toLowerCase() ||
                tx.chainId !== 7794095 ||
                tx.nonce !== nonce ||
                tx.to?.toLowerCase() !== NATIVE.toLowerCase() ||
                tx.data !== calldata ||
                tx.gas !== gas ||
                tx.gasPrice !== gasPrice ||
                (tx.value ?? 0n) !== 0n ||
                archive.plan(plan.operation)?.phase !== 'prepared'
              )
                throw new Error('Signed intent mismatch');
              const txHash = keccak256(raw);
              archive.db
                .prepare(
                  "UPDATE arkiv_writes SET phase='submitting',signed=?,tx_hash=? WHERE operation=? AND phase='prepared'",
                )
                .run(raw, txHash, plan.operation);
              // synchronous=FULL checkpoint precedes the first and only forwarding attempt.
              return rpc.request(args as never);
            }
            if (
              args.method.startsWith('eth_send') ||
              args.method.startsWith('wallet_') ||
              args.method.startsWith('personal_')
            )
              throw new Error('Unexpected write');
            return rpc.request(args as never);
          },
        },
        { retryCount: 0 },
      ),
    });
    const params: TxParams = { nonce, gas, gasPrice };
    try {
      await this.invoke(wallet, plan, params);
    } catch {
      // An unknown response is not a failed write. Reconcile the original saved hash only.
      if (!this.plan(plan.operation)?.tx_hash)
        throw new ArchiveError(
          503,
          'Arkiv signing failed before broadcast. No transaction was sent.',
        );
    }
    return await this.reconcile(this.plan(plan.operation)!);
  }
  private async reconcile(plan: Plan): Promise<ArchiveRef> {
    if (!plan.tx_hash || !plan.signed || !plan.calldata || plan.nonce === null)
      throw new ArchiveError(503, 'Arkiv write requires operator reconciliation.');
    const txHash = plan.tx_hash as Hex,
      raw = plan.signed as TransactionSerialized;
    if (
      keccak256(raw) !== txHash ||
      (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() !==
        this.signer.toLowerCase()
    )
      throw new Error();
    const receipt = await this.reader.getTransactionReceipt({ hash: txHash }),
      tx = await this.reader.getTransaction({ hash: txHash });
    const signed = parseTransaction(raw),
      canonical = await this.reader.getBlock({ blockNumber: receipt.blockNumber });
    if (
      canonical.hash !== receipt.blockHash ||
      tx.hash !== txHash ||
      tx.from.toLowerCase() !== this.signer.toLowerCase() ||
      tx.to?.toLowerCase() !== NATIVE.toLowerCase() ||
      tx.input !== plan.calldata ||
      tx.nonce !== plan.nonce ||
      tx.gas !== BigInt(plan.gas!) ||
      tx.gasPrice !== BigInt(plan.gas_price!) ||
      signed.data !== tx.input ||
      signed.nonce !== tx.nonce ||
      signed.chainId !== 7794095
    )
      throw new Error();
    if (receipt.status !== 'success') {
      this.db
        .prepare("UPDATE arkiv_writes SET phase='reverted' WHERE operation=?")
        .run(plan.operation);
      throw new ArchiveError(
        503,
        'Arkiv transaction reverted. Automatic retries are disabled; reconcile it before further writes.',
      );
    }
    const events = receipt.logs
      .filter((log) => log.address.toLowerCase() === NATIVE.toLowerCase())
      .flatMap((log) => {
        try {
          const event = decodeEventLog({
            abi: ENTITY_EVENTS_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (event.eventName !== 'EntityCreated' && event.eventName !== 'ExpiryExtended')
            return [];
          return (
            isExtension(plan)
              ? event.eventName === 'ExpiryExtended'
              : event.eventName === 'EntityCreated'
          )
            ? [event.args]
            : [];
        } catch {
          return [];
        }
      });
    if (events.length !== 1 || events[0].owner.toLowerCase() !== this.signer.toLowerCase())
      throw new Error();
    if (isExtension(plan)) {
      const intent = JSON.parse(plan.body) as ExtensionIntent;
      if (
        events[0].entityKey.toLowerCase() !== intent.entityKey.toLowerCase() ||
        events[0].expiresAt !== BigInt(intent.expiresAt)
      )
        throw new Error();
    }
    const ref = {
      entityKey: events[0].entityKey,
      txHash,
      expiresAt: events[0].expiresAt.toString(),
    };
    this.db
      .prepare(
        "UPDATE arkiv_writes SET phase='receipt_confirmed',entity_key=?,expires_at=? WHERE operation=?",
      )
      .run(ref.entityKey, ref.expiresAt, plan.operation);
    let observedExpiry: bigint;
    if (plan.operation.startsWith('theme:')) {
      const entity = await this.reader.getEntity(ref.entityKey, ThemeEntities),
        record = decodeThemePublication(entity, this.signer, this.options.namespace, ref.entityKey);
      observedExpiry = entity.$expiresAt;
      if (
        entity.$expiresAt < BigInt(ref.expiresAt) ||
        entity.payload.value.toLowerCase() !== plan.ciphertext.toLowerCase() ||
        canonicalJSON(record) !== canonicalJSON(JSON.parse(plan.body))
      )
        throw new Error();
    } else {
      const entity = await this.entity(ref.entityKey);
      observedExpiry = entity.$expiresAt;
      this.trusted(entity, isExtension(plan) ? undefined : plan);
      if (entity.$expiresAt < BigInt(ref.expiresAt)) throw new Error();
      const record = await this.decode(entity);
      if (!isExtension(plan) && canonicalJSON(record) !== canonicalJSON(JSON.parse(plan.body)))
        throw new Error();
    }
    this.db
      .prepare("UPDATE arkiv_writes SET phase='verified' WHERE operation=?")
      .run(plan.operation);
    return { ...ref, expiresAt: observedExpiry.toString() };
  }

  async reconcilePending() {
    for (const p of this.db
      .prepare("SELECT * FROM arkiv_writes WHERE phase IN ('submitting','receipt_confirmed')")
      .all() as unknown as Plan[])
      await this.reconcile(p);
  }

  private safe(error: unknown, fallback: string) {
    return error instanceof ArchiveError ? error : new ArchiveError(503, fallback);
  }

  close() {
    this.db.close();
    try {
      if (readFileSync(this.lockPath, 'utf8') === String(process.pid)) unlinkSync(this.lockPath);
    } catch {}
  }
}
