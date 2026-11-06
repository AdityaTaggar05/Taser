import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseCliResult } from '../server/certification/cliResult';
import { CliSimulationVerifier } from '../server/certification/CliSimulationVerifier';
import {
  requestHash,
  RULES_HASH,
  validProof,
  verificationLabel,
  type CertificationRequest,
  type CliSimulationProof,
} from '../src/certification/model';
import { LevelStore } from '../server/levels/LevelStore';
import { MemoryArchive } from '../server/arkiv/archive';
import { LevelCipher } from '../server/arkiv/LevelCipher';
import { generateKey } from 'arkiv-encryption';
import { levels } from '../server/data/campaign';

const hex = (c: string) => ('0x' + c.repeat(64)) as `0x${string}`;
const request: CertificationRequest = {
  id: hex('1'),
  levelId: '00000000-0000-4000-8000-000000000001',
  target: 'community',
  draftKey: hex('2'),
  levelHash: hex('3'),
  witnessCommitment: hex('4'),
  rulesHash: RULES_HASH,
};
const result = {
  submissionId: request.id,
  commitment: requestHash(request),
  valid: true,
  steps: 8,
  mode: 'local-simulation',
  certified: false,
};
const output = (value: unknown) =>
  '  Binary hash: ' +
  hex('5').slice(2) +
  '\n✓ Workflow Simulation Result:\n' +
  JSON.stringify(JSON.stringify(value)) +
  '\nExecution finished\n';
const receipt = (r: CertificationRequest): CliSimulationProof => ({
  request: r,
  mode: 'cli-simulation',
  valid: true,
  steps: 8,
  receiptId: hex('6'),
  workflowHash: hex('5'),
  completedAt: Date.now(),
});

it('accepts only the final matching local CLI result and records no invented chain certificate', () => {
  expect(parseCliResult(output(result), request)).toEqual({
    valid: true,
    steps: 8,
    workflowHash: hex('5'),
  });
  for (const value of [
    { ...result, commitment: hex('0') },
    { ...result, submissionId: hex('0') },
    { ...result, certified: true },
    { ...result, mode: 'don' },
    { ...result, steps: 33 },
    { ...result, valid: 'true' },
    { ...result, steps: 0 },
  ])
    expect(() => parseCliResult(output(value), request)).toThrow();
  expect(() => parseCliResult('[USER LOG] ' + JSON.stringify(result), request)).toThrow();
  expect(() => parseCliResult(output(result) + output(result), request)).toThrow();
  const proof = receipt(request);
  expect(validProof(proof)).toBe(true);
  expect('registry' in proof).toBe(false);
  expect('chainId' in proof).toBe(false);
  expect(verificationLabel(proof.mode)).toBe('CRE SIMULATION VERIFIED');
});

it('reconciles durable receipts without executing CLI and rejects changed request identities', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'taser-cli-receipt-')),
    databasePath = join(directory, 'receipts.sqlite');
  let verifier = new CliSimulationVerifier({ apiBase: 'http://127.0.0.1:5173', databasePath });
  try {
    const proof = receipt(request),
      db = new DatabaseSync(databasePath);
    db.prepare('INSERT INTO cli_receipts VALUES(?,?,?)').run(
      request.id,
      requestHash(request),
      JSON.stringify(proof),
    );
    db.close();
    verifier.close();
    verifier = new CliSimulationVerifier({ apiBase: 'http://127.0.0.1:5173', databasePath });
    expect(await verifier.read(request)).toEqual(proof);
    expect(await verifier.verify(request)).toEqual(proof);
    await expect(verifier.read({ ...request, target: 'campaign' })).rejects.toThrow('mismatch');
    expect(
      () => new CliSimulationVerifier({ apiBase: 'http://127.0.0.1:5173', databasePath }),
    ).toThrow('Another CRE simulator');
  } finally {
    verifier.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('keeps failed CLI executions unapproved and throttles repeated attempts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'taser-cli-failed-')),
    verifier = new CliSimulationVerifier({
      apiBase: 'http://127.0.0.1:5173',
      databasePath: join(directory, 'receipts.sqlite'),
      bin: join(directory, 'missing-cre'),
    });
  try {
    await expect(verifier.verify(request)).rejects.toThrow('temporarily unavailable');
    expect(await verifier.read(request)).toBeNull();
    expect(await verifier.verify(request)).toBeNull();
  } finally {
    verifier.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('runs CLI approval only in maintenance, then publishes once and restores encrypted simulation proofs', async () => {
  const archive = new MemoryArchive(),
    proofs = new Map<string, CliSimulationProof>(),
    verify = vi.fn(async (r: CertificationRequest) => {
      const proof = receipt(r);
      proofs.set(r.id, proof);
      return proof;
    });
  const registry = {
    mode: 'cli-simulation' as const,
    read: async (r: CertificationRequest) => proofs.get(r.id) ?? null,
    verify,
  };
  const directory = mkdtempSync(join(tmpdir(), 'taser-cli-store-')),
    path = join(directory, 'levels.sqlite');
  let store = new LevelStore(path, archive, registry);
  try {
    const draft = await store.save('alice', 'Alice', levels[0]),
      submitted = await store.publish('alice', draft.id, 1);
    expect(submitted.certification?.status).toBe('pending');
    expect(verify).not.toHaveBeenCalled();
    expect(store.community()).toEqual([]);
    store.get('alice', draft.id);
    expect(verify).not.toHaveBeenCalled();
    await store.flushCertifications();
    expect(verify).toHaveBeenCalledTimes(1);
    const published = store.get('alice', draft.id);
    expect(published.certification?.status).toBe('published');
    expect(published.verification).toBe('cli-simulation');
    expect(store.forPlay(draft.id)).not.toBeNull();
    await store.flushCertifications();
    await store.publish('alice', draft.id, 1);
    expect(verify).toHaveBeenCalledTimes(1);
    const record = [...archive.entries.values()].find(
        (e) => e.record.category === 'community',
      )!.record,
      cipher = new LevelCipher(generateKey(), 'test');
    expect(
      (
        await cipher.decrypt(await cipher.encrypt(record), {
          id: record.id,
          revision: record.revision,
          category: 'community',
        })
      ).certification?.proof.mode,
    ).toBe('cli-simulation');
    store.close();
    store = new LevelStore(path, archive, registry);
    await store.hydrate();
    expect(store.community()[0].verification).toBe('cli-simulation');
    await expect(store.save('alice', 'Alice', levels[0], draft.id, 1)).rejects.toThrow('locked');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
