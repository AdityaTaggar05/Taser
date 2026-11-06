import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive} from '../server/arkiv/archive';
import {levels} from '../server/data/campaign';
import {blankLevel} from '../src/editor/EditorModel';
import {authFixture} from './authFixture';
it('persists draft ownership, revision conflicts, verified publication and an independent last-good snapshot',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'weldpoint-levels-')),path=join(dir,'levels.sqlite');const archive=new MemoryArchive();let store=new LevelStore(path,archive);
  try{
    let entry=await store.save('atlas','Atlas',levels[0]);expect(store.community()).toEqual([]);expect(store.published(entry.id)).toBeNull();
    expect(()=>store.get('nova',entry.id)).toThrow('not found');await expect(store.save('nova','Nova',levels[1],entry.id,1)).rejects.toThrow('not found');
    entry=await store.publish('atlas',entry.id,1);expect(entry.publishedRevision).toBe(1);expect(store.community()[0].name).toBe(levels[0].name);
    const changed=structuredClone(levels[0]);changed.name='New draft';changed.solutionP1=[];entry=await store.save('atlas','Atlas',changed,entry.id,1);expect(entry.revision).toBe(2);
    await expect(store.save('atlas','Atlas',changed,entry.id,1)).rejects.toThrow('another tab');await expect(store.publish('atlas',entry.id,1)).rejects.toThrow('current draft');await expect(store.publish('atlas',entry.id,2)).rejects.toThrow('Reference solutions');
    expect(store.published(entry.id)?.level.name).toBe(levels[0].name);expect(store.community()[0].name).toBe(levels[0].name);expect(store.get('atlas',entry.id).level.name).toBe('New draft');
    store.close();store=new LevelStore(path,archive);expect(store.get('atlas',entry.id).revision).toBe(2);expect(store.published(entry.id)?.revision).toBe(1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
it('requires authenticated same-origin author requests and rejects non-winning solutions on publish',async()=>{
  const f=await authFixture();try{
    const a=f.browser(),b=f.browser();expect((await a.request('levels')).status).toBe(401);await a.login();await b.login('nova');
    const made=await a.request('levels',{level:blankLevel()});expect(made.status).toBe(200);const id=made.data.id;expect((await a.request('levels')).data.levels).toHaveLength(1);expect((await b.request('levels')).data.levels).toHaveLength(0);
    expect((await b.request('levels/'+id)).status).toBe(404);expect((await b.request(`levels/${id}/publish`,{revision:1})).status).toBe(404);expect((await a.request(`levels/${id}/publish`,{revision:1})).status).toBe(422);
    expect((await a.request('levels',{level:levels[0]},{Origin:'https://other.example'})).status).toBe(403);
    expect((await a.request('levels',{level:{...levels[0],width:1000}})).status).toBe(422);
    const saved=await a.request('levels/'+id,{level:levels[0],revision:1});expect(saved.data.revision).toBe(2);
    expect((await a.request('levels/'+id,{level:levels[0],revision:1})).status).toBe(409);expect((await a.request(`levels/${id}/publish`,{revision:2})).status).toBe(200);
    const community=await b.request('levels/community');expect(community.data.levels).toHaveLength(1);expect(community.data.levels[0]).not.toHaveProperty('level');expect(community.data.levels[0]).not.toHaveProperty('solutionP2');
    expect((await a.request('levels',{level:levels[0],padding:'x'.repeat(66_000)})).status).toBe(413);
  }finally{await f.close();}
});
