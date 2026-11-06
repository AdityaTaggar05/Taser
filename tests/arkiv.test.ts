import {it,expect,vi} from 'vitest';
import {generateKey} from 'arkiv-encryption';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {custom,bytesToHex,encodeEventTopics,encodeAbiParameters,keccak256,parseTransaction,type Hex,type TransactionSerialized} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {str,u64,bytes} from '@arkiv-network/sdk/schema';
import {ENTITY_EVENTS_ABI} from '@arkiv-network/sdk';
import {LevelCipher,CONTENT_TYPE} from '../server/arkiv/LevelCipher';
import {ArkivArchive} from '../server/arkiv/ArkivArchive';
import {MemoryArchive,type ArchiveRecord,type ArchiveRef} from '../server/arkiv/archive';
import {LevelStore} from '../server/levels/LevelStore';
import {levels} from '../server/data/campaign';
import {canonicalJSON} from '../server/arkiv/canonical';
import {authFixture} from './authFixture';

const record=(revision=1):ArchiveRecord=>({id:'11111111-1111-4111-8111-111111111111',revision,category:'community',ownerId:'atlas',ownerName:'Atlas',updatedAt:0,level:structuredClone(levels[0])});
it('encrypts the entire level with fresh IVs, authenticates routing and rejects tampering/wrong keys',async()=>{
  const raw=generateKey(),cipher=new LevelCipher(raw,'test'),r=record(),expected={id:r.id,revision:1,category:'community'};
  const first=await cipher.encrypt(r),second=await cipher.encrypt(r);
  expect(first).not.toEqual(second);expect(new TextDecoder().decode(first)).not.toContain(r.level.name);
  expect(canonicalJSON(await cipher.decrypt(first,expected))).toBe(canonicalJSON(r));
  await expect(new LevelCipher(generateKey(),'test').decrypt(first,expected)).rejects.toThrow('authentication');
  await expect(new LevelCipher(raw,'other').decrypt(first,expected)).rejects.toThrow('authentication');
  await expect(cipher.decrypt(first,{...expected,revision:2})).rejects.toThrow('authentication');
  await expect(cipher.decrypt(first,{...expected,category:'campaign'})).rejects.toThrow('authentication');
  const tampered=first.slice();tampered[20]^=1;await expect(cipher.decrypt(tampered,expected)).rejects.toThrow('authentication');
});
it('restores campaign/custom publications from the archive and gates solutions by exact revision',async()=>{
  const archive=new MemoryArchive();let store=new LevelStore(':memory:',archive);
  await store.seed(levels);const owner='atlas',draft=await store.save(owner,'Atlas',levels[0]);
  await store.publish(owner,draft.id,1);const first=store.published(draft.id)!;
  await expect(store.solution('nova',first.ref!.entityKey)).rejects.toThrow('Complete');
  store.recordWin(['nova'],first.ref!.entityKey);expect((await store.solution('nova',first.ref!.entityKey)).solutionP1).toEqual(levels[0].solutionP1);
  const next=await store.save(owner,'Atlas',{...levels[0],name:'A revised chamber'},draft.id,1);await store.publish(owner,draft.id,next.revision);
  const second=store.published(draft.id)!;expect(store.canReveal('nova',second.ref!.entityKey)).toBe(false);
  expect((await store.solution('nova',first.ref!.entityKey)).name).toBe(levels[0].name);
  const promoted=await store.publish(owner,draft.id,2,'campaign');expect(promoted.id).toBe(draft.id);expect(store.campaign()).toHaveLength(levels.length+1);expect(store.campaign()[levels.length].slot).toBe(levels.length+1);
  const campaignKey=store.campaign()[levels.length].entityKey;expect(store.canReveal('nova',campaignKey)).toBe(false);
  await expect(store.template('nova',draft.id,false)).rejects.toThrow('Complete');
  expect((await store.template('atlas',draft.id,true)).id).toBe(levels.length+1);
  store.close();store=new LevelStore(':memory:',archive);await store.hydrate();
  expect(store.campaign()).toHaveLength(levels.length+1);expect(store.published(draft.id)?.level.name).toBe('A revised chamber');expect(store.get(owner,draft.id).revision).toBe(2);store.close();
});
it('enforces campaign publishing and template access on authenticated server endpoints',async()=>{
  const f=await authFixture();try{
    const a=f.browser(),b=f.browser();await a.login();await b.login('nova');
    expect((await a.request('levels/catalog')).data.canPublishCampaign).toBe(true);expect((await b.request('levels/catalog')).data.canPublishCampaign).toBe(false);
    const campaign=(await b.request('levels/catalog')).data.campaign[0];
    expect((await b.request(`levels/campaign/${campaign.id}/template`)).status).toBe(403);
    expect((await a.request(`levels/campaign/${campaign.id}/template`)).status).toBe(200);
    const draft=(await b.request('levels',{level:levels[0]})).data;
    expect((await b.request(`levels/${draft.id}/publish`,{revision:1,target:'campaign'})).status).toBe(403);
    expect((await b.request(`levels/solution/${campaign.entityKey}`)).status).toBe(403);
    f.levels.recordWin([(await b.request('session')).data.user.id],campaign.entityKey);
    expect((await b.request(`levels/solution/${campaign.entityKey}`)).data.solutionP1).toEqual(levels[0].solutionP1);
    expect((await b.request(`levels/campaign/${campaign.id}/template`)).status).toBe(200);
    expect((await b.request('levels/catalog')).data.campaign[0]).not.toHaveProperty('level');
  }finally{await f.close();}
});

