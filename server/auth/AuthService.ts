import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash,randomBytes,randomUUID,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createPublicClient,getAddress,http,isAddress,verifyMessage,type Hex} from 'viem';
import {createSiweMessage} from 'viem/siwe';
import {mainnet,sepolia} from 'viem/chains';
import type {AuthState,PlayerProfile} from '../../src/auth/types';

const SESSION_MS=24*60*60*1000,CHALLENGE_MS=5*60*1000;
const DEMOS=[{username:'atlas',name:'Atlas',password:'Atlas@WeldPoint26!'},{username:'nova',name:'Nova',password:'Nova@WeldPoint26!'}];
interface Row {id:string;display_name:string;wallet_address:string|null;ens_name:string|null;kind:'wallet'|'demo'}
export interface SessionIdentity {key:string;user:PlayerProfile}
interface Challenge {message:string;address:Hex;chainId:number;origin:string;context:string;expires:number}
interface Ticket {key:string;expires:number}
interface AuthOptions {databasePath?:string;demoEnabled?:boolean;now?:()=>number}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(32).toString('hex');
function cookie(req:IncomingMessage,name:string){for(const item of (req.headers.cookie??'').split(';')){const at=item.indexOf('=');if(item.slice(0,at).trim()===name)return item.slice(at+1).trim();}return '';}
export class AuthError extends Error{constructor(readonly status:number,message:string){super(message);}}
export class AuthService {
  readonly demoEnabled:boolean;
  readonly databasePath:string;
  private db:DatabaseSync;
  private now:()=>number;
  private challenges=new Map<string,Challenge>();
  private tickets=new Map<string,Ticket>();
  private limits=new Map<string,{count:number;until:number}>();
  private revoked=new Set<(key:string)=>void>();
  constructor(options:AuthOptions={}){
    const path=options.databasePath??process.env.AUTH_DB_PATH??resolve('.data/accounts.sqlite');
    this.databasePath=path;
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);this.now=options.now??Date.now;this.demoEnabled=options.demoEnabled??false;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,display_name TEXT NOT NULL,wallet_address TEXT UNIQUE,ens_name TEXT,kind TEXT NOT NULL,username TEXT UNIQUE,password_hash TEXT,salt TEXT);
      CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),context TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS completions(account_id TEXT NOT NULL REFERENCES accounts(id),level_id INTEGER NOT NULL,PRIMARY KEY(account_id,level_id));`);
    if(this.demoEnabled)for(const demo of DEMOS){
      if(!this.db.prepare('SELECT id FROM accounts WHERE username=?').get(demo.username)){
        const salt=randomBytes(16).toString('hex'),hash=scryptSync(demo.password,salt,64).toString('hex');
        this.db.prepare('INSERT INTO accounts(id,display_name,kind,username,password_hash,salt) VALUES(?,?,?,?,?,?)').run(randomUUID(),demo.name,'demo',demo.username,hash,salt);
      }
    }
  }
  authorize(req:IncomingMessage,context:string,write=false):SessionIdentity {
    const origin=this.origin(req);if(write&&req.headers.origin!==origin)throw new AuthError(403,'Requests must come from this site.');
    const identity=this.session(req,context);if(!identity)throw new AuthError(401,'Sign in to use the level creator.');return identity;
  }
  profile(id:string):PlayerProfile|null {
    const row=this.db.prepare('SELECT id,display_name,wallet_address,ens_name,kind,username FROM accounts WHERE id=?').get(id) as unknown as (Row&{username:string|null})|undefined;
    if(!row)return null;
    const completed=this.db.prepare('SELECT level_id FROM completions WHERE account_id=? ORDER BY level_id').all(id).map(r=>Number(r.level_id));
    return {id:row.id,displayName:row.display_name,walletAddress:row.wallet_address,ensName:row.ens_name,kind:row.kind,completed,campaignPublisher:this.demoEnabled&&row.kind==='demo'&&row.username==='atlas'};
  }
  recordCompletion(ids:string[],levelId:number){for(const id of ids)this.db.prepare('INSERT OR IGNORE INTO completions(account_id,level_id) VALUES(?,?)').run(id,levelId);}
  onRevoke(fn:(key:string)=>void){this.revoked.add(fn);return ()=>this.revoked.delete(fn);}
  isActive(key:string){return !!this.db.prepare("SELECT s.key FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.key=? AND s.expires>? AND (a.kind!='demo' OR ?=1)").get(key,this.now(),this.demoEnabled?1:0);}
  private revoke(key:string){this.db.prepare('DELETE FROM sessions WHERE key=?').run(key);this.revoked.forEach(fn=>fn(key));}
  private session(req:IncomingMessage,context:string):SessionIdentity|null {
    const value=cookie(req,'weldpoint_session');if(!value)return null;
    const key=digest(value),row=this.db.prepare('SELECT account_id,expires FROM sessions WHERE key=? AND context=?').get(key,context);
    if(!row)return null;
    if(Number(row.expires)<=this.now()){this.revoke(key);return null;}
    const user=this.profile(String(row.account_id));if(user?.kind==='demo'&&!this.demoEnabled){this.revoke(key);return null;}return user?{key,user}:null;
  }
  private setCookie(res:ServerResponse,name:string,value:string,context:string,origin:string,maxAge:number){
    const valueHeader=`${name}=${value}; Path=/api/auth/${context}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith('https:')?'; Secure':''}`;
    const existing=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:existing?[String(existing)]:[]),valueHeader]);
  }
  private startSession(req:IncomingMessage,res:ServerResponse,context:string,origin:string,id:string){
    const old=this.session(req,context);if(old)this.revoke(old.key);
    const value=random();this.db.prepare('INSERT INTO sessions(key,account_id,context,expires) VALUES(?,?,?,?)').run(digest(value),id,context,this.now()+SESSION_MS);
    this.setCookie(res,'weldpoint_session',value,context,origin,SESSION_MS/1000);
    return this.profile(id)!;
  }
  private origin(req:IncomingMessage){
    const configured=process.env.APP_ORIGIN;
    if(configured){const url=new URL(configured);if(url.host!==req.headers.host)throw new AuthError(403,'Unexpected application host.');return url.origin;}
    const host=req.headers.host;if(!host||/[\s\\]/.test(host))throw new AuthError(400,'Invalid application host.');
    // Browser Origin must match Host; HTTPS origins retain Secure cookies behind a proxy.
    const raw=req.headers.origin;
    if(raw){const url=new URL(raw);if(url.host!==host||!['http:','https:'].includes(url.protocol))throw new AuthError(403,'Request origin does not match this site.');return url.origin;}
    return `http://${host}`;
  }
  private rate(key:string){const now=this.now(),row=this.limits.get(key);if(!row||row.until<=now){this.limits.set(key,{count:1,until:now+60_000});return;}if(++row.count>12)throw new AuthError(429,'Too many sign-in attempts. Try again in a minute.');}
  private async body(req:IncomingMessage):Promise<Record<string,unknown>>{
    if(!req.headers['content-type']?.startsWith('application/json'))throw new AuthError(415,'Send JSON data.');
    let raw='';for await(const part of req){raw+=part.toString();if(Buffer.byteLength(raw)>8192)throw new AuthError(413,'Request too large.');}
    let value:unknown;try{value=JSON.parse(raw||'{}');}catch{throw new AuthError(400,'Invalid JSON.');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new AuthError(400,'Invalid request.');return value as Record<string,unknown>;
  }
  private json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
  async handle(req:IncomingMessage,res:ServerResponse):Promise<void>{
    try{
      const path=new URL(req.url??'/','http://local').pathname,match=/^\/api\/auth\/([a-f0-9]{32})\/(session|demo|challenge|wallet|logout|socket-ticket)$/.exec(path);
      if(!match){this.json(res,404,{error:'Unknown authentication endpoint.'});return;}
      const [,context,action]=match,origin=this.origin(req);
      if(req.method==='GET'&&action==='session'){
        const identity=this.session(req,context);const state:AuthState={user:identity?.user??null,demoEnabled:this.demoEnabled};this.json(res,200,state);return;
      }
      if(req.method!=='POST')throw new AuthError(405,'Method not allowed.');
      if(req.headers.origin!==origin)throw new AuthError(403,'Sign-in requests must come from this site.');
      const body=await this.body(req);
      if(action==='logout'){
        const identity=this.session(req,context);if(identity)this.revoke(identity.key);
        this.setCookie(res,'weldpoint_session','',context,origin,0);this.setCookie(res,'weldpoint_challenge','',context,origin,0);
        this.json(res,200,{ok:true});return;
      }
      if(action==='socket-ticket'){
        const identity=this.session(req,context);if(!identity)throw new AuthError(401,'Sign in to join a game.');
        const ticket=random();this.tickets.set(digest(ticket),{key:identity.key,expires:this.now()+30_000});this.json(res,200,{ticket});return;
      }
      this.rate(`${req.socket.remoteAddress??'local'}:${action}`);
      if(action==='demo'){
        if(!this.demoEnabled)throw new AuthError(404,'Demo accounts are disabled.');
        const username=typeof body.username==='string'?body.username.trim().toLowerCase():'',password=typeof body.password==='string'?body.password:'';
        if(username.length>50||password.length>200)throw new AuthError(400,'Invalid credentials.');
        const row=this.db.prepare('SELECT id,password_hash,salt FROM accounts WHERE username=? AND kind=?').get(username,'demo');
        const hash=scryptSync(password,String(row?.salt??'dummy-salt'),64),expected=row?Buffer.from(String(row.password_hash),'hex'):Buffer.alloc(64);
        if(!row||!timingSafeEqual(hash,expected))throw new AuthError(401,'Incorrect demo username or password.');
        this.json(res,200,{user:this.startSession(req,res,context,origin,String(row.id)),demoEnabled:this.demoEnabled});return;
      }
      if(action==='challenge'){
        if(typeof body.address!=='string'||!isAddress(body.address)||!Number.isSafeInteger(body.chainId)||(body.chainId as number)<=0)throw new AuthError(400,'Connect a valid Ethereum wallet.');
        const address=getAddress(body.address),chainId=body.chainId as number,expires=this.now()+CHALLENGE_MS;
        const message=createSiweMessage({address,chainId,domain:new URL(origin).host,scheme:new URL(origin).protocol.slice(0,-1),uri:origin,version:'1',nonce:randomBytes(16).toString('hex'),issuedAt:new Date(this.now()),expirationTime:new Date(expires),statement:'Sign in to WeldPoint. This does not request a transaction or access to your funds.'});
        const old=cookie(req,'weldpoint_challenge');if(old)this.challenges.delete(digest(old));
        const value=random();this.challenges.set(digest(value),{message,address,chainId,origin,context,expires});
        this.setCookie(res,'weldpoint_challenge',value,context,origin,CHALLENGE_MS/1000);this.json(res,200,{message});return;
      }
      if(action==='wallet'){
        const key=digest(cookie(req,'weldpoint_challenge')),challenge=this.challenges.get(key);
        this.challenges.delete(key);this.setCookie(res,'weldpoint_challenge','',context,origin,0);
        if(!challenge||challenge.expires<=this.now()||challenge.context!==context||challenge.origin!==origin)throw new AuthError(401,'Sign-in request expired. Please try again.');
        if(typeof body.signature!=='string'||!/^0x[a-fA-F0-9]+$/.test(body.signature))throw new AuthError(400,'Invalid wallet signature.');
        let valid=false;try{valid=await verifyMessage({address:challenge.address,message:challenge.message,signature:body.signature as Hex});}catch{/* A contract signature can be checked through its configured chain RPC. */}
        const rpc=challenge.chainId===1?process.env.ETHEREUM_RPC_URL:challenge.chainId===11155111?process.env.SEPOLIA_RPC_URL:undefined;
        if(!valid&&rpc){try{valid=await createPublicClient({chain:challenge.chainId===1?mainnet:sepolia,transport:http(rpc,{timeout:5000,retryCount:0})}).verifySiweMessage({message:challenge.message,signature:body.signature as Hex,domain:new URL(origin).host,time:new Date(this.now())});}catch{/* Do not expose RPC URLs in errors. */}}
        if(challenge.expires<=this.now())throw new AuthError(401,'Sign-in request expired. Please try again.');
        if(!valid)throw new AuthError(401,'Wallet signature could not be verified. Contract wallets need a configured RPC for their network.');
        const wallet=challenge.address.toLowerCase();let row=this.db.prepare('SELECT id FROM accounts WHERE wallet_address=?').get(wallet);
        if(!row){const id=randomUUID();this.db.prepare('INSERT INTO accounts(id,display_name,wallet_address,kind) VALUES(?,?,?,?)').run(id,`${challenge.address.slice(0,6)}…${challenge.address.slice(-4)}`,wallet,'wallet');row={id};}
        this.json(res,200,{user:this.startSession(req,res,context,origin,String(row.id)),demoEnabled:this.demoEnabled});return;
      }
      throw new AuthError(404,'Unknown authentication endpoint.');
    }catch(error){if(!res.headersSent)this.json(res,error instanceof AuthError?error.status:500,{error:error instanceof AuthError?error.message:'Sign-in could not be completed. Please try again.'});else res.end();}
  }
  consumeTicket(raw:unknown):SessionIdentity|null {
    if(typeof raw!=='string'||raw.length!==64)return null;
    const hash=digest(raw),ticket=this.tickets.get(hash);this.tickets.delete(hash);
    if(!ticket||ticket.expires<=this.now()||!this.isActive(ticket.key))return null;
    const row=this.db.prepare('SELECT account_id FROM sessions WHERE key=?').get(ticket.key),user=row?this.profile(String(row.account_id)):null;
    return user?{key:ticket.key,user}:null;
  }
  sweep(){
    const now=this.now();for(const [key,c] of this.challenges)if(c.expires<=now)this.challenges.delete(key);
    for(const [key,t] of this.tickets)if(t.expires<=now)this.tickets.delete(key);
    for(const [key,r] of this.limits)if(r.until<=now)this.limits.delete(key);
    for(const row of this.db.prepare('SELECT key FROM sessions WHERE expires<=?').all(now))this.revoke(String(row.key));
  }
  close(){this.db.close();}
}
