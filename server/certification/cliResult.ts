import {hash32,requestHash,type CertificationRequest} from '../../src/certification/model';

/** Parse only the final result of our successful child process, never API/user log text. */
export function parseCliResult(stdout:string,request:CertificationRequest){
  const clean=stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''),marker='Workflow Simulation Result:';
  if(clean.split(marker).length!==2)throw new Error('Missing or ambiguous CRE result.');
  const line=clean.slice(clean.indexOf(marker)+marker.length).split(/\r?\n/).map(s=>s.trim()).find(Boolean);
  let result:unknown=JSON.parse(line??'');if(typeof result==='string')result=JSON.parse(result);
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Malformed CRE result.');
  const r=result as Record<string,unknown>;
  if(Object.keys(r).sort().join(',')!=='certified,commitment,mode,steps,submissionId,valid'||r.mode!=='local-simulation'||r.certified!==false||r.submissionId!==request.id||r.commitment!==requestHash(request)||typeof r.valid!=='boolean'||!Number.isInteger(r.steps)||Number(r.steps)<0||Number(r.steps)>32||r.valid&&Number(r.steps)===0)throw new Error('CRE result does not match this frozen submission.');
  const binaries=[...clean.matchAll(/^\s*Binary hash:\s*([a-f0-9]{64})\s*$/gm)];
  if(binaries.length!==1||!hash32('0x'+binaries[0][1]))throw new Error('Missing workflow fingerprint.');
  return {valid:r.valid,steps:Number(r.steps),workflowHash:('0x'+binaries[0][1]) as `0x${string}`};
}
