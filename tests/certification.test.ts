import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive} from '../server/arkiv/archive';
import {LevelCipher} from '../server/arkiv/LevelCipher';
import {generateKey} from 'arkiv-encryption';
import type {CertificationRegistry} from '../server/certification/Registry';
import {requestHash,checkInput,type CertificationProof,type CertificationRequest} from '../src/certification/model';
import {assessSubmission} from '../cre/workflow/verify';
import {levels} from '../server/data/campaign';
import {authFixture} from './authFixture';
class Registry implements CertificationRegistry {
  readonly mode='simulation';valid:boolean|undefined;unavailable=false;wrong=false;
  async read(request:CertificationRequest):Promise<CertificationProof|null>{if(this.unavailable)throw new Error('private RPC credential');if(this.valid===undefined)return null;return {request:this.wrong?{...request,levelId:crypto.randomUUID()}:request,mode:'simulation',chainId:11155111,registry:'0x1111111111111111111111111111111111111111',blockNumber:'100',valid:this.valid,steps:8};}
}
it('freezes pending input, hides it from discovery, denies edits before writes and keeps retries on one identity',async()=>{
  const archive=new MemoryArchive(),store=new LevelStore(':memory:',archive);
  try{
    const draft=await store.save('alice','Alice',levels[0]),before=archive.entries.size;
    const submitted=await store.publish('alice',draft.id,1);expect(submitted.readonly).toBe(true);expect(submitted.certification?.status).toBe('pending');expect(submitted.certification?.mode).toBe('unconfigured');expect(store.community()).toEqual([]);expect(store.forPlay(draft.id)).toBeNull();
    const id=submitted.certification!.id;expect((await store.publish('alice',draft.id,1)).certification?.id).toBe(id);
    await expect(store.save('alice','Alice',{...levels[0],name:'Changed'},draft.id,1)).rejects.toThrow('locked');await expect(store.save('alice','Alice',levels[0],undefined,undefined,draft.id)).rejects.toThrow('locked');
    await expect(store.publish('alice',draft.id,1,'campaign')).rejects.toThrow('frozen');expect(archive.entries.size).toBe(before);
    expect(JSON.stringify(submitted.certification)).not.toMatch(/solutionP|salt|ciphertext/);const input=await store.verificationInput(id);checkInput(input);
    const verdict=assessSubmission(input,requestHash(input.request),id);expect(verdict.valid).toBe(true);expect(verdict.steps).toBe(8);
  }finally{store.close();}
});
it('accepts only a matching certificate, persists encrypted proof and makes the approved publication permanent',async()=>{
  const archive=new MemoryArchive(),registry=new Registry(),store=new LevelStore(':memory:',archive,registry);
  try{
    const draft=await store.save('alice','Alice',levels[0]),submitted=await store.publish('alice',draft.id,1),id=submitted.certification!.id;
    registry.valid=true;registry.wrong=true;await store.flushCertifications();expect(store.community()).toEqual([]);expect(store.get('alice',draft.id).certification?.status).toBe('pending');
    registry.wrong=false;await store.flushCertifications();const published=store.get('alice',draft.id);expect(published.certification?.status).toBe('published');expect(store.community()[0].verification).toBe('simulation');
    await expect(store.save('alice','Alice',levels[0],draft.id,1)).rejects.toThrow('locked');await expect(store.verificationInput(id)).rejects.toThrow('unavailable');
    const record=[...archive.entries.values()].find(e=>e.record.category==='community')!.record,cipher=new LevelCipher(generateKey(),'test'),encrypted=await cipher.encrypt(record);
    expect(new TextDecoder().decode(encrypted)).not.toContain('solutionP1');const decoded=await cipher.decrypt(encrypted,{id:record.id,revision:record.revision,category:'community'});expect(decoded.certification).toEqual(record.certification);
    const tampered=structuredClone(record);tampered.level.name='Changed';await expect(cipher.decrypt(await cipher.encrypt(tampered),{id:record.id,revision:record.revision,category:'community'})).rejects.toThrow('authentication');
  }finally{store.close();}
});
it('rotates bounded maintenance batches past pending submissions',async()=>{
  const archive=new MemoryArchive(),registry=new Registry(),store=new LevelStore(':memory:',archive,registry);
  try{
    const ids:string[]=[];for(let i=0;i<3;i++){const draft=await store.save('alice','Alice',levels[0]);await store.publish('alice',draft.id,1);ids.push(draft.id);}
    await store.flushCertifications();registry.valid=true;await store.flushCertifications();
    expect(store.get('alice',ids[2]).certification?.status).toBe('published');expect(store.community()).toHaveLength(1);
    await store.flushCertifications();expect(store.community()).toHaveLength(3);
  }finally{store.close();}
});
it('reopens rejected drafts but gives a corrected submission a new request and private salt',async()=>{
  const archive=new MemoryArchive(),registry=new Registry(),store=new LevelStore(':memory:',archive,registry);
  try{
    const draft=await store.save('alice','Alice',levels[0]),first=await store.publish('alice',draft.id,1),old=await store.verificationInput(first.certification!.id);
    registry.valid=false;await store.flushCertifications();expect(store.get('alice',draft.id).readonly).toBe(false);expect(store.get('alice',draft.id).certification?.status).toBe('rejected');
    const corrected=await store.save('alice','Alice',{...levels[0],name:'Corrected'},draft.id,1);registry.valid=undefined;
    const second=await store.publish('alice',draft.id,corrected.revision),input=await store.verificationInput(second.certification!.id);
    expect(second.certification!.id).not.toBe(first.certification!.id);expect(input.salt).not.toBe(old.salt);expect(store.pendingCertifications()).toHaveLength(1);expect(store.community()).toEqual([]);
  }finally{store.close();}
});
it('recovers a confirmed archive write after losing its reply without creating another publication',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'taser-cre-')),path=join(directory,'db.sqlite'),archive=new MemoryArchive(),registry=new Registry();let store=new LevelStore(path,archive,registry);
  try{
    const draft=await store.save('alice','Alice',levels[0]);await store.publish('alice',draft.id,1);registry.valid=true;
    const original=archive.put.bind(archive);let sends=0;archive.put=async record=>{if(record.category==='community'){sends++;await original(record);throw new Error('Lost receipt');}return original(record);};
    await store.flushCertifications();expect(store.get('alice',draft.id).certification?.status).toBe('approved');expect(store.community()).toEqual([]);expect(store.get('alice',draft.id).readonly).toBe(true);
    store.close();store=new LevelStore(path,archive,registry);await store.hydrate();await store.flushCertifications();expect(store.community()).toHaveLength(1);expect(store.get('alice',draft.id).certification?.status).toBe('published');expect(sends).toBe(1);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
it('verifies the exact archived payload and independently rejects invalid witnesses without browser clone globals',async()=>{
  const archive=new MemoryArchive(),store=new LevelStore(':memory:',archive);
  try{
    const draft=await store.save('alice','Alice',levels[0]),submitted=await store.publish('alice',draft.id,1),input=await store.verificationInput(submitted.certification!.id);
    const wrong=structuredClone(input);wrong.level.name='Tampered';expect(()=>assessSubmission(wrong,requestHash(input.request),input.request.id)).toThrow('commitment');
    const {levelHash,witnessCommitment}=await import('../src/certification/model');const invalid=structuredClone(input);invalid.level.solutionP1[0]='R';invalid.request.levelHash=levelHash(invalid.level);invalid.request.witnessCommitment=witnessCommitment(invalid.level,invalid.salt);
    expect(assessSubmission(invalid,requestHash(invalid.request),invalid.request.id).valid).toBe(false);
    vi.stubGlobal('structuredClone',undefined);try{expect(assessSubmission(input,requestHash(input.request),input.request.id).valid).toBe(true);}finally{vi.unstubAllGlobals();}
    const entry=[...archive.entries.values()].find(e=>e.ref.entityKey===input.request.draftKey)!;entry.record.level.name='Different archived draft';await expect(store.verificationInput(input.request.id)).rejects.toThrow('differs');
  }finally{store.close();}
});
it('keeps verifier endpoints separate from sessions and exposes no witness through operator metadata',async()=>{
  vi.stubEnv('CRE_API_TOKEN','a'.repeat(64));const f=await authFixture({registry:new Registry()});
  try{
    const alice=f.browser(),bob=f.browser();await alice.login();await bob.login('nova');const draft=(await alice.request('levels',{level:levels[0]})).data,submission=(await alice.request(`levels/${draft.id}/publish`,{revision:1})).data.certification;
    const url=f.origin+'/api/cre/submissions/'+submission.id,headers={Authorization:'Bearer '+'a'.repeat(64)};
    expect((await fetch(url)).status).toBe(401);expect((await fetch(url,{headers:{Authorization:'Bearer '+'é'.repeat(64)}})).status).toBe(401);
    expect((await fetch(url,{headers:{...headers,Origin:f.origin}})).status).toBe(403);
    const metadata=await (await fetch(url+'/request',{headers})).json();expect(metadata.id).toBe(submission.id);expect(JSON.stringify(metadata)).not.toMatch(/solutionP|salt/);
    expect((await (await fetch(url,{headers})).json()).level.solutionP1).toEqual(levels[0].solutionP1);
    expect((await bob.request(`levels/${draft.id}/certification`,{})).status).toBe(404);expect((await bob.request('levels/'+draft.id)).status).toBe(404);
    expect((await alice.request(`levels/${draft.id}`,{level:levels[0],revision:1})).status).toBe(409);expect((await alice.request('levels/community')).data.levels).toEqual([]);
  }finally{await f.close();vi.unstubAllEnvs();}
});
