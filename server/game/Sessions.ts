import {randomBytes,randomUUID} from 'node:crypto';
import {CoopRoom,type Peer} from '../CoopRoom';
import type {AuthService} from '../auth/AuthService';
import {LevelError,type LevelStore,type PublishedSnapshot} from '../levels/LevelStore';
import type {PlayerProfile} from '../../src/auth/types';
import type {JoinIntent,Player,PlayMode,ServerMessage} from '../../src/network/protocol';
import {INVITE_ALPHABET,INVITE_LENGTH,normalizeInviteCode} from '../../src/network/invite';
interface Member {user:PlayerProfile;role:Player;peer:Peer|null;bridge:Peer;ready:boolean;publicationVersion?:number;disconnectedAt?:number;runPublication?:'pending'|'confirmed'}
interface Session {id:string;code:string;mode:PlayMode;host:string;room:CoopRoom;snapshot:PublishedSnapshot;members:Map<string,Member>;started:boolean;echoName?:string;touched:number}
/** Authenticated private sessions. Invite codes grant a seat, never puzzle data or an account. */
export class Sessions {
  private sessions=new Map<string,Session>();private peers=new Map<Peer,{session:Session;member:Member}>();
  private creating=new Set<string>();private closed=false;
  constructor(private auth:AuthService,private store:LevelStore){}
  async join(peer:Peer,user:PlayerProfile,value:unknown,token?:string,isActive:()=>boolean=()=>true){
    if(!value||typeof value!=='object')throw new LevelError(400,'Choose Solo, create a party, or enter an invite code.');
    const intent=value as JoinIntent;
    let session:Session|undefined,role:Player;
    if(intent.kind==='create'){
      if(!['solo','coop'].includes(intent.mode)||![1,2].includes(intent.player)||typeof intent.levelId!=='string'||(intent.runId!==undefined&&(typeof intent.runId!=='string'||!/^[a-f0-9]{64}$/.test(intent.runId))))throw new LevelError(400,'Invalid challenge selection.');
      if(this.creating.has(user.id))throw new LevelError(409,'Another challenge is being created for this account.');
      this.checkAccount(user.id);if(this.sessions.size>=200)throw new LevelError(503,'The server has reached its session limit.');
      this.creating.add(user.id);
      try{
        peer.send({type:'joining',stage:'availability',storage:this.store.storage});
        await this.store.refreshAvailability();
        if(this.closed||!isActive())throw new LevelError(409,'Party creation was cancelled.');const snapshot=this.store.forPlay(intent.levelId);if(!snapshot)throw new LevelError(404,'Published chamber unavailable or expired.');
        peer.send({type:'joining',stage:intent.mode==='solo'?'replay':'level',storage:this.store.storage});
        // echo validates the selected level before loading its replay; do not read the level twice.
        const echo=intent.mode==='solo'?await this.store.echo(snapshot,intent.player===1?2:1,intent.runId):undefined;
        if(intent.mode==='coop')await this.store.validateSnapshot(snapshot);
        if(this.closed||!isActive())throw new LevelError(409,'Party creation was cancelled.');this.checkAccount(user.id);
        peer.send({type:'joining',stage:'party',storage:this.store.storage});
        const id=randomUUID();let code:string;do{code=Array.from(randomBytes(INVITE_LENGTH),byte=>INVITE_ALPHABET[byte%INVITE_ALPHABET.length]).join('');}while([...this.sessions.values()].some(s=>s.code===code));
        const members=new Map<string,Member>();
        const room=new CoopRoom(randomUUID,()=>Date.now(),45_000,ids=>{if(snapshot.slot)this.auth.recordCompletion(ids,snapshot.slot);},undefined,[snapshot],
          (ids,key)=>this.store.recordWin(ids,key),(id,key)=>this.store.canReveal(id,key),{
            turn:(publication,sequence,turn,inputs,ids)=>{this.store.captureMove(publication,id,sequence,turn,inputs,ids,intent.mode);},
            fixedLevel:true,solo:echo?{player:intent.player,moves:echo.moves}:undefined,
            win:(publication,humans,moves)=>{
              for(const human of humans){const member=members.get(human.id);if(!member)continue;member.runPublication='pending';const version=(member.publicationVersion??0)+1;member.publicationVersion=version;
                void this.store.captureRun(publication,member.user,human.role,moves,intent.mode,echo?.source??'live').then(status=>{if(this.closed||member.publicationVersion!==version)return;member.runPublication=status??'pending';room.notify();}).catch(()=>{if(!this.closed)room.notify();});
              }
            }
          });
        session={id,code,mode:intent.mode,host:user.id,room,snapshot,members,started:intent.mode==='solo',echoName:echo?.name,touched:Date.now()};
        this.sessions.set(id,session);role=intent.player;
      }finally{this.creating.delete(user.id);}
    }else if(intent.kind==='invite'){
      const code=normalizeInviteCode(intent.code);if(!code)throw new LevelError(400,'Enter the 6-character invitation code.');
      session=[...this.sessions.values()].find(s=>s.mode==='coop'&&s.code===code);
      if(!session)throw new LevelError(404,'Invitation expired or party closed.');
      const prior=session.members.get(user.id);
      if(prior)role=prior.role;
      else{this.checkAccount(user.id);if(session.started||session.members.size>=2)throw new LevelError(409,'This party has already started or is full.');role=session.members.get(session.host)!.role===1?2:1;}
    }else if(intent.kind==='resume'){
      session=this.sessions.get(intent.id);const member=session?.members.get(user.id);if(!session||!member)throw new LevelError(404,'This session has ended. Return home to start another.');role=member.role;
    }else throw new LevelError(400,'Unknown game session request.');
    if(this.closed||!isActive())throw new LevelError(409,'Party creation was cancelled.');
    const selected=session!;
    let member=selected.members.get(user.id);
    if(member?.peer)throw new LevelError(409,'This account is already connected to this session in another tab.');
    if(!member){
      member={user,role:role!,peer:null,ready:false,bridge:null!};const current=member;
      member.bridge={send:(message:ServerMessage)=>{
        if(message.type==='state')current.peer?.send({...message,campaign:this.store.campaign(),mode:selected.mode,echoName:selected.echoName,runPublication:current.runPublication,customLevelId:selected.snapshot.slot?undefined:selected.snapshot.id,
          party:{id:selected.id,code:selected.code,host:current.user.id===selected.host,started:selected.started,members:[...selected.members.values()].map(m=>({name:m.user.displayName,player:m.role,ready:m.ready,connected:!!m.peer}))}});
        else if(message.type==='welcome')current.peer?.send({...message,sessionId:selected.id});else current.peer?.send(message);
      },close:()=>current.peer?.close()};selected.members.set(user.id,member);
    }
    member.disconnectedAt=undefined;member.peer=peer;this.peers.set(peer,{session:selected,member});selected.touched=Date.now();
    if(intent.kind==='create'&&selected.mode==='solo')selected.room.startStudy();
    if(!selected.room.join(member.bridge,user.id,token,undefined,member.role)){member.peer=null;member.disconnectedAt=Date.now();this.peers.delete(peer);throw new LevelError(409,'Could not resume the reserved role.');}
    return true;
  }
  private checkAccount(id:string){if([...this.sessions.values()].some(s=>s.members.has(id)))throw new LevelError(409,'Your account already has a session. Resume it or leave it before starting another.');}
  receive(peer:Peer,value:unknown){
    const entry=this.peers.get(peer);if(!entry)return;const {session:s,member:m}=entry;s.touched=Date.now();
    const command=value as {type?:unknown;ready?:unknown;revision?:unknown};
    if(command?.type==='lobby'){
      if(s.mode!=='coop'||!s.started||!s.room.returnToLobby(command.revision)){peer.send({type:'error',message:'Return to the party after this attempt ends. If the timeline changed, try again.'});return;}
      s.started=false;for(const member of s.members.values())member.ready=false;s.room.notify();return;
    }
    if(command?.type==='ready'){
      if(s.started||typeof command.ready!=='boolean')return;m.ready=command.ready;s.room.notify();return;
    }
    if(command?.type==='start'){
      if(s.host!==m.user.id){peer.send({type:'error',message:'Only the host can start the party.'});return;}
      if(s.started)return;
      if(s.members.size!==2||![...s.members.values()].every(m=>m.peer&&m.ready)){peer.send({type:'error',message:'Both operators must be connected and Ready.'});return;}
      s.started=true;s.room.startStudy();s.room.notify();return;
    }
    if(!s.started){peer.send({type:'error',message:'Wait for both operators to ready up and the host to start.'});return;}
    s.room.receive(m.bridge,value);
  }
  disconnect(peer:Peer,intentional=false){
    const entry=this.peers.get(peer);if(!entry)return;this.peers.delete(peer);const {session:s,member:m}=entry;m.peer=null;m.ready=false;m.disconnectedAt=Date.now();s.touched=Date.now();
    if(intentional){
      if(s.host===m.user.id||s.mode==='solo'){this.end(s,'The host left. This session has ended.');return;}
      s.room.release(m.bridge);s.members.delete(m.user.id);s.started=false;for(const member of s.members.values())member.ready=false;s.room.notify();
    }else{s.room.leave(m.bridge);if(!s.started)for(const member of s.members.values())member.ready=false;s.room.notify();}
  }
  private end(s:Session,message:string){this.sessions.delete(s.id);for(const m of s.members.values())if(m.peer){const peer=m.peer;this.peers.delete(peer);peer.send({type:'full',message});peer.close();m.peer=null;}}
  sweep(){for(const s of [...this.sessions.values()]){
    const expired=[...s.members.values()].filter(m=>!m.peer&&m.disconnectedAt!==undefined&&Date.now()-m.disconnectedAt>45_000);
    if(expired.some(m=>m.user.id===s.host)){this.end(s,'The host disconnected and the party expired.');continue;}
    s.room.expire();
    for(const member of expired){s.members.delete(member.user.id);s.started=false;for(const m of s.members.values())m.ready=false;s.room.notify();}
  }}
  close(){this.closed=true;for(const s of [...this.sessions.values()])this.end(s,'The game server restarted.');}
}
