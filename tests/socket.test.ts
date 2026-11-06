import {it,expect} from 'vitest';
import {authFixture} from './authFixture';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {attachCoop} from '../server/socket';
import type {ServerMessage,SessionState} from '../src/network/protocol';
it('joins two real sockets, synchronizes a turn and resumes a disconnected seat',async()=>{
  const f=await authFixture(),server=f.server,close=attachCoop(server,f.auth,undefined,f.levels),clients:WebSocket[]=[];
  const atlas=f.browser(),nova=f.browser();await atlas.login();await nova.login('nova');
  const port=(server.address() as {port:number}).port;
  async function connect(account:typeof atlas,token?:string){
    const ws=new WebSocket(`ws://127.0.0.1:${port}/co-op`);clients.push(ws);
    const messages:ServerMessage[]=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));
    await once(ws,'open');ws.send(JSON.stringify({type:'join',token,ticket:await account.ticket()}));
    await expect.poll(()=>messages.some(m=>m.type==='state')).toBe(true);
    return {ws,messages,state:()=>messages.filter((m):m is SessionState=>m.type==='state').at(-1)!};
  }
  try{
    const a=await connect(atlas),b=await connect(nova);
    await expect.poll(()=>a.state().partnerConnected).toBe(true);
    expect(a.state().player).toBe(1);expect(b.state().player).toBe(2);
    a.ws.send(JSON.stringify({type:'move',direction:'U',revision:a.state().revision}));
    await expect.poll(()=>b.state().partnerReady).toBe(true);
    b.ws.send(JSON.stringify({type:'move',direction:'D',revision:b.state().revision}));
    await expect.poll(()=>a.state().history.at(-1)!.step).toBe(1);await expect.poll(()=>b.state().history.at(-1)!.step).toBe(1);
    const token=b.messages.find(m=>m.type==='welcome')! as {type:'welcome';token:string};
    b.ws.close();await once(b.ws,'close');await expect.poll(()=>a.state().partnerConnected).toBe(false);
    const restored=await connect(nova,token.token);expect(restored.state().player).toBe(2);expect(restored.state().history.at(-1)!.step).toBe(1);
    restored.ws.send(JSON.stringify({type:'leave'}));await once(restored.ws,'close');
    await expect.poll(()=>a.state().partnerConnected).toBe(false);
    const replacement=await connect(nova);expect(replacement.state().player).toBe(2);expect(replacement.state().history.at(-1)!.step).toBe(0);
  }finally{for(const ws of clients)ws.terminate();close();await f.close();}
},10_000);
it('rejects unauthenticated joins and reused tickets, and closes live play on logout',async()=>{
  const f=await authFixture(),close=attachCoop(f.server,f.auth,undefined,f.levels),clients:WebSocket[]=[];
  async function socket(ticket?:string){
    const ws=new WebSocket(f.origin.replace('http:','ws:')+'/co-op');clients.push(ws);const messages:ServerMessage[]=[];ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));await once(ws,'open');ws.send(JSON.stringify({type:'join',ticket}));return {ws,messages};
  }
  try{
    const anonymous=await socket();await expect.poll(()=>anonymous.messages.some(m=>m.type==='auth_required')).toBe(true);await expect.poll(()=>anonymous.ws.readyState).toBe(WebSocket.CLOSED);
    const account=f.browser();await account.login();const ticket=await account.ticket(),signed=await socket(ticket);await expect.poll(()=>signed.messages.some(m=>m.type==='state')).toBe(true);
    const replay=await socket(ticket);await expect.poll(()=>replay.messages.some(m=>m.type==='auth_required')).toBe(true);
    await account.request('logout',{});await expect.poll(()=>signed.ws.readyState).toBe(WebSocket.CLOSED);expect(signed.messages.some(m=>m.type==='auth_required')).toBe(true);
    await account.login('nova');const next=await socket(await account.ticket());await expect.poll(()=>next.messages.some(m=>m.type==='state')).toBe(true);expect((next.messages.find(m=>m.type==='state') as SessionState).player).toBe(1);
  }finally{for(const ws of clients)ws.terminate();close();await f.close();}
},10_000);
it('loads a server-published custom level over real authenticated sockets without exposing its witness',async()=>{
  const f=await authFixture(),close=attachCoop(f.server,f.auth,undefined,f.levels),clients:WebSocket[]=[];
  try{
    const atlas=f.browser(),nova=f.browser();await atlas.login();await nova.login('nova');
    const {levels}=await import('../server/data/campaign');const created=await atlas.request('levels',{level:levels[0]});const id=created.data.id;expect((await atlas.request(`levels/${id}/publish`,{revision:1})).status).toBe(200);
    async function connect(account:typeof atlas){const ws=new WebSocket(f.origin.replace('http:','ws:')+'/co-op');clients.push(ws);const messages:ServerMessage[]=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));await once(ws,'open');ws.send(JSON.stringify({type:'join',ticket:await account.ticket(),customLevelId:id}));await expect.poll(()=>messages.some(m=>m.type==='state')).toBe(true);return {ws,state:()=>messages.filter((m):m is SessionState=>m.type==='state').at(-1)!};}
    const a=await connect(atlas),b=await connect(nova);await expect.poll(()=>a.state().partnerConnected).toBe(true);expect(a.state().customLevelId).toBe(id);expect(a.state().level?.solutionP1).toEqual([]);expect(a.state().level?.solutionP2).toEqual([]);expect(a.state().level?.initialBoxesP2).toEqual([]);expect(b.state().level?.switchesP1).toEqual([]);
    a.ws.send(JSON.stringify({type:'move',direction:'U',revision:a.state().revision}));b.ws.send(JSON.stringify({type:'move',direction:'D',revision:b.state().revision}));await expect.poll(()=>a.state().history.at(-1)?.step).toBe(1);
  }finally{for(const ws of clients)ws.terminate();close();await f.close();}
},10_000);
it('keeps campaign witnesses private until both accounts actually win the published revision',async()=>{
  const f=await authFixture(),close=attachCoop(f.server,f.auth,undefined,f.levels),clients:WebSocket[]=[];
  try{
    const {levels}=await import('../server/data/campaign');
    const a=f.browser(),b=f.browser();await a.login();await b.login('nova');
    const campaign=(await b.request('levels/catalog')).data.campaign[0];
    const novaId=(await b.request('session')).data.user.id;
    // Numeric completion from the old release does not authorize a different encrypted publication.
    f.auth.recordCompletion([novaId],1);
    expect((await b.request(`levels/solution/${campaign.entityKey}`)).status).toBe(403);
    async function connect(account:typeof a){const ws=new WebSocket(f.origin.replace('http:','ws:')+'/co-op');clients.push(ws);const messages:ServerMessage[]=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));await once(ws,'open');ws.send(JSON.stringify({type:'join',ticket:await account.ticket(),customLevelId:campaign.id}));await expect.poll(()=>messages.some(m=>m.type==='state')).toBe(true);return {ws,state:()=>messages.filter((m):m is SessionState=>m.type==='state').at(-1)!};}
    const p1=await connect(a),p2=await connect(b);await expect.poll(()=>p1.state().partnerConnected).toBe(true);
    expect(p1.state().level?.solutionP1).toEqual([]);expect(p1.state().level?.initialBoxesP2).toEqual([]);expect(p2.state().level?.switchesP1).toEqual([]);expect(p1.state().solutionAvailable).toBe(false);expect(p1.state().levelIndex).toBe(0);
    for(let k=0;k<levels[0].totalSteps;k++){
      const revision=p1.state().revision;p1.ws.send(JSON.stringify({type:'move',direction:levels[0].solutionP1[k],revision}));p2.ws.send(JSON.stringify({type:'move',direction:levels[0].solutionP2[k],revision}));
      await expect.poll(()=>p1.state().history.at(-1)?.step).toBe(k+1);await expect.poll(()=>p2.state().history.at(-1)?.step).toBe(k+1);
    }
    expect(p2.state().history.at(-1)?.status).toBe('VICTORY');expect(p1.state().solutionAvailable).toBe(true);expect(p2.state().solutionAvailable).toBe(true);
    expect((await b.request(`levels/solution/${campaign.entityKey}`)).data.solutionP2).toEqual(levels[0].solutionP2);
    expect((await b.request(`levels/campaign/${campaign.id}/template`)).status).toBe(200);
  }finally{for(const ws of clients)ws.terminate();close();await f.close();}
},10_000);
