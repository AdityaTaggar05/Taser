import {it,expect} from 'vitest';
import {authFixture} from './authFixture';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {attachCoop} from '../server/socket';
import type {ServerMessage,SessionState} from '../src/network/protocol';
it('joins two real sockets, synchronizes a turn and resumes a disconnected seat',async()=>{
  const f=await authFixture(),server=f.server,close=attachCoop(server,f.auth),clients:WebSocket[]=[];
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
  const f=await authFixture(),close=attachCoop(f.server,f.auth),clients:WebSocket[]=[];
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
