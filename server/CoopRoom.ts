import { GameEngine } from '../src/core/engine';
import { levels } from '../src/core/level';
import { copyBoxes, type Direction,type LevelConfig } from '../src/core/types';
import { DIRECTIONS, parseCommand, type Player, type ServerMessage, type SessionState } from '../src/network/protocol';

export type PublishedLevelLoader=(id:string)=>{level:LevelConfig;revision:number}|null;
export interface Peer { send(message: ServerMessage): void; close(): void }
interface Seat { accountId:string; token:string; peer:Peer|null; expiresAt:number }
/** A single disposable playtest room. A future party layer can own one instance per party. */
export class CoopRoom {
  private seats: [Seat|null,Seat|null]=[null,null];
  private engine=new GameEngine(levels[0]);
  private levelIndex=0;
  private customId:string|undefined;private customRevision:number|undefined;
  private pending:[Direction|null,Direction|null]=[null,null];
  private revision=0;
  constructor(private makeToken:()=>string, private now=()=>Date.now(), readonly reconnectMs=45_000, private completed:(ids:string[],levelId:number)=>void=()=>{},private loadPublished:PublishedLevelLoader=()=>null) {}
  join(peer:Peer, accountId:string, token?:string,requestedLevel?:string): Player|null {
    this.expire();
    const returning=this.seats.some(s=>s?.accountId===accountId);
    if(requestedLevel&&!returning){
      if(this.seats.some(Boolean)&&requestedLevel!==this.customId){peer.send({type:'full',message:'The shared room is playing another chamber. Both players must return home before starting this level.'});peer.close();return null;}
      if(!this.seats.some(Boolean)){
        const published=this.loadPublished(requestedLevel);if(!published){peer.send({type:'full',message:'This custom level is not published or is unavailable. Return home and choose another level.'});peer.close();return null;}
        this.engine=new GameEngine(published.level);this.levelIndex=-1;this.customId=requestedLevel;this.customRevision=published.revision;this.pending=[null,null];this.revision++;
      }
    }else if(!this.seats.some(Boolean)&&this.customId){this.levelIndex=0;this.customId=undefined;this.customRevision=undefined;this.engine=new GameEngine(levels[0]);this.revision++;}
    let index=token?this.seats.findIndex(s=>s?.token===token):-1;
    if(index>=0&&this.seats[index]!.accountId!==accountId){peer.send({type:'error',message:'This seat belongs to another account.'});peer.close();return null;}
    if(index<0)index=this.seats.findIndex(s=>s?.accountId===accountId);
    if(index>=0 && this.seats[index]?.peer) {
      peer.send({type:'full',message:'This player is already connected in another tab. Use a separate tab without duplicating it.'});peer.close();return null;
    }
    if(index<0) index=this.seats.findIndex(s=>s===null);
    if(index<0){peer.send({type:'full',message:'Both player slots are occupied or reconnecting. This playtest supports two players.'});peer.close();return null;}
    const seat=this.seats[index];
    this.seats[index]={accountId,token:seat?.token??this.makeToken(),peer,expiresAt:0};
    peer.send({type:'welcome',token:this.seats[index]!.token});
    this.broadcast();return (index+1) as Player;
  }
  leave(peer:Peer) {
    const seat=this.seats.find(s=>s?.peer===peer); if(!seat)return;
    seat.peer=null;seat.expiresAt=this.now()+this.reconnectMs;
    this.pending=[null,null];this.revision++;
    this.broadcast();
  }
  /** Intentional menu exit: release now rather than reserve a disconnected seat. */
  release(peer:Peer) {
    const index=this.seats.findIndex(s=>s?.peer===peer);if(index<0)return;
    this.seats[index]=null;this.pending=[null,null];this.engine.reset();this.revision++;
    this.broadcast();
  }
  expire() {
    let expired=false;
    this.seats=this.seats.map(s=>{if(s&&!s.peer&&s.expiresAt<=this.now()){expired=true;return null;}return s;}) as typeof this.seats;
    if(expired){this.customId=undefined;this.customRevision=undefined;this.levelIndex=0;this.engine=new GameEngine(levels[0]);this.pending=[null,null];this.revision++;this.broadcast();}
  }
  receive(peer:Peer, value:unknown) {
    const index=this.seats.findIndex(s=>s?.peer===peer); if(index<0)return;
    const command=parseCommand(value);
    if(!command){peer.send({type:'error',message:'Invalid game command.'});return;}
    if(!this.seats.every(s=>s?.peer)){peer.send({type:'error',message:'Waiting for your partner to connect.'});return;}
    if(command.revision!==this.revision){peer.send({type:'error',message:'The timeline changed. Choose your move again.'});this.broadcast();return;}
    if(command.type==='move') {
      const error=this.engine.selectionError((index+1) as Player,command.direction);
      if(error){peer.send({type:'error',message:error});return;}
      this.pending[index]=command.direction;
      if(this.pending[0] && this.pending[1]) {
        this.engine.executeStep(this.pending[0],this.pending[1]);
        if(this.engine.state.status==='VICTORY'&&!this.customId)this.completed(this.seats.map(s=>s!.accountId),levels[this.levelIndex].id);
        this.pending=[null,null];this.revision++;
      }
    } else if(command.type==='cancel') {
      this.pending[index]=null;
    } else {
      if(command.type==='level') {
        if(command.index<0||command.index>=levels.length){peer.send({type:'error',message:'Unknown chamber.'});return;}
        this.customId=undefined;this.customRevision=undefined;this.levelIndex=command.index;this.engine=new GameEngine(levels[this.levelIndex]);
      } else if(command.type==='reset') this.engine.reset();
      else this.engine.undo();
      this.pending=[null,null];this.revision++;
    }
    this.broadcast();
  }
  private publicLevel(player:Player):LevelConfig {
    const level=structuredClone(this.engine.level);
    // An untrusted client receives no partner objectives, spawns, boxes, weld coordinates or solution.
    level.weldTargets=[];delete level.midpointSwitchRequired;level.solutionP1=[];level.solutionP2=[];
    if(player===1){level.initialP2=[0,0];level.initialBoxesP2=[];level.switchesP2=[];level.exitP2=[0,0];}
    else{level.initialP1=[0,0];level.initialBoxesP1=[];level.switchesP1=[];level.exitP1=[0,0];delete level.laserReceiverP1;}
    return level;
  }
  private snapshot(index:number): SessionState {
    const player=(index+1) as Player;
    return {
      type:'state', player, revision:this.revision,levelIndex:this.levelIndex,
      ...(this.customId?{customLevelId:this.customId,customRevision:this.customRevision,level:this.publicLevel(player)}:{}),
      history:this.engine.stateStack.map(s=>({step:s.step,position:[...(player===1?s.p1Pos:s.p2Pos)],boxes:copyBoxes(player===1?s.boxesP1:s.boxesP2),status:s.status,
        // Failure diagnostics must not reveal a partner's coordinates.
        message:s.status==='PARADOX_COLLISION'?'An operator obstructed locked history. Undo and choose another route.':s.status==='LASER_DEATH'?'An operator entered an active laser. Undo and find a safe route.':s.message})),
      nextBoxes:this.engine.nextBoxes(player),shove:this.engine.lastShoves[index],
      pendingMove:this.pending[index],partnerReady:this.pending[1-index]!==null,partnerConnected:!!this.seats[1-index]?.peer,
      moveErrors:Object.fromEntries(DIRECTIONS.map(d=>[d,this.engine.selectionError(player,d)])) as SessionState['moveErrors'],
    };
  }
  private broadcast(){this.seats.forEach((s,i)=>{if(s?.peer)s.peer.send(this.snapshot(i));});}
}
