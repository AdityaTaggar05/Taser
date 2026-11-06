import {it,expect,vi} from 'vitest';
import {Sessions} from '../server/game/Sessions';
import {AuthService} from '../server/auth/AuthService';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive} from '../server/arkiv/archive';
import type {Peer} from '../server/CoopRoom';
import type {PlayerProfile} from '../src/auth/types';
import type {ServerMessage,SessionState} from '../src/network/protocol';
import {InitialPreviewView} from '../src/network/InitialPreviewView';
import {levels} from '../server/data/campaign';
class TestPeer implements Peer {
  messages:ServerMessage[]=[];send(m:ServerMessage){this.messages.push(structuredClone(m));}close(){}
  get state(){return this.messages.filter((m):m is SessionState=>m.type==='state').at(-1)!;}
}
const user=(id:string):PlayerProfile=>({id,displayName:id,walletAddress:null,ensName:null,kind:'demo',completed:[]});
async function fixture(){const auth=new AuthService({databasePath:':memory:',demoEnabled:true}),store=new LevelStore(':memory:',new MemoryArchive());await store.seed(levels);const sessions=new Sessions(auth,store);return {auth,store,sessions,id:store.campaign()[0].id,close:async()=>{sessions.close();await store.drain();store.close();auth.close();}};}
it('shares only the initial overlay for exactly ten seconds, locks commands and then restores role privacy',async()=>{
  vi.useFakeTimers();const f=await fixture(),p1=new TestPeer(),p2=new TestPeer();
  try{
    await f.sessions.join(p1,user('a'),{kind:'create',mode:'coop',levelId:f.id,player:1});await f.sessions.join(p2,user('b'),{kind:'invite',code:p1.state.party!.code});
    expect(p1.state.preview).toBeUndefined();expect(p2.state.preview).toBeUndefined();
    f.sessions.receive(p1,{type:'ready',ready:true});f.sessions.receive(p2,{type:'ready',ready:true});f.sessions.receive(p1,{type:'start'});
    const start=p1.state.preview!,deadline=start.endsAt;expect(deadline-start.serverNow).toBe(10_000);expect(p2.state.preview?.endsAt).toBe(deadline);
    expect(start.level.initialP1).toEqual(levels[0].initialP1);expect(start.level.initialP2).toEqual(levels[0].initialP2);
    expect(start.level.initialBoxesP1).toEqual(levels[0].initialBoxesP1);expect(start.level.initialBoxesP2).toEqual(levels[0].initialBoxesP2);
    expect(start.level.switchesP1).toEqual(levels[0].switchesP1);expect(start.level.switchesP2).toEqual(levels[0].switchesP2);
    expect(start.level.exitP1).toEqual(levels[0].exitP1);expect(start.level.exitP2).toEqual(levels[0].exitP2);
    expect(start.level.solutionP1).toEqual([]);expect(start.level.solutionP2).toEqual([]);expect(start.level.weldTargets).toEqual([]);expect(start.level.midpointSwitchRequired).toBeUndefined();
    expect(p1.state.level?.initialBoxesP2).toEqual([]);expect(p2.state.level?.switchesP1).toEqual([]);
    for(const type of ['move','reset','undo'] as const){f.sessions.receive(p1,{type,direction:'U',revision:p1.state.revision});expect(p1.messages.at(-1)?.type).toBe('error');expect(p1.state.history).toHaveLength(1);expect(p1.state.pendingMove).toBeNull();}
    vi.advanceTimersByTime(9_999);f.sessions.receive(p2,{type:'move',direction:'D',revision:p2.state.revision});expect(p2.messages.at(-1)?.type).toBe('error');expect(p1.state.preview?.endsAt).toBe(deadline);
    vi.advanceTimersByTime(1);expect(p1.state.preview).toBeUndefined();expect(p2.state.preview).toBeUndefined();
    expect(p1.state.level?.exitP2).toEqual([0,0]);expect(p2.state.level?.initialBoxesP1).toEqual([]);
    f.sessions.receive(p1,{type:'move',direction:'U',revision:p1.state.revision});f.sessions.receive(p2,{type:'move',direction:'D',revision:p2.state.revision});expect(p1.state.history.at(-1)?.step).toBe(1);
    expect(p1.state.preview).toBeUndefined();expect(p2.state.preview).toBeUndefined();
    f.sessions.receive(p1,{type:'undo',revision:p1.state.revision});expect(p1.state.history).toHaveLength(1);expect(p1.state.preview).toBeUndefined();
    f.sessions.receive(p1,{type:'reset',revision:p1.state.revision});expect(p1.state.preview?.endsAt).toBe(Date.now()+10_000);expect(p2.state.preview?.endsAt).toBe(p1.state.preview?.endsAt);
  }finally{await f.close();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();}
});
it('uses the same study period for solo and preserves its deadline through reconnects',async()=>{
  vi.useFakeTimers();const f=await fixture(),first=new TestPeer();
  try{
    await f.sessions.join(first,user('solo'),{kind:'create',mode:'solo',levelId:f.id,player:2});const deadline=first.state.preview!.endsAt,id=first.state.party!.id;
    vi.advanceTimersByTime(3_000);f.sessions.disconnect(first);const resumed=new TestPeer();await f.sessions.join(resumed,user('solo'),{kind:'resume',id});
    expect(resumed.state.preview?.endsAt).toBe(deadline);expect(resumed.state.preview!.endsAt-resumed.state.preview!.serverNow).toBe(7_000);
    vi.advanceTimersByTime(7_000);expect(resumed.state.preview).toBeUndefined();expect(resumed.state.level?.initialP1).toEqual([0,0]);
    f.sessions.receive(resumed,{type:'move',direction:'D',revision:resumed.state.revision});expect(resumed.state.history.at(-1)?.step).toBe(1);
    f.sessions.receive(resumed,{type:'reset',revision:resumed.state.revision});expect(resumed.state.preview?.endsAt).toBe(Date.now()+10_000);
  }finally{await f.close();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();}
});
it('renders both initial perspectives without requiring a solution or live partner history',()=>{
  const level=structuredClone(levels[3]);level.weldTargets=[];level.solutionP1=[];level.solutionP2=[];
  const preview=new InitialPreviewView(level);expect(preview.state.step).toBe(0);expect(preview.state.p1Pos).toEqual(level.initialP1);expect(preview.state.p2Pos).toEqual(level.initialP2);
  expect(preview.state.boxesP1).toEqual(level.initialBoxesP1);expect(preview.state.boxesP2).toEqual(level.initialBoxesP2);expect(preview.nextBoxes()).toBeNull();
  expect(preview.exitOpen(1)).toBe(false);expect(preview.exitOpen(2)).toBe(false);
});
