import { randomInt, randomUUID, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { LevelConfig, StepSnapshot, Direction } from '../../src/core/types';
import type {
  PublicMatch,
  PredictionLobby,
  PredictionOutcome,
  MarketStatus,
  WatchFrame,
} from '../../src/betting/types';
import {
  ArchiveError,
  type ArchiveRecord,
  type ArchiveRef,
  type LevelArchive,
} from '../arkiv/archive';
import type { PublishedSnapshot } from '../levels/LevelStore';
import { verifySolution } from '../../src/editor/solution';
import { canonicalJSON } from '../arkiv/canonical';
export class PredictionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
interface MatchRow {
  id: string;
  name: string;
  participants: string;
  names: string;
  snapshot: string;
  status: MarketStatus;
  created_at: number;
  deadline: number;
  sequence: number;
  last_hash: string;
  last_event: number;
  archive: string;
}
interface BetRow {
  account_id: string;
  outcome: PredictionOutcome;
  amount: number;
  payout: number | null;
}
export interface AttemptObservation {
  level: LevelConfig;
  state: StepSnapshot;
  moves: [Direction[], Direction[]];
  revision: number;
}
const DELAY = 10_000,
  LEASE = 120_000;
/** Persistent points ledger. Live sessions are deliberately voided/refunded after a restart. */
export class BettingService {
  private frames = new Map<string, WatchFrame[]>();
  private flushing: Promise<void> | null = null;
  private closed = false;
  private retentionCursor = 0;
  private archiveCursor = 0;
  constructor(
    private db: DatabaseSync,
    private archive: LevelArchive,
    private now = () => Date.now(),
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS prediction_wallets(account_id TEXT PRIMARY KEY,balance INTEGER NOT NULL CHECK(balance>=0));
      CREATE TABLE IF NOT EXISTS prediction_matches(id TEXT PRIMARY KEY,name TEXT NOT NULL,participants TEXT NOT NULL,names TEXT NOT NULL,snapshot TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,deadline INTEGER NOT NULL,sequence INTEGER NOT NULL DEFAULT 0,last_hash TEXT NOT NULL DEFAULT '',last_event INTEGER NOT NULL,archive TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS predictions(match_id TEXT NOT NULL,account_id TEXT NOT NULL,outcome TEXT NOT NULL,amount INTEGER NOT NULL,payout INTEGER,PRIMARY KEY(match_id,account_id));
      CREATE TABLE IF NOT EXISTS prediction_archive(id TEXT PRIMARY KEY,match_id TEXT NOT NULL,record TEXT NOT NULL,ref TEXT,phase TEXT NOT NULL DEFAULT 'pending');`);
    for (const row of this.db
      .prepare("SELECT id FROM prediction_matches WHERE status IN ('open','locked')")
      .all())
      this.settle(String(row.id), 'void');
  }
  private row(id: string) {
    return this.db.prepare('SELECT * FROM prediction_matches WHERE id=?').get(id) as unknown as
      MatchRow | undefined;
  }
  private atomic<T>(action: () => T) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  balance(account: string) {
    this.db.prepare('INSERT OR IGNORE INTO prediction_wallets VALUES(?,1000)').run(account);
    return Number(
      this.db.prepare('SELECT balance FROM prediction_wallets WHERE account_id=?').get(account)!
        .balance,
    );
  }
  create(
    snapshot: PublishedSnapshot,
    players: Array<{ id: string; name: string }>,
    observation: AttemptObservation,
  ) {
    if (!snapshot.ref || players.length !== 2 || players[0].id === players[1].id)
      throw new PredictionError(
        400,
        'A public match needs two different operators and a published level.',
      );
    const id = randomUUID(),
      now = this.now();
    this.db
      .prepare(
        "INSERT INTO prediction_matches(id,name,participants,names,snapshot,status,created_at,deadline,last_event) VALUES(?,?,?,?,?,'open',?,?,?)",
      )
      .run(
        id,
        snapshot.level.name,
        JSON.stringify(players.map((p) => p.id)),
        JSON.stringify(players.map((p) => p.name)),
        JSON.stringify(snapshot),
        now,
        now + LEASE,
        now,
      );
    this.record(id, observation, 'active');
    return id;
  }
  status(id: string) {
    return this.row(id)?.status;
  }
  lock(id: string) {
    const row = this.row(id);
    if (row?.status !== 'open' || this.now() >= row.deadline)
      throw new PredictionError(
        409,
        'This prediction window has ended. Reopen public broadcasting in the lobby.',
      );
    this.db
      .prepare("UPDATE prediction_matches SET status='locked',deadline=? WHERE id=?")
      .run(this.now() + 600_000, id);
  }
  predict(id: string, account: string, outcome: unknown, amount: unknown) {
    if (
      (outcome !== 'escape' && outcome !== 'fail') ||
      !Number.isSafeInteger(amount) ||
      Number(amount) < 10 ||
      Number(amount) > 100
    )
      throw new PredictionError(400, 'Choose Escape or Fail and stake 10–100 whole test points.');
    return this.atomic(() => {
      const row = this.row(id);
      if (!row || row.status !== 'open' || this.now() >= row.deadline)
        throw new PredictionError(409, 'Predictions are closed for this attempt.');
      if ((JSON.parse(row.participants) as string[]).includes(account))
        throw new PredictionError(403, 'Operators cannot predict their own match.');
      if (
        this.db
          .prepare('SELECT 1 FROM predictions WHERE match_id=? AND account_id=?')
          .get(id, account)
      )
        throw new PredictionError(409, 'You already predicted this attempt.');
      if (
        Number(
          this.db.prepare('SELECT COUNT(*) AS n FROM predictions WHERE match_id=?').get(id)!.n,
        ) >= 200
      )
        throw new PredictionError(409, 'This prediction pool is full.');
      if (this.balance(account) < Number(amount))
        throw new PredictionError(409, 'Not enough test points.');
      this.db
        .prepare('UPDATE prediction_wallets SET balance=balance-? WHERE account_id=?')
        .run(Number(amount), account);
      this.db
        .prepare('INSERT INTO predictions(match_id,account_id,outcome,amount) VALUES(?,?,?,?)')
        .run(id, account, outcome, Number(amount));
      return { balance: this.balance(account) };
    });
  }
  settle(id: string, result: 'escape' | 'fail' | 'void') {
    const row = this.row(id);
    if (!row || !['open', 'locked'].includes(row.status)) return;
    // A lobby closure is never an operator loss; spectators receive refunds.
    if (row.status === 'open') result = 'void';
    this.atomic(() => {
      const bets = this.db
        .prepare('SELECT * FROM predictions WHERE match_id=? ORDER BY account_id')
        .all(id) as unknown as BetRow[];
      const pool = bets.reduce((n, b) => n + b.amount, 0),
        winning = bets.filter((b) => b.outcome === result),
        total = winning.reduce((n, b) => n + b.amount, 0);
      // No winning side: refund everyone. Otherwise distribute the pool without minting points.
      const refund = result === 'void' || total === 0;
      let remainder = pool;
      const payouts = bets.map((b) => {
        const payout = refund
          ? b.amount
          : b.outcome === result
            ? Math.floor((pool * b.amount) / total)
            : 0;
        remainder -= payout;
        return { bet: b, payout };
      });
      if (!refund)
        for (const entry of payouts) {
          if (!remainder) break;
          if (entry.bet.outcome === result) {
            entry.payout++;
            remainder--;
          }
        }
      for (const { bet, payout } of payouts) {
        this.db
          .prepare('UPDATE prediction_wallets SET balance=balance+? WHERE account_id=?')
          .run(payout, bet.account_id);
        this.db
          .prepare('UPDATE predictions SET payout=? WHERE match_id=? AND account_id=?')
          .run(payout, id, bet.account_id);
      }
      this.db.prepare('UPDATE prediction_matches SET status=? WHERE id=?').run(result, id);
    });
  }
  record(id: string, observation: AttemptObservation, outcome: 'active' | 'lost' | 'won') {
    const row = this.row(id);
    if (!row) return;
    if (
      outcome === 'won' &&
      !verifySolution({
        ...observation.level,
        solutionP1: observation.moves[0],
        solutionP2: observation.moves[1],
      }).valid
    )
      throw new PredictionError(422, 'Winning transcript could not be verified.');
    const sequence = row.sequence + 1,
      now = this.now(),
      level = structuredClone(observation.level);
    level.solutionP1 = [...observation.moves[0]];
    level.solutionP2 = [...observation.moves[1]];
    const transcriptHash = createHash('sha256')
      .update(
        canonicalJSON({ previous: row.last_hash, moves: observation.moves, outcome, sequence }),
      )
      .digest('hex');
    const record: ArchiveRecord = {
      id: `${id}:${sequence}`,
      revision: 1,
      category: 'attempt',
      ownerId: 'public-match',
      ownerName: 'Public co-op',
      updatedAt: now,
      level,
      attempt: {
        matchId: id,
        levelKey: JSON.parse(row.snapshot).ref.entityKey,
        sequence,
        previousHash: row.last_hash,
        transcriptHash,
        outcome,
      },
    };
    this.atomic(() => {
      this.db
        .prepare('INSERT INTO prediction_archive(id,match_id,record) VALUES(?,?,?)')
        .run(record.id, id, JSON.stringify(record));
      this.db
        .prepare(
          "UPDATE prediction_matches SET sequence=?,last_hash=?,last_event=?,archive='pending' WHERE id=?",
        )
        .run(sequence, transcriptHash, now, id);
    });
    const visible = structuredClone(observation.level);
    visible.solutionP1 = [];
    visible.solutionP2 = [];
    visible.weldTargets = [];
    delete visible.midpointSwitchRequired;
    const frames = this.frames.get(id) ?? [];
    frames.push({ level: visible, state: structuredClone(observation.state), observedAt: now });
    this.frames.set(id, frames.slice(-128));
  }
  list(viewer: string): PredictionLobby {
    this.sweep();
    const rows = this.db
      .prepare('SELECT id FROM prediction_matches ORDER BY created_at DESC,id DESC LIMIT 30')
      .all();
    return {
      balance: this.balance(viewer),
      unit: 'test points',
      matches: rows.flatMap((row) => {
        const match = this.view(String(row.id), viewer);
        return match ? [match] : [];
      }),
    };
  }
  random(viewer: string) {
    const matches = this.list(viewer).matches.filter(
      (m) => m.status === 'open' || m.status === 'locked',
    );
    if (!matches.length)
      throw new PredictionError(
        404,
        'No public matches yet. Both operators can enable broadcasting in their party.',
      );
    return matches[randomInt(matches.length)];
  }
  view(id: string, viewer: string): PublicMatch | null {
    const row = this.row(id);
    if (!row) return null;
    if ((JSON.parse(row.participants) as string[]).includes(viewer)) return null;
    const bets = this.db
        .prepare('SELECT * FROM predictions WHERE match_id=?')
        .all(id) as unknown as BetRow[],
      own = bets.find((b) => b.account_id === viewer);
    const frame =
      [...(this.frames.get(id) ?? [])].reverse().find((f) => f.observedAt <= this.now() - DELAY) ??
      null;
    return {
      id,
      name: row.name,
      players: JSON.parse(row.names),
      status: row.status,
      createdAt: row.created_at,
      deadline: row.deadline,
      pool: {
        escape: bets.filter((b) => b.outcome === 'escape').reduce((n, b) => n + b.amount, 0),
        fail: bets.filter((b) => b.outcome === 'fail').reduce((n, b) => n + b.amount, 0),
      },
      prediction: own ? { outcome: own.outcome, amount: own.amount, payout: own.payout } : null,
      frame,
      delaySeconds: DELAY / 1000,
      archive: row.archive as PublicMatch['archive'],
    };
  }
  sweep() {
    for (const row of this.db
      .prepare(
        "SELECT id FROM prediction_matches WHERE status IN ('open','locked') AND deadline<=?",
      )
      .all(this.now()))
      this.settle(String(row.id), 'void');
    for (const row of this.db
      .prepare(
        "SELECT id FROM prediction_matches WHERE status NOT IN ('open','locked') AND last_event<?",
      )
      .all(this.now() - LEASE))
      this.frames.delete(String(row.id));
    this.db
      .prepare(
        "UPDATE prediction_matches SET archive='expired' WHERE status IN ('fail','void') AND last_event<?",
      )
      .run(this.now() - LEASE);
    // Local attempt payloads expire too. The signing journal retains its own recovery records.
    this.db
      .prepare(
        "DELETE FROM prediction_archive WHERE phase IN ('confirmed','expired') AND json_extract(record,'$.attempt.outcome')!='won' AND json_extract(record,'$.updatedAt')<?",
      )
      .run(this.now() - LEASE);
  }
  restore(record: ArchiveRecord, ref: ArchiveRef) {
    if (record.category !== 'attempt') return;
    this.db
      .prepare(
        "INSERT INTO prediction_archive(id,match_id,record,ref,phase) VALUES(?,?,?,?,'confirmed') ON CONFLICT(id) DO UPDATE SET ref=excluded.ref,phase='confirmed'",
      )
      .run(record.id, record.attempt!.matchId, JSON.stringify(record), JSON.stringify(ref));
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushWork().finally(() => (this.flushing = null));
    return this.flushing;
  }
  private async flushWork() {
    if (this.closed) return;
    let pending = this.db
      .prepare(
        "SELECT rowid,* FROM prediction_archive WHERE phase='pending' AND rowid>? ORDER BY rowid LIMIT 8",
      )
      .all(this.archiveCursor);
    if (!pending.length) {
      this.archiveCursor = 0;
      pending = this.db
        .prepare(
          "SELECT rowid,* FROM prediction_archive WHERE phase='pending' ORDER BY rowid LIMIT 8",
        )
        .all();
    }
    this.archiveCursor = Number(pending.at(-1)?.rowid ?? 0);
    pending.sort(
      (a, b) =>
        Number(JSON.parse(String(b.record)).attempt.outcome === 'won') -
        Number(JSON.parse(String(a.record)).attempt.outcome === 'won'),
    );
    for (const row of pending) {
      if (this.closed) return;
      let record = JSON.parse(String(row.record)) as ArchiveRecord;
      try {
        if (!record.attempt!.expiresAt) {
          const remaining = LEASE - (this.now() - record.updatedAt);
          if (record.attempt!.outcome !== 'won' && remaining <= 0) {
            this.db
              .prepare("UPDATE prediction_archive SET phase='expired' WHERE id=?")
              .run(String(row.id));
            continue;
          }
          const expiresAt =
            record.attempt!.outcome === 'won'
              ? (
                  await this.archive.inspect({
                    entityKey: record.attempt!.levelKey,
                    txHash: '',
                    expiresAt: '0',
                  })
                ).ref.expiresAt
              : (
                  ((await this.archive.head?.()) ?? 0n) +
                  BigInt(Math.max(1, Math.floor(remaining / 2000)))
                ).toString();
          record = { ...record, attempt: { ...record.attempt!, expiresAt } };
          this.db
            .prepare('UPDATE prediction_archive SET record=? WHERE id=?')
            .run(JSON.stringify(record), String(row.id));
        }
        const ref = await this.archive.put(record);
        if (this.closed) return;
        this.restore(record, ref);
        this.db
          .prepare("UPDATE prediction_matches SET archive='confirmed' WHERE id=? AND sequence=?")
          .run(record.attempt!.matchId, record.attempt!.sequence);
      } catch (error) {
        if (error instanceof ArchiveError && error.status === 410) {
          this.db
            .prepare("UPDATE prediction_archive SET phase='expired' WHERE id=?")
            .run(String(row.id));
        }
        continue;
      }
    }
    let winners = this.db
      .prepare(
        "SELECT rowid,* FROM prediction_archive WHERE phase='confirmed' AND json_extract(record,'$.attempt.outcome')='won' AND rowid>? ORDER BY rowid LIMIT 8",
      )
      .all(this.retentionCursor);
    if (!winners.length) {
      this.retentionCursor = 0;
      winners = this.db
        .prepare(
          "SELECT rowid,* FROM prediction_archive WHERE phase='confirmed' AND json_extract(record,'$.attempt.outcome')='won' ORDER BY rowid LIMIT 8",
        )
        .all();
    }
    for (const row of winners) {
      this.retentionCursor = Number(row.rowid);
      if (this.closed) return;
      const record = JSON.parse(String(row.record)) as ArchiveRecord,
        ref = JSON.parse(String(row.ref)) as ArchiveRef;
      try {
        const level = await this.archive.inspect({
          entityKey: record.attempt!.levelKey,
          txHash: '',
          expiresAt: '0',
        });
        if (BigInt(level.ref.expiresAt) > BigInt(ref.expiresAt) && this.archive.retain) {
          const renewed = await this.archive.retain(ref, level.ref.expiresAt);
          if (!this.closed) this.restore(record, renewed);
        }
      } catch {
        /* Expired entities cannot be revived; retain the last confirmed reference. */
      }
    }
  }
  async drain() {
    await this.flushing;
  }
  close() {
    this.closed = true;
    this.frames.clear();
  }
}
