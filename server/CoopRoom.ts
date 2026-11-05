import { GameEngine } from '../src/core/engine';
import { levels } from '../src/core/level';
import { copyBoxes, type Direction } from '../src/core/types';
import { DIRECTIONS, parseCommand, type Player, type ServerMessage, type SessionState } from '../src/network/protocol';

export interface Peer { send(message: ServerMessage): void; close(): void }
interface Seat { token:string; peer:Peer|null; expiresAt:number }
/** A single disposable playtest room. A future party layer can own one instance per party. */
export class CoopRoom {
  private seats: [Seat|null,Seat|null]=[null,null];
  private engine=new GameEngine(levels[0]);
  private levelIndex=0;
  private pending:[Direction|null,Direction|null]=[null,null];
  private revision=0;
  constructor(private makeToken:()=>string, private now=()=>Date.now(), readonly reconnectMs=45_000) {}
  join(peer:Peer, token?:string): Player|null {
    this.expire();
    let index=token?this.seats.findIndex(s=>s?.token===token):-1;
    if(index>=0 && this.seats[index]?.peer) {
      peer.send({type:'full',message:'This player is already connected in another tab. Use a separate tab without duplicating it.'});peer.close();return null;
    }
    if(index<0) index=this.seats.findIndex(s=>s===null);
    if(index<0){peer.send({type:'full',message:'Both player slots are occupied or reconnecting. This playtest supports two players.'});peer.close();return null;}
    const seat=this.seats[index];
    this.seats[index]={token:seat?.token??this.makeToken(),peer,expiresAt:0};
    peer.send({type:'welcome',token:this.seats[index]!.token});
    this.broadcast();return (index+1) as Player;
  }
  leave(peer:Peer) {
    const seat=this.seats.find(s=>s?.peer===peer); if(!seat)return;
    seat.peer=null;seat.expiresAt=this.now()+this.reconnectMs;
    this.pending=[null,null];this.revision++;
    this.broadcast();
  }
  expire() {
    let expired=false;
    this.seats=this.seats.map(s=>{if(s&&!s.peer&&s.expiresAt<=this.now()){expired=true;return null;}return s;}) as typeof this.seats;
    if(expired){this.levelIndex=0;this.engine=new GameEngine(levels[0]);this.pending=[null,null];this.revision++;this.broadcast();}
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
        this.engine.executeStep(this.pending[0],this.pending[1]);this.pending=[null,null];this.revision++;
      }
    } else if(command.type==='cancel') {
      this.pending[index]=null;
    } else {
      if(command.type==='level') {
        if(command.index<0||command.index>=levels.length){peer.send({type:'error',message:'Unknown chamber.'});return;}
        this.levelIndex=command.index;this.engine=new GameEngine(levels[this.levelIndex]);
      } else if(command.type==='reset') this.engine.reset();
      else this.engine.undo();
      this.pending=[null,null];this.revision++;
    }
    this.broadcast();
  }
  private snapshot(index:number): SessionState {
    const player=(index+1) as Player;
    return {
      type:'state', player, revision:this.revision,levelIndex:this.levelIndex,
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
