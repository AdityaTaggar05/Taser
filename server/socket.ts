import type { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { CoopRoom, type Peer } from './CoopRoom';

export function attachCoop(server:EventEmitter) {
  const room=new CoopRoom(randomUUID);
  const wss=new WebSocketServer({noServer:true,maxPayload:2048});
  const alive=new Map<WebSocket,boolean>();
  // Leave unrelated upgrades (including Vite HMR) to their handlers.
  const onUpgrade=(request:import('node:http').IncomingMessage,socket:import('node:stream').Duplex,head:Buffer)=>{
    if(request.url?.split('?')[0]!=='/co-op')return;
    if(request.headers.origin){
      try { if(new URL(request.headers.origin).host!==request.headers.host){socket.destroy();return;} } catch {socket.destroy();return;}
    }
    wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request));
  };
  server.on('upgrade',onUpgrade);
  wss.on('connection',ws=>{
    alive.set(ws,true);ws.on('pong',()=>alive.set(ws,true));
    const peer:Peer={send:m=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));},close:()=>ws.close(1000)};
    let joined=false, count=0, windowStart=Date.now();
    const helloTimeout=setTimeout(()=>ws.close(1008,'Join timeout'),5000);
    ws.on('message',raw=>{
      const now=Date.now();if(now-windowStart>1000){count=0;windowStart=now;}
      if(++count>40){ws.close(1008,'Too many commands');return;}
      let message:unknown;try{message=JSON.parse(raw.toString());}catch{peer.send({type:'error',message:'Malformed message.'});return;}
      if(!joined){
        const m=message as Record<string,unknown>|null;
        if(!m||m.type!=='join'){ws.close(1008,'Join required');return;}
        clearTimeout(helloTimeout);
        const token=typeof m.token==='string'&&m.token.length<=128?m.token:undefined;
        joined=room.join(peer,token)!==null;return;
      }
      room.receive(peer,message);
    });
    ws.on('close',()=>{clearTimeout(helloTimeout);alive.delete(ws);room.leave(peer);});
    ws.on('error',()=>{/* close event releases the seat */});
  });
  const maintenance=setInterval(()=>{
    room.expire();
    for(const [ws,ok] of alive){if(!ok){ws.terminate();continue;}alive.set(ws,false);ws.ping();}
  },10_000);maintenance.unref();
  return ()=>{clearInterval(maintenance);server.off('upgrade',onUpgrade);for(const ws of wss.clients)ws.terminate();wss.close();};
}
