import { it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  registeredThemes,
  localDefaultTheme,
  makePack,
  availableTheme,
  useLocalFallback,
  resolveSprite,
  initializeThemes,
} from '../src/assets/catalog';
import { ArtworkLoader, artworkKey } from '../src/assets/ArtworkLoader';

it('ships every required default sheet with the exact manifest dimensions and hashes', async () => {
  const manifest = localDefaultTheme.manifest;
  const ids = new Set(Object.values(manifest.sprites).map((sprite) => sprite.sheet));
  for (const id of ids) {
    const sheet = manifest.sheets[id];
    const bytes = await readFile(`public/themes/${manifest.id}/${sheet.file}`);
    expect(bytes.length).toBe(sheet.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sheet.sha256);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([sheet.width, sheet.height]);
  }
});

it('switches the entire failed theme to matching default frames without changing authored data', () => {
  const selected = makePack(registeredThemes[1].manifest, registeredThemes[1].deployment);
  const before = structuredClone(selected);
  expect(availableTheme(selected)).toBe(selected);
  expect(useLocalFallback(selected)).toBe(localDefaultTheme);
  expect(availableTheme(selected)).toBe(localDefaultTheme);
  const sprite = resolveSprite(selected, 'p1');
  expect(sprite.url).toBe('/themes/modern-gray/sheets/p1-idle.png');
  expect(sprite.sprite).toEqual(localDefaultTheme.manifest.sprites['player.p1.idle.south.0']);
  expect(sprite.sheet).toBe(localDefaultTheme.manifest.sheets[sprite.sprite.sheet]);
  expect(selected).toEqual(before);
  expect(artworkKey(localDefaultTheme)).not.toBe(artworkKey(registeredThemes[0]));
});

it('lets local sheets complete independently after a remote timeout and never reuses partial remote textures', async () => {
  const remote = registeredThemes[0];
  const target = {
    has: vi.fn(() => false),
    load: vi.fn(async (pack, _id, _signal) => {
      if (pack.deployment.reference) throw new Error('Remote timeout');
    }),
    register: vi.fn(),
  };
  const loader = new ArtworkLoader(
    target,
    () => {},
    (pack) => (pack.deployment.reference ? 10 : 1000),
  );
  await expect(loader.ensure(remote)).rejects.toThrow('Remote timeout');
  await loader.ensure(localDefaultTheme);
  expect(loader.isReady(localDefaultTheme)).toBe(true);
  expect(loader.isReady(remote)).toBe(false);
  expect(target.register).toHaveBeenCalledExactlyOnceWith(localDefaultTheme);
});

it('bounds stalled metadata reads, cancels remote requests and enables local startup', async () => {
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  await initializeThemes(fetcher, 5);
  expect(fetcher).toHaveBeenCalledTimes(registeredThemes.length);
  expect(fetcher.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  expect(registeredThemes.every((pack) => availableTheme(pack) === localDefaultTheme)).toBe(true);
});
