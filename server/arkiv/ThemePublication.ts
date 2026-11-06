import { defineSchema, str, bytes } from '@arkiv-network/sdk/schema';
import type { FullRow } from '@arkiv-network/sdk/query';
import { hexToBytes } from 'viem';
import { ArchiveError } from './archive';
export const ThemeEntities = defineSchema('taser_themes_v1', {
  namespace: str().indexed(),
  theme_id: str().indexed(),
  version: str().indexed(),
  swarm_reference: str(),
  manifest_sha256: str(),
  release_sha256: str(),
  content_type: str(),
  payload: bytes(),
});
export interface ThemePublication {
  category: 'theme';
  id: string;
  revision: 1;
  themeId: string;
  version: string;
  swarmReference: string;
  manifestSha256: string;
  releaseSha256: string;
  updatedAt: 0;
}
export function validateThemePublication(value: unknown): ThemePublication {
  const r = value as ThemePublication;
  if (
    !r ||
    r.category !== 'theme' ||
    r.revision !== 1 ||
    !/^[a-z0-9_-]{1,32}$/.test(r.themeId) ||
    !/^\d+\.\d+\.\d+$/.test(r.version) ||
    r.id !== r.themeId + '@' + r.version ||
    r.updatedAt !== 0 ||
    ![r.swarmReference, r.manifestSha256, r.releaseSha256].every(
      (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s),
    )
  )
    throw new ArchiveError(503, 'Invalid theme publication.');
  return r;
}
export function decodeThemePublication(
  row: FullRow<typeof ThemeEntities>,
  publisher: string,
  namespace: string,
  entityKey: string,
): ThemePublication {
  if (
    row.$key.toLowerCase() !== entityKey.toLowerCase() ||
    row.$creator.toLowerCase() !== publisher.toLowerCase() ||
    !row.$creationFlags.readonly ||
    row.$creationFlags.permissionlessExtension ||
    row.namespace.value !== namespace ||
    row.content_type.value !== 'application/json'
  )
    throw new ArchiveError(503, 'Untrusted Arkiv theme publication.');
  let r: ThemePublication;
  try {
    r = validateThemePublication(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(row.payload.value))),
    );
  } catch {
    throw new ArchiveError(503, 'Invalid Arkiv theme payload.');
  }
  if (
    row.theme_id.value !== r.themeId ||
    row.version.value !== r.version ||
    row.swarm_reference.value !== r.swarmReference ||
    row.manifest_sha256.value !== r.manifestSha256 ||
    row.release_sha256.value !== r.releaseSha256
  )
    throw new ArchiveError(503, 'Arkiv theme routing mismatch.');
  return r;
}
