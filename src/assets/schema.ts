export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ThemeSprite {
  sheet: string;
  frame: Rect;
  render: { width: number; height: number; originX: number; originY: number };
}
export interface ThemeManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  name: string;
  palette: Record<'background' | 'floor' | 'wall' | 'edge' | 'p1' | 'p2' | 'weld' | 'ink', string>;
  presentation: { boxIdentityLabels: boolean };
  sheets: Record<
    string,
    { file: string; width: number; height: number; bytes: number; sha256: string }
  >;
  sprites: Record<string, ThemeSprite>;
  animations: Record<
    string,
    { frames: string[]; fps: number; loop: boolean; visibility?: 'after-success-only' }
  >;
}
export const ROLE_IDS = {
  floor: 'tile.floor',
  wall: 'wall.solid',
  box: 'crate.neutral',
  mirror: 'mirror.backslash.off',
  p1: 'player.p1.idle.south.0',
  p2: 'player.p2.idle.south.0',
  ice: 'tile.ice',
} as const;
export type AssetRole = keyof typeof ROLE_IDS;
export const REQUIRED_SPRITES = [
  ...Object.values(ROLE_IDS),
  'crate.p1',
  'crate.p2',
  'replay.neutral.crate',
  ...['slash', 'backslash'].flatMap((d) => ['off', 'on'].map((s) => `mirror.${d}.${s}`)),
  ...['floor.seam', 'floor.detail', 'ice.shimmer'].map((s) => 'tile.' + s),
  ...[
    'horizontal',
    'vertical',
    'outer.ne',
    'outer.se',
    'outer.sw',
    'outer.nw',
    'inner.ne',
    'inner.se',
    'inner.sw',
    'inner.nw',
  ].map((s) => 'wall.' + s),
  ...['neutral', 'p1', 'p2'].flatMap((p) =>
    ['up', 'press1', 'press2', 'held', 'release1', 'release2'].map((s) => `switch.${p}.${s}`),
  ),
  ...['neutral', 'p1', 'p2'].flatMap((p) =>
    ['closed', 'opening1', 'opening2', 'opening3', 'open', 'entry'].map((s) => `exit.${p}.${s}`),
  ),
  ...['emitter.off', 'emitter.on', 'receiver.off', 'receiver.on'].flatMap((s) =>
    ['north', 'east', 'south', 'west'].map((d) => `laser.${s}.${d}`),
  ),
  ...[
    'beam.horizontal',
    'beam.vertical',
    'bend.ne',
    'bend.se',
    'bend.sw',
    'bend.nw',
    'cap.horizontal',
    'cap.vertical',
  ].map((s) => 'laser.' + s),
  ...['p1', 'p2'].flatMap((p) =>
    [
      'path.h',
      'path.v',
      'destination',
      'crate',
      'forward',
      'reverse',
      'clockwise',
      'counterclockwise',
    ].map((s) => `replay.${p}.${s}`),
  ),
  'ui.emblem',
  'ui.wallet',
  'avatar.default',
  'avatar.missing',
  'avatar.demo.atlas',
  'avatar.demo.nova',
  'role.p1',
  'role.p2',
  ...['connecting', 'waiting', 'ready', 'disconnected', 'reconnecting', 'full'].map(
    (s) => 'status.' + s,
  ),
  'notice.invalid',
  'notice.shared',
];
export const REQUIRED_ANIMATIONS = ['p1', 'p2']
  .flatMap((p) =>
    ['idle', 'walk', 'shove', 'recoil', 'hit', 'death', 'exit', 'victory'].flatMap((a) =>
      ['south', 'north', 'west', 'east'].map((d) => `player.${p}.${a}.${d}`),
    ),
  )
  .concat(
    [
      'shove',
      'footsteps',
      'iceSlide',
      'catapult',
      'laserDeath',
      'paradox',
      'weld',
      'victory',
      'impact',
      'emission',
    ].map((a) => 'fx.' + a),
  );
