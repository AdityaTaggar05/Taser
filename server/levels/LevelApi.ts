import type {IncomingMessage,ServerResponse} from 'node:http';
import {AuthError,AuthService} from '../auth/AuthService';
import {LevelError,LevelStore} from './LevelStore';
export class LevelApi {
  constructor(private auth:AuthService,private store:LevelStore){}
  async handle(req:IncomingMessage,res:ServerResponse){
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try{
      const path=new URL(req.url??'/','http://local').pathname,match=/^\/api\/auth\/([a-f0-9]{32})\/levels(?:\/(community|[a-f0-9-]{36})(?:\/(publish))?)?$/.exec(path);
      if(!match)throw new LevelError(404,'Unknown level endpoint.');
      const identity=this.auth.authorize(req,match[1],req.method!=='GET');
      if(req.method==='GET'){
        if(match[3])throw new LevelError(405,'Use POST to publish.');
        json(200,match[2]==='community'?{levels:this.store.community()}:match[2]?this.store.get(identity.user.id,match[2]):{levels:this.store.list(identity.user.id)});return;
      }
      if(req.method!=='POST'||match[2]==='community')throw new LevelError(405,'Method not allowed.');
      if(!req.headers['content-type']?.startsWith('application/json'))throw new LevelError(415,'Send JSON data.');
      let raw='';for await(const part of req){raw+=part.toString();if(Buffer.byteLength(raw)>65_536)throw new LevelError(413,'Level file is too large (maximum 64 KB).');}
      let body:Record<string,unknown>;try{const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();body=value as Record<string,unknown>;}catch{throw new LevelError(400,'Invalid JSON level request.');}
      if(match[3]){if(!Number.isSafeInteger(body.revision))throw new LevelError(400,'Missing draft revision.');json(200,this.store.publish(identity.user.id,match[2],body.revision as number));return;}
      try{json(200,this.store.save(identity.user.id,identity.user.displayName,body.level,match[2],body.revision as number|undefined));}catch(error){if(error instanceof LevelError)throw error;throw new LevelError(422,error instanceof Error?error.message:'Invalid level.');}
    }catch(error){if(!res.headersSent)json(error instanceof LevelError||error instanceof AuthError?error.status:500,{error:error instanceof LevelError||error instanceof AuthError?error.message:'Could not process the level. Please retry.'});else res.end();}
  }
}
