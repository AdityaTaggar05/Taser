import type { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { CoopRoom, type Peer,type PublishedLevelLoader } from './CoopRoom';
import {AuthService,type SessionIdentity} from './auth/AuthService';
import type {LevelStore,PublishedSnapshot} from './levels/LevelStore';

export function attachCoop(server:EventEmitter,auth:AuthService,loadPublished?:PublishedLevelLoader,store?:LevelStore) {
  let closing=false;
  const loading=new Map<string,PublishedSnapshot>();
  const room=new CoopRoom(randomUUID,Date.now,45_000,(ids,level)=>auth.recordCompletion(ids,level),
    store?id=>loading.get(id)??null:loadPublished,store?.campaignSnapshots(),
    (ids,key)=>store?.recordWin(ids,key),(id,key)=>store?.canReveal(id,key)??false);
  const identities=new Map<WebSocket,{identity:SessionIdentity;peer:Peer}>();
  const reject=(ws:WebSocket,peer:Peer)=>{room.release(peer);peer.send({type:'auth_required',message:'Your session ended. Please sign in again.'});ws.close(4401,'Sign in required');};
  const unsubscribe=auth.onRevoke(key=>{for(const [ws,entry] of identities)if(entry.identity.key===key)reject(ws,entry.peer);});
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
    let joined=false,joining=false, count=0, windowStart=Date.now();
    const helloTimeout=setTimeout(()=>ws.close(1008,'Join timeout'),5000);
    ws.on('message',raw=>{
      if(joining)return;
      const now=Date.now();if(now-windowStart>1000){count=0;windowStart=now;}
      if(++count>40){ws.close(1008,'Too many commands');return;}
      let message:unknown;try{message=JSON.parse(raw.toString());}catch{peer.send({type:'error',message:'Malformed message.'});return;}
      if(!joined){
        const m=message as Record<string,unknown>|null;
        if(!m||m.type!=='join'){ws.close(1008,'Join required');return;}
        clearTimeout(helloTimeout);
        const token=typeof m.token==='string'&&m.token.length<=128?m.token:undefined;
        const identity=auth.consumeTicket(m.ticket);
        if(!identity){reject(ws,peer);return;}
        identities.set(ws,{identity,peer});
        const requested=typeof m.customLevelId==='string'&&/^[a-f0-9-]{36}$/.test(m.customLevelId)?m.customLevelId:undefined;
        if(m.customLevelId!==undefined&&!requested){peer.send({type:'full',message:'Invalid published level link. Return home and choose a chamber.'});peer.close();return;}
        if(m.player!==1&&m.player!==2){peer.send({type:'full',message:'Choose P1 or P2 before joining.'});peer.close();return;}
        const player=m.player;
        room.expire();
        joining=true;
        void (async()=>{
          if(store){
            if(room.empty)room.updateCampaign(store.campaignSnapshots());
            if(requested&&room.empty){const snapshot=store.forPlay(requested);if(snapshot){await store.validateSnapshot(snapshot);loading.set(requested,snapshot);}}
            else if(room.empty){const first=store.campaignSnapshots()[0];if(!first)throw new Error();await store.validateSnapshot(first);}
          }
          if(closing||ws.readyState!==WebSocket.OPEN)return;
          if(!auth.isActive(identity.key)){reject(ws,peer);return;}
          joined=room.join(peer,identity.user.id,token,requested,player)!==null;
        })().catch(()=>{peer.send({type:'full',message:'The archived chamber could not be loaded. Check its availability and retry.'});peer.close();}).finally(()=>{joining=false;if(requested)loading.delete(requested);});return;
      }
      const entry=identities.get(ws);if(!entry||!auth.isActive(entry.identity.key)){reject(ws,peer);return;}
      if(message&&typeof message==='object'&&'type' in message&&message.type==='leave'){
        room.release(peer);joined=false;peer.close();return;
      }
      if(store&&message&&typeof message==='object'&&'type' in message&&message.type==='level'&&'index' in message){
        const index=message.index;if(typeof index!=='number'||!Number.isInteger(index)||index<0){peer.send({type:'error',message:'Unknown campaign chamber.'});return;}
        const snapshot=room.campaignSnapshot(index);if(!snapshot){peer.send({type:'error',message:'Unknown campaign chamber.'});return;}
        joining=true;void store.validateSnapshot(snapshot).then(()=>{if(!closing&&ws.readyState===WebSocket.OPEN&&auth.isActive(entry.identity.key))room.receive(peer,message);}).catch(()=>peer.send({type:'error',message:'This archived campaign revision is unavailable.'})).finally(()=>joining=false);return;
      }
      room.receive(peer,message);
    });
    ws.on('close',()=>{clearTimeout(helloTimeout);alive.delete(ws);identities.delete(ws);if(!closing)room.leave(peer);});
    ws.on('error',()=>{/* close event releases the seat */});
  });
  const maintenance=setInterval(()=>{
    auth.sweep();room.expire();
    for(const [ws,ok] of alive){const entry=identities.get(ws);if(entry&&!auth.isActive(entry.identity.key)){reject(ws,entry.peer);continue;}if(!ok){ws.terminate();continue;}alive.set(ws,false);ws.ping();}
  },10_000);maintenance.unref();
  return ()=>{closing=true;unsubscribe();clearInterval(maintenance);server.off('upgrade',onUpgrade);for(const ws of wss.clients)ws.terminate();wss.close();};
}
