import Phaser from 'phaser';
import { environments, semantic, type ThemePack } from '../assets/catalog';
import { spriteUrl, type AssetRole } from '../assets/schema';
export { environments };
export type { AssetRole };
export type EnvironmentPack = ThemePack;
const queued = new WeakMap<Phaser.Scene, Set<string>>();
export const sheetKey = (pack: ThemePack, id: string) =>
  `${pack.id}@${pack.manifest.version}:${id}`;
export const animationKey = (pack: ThemePack, id: string) =>
  `${pack.id}@${pack.manifest.version}:${id}`;
export function preloadEnvironment(scene: Phaser.Scene, pack: ThemePack) {
  let seen = queued.get(scene);
  if (!seen) {
    seen = new Set();
    queued.set(scene, seen);
  }
  scene.load.crossOrigin = 'anonymous';
  for (const id of new Set(Object.values(pack.manifest.sprites).map((s) => s.sheet))) {
    const key = sheetKey(pack, id);
    if (seen.has(key) || scene.textures.exists(key)) continue;
    seen.add(key);
    scene.load.image(key, spriteUrl(pack.manifest, pack.deployment, id));
  }
}
/** Register original source rectangles; never synthesize replacement artwork. */
export function buildEnvironment(scene: Phaser.Scene, pack: ThemePack) {
  for (const [id, sprite] of Object.entries(pack.manifest.sprites)) {
    const key = sheetKey(pack, sprite.sheet);
    if (!scene.textures.exists(key)) throw new Error(`Theme artwork unavailable: ${sprite.sheet}`);
    const texture = scene.textures.get(key),
      r = sprite.frame;
    if (!texture.has(id)) texture.add(id, 0, r.x, r.y, r.w, r.h);
  }
  for (const [id, a] of Object.entries(pack.manifest.animations)) {
    const key = animationKey(pack, id);
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: a.frames.map((frame) => ({
        key: sheetKey(pack, pack.manifest.sprites[frame].sheet),
        frame,
      })),
      frameRate: a.fps,
      repeat: a.loop ? -1 : 0,
    });
  }
}
export function themeImage(
  scene: Phaser.Scene,
  pack: ThemePack,
  id: string,
  x: number,
  y: number,
  tile: number,
) {
  id = semantic(id);
  const sprite = pack.manifest.sprites[id];
  if (!sprite) throw new Error('Unknown theme sprite: ' + id);
  const r = sprite.render;
  return scene.add
    .image(x, y, sheetKey(pack, sprite.sheet), id)
    .setDisplaySize(tile * r.width, tile * r.height)
    .setOrigin(r.originX, r.originY);
}
export function themeSprite(
  scene: Phaser.Scene,
  pack: ThemePack,
  id: string,
  x: number,
  y: number,
  tile: number,
) {
  id = semantic(id);
  const sprite = pack.manifest.sprites[id];
  if (!sprite) throw new Error('Unknown theme sprite: ' + id);
  const r = sprite.render;
  return scene.add
    .sprite(x, y, sheetKey(pack, sprite.sheet), id)
    .setDisplaySize(tile * r.width, tile * r.height)
    .setOrigin(r.originX, r.originY);
}
export function playEffect(
  scene: Phaser.Scene,
  pack: ThemePack,
  id: string,
  x: number,
  y: number,
  size: number,
  tint?: number,
) {
  const effect = themeSprite(scene, pack, id + '.0', x, y, size).setDepth(5);
  if (tint !== undefined) effect.setTint(tint);
  effect
    .play(animationKey(pack, id))
    .once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => effect.destroy());
  return effect;
}
