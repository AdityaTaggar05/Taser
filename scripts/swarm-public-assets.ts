import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareUpload,makeTar,digest,uploadCollection,verifyRemote,validateSwarmConfig,type UploadBundle,type UploadFile} from './lib/swarm-theme';
import {validateRelease,type ThemeRelease} from '../src/assets/schema';
import {splitPublicBundle} from './lib/public-theme';
import {themeSourceFromArgs} from './lib/theme-source';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function atomic(path:string,value:unknown){await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp-'+process.pid;await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,path);}
async function main(){
  const source=themeSourceFromArgs(),bundle=await prepareUpload(resolve(repo,'public/themes',source.id));
  const parts=splitPublicBundle(bundle),manifestFile=bundle.files.find(f=>f.name==='manifest.json')!,theme=JSON.parse(manifestFile.data.toString());
  console.log(`Public gateway plan: ${parts.length} bounded collections; ${bundle.files.length-1} original PNGs; no source or credentials.`);
  if(!process.argv.includes('--write')&&!process.argv.includes('--verify')){console.log('Check only. Use --write to publish or --verify to resume readback.');return;}
  try{process.loadEnvFile(resolve(repo,'.env.local'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const journalPath=resolve(repo,`.data/swarm-public-${bundle.id}-${bundle.version}.json`);
  type Entry={phase:'submitting'|'uploaded'|'verified'|'rejected';digest:string;reference?:string};
  type Journal={manifestSha256:string;uploadService:string;parts:Record<string,Entry>;startedAt:string;verifiedAt?:string;releaseReference?:string};
  let saved:Journal|undefined;
  try{saved=JSON.parse(await readFile(journalPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  // Reuse a legacy journal only for its exact frozen manifest; never erase older releases.
  if(!saved){try{const legacy=JSON.parse(await readFile(resolve(repo,`.data/swarm-public-${bundle.id}.json`),'utf8'));if(legacy.manifestSha256===bundle.manifestSha256)saved=legacy;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  const config=validateSwarmConfig({mode:'public' as const,bee:process.env.SWARM_PUBLIC_GATEWAY_URL??saved?.uploadService??'https://bzz.limo',gateway:process.env.SWARM_GATEWAY_URL??'https://bzz.limo'});
  const journal:Journal=saved??{manifestSha256:bundle.manifestSha256,uploadService:config.bee,parts:{},startedAt:new Date().toISOString()};
  if(journal.manifestSha256!==bundle.manifestSha256||journal.uploadService!==config.bee)throw new Error('Upload journal belongs to another pack or service. Reconcile before publishing another version.');
  async function publish(key:string,part:UploadBundle){
    let entry=journal.parts[key];const hash=digest(part.tar);
    if(entry&&entry.digest!==hash)throw new Error('Frozen upload part changed: '+key);
    if(!entry?.reference){
      if(process.argv.includes('--verify'))throw new Error('No uploaded reference for '+key);
      if(entry?.phase==='submitting')throw new Error('Unknown previous upload outcome for '+key+'. Reconcile before resubmitting.');
      entry={phase:'submitting',digest:hash};journal.parts[key]=entry;
      console.log(`Uploading ${key} (${(part.tar.length/1048576).toFixed(2)} MiB)…`);
      try{entry.reference=await uploadCollection(part,config,fetch,()=>atomic(journalPath,journal));}
      catch(error){if((error as {rejected?:boolean}).rejected){entry.phase='rejected';await atomic(journalPath,journal);}throw error;}
      entry.phase='uploaded';await atomic(journalPath,journal);console.log(`${key}: ${entry.reference}`);
    }
    await verifyRemote(part,config,entry.reference!,fetch,name=>console.log('Verified '+key+'/'+name));
    entry.phase='verified';await atomic(journalPath,journal);return entry.reference!;
  }
  const refs:string[]=[];
  for(let i=0;i<parts.length;i++){
    refs.push(await publish(i===0?'manifest':'sheets-'+i,parts[i]));
    if(i===0&&process.argv.includes('--manifest-only')){console.log('Public manifest upload and exact readback succeeded. PNG parts remain pending.');return;}
  }
  const sheets:ThemeRelease['sheets']={};
  for(const [id,s] of Object.entries(theme.sheets) as Array<[string,{file:string}]>){const i=parts.findIndex((p,index)=>index>0&&p.files.some(f=>f.name===s.file));if(i<0)throw new Error('Unmapped sheet');sheets[id]={reference:refs[i],path:s.file};}
  const release:ThemeRelease=validateRelease({schemaVersion:1,kind:'taser-theme-release',id:bundle.id,version:bundle.version,manifest:{reference:refs[0],sha256:bundle.manifestSha256,bytes:manifestFile.data.length},sheets},theme);
  const data=Buffer.from(JSON.stringify(release,null,2)+'\n'),file:UploadFile={name:'release.json',data,sha256:digest(data)};
  const root:UploadBundle={id:bundle.id,version:bundle.version,files:[file],tar:makeTar([file]),manifestSha256:bundle.manifestSha256};
  const reference=await publish('release',root),verifiedAt=new Date().toISOString();
  const deployment={reference,gateway:config.gateway,verifiedAt,manifestSha256:bundle.manifestSha256,releaseSha256:file.sha256,sheetReferences:Object.fromEntries(Object.entries(sheets).map(([id,s])=>[id,s.reference]))};
  const previous=JSON.parse(await readFile(resolve(repo,source.deploymentFile),'utf8'));
  const proof=previous.reference===reference&&previous.releaseSha256===file.sha256&&previous.manifestSha256===bundle.manifestSha256?previous.arkiv:undefined;
  await atomic(resolve(repo,source.deploymentFile),{...deployment,...(proof?{arkiv:proof}:{})});
  let evidence:Record<string,unknown>={};try{evidence=JSON.parse(await readFile(resolve(repo,source.evidenceFile),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await atomic(resolve(repo,source.evidenceFile),{...deployment,...(proof?{arkiv:proof}:{}),manifestReference:refs[0],uploadService:config.bee,postageSupplier:evidence.postageSupplier??'Swarm Foundation public gateway',postageBatchId:evidence.postageBatchId??null,retention:evidence.retention??'Not yet confirmed by operator',files:bundle.files.map(f=>({path:f.name,sha256:f.sha256,bytes:f.data.length}))});
  journal.verifiedAt=verifiedAt;journal.releaseReference=reference;await atomic(journalPath,journal);
  console.log('Every original PNG, manifest and release index verified through public reads. Deployment now uses Swarm.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Public upload failed');process.exitCode=1;});
