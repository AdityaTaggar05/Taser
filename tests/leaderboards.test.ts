import {it,expect} from 'vitest';
import {LevelStore} from '../server/levels/LevelStore';
import {MemoryArchive} from '../server/arkiv/archive';
import {levels} from '../server/data/campaign';
import {authFixture} from './authFixture';
import {rankingPage} from '../server/levels/ranking';

it('counts distinct co-op chambers across revisions and merges legacy campaign progress',async()=>{
  const f=await authFixture();try{
    const a=f.browser(),b=f.browser();const atlas=(await a.login()).data.user,nova=(await b.login('nova')).data.user;
    const campaign=f.levels.campaignSnapshots()[0];f.auth.recordCompletion([atlas.id],campaign.slot!);
    f.levels.recordWin([atlas.id],campaign.ref!.entityKey);
    const draft=await f.levels.save(atlas.id,'Atlas',levels[0]);await f.levels.publish(atlas.id,draft.id,1);
    f.levels.recordWin([atlas.id,nova.id],f.levels.published(draft.id)!.ref!.entityKey);
    const revised=await f.levels.save(atlas.id,'Atlas',{...levels[0],name:'Revision 2'},draft.id,1);await f.levels.publish(atlas.id,draft.id,revised.revision);
    f.levels.recordWin([atlas.id],f.levels.published(draft.id)!.ref!.entityKey);
    const board=f.auth.globalLeaderboard(f.levels.completions(),nova.id);
    expect(board.entries.map(r=>[r.name,r.completed,r.isYou])).toEqual([['Atlas',2,false],['Nova',1,true]]);
    expect(board.me?.rank).toBe(2);expect(JSON.stringify(board)).not.toContain(atlas.id);
  }finally{await f.close();}
});

it('keeps verified best scores while run publication is pending and separates solo from co-op',async()=>{
  const archive=new MemoryArchive(),store=new LevelStore(':memory:',archive);try{
    await store.seed(levels);const snapshot=store.campaignSnapshots()[0];archive.put=async()=>{throw new Error('offline');};
    const moves=[levels[0].solutionP1,levels[0].solutionP2] as const;
    await store.captureRun(snapshot,{id:'a',displayName:'Atlas'},1,[...moves],'solo','creator');
    expect(store.completions()).toEqual([]);
    expect(store.scores(snapshot.ref!.entityKey,'a','solo').entries).toMatchObject([{rank:1,name:'Atlas',turns:8,isYou:true}]);
    expect(store.scores(snapshot.ref!.entityKey,'a','coop').entries).toEqual([]);
    await store.captureRun(snapshot,{id:'b',displayName:'Nova'},2,[...moves],'coop','live');
    await store.captureRun(snapshot,{id:'b',displayName:'Nova'},2,[...moves],'coop','live');
    expect(store.completions()).toHaveLength(1);expect(store.scores(snapshot.ref!.entityKey,'a','coop').total).toBe(1);
    expect(store.scores('different-revision','b','coop').entries).toEqual([]);
    expect(()=>store.captureRun(snapshot,{id:'fake',displayName:'Fake'},1,[['W'],['W']],'coop','live')).toThrow('winning');
    expect(store.scores(snapshot.ref!.entityKey,'a','coop').total).toBe(1);
  }finally{await store.drain();store.close();}
});

it('pages an ordered ranking without losing the personal rank or leaking identity',()=>{
  const rows=Array.from({length:60},(_,i)=>({accountId:String(i)}));
  const page=rankingPage(rows,'59',1,(_row,rank,isYou)=>({rank,isYou}));
  expect(page.entries).toHaveLength(25);expect(page.entries[0].rank).toBe(26);expect(page.me).toEqual({rank:60,isYou:true});expect(page.total).toBe(60);
});
