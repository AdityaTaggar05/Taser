import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {validateTheme,validateDeployment} from '../../src/assets/schema';
export interface UploadFile{name:string;data:Buffer;sha256:string}
export interface UploadBundle{files:UploadFile[];tar:Buffer;manifestSha256:string;id:string;version:string}
export const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
/** Only the reviewed manifest and its exact PNG allowlist can cross this boundary. */
export async function prepareUpload(directory:string):Promise<UploadBundle>{
  const root=await realpath(directory),raw=await readFile(resolve(root,'manifest.json')),m=validateTheme(JSON.parse(raw.toString()));
  const files:UploadFile[]=[{name:'manifest.json',data:raw,sha256:digest(raw)}];
  for(const s of Object.values(m.sheets)){
    const path=await realpath(resolve(root,s.file));if(!path.startsWith(root+sep))throw new Error('Theme file escapes its directory');
    const data=await readFile(path);
    if(data.length!==s.bytes||digest(data)!==s.sha256||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.readUInt32BE(16)!==s.width||data.readUInt32BE(20)!==s.height)throw new Error('Theme file integrity mismatch: '+s.file);
    files.push({name:s.file,data,sha256:s.sha256});
  }
  return {id:m.id,version:m.version,files,tar:makeTar(files),manifestSha256:digest(raw)};
}
export function makeTar(files:UploadFile[]):Buffer{
  const out:Buffer[]=[];
  for(const f of [...files].sort((a,b)=>a.name.localeCompare(b.name))){
    if(!/^(manifest\.json|release\.json|sheets\/[a-z0-9_-]+\.png)$/.test(f.name)||Buffer.byteLength(f.name)>100)throw new Error('Disallowed upload file');
    const h=Buffer.alloc(512);h.write(f.name,0,100);const oct=(n:number,at:number,len:number)=>h.write(n.toString(8).padStart(len-1,'0')+'\0',at,len);
    oct(0o644,100,8);oct(0,108,8);oct(0,116,8);oct(f.data.length,124,12);oct(0,136,12);h.fill(32,148,156);h.write('0',156);h.write('ustar\0',257);h.write('00',263);
    const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8);
    out.push(h,f.data,Buffer.alloc((512-f.data.length%512)%512));
  }
  out.push(Buffer.alloc(1024));return Buffer.concat(out);
}
export interface SwarmConfig{bee:string;gateway:string;mode?:'public'|'node';batch?:string;token?:string;pin?:boolean}
export function validateSwarmConfig(c:SwarmConfig){
  validateDeployment({reference:null,gateway:c.gateway,verifiedAt:null,manifestSha256:null});
  validateDeployment({reference:null,gateway:c.bee,verifiedAt:null,manifestSha256:null});
  if(c.mode==='public'){
    if(c.token||c.batch||c.pin)throw new Error('Public gateway mode uses operator-supplied postage; no private token, batch or pin option');
  }else if(!/^[a-fA-F0-9]{64}$/.test(c.batch??''))throw new Error('Set SWARM_POSTAGE_BATCH_ID to a usable 64-hex postage batch');
  return c;
}
const endpoint=(base:string,path:string)=>base.replace(/\/$/,'')+'/'+path;
async function limitedBytes(response:Response,max:number){
  if(!response.ok)throw new Error('Swarm read failed: HTTP '+response.status);
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty Swarm response');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('Swarm response exceeds expected file size');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export async function verifyRemote(bundle:UploadBundle,c:SwarmConfig,reference:string,fetcher:typeof fetch=fetch,progress:(name:string)=>void=()=>{}){
  if(!/^[a-f0-9]{64}$/.test(reference))throw new Error('Invalid Swarm reference');
  for(const file of bundle.files){
    // Public readback intentionally has no upload credential attached.
    const r=await fetcher(endpoint(c.gateway,`bzz/${reference}/${file.name}`),{signal:AbortSignal.timeout(90_000)});
    const data=await limitedBytes(r,file.data.length);
    if(data.length!==file.data.length||digest(data)!==file.sha256)throw new Error('Swarm readback integrity mismatch: '+file.name);
    progress(file.name);
  }
}
export async function uploadCollection(bundle:UploadBundle,c:SwarmConfig,fetcher:typeof fetch=fetch,admit:()=>Promise<void>=async()=>{}):Promise<string>{
  validateSwarmConfig(c);const auth:Record<string,string>=c.token?{Authorization:'Bearer '+c.token}:{};
  if(c.mode!=='public'){
    const stamp=await fetcher(endpoint(c.bee,'stamps/'+c.batch),{headers:auth,signal:AbortSignal.timeout(15_000)});
    if(!stamp.ok)throw new Error('Cannot verify the Bee postage batch (HTTP '+stamp.status+'). Check endpoint, access and batch ID.');
    const state=await stamp.json() as {usable?:boolean};if(state.usable!==true)throw new Error('Bee postage batch is not usable yet');
  }
  if(c.mode==='public'&&bundle.tar.length>8_000_000)throw new Error('Public gateway collection exceeds the 8 MB upload boundary');
  await admit();
  const response=await fetcher(endpoint(c.bee,'bzz'),{method:'POST',redirect:'error',headers:{...auth,'Content-Type':'application/x-tar','Swarm-Collection':'true','Swarm-Index-Document':bundle.files.some(f=>f.name==='release.json')?'release.json':'manifest.json',...(c.mode==='public'?{}:{'Swarm-Postage-Batch-Id':c.batch!}),'Swarm-Deferred-Upload':'false',...(c.pin?{'Swarm-Pin':'true'}:{})},body:bundle.tar as unknown as BodyInit,signal:AbortSignal.timeout(180_000)});
  if(!response.ok){const error=new Error('Swarm upload rejected: HTTP '+response.status) as Error&{rejected:boolean};error.rejected=response.status>=400&&response.status<500;throw error;}
  const result=await response.json() as {reference?:string};if(!result.reference||!/^[a-f0-9]{64}$/.test(result.reference))throw new Error('Bee did not return an unencrypted collection reference');
  return result.reference;
}
