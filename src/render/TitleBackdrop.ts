import Phaser from 'phaser';
import { themeImage, themeSprite, animationKey, type EnvironmentPack } from './environment';
import { FLOOR_DEPTH, worldDepth, type WorldLayer } from './depth';
/** Decorative orthogonal chamber. Uses the same manifest as gameplay and the editor. */
export class TitleBackdrop {
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private scene: Phaser.Scene) {}

  draw(width: number, height: number, pack: EnvironmentPack) {
    this.clear();
    const narrow = width < 700,
      t = Math.min(width / (narrow ? 11 : 18), height / 12, 85),
      ox = width * (narrow ? 0.53 : 0.72) - t * 3.5,
      oy = height * 0.48 - t * 1.5;
    const at = (col: number, row: number): [number, number] => [
      ox + (col + 0.5) * t,
      oy + (row + 0.5) * t,
    ];
    const image = (id: string, col: number, row: number, layer: WorldLayer | number = 'solid') => {
      const [x, y] = at(col, row),
        o = themeImage(this.scene, pack, id, x, y, t)
          .setDepth(typeof layer === 'number' ? layer : worldDepth(y, layer))
          .setAlpha(narrow ? 0.48 : 0.95);
      this.objects.push(o);
      return o;
    };
    for (let col = 0; col < 7; col++)
      for (let row = 0; row < 3; row++) image('tile.floor', col, row, FLOOR_DEPTH);
    for (const [col, row] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [5, 0],
      [1, 2],
      [3, 2],
      [4, 2],
      [5, 2],
      [6, 2],
    ])
      image('wall.solid', col, row, 'wall');
    image('exit.p1.closed', 4, 0);
    image('exit.p2.closed', 2, 2);
    image('crate.neutral', 2, 1);
    image('switch.p1.up', 5, 1, 'switch');
    image('switch.p2.up', 1, 1, 'switch');
    for (const [owner, col, row] of [
      ['p1', 0, 2],
      ['p2', 6, 0],
    ] as const) {
      const [x, y] = at(col, row),
        actor = themeSprite(this.scene, pack, `player.${owner}.idle.south.0`, x, y + t * 0.36, t)
          .setDepth(worldDepth(y, 'actor'))
          .setAlpha(narrow ? 0.65 : 1);
      this.objects.push(actor);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        actor.play(animationKey(pack, `player.${owner}.idle.south`));
    }
  }

  clear() {
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }
}
