import {it,expect} from 'vitest';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive,type ArchiveRecord} from '../server/arkiv/archive';
import {levels} from '../server/data/campaign';
import {CoopRoom,type Peer} from '../server/CoopRoom';
import type {ServerMessage,SessionState} from '../src/network/protocol';
import {joinIntent} from '../src/network/routes';
it('ends a shorter fixed replay exactly, and undo/reset rewind its position',()=>{
  const room=new CoopRoom(()=>crypto.randomUUID(),Date.now,100,()=>{},undefined,undefined,undefined,undefined,{solo:{player:1,moves:['D']},fixedLevel:true});
  const states:SessionState[]=[],peer:Peer={send:(m:ServerMessage)=>{if(m.type==='state')states.push(m);},close:()=>{}};room.join(peer,'atlas',undefined,undefined,1);
  const state=()=>states.at(-1)!;room.receive(peer,{type:'move',direction:'U',revision:state().revision});expect(state().history.at(-1)?.status).toBe('OUT_OF_TIME');expect(state().history.at(-1)?.step).toBe(1);
  room.receive(peer,{type:'undo',revision:state().revision});expect(state().history.at(-1)?.step).toBe(0);room.receive(peer,{type:'move',direction:'U',revision:state().revision});expect(state().history.at(-1)?.status).toBe('OUT_OF_TIME');
  room.receive(peer,{type:'reset',revision:state().revision});expect(state().history.at(-1)?.step).toBe(0);expect(state().history.at(-1)?.status).toBe('PLAYING_PHASE_1');
});
it('uses 48-hour creation policy, recovers pending runs, deduplicates and removes expired metadata',async()=>{
  let head=0n,fail=false;const archive=new MemoryArchive(),put=archive.put.bind(archive);const records:ArchiveRecord[]=[];
  archive.head=async()=>head;archive.put=async record=>{records.push(structuredClone(record));if(fail&&record.category==='run')throw new Error('offline');const ref=await put(record);if(record.lifetimeDays===2)ref.expiresAt='100';return ref;};
  const store=new LevelStore(':memory:',archive);try{
    const draft=await store.save('atlas','Atlas',levels[0]);await store.publish('atlas',draft.id,1);expect(records.find(r=>r.category==='community')?.lifetimeDays).toBe(2);const snapshot=store.forPlay(draft.id)!;
    fail=true;expect(await store.captureRun(snapshot,{id:'atlas',displayName:'Atlas'},1,[levels[0].solutionP1,levels[0].solutionP2],'solo','creator')).toBe('pending');expect(store.runs(draft.id,1)).toEqual([]);
    fail=false;await store.flushRuns();expect(store.runs(draft.id,1)).toHaveLength(1);expect(records.find(r=>r.category==='run')?.lifetimeDays).toBe(2);
    await store.captureRun(snapshot,{id:'atlas',displayName:'Atlas'},1,[levels[0].solutionP1,levels[0].solutionP2],'solo','creator');expect(store.runs(draft.id,1)).toHaveLength(1);
    head=100n;await store.refreshAvailability();expect(store.community()).toEqual([]);expect(store.forPlay(draft.id)).toBeNull();
  }finally{await store.drain();store.close();}
});
it('parses only complete launch choices and leaves solo source selection in the menu',()=>{
  const id='00000000-0000-4000-8000-000000000001';expect(joinIntent('#solo/campaign/'+id+'/p1')).toBeNull();expect(joinIntent('#solo/campaign/'+id+'/p2/creator')).toMatchObject({mode:'solo',player:2});expect(joinIntent('#coop/campaign/'+id+'/p1')).toMatchObject({mode:'coop',player:1});expect(joinIntent('#coop/campaign/'+id+'/p1/creator')).toBeNull();expect(joinIntent('#invite/012345ABCDEF')).toEqual({kind:'invite',code:'012345ABCDEF'});
});
it('restores pending run publication after a server restart without creating extra runs',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const directory=mkdtempSync(join(tmpdir(),'taser-pending-run-')),path=join(directory,'game.sqlite'),archive=new MemoryArchive(),put=archive.put.bind(archive);let store=new LevelStore(path,archive);
  try{
    await store.seed(levels);const snapshot=store.campaignSnapshots()[0];archive.put=async record=>{if(record.category==='run')throw new Error('offline');return put(record);};
    expect(await store.captureRun(snapshot,{id:'a',displayName:'A'},2,[levels[0].solutionP1,levels[0].solutionP2],'solo','creator')).toBe('pending');store.close();
    archive.put=put;store=new LevelStore(path,archive);await store.hydrate();expect(store.runs(snapshot.id!,2)).toEqual([]);await store.flushRuns();expect(store.runs(snapshot.id!,2)).toHaveLength(1);await store.flushRuns();expect(store.runs(snapshot.id!,2)).toHaveLength(1);
  }finally{await store.drain();store.close();rmSync(directory,{recursive:true,force:true});}
});
