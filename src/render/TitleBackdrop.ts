import Phaser from 'phaser';
import { textureKey, type EnvironmentPack } from './environment';
/** Decorative title diorama. It never loads or advances a multiplayer room. */
export class TitleBackdrop {
  private objects:Phaser.GameObjects.GameObject[]=[];
  private tweens:Phaser.Tweens.Tween[]=[];
  constructor(private scene:Phaser.Scene){}
  draw(width:number,height:number,pack:EnvironmentPack){
    this.clear();
    const g=this.scene.add.graphics();this.objects.push(g);
    const p=pack.palette,narrow=width<700;
    const cx=width*(narrow ? .83 : .73),cy=height*.50;
    const scale=Math.min(width/(narrow?640:1450),height/850,1.3),unit=66*scale;
    g.lineStyle(1,p.edge,.13);
    for(let x=0;x<width;x+=48)g.lineBetween(x,0,x,height);
    for(let y=0;y<height;y+=48)g.lineBetween(0,y,width,y);
    for(let i=0;i<55;i++){
      const x=(i*197+37)%width,y=(i*109+53)%height;
      g.fillStyle(i%3?p.p1:p.p2,.08).fillRect(x,y,2,2);
    }
    const project=(x:number,y:number):[number,number]=>[cx+(x-y)*unit*.71,cy+(x+y)*unit*.36];
    const polygon=(x:number,y:number,color:number,alpha:number)=>{
      const a=project(x,y),b=project(x+1,y),c=project(x+1,y+1),d=project(x,y+1);
      g.fillStyle(color,alpha).fillPoints([new Phaser.Math.Vector2(...a),new Phaser.Math.Vector2(...b),new Phaser.Math.Vector2(...c),new Phaser.Math.Vector2(...d)],true);
      g.lineStyle(1,p.edge,.75).strokePoints([new Phaser.Math.Vector2(...a),new Phaser.Math.Vector2(...b),new Phaser.Math.Vector2(...c),new Phaser.Math.Vector2(...d)],true);
    };
    for(let y=-4;y<4;y++)for(let x=-4;x<4;x++){
      if((x===-1||x===0)&&(y===-1||y===0))continue;
      polygon(x,y,(x+y)%2?p.floor:p.wall,.9);
    }
    // Platform edges and the two opposing paths through the chamber.
    const corners=[project(-4,-4),project(4,-4),project(4,4),project(-4,4)];
    g.lineStyle(2,p.edge,.7).strokePoints(corners.map(v=>new Phaser.Math.Vector2(...v)),true);
    for(const [side,color] of [[-1,p.p1],[1,p.p2]] as const){
      const start=project(side*3,side*2),end=project(side*.7,side*.4);
      g.lineStyle(2,color,.25).lineBetween(...start,...end);
      for(let i=0;i<7;i++){const t=i/7;g.fillStyle(color,.55).fillCircle(start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t,2*scale);}
    }
    // A physical weld aperture, used only as title artwork.
    g.fillStyle(0x060d10,.8).fillEllipse(cx,cy,unit*1.7,unit*.82);
    g.lineStyle(2,p.weld,.5).strokeEllipse(cx,cy,unit*1.7,unit*.82);
    g.lineStyle(1,p.p1,.13).strokeEllipse(cx,cy-unit*.5,unit*3.9,unit*4.6);
    g.lineStyle(2,p.p1,.35).strokeEllipse(cx-3*scale,cy-unit*.6,unit*3,unit*4);
    g.lineStyle(1,p.p2,.45).strokeEllipse(cx+4*scale,cy-unit*.6,unit*3.13,unit*4.12);
    g.lineStyle(10,p.p1,.035).strokeEllipse(cx,cy-unit*.6,unit*3.05,unit*4.05);
    const actor=(x:number,y:number,role:'p1'|'p2')=>{
      const [px,py]=project(x,y);
      const image=this.scene.add.image(px,py-unit*.65,textureKey(pack,role)).setDisplaySize(unit*1.35,unit*1.35);this.objects.push(image);
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)this.tweens.push(this.scene.tweens.add({targets:image,y:image.y-7*scale,duration:2300,ease:'Sine.InOut',yoyo:true,repeat:-1,delay:role==='p2'?700:0}));
    };
    actor(-2.7,-1.7,'p1');actor(2.5,1.6,'p2');
    for(const [x,y] of [[-3,1],[1,-3],[2,0]]){
      const [px,py]=project(x,y);const image=this.scene.add.image(px,py-unit*.4,textureKey(pack,'box')).setDisplaySize(unit*.84,unit*.84).setAlpha(.65);this.objects.push(image);
    }
  }
  clear(){this.tweens.forEach(t=>t.remove());this.tweens=[];this.objects.forEach(o=>o.destroy());this.objects=[];}
}