/** Exercise real SDK encoding and local signing while simulating an RPC losing the send reply. */
function writerFixture(budgets:{maxTxFee?:string;dailyBudget?:string}={}){
  const directory=mkdtempSync(join(tmpdir(),'taser-writer-')),path=join(directory,'journal.sqlite'),privateKey=generatePrivateKey(),account=privateKeyToAccount(privateKey);
  let raw:TransactionSerialized|undefined,sends=0,receiptAvailable=false,readbackAvailable=true;
  const entityKey=('0x'+'ab'.repeat(32)) as Hex,blockHash=('0x'+'cd'.repeat(32)) as Hex;
  const transport=custom({async request({method,params}){
    if(method==='eth_chainId')return '0x76edaf';
    if(method==='eth_blockNumber')return '0x64';
    if(method==='eth_getTransactionCount')return '0x0';
    if(method==='eth_gasPrice')return '0x3b9aca00';
    if(method==='eth_getBalance')return '0x8ac7230489e80000';
    if(method==='eth_estimateGas')return '0x493e0';
    if(method==='arkiv_query')return {data:[],blockNumber:'0x64'};
    if(method==='eth_sendRawTransaction'){
      sends++;raw=(params as TransactionSerialized[])[0];
      const db=new DatabaseSync(path);const saved=db.prepare("SELECT phase,signed,tx_hash FROM arkiv_writes WHERE phase='submitting'").get();db.close();
      expect(saved?.signed).toBe(raw);expect(saved?.tx_hash).toBe(keccak256(raw));
      throw new Error('Simulated lost response with a sensitive provider URL');
    }
    throw new Error('Unexpected fixture RPC '+method);
  }},{retryCount:0});
  const archive=new ArkivArchive({accessKey:'test-key',privateKey,encryptionKey:generateKey(),namespace:'test',databasePath:path,maxTxFee:budgets.maxTxFee??'0.005',dailyBudget:budgets.dailyBudget??'0.03'},transport);
  const reader=(archive as unknown as {reader:ReturnType<typeof import('@arkiv-network/sdk').createPublicClient>}).reader;
  vi.spyOn(reader,'getBlock').mockImplementation(async args=>({hash:args?.blockNumber===0n?'0x'+'00'.repeat(32):blockHash,gasLimit:30_000_000n,number:100n}) as never);
  vi.spyOn(reader,'getTransactionReceipt').mockImplementation(async()=>{
    if(!raw||!receiptAvailable)throw new Error('Receipt not available');
    return {status:'success',transactionHash:keccak256(raw),blockNumber:100n,blockHash,logs:[{address:'0x4400000000000000000000000000000000000044',topics:encodeEventTopics({abi:ENTITY_EVENTS_ABI,eventName:'EntityCreated',args:{entityKey,owner:account.address}}),data:encodeAbiParameters([{type:'uint64'},{type:'uint8'}],[7_884_100n,1])}]} as never;
  });
  vi.spyOn(reader,'getTransaction').mockImplementation(async()=>{const tx=parseTransaction(raw!);return {...tx,hash:keccak256(raw!),from:account.address,input:tx.data} as never;});
  vi.spyOn(reader,'getEntity').mockImplementation(async()=>{
    if(!readbackAvailable)throw new Error('Readback unavailable');
    const db=new DatabaseSync(path),plan=db.prepare('SELECT ciphertext,body FROM arkiv_writes LIMIT 1').get()!;db.close();
    return {$key:entityKey,$creator:account.address,$owner:account.address,$creationFlags:{readonly:true,permissionlessExtension:false},$expiresAt:7_884_100n,
      namespace:str('test'),record_id:str(JSON.parse(String(plan.body)).id),revision:u64(1),category:str(JSON.parse(String(plan.body)).category),content_type:str(CONTENT_TYPE),ciphertext:bytes(plan.ciphertext as Hex)} as never;
  });
  return {archive,path,reader,get sends(){return sends;},receipt:(yes:boolean)=>{receiptAvailable=yes;},readback:(yes:boolean)=>{readbackAvailable=yes;},close:()=>{archive.close();rmSync(directory,{recursive:true,force:true});}};
}
it('journals signed bytes before forwarding and reconciles a lost reply without a second send',async()=>{
  const f=writerFixture();try{
    await expect(f.archive.put(record())).rejects.toThrow('could not be confirmed');expect(f.sends).toBe(1);
    await expect(f.archive.put(record(2))).rejects.toThrow();expect(f.sends).toBe(1);
    f.receipt(true);const ref=await f.archive.put(record());expect(ref.entityKey).toContain('abab');expect(f.sends).toBe(1);
    expect(canonicalJSON(await f.archive.read(ref))).toBe(canonicalJSON(record()));
    await f.archive.put(record());expect(f.sends).toBe(1);
  }finally{f.close();}
});
it('preserves receipt confirmation across readback failure and resumes verification without resending',async()=>{
  const f=writerFixture();try{
    f.receipt(true);f.readback(false);await expect(f.archive.put(record())).rejects.toThrow();expect(f.sends).toBe(1);
    const db=new DatabaseSync(f.path);expect(db.prepare('SELECT phase FROM arkiv_writes').get()?.phase).toBe('receipt_confirmed');db.close();
    f.readback(true);await f.archive.put(record());expect(f.sends).toBe(1);
  }finally{f.close();}
});
it('rejects mutable or copied publisher data before returning decrypted content',async()=>{
  const f=writerFixture();try{
    f.receipt(true);const ref=await f.archive.put(record());const original=await f.reader.getEntity(ref.entityKey as Hex);
    vi.mocked(f.reader.getEntity).mockResolvedValue({...original,$creationFlags:{readonly:false,permissionlessExtension:false}} as never);
    await expect(f.archive.read(ref)).rejects.toThrow('Untrusted');
    vi.mocked(f.reader.getEntity).mockResolvedValue({...original,$creator:privateKeyToAccount(generatePrivateKey()).address} as never);
    await expect(f.archive.read(ref)).rejects.toThrow('Untrusted');
  }finally{f.close();}
});
it('stops before sending when either the per-transaction or daily approved fee cap is exceeded',async()=>{
  for(const budgets of [{maxTxFee:'0'},{maxTxFee:'0.0001'},{dailyBudget:'0.0005'}]){
    const f=writerFixture(budgets);try{
      await expect(f.archive.put(record())).rejects.toThrow('fee budget');expect(f.sends).toBe(0);
      const db=new DatabaseSync(f.path);expect(db.prepare('SELECT signed,phase FROM arkiv_writes').get()).toMatchObject({signed:null,phase:'prepared'});db.close();
    }finally{f.close();}
  }
});
it('refuses a new send when the signer balance cannot cover the maximum transaction fee',async()=>{
  const f=writerFixture();try{
    vi.spyOn(f.reader,'getBalance').mockResolvedValue(0n);
    await expect(f.archive.put(record())).rejects.toThrow('signer balance');expect(f.sends).toBe(0);
  }finally{f.close();}
});
it('retains legacy snapshots across a partial campaign migration and resumes without duplicates',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'taser-migrate-')),path=join(directory,'accounts.sqlite'),archive=new MemoryArchive();let store=new LevelStore(path,archive);
  try{
    const db=new DatabaseSync(path),legacy=JSON.stringify(levels[0]);
    db.prepare('INSERT INTO custom_levels(id,owner_id,owner_name,draft,revision,published,published_revision,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(record().id,'atlas','Atlas',legacy,1,legacy,1,0);db.close();
    expect(store.community()).toEqual([]);expect(store.published(record().id)).toBeNull();
    const original=archive.put.bind(archive);let fail=true;
    vi.spyOn(archive,'put').mockImplementation(async r=>{if(fail&&r.category==='campaign'&&r.campaignSlot===3)throw new Error('Offline');return original(r);});
    await expect(store.migrate(levels)).rejects.toThrow('Offline');expect(archive.entries.size).toBe(2);
    store.close();store=new LevelStore(path,archive);fail=false;await store.migrate(levels);
    expect(store.campaign()).toHaveLength(levels.length);expect(store.community()).toHaveLength(1);expect(store.published(record().id)?.level.solutionP1).toEqual(levels[0].solutionP1);
    const count=archive.entries.size;await store.migrate(levels);expect(archive.entries.size).toBe(count);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
it('authenticates encrypted run provenance and lifetime without exposing move sequences',async()=>{
  const cipher=new LevelCipher(generateKey(),'test');const r:ArchiveRecord={...record(),id:'f'.repeat(64),category:'run',lifetimeDays:2,run:{levelKey:'0x'+'a'.repeat(64),role:2,mode:'solo',source:'creator'}};
  const encrypted=await cipher.encrypt(r);expect(new TextDecoder().decode(encrypted)).not.toContain('solutionP2');expect(await cipher.decrypt(encrypted,{id:r.id,revision:1,category:'run'})).toEqual(r);
  await expect(cipher.decrypt(await cipher.encrypt({...r,run:{...r.run!,role:3 as 1}}),{id:r.id,revision:1,category:'run'})).rejects.toThrow('validation');
  await expect(cipher.decrypt(await cipher.encrypt({...r,lifetimeDays:undefined}),{id:r.id,revision:1,category:'run'})).rejects.toThrow('validation');
});

it('loads supported level and run categories from a mixed archive across pages and still rejects untrusted levels',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'taser-catalog-')),privateKey=generatePrivateKey(),account=privateKeyToAccount(privateKey);
  const encryptionKey=generateKey(),cipher=new LevelCipher(encryptionKey,'test');
  const queries:string[]=[];
  const rows=await Promise.all(Array.from({length:106},async(_,i)=>{
    const category=i<3?'other':i===3?'campaign':i===4?'community':i===5?'run':'draft';
    const r={...record(),category:category==='other'?'draft':category,...(category==='run'?{id:'f'.repeat(64),lifetimeDays:2,run:{levelKey:'0x'+'a'.repeat(64),role:2,mode:'solo',source:'creator'}}:{}),...(category==='campaign'?{campaignSlot:1}:{})} as ArchiveRecord;
    return {key:('0x'+(i+1).toString(16).padStart(64,'0')) as Hex,creator:account.address,owner:account.address,
      creationFlags:1,expiresAt:'0xffffff',attributes:[
        {name:'arkiv.schema',type:'str',value:'weldpoint_levels_v1'},
        {name:'namespace',type:'str',value:'test'},
        {name:'record_id',type:'str',value:r.id},
        {name:'revision',type:'u64',value:'0x1'},
        {name:'category',type:'str',value:category},
        {name:'content_type',type:'str',value:CONTENT_TYPE},
        {name:'ciphertext',type:'bytes',value:category==='other'?'0x00':bytesToHex(await cipher.encrypt(r))},
      ]};
  }));
  const transport=custom({async request({method,params}){
    if(method==='eth_chainId')return '0x76edaf';
    if(method==='eth_getBlockByNumber')return {hash:'0x'+'00'.repeat(32)};
    if(method==='arkiv_query'){
      const [query,options]=params as unknown as [string,{limit:string}];queries.push(query);
      const categories=[...query.matchAll(/category = str\('([^']+)'\)/g)].map(m=>m[1]);
      const cursor=query.match(/\$key > key\((0x[0-9a-f]+)\)/)?.[1];
      const data=rows.filter(row=>(!categories.length||categories.includes(String(row.attributes.find(a=>a.name==='category')!.value)))&&(!cursor||row.key>cursor));
      return {data:data.slice(0,Number(options.limit)),blockNumber:'0x64'};
    }
    throw new Error('Unexpected catalog RPC '+method);
  }},{retryCount:0});
  const archive=new ArkivArchive({accessKey:'test-key',privateKey,encryptionKey,namespace:'test',databasePath:join(directory,'journal.sqlite'),maxTxFee:'0',dailyBudget:'0'},transport);
  try{
    const entries=await archive.list();expect(entries).toHaveLength(103);
    expect(new Set(entries.map(e=>e.record.category))).toEqual(new Set(['draft','community','campaign','run']));
    expect(queries).toHaveLength(2);
    for(const query of queries){
      expect(query).toContain("namespace = str('test')");
      expect(query.toLowerCase()).toContain(account.address.toLowerCase());
      expect(query).toContain("(category = str('draft') OR category = str('community') OR category = str('campaign') OR category = str('run'))");
    }
    expect(queries[1]).toContain(rows[102].key);
    rows[3].creationFlags=0;await expect(archive.list()).rejects.toThrow('Untrusted');
    rows[3].creationFlags=1;rows[3].creator=privateKeyToAccount(generatePrivateKey()).address;
    await expect(archive.list()).rejects.toThrow('Untrusted');
    rows[3].creator=account.address;rows[3].attributes.find(a=>a.name==='ciphertext')!.value='0x00';
    await expect(archive.list()).rejects.toThrow('authentication');
  }finally{archive.close();rmSync(directory,{recursive:true,force:true});}
});

