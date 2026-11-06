import type { LevelConfig } from '../../src/core/types';
import { creationExpiration, HEART_EXTENSION } from './expiration';
export type LevelCategory = 'draft' | 'community' | 'campaign' | 'run' | 'attempt';
export interface ArchiveRecord {
  id: string;
  revision: number;
  category: LevelCategory;
  ownerId: string;
  ownerName: string;
  updatedAt: number;
  campaignSlot?: number;
  level: LevelConfig;
  lifetimeDays?: 2;
  attempt?: {
    matchId: string;
    levelKey: string;
    sequence: number;
    previousHash: string;
    transcriptHash: string;
    outcome: 'active' | 'lost' | 'won';
    expiresAt?: string;
  };
  run?: { levelKey: string; role: 1 | 2; mode: 'coop' | 'solo'; source: string };
  certification?: {
    proof: import('../../src/certification/model').CertificationProof;
    salt: `0x${string}`;
  };
}
export interface MoveRecord {
  id: string;
  revision: 1;
  category: 'move';
  ownerId: string;
  ownerName: string;
  updatedAt: number;
  lifetimeDays: 2;
  move: {
    levelKey: string;
    sessionId: string;
    turn: number;
    sequence: number;
    mode: 'coop' | 'solo';
    inputs: [import('../../src/core/types').Direction, import('../../src/core/types').Direction];
  };
}
export type ArchiveWrite = ArchiveRecord | MoveRecord;
export interface WriteStatus {
  state: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  entityKey?: string;
}
export interface ArchiveRef {
  schema?: 'attempt';
  entityKey: string;
  txHash: string;
  expiresAt: string;
}
export interface ArchivedMove {
  record: MoveRecord;
  ref: ArchiveRef;
}
export interface ArchivedLevel {
  record: ArchiveRecord;
  ref: ArchiveRef;
}
export interface LevelArchive {
  readonly mode: 'arkiv' | 'test' | 'unconfigured';
  list(): Promise<ArchivedLevel[]>;
  listAttempts?(): Promise<ArchivedLevel[]>;
  put(record: ArchiveWrite): Promise<ArchiveRef>;
  queryMoves(records: MoveRecord[]): Promise<ArchivedMove[]>;
  writeStatus?(record: ArchiveWrite): WriteStatus | undefined;
  read(ref: ArchiveRef): Promise<ArchiveRecord>;
  inspect(ref: ArchiveRef): Promise<ArchivedLevel>;
  extend(ref: ArchiveRef, accountId: string): Promise<ArchiveRef>;
  retain?(ref: ArchiveRef, expiresAt: string): Promise<ArchiveRef>;
  head?(): Promise<bigint>;
  close(): void;
}
export class ArchiveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Explicit deterministic test adapter; the application never selects it as a fallback. */
export class MemoryArchive implements LevelArchive {
  readonly mode = 'test';
  head?: () => Promise<bigint>;
  readonly entries = new Map<string, { record: ArchiveWrite; ref: ArchiveRef }>();
  private hearts = new Map<string, ArchiveRef>();
  async list() {
    const head = (await this.head?.()) ?? 0n;
    return structuredClone(
      [...this.entries.values()].filter(
        (entry): entry is ArchivedLevel =>
          entry.record.category !== 'attempt' &&
          entry.record.category !== 'move' &&
          BigInt(entry.ref.expiresAt) > head,
      ),
    );
  }
  async listAttempts() {
    const head = (await this.head?.()) ?? 0n;
    return structuredClone(
      [...this.entries.values()].filter(
        (entry): entry is ArchivedLevel =>
          entry.record.category === 'attempt' && BigInt(entry.ref.expiresAt) > head,
      ),
    );
  }

  async put(record: ArchiveWrite) {
    const key = `${record.category}:${record.id}:${record.revision}`;
    const existing = this.entries.get(key);
    if (existing) {
      if (JSON.stringify(existing.record) !== JSON.stringify(record))
        throw new ArchiveError(409, 'Archive revision conflict.');
      return existing.ref;
    }
    const expiration = creationExpiration(record);
    if (typeof expiration.expiresAt !== 'bigint')
      throw new Error('Memory archive requires a block deadline.');
    const relative = ((await this.head?.()) ?? 0n) + expiration.minLifetime;
    const ref: ArchiveRef = {
      ...(record.category === 'attempt' ? { schema: 'attempt' as const } : {}),
      entityKey:
        '0x' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
      txHash: 'test-only',
      expiresAt: (expiration.expiresAt > relative ? expiration.expiresAt : relative).toString(),
    };
    this.entries.set(key, structuredClone({ record, ref }));
    return ref;
  }
  async queryMoves(records: MoveRecord[]) {
    const ids = new Set(records.map((r) => r.id));
    const head = (await this.head?.()) ?? 0n;
    return structuredClone(
      [...this.entries.values()].filter(
        (e): e is ArchivedMove =>
          e.record.category === 'move' && ids.has(e.record.id) && BigInt(e.ref.expiresAt) > head,
      ),
    );
  }
  async inspect(ref: ArchiveRef) {
    const found = [...this.entries.values()].find((e) => e.ref.entityKey === ref.entityKey);
    if (!found || found.record.category === 'move')
      throw new ArchiveError(503, 'Archived level unavailable.');
    if (BigInt(found.ref.expiresAt) <= ((await this.head?.()) ?? 0n))
      throw new ArchiveError(410, 'This publication has expired.');
    return structuredClone(found) as ArchivedLevel;
  }
  async read(ref: ArchiveRef) {
    return (await this.inspect(ref)).record;
  }
  async extend(ref: ArchiveRef, accountId: string) {
    const operation = ref.entityKey + ':' + accountId,
      prior = this.hearts.get(operation);
    if (prior) return structuredClone(prior);
    const live = await this.inspect(ref);
    live.ref.expiresAt = (BigInt(live.ref.expiresAt) + HEART_EXTENSION.minLifetime).toString();
    const entry = [...this.entries.values()].find((e) => e.ref.entityKey === ref.entityKey)!;
    entry.ref = live.ref;
    this.hearts.set(operation, structuredClone(live.ref));
    return live.ref;
  }
  async retain(ref: ArchiveRef, expiresAt: string) {
    const live = await this.inspect(ref);
    if (live.record.category !== 'attempt' || live.record.attempt?.outcome !== 'won')
      throw new ArchiveError(400, 'Only verified winning attempts can be retained.');
    if (BigInt(expiresAt) > BigInt(live.ref.expiresAt)) {
      const entry = [...this.entries.values()].find((e) => e.ref.entityKey === ref.entityKey)!;
      entry.ref.expiresAt = expiresAt;
      return structuredClone(entry.ref);
    }
    return live.ref;
  }
  close() {}
}
export class UnconfiguredArchive implements LevelArchive {
  readonly mode = 'unconfigured';

  private fail(): never {
    throw new ArchiveError(
      503,
      'Arkiv storage is not configured. Complete npm run arkiv:setup and configure write budgets.',
    );
  }

  async list(): Promise<ArchivedLevel[]> {
    return [];
  }
  async queryMoves(): Promise<ArchivedMove[]> {
    return this.fail();
  }
  async put(): Promise<ArchiveRef> {
    return this.fail();
  }

  async read(): Promise<ArchiveRecord> {
    return this.fail();
  }
  async inspect(): Promise<ArchivedLevel> {
    return this.fail();
  }
  async extend(): Promise<ArchiveRef> {
    return this.fail();
  }
  close() {}
}
