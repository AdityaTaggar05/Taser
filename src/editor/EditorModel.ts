import {GameEngine} from '../core/engine';
import {cleanDraft} from '../core/levelValidation';
import {hasCoord,sameCoord,type Coord,type Direction,type LevelConfig} from '../core/types';
import {simulationLevel,verifySolution} from './solution';
import type {EditorObjectTool,EditorTool} from './types';
const coordKeys={p1:'initialP1',p2:'initialP2',exit1:'exitP1',exit2:'exitP2',receiver:'laserReceiverP1',midpoint:'midpointSwitchRequired'} as const;
function placeObject(level:LevelConfig,tool:EditorObjectTool,pos:Coord,box:number,from?:Coord){
  if(tool in coordKeys){Object.assign(level,{[coordKeys[tool as keyof typeof coordKeys]]:[...pos]});return;}
  if(tool==='laser'){level.laserEmitter={pos:[...pos],dir:level.laserEmitter?.dir??'D'};return;}
  if(tool==='switch1'||tool==='switch2'){
    const key=tool==='switch1'?'switchesP1':'switchesP2';
    if(from)level[key]=level[key].filter(p=>!sameCoord(p,from));
    if(!hasCoord(level[key],pos))level[key].push([...pos]);
    return;
  }
  const key=tool==='box1'?'initialBoxesP1':tool==='box2'?'initialBoxesP2':'weldTargets';
  if(key==='weldTargets'&&!level.weldTargets?.length)level.weldTargets=level.initialBoxesP1.map(p=>[...p]);
  if(level[key]?.[box])level[key]![box]=[...pos];
}
export function blankLevel():LevelConfig{return {id:1,name:'Untitled chamber',subtitle:'A new temporal puzzle',width:7,height:5,totalSteps:8,weldStep:4,walls:[],iceTiles:[],initialP1:[1,2],initialP2:[7,4],initialBoxesP1:[[2,3]],initialBoxesP2:[[6,3]],weldTargets:[[4,3]],switchesP1:[[6,3]],switchesP2:[[2,3]],exitP1:[5,4],exitP2:[3,2],solutionP1:[],solutionP2:[],environment:'foundry'};}
export class EditorModel {
  level:LevelConfig;
  private past:LevelConfig[]=[];private future:LevelConfig[]=[];
  engine:GameEngine|null=null;
  moves:[Direction[],Direction[]]=[[],[]];pending:[Direction|null,Direction|null]=[null,null];
  constructor(level=blankLevel()){this.level=cleanDraft(level);}
  get canUndo(){return this.past.length>0;}get canRedo(){return this.future.length>0;}
  edit(change:(level:LevelConfig)=>void){
    const before=structuredClone(this.level),next=structuredClone(before);change(next);
    if(JSON.stringify(before)===JSON.stringify(next))return false;
    // Every design edit invalidates the previous witness, including imported templates.
    next.solutionP1=[];next.solutionP2=[];this.level=cleanDraft(next);this.past.push(before);if(this.past.length>100)this.past.shift();this.future=[];this.engine=null;return true;
  }
  undo(){const previous=this.past.pop();if(previous){this.future.push(structuredClone(this.level));this.level=previous;this.engine=null;}}
  redo(){const next=this.future.pop();if(next){this.past.push(structuredClone(this.level));this.level=next;this.engine=null;}}
  paint(tool:EditorTool,pos:Coord,box:number){return this.edit(l=>{
    const remove=(key:'walls'|'iceTiles'|'switchesP1'|'switchesP2')=>{l[key]=(l[key]??[]).filter(p=>!sameCoord(p,pos));};
    const add=(key:'walls'|'iceTiles'|'switchesP1'|'switchesP2')=>{if(!hasCoord(l[key],pos))(l[key]??=[]).push([...pos]);};
    if(tool==='remove'){
      // Remove one overlay at a time, keeping paired box identities aligned.
      if(l.initialBoxesP1.length>1){
        const index=l.initialBoxesP1.findIndex(p=>sameCoord(p,pos));
        const pair=index===-1?l.initialBoxesP2.findIndex(p=>sameCoord(p,pos)):index;
        if(pair!==-1){
          l.initialBoxesP1.splice(pair,1);l.initialBoxesP2.splice(pair,1);
          l.weldTargets?.splice(pair,1);
          return;
        }
      }
      for(const key of ['switchesP1','switchesP2'] as const)if(hasCoord(l[key],pos)){remove(key);return;}
      if(l.midpointSwitchRequired&&sameCoord(l.midpointSwitchRequired,pos)){delete l.midpointSwitchRequired;return;}
      if(l.laserEmitter&&sameCoord(l.laserEmitter.pos,pos)){delete l.laserEmitter;return;}
      if(l.laserReceiverP1&&sameCoord(l.laserReceiverP1,pos)){delete l.laserReceiverP1;return;}
      for(const key of ['iceTiles','walls'] as const)if(hasCoord(l[key],pos)){remove(key);return;}
      return;
    }
    if(tool==='wall'){
      const objects=[l.initialP1,l.initialP2,l.exitP1,l.exitP2,
        ...l.initialBoxesP1,...l.initialBoxesP2,...(l.weldTargets??[]),
        ...l.switchesP1,...l.switchesP2,l.midpointSwitchRequired,l.laserEmitter?.pos,l.laserReceiverP1];
      if(objects.some(p=>p&&sameCoord(p,pos)))return;
      remove('iceTiles');add('walls');return;
    }
    remove('walls');
    if(tool==='floor'||tool==='erase'){remove('iceTiles');if(tool==='floor')return;remove('switchesP1');remove('switchesP2');if(l.midpointSwitchRequired&&sameCoord(l.midpointSwitchRequired,pos))delete l.midpointSwitchRequired;if(l.laserEmitter&&sameCoord(l.laserEmitter.pos,pos))delete l.laserEmitter;if(l.laserReceiverP1&&sameCoord(l.laserReceiverP1,pos))delete l.laserReceiverP1;return;}
    if(tool==='ice'){if(hasCoord(l.iceTiles,pos))remove('iceTiles');else add('iceTiles');return;}
    if(tool==='midpoint'&&l.midpointSwitchRequired&&sameCoord(l.midpointSwitchRequired,pos)){delete l.midpointSwitchRequired;return;}
    if(tool==='receiver'&&l.laserReceiverP1&&sameCoord(l.laserReceiverP1,pos)){delete l.laserReceiverP1;return;}
    if(tool==='laser'&&l.laserEmitter&&sameCoord(l.laserEmitter.pos,pos)){delete l.laserEmitter;return;}
    if(tool==='switch1'||tool==='switch2'){
      const key=tool==='switch1'?'switchesP1':'switchesP2';
      if(hasCoord(l[key],pos)){remove(key);return;}
    }
    placeObject(l,tool,pos,box);
  });}
  moveObject(kind:EditorObjectTool,from:Coord,to:Coord,boxIndex=0){return this.edit(l=>{
    const target:Coord=[Math.max(1,Math.min(to[0],l.width)),Math.max(1,Math.min(to[1],l.height))];
    if(sameCoord(from,target))return;
    l.walls=l.walls.filter(p=>!sameCoord(p,target));
    placeObject(l,kind,target,boxIndex,from);
  });}
  resize(width:number,height:number){return this.edit(l=>{
    l.width=width;l.height=height;const clamp=(p:Coord):Coord=>[Math.min(p[0],width),Math.min(p[1],height)];
    for(const key of ['walls','iceTiles','switchesP1','switchesP2'] as const)l[key]=(l[key]??[]).filter(p=>p[0]<=width&&p[1]<=height);
    for(const key of ['initialP1','initialP2','exitP1','exitP2'] as const)l[key]=clamp(l[key]);
    for(const key of ['initialBoxesP1','initialBoxesP2','weldTargets'] as const)if(l[key])l[key]=l[key]!.map(clamp);
    if(l.midpointSwitchRequired)l.midpointSwitchRequired=clamp(l.midpointSwitchRequired);if(l.laserReceiverP1)l.laserReceiverP1=clamp(l.laserReceiverP1);if(l.laserEmitter)l.laserEmitter.pos=clamp(l.laserEmitter.pos);
  });}
  boxCount(count:number){return this.edit(l=>{for(const key of ['initialBoxesP1','initialBoxesP2','weldTargets'] as const){if(key==='weldTargets'&&!l.weldTargets?.length)continue;const positions=l[key]!.slice(0,count);while(positions.length<count)positions.push([1+positions.length,1]);l[key]=positions;}});}
  start(){this.engine=new GameEngine(simulationLevel(this.level));this.moves=[[],[]];this.pending=[null,null];}
  queue(player:1|2,direction:Direction){
    if(!this.engine)throw new Error('Start a playtest first.');
    const error=this.engine.selectionError(player,direction);if(error)throw new Error(error);
    this.pending[player-1]=direction;
    if(this.pending[0]&&this.pending[1]){this.engine.executeStep(this.pending[0],this.pending[1]);this.moves[0].push(this.pending[0]);this.moves[1].push(this.pending[1]);this.pending=[null,null];}
  }
  undoTurn(){if(this.engine&&this.engine.state.step>0){this.engine.undo();this.moves[0].pop();this.moves[1].pop();}this.pending=[null,null];}
  capture(){if(this.engine?.state.status!=='VICTORY')throw new Error('Finish a winning playtest before using its solution.');this.level.solutionP1=[...this.moves[0]];this.level.solutionP2=[...this.moves[1]];return verifySolution(this.level);}
}
