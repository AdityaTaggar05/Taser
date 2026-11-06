import type {IncomingMessage,ServerResponse} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {LevelError,type LevelStore} from '../levels/LevelStore';
/** A separate operator credential, never a browser session or Arkiv access key. */
export class CertificationApi {
  private count=0;private until=0;
  constructor(private store:Pick<LevelStore,'pendingCertifications'|'verificationRequest'|'verificationInput'>){}
  async handle(req:IncomingMessage,res:ServerResponse){
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    const token=process.env.CRE_API_TOKEN??'',provided=req.headers.authorization??'',expected='Bearer '+token;
    if(token.length<32||Buffer.byteLength(provided)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected))){send(401,{error:'Verifier authentication required.'});return;}
    if(req.headers.origin){send(403,{error:'This endpoint is for the verifier only.'});return;}
    if(req.method!=='GET'){send(405,{error:'Read-only verifier endpoint.'});return;}
    if(Date.now()>this.until){this.until=Date.now()+60_000;this.count=0;}if(++this.count>240){send(429,{error:'Verifier request limit reached.'});return;}
    const path=new URL(req.url??'/','http://local').pathname;
    try{
      if(path==='/api/cre/submissions'){send(200,{submissions:this.store.pendingCertifications()});return;}
      const metadata=/^\/api\/cre\/submissions\/(0x[a-f0-9]{64})\/request$/.exec(path);if(metadata){send(200,this.store.verificationRequest(metadata[1]));return;}
      const match=/^\/api\/cre\/submissions\/(0x[a-f0-9]{64})$/.exec(path);if(!match){send(404,{error:'Unknown verification submission.'});return;}
      const value=await this.store.verificationInput(match[1]);if(Buffer.byteLength(JSON.stringify(value))>96_000)throw new LevelError(413,'Verification input exceeds the workflow budget.');send(200,value);
    }catch(error){send(error instanceof LevelError?error.status:503,{error:error instanceof LevelError?error.message:'Verification input is unavailable. Retry later.'});}
  }
}
