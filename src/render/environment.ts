import Phaser from 'phaser';
import { environments, semantic, type ThemePack } from '../assets/catalog';
import { spriteUrl, type AssetRole } from '../assets/schema';
import { artworkSheetKey } from '../assets/ArtworkLoader';
export { environments };
export type { AssetRole };
export type EnvironmentPack = ThemePack;
export const sheetKey = artworkSheetKey;
export const animationKey = (pack: ThemePack, id: string) =>
  `${pack.id}@${pack.manifest.version}:${id}`;
/** Abort both the remote read and image decoding when a theme attempt ends. */
export async function loadEnvironmentSheet(
  scene: Phaser.Scene,
  pack: ThemePack,
  id: string,
  signal: AbortSignal,
) {
  const response = await fetch(spriteUrl(pack.manifest, pack.deployment, id), { signal });
  if (!response.ok) throw new Error(`Artwork read failed: ${id}`);
  const blob = await response.blob();
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.onload = image.onerror = null;
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        image.src = '';
        reject(signal.reason);
      };
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(new Error(`Artwork decode failed: ${id}`));
      };
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    signal.throwIfAborted();
    if (!scene.textures.addImage(sheetKey(pack, id), image))
      throw new Error(`Artwork registration failed: ${id}`);
  } finally {
    URL.revokeObjectURL(url);
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
