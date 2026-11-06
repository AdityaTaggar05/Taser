import { themeSources } from './sources';
import {
  ROLE_IDS,
  validateTheme,
  validateDeployment,
  spriteUrl,
  type Deployment,
  type ThemeManifest,
  type AssetRole,
} from './schema';
export interface ThemePack {
  id: string;
  name: string;
  manifest: ThemeManifest;
  deployment: Deployment;
  palette: Record<keyof ThemeManifest['palette'], number>;
}
export const registeredThemes: ThemePack[] = themeSources.map((source) =>
  makePack(source.manifest, source.deployment),
);
export const modernGray: ThemePack = registeredThemes.find((pack) => pack.id === 'modern-gray')!;
/** Bundled, complete default pack; its source rectangles always match its local PNGs. */
export const localDefaultTheme = makePack(modernGray.manifest, {
  reference: null,
  gateway: modernGray.deployment.gateway,
  verifiedAt: null,
  manifestSha256: null,
});
export const REMOTE_ARTWORK_TIMEOUT_MS = 8_000;
const localFallbacks = new WeakSet<ThemePack>();
export function availableTheme(pack: ThemePack): ThemePack {
  return localFallbacks.has(pack) ? localDefaultTheme : pack;
}
export function useLocalFallback(pack: ThemePack) {
  localFallbacks.add(pack);
  return localDefaultTheme;
}
/** Legacy Arkiv level IDs resolve here; rules and archived layouts do not need migrations. */
export const environments: Record<string, ThemePack> = Object.fromEntries(
  themeSources.flatMap((source, i) =>
    [source.id, ...source.aliases].map((id) => [id, registeredThemes[i]]),
  ),
);
export function makePack(value: unknown, deployment: Deployment): ThemePack {
  const manifest = validateTheme(value);
  validateDeployment(deployment);
  if (
    deployment.sheetReferences &&
    Object.keys(manifest.sheets).some((id) => !deployment.sheetReferences?.[id])
  )
    throw new Error('Incomplete theme deployment');
  return {
    id: manifest.id,
    name: manifest.name,
    manifest,
    deployment,
    palette: Object.fromEntries(
      Object.entries(manifest.palette).map(([k, v]) => [k, parseInt(v.slice(1), 16)]),
    ) as ThemePack['palette'],
  };
}
export function semantic(id: string) {
  return Object.hasOwn(ROLE_IDS, id) ? ROLE_IDS[id as AssetRole] : id;
}
export function resolveSprite(pack: ThemePack, id: string) {
  pack = availableTheme(pack);
  const key = semantic(id),
    sprite = pack.manifest.sprites[key];
  if (!sprite) throw new Error(`Theme ${pack.id} has no ${key}`);
  return {
    id: key,
    sprite,
    sheet: pack.manifest.sheets[sprite.sheet],
    url: spriteUrl(pack.manifest, pack.deployment, sprite.sheet),
  };
}
export function applyThemeVariables(pack: ThemePack) {
  pack = availableTheme(pack);
  const root = document.documentElement;
  root.dataset.theme = pack.id;
  root.dataset.assetSource = pack.deployment.reference ? 'swarm' : 'local';
  root.dataset.artworkFallback = String(pack === localDefaultTheme);
  for (const [k, v] of Object.entries(pack.manifest.palette))
    root.style.setProperty('--theme-' + k, v);
  root.style.setProperty('--cyan', pack.manifest.palette.p1);
  root.style.setProperty('--amber', pack.manifest.palette.p2);
  root.style.setProperty('--paper', pack.manifest.palette.ink);
  root.style.setProperty('--line', pack.manifest.palette.edge);
}

export async function initializeThemes(
  fetcher: typeof fetch = fetch,
  timeoutMs = REMOTE_ARTWORK_TIMEOUT_MS,
) {
  const { loadPublishedTheme } = await import('./remote');
  await Promise.all(
    registeredThemes
      .filter((pack) => pack.deployment.reference)
      .map(async (pack) => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Remote artwork metadata timed out'));
          }, timeoutMs);
        });
        try {
          const loaded = await Promise.race([
            loadPublishedTheme(pack, fetcher, controller.signal),
            deadline,
          ]);
          Object.assign(pack, makePack(loaded.manifest, loaded.deployment));
        } catch {
          controller.abort();
          useLocalFallback(pack);
        } finally {
          clearTimeout(timer);
        }
      }),
  );
}
