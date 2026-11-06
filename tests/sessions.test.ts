import {it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
vi.mock('node:crypto',async importOriginal=>{const original=await importOriginal<typeof import('node:crypto')>();return {...original,randomBytes:vi.fn(original.randomBytes)};});
import {Sessions} from '../server/game/Sessions';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive} from '../server/arkiv/archive';
import {AuthService} from '../server/auth/AuthService';
import type {Peer} from '../server/CoopRoom';
import type {PlayerProfile} from '../src/auth/types';
import type {ServerMessage,SessionState} from '../src/network/protocol';
import {levels} from '../server/data/campaign';
class TestPeer implements Peer {messages:ServerMessage[]=[];closed=false;send(m:ServerMessage){this.messages.push(structuredClone(m));}close(){this.closed=true;}get state(){return this.messages.filter((m):m is SessionState=>m.type==='state').at(-1)!;}}
const user=(id:string):PlayerProfile=>({id,displayName:id,walletAddress:null,ensName:null,kind:'demo',completed:[]});
it('issues six-character codes, retries collisions and accepts lowercase invitation input',async()=>{
  const auth=new AuthService({databasePath:':memory:',demoEnabled:true}),store=new LevelStore(':memory:',new MemoryArchive());await store.seed(levels);const hub=new Sessions(auth,store),id=store.campaign()[0].id;
  const a=new TestPeer(),b=new TestPeer(),guest=new TestPeer();
  const random=vi.mocked(randomBytes);random.mockClear();random.mockImplementationOnce(size=>Buffer.alloc(size,0)).mockImplementationOnce(size=>Buffer.alloc(size,0)).mockImplementationOnce(size=>Buffer.alloc(size,1));
  try{
    await hub.join(a,user('a'),{kind:'create',mode:'coop',levelId:id,player:1});
    await hub.join(b,user('b'),{kind:'create',mode:'coop',levelId:id,player:2});
    expect(a.state.party?.code).toBe('AAAAAA');expect(b.state.party?.code).toBe('BBBBBB');expect(random).toHaveBeenCalledTimes(3);
    await hub.join(guest,user('guest'),{kind:'invite',code:'  aaaaaa  '});expect(guest.state.party?.id).toBe(a.state.party?.id);expect(guest.state.player).toBe(2);
    for(const code of ['AAAAA','AAAAAAA','AAAIO1','ABCDEF123456'])await expect(hub.join(new TestPeer(),user('bad'),{kind:'invite',code})).rejects.toThrow('6-character');
  }finally{random.mockRestore();hub.close();await store.drain();store.close();auth.close();}
});
it('keeps separate live parties isolated and expires disconnected guest/host memberships',async()=>{
  const auth=new AuthService({databasePath:':memory:',demoEnabled:true}),store=new LevelStore(':memory:',new MemoryArchive());await store.seed(levels);const hub=new Sessions(auth,store),id=store.campaign()[0].id;
  const a=new TestPeer(),b=new TestPeer(),c=new TestPeer(),d=new TestPeer();
  try{
    await hub.join(a,user('a'),{kind:'create',mode:'coop',levelId:id,player:1});await hub.join(b,user('b'),{kind:'invite',code:a.state.party!.code});
    await hub.join(c,user('c'),{kind:'create',mode:'coop',levelId:id,player:1});await hub.join(d,user('d'),{kind:'invite',code:c.state.party!.code});
    for(const p of [a,b,c,d])hub.receive(p,{type:'ready',ready:true});hub.receive(a,{type:'start'});hub.receive(c,{type:'start'});
    hub.receive(a,{type:'move',direction:'U',revision:a.state.revision});hub.receive(b,{type:'move',direction:'D',revision:b.state.revision});expect(a.state.history.at(-1)?.step).toBe(1);expect(c.state.history.at(-1)?.step).toBe(0);expect(d.state.partnerReady).toBe(false);
    hub.disconnect(b);const time=Date.now();vi.spyOn(Date,'now').mockReturnValue(time+46_000);hub.sweep();expect(a.state.party?.started).toBe(false);expect(a.state.party?.members).toHaveLength(1);expect(a.state.history.at(-1)?.step).toBe(0);expect(c.state.party?.started).toBe(true);
    const replacement=new TestPeer();await hub.join(replacement,user('replacement'),{kind:'invite',code:a.state.party!.code});expect(replacement.state.player).toBe(2);
    hub.disconnect(c);vi.mocked(Date.now).mockReturnValue(time+92_000);hub.sweep();expect(d.closed).toBe(true);expect(replacement.closed).toBe(false);
  }finally{vi.restoreAllMocks();hub.close();await store.drain();store.close();auth.close();}
});
it('returns a finished attempt to the same party, clears readiness and rejects premature or stale requests',async()=>{
  const auth=new AuthService({databasePath:':memory:',demoEnabled:true}),store=new LevelStore(':memory:',new MemoryArchive());await store.seed(levels);const hub=new Sessions(auth,store),id=store.campaign()[0].id;
  const host=new TestPeer(),guest=new TestPeer();vi.spyOn(auth,'recordCompletion').mockImplementation(()=>{});
  try{
    await hub.join(host,user('host'),{kind:'create',mode:'coop',levelId:id,player:2});await hub.join(guest,user('guest'),{kind:'invite',code:host.state.party!.code});
    const party=structuredClone(host.state.party!);
    hub.receive(host,{type:'ready',ready:true});hub.receive(guest,{type:'ready',ready:true});hub.receive(host,{type:'start'});
    hub.receive(guest,{type:'lobby',revision:guest.state.revision});expect(guest.messages.at(-1)?.type).toBe('error');expect(host.state.party?.started).toBe(true);
    for(let k=0;k<levels[0].solutionP1.length;k++){
      hub.receive(guest,{type:'move',direction:levels[0].solutionP1[k],revision:guest.state.revision});hub.receive(host,{type:'move',direction:levels[0].solutionP2[k],revision:host.state.revision});
    }
    expect(host.state.history.at(-1)?.status).toBe('VICTORY');expect(auth.recordCompletion).toHaveBeenCalledWith(['guest','host'],1);const finished=host.state.revision;
    hub.receive(guest,{type:'lobby',revision:finished-1});expect(guest.messages.at(-1)?.type).toBe('error');expect(host.state.party?.started).toBe(true);
    hub.receive(guest,{type:'lobby',revision:finished});
    for(const peer of [host,guest]){expect(peer.state.party?.started).toBe(false);expect(peer.state.party?.id).toBe(party.id);expect(peer.state.party?.code).toBe(party.code);expect(peer.state.party?.members.every(m=>!m.ready)).toBe(true);expect(peer.state.history).toHaveLength(1);expect(peer.state.history[0].step).toBe(0);expect(peer.state.partnerConnected).toBe(true);}
    expect(host.state.player).toBe(2);expect(guest.state.player).toBe(1);
    hub.receive(host,{type:'start'});expect(host.messages.at(-1)).toMatchObject({type:'error',message:expect.stringContaining('Ready')});
    hub.receive(host,{type:'ready',ready:true});hub.receive(guest,{type:'ready',ready:true});hub.receive(host,{type:'start'});expect(guest.state.party?.started).toBe(true);
    hub.receive(guest,{type:'move',direction:'U',revision:guest.state.revision});hub.receive(host,{type:'move',direction:'D',revision:host.state.revision});expect(host.state.history.at(-1)?.step).toBe(1);
  }finally{vi.restoreAllMocks();hub.close();await store.drain();store.close();auth.close();}
});
