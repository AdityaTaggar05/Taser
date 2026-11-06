import { sepolia } from 'viem/chains';
import { isAddress, zeroAddress, type Hex } from 'viem';
import { requestHash, validProof, type CertificationProof } from './model';

interface CertificateIdentity {
  id: Hex;
  commitment: Hex;
  steps: number;
}
export type PublicCertificate = CertificateIdentity &
  (
    | {
        mode: 'cli-simulation';
        receiptId: Hex;
        workflowHash: Hex;
        completedAt: number;
      }
    | {
        mode: 'simulation' | 'don';
        chainId: number;
        registry: Hex;
        blockNumber: string;
      }
  );

/** Discovery exposes public evidence, never the encrypted witness or its salt. */
export function publicCertificate(proof?: CertificationProof): PublicCertificate | undefined {
  if (!proof || !validProof(proof) || !proof.valid || proof.mode === 'test') return;
  const identity = {
    id: proof.request.id,
    commitment: requestHash(proof.request),
    steps: proof.steps,
  };
  if (proof.mode === 'cli-simulation')
    return {
      ...identity,
      mode: proof.mode,
      receiptId: proof.receiptId,
      workflowHash: proof.workflowHash,
      completedAt: proof.completedAt,
    };
  if (proof.registry.toLowerCase() === zeroAddress) return;
  return {
    ...identity,
    mode: proof.mode,
    chainId: proof.chainId,
    registry: proof.registry,
    blockNumber: proof.blockNumber,
  };
}

export function certificateExplorer(certificate: PublicCertificate) {
  if (
    !['simulation', 'don'].includes(certificate.mode) ||
    !('chainId' in certificate) ||
    certificate.chainId !== sepolia.id ||
    !isAddress(certificate.registry) ||
    certificate.registry.toLowerCase() === zeroAddress ||
    !/^\d+$/.test(certificate.blockNumber)
  )
    return;
  const explorer = sepolia.blockExplorers.default.url;
  return {
    registry: `${explorer}/address/${certificate.registry}#readContract`,
    observation: `${explorer}/block/${certificate.blockNumber}`,
  };
}