it('encrypts move contents and exposes submitted versus verified status without duplicate sends',async()=>{
  const f=writerFixture();const move:import('../server/arkiv/archive').MoveRecord={id:'match:1',revision:1,category:'move',ownerId:'a',ownerName:'',updatedAt:0,lifetimeDays:2,move:{levelKey:'0x'+'ef'.repeat(32),sessionId:'match',turn:1,sequence:1,mode:'solo',inputs:['U','D']}};
  try{
    await expect(f.archive.put(move)).rejects.toThrow();expect(f.sends).toBe(1);
    expect(f.archive.writeStatus(move)).toMatchObject({state:'pending',txHash:expect.stringMatching(/^0x/)});expect(f.archive.writeStatus(move)?.entityKey).toBeUndefined();
    const db=new DatabaseSync(f.path);const row=db.prepare('SELECT ciphertext,calldata FROM arkiv_writes').get()!;db.close();
    expect(String(row.ciphertext)).not.toContain(Buffer.from('"inputs"').toString('hex'));expect(String(row.calldata)).not.toContain(Buffer.from('"inputs"').toString('hex'));
    f.receipt(true);f.readback(false);await expect(f.archive.put(move)).rejects.toThrow();expect(f.archive.writeStatus(move)?.state).toBe('pending');
    f.readback(true);const ref=await f.archive.put(move);expect(f.archive.writeStatus(move)).toMatchObject({state:'confirmed',entityKey:ref.entityKey});await f.archive.put(move);expect(f.sends).toBe(1);
  }finally{f.close();}
});
