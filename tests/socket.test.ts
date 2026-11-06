import {it,expect} from 'vitest';
import {authFixture} from './authFixture';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {attachCoop} from '../server/socket';
import type {JoinIntent,ServerMessage,SessionState} from '../src/network/protocol';
import {levels} from '../server/data/campaign';
async function fixture(){
  const f=await authFixture(),stop=attachCoop(f.server,f.auth,undefined,f.levels),clients:WebSocket[]=[];
  const a=f.browser(),b=f.browser();await a.login();await b.login('nova');const catalog=(await a.request('levels/catalog')).data.campaign;
  async function connect(account:typeof a,intent:unknown,ticket?:string){
    const ws=new WebSocket(f.origin.replace('http:','ws:')+'/co-op');clients.push(ws);const messages:ServerMessage[]=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));await once(ws,'open');
    ws.send(JSON.stringify({type:'join',ticket:ticket??await account.ticket(),intent}));await expect.poll(()=>messages.some(m=>['state','full','auth_required'].includes(m.type))).toBe(true);
    return {ws,messages,state:()=>messages.filter((m):m is SessionState=>m.type==='state').at(-1)!,send:(m:unknown)=>ws.send(JSON.stringify(m))};
  }
  return {...f,a,b,catalog,connect,close:async()=>{clients.forEach(ws=>ws.terminate());stop();await f.levels.drain();await f.close();}};
}
function create(levelId:string,player:1|2,mode:'coop'|'solo'='coop',runId?:string):JoinIntent{return {kind:'create',mode,levelId,player,...(runId?{runId}:{})};}
it('creates a P2-hosted private party, requires ready/host start, synchronizes and resumes',async()=>{
  const f=await fixture();try{
    const host=await f.connect(f.a,create(f.catalog[0].id,2)),code=host.state().party!.code;
    expect(host.state().party?.started).toBe(false);expect(host.state().player).toBe(2);
    host.send({type:'move',direction:'D',revision:host.state().revision});await expect.poll(()=>host.messages.at(-1)?.type).toBe('error');expect(host.state().history).toHaveLength(1);
    const guest=await f.connect(f.b,{kind:'invite',code});expect(guest.state().player).toBe(1);
    guest.send({type:'start'});await expect.poll(()=>guest.messages.at(-1)).toMatchObject({type:'error',message:expect.stringContaining('Only the host')});
    host.send({type:'start'});await expect.poll(()=>host.messages.at(-1)).toMatchObject({type:'error',message:expect.stringContaining('Ready')});
    host.send({type:'ready',ready:true});guest.send({type:'ready',ready:true});await expect.poll(()=>host.state().party!.members.every(m=>m.ready)).toBe(true);
    host.send({type:'start'});await expect.poll(()=>guest.state().party!.started).toBe(true);
    guest.send({type:'move',direction:'U',revision:guest.state().revision});await expect.poll(()=>host.state().partnerReady).toBe(true);
    host.send({type:'move',direction:'D',revision:host.state().revision});await expect.poll(()=>host.state().history.at(-1)?.step).toBe(1);
    const id=host.state().party!.id;host.ws.close();await once(host.ws,'close');await expect.poll(()=>guest.state().partnerConnected).toBe(false);
    const resumed=await f.connect(f.a,{kind:'resume',id});expect(resumed.state().player).toBe(2);expect(resumed.state().history.at(-1)?.step).toBe(1);
    expect(resumed.state().level?.solutionP1).toEqual([]);expect(resumed.state().level?.initialBoxesP1).toEqual([]);
    guest.send({type:'leave'});await expect.poll(()=>resumed.state().party!.members.length).toBe(1);expect(resumed.state().party!.started).toBe(false);
    const replacement=await f.connect(f.b,{kind:'invite',code});expect(replacement.state().player).toBe(1);expect(replacement.state().history.at(-1)?.step).toBe(0);
  }finally{await f.close();}
},15_000);
it('isolates simultaneous solo sessions and keeps solo wins from unlocking progress or references',async()=>{
  const f=await fixture();try{
    const a=await f.connect(f.a,create(f.catalog[0].id,1,'solo')),b=await f.connect(f.b,create(f.catalog[1].id,2,'solo'));
    expect(a.state().party!.id).not.toBe(b.state().party!.id);expect(a.state().partnerConnected).toBe(true);expect(a.state().mode).toBe('solo');
    a.send({type:'move',direction:'R',revision:a.state().revision});await expect.poll(()=>a.messages.at(-1)?.type).toBe('error');expect(a.state().history).toHaveLength(1);
    a.send({type:'move',direction:'U',revision:a.state().revision});await expect.poll(()=>a.state().history.at(-1)?.step).toBe(1);expect(b.state().history).toHaveLength(1);
    a.send({type:'undo',revision:a.state().revision});await expect.poll(()=>a.state().history.at(-1)?.step).toBe(0);
    for(const direction of levels[0].solutionP1){const step=a.state().history.at(-1)!.step;a.send({type:'move',direction,revision:a.state().revision});await expect.poll(()=>a.state().history.at(-1)?.step).toBe(step+1);}
    expect(a.state().history.at(-1)?.status).toBe('VICTORY');await expect.poll(()=>a.state().runPublication).toBe('confirmed');
    expect((await f.a.request('session')).data.user.completed).toEqual([]);expect((await f.a.request('levels/solution/'+f.catalog[0].entityKey)).status).toBe(403);expect(a.state().solutionAvailable).toBe(false);
    const runs=(await f.b.request('levels/runs/'+f.catalog[0].id+'/1')).data.runs;expect(runs).toHaveLength(1);expect(runs[0].name).toBe('Atlas');expect(runs[0]).not.toHaveProperty('moves');expect(runs[0]).not.toHaveProperty('level');
    expect((await f.b.request('levels/runs/'+f.catalog[0].id+'/2')).data.runs).toEqual([]);
    b.send({type:'leave'});await once(b.ws,'close');
    const replay=await f.connect(f.b,create(f.catalog[0].id,2,'solo',runs[0].id));expect(replay.state().echoName).toBe('Atlas');
    for(const direction of levels[0].solutionP2){const step=replay.state().history.at(-1)!.step;replay.send({type:'move',direction,revision:replay.state().revision});await expect.poll(()=>replay.state().history.at(-1)?.step).toBe(step+1);}
    await expect.poll(()=>replay.state().runPublication).toBe('confirmed');expect(replay.state().history.at(-1)?.status).toBe('VICTORY');
    expect((await f.b.request('levels/runs/'+f.catalog[0].id+'/1')).data.runs).toHaveLength(1);expect((await f.b.request('levels/runs/'+f.catalog[0].id+'/2')).data.runs).toHaveLength(1);
  }finally{await f.close();}
},20_000);
it('unlocks exact-revision references for co-op wins and archives both human roles',async()=>{
  const f=await fixture();try{
    const host=await f.connect(f.a,create(f.catalog[0].id,1)),guest=await f.connect(f.b,{kind:'invite',code:host.state().party!.code});
    host.send({type:'ready',ready:true});guest.send({type:'ready',ready:true});await expect.poll(()=>host.state().party!.members.every(m=>m.ready)).toBe(true);host.send({type:'start'});await expect.poll(()=>guest.state().party!.started).toBe(true);
    for(let k=0;k<levels[0].solutionP1.length;k++){host.send({type:'move',direction:levels[0].solutionP1[k],revision:host.state().revision});guest.send({type:'move',direction:levels[0].solutionP2[k],revision:guest.state().revision});await expect.poll(()=>host.state().history.at(-1)?.step).toBe(k+1);await expect.poll(()=>guest.state().history.at(-1)?.step).toBe(k+1);}
    await expect.poll(()=>host.state().runPublication).toBe('confirmed');await expect.poll(()=>guest.state().runPublication).toBe('confirmed');
    expect(host.state().solutionAvailable).toBe(true);expect(guest.state().solutionAvailable).toBe(true);expect((await f.b.request('session')).data.user.completed).toContain(1);
    expect((await f.b.request('levels/solution/'+f.catalog[0].entityKey)).data.solutionP2).toEqual(levels[0].solutionP2);
    expect((await f.a.request('levels/runs/'+f.catalog[0].id+'/1')).data.runs).toHaveLength(1);expect((await f.a.request('levels/runs/'+f.catalog[0].id+'/2')).data.runs).toHaveLength(1);
  }finally{await f.close();}
},15_000);
it('rejects bad invitations, forged roles, unauthorized resumes and duplicate sessions; logout closes parties',async()=>{
  const f=await fixture();try{
    for(const intent of [{kind:'invite',code:'bad'},create(f.catalog[0].id,3 as 1),{kind:'resume',id:'missing'},null]){const bad=await f.connect(f.a,intent);expect(bad.messages.some(m=>m.type==='state')).toBe(false);}
    const host=await f.connect(f.a,create(f.catalog[0].id,1));
    const intruder=await f.connect(f.b,{kind:'resume',id:host.state().party!.id});expect(intruder.messages.some(m=>m.type==='state')).toBe(false);
    const duplicate=await f.connect(f.a,create(f.catalog[0].id,2,'solo'));expect(duplicate.messages.some(m=>m.type==='state')).toBe(false);
    const guest=await f.connect(f.b,{kind:'invite',code:host.state().party!.code});await f.a.request('logout',{});await expect.poll(()=>host.ws.readyState).toBe(WebSocket.CLOSED);await expect.poll(()=>guest.ws.readyState).toBe(WebSocket.CLOSED);
    expect(host.messages.some(m=>m.type==='auth_required')).toBe(true);
  }finally{await f.close();}
},15_000);
it('rejects unauthenticated and reused socket tickets',async()=>{
  const f=await fixture();try{
    const intent=create(f.catalog[0].id,1),bad=await f.connect(f.a,intent,'invalid');expect(bad.messages.some(m=>m.type==='auth_required')).toBe(true);
    const ticket=await f.a.ticket();await f.connect(f.a,intent,ticket);const replay=await f.connect(f.b,intent,ticket);expect(replay.messages.some(m=>m.type==='auth_required')).toBe(true);
  }finally{await f.close();}
},10_000);
it('pins a community party to its publication and rejects wrong level or wrong role replays',async()=>{
  const f=await fixture();try{
    const draft=(await f.a.request('levels',{level:levels[0]})).data;await f.a.request(`levels/${draft.id}/publish`,{revision:1});const snapshot=f.levels.forPlay(draft.id)!;
    await f.levels.captureRun(snapshot,{id:'other',displayName:'Other'},1,[levels[0].solutionP1,levels[0].solutionP2],'coop','live');const run=f.levels.runs(draft.id,1)[0];
    const wrongRole=await f.connect(f.a,create(draft.id,1,'solo',run.id));expect(wrongRole.messages.some(m=>m.type==='state')).toBe(false);
    expect((await f.a.request(`levels/${draft.id}`,{level:{...levels[0],name:'Changed'},revision:1})).status).toBe(409);
    const next=(await f.a.request('levels',{level:{...levels[0],name:'Another level'}})).data;await f.a.request(`levels/${next.id}/publish`,{revision:1});
    const stale=await f.connect(f.a,create(next.id,2,'solo',run.id));expect(stale.messages.some(m=>m.type==='state')).toBe(false);
  }finally{await f.close();}
},10_000);

