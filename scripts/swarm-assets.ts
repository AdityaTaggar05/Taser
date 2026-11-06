import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareUpload,uploadCollection,verifyRemote,validateSwarmConfig,type SwarmConfig} from './lib/swarm-theme';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function readJSON(path:string){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
async function atomic(path:string,value:unknown){await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp-'+process.pid;await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,path);}
async function main(){
  const bundle=await prepareUpload(resolve(repo,'public/themes/modern-gray'));
  console.log(`Verified ${bundle.files.length-1} PNGs + manifest; ${(bundle.tar.length/1048576).toFixed(1)} MiB; SHA-256 ${bundle.manifestSha256}`);
  if(!process.argv.includes('--write')&&!process.argv.includes('--verify')){console.log('Check only. No network writes. Use npm run assets:upload after configuring Bee and an existing postage batch.');return;}
  // Read local settings into process memory only. They are never included in the upload archive.
  try{process.loadEnvFile(resolve(repo,'.env.local'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!process.env.SWARM_BEE_URL||!process.env.SWARM_POSTAGE_BATCH_ID)throw new Error('Set SWARM_BEE_URL and SWARM_POSTAGE_BATCH_ID in Taser/.env.local. No upload was attempted.');
  const config:SwarmConfig=validateSwarmConfig({bee:process.env.SWARM_BEE_URL,gateway:process.env.SWARM_GATEWAY_URL??'https://api.gateway.ethswarm.org',batch:process.env.SWARM_POSTAGE_BATCH_ID,token:process.env.SWARM_AUTH_TOKEN,pin:process.env.SWARM_PIN_UPLOAD==='true'});
  const journalPath=resolve(repo,'.data/swarm-assets-'+bundle.id+'.json');let journal=await readJSON(journalPath);
  if(journal&&journal.manifestSha256!==bundle.manifestSha256)throw new Error('A different pack version has an upload journal. Version the pack or archive that journal before a new upload.');
  if(!journal?.reference){
    if(process.argv.includes('--verify'))throw new Error('No Swarm reference has been recorded yet');
    if(journal?.phase==='submitting')throw new Error('A previous upload outcome is unknown. Inspect the Bee upload before removing its journal; automatic resubmission is disabled.');
    journal={phase:'submitting',manifestSha256:bundle.manifestSha256,themeId:bundle.id,version:bundle.version,startedAt:new Date().toISOString()};
    const reference=await uploadCollection(bundle,config,fetch,()=>atomic(journalPath,journal));journal={...journal,phase:'uploaded',reference};await atomic(journalPath,journal);console.log('Bee returned collection reference: '+reference);
  }
  console.log('Checking every file through the public read gateway…');
  await verifyRemote(bundle,config,journal.reference,fetch,name=>console.log('Verified '+name));
  const deployment={reference:journal.reference,gateway:config.gateway,verifiedAt:new Date().toISOString(),manifestSha256:bundle.manifestSha256};
  await atomic(resolve(repo,'src/assets/deployment.json'),deployment);
  await atomic(journalPath,{...journal,phase:'verified',verifiedAt:deployment.verifiedAt,batchId:config.batch,uploadService:new URL(config.bee).origin});
  console.log('All uploaded sprite bytes verified. Taser now resolves artwork through Swarm. Rebuild/restart the app.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Asset operation failed');process.exitCode=1;});
