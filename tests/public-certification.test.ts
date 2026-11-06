import { describe, it, expect } from 'vitest';
import { publicCertificate, certificateExplorer } from '../src/certification/public';
import { requestHash, RULES_HASH, type CertificationProof } from '../src/certification/model';

const proof = (): CertificationProof => ({
  mode: 'simulation',
  request: {
    id: ('0x' + '11'.repeat(32)) as `0x${string}`,
    levelId: '00000000-0000-4000-8000-000000000001',
    target: 'community',
    draftKey: ('0x' + '22'.repeat(32)) as `0x${string}`,
    levelHash: ('0x' + '33'.repeat(32)) as `0x${string}`,
    witnessCommitment: ('0x' + '44'.repeat(32)) as `0x${string}`,
    rulesHash: RULES_HASH,
  },
  chainId: 11155111,
  registry: '0x1111111111111111111111111111111111111111',
  blockNumber: '1234',
  valid: true,
  steps: 8,
});

describe('public certification evidence', () => {
  it('exposes the exact certificate identity and commitment without a witness or draft', () => {
    const input = proof();
    const certificate = publicCertificate(input)!;
    expect(certificate).toMatchObject({
      id: input.request.id,
      commitment: requestHash(input.request),
      steps: 8,
    });
    expect(Object.keys(certificate).sort()).toEqual(
      ['id', 'commitment', 'steps', 'mode', 'chainId', 'registry', 'blockNumber'].sort(),
    );
    expect(certificateExplorer(certificate)).toEqual({
      registry:
        'https://sepolia.etherscan.io/address/0x1111111111111111111111111111111111111111#readContract',
      observation: 'https://sepolia.etherscan.io/block/1234',
    });
  });

  it('never produces Sepolia links for local CLI receipts', () => {
    const input = proof();
    const certificate = publicCertificate({
      request: input.request,
      mode: 'cli-simulation',
      valid: true,
      steps: 8,
      receiptId: ('0x' + '55'.repeat(32)) as `0x${string}`,
      workflowHash: ('0x' + '66'.repeat(32)) as `0x${string}`,
      completedAt: 1000,
    })!;
    expect(certificate.mode).toBe('cli-simulation');
    expect(certificateExplorer(certificate)).toBeUndefined();
    expect(certificate).not.toHaveProperty('registry');
    expect(certificate).not.toHaveProperty('chainId');
  });

  it('omits legacy, rejected, malformed and mock certificates', () => {
    expect(publicCertificate()).toBeUndefined();
    expect(publicCertificate({ ...proof(), valid: false })).toBeUndefined();
    const evm = proof();
    if (evm.mode === 'cli-simulation') throw new Error('Expected an EVM fixture');
    expect(publicCertificate({ ...evm, mode: 'test' })).toBeUndefined();
    expect(publicCertificate({ ...evm, chainId: 1 })).toBeUndefined();
    expect(
      publicCertificate({ ...evm, registry: '0x0000000000000000000000000000000000000000' }),
    ).toBeUndefined();
  });

  it('does not construct explorer URLs from an unsafe registry or another network', () => {
    const certificate = publicCertificate(proof())!;
    if (certificate.mode === 'cli-simulation') throw new Error('Expected an EVM fixture');
    expect(
      certificateExplorer({ ...certificate, registry: 'javascript:bad' as `0x${string}` }),
    ).toBeUndefined();
    expect(certificateExplorer({ ...certificate, chainId: 1 })).toBeUndefined();
  });
});
