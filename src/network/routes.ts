import type { JoinIntent, Player } from './protocol';
import { normalizeInviteCode } from './invite';
export function joinIntent(hash: string): JoinIntent | null {
  const resume = /^#session\/([a-f0-9-]{36})$/.exec(hash);
  if (resume) return { kind: 'resume', id: resume[1] };
  const invite = /^#invite\/([^/]+)$/.exec(hash),
    code = normalizeInviteCode(invite?.[1]);
  if (code) return { kind: 'invite', code };
  const create =
    /^#(coop|solo)\/(?:campaign|community|chamber)\/([a-f0-9-]{36})\/p([12])(?:\/(creator)|\/run\/([a-f0-9]{64}))?$/.exec(
      hash,
    );
  if (
    !create ||
    (create[1] === 'solo' && !create[4] && !create[5]) ||
    (create[1] === 'coop' && (create[4] || create[5]))
  )
    return null;
  return {
    kind: 'create',
    mode: create[1] as 'coop' | 'solo',
    levelId: create[2],
    player: Number(create[3]) as Player,
    ...(create[5] ? { runId: create[5] } : {}),
  };
}
