import Phaser from 'phaser';
import './style.css';
import { GameEngine } from './core/engine';
import { levels } from './core/level';
import { isLive, type StepSnapshot, type Direction } from './core/types';
import { BoardView } from './render/BoardView';
import { environments, buildEnvironment, preloadEnvironment, type EnvironmentPack } from './render/environment';
import { TurnBuffer, KEY_MOVES } from './input/TurnBuffer';
import { Hud } from './ui/Hud';
import { GameAudio } from './ui/audio';

let engine=new GameEngine(levels[0]),levelIndex=0,inspection:number|null=null,pack:EnvironmentPack=environments[levels[0].environment??'foundry']??environments.foundry;
let hud:Hud,scene:ChamberScene|undefined;
let selectionNotice:string|null=null;
const audio=new GameAudio();
const completed=new Set<number>();
try{const saved:unknown=JSON.parse(localStorage.getItem('weldpoint:completed')??'[]');if(Array.isArray(saved))saved.forEach(id=>{if(Number.isInteger(id)&&levels.some(l=>l.id===id))completed.add(id);});}catch{/* Storage may be disabled. */}
const turns=new TurnBuffer((a,b)=>{
  if(inspection!==null||!isLive(engine.state.status))return;
  const previous=structuredClone(engine.state),s=engine.executeStep(a,b);
  if(s.status==='VICTORY'){completed.add(engine.level.id);try{localStorage.setItem('weldpoint:completed',JSON.stringify([...completed]));}catch{/* Optional progress persistence. */}}
  audio.play(s.status==='VICTORY'?'win':!isLive(s.status)?'fail':s.status==='WELD_SUCCESS'?'weld':engine.lastShoves.some(n=>n!==null)?'shove':'step');
  scene?.redraw(previous,true);
},()=>refresh(),(player,direction)=>engine.selectionError(player,direction)===null);
function refresh(){if(hud){hud.render(engine,levelIndex,turns.pending,inspection,completed,selectionNotice);}}
function viewEngine(){if(inspection===null)return engine;const e=new GameEngine(engine.level);e.stateStack=engine.stateStack.slice(0,inspection+1);return e;}
function queue(player:1|2,direction:Direction){
  if(hud.helpOpen||inspection!==null||!isLive(engine.state.status))return;
  selectionNotice=engine.selectionError(player,direction);
  if(selectionNotice){refresh();return;}
  turns.queue(player,direction);
}
function clear(){inspection=null;selectionNotice=null;turns.clear();}
function reset(){engine.reset();clear();scene?.redraw();}
function undo(){if(inspection!==null){inspection=null;}else engine.undo();selectionNotice=null;turns.clear();scene?.redraw();}
function selectLevel(index:number){if(index<0||index>=levels.length)return;levelIndex=index;engine=new GameEngine(levels[index]);pack=environments[engine.level.environment??'foundry']??environments.foundry;clear();scene?.redraw();}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{/* Embedded previews can deny browser fullscreen; viewport remains filled. */}}
hud=new Hud(levels,{level:selectLevel,undo,reset,queue,fullscreen,inspect:(step)=>{inspection=step===engine.state.step?null:step;selectionNotice=null;turns.clear();scene?.redraw();},theme:()=>{pack=pack.id==='foundry'?environments.orbital:environments.foundry;scene?.redraw();},sound:()=>{audio.enabled=!audio.enabled;hud.setSound(audio.enabled);}});
for(const l of levels){const ref=new GameEngine(l);for(let k=0;k<l.totalSteps;k++)ref.executeStep(l.solutionP1[k],l.solutionP2[k]);hud.setReferences(l.id,ref.stateStack);}

class ChamberScene extends Phaser.Scene {
  private boards:BoardView[]=[];
  constructor(){super('chamber');}
  preload(){for(const p of Object.values(environments))preloadEnvironment(this,p);}
  create(){scene=this;for(const p of Object.values(environments))buildEnvironment(this,p);this.boards=[new BoardView(this,0),new BoardView(this,1),new BoardView(this,2)];this.scale.on('resize',()=>this.redraw());this.redraw();}
  redraw(previous?:StepSnapshot,animate=false){
    if(!this.boards.length)return;
    const width=this.scale.width,height=this.scale.height;
    this.cameras.main.setBackgroundColor(pack.palette.background);
    const top=document.querySelector('.mission')!.getBoundingClientRect().bottom+12;
    const bottom=document.querySelector('.console')!.getBoundingClientRect().top-10;
    const side=width<700?8:24,gap=12;
    const available=Math.max(140,bottom-top);
    if(width<1000 && height>width*.8){
      const bw=(width-side*2-gap)/2, upper=available*.52;
      this.boards[0].render(viewEngine(),{x:side,y:top,width:bw,height:upper},pack,previous,animate);
      this.boards[1].render(viewEngine(),{x:side+bw+gap,y:top,width:bw,height:upper},pack,previous,animate);
      const cw=Math.min(width-side*2,600);
      this.boards[2].render(viewEngine(),{x:(width-cw)/2,y:top+upper+6,width:cw,height:available-upper-6},pack,previous,animate);
    }else{
      const bw=(width-side*2-gap*2)/3;
      this.boards.forEach((b,i)=>b.render(viewEngine(),{x:side+i*(bw+gap),y:top,width:bw,height:available},pack,previous,animate));
    }
    document.body.dataset.environment=pack.id;refresh();
  }
}
const game=new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#10191c',antialias:true,scale:{mode:Phaser.Scale.RESIZE,width:window.innerWidth,height:window.innerHeight},scene:[ChamberScene],render:{roundPixels:true},audio:{noAudio:true}});
window.addEventListener('keydown',e=>{
  const target=e.target as HTMLElement;
  if(target.matches('input,textarea,select'))return;
  if(e.code==='Escape'){hud.toggleHelp(false);if(inspection!==null){inspection=null;scene?.redraw();}return;}
  if(e.code==='KeyH'){e.preventDefault();if(!e.repeat)hud.toggleHelp();return;}
  if(hud.helpOpen)return;
  // Let focused buttons retain native keyboard activation.
  if(target.tagName==='BUTTON'&&(e.code==='Enter'||e.code==='Space'))return;
  if(KEY_MOVES[e.code]){e.preventDefault();if(!e.repeat)queue(...KEY_MOVES[e.code]);return;}
  if(e.repeat)return;
  if(e.code==='Backspace'||e.code==='KeyZ'){e.preventDefault();undo();}
  if(e.code==='KeyR')reset();if(e.code==='KeyF'){e.preventDefault();void fullscreen();}
  if(/^Digit[1-5]$/.test(e.code))selectLevel(Number(e.code.slice(-1))-1);
});
window.addEventListener('blur',()=>turns.clear());
window.addEventListener('pagehide',()=>game.destroy(true));
refresh();
