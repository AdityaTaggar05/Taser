import {it,expect} from 'vitest';
import {CoopRoom,type Peer} from '../server/CoopRoom';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive,type ArchiveWrite} from '../server/arkiv/archive';
import {levels} from '../server/data/campaign';
import type {SessionState,ServerMessage} from '../src/network/protocol';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
class TestPeer implements Peer {messages:ServerMessage[]=[];send(m:ServerMessage){this.messages.push(m);}close(){}get state(){return this.messages.filter((m):m is SessionState=>m.type==='state').at(-1)!;}}
it('records one completed pair, skips rejected/queued/cancelled/stale inputs and retains unique events through undo/reset/reconnect/level changes',()=>{
  const turns:Array<{sequence:number;turn:number;inputs:string[];ids:string[]}>=[];
  const room=new CoopRoom(()=>crypto.randomUUID(),Date.now,45_000,undefined,undefined,undefined,undefined,undefined,{turn:(_,sequence,turn,inputs,ids)=>turns.push({sequence,turn,inputs,ids})});
  const a=new TestPeer(),b=new TestPeer();room.join(a,'a');room.join(b,'b');
  const move=(peer:TestPeer,direction:string)=>room.receive(peer,{type:'move',direction,revision:peer.state.revision});
  move(a,'L');expect(turns).toHaveLength(0);move(a,'U');expect(turns).toHaveLength(0);
  room.receive(a,{type:'cancel',revision:a.state.revision});move(b,'D');expect(turns).toHaveLength(0);move(a,'U');
  expect(turns).toEqual([{sequence:1,turn:1,inputs:['U','D'],ids:['a','b']}]);
  room.receive(a,{type:'move',direction:'U',revision:a.state.revision-1});expect(turns).toHaveLength(1);
  room.receive(a,{type:'undo',revision:a.state.revision});move(a,'U');move(b,'D');expect(turns[1]).toMatchObject({sequence:2,turn:1});
  room.receive(a,{type:'reset',revision:a.state.revision});room.leave(b);const returned=new TestPeer();room.join(returned,'b');expect(turns).toHaveLength(2);
  move(a,'U');move(returned,'D');expect(turns[2]).toMatchObject({sequence:3,turn:1});
  room.receive(a,{type:'level',index:1,revision:a.state.revision});move(a,'W');move(returned,'W');expect(turns[3]).toMatchObject({sequence:4,turn:1});
});
it.each([1,2] as const)('counts the solo replay as the partner input for P%s without waiting for chain confirmation',async player=>{
  const archive=new MemoryArchive(),store=new LevelStore(':memory:',archive);await store.seed(levels);const snapshot=store.campaignSnapshots()[0];
  const put=archive.put.bind(archive);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  archive.put=async record=>{if(record.category==='move')await gate;return put(record);};
  const room=new CoopRoom(()=>crypto.randomUUID(),Date.now,45_000,undefined,undefined,[snapshot],undefined,undefined,{solo:{player,moves:player===1?levels[0].solutionP2:levels[0].solutionP1},turn:(s,seq,turn,inputs,ids)=>store.captureMove(s,'match',seq,turn,inputs,ids,'solo')});
  const a=new TestPeer();room.join(a,'human',undefined,undefined,player);
  try{
    const moves=player===1?levels[0].solutionP1:levels[0].solutionP2;
    for(let i=0;i<2;i++)room.receive(a,{type:'move',direction:moves[i],revision:a.state.revision});
    expect(a.state.history.at(-1)?.step).toBe(2);expect(store.activityFeed('human').activities).toHaveLength(2);expect(store.activityFeed('human').activities.every(a=>a.state==='pending')).toBe(true);
  }finally{release();await store.drain();store.close();}
});
it('recovers durable failed move writes after restart, deduplicates frozen intents and hides private data and other audiences',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'taser-moves-')),path=join(directory,'game.sqlite');const archive=new MemoryArchive();let store=new LevelStore(path,archive);await store.seed(levels);const snapshot=store.campaignSnapshots()[0],put=archive.put.bind(archive);
  archive.put=async record=>{if(record.category==='move')throw new Error('secret provider diagnostics');return put(record);};
  try{
    store.captureMove(snapshot,'session',1,1,['U','D'],['a','b'],'coop');await store.drain();
    const feed=store.activityFeed('a');expect(feed.activities[0]).toMatchObject({kind:'move',state:'failed'});expect(store.activityFeed('b')).toEqual(feed);expect(store.activityFeed('other').activities).toEqual([]);
    expect(JSON.stringify(feed)).not.toMatch(/inputs|levelKey|secret provider|ownerId|sessionId/);
    store.close();store=new LevelStore(path,archive);archive.put=put;await store.flushMoves();
    expect(store.activityFeed('a').activities[0].state).toBe('confirmed');
    store.captureMove(snapshot,'session',1,1,['U','D'],['a','b'],'coop');await store.drain();
    expect([...archive.entries.values()].filter(e=>e.record.category==='move')).toHaveLength(1);expect(store.activityFeed('a').activities).toHaveLength(1);
    const saved=[...archive.entries.values()].find(e=>e.record.category==='move')!.record;expect(saved).toMatchObject({category:'move',lifetimeDays:2,move:{inputs:['U','D'],turn:1,sequence:1}});
    expect(saved).not.toHaveProperty('level');expect((await archive.list()).some(e=>(e.record as ArchiveWrite).category==='move')).toBe(false);
  }finally{await store.drain();store.close();rmSync(directory,{recursive:true,force:true});}
});
