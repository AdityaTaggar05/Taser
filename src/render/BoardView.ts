import Phaser from 'phaser';
import type {GameEngine} from '../core/engine';
import {computeLaserTiles} from '../core/engine';
import {hasCoord,sameCoord,type Coord,type StepSnapshot} from '../core/types';
import {themeImage,themeSprite,animationKey,playEffect,type EnvironmentPack} from './environment';
import {BACKDROP_DEPTH,FLOOR_DEPTH,REPLAY_DEPTH,worldDepth,type WorldLayer} from './depth';
export interface BoardRect{x:number;y:number;width:number;height:number}
type Facing='north'|'south'|'east'|'west';
const face=(a:Coord,b:Coord):Facing=>b[0]>a[0]?'east':b[0]<a[0]?'west':b[1]>a[1]?'north':'south';
export class BoardView{
  private objects:Phaser.GameObjects.GameObject[]=[];
  private frame:Phaser.GameObjects.Graphics;
  private tile=64;private ox=0;private oy=0;private facings:[Facing,Facing]=['south','south'];
  constructor(private scene:Phaser.Scene,readonly index:0|1|2){this.frame=scene.add.graphics().setDepth(BACKDROP_DEPTH);}
  private keep<T extends Phaser.GameObjects.GameObject>(o:T):T{this.objects.push(o);return o;}
  private at(c:Coord):[number,number]{return [this.ox+(c[0]-.5)*this.tile,this.oy-(c[1]-.5)*this.tile];}
  private image(pack:EnvironmentPack,id:string,x:number,y:number,size=this.tile,layer:WorldLayer|number='solid'){return this.keep(themeImage(this.scene,pack,id,x,y,size).setDepth(typeof layer==='number'?layer:worldDepth(y,layer)));}
  private effect(pack:EnvironmentPack,id:string,x:number,y:number,size=this.tile,tint?:number){return this.keep(playEffect(this.scene,pack,id,x,y,size,tint).setDepth(worldDepth(y,'effect')));}
  render(engine:Pick<GameEngine,'level'|'state'|'lastShoves'|'exitOpen'|'nextBoxes'>,rect:BoardRect,pack:EnvironmentPack,previous?:StepSnapshot,animate=false){
    this.objects.forEach(o=>o.destroy());this.objects=[];this.frame.clear();
    const l=engine.level,s=engine.state,p=pack.palette;
    this.tile=Math.min((rect.width-34)/l.width,(rect.height-60)/l.height,112);
    this.ox=rect.x+(rect.width-l.width*this.tile)/2;this.oy=rect.y+rect.height/2+l.height*this.tile/2;
    const t=this.tile,boxes=this.index===1?s.boxesP2:s.boxesP1,laser=computeLaserTiles(boxes,l),secondLaser=this.index===2?computeLaserTiles(s.boxesP2,l):laser;
    this.frame.fillStyle(p.background,.4).fillRect(rect.x,rect.y,rect.width,rect.height);
    for(let x=1;x<=l.width;x++)for(let y=1;y<=l.height;y++){
      const pos:Coord=[x,y],[cx,cy]=this.at(pos);this.image(pack,hasCoord(l.iceTiles,pos)?'tile.ice':'tile.floor',cx,cy,t,FLOOR_DEPTH);
      if(hasCoord(l.walls,pos))this.image(pack,'wall.solid',cx,cy,t,'wall');
    }
    for(const player of [1,2] as const){
      if(this.index!==2&&player!==this.index+1)continue;
      const own=this.index===2?(player===1?s.boxesP1:s.boxesP2):boxes,owner='p'+player;
      for(const pos of player===1?l.switchesP1:l.switchesP2){const [x,y]=this.at(pos);this.image(pack,`switch.${owner}.${hasCoord(own,pos)?'held':'up'}`,x,y,t,'switch');}
      const pos=player===1?l.exitP1:l.exitP2,[x,y]=this.at(pos);
      const open=this.index===2?engine.exitOpen(player):engine.exitOpen(player,{...s,boxesP1:boxes,boxesP2:boxes});
      this.image(pack,`exit.${owner}.${open?'open':'closed'}`,x,y,t);
    }
    if(l.laserEmitter){const [x,y]=this.at(l.laserEmitter.pos),direction=({U:'north',D:'south',L:'west',R:'east',W:'south'} as const)[l.laserEmitter.dir];if(this.index===2){this.drawLaser(pack,laser,p.p1);this.drawLaser(pack,secondLaser,p.p2);}else this.drawLaser(pack,laser);this.image(pack,`laser.emitter.on.${direction}`,x,y,t*.83);}
    if(l.laserReceiverP1&&this.index!==1){const [x,y]=this.at(l.laserReceiverP1);this.image(pack,`laser.receiver.${hasCoord(laser,l.laserReceiverP1)?'on':'off'}.north`,x,y,t*.83);}
    const trajectory=(player:1|2)=>{
      const next=engine.nextBoxes(player);if(!next)return;const current=player===1?s.boxesP1:s.boxesP2;
      next.forEach((pos,i)=>{if(sameCoord(pos,current[i]))return;const [ax,ay]=this.at(current[i]),[bx,by]=this.at(pos),dist=Math.hypot(bx-ax,by-ay),angle=Math.atan2(by-ay,bx-ax);
        for(let d=t*.4;d<dist-t*.3;d+=t*.5)this.image(pack,`replay.p${player}.path.h`,ax+Math.cos(angle)*d,ay+Math.sin(angle)*d,t*.55,REPLAY_DEPTH).setRotation(angle).setAlpha(.65);
        this.image(pack,`replay.p${player}.destination`,bx,by,t*.9,REPLAY_DEPTH).setAlpha(.65);
      });
    };
    if(this.index===2){trajectory(1);trajectory(2);}else trajectory(this.index===0?1:2);
    const drawBoxes=(coords:Coord[],player:1|2,old:Coord[]|undefined,alpha=1,indexOffset=0,count=coords.length)=>coords.forEach((pos,i)=>{
      const [x,y]=this.at(pos),lit=hasCoord(this.index===2&&player===2?secondLaser:laser,pos),shared=this.index===2&&hasCoord(player===1?s.boxesP2:s.boxesP1,pos),offset=shared?(player===1?-.17:.17)*t:0;
      const id=l.hasMirrorBox?`mirror.backslash.${lit?'on':'off'}`:`crate.p${player}`;
      const image=this.image(pack,id,x+offset,y,t*(shared?0.65:1)).setAlpha(alpha);
      if(animate&&old&&!sameCoord(old[i],pos)){const [px,py]=this.at(old[i]);image.setPosition(px,py).setDepth(worldDepth(py,'solid'));this.scene.tweens.add({targets:image,x,y,duration:210,ease:'Cubic.Out',onUpdate:()=>image.setDepth(worldDepth(image.y,'solid'))});
        if(s.step>l.weldStep)this.effect(pack,'fx.catapult',(px+x)/2,(py+y)/2,t,player===1?p.p1:p.p2).setRotation(Math.atan2(y-py,x-px)+Math.PI);
      }
      if(count>1&&pack.manifest.presentation.boxIdentityLabels)this.keep(this.scene.add.text(x,y,String.fromCharCode(65+i+indexOffset),{fontFamily:'monospace',fontSize:t*.18,color:pack.manifest.palette.ink}).setOrigin(.5).setDepth(worldDepth(y,'label')));
    });
    if(this.index===2){drawBoxes(s.boxesP1,1,previous?.boxesP1,.9);s.boxesP2.forEach((pos,i)=>drawBoxes([pos],2,previous?[previous.boxesP2[i]]:undefined,.9,i,s.boxesP2.length));}
    else drawBoxes(boxes,this.index===0?1:2,this.index===0?previous?.boxesP1:previous?.boxesP2);
    const actor=(player:1|2,alpha=1)=>{
      const pos=player===1?s.p1Pos:s.p2Pos,old=player===1?previous?.p1Pos:previous?.p2Pos,[x,y]=this.at(pos),owner='p'+player;
      const shoved=engine.lastShoves[player-1],moved=!!old&&!sameCoord(old,pos);
      if(moved)this.facings[player-1]=face(old!,pos);
      else if(animate&&shoved!==null&&previous){const target=(player===1?previous.boxesP1:previous.boxesP2)[shoved];if(target)this.facings[player-1]=face(pos,target);}
      const facing=this.facings[player-1],anim=(action:string)=>animationKey(pack,`player.${owner}.${action}.${facing}`);
      const shared=this.index===2&&sameCoord(s.p1Pos,s.p2Pos),scale=shared?0.68:1,offset=shared?(player===1?-.18:.18)*t:0;
      const image=this.keep(themeSprite(this.scene,pack,`player.${owner}.idle.${facing}.0`,x+offset,y+t*.36*scale,t*scale).setDepth(worldDepth(y,'actor')).setAlpha(alpha));
      const idle=()=>{if(image.active)image.play(anim('idle'));};
      if(s.status==='VICTORY')image.play(anim('victory'));
      else if(!['PLAYING_PHASE_1','PLAYING_PHASE_2','WELD_SUCCESS'].includes(s.status))image.play(anim('death'));
      else if(animate&&moved){image.play(anim('walk'));const [px,py]=this.at(old!);image.setPosition(px,py+t*.36).setDepth(worldDepth(py,'actor'));this.scene.tweens.add({targets:image,x,y:y+t*.36,duration:180,ease:'Linear',onUpdate:()=>image.setDepth(worldDepth(image.y-t*.36,'actor')),onComplete:idle});this.effect(pack,hasCoord(l.iceTiles,pos)?'fx.iceSlide':'fx.footsteps',px,py+t*.2,t*.7,player===1?p.p1:p.p2);}
      else if(animate&&shoved!==null){image.play(anim('shove')).once(Phaser.Animations.Events.ANIMATION_COMPLETE,()=>{if(image.active)image.play(anim('recoil')).once(Phaser.Animations.Events.ANIMATION_COMPLETE,idle);});this.effect(pack,'fx.shove',x,y,t,player===1?p.p1:p.p2).setRotation(({east:0,south:Math.PI/2,west:Math.PI,north:-Math.PI/2})[facing]);}
      else idle();
    };
    if(this.index===2){actor(1,.85);actor(2,.85);}else actor(this.index===0?1:2);
    // Show only after an already-confirmed event. Never reveal a pre-weld target.
    if(animate&&previous&&previous.status!==s.status){
      if(s.status==='WELD_SUCCESS')for(const pos of boxes){const [x,y]=this.at(pos);this.effect(pack,'fx.weld',x,y,t*1.3);}
      else if(s.status==='VICTORY'){const [x,y]=this.at(this.index===1?s.p2Pos:s.p1Pos);this.effect(pack,'fx.victory',x,y,t*1.8);}
      else if(s.status==='LASER_DEATH'){const [x,y]=this.at(this.index===1?s.p2Pos:s.p1Pos);this.effect(pack,'fx.laserDeath',x,y,t*1.4);}
      else if(s.status.startsWith('PARADOX')){const [x,y]=this.at(this.index===1?s.p2Pos:s.p1Pos);this.effect(pack,'fx.paradox',x,y,t*1.4);}
    }
  }
  private drawLaser(pack:EnvironmentPack,tiles:Coord[],tint?:number){
    const t=this.tile;tiles.forEach((pos,i)=>{if(i===0)return;const [x,y]=this.at(pos),before=tiles[i-1],after=tiles[i+1];
      const incoming=face(pos,before),outgoing=after?face(pos,after):incoming;let id=incoming==='east'||incoming==='west'?'laser.beam.horizontal':'laser.beam.vertical';
      if(after&&before[0]!==after[0]&&before[1]!==after[1]){const dirs=[incoming,outgoing];id='laser.bend.'+(dirs.includes('north')?(dirs.includes('east')?'ne':'nw'):(dirs.includes('east')?'se':'sw'));}
      const image=this.image(pack,id,x,y,t,'beam');if(tint!==undefined)image.setTint(tint).setAlpha(.75);if(id==='laser.beam.horizontal')image.setDisplaySize(t*1.03,t*.09);else if(id==='laser.beam.vertical')image.setDisplaySize(t*.09,t*1.03);else image.setDisplaySize(t,t);
    });
  }
  destroy(){this.objects.forEach(o=>o.destroy());this.frame.destroy();}
}