/** Data-only boundary: theme content never supplies game rules, markup, scripts or arbitrary URLs. */
export function validateTheme(value: unknown): ThemeManifest {
  const m = value as ThemeManifest;
  const fail = (why: string): never => {
    throw new Error('Invalid theme pack: ' + why);
  };
  if (
    !m ||
    m.schemaVersion !== 1 ||
    !/^[a-z0-9_-]{1,32}$/.test(m.id) ||
    !/^\d+\.\d+\.\d+$/.test(m.version) ||
    typeof m.name !== 'string' ||
    m.name.length > 80
  )
    fail('identity');
  if (
    !m.palette ||
    !['background', 'floor', 'wall', 'edge', 'p1', 'p2', 'weld', 'ink'].every((k) =>
      /^#[\da-f]{6}$/i.test(m.palette[k as keyof typeof m.palette]),
    )
  )
    fail('palette');
  if (
    !m.sheets ||
    !m.sprites ||
    !m.animations ||
    Object.keys(m.sheets).length > 64 ||
    Object.keys(m.sprites).length > 2048
  )
    fail('catalog');
  let total = 0;
  for (const s of Object.values(m.sheets)) {
    if (
      !/^sheets\/[a-z0-9_-]+\.png$/.test(s.file) ||
      !Number.isSafeInteger(s.width) ||
      !Number.isSafeInteger(s.height) ||
      s.width < 1 ||
      s.height < 1 ||
      s.width > 8192 ||
      s.height > 8192 ||
      !Number.isSafeInteger(s.bytes) ||
      s.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(s.sha256)
    )
      fail('sheet');
    total += s.bytes;
  }
  if (total > 128 * 1024 * 1024) fail('pack exceeds 128 MiB');
  for (const [id, s] of Object.entries(m.sprites)) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(id) || !s || !m.sheets[s.sheet] || !s.frame || !s.render)
      fail('sprite ' + id);
    const r = s.frame,
      t = m.sheets[s.sheet];
    if (
      ![r.x, r.y, r.w, r.h].every(Number.isSafeInteger) ||
      r.x < 0 ||
      r.y < 0 ||
      r.w < 1 ||
      r.h < 1 ||
      r.x + r.w > t.width ||
      r.y + r.h > t.height
    )
      fail('frame bounds');
    if (
      ![s.render.width, s.render.height].every((n) => Number.isFinite(n) && n > 0 && n <= 4) ||
      ![s.render.originX, s.render.originY].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      fail('render metrics');
  }
  for (const role of REQUIRED_SPRITES) if (!m.sprites[role]) fail('missing ' + role);
  for (const id of REQUIRED_ANIMATIONS) if (!m.animations[id]) fail('missing animation ' + id);
  for (const a of Object.values(m.animations))
    if (
      !Array.isArray(a.frames) ||
      !a.frames.length ||
      a.frames.length > 60 ||
      !a.frames.every((id) => m.sprites[id]) ||
      !Number.isFinite(a.fps) ||
      a.fps < 1 ||
      a.fps > 60 ||
      typeof a.loop !== 'boolean'
    )
      fail('animation');
  if (m.animations['fx.weld']?.visibility !== 'after-success-only') fail('weld visibility policy');
  if (typeof m.presentation?.boxIdentityLabels !== 'boolean') fail('presentation');
  return m;
}
export interface Deployment {
  reference: string | null;
  gateway: string;
  verifiedAt: string | null;
  manifestSha256: string | null;
}
export function validateDeployment(d: Deployment) {
  if (d.reference !== null && !/^[a-f0-9]{64}$/.test(d.reference))
    throw new Error('Invalid Swarm reference');
  const url = new URL(d.gateway);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  )
    throw new Error('Invalid asset gateway');
  return d;
}
export function spriteUrl(theme: ThemeManifest, deployment: Deployment, sheet: string) {
  const file = theme.sheets[sheet]?.file;
  if (!file) throw new Error('Unknown sprite sheet');
  return deployment.reference
    ? `${deployment.gateway.replace(/\/$/, '')}/bzz/${deployment.reference}/${file}`
    : `/themes/${theme.id}/${file}`;
}
