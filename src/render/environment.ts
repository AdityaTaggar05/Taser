import Phaser from 'phaser';

export type AssetRole = 'floor' | 'wall' | 'box' | 'mirror' | 'p1' | 'p2' | 'ice';
export interface EnvironmentPack {
  id: string;
  palette: { background: number; floor: number; wall: number; edge: number; p1: number; p2: number; weld: number; ink: number };
  /** Drop PNG/WebP sprites into public/assets and map their URL here. Rules never inspect textures. */
  assets: Partial<Record<AssetRole, string>>;
}
export const environments: Record<string, EnvironmentPack> = {
  foundry: { id: 'foundry', palette: { background: 0x10191c, floor: 0x263437, wall: 0x152125, edge: 0x3b4a4c, p1: 0x75ddd0, p2: 0xf0ac65, weld: 0xe6d79f, ink: 0xd3ded9 }, assets: {} },
  orbital: { id: 'orbital', palette: { background: 0x121824, floor: 0x293347, wall: 0x172030, edge: 0x414d66, p1: 0x91bcff, p2: 0xeeaccc, weld: 0xeee3a5, ink: 0xd9e2f1 }, assets: {} },
};
export const textureKey = (pack: EnvironmentPack, role: AssetRole) => `${pack.id}:${role}`;
export function preloadEnvironment(scene: Phaser.Scene, pack: EnvironmentPack) {
  for (const [role,url] of Object.entries(pack.assets)) if (!scene.textures.exists(textureKey(pack,role as AssetRole))) scene.load.image(textureKey(pack,role as AssetRole),url);
}
/** Built-in vector art is generated as textures; a production pack can replace any role. */
export function buildEnvironment(scene: Phaser.Scene, pack: EnvironmentPack) {
  const p = pack.palette;
  for (const role of ['floor','wall','box','mirror','p1','p2','ice'] as AssetRole[]) {
    const key = textureKey(pack,role); if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({x:0,y:0});
    if (role === 'floor' || role === 'ice') {
      g.fillStyle(role === 'ice' ? 0x315a64 : p.floor).fillRect(1,1,94,94);
      g.lineStyle(1,p.edge,0.65).strokeRect(1,1,94,94);
      g.lineStyle(1,0xffffff,0.035).lineBetween(6,6,89,6);
      g.fillStyle(0x000000,0.17).fillRect(5,88,86,3);
      for (const [x,y] of [[8,8],[87,8],[8,87],[87,87]]) g.fillStyle(p.edge,0.8).fillCircle(x,y,1.4);
      if (role === 'ice') { g.lineStyle(2,0x91d9e5,0.35); for (let i=0;i<3;i++) g.lineBetween(16+i*22,72,36+i*22,28); }
    } else if (role === 'wall') {
      g.fillStyle(0x090f12,0.7).fillRect(2,6,92,89);
      g.fillStyle(p.wall).fillRect(2,1,92,85); g.fillStyle(p.edge,0.45).fillRect(2,1,92,5);
      g.lineStyle(1,p.edge,0.55).strokeRect(3,2,90,83);
      g.lineStyle(1,p.edge,0.20); for (let i=-64;i<96;i+=15) g.lineBetween(Math.max(i,8), Math.max(8,8-i), Math.min(i+70,88),Math.min(78,88-i));
      g.fillStyle(p.wall).fillRect(24,24,48,39); g.lineStyle(1,p.edge,0.3).strokeRect(24,24,48,39);
      g.fillStyle(p.edge,0.55).fillRect(38,42,20,3);
    } else if (role === 'box' || role === 'mirror') {
      g.fillStyle(0x000000,0.4).fillRoundedRect(10,15,78,77,6);
      g.fillStyle(0x9d9b83).fillRoundedRect(9,7,78,77,5); g.fillStyle(0x414b45).fillRect(17,15,62,60);
      g.lineStyle(3,0xbabb9c).strokeRect(18,16,60,58);
      if (role === 'mirror') { g.lineStyle(10,0xc7e9e3).lineBetween(24,23,72,68); g.lineStyle(2,0xffffff,0.8).lineBetween(22,26,68,70); }
      else { g.lineStyle(5,0x858e79).lineBetween(21,19,75,71).lineBetween(75,19,21,71); g.fillStyle(0x414b45).fillRect(35,33,26,25); }
      for (const [x,y] of [[14,12],[82,12],[14,78],[82,78]]) g.fillStyle(0xd7d5b4).fillCircle(x,y,2);
    } else {
      const color = role === 'p1' ? p.p1 : p.p2;
      g.fillStyle(0x000000,0.45).fillEllipse(48,78,51,19);
      g.fillStyle(0x202c2e).fillRoundedRect(25,37,46,39,9);
      g.fillStyle(color).fillRoundedRect(28,37,40,34,7);
      g.fillStyle(0x253336).fillRoundedRect(30,19,36,32,11); g.lineStyle(3,color).strokeRoundedRect(30,19,36,32,11);
      g.fillStyle(color).fillRoundedRect(36,28,24,10,3);
      g.fillStyle(0xeef3e4).fillRect(38,29,13,3);
      g.fillStyle(0x172326).fillRoundedRect(30,66,13,15,3).fillRoundedRect(53,66,13,15,3);
      g.fillStyle(color,0.8).fillRoundedRect(19,44,9,20,3).fillRoundedRect(68,44,9,20,3);
    }
    g.generateTexture(key,96,96); g.destroy();
  }
}
