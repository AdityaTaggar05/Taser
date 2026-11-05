import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {attachCoop} from '../server/socket';
import type {ServerMessage,SessionState} from '../src/network/protocol';
it('joins two real sockets, synchronizes a turn and resumes a disconnected seat',async()=>{
  const server=createServer(),close=attachCoop(server),clients:WebSocket[]=[];
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=(server.address() as {port:number}).port;
  async function connect(token?:string){
    const ws=new WebSocket(`ws://127.0.0.1:${port}/co-op`);clients.push(ws);
    const messages:ServerMessage[]=[];ws.on('message',data=>messages.push(JSON.parse(data.toString())));
    await once(ws,'open');ws.send(JSON.stringify({type:'join',token}));
    await expect.poll(()=>messages.some(m=>m.type==='state')).toBe(true);
    return {ws,messages,state:()=>messages.filter((m):m is SessionState=>m.type==='state').at(-1)!};
  }
  try{
    const a=await connect(),b=await connect();
    await expect.poll(()=>a.state().partnerConnected).toBe(true);
    expect(a.state().player).toBe(1);expect(b.state().player).toBe(2);
    a.ws.send(JSON.stringify({type:'move',direction:'U',revision:a.state().revision}));
    await expect.poll(()=>b.state().partnerReady).toBe(true);
    b.ws.send(JSON.stringify({type:'move',direction:'D',revision:b.state().revision}));
    await expect.poll(()=>a.state().history.at(-1)!.step).toBe(1);await expect.poll(()=>b.state().history.at(-1)!.step).toBe(1);
    const token=b.messages.find(m=>m.type==='welcome')! as {type:'welcome';token:string};
    b.ws.close();await once(b.ws,'close');await expect.poll(()=>a.state().partnerConnected).toBe(false);
    const restored=await connect(token.token);expect(restored.state().player).toBe(2);expect(restored.state().history.at(-1)!.step).toBe(1);
  }finally{for(const ws of clients)ws.terminate();close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},10_000);
