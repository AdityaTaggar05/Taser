import type { ClientCommand, ServerMessage, SessionState } from './protocol';
export type ConnectionStatus='connecting'|'connected'|'reconnecting'|'full';
export class CoopClient {
  state:SessionState|null=null;
  status:ConnectionStatus='connecting';
  notice:string|null=null;
  private socket:WebSocket|null=null;
  private retry:ReturnType<typeof setTimeout>|undefined;
  private stopped=false;
  private token:string|null=null;
  constructor(private changed:(previous:SessionState|null)=>void) {
    try{this.token=sessionStorage.getItem('weldpoint:seat');}catch{/* Memory-only reconnect still works. */}
    this.connect();
  }
  private connect(){
    if(this.stopped)return;
    this.status=this.state?'reconnecting':'connecting';this.changed(this.state);
    const url=new URL('/co-op',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url);this.socket=ws;
    const handshake=setTimeout(()=>{if(this.socket===ws)ws.close();},8000);
    ws.onopen=()=>ws.send(JSON.stringify({type:'join',token:this.token}));
    ws.onmessage=e=>{
      if(this.stopped||this.socket!==ws)return;
      let message:ServerMessage;try{message=JSON.parse(e.data);}catch{return;}
      if(message.type==='welcome'){
        this.token=message.token;
        try{sessionStorage.setItem('weldpoint:seat',message.token);}catch{/* Optional refresh recovery. */}
      }else if(message.type==='state'){
        clearTimeout(handshake);
        const previous=this.state;this.state=message;this.status='connected';this.notice=null;this.changed(previous);
      }else if(message.type==='error'){this.notice=message.message;this.changed(this.state);}
      else if(message.type==='full'){clearTimeout(handshake);this.status='full';this.notice=message.message;this.changed(this.state);}
    };
    ws.onclose=()=>{
      clearTimeout(handshake);
      if(this.stopped||this.socket!==ws)return;
      if(this.status!=='full')this.status='reconnecting';
      this.changed(this.state);
      this.retry=setTimeout(()=>this.connect(),this.status==='full'?5000:1500);
    };
    ws.onerror=()=>{/* onclose performs reconnection */};
  }
  get playable(){return this.status==='connected'&&!!this.state?.partnerConnected;}
  send(command:ClientCommand){
    if(!this.playable||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.notice=null;this.socket.send(JSON.stringify(command));return true;
  }
  showNotice(message:string){this.notice=message;this.changed(this.state);}
  destroy(){this.stopped=true;clearTimeout(this.retry);this.socket?.close();}
}
