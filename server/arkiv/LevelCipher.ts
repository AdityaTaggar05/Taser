import { importKey, encryptBytes, decryptBytes, CONTENT_TYPE } from 'arkiv-encryption';
import { GameEngine } from '../../src/core/engine';
import { DIRECTIONS } from '../../src/network/protocol';
import { createHash } from 'node:crypto';
import { canonicalJSON } from './canonical';
import { cleanDraft } from '../../src/core/levelValidation';
import { verifySolution } from '../../src/editor/solution';
import {
  ArchiveError,
  type ArchiveWrite,
  type ArchiveRecord,
  type MoveRecord,
  type LevelCategory,
} from './archive';
import { checkInput, validProof } from '../../src/certification/model';
export { CONTENT_TYPE };
/** The encrypted envelope binds its public routing fields; no solution digest is published. */
export class LevelCipher {
  private key: Promise<CryptoKey>;

  constructor(
    rawKey: string,
    readonly namespace: string,
  ) {
    this.key = importKey(rawKey);
  }
  async encrypt(record: ArchiveWrite) {
    return encryptBytes(
      await this.key,
      JSON.stringify({ format: 1, chainId: 7794095, namespace: this.namespace, record }),
    );
  }

  async decrypt(
    ciphertext: Uint8Array,
    expected: { id: string; revision: number; category: LevelCategory },
  ): Promise<ArchiveRecord>;
  async decrypt(
    ciphertext: Uint8Array,
    expected: { id: string; revision: number; category: 'move' },
  ): Promise<MoveRecord>;
  async decrypt(
    ciphertext: Uint8Array,
    expected: { id: string; revision: number; category: string },
  ): Promise<ArchiveWrite>;
  async decrypt(
    ciphertext: Uint8Array,
    expected: { id: string; revision: number; category: string },
  ): Promise<ArchiveWrite> {
    try {
      const bytes = await decryptBytes(await this.key, ciphertext);
      const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const r = envelope.record as ArchiveWrite;
      if (
        envelope.format !== 1 ||
        envelope.chainId !== 7794095 ||
        envelope.namespace !== this.namespace ||
        !r ||
        r.id !== expected.id ||
        r.revision !== expected.revision ||
        r.category !== expected.category ||
        !['draft', 'community', 'campaign', 'run', 'attempt', 'move'].includes(r.category) ||
        !Number.isSafeInteger(r.revision) ||
        r.revision < 1 ||
        typeof r.ownerId !== 'string' ||
        r.ownerId.length > 128 ||
        typeof r.ownerName !== 'string' ||
        r.ownerName.length > 128 ||
        !Number.isSafeInteger(r.updatedAt) ||
        r.updatedAt < 0 ||
        (r.category === 'campaign' &&
          (!Number.isSafeInteger(r.campaignSlot) || r.campaignSlot! < 1))
      )
        throw new Error();
      if (r.lifetimeDays !== undefined && r.lifetimeDays !== 2) throw new Error();
      if (
        r.category === 'run' &&
        (!r.run ||
          !/^0x[a-fA-F0-9]{64}$/.test(r.run.levelKey) ||
          ![1, 2].includes(r.run.role) ||
          !['coop', 'solo'].includes(r.run.mode) ||
          typeof r.run.source !== 'string' ||
          r.run.source.length > 128 ||
          r.lifetimeDays !== 2)
      )
        throw new Error();
      if (r.category === 'move') {
        const m = r.move;
        if (
          r.revision !== 1 ||
          r.lifetimeDays !== 2 ||
          !m ||
          !/^0x[a-fA-F0-9]{64}$/.test(m.levelKey) ||
          typeof m.sessionId !== 'string' ||
          m.sessionId.length > 128 ||
          !Number.isSafeInteger(m.turn) ||
          m.turn < 1 ||
          !Number.isSafeInteger(m.sequence) ||
          m.sequence < 1 ||
          !['solo', 'coop'].includes(m.mode) ||
          !Array.isArray(m.inputs) ||
          m.inputs.length !== 2 ||
          !m.inputs.every((d) => ['U', 'D', 'L', 'R', 'W'].includes(d))
        )
          throw new Error();
        return {
          id: r.id,
          revision: 1,
          category: 'move',
          ownerId: r.ownerId,
          ownerName: r.ownerName,
          updatedAt: r.updatedAt,
          lifetimeDays: 2,
          move: { ...m, inputs: [...m.inputs] },
        };
      }
      const level = cleanDraft(r.level);
      if (r.certification) {
        const { proof, salt } = r.certification;
        if (
          !validProof(proof) ||
          !proof.valid ||
          proof.request.levelId !== r.id ||
          proof.request.target !== r.category
        )
          throw new Error();
        checkInput({ request: proof.request, level, salt });
      }
      if (r.category === 'attempt') {
        const a = r.attempt;
        if (
          !a ||
          typeof a.matchId !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(a.matchId) ||
          r.id !== `${a.matchId}:${a.sequence}` ||
          !/^0x[a-fA-F0-9]{64}$/.test(a.levelKey) ||
          !Number.isSafeInteger(a.sequence) ||
          a.sequence < 1 ||
          !['active', 'lost', 'won'].includes(a.outcome) ||
          !/^([a-f0-9]{64})?$/.test(a.previousHash) ||
          !/^[a-f0-9]{64}$/.test(a.transcriptHash) ||
          !a.expiresAt ||
          !/^[1-9][0-9]{0,19}$/.test(a.expiresAt)
        )
          throw new Error();
        const moves = [level.solutionP1, level.solutionP2];
        if (
          moves[0].length !== moves[1].length ||
          moves[0].length > level.totalSteps ||
          moves.some((list) => list.some((d) => !DIRECTIONS.includes(d)))
        )
          throw new Error();
        const hash = createHash('sha256')
          .update(
            canonicalJSON({
              previous: a.previousHash,
              moves,
              outcome: a.outcome,
              sequence: a.sequence,
            }),
          )
          .digest('hex');
        if (hash !== a.transcriptHash) throw new Error();
        const engine = new GameEngine({
          ...level,
          solutionP1: Array(level.totalSteps).fill('W'),
          solutionP2: Array(level.totalSteps).fill('W'),
        });
        for (let k = 0; k < moves[0].length; k++) {
          if (engine.selectionError(1, moves[0][k]) || engine.selectionError(2, moves[1][k]))
            throw new Error();
          engine.executeStep(moves[0][k], moves[1][k]);
        }
        if (a.outcome === 'won' && !verifySolution(level).valid) throw new Error();
      } else {
        const solution = verifySolution(level);
        if (r.category !== 'draft' && !solution.valid) throw new Error();
        if (r.certification && r.certification.proof.steps !== solution.step) throw new Error();
      }
      return {
        id: r.id,
        revision: r.revision,
        category: r.category,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        updatedAt: r.updatedAt,
        ...(r.category === 'campaign' ? { campaignSlot: r.campaignSlot } : {}),
        ...(r.lifetimeDays ? { lifetimeDays: r.lifetimeDays } : {}),
        ...(r.category === 'run' ? { run: r.run } : {}),
        ...(r.certification ? { certification: r.certification } : {}),
        ...(r.category === 'attempt' ? { attempt: r.attempt } : {}),
        level,
      };
    } catch {
      throw new ArchiveError(503, 'Encrypted level failed authentication or validation.');
    }
  }
}
