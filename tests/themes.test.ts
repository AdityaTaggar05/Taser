import { describe, it, expect } from 'vitest';
import raw from '../public/themes/modern-gray/manifest.json';
import bootstrapManifest from '../src/assets/modern-gray.manifest.json';
import diwali from '../public/themes/diwali/manifest.json';
import diwaliBootstrap from '../src/assets/diwali.manifest.json';
import { registeredThemes, environments } from '../src/assets/catalog';
import { themeSourceFromArgs } from '../scripts/lib/theme-source';
import { readFile } from 'node:fs/promises';
import {
  validateTheme,
  validateDeployment,
  spriteUrl,
  REQUIRED_ANIMATIONS,
} from '../src/assets/schema';
import {
  prepareUpload,
  makeTar,
  uploadCollection,
  verifyRemote,
  digest,
  type UploadBundle,
} from '../scripts/lib/swarm-theme';
import { resolve } from 'node:path';
import { splitPublicBundle } from '../scripts/lib/public-theme';
const copy = () => structuredClone(raw);
const deployment = {
  reference: null,
  gateway: 'https://gateway.example',
  verifiedAt: null,
  manifestSha256: null,
};
describe('theme contract', () => {
  it('bundles the exact public release manifest through the Vite source graph', async () => {
    expect(bootstrapManifest).toEqual(raw);
    expect(await readFile(resolve('src/assets/modern-gray.manifest.json'))).toEqual(
      await readFile(resolve('public/themes/modern-gray/manifest.json')),
    );
  });
  it('contains every approved player sequence and gameplay/UI role', () => {
    expect(bootstrapManifest).toEqual(raw);
    const pack = validateTheme(copy());
    expect(Object.keys(pack.sheets)).toHaveLength(29);
    expect(Object.keys(pack.sprites)).toHaveLength(556);
    expect(REQUIRED_ANIMATIONS).toHaveLength(74);
    expect(pack.presentation.boxIdentityLabels).toBe(false);
    expect(pack.animations['fx.weld'].visibility).toBe('after-success-only');
  });
  it('keeps Diwali interchangeable with the original pack and validates all published PNG bytes', async () => {
    expect(diwaliBootstrap).toEqual(diwali);
    const pack = validateTheme(diwali);
    expect(Object.keys(pack.sprites)).toEqual(Object.keys(raw.sprites));
    expect(pack.animations).toEqual(raw.animations);
    expect(pack.presentation).toEqual(raw.presentation);
    expect(registeredThemes.map((p) => p.id)).toEqual(['modern-gray', 'diwali']);
    expect(environments.foundry).toBe(environments['modern-gray']);
    expect(environments.diwali.id).toBe('diwali');
    for (const id of ['p1-idle', 'p2-idle', '04-exits', '10-mvp-ui-icons-and-avatars'])
      expect(pack.sheets[id].sha256).not.toBe(raw.sheets[id as keyof typeof raw.sheets].sha256);
    expect(pack.sheets['02-environment-tiles'].sha256).toBe(
      raw.sheets['02-environment-tiles'].sha256,
    );
    const upload = await prepareUpload(resolve('public/themes/diwali'));
    expect(upload.files).toHaveLength(30);
    expect(splitPublicBundle(upload).every((p) => p.tar.length <= 8_000_000)).toBe(true);
    expect(themeSourceFromArgs(['--theme', 'diwali']).deploymentFile).toBe(
      'src/assets/diwali.deployment.json',
    );
    expect(() => themeSourceFromArgs(['--theme', '../../.env.local'])).toThrow(/Unknown theme/);
    expect(() => themeSourceFromArgs(['--theme'])).toThrow(/Unknown theme/);
  });
  it('rejects missing roles, frame overflow, path traversal and malformed animation', () => {
    const a = copy();
    delete (a.sprites as Record<string, unknown>)['exit.p1.open'];
    expect(() => validateTheme(a)).toThrow(/missing/);
    const b = copy();
    b.sprites['tile.floor'].frame.x = 99999;
    expect(() => validateTheme(b)).toThrow(/bounds/);
    const c = copy();
    c.sheets['02-environment-tiles'].file = '../../.env.local';
    expect(() => validateTheme(c)).toThrow(/sheet/);
    const d = copy();
    delete (d.animations as Record<string, unknown>)['player.p2.walk.north'];
    expect(() => validateTheme(d)).toThrow(/missing animation/);
    const e = copy();
    (e.animations['fx.weld'] as { visibility: string }).visibility = 'before';
    expect(() => validateTheme(e)).toThrow(/visibility/);
  });
  it('keeps the recessed plate visible beneath the crate with stable pressure-state pivots', () => {
    for (const theme of [raw, diwali])
      for (const owner of ['neutral', 'p1', 'p2']) {
        const sprites = theme.sprites as Record<
          string,
          {
            sheet: string;
            frame: { w: number; h: number };
            render: { width: number; height: number; originX: number; originY: number };
          }
        >;
        const crate = sprites['crate.' + owner],
          up = sprites[`switch.${owner}.up`];
        expect(theme.version).toBe('1.1.0');
        expect(crate.sheet).toBe('11-standard-crates');
        expect(up.render.width - crate.render.width).toBeGreaterThan(0.15);
        expect(crate.render.height * (1 - crate.render.originY)).toBeCloseTo(0.35);
        for (const state of ['press1', 'press2', 'held', 'release1', 'release2']) {
          const plate = sprites[`switch.${owner}.${state}`];
          expect(plate.render).toEqual(up.render);
          expect([plate.frame.w, plate.frame.h]).toEqual([up.frame.w, up.frame.h]);
        }
      }
    expect(diwali.sheets['11-standard-crates'].sha256).toBe(
      raw.sheets['11-standard-crates'].sha256,
    );
    expect(diwali.sheets['03-pressure-switches'].sha256).toBe(
      raw.sheets['03-pressure-switches'].sha256,
    );
  });
  it('resolves all sheets from the immutable Swarm collection when configured', () => {
    const m = validateTheme(copy()),
      d = { ...deployment, reference: 'a'.repeat(64) };
    for (const sheet of Object.keys(m.sheets))
      expect(spriteUrl(m, d, sheet)).toBe(
        `https://gateway.example/bzz/${d.reference}/${m.sheets[sheet].file}`,
      );
    expect(spriteUrl(m, deployment, '01-crates-and-mirrors')).toMatch(/^\/themes\/modern-gray\//);
    expect(() =>
      validateDeployment({ ...d, gateway: 'https://secret:password@example.com' }),
    ).toThrow();
    expect(() => validateDeployment({ ...d, reference: 'invalid' })).toThrow();
  });
});
describe('Swarm upload boundary', () => {
  it('packages only the manifest and original PNG allowlist; hashes every file', async () => {
    const b = await prepareUpload(resolve('public/themes/modern-gray'));
    expect(b.files).toHaveLength(30);
    const parts = splitPublicBundle(b);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.tar.length <= 8_000_000)).toBe(true);
    expect(
      parts
        .flatMap((p) => p.files.filter((f) => f.name !== 'manifest.json').map((f) => f.name))
        .sort(),
    ).toEqual(
      b.files
        .filter((f) => f.name !== 'manifest.json')
        .map((f) => f.name)
        .sort(),
    );
    const names: string[] = [];
    let at = 0;
    while (at < b.tar.length && b.tar[at]) {
      names.push(
        b.tar
          .subarray(at, at + 100)
          .toString()
          .replace(/\0.*$/, ''),
      );
      const size = parseInt(
        b.tar
          .subarray(at + 124, at + 136)
          .toString()
          .replace(/\0.*$/, ''),
        8,
      );
      at += 512 + Math.ceil(size / 512) * 512;
    }
    expect(names.sort()).toEqual(b.files.map((f) => f.name).sort());
    expect(names.every((n) => n === 'manifest.json' || /^sheets\/.+\.png$/.test(n))).toBe(true);
    expect(() =>
      makeTar([{ name: '.env.local', data: Buffer.from('secret'), sha256: '' }]),
    ).toThrow();
  });
  const data = Buffer.from('test'),
    file = { name: 'manifest.json', data, sha256: digest(data) };
  const bundle: UploadBundle = {
    id: 'test',
    version: '1.0.0',
    files: [file],
    tar: makeTar([file]),
    manifestSha256: file.sha256,
  };
  const config = {
    bee: 'https://upload.example',
    gateway: 'https://read.example',
    batch: '0'.repeat(64),
    token: 'private-test-token',
  };
  it('checks usable postage before admission and uses immediate collection upload', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let admitted = false;
    const transport = async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        expect(admitted).toBe(false);
        return Response.json({ usable: true });
      }
      expect(admitted).toBe(true);
      return Response.json({ reference: 'a'.repeat(64) });
    };
    expect(
      await uploadCollection(bundle, config, transport as typeof fetch, async () => {
        admitted = true;
      }),
    ).toBe('a'.repeat(64));
    expect(calls[1].init?.headers).toMatchObject({
      'Swarm-Deferred-Upload': 'false',
      'Swarm-Collection': 'true',
      'Swarm-Postage-Batch-Id': config.batch,
    });
    let failedAdmission = false;
    await expect(
      uploadCollection(
        bundle,
        config,
        (async () => Response.json({ usable: false })) as typeof fetch,
        async () => {
          failedAdmission = true;
        },
      ),
    ).rejects.toThrow(/usable/);
    expect(failedAdmission).toBe(false);
  });
  it('public uploads use provider postage without node-only endpoints or private credentials', async () => {
    let calls = 0,
      admitted = false;
    const transport = async (url: unknown, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe('https://upload.example/bzz');
      expect(admitted).toBe(true);
      expect(init?.headers).not.toHaveProperty('Authorization');
      expect(init?.headers).not.toHaveProperty('Swarm-Postage-Batch-Id');
      return Response.json({ reference: 'b'.repeat(64) });
    };
    const publicConfig = { mode: 'public' as const, bee: config.bee, gateway: config.gateway };
    expect(
      await uploadCollection(bundle, publicConfig, transport as typeof fetch, async () => {
        admitted = true;
      }),
    ).toBe('b'.repeat(64));
    expect(calls).toBe(1);
    await expect(
      uploadCollection(bundle, { ...publicConfig, token: 'secret' }, transport as typeof fetch),
    ).rejects.toThrow(/private/);
  });
  it('verifies public readback without forwarding upload credentials and rejects corrupt bytes', async () => {
    const transport = async (_url: unknown, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined();
      return new Response(data);
    };
    await verifyRemote(bundle, config, 'a'.repeat(64), transport as typeof fetch);
    await expect(
      verifyRemote(
        bundle,
        config,
        'a'.repeat(64),
        (async () => new Response('bad!')) as typeof fetch,
      ),
    ).rejects.toThrow();
  });
});
