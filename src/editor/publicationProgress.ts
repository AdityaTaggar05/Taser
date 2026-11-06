import { validProof, verificationLabel } from '../certification/model';
import type { StoredLevel } from './types';

export type PublicationStage = 'saving' | 'submitting';
export type NetworkPhase =
  'saving' | 'freezing' | 'verifying' | 'publishing' | 'published' | 'rejected' | 'paused';
export type BlockState = 'waiting' | 'active' | 'done' | 'error';

/** Presentation follows server evidence; animation never advances a submission. */
export function publicationProgress(stage: PublicationStage, stored?: StoredLevel, error?: string) {
  const info = stored?.certification;
  const verified = !!(
    info &&
    ['approved', 'published'].includes(info.status) &&
    validProof(info.proof) &&
    info.proof.valid &&
    info.proof.request.id === info.id &&
    info.proof.request.levelId === stored?.id &&
    info.proof.request.target === info.target &&
    info.proof.mode === info.mode
  );
  const published = verified && info?.status === 'published' && !!stored?.publication;
  const rejected = info?.status === 'rejected';
  const active = info ? (verified ? 3 : 2) : stage === 'submitting' ? 1 : 0;
  const blocks: BlockState[] = Array.from({ length: 4 }, (_, i) =>
    published || i < active
      ? 'done'
      : i === active
        ? rejected || error
          ? 'error'
          : 'active'
        : 'waiting',
  );
  const networkPhase: NetworkPhase = rejected
    ? 'rejected'
    : published
      ? 'published'
      : error || info?.mode === 'unconfigured'
        ? 'paused'
        : verified
          ? 'publishing'
          : info
            ? 'verifying'
            : stage === 'submitting'
              ? 'freezing'
              : 'saving';
  return {
    networkPhase,
    blocks,
    verified,
    published,
    rejected,
    label: verified ? verificationLabel(info!.proof!.mode) : '',
    title: rejected
      ? 'Solution needs a correction'
      : published
        ? 'Your chamber is live'
        : verified
          ? 'Solution verified'
          : error
            ? 'Waiting for confirmation'
            : 'Building your publication',
    message:
      error ??
      info?.message ??
      (stage === 'saving'
        ? 'Saving your level and encrypted solution to Arkiv.'
        : 'Freezing your level and requesting solution verification.'),
  };
}
