import { checkInput, requestHash, type VerificationInput } from '../../src/certification/model';
import { cleanDraft } from '../../src/core/levelValidation';
import { verifySolution } from '../../src/editor/solution';
/** Executed independently on each CRE node; only a compact verdict enters consensus. */
export function assessSubmission(value: unknown, expectedCommitment: string, expectedId: string) {
  if (!value || typeof value !== 'object') throw new Error('Invalid verification input.');
  const input = value as VerificationInput;
  input.level = cleanDraft(input.level);
  checkInput(input);
  if (input.request.id !== expectedId || requestHash(input.request) !== expectedCommitment)
    throw new Error('Frozen submission does not match the onchain request.');
  const check = verifySolution(input.level);
  return {
    id: input.request.id,
    commitment: expectedCommitment,
    valid: check.valid,
    steps: check.step,
  };
}
