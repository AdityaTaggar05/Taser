import { expect, it } from 'vitest';
import {
  RULES_HASH,
  type CertificationInfo,
  type CliSimulationProof,
} from '../src/certification/model';
import { publicationProgress } from '../src/editor/publicationProgress';
import type { StoredLevel } from '../src/editor/types';
import { levels } from '../server/data/campaign';

const hash = ('0x' + 'a'.repeat(64)) as `0x${string}`;
const proof: CliSimulationProof = {
  mode: 'cli-simulation',
  valid: true,
  steps: 8,
  receiptId: hash,
  workflowHash: hash,
  completedAt: 100,
  request: {
    id: hash,
    levelId: '12345678-1234-1234-1234-123456789abc',
    target: 'community',
    draftKey: hash,
    levelHash: hash,
    witnessCommitment: hash,
    rulesHash: RULES_HASH,
  },
};
function stored(status: CertificationInfo['status'], evidence: unknown = proof): StoredLevel {
  return {
    id: proof.request.levelId,
    name: 'Test chamber',
    subtitle: '',
    ownerName: 'Test',
    revision: 1,
    publishedRevision: null,
    updatedAt: 1,
    width: 7,
    height: 3,
    totalSteps: 8,
    level: levels[0],
    certification: {
      id: hash,
      status,
      mode: 'cli-simulation',
      target: 'community',
      submittedAt: 1,
      message: 'Server status',
      proof: evidence as CliSimulationProof,
    },
  };
}

it('keeps saving, submission and pending verification distinct without a success tick', () => {
  expect(publicationProgress('saving').blocks).toEqual(['active', 'waiting', 'waiting', 'waiting']);
  expect(publicationProgress('submitting').blocks).toEqual([
    'done',
    'active',
    'waiting',
    'waiting',
  ]);
  const pending = publicationProgress('submitting', stored('pending'));
  expect(pending.blocks).toEqual(['done', 'done', 'active', 'waiting']);
  expect(pending.verified).toBe(false);
});

it('shows certification only with valid evidence for this exact submission and mode', () => {
  expect(publicationProgress('submitting', stored('approved')).label).toBe(
    'CRE SIMULATION VERIFIED',
  );
  for (const evidence of [
    undefined,
    {},
    { ...proof, valid: false },
    { ...proof, receiptId: 'bad' },
    { ...proof, request: { ...proof.request, id: '0x' + 'b'.repeat(64) } },
    { ...proof, request: { ...proof.request, levelId: crypto.randomUUID() } },
    { ...proof, request: { ...proof.request, target: 'campaign' } },
    { ...proof, mode: 'test' },
  ]) {
    const level = stored('approved');
    level.certification!.proof = evidence as CliSimulationProof;
    expect(publicationProgress('submitting', level).verified).toBe(false);
  }
});

it('separates verified solutions from confirmed Arkiv publication and preserves proof during an outage', () => {
  const level = stored('approved');
  const approved = publicationProgress('submitting', level);
  expect(approved.verified).toBe(true);
  expect(approved.published).toBe(false);
  expect(approved.blocks).toEqual(['done', 'done', 'done', 'active']);
  expect(publicationProgress('submitting', level, 'Network unavailable').blocks[3]).toBe('error');
  level.certification!.status = 'published';
  expect(publicationProgress('submitting', level).published).toBe(false);
  level.publication = { category: 'community', entityKey: hash, txHash: hash, expiresAt: '1000' };
  expect(publicationProgress('submitting', level)).toMatchObject({
    published: true,
    blocks: ['done', 'done', 'done', 'done'],
  });
});

it('does not turn rejection or a lost response into certification', () => {
  expect(publicationProgress('submitting', stored('rejected'))).toMatchObject({
    verified: false,
    rejected: true,
    blocks: ['done', 'done', 'error', 'waiting'],
  });
  expect(publicationProgress('submitting', undefined, 'Request timed out')).toMatchObject({
    verified: false,
    published: false,
    title: 'Waiting for confirmation',
  });
});
