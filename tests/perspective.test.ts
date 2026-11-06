import {it,expect,vi} from 'vitest';
import {Sessions} from '../server/game/Sessions';
import {AuthService} from '../server/auth/AuthService';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive} from '../server/arkiv/archive';
import type {Peer} from '../server/CoopRoom';
import type {PlayerProfile} from '../src/auth/types';
import type {ServerMessage,SessionState} from '../src/network/protocol';
import {OtherPerspectiveView} from '../src/network/OtherPerspectiveView';
import {levels} from '../server/data/campaign';
class TestPeer implements Peer {
  messages:ServerMessage[]=[];send(m:ServerMessage){this.messages.push(structuredClone(m));}close(){}
  get state(){return this.messages.filter((m):m is SessionState=>m.type==='state').at(-1)!;}
}
const user=(id:string):PlayerProfile=>({id,displayName:id,walletAddress:null,ensName:null,kind:'demo',completed:[]});
async function fixture(){const auth=new AuthService({databasePath:':memory:',demoEnabled:true}),store=new LevelStore(':memory:',new MemoryArchive());await store.seed(levels);const sessions=new Sessions(auth,store);return {auth,store,sessions,id:store.campaign()[0].id,close:async()=>{sessions.close();await store.drain();store.close();auth.close();}};}
const send=(hub:Sessions,peer:TestPeer,type:string,direction?:string)=>hub.receive(peer,{type,direction,revision:peer.state.revision});
it('shares a sanitized opposite starting perspective indefinitely, separately from each own private view',async()=>{
  vi.useFakeTimers();const f=await fixture(),p1=new TestPeer(),p2=new TestPeer();
  try{
    await f.sessions.join(p1,user('a'),{kind:'create',mode:'coop',levelId:f.id,player:1});await f.sessions.join(p2,user('b'),{kind:'invite',code:p1.state.party!.code});
    expect(p1.state.study).toBeUndefined();expect(p2.state.study).toBeUndefined();
    for(const p of [p1,p2])f.sessions.receive(p,{type:'ready',ready:true});f.sessions.receive(p1,{type:'start'});
    const study=p1.state.study!,start=study.attempt;expect(study.player).toBe(2);expect(p2.state.study?.player).toBe(1);
    expect(study.level.initialP2).toEqual(levels[0].initialP2);expect(study.level.initialBoxesP2).toEqual(levels[0].initialBoxesP2);expect(study.level.switchesP2).toEqual(levels[0].switchesP2);expect(study.level.exitP2).toEqual(levels[0].exitP2);
    expect(study.level.initialP1).toEqual([0,0]);expect(study.level.initialBoxesP1).toEqual([]);expect(study.level.switchesP1).toEqual([]);expect(study.level.exitP1).toEqual([0,0]);
    for(const state of [p1.state,p2.state])for(const layout of [state.level!,state.study!.level]){expect(layout.weldTargets).toEqual([]);expect(layout.solutionP1).toEqual([]);expect(layout.solutionP2).toEqual([]);expect(layout.midpointSwitchRequired).toBeUndefined();}
    expect(p1.state.level?.initialBoxesP2).toEqual([]);expect(p2.state.level?.initialBoxesP1).toEqual([]);
    vi.advanceTimersByTime(60*60_000);send(f.sessions,p1,'cancel');expect(p1.state.study?.attempt).toBe(start);expect(p1.state.study?.level).toEqual(study.level);expect(p1.state.history).toHaveLength(1);
    const view=new OtherPerspectiveView(study.level);expect(view.state.p2Pos).toEqual(levels[0].initialP2);expect(view.state.boxesP2).toEqual(levels[0].initialBoxesP2);expect(view.state.boxesP1).toEqual([]);expect(view.nextBoxes()).toBeNull();
  }finally{await f.close();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();}
});
it('locks on each first valid queued selection; invalid/stale commands do not lock, while cancel/undo do not unlock',async()=>{
  const f=await fixture(),p1=new TestPeer(),p2=new TestPeer();
  try{
    await f.sessions.join(p1,user('a'),{kind:'create',mode:'coop',levelId:f.id,player:1});await f.sessions.join(p2,user('b'),{kind:'invite',code:p1.state.party!.code});
    for(const p of [p1,p2])f.sessions.receive(p,{type:'ready',ready:true});f.sessions.receive(p1,{type:'start'});const attempt=p1.state.study!.attempt;
    send(f.sessions,p1,'move','R');expect(p1.messages.at(-1)?.type).toBe('error');expect(p1.state.study).toBeDefined();expect(p1.state.pendingMove).toBeNull();
    f.sessions.receive(p1,{type:'move',direction:'U',revision:p1.state.revision-1});expect(p1.messages.at(-1)?.type).toBe('state');expect(p1.state.study).toBeDefined();
    send(f.sessions,p1,'move','U');expect(p1.state.study).toBeUndefined();expect(p1.state.pendingMove).toBe('U');expect(p1.state.history.at(-1)?.step).toBe(0);expect(p2.state.study).toBeDefined();
    send(f.sessions,p1,'cancel');expect(p1.state.study).toBeUndefined();expect(p1.state.pendingMove).toBeNull();expect(p2.state.study).toBeDefined();
    send(f.sessions,p1,'move','U');send(f.sessions,p2,'move','D');expect(p1.state.history.at(-1)?.step).toBe(1);expect(p2.state.study).toBeUndefined();
    send(f.sessions,p1,'undo');expect(p1.state.history).toHaveLength(1);expect(p1.state.study).toBeUndefined();expect(p2.state.study).toBeUndefined();
    send(f.sessions,p2,'reset');expect(p1.state.study!.attempt).toBeGreaterThan(attempt);expect(p2.state.study!.attempt).toBe(p1.state.study!.attempt);
    send(f.sessions,p1,'move','W');expect(p1.state.study).toBeUndefined();expect(p2.state.study).toBeDefined();
  }finally{await f.close();}
});
it('preserves unlocked/locked study across solo reconnects, and reopens it only on reset',async()=>{
  const f=await fixture(),first=new TestPeer();
  try{
    await f.sessions.join(first,user('solo'),{kind:'create',mode:'solo',levelId:f.id,player:2});const attempt=first.state.study!.attempt,id=first.state.party!.id;
    f.sessions.disconnect(first);const resumed=new TestPeer();await f.sessions.join(resumed,user('solo'),{kind:'resume',id});expect(resumed.state.study?.attempt).toBe(attempt);expect(resumed.state.study?.player).toBe(1);
    send(f.sessions,resumed,'move','D');expect(resumed.state.history.at(-1)?.step).toBe(1);expect(resumed.state.study).toBeUndefined();
    send(f.sessions,resumed,'undo');expect(resumed.state.history).toHaveLength(1);expect(resumed.state.study).toBeUndefined();
    f.sessions.disconnect(resumed);const locked=new TestPeer();await f.sessions.join(locked,user('solo'),{kind:'resume',id});expect(locked.state.study).toBeUndefined();
    send(f.sessions,locked,'reset');expect(locked.state.study!.attempt).toBeGreaterThan(attempt);expect(locked.state.study!.level.initialBoxesP1).toEqual(levels[0].initialBoxesP1);expect(locked.state.study!.level.initialBoxesP2).toEqual([]);
  }finally{await f.close();}
});
