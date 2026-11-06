import {createServer} from 'node:http';
import {once} from 'node:events';
import {AuthService} from '../server/auth/AuthService';
import {LevelStore} from '../server/levels/LevelStore';
import {applicationApi} from '../server/api';
import {MemoryArchive} from '../server/arkiv/archive';
import {levels as campaign} from '../server/data/campaign';
export async function authFixture(options:{demoEnabled?:boolean;now?:()=>number;databasePath?:string}={}){
  const auth=new AuthService({databasePath:':memory:',demoEnabled:true,...options});
  const levels=new LevelStore(auth.databasePath,new MemoryArchive());await levels.seed(campaign);const api=applicationApi(auth,levels);
  const server=createServer((req,res)=>void api(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  function browser(){
    const context=crypto.randomUUID().replaceAll('-',''),cookies=new Map<string,string>();
    async function request(action:string,body?:unknown,overrides:Record<string,string>={}){
      const response=await fetch(`${origin}/api/auth/${context}/${action}`,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...overrides},body:body===undefined?undefined:JSON.stringify(body)});
      for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
      return {status:response.status,data:await response.json(),headers:response.headers};
    }
    async function login(username='atlas'){return request('demo',{username,password:username==='atlas'?'Atlas@WeldPoint26!':'Nova@WeldPoint26!'});}
    async function ticket(){const r=await request('socket-ticket',{});if(r.status!==200)throw new Error('Ticket request failed');return r.data.ticket as string;}
    return {context,cookies,request,login,ticket};
  }
  return {auth,levels,server,origin,browser,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await levels.drain();levels.close();auth.close();}};
}
