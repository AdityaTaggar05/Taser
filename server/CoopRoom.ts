import { GameEngine } from '../src/core/engine';
import {levels} from './data/campaign';
import type {PublishedSnapshot} from './levels/LevelStore';
import type {CampaignSummary} from '../src/editor/types';
import { copyBoxes, isLive, type Direction,type LevelConfig } from '../src/core/types';
import { DIRECTIONS, parseCommand, type Player, type ServerMessage, type SessionState } from '../src/network/protocol';

export type PublishedLevelLoader=(id:string)=>PublishedSnapshot|null;
export interface Peer { send(message: ServerMessage): void; close(): void }
interface Seat { accountId:string; token:string; peer:Peer|null; expiresAt:number }
export interface RoomOptions {solo?:{player:Player;moves:Direction[]};fixedLevel?:boolean;win?:(snapshot:PublishedSnapshot,humans:Array<{id:string;role:Player}>,moves:[Direction[],Direction[]])=>void}
/** A single disposable playtest room. A future party layer can own one instance per party. */
export class CoopRoom {
  private seats: [Seat|null,Seat|null]=[null,null];
  private engine:GameEngine;
  private publication:PublishedSnapshot;
  private levelIndex=0;
  private customId:string|undefined;private customRevision:number|undefined;
  private inputs:[Direction[],Direction[]]=[[],[]];
  private pending:[Direction|null,Direction|null]=[null,null];
  private revision=0;
  constructor(private makeToken:()=>string, private now=()=>Date.now(), readonly reconnectMs=45_000, private completed:(ids:string[],levelId:number)=>void=()=>{},private loadPublished:PublishedLevelLoader=()=>null,
    private campaign:PublishedSnapshot[]=levels.map(level=>({level,revision:1})),
    private verified:(ids:string[],key:string)=>void=()=>{},private revealed:(accountId:string,key:string)=>boolean=()=>false,private options:RoomOptions={}) {
    if(!campaign.length)throw new Error('No campaign chambers are published. Run npm run arkiv:migrate.');
    this.publication=campaign[0];this.engine=new GameEngine(this.publication.level);
  }
  get empty(){return !this.seats.some(Boolean);}
  campaignSnapshot(index:number){return this.campaign[index];}
  updateCampaign(campaign:PublishedSnapshot[]){if(!this.empty||!campaign.length)return;this.campaign=campaign;this.levelIndex=0;this.publication=campaign[0];this.customId=undefined;this.customRevision=undefined;this.engine=new GameEngine(this.publication.level);}
  private catalog():CampaignSummary[]{return this.campaign.map((s,i)=>({id:s.id??String(s.level.id),slot:s.slot??s.level.id,entityKey:s.ref?.entityKey??'',name:s.level.name,subtitle:s.level.subtitle,ownerName:'WeldPoint',revision:s.revision,publishedRevision:s.revision,updatedAt:0,width:s.level.width,height:s.level.height,totalSteps:s.level.totalSteps}));}
  join(peer:Peer, accountId:string, token?:string,requestedLevel?:string,requestedPlayer?:Player): Player|null {
    this.expire();
    if(this.options.solo&&requestedPlayer!==this.options.solo.player){peer.send({type:'full',message:'This solo attempt belongs to its human operator.'});peer.close();return null;}
    if(requestedPlayer!==undefined&&requestedPlayer!==1&&requestedPlayer!==2){peer.send({type:'full',message:'Choose P1 or P2 before joining.'});peer.close();return null;}
    let index=token?this.seats.findIndex(s=>s?.token===token):-1;
    if(index>=0&&this.seats[index]!.accountId!==accountId){peer.send({type:'error',message:'This seat belongs to another account.'});peer.close();return null;}
    if(index<0)index=this.seats.findIndex(s=>s?.accountId===accountId);
    const returning=index>=0;
    if(returning&&requestedPlayer!==undefined&&index!==requestedPlayer-1){peer.send({type:'full',message:'Your account already holds the other role. Resume that role or wait for its reservation to expire.'});peer.close();return null;}
    if(index>=0&&this.seats[index]?.peer){peer.send({type:'full',message:'This player is already connected in another tab. Use a separate tab without duplicating it.'});peer.close();return null;}
    if(index<0)index=requestedPlayer===undefined?this.seats.findIndex(s=>s===null):requestedPlayer-1;
    if(index<0||this.seats[index]&&!returning){peer.send({type:'full',message:requestedPlayer?`P${requestedPlayer} is occupied or reconnecting. Return home to choose another role, or wait here for it to become free.`:'Both player slots are occupied or reconnecting. This playtest supports two players.'});peer.close();return null;}
    if(requestedLevel&&!returning){
      if(this.seats.some(Boolean)&&requestedLevel!==this.customId&&requestedLevel!==this.publication.id){peer.send({type:'full',message:'The shared room is playing another chamber. Both players must return home before starting this level.'});peer.close();return null;}
      if(!this.seats.some(Boolean)){
        const published=this.loadPublished(requestedLevel);if(!published){peer.send({type:'full',message:'This custom level is not published or is unavailable. Return home and choose another level.'});peer.close();return null;}
        this.publication=published;this.engine=new GameEngine(published.level);this.levelIndex=published.slot?this.campaign.findIndex(s=>s.id===published.id):-1;this.customId=this.levelIndex<0?requestedLevel:undefined;this.customRevision=published.revision;this.pending=[null,null];this.inputs=[[],[]];this.revision++;
      }
    }else if(!this.seats.some(Boolean)&&this.customId){this.levelIndex=0;this.customId=undefined;this.customRevision=undefined;this.publication=this.campaign[0];this.engine=new GameEngine(this.publication.level);this.revision++;}
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
    this.seats[index]=null;this.pending=[null,null];this.engine.reset();this.inputs=[[],[]];this.revision++;
    this.broadcast();
  }
  expire() {
    let expired=false;
    this.seats=this.seats.map(s=>{if(s&&!s.peer&&s.expiresAt<=this.now()){expired=true;return null;}return s;}) as typeof this.seats;
    if(expired){this.customId=undefined;this.customRevision=undefined;this.levelIndex=0;this.publication=this.campaign[0];this.engine=new GameEngine(this.publication.level);this.pending=[null,null];this.inputs=[[],[]];this.revision++;this.broadcast();}
  }
  receive(peer:Peer, value:unknown) {
    const index=this.seats.findIndex(s=>s?.peer===peer); if(index<0)return;
    const command=parseCommand(value);
    if(!command){peer.send({type:'error',message:'Invalid game command.'});return;}
    if(!this.options.solo&&!this.seats.every(s=>s?.peer)){peer.send({type:'error',message:'Waiting for your partner to connect.'});return;}
    if(command.revision!==this.revision){peer.send({type:'error',message:'The timeline changed. Choose your move again.'});this.broadcast();return;}
    if(command.type==='move') {
      const error=this.engine.selectionError((index+1) as Player,command.direction);
      if(error){peer.send({type:'error',message:error});return;}
      this.pending[index]=command.direction;
      if(this.options.solo){
        const replay=this.options.solo.moves[this.engine.state.step];
        if(!replay||this.engine.selectionError((2-index) as Player,replay)){
          this.engine.state.status='OUT_OF_TIME';this.engine.state.message='The fixed replay cannot continue on this timeline. Undo or reset to try another route.';this.pending=[null,null];this.revision++;this.broadcast();return;
        }
        this.pending[1-index]=replay;
      }
      if(this.pending[0]&&this.pending[1]){
        const a=this.pending[0],b=this.pending[1],step=this.engine.state.step;
        this.engine.executeStep(a,b);
        if(this.engine.state.step!==step){this.inputs[0].push(a);this.inputs[1].push(b);}
        if(this.engine.state.status==='VICTORY'){
          const humans=this.seats.flatMap((seat,i)=>seat?[{id:seat.accountId,role:(i+1) as Player}]:[]);
          const ids=humans.map(h=>h.id);
          if(!this.options.solo){if(!this.customId)this.completed(ids,this.publication.level.id);if(this.publication.ref)this.verified(ids,this.publication.ref.entityKey);}
          this.options.win?.(structuredClone(this.publication),humans,structuredClone(this.inputs));
        }else if(this.options.solo&&isLive(this.engine.state.status)&&this.engine.state.step>=this.options.solo.moves.length){
          this.engine.state.status='OUT_OF_TIME';this.engine.state.message='The replay has ended. Both operators must exit before its final turn. Undo or reset.';
        }
        this.pending=[null,null];this.revision++;
      }
    } else if(command.type==='cancel') {
      this.pending[index]=null;
    } else {
      if(command.type==='level') {
        if(this.options.fixedLevel){peer.send({type:'error',message:'Return to the menu to choose another challenge.'});return;}
        if(command.index<0||command.index>=this.campaign.length){peer.send({type:'error',message:'Unknown chamber.'});return;}
        this.customId=undefined;this.customRevision=undefined;this.levelIndex=command.index;this.publication=this.campaign[this.levelIndex];this.engine=new GameEngine(this.publication.level);this.inputs=[[],[]];
      } else if(command.type==='reset'){this.engine.reset();this.inputs=[[],[]];}
      else{this.engine.undo();this.inputs[0].length=this.engine.state.step;this.inputs[1].length=this.engine.state.step;}
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
      level:this.publicLevel(player),campaign:this.catalog(),publicationKey:this.publication.ref?.entityKey,solutionAvailable:!!this.publication.ref&&this.revealed(this.seats[index]!.accountId,this.publication.ref.entityKey),
      ...(this.customId?{customLevelId:this.customId,customRevision:this.customRevision}:{}),
      history:this.engine.stateStack.map(s=>({step:s.step,position:[...(player===1?s.p1Pos:s.p2Pos)],boxes:copyBoxes(player===1?s.boxesP1:s.boxesP2),status:s.status,
        // Failure diagnostics must not reveal a partner's coordinates.
        message:s.status==='PARADOX_COLLISION'?'An operator obstructed locked history. Undo and choose another route.':s.status==='LASER_DEATH'?'An operator entered an active laser. Undo and find a safe route.':s.message})),
      nextBoxes:this.engine.nextBoxes(player),shove:this.engine.lastShoves[index],
      pendingMove:this.pending[index],partnerReady:this.pending[1-index]!==null,partnerConnected:!!this.options.solo||!!this.seats[1-index]?.peer,
      moveErrors:Object.fromEntries(DIRECTIONS.map(d=>[d,this.engine.selectionError(player,d)])) as SessionState['moveErrors'],
    };
  }
  returnToLobby(revision:unknown){
    if(revision!==this.revision||isLive(this.engine.state.status))return false;
    this.engine.reset();this.inputs=[[],[]];this.pending=[null,null];this.revision++;return true;
  }
  notify(){this.broadcast();}
  private broadcast(){this.seats.forEach((s,i)=>{if(s?.peer)s.peer.send(this.snapshot(i));});}
}
