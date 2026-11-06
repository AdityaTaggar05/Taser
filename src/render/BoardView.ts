import Phaser from 'phaser';
import type { GameEngine } from '../core/engine';
import { computeLaserTiles } from '../core/engine';
import { hasCoord, sameCoord, type Coord, type StepSnapshot } from '../core/types';
import { textureKey, type EnvironmentPack } from './environment';

export interface BoardRect { x: number; y: number; width: number; height: number }
export class BoardView {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private graphics: Phaser.GameObjects.Graphics;
  private frame: Phaser.GameObjects.Graphics;
  private tile = 64; private ox = 0; private oy = 0;
  constructor(private scene: Phaser.Scene, readonly index: 0|1|2) { this.frame = scene.add.graphics().setDepth(-2); this.graphics = scene.add.graphics().setDepth(0); }
  private keep<T extends Phaser.GameObjects.GameObject>(obj: T): T { this.objects.push(obj); return obj; }
  private text(x:number,y:number,value:string,size=11,color='#889a98') {
    return this.keep(this.scene.add.text(x,y,value,{fontFamily:'monospace',fontSize:size,color}).setOrigin(0.5).setDepth(3));
  }
  private at(c: Coord): [number,number] { return [this.ox+(c[0]-0.5)*this.tile,this.oy-(c[1]-0.5)*this.tile]; }
  render(engine: Pick<GameEngine, 'level' | 'state' | 'lastShoves' | 'exitOpen' | 'nextBoxes'>, rect: BoardRect, pack: EnvironmentPack, previous?: StepSnapshot, animate = false) {
    this.objects.forEach(o => o.destroy()); this.objects = []; this.graphics.clear(); this.frame.clear();
    const g = this.graphics, l = engine.level, s = engine.state, p = pack.palette;
    this.tile = Math.min((rect.width-52)/l.width,(rect.height-104)/l.height,112);
    this.ox = rect.x+(rect.width-l.width*this.tile)/2;
    this.oy = rect.y+rect.height/2+l.height*this.tile/2;
    const t = this.tile;
    this.frame.fillStyle(p.background,0.52).fillRect(rect.x,rect.y,rect.width,rect.height);
    this.frame.lineStyle(1,p.edge,0.55).lineBetween(rect.x+rect.width,rect.y+8,rect.x+rect.width,rect.y+rect.height-8);
    const accent = this.index === 0 ? p.p1 : this.index === 1 ? p.p2 : p.weld;
    g.fillStyle(accent).fillRect(rect.x+20,rect.y+20,5,5);
    this.text(rect.x+80,rect.y+23,this.index===0?'01 / FORWARD':this.index===1?'02 / REVERSE':rect.width<300?'INITIAL OVERLAY':'INITIAL CONFIGURATION',rect.width<240?9:11,Phaser.Display.Color.IntegerToColor(accent).rgba).setOrigin(0,0.5).setX(rect.x+34);
    this.text(rect.x+rect.width-21,rect.y+23,this.index===2?(rect.width<300?'': 'SHARED GRID'):`t = ${this.index===0?s.step:l.totalSteps-s.step}`,12,'#c9d6ce').setOrigin(1,0.5);
    for (let x=1;x<=l.width;x++) for (let y=1;y<=l.height;y++) {
      const coord: Coord=[x,y], [cx,cy]=this.at(coord);
      const wall = hasCoord(l.walls,coord), ice = hasCoord(l.iceTiles,coord);
      this.keep(this.scene.add.image(cx,cy,textureKey(pack,wall?'wall':ice?'ice':'floor')).setDisplaySize(t,t).setDepth(-1));
    }
    // Coordinate labels preserve the first-quadrant map convention.
    for(let x=1;x<=l.width;x++) this.text(this.at([x,1])[0],this.oy+15,`${x}`,10);
    for(let y=1;y<=l.height;y++) this.text(this.ox-15,this.at([1,y])[1],`${y}`,10);
    this.text(this.ox-15,this.oy+15,'↗',10,'#d3cfae');
    const boxes = this.index === 1 ? s.boxesP2 : s.boxesP1;
    for(const player of [1,2] as const) {
      // Individual boards show only their operator's objectives.
      if(this.index!==2 && player!==this.index+1) continue;
      const switches = player===1 ? l.switchesP1 : l.switchesP2;
      const color=player===1?p.p1:p.p2;
      for(const coord of switches) {
        const [x,y]=this.at(coord); const held=hasCoord(player===1?s.boxesP1:s.boxesP2,coord);
        g.fillStyle(color,held?0.3:0.08).fillRoundedRect(x-t*.31,y-t*.31,t*.62,t*.62,3);
        g.lineStyle(2,color,held?0.9:0.40).strokeRoundedRect(x-t*.26,y-t*.26,t*.52,t*.52,2);
        this.text(x,y,`S${player}`,t*.15,Phaser.Display.Color.IntegerToColor(color).rgba);
      }
      const exit=player===1?l.exitP1:l.exitP2,[x,y]=this.at(exit);
      const open=this.index===2 ? engine.exitOpen(player) : engine.exitOpen(player,{...s,boxesP1:boxes,boxesP2:boxes});
      g.fillStyle(color,open?0.4:0.07).fillRect(x-t*.38,y-t*.38,t*.76,t*.76);
      g.lineStyle(2,color,open?1:0.3).strokeRect(x-t*.34,y-t*.34,t*.68,t*.68);
      if(!open) { g.lineStyle(2,color,0.25); for(let n=-1;n<=1;n++)g.lineBetween(x+n*t*.16,y-t*.28,x+n*t*.16,y+t*.28); }
      this.text(x,y,`E${player}`,t*.18,open?'#f1f7df':'#9baba2');
    }
    if(l.laserEmitter) {
      const [ex,ey]=this.at(l.laserEmitter.pos);
      for(const player of (this.index===2?[1,2]:[this.index+1])){
        const own=player===1?s.boxesP1:s.boxesP2,laser=computeLaserTiles(own,l),color=this.index===2?(player===1?p.p1:p.p2):0xff8d77;
        g.lineStyle(7,color,0.13);this.laserSegments(laser);g.lineStyle(2,color,0.9);this.laserSegments(laser);
      }
      g.fillStyle(0x71534b).fillRect(ex-t*.32,ey-t*.32,t*.64,t*.64);
      this.text(ex,ey,({D:'▼',U:'▲',L:'◀',R:'▶',W:'·'})[l.laserEmitter.dir],t*.30,'#ffb59b');
    }
    if(l.laserReceiverP1 && this.index!==1) { const [x,y]=this.at(l.laserReceiverP1); g.lineStyle(2,p.p1).strokeCircle(x,y,t*.25); this.text(x,y,'R1',t*.17,'#91d8cc'); }
    const drawTrajectory=(player:1|2,color:number)=>{
      const next=engine.nextBoxes(player); if(!next)return;
      const current=player===1?s.boxesP1:s.boxesP2;
      next.forEach((c,i)=>{
        if(sameCoord(c,current[i]))return;
        const [ax,ay]=this.at(current[i]),[bx,by]=this.at(c), dist=Math.hypot(bx-ax,by-ay);
        g.fillStyle(color,0.65);for(let d=0;d<dist;d+=9)g.fillCircle(ax+(bx-ax)*d/dist,ay+(by-ay)*d/dist,1.5);
        g.lineStyle(1,color,0.7).strokeCircle(bx,by,t*.29);
      });
    };
    if(this.index===2) { drawTrajectory(1,p.p1);drawTrajectory(2,p.p2); }
    else drawTrajectory(this.index===0?1:2,accent);
    const drawBoxes=(coords:Coord[],color:number,old:Coord[]|undefined,alpha=1,offset=0,label=false)=>coords.forEach((coord,i)=>{
      const [x,y]=this.at(coord); const image=this.keep(this.scene.add.image(x,y,textureKey(pack,l.hasMirrorBox?'mirror':'box')).setDisplaySize(t*.87,t*.87).setAlpha(alpha).setDepth(1));
      g.lineStyle(2,color,alpha*.85).strokeRect(x-t*.31,y-t*.33,t*.62,t*.62);
      if(animate&&old&&!sameCoord(old[i],coord)) {const [px,py]=this.at(old[i]);image.setPosition(px,py);this.scene.tweens.add({targets:image,x,y,duration:210,ease:'Cubic.Out'});}
      if(coords.length>1||label)this.text(x,y,String.fromCharCode(65+i+offset),t*.18,'#e9ebd2').setAlpha(alpha);
    });
    if(this.index===2) {drawBoxes(s.boxesP1,p.p1,previous?.boxesP1,.88);s.boxesP2.forEach((c,i)=>{if(!sameCoord(c,s.boxesP1[i]))drawBoxes([c],p.p2,previous?[previous.boxesP2[i]]:undefined,.72,i,s.boxesP2.length>1);else{const [x,y]=this.at(c);g.lineStyle(2,p.p2,.9).strokeRect(x-t*.24,y-t*.25,t*.48,t*.5);}});}
    else drawBoxes(boxes,accent,this.index===0?previous?.boxesP1:previous?.boxesP2);
    const drawPlayer=(player:1|2,alpha=1)=>{
      const pos=player===1?s.p1Pos:s.p2Pos,[x,y]=this.at(pos);
      const shared=this.index===2&&sameCoord(s.p1Pos,s.p2Pos),size=shared?0.62:0.88,offset=shared?(player===1?-.18:.18)*t:0;
      const image=this.keep(this.scene.add.image(x+offset,y,textureKey(pack,player===1?'p1':'p2')).setDisplaySize(t*size,t*size).setAlpha(alpha).setDepth(2));
      const old=player===1?previous?.p1Pos:previous?.p2Pos;
      if(animate&&old) {
        const [px,py]=this.at(old);
        if(!sameCoord(old,pos)){image.setPosition(px,py);this.scene.tweens.add({targets:image,x,y,duration:165,ease:'Sine.Out'});}
        else if(engine.lastShoves[player-1]!==null) {
          const oldBoxes=player===1?previous!.boxesP1:previous!.boxesP2, b=oldBoxes[engine.lastShoves[player-1]!];
          const dx=Math.sign(b[0]-pos[0]),dy=-Math.sign(b[1]-pos[1]);
          this.scene.tweens.add({targets:image,x:x+dx*6,y:y+dy*6,duration:80,yoyo:true});
          const mx=x+dx*t*.40,my=y+dy*t*.40;
          g.lineStyle(3,player===1?p.p1:p.p2).lineBetween(x+dx*t*.28,y+dy*t*.28,mx,my);
          g.fillStyle(player===1?p.p1:p.p2).fillCircle(mx,my,3);
        }
      }
    };
    if(this.index===2){drawPlayer(1,.75);drawPlayer(2,.75);}else drawPlayer(this.index===0?1:2);
    this.text(rect.x+rect.width/2,rect.y+rect.height-17,this.index===0?'P1  ·  WASD / ARROWS  ·  SPACE TO WAIT':this.index===1?'P2  ·  WASD / ARROWS  ·  SPACE TO WAIT':'P1 + P2 · INITIAL POSITIONS ONLY',rect.width<240?8:10);
  }
  destroy(){this.objects.forEach(o=>o.destroy());this.graphics.destroy();this.frame.destroy();}
  private laserSegments(tiles: Coord[]) { for(let i=1;i<tiles.length;i++){const [x,y]=this.at(tiles[i-1]),[nx,ny]=this.at(tiles[i]);this.graphics.lineBetween(x,y,nx,ny);} }
}
