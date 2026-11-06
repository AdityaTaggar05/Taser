import type { ThemePack } from './catalog';
import { validateTheme, validateRelease, type Deployment } from './schema';
export async function publicBytes(url: string, max: number, fetcher: typeof fetch = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Artwork read failed');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error('Artwork metadata exceeds its size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
export async function sha256Hex(data: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(data).buffer)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
/** A deployed Arkiv entity selects the release; Swarm supplies the manifest and all PNGs. */
export async function loadPublishedTheme(pack: ThemePack, fetcher: typeof fetch = fetch) {
  const d = pack.deployment;
  if (!d.reference) return { manifest: pack.manifest, deployment: d };
  if (!d.releaseSha256) {
    if (d.sheetReferences) throw new Error('Missing release hash');
    return { manifest: pack.manifest, deployment: d };
  }
  let reference = d.reference,
    releaseHash = d.releaseSha256,
    manifestHash = d.manifestSha256;
  if (d.arkiv) {
    const bytes = await publicBytes('/api/themes/' + pack.id, 4096, fetcher),
      p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      p.entityKey !== d.arkiv.entityKey ||
      p.publisher?.toLowerCase() !== d.arkiv.publisher.toLowerCase() ||
      p.chainId !== 7794095 ||
      p.themeId !== pack.id ||
      p.version !== pack.manifest.version ||
      p.swarmReference !== reference ||
      p.releaseSha256 !== releaseHash ||
      p.manifestSha256 !== manifestHash
    )
      throw new Error('Arkiv theme pointer mismatch');
    reference = p.swarmReference;
    releaseHash = p.releaseSha256;
    manifestHash = p.manifestSha256;
  }
  const base = d.gateway.replace(/\/$/, ''),
    releaseBytes = await publicBytes(`${base}/bzz/${reference}/release.json`, 100_000, fetcher);
  if ((await sha256Hex(releaseBytes)) !== releaseHash)
    throw new Error('Theme release integrity mismatch');
  const release = validateRelease(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(releaseBytes)),
    pack.manifest,
  );
  if (release.manifest.sha256 !== manifestHash) throw new Error('Theme manifest pointer mismatch');
  const manifestBytes = await publicBytes(
    `${base}/bzz/${release.manifest.reference}/manifest.json`,
    release.manifest.bytes,
    fetcher,
  );
  if (
    manifestBytes.length !== release.manifest.bytes ||
    (await sha256Hex(manifestBytes)) !== manifestHash
  )
    throw new Error('Theme manifest integrity mismatch');
  const manifest = validateTheme(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)),
  );
  validateRelease(release, manifest);
  const deployment: Deployment = {
    ...d,
    reference,
    sheetReferences: Object.fromEntries(
      Object.entries(release.sheets).map(([id, s]) => [id, s.reference]),
    ),
  };
  return { manifest, deployment };
}