it('locks the opposite starting projection per player over real sockets and restores it on reset',async()=>{
  const f=await fixture();try{
    const host=await f.connect(f.a,create(f.catalog[0].id,2)),guest=await f.connect(f.b,{kind:'invite',code:host.state().party!.code});
    expect(host.state().study).toBeUndefined();expect(guest.state().study).toBeUndefined();
    host.send({type:'ready',ready:true});guest.send({type:'ready',ready:true});await expect.poll(()=>host.state().party!.members.every(m=>m.ready)).toBe(true);host.send({type:'start'});
    await expect.poll(()=>host.state().study?.player).toBe(1);await expect.poll(()=>guest.state().study?.player).toBe(2);
    const attempt=host.state().study!.attempt;
    host.send({type:'move',direction:'D',revision:host.state().revision});await expect.poll(()=>host.state().pendingMove).toBe('D');expect(host.state().study).toBeUndefined();expect(guest.state().study).toBeDefined();
    host.send({type:'cancel',revision:host.state().revision});await expect.poll(()=>host.state().pendingMove).toBeNull();expect(host.state().study).toBeUndefined();
    host.send({type:'move',direction:'D',revision:host.state().revision});guest.send({type:'move',direction:'U',revision:guest.state().revision});await expect.poll(()=>host.state().history.at(-1)?.step).toBe(1);await expect.poll(()=>guest.state().study).toBeUndefined();
    expect(host.state().level?.initialBoxesP1).toEqual([]);expect(guest.state().level?.initialBoxesP2).toEqual([]);
    host.send({type:'undo',revision:host.state().revision});await expect.poll(()=>host.state().history.at(-1)?.step).toBe(0);expect(host.state().study).toBeUndefined();
    host.send({type:'reset',revision:host.state().revision});await expect.poll(()=>host.state().study?.attempt).toBeGreaterThan(attempt);await expect.poll(()=>guest.state().study?.attempt).toBe(host.state().study!.attempt);
  }finally{await f.close();}
},10_000);
