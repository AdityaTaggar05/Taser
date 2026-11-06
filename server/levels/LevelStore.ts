import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {cleanDraft} from '../../src/core/levelValidation';
import {verifySolution} from '../../src/editor/solution';
import type {LevelConfig} from '../../src/core/types';
import type {LevelSummary,StoredLevel,CampaignSummary,ReferenceSolution} from '../../src/editor/types';
import {ArchiveError,UnconfiguredArchive,type LevelArchive,type ArchiveRecord,type ArchiveRef,type ArchivedLevel} from '../arkiv/archive';
import {ActivityStore} from '../arkiv/ActivityStore';
import {canonicalJSON} from '../arkiv/canonical';
export class LevelError extends Error {constructor(readonly status:number,message:string){super(message);}}
interface Row {id:string;owner_id:string;owner_name:string;draft:string;revision:number;published:string|null;published_revision:number|null;updated_at:number;archived_revision:number|null}
export interface PublishedSnapshot {level:LevelConfig;revision:number;ref?:ArchiveRef;id?:string;slot?:number}
/** SQLite is a private projection and write-recovery cache. Arkiv confirms every saved revision. */
export class LevelStore {
  private activity:ActivityStore;private flushingMoves=false;
  private closed=false;private observedHead=0n;private availabilityAt=0;
  private availabilityRequest:Promise<void>|undefined;
  private db:DatabaseSync;private queue:Promise<unknown>=Promise.resolve();
  get storage(){return this.archive.mode;}
  constructor(path:string,readonly archive:LevelArchive=new UnconfiguredArchive()){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS custom_levels(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,owner_name TEXT NOT NULL,draft TEXT NOT NULL,revision INTEGER NOT NULL,published TEXT,published_revision INTEGER,updated_at INTEGER NOT NULL,archived_revision INTEGER);
      CREATE INDEX IF NOT EXISTS custom_levels_owner ON custom_levels(owner_id);
      CREATE TABLE IF NOT EXISTS level_publications(entity_key TEXT PRIMARY KEY,record_id TEXT NOT NULL,revision INTEGER NOT NULL,category TEXT NOT NULL,record TEXT NOT NULL,ref TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_runs(id TEXT PRIMARY KEY,record TEXT NOT NULL,ref TEXT,status TEXT NOT NULL DEFAULT 'pending',error TEXT);
      CREATE TABLE IF NOT EXISTS level_wins(account_id TEXT NOT NULL,entity_key TEXT NOT NULL,PRIMARY KEY(account_id,entity_key));`);
    this.activity=new ActivityStore(this.db,this.archive);
    if(!(this.db.prepare('PRAGMA table_info(custom_levels)').all()).some(r=>r.name==='archived_revision'))this.db.exec('ALTER TABLE custom_levels ADD COLUMN archived_revision INTEGER');
  }
  private serial<T>(work:()=>Promise<T>){const task=this.queue.then(work);this.queue=task.catch(()=>{});return task;}
  private row(id:string){return this.db.prepare('SELECT * FROM custom_levels WHERE id=?').get(id) as unknown as Row|undefined;}
  private summary(row:Row,published=false):LevelSummary {const level=JSON.parse(published?row.published!:row.draft) as LevelConfig;return {id:row.id,name:level.name,subtitle:level.subtitle,ownerName:row.owner_name,revision:row.revision,publishedRevision:row.published_revision,updatedAt:row.updated_at,width:level.width,height:level.height,totalSteps:level.totalSteps,...(!published?{archivedRevision:row.archived_revision}:{})};}
  list(ownerId:string){return (this.db.prepare('SELECT * FROM custom_levels WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').all(ownerId) as unknown as Row[]).map(row=>this.summary(row));}
  community():LevelSummary[]{return this.latest('community').sort((a,b)=>b.record.updatedAt-a.record.updatedAt).slice(0,100).map(({record:r,ref})=>({entityKey:ref.entityKey,txHash:ref.txHash,storage:this.storage,id:r.id,name:r.level.name,subtitle:r.level.subtitle,ownerName:r.ownerName,revision:r.revision,publishedRevision:r.revision,updatedAt:r.updatedAt,width:r.level.width,height:r.level.height,totalSteps:r.level.totalSteps}));}
  get(ownerId:string,id:string):StoredLevel {const row=this.row(id);if(!row||row.owner_id!==ownerId)throw new LevelError(404,'Draft not found in your account.');return {...this.summary(row),level:JSON.parse(row.draft)};}
  private project({record:r,ref}:ArchivedLevel){
    if(r.category==='run'){this.db.prepare("INSERT INTO game_runs(id,record,ref,status) VALUES(?,?,?,'confirmed') ON CONFLICT(id) DO UPDATE SET ref=excluded.ref,status='confirmed',error=NULL").run(r.id,JSON.stringify(r),JSON.stringify(ref));return;}
    this.db.prepare('INSERT OR REPLACE INTO level_publications(entity_key,record_id,revision,category,record,ref) VALUES(?,?,?,?,?,?)').run(ref.entityKey,r.id,r.revision,r.category,JSON.stringify(r),JSON.stringify(ref));
    if(r.category==='campaign')return;
    const prior=this.row(r.id);
    if(!prior)this.db.prepare('INSERT INTO custom_levels(id,owner_id,owner_name,draft,revision,updated_at,archived_revision) VALUES(?,?,?,?,?,?,?)').run(r.id,r.ownerId,r.ownerName,JSON.stringify(r.level),r.revision,r.updatedAt,r.category==='draft'?r.revision:null);
    else if(r.category==='draft'&&r.revision>=prior.revision)this.db.prepare('UPDATE custom_levels SET draft=?,revision=?,owner_name=?,updated_at=?,archived_revision=? WHERE id=? AND owner_id=?').run(JSON.stringify(r.level),r.revision,r.ownerName,r.updatedAt,r.revision,r.id,r.ownerId);
    if(r.category==='community'&&(!prior?.published_revision||r.revision>=prior.published_revision))this.db.prepare('UPDATE custom_levels SET published=?,published_revision=? WHERE id=? AND owner_id=?').run(JSON.stringify(r.level),r.revision,r.id,r.ownerId);
  }
  async hydrate(){
    // Only replace the public projection after a complete successful trusted remote traversal.
    const entries=await this.archive.list();
    this.db.exec('BEGIN IMMEDIATE');try{
      // Keep private legacy/recovery snapshots until migration confirms them. Public discovery
      // uses only level_publications, so unarchived or expired snapshots never leak into play.
      this.db.exec('DELETE FROM level_publications');
      for(const entry of entries.sort((a,b)=>a.record.revision-b.record.revision))this.project(entry);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  async seed(campaign:LevelConfig[]){
    for(const level of campaign){const id=`00000000-0000-4000-8000-${String(level.id).padStart(12,'0')}`;
      if(this.campaign().some(c=>c.slot===level.id))continue;
      const record:ArchiveRecord={id,revision:1,category:'campaign',ownerId:'campaign',ownerName:'WeldPoint',campaignSlot:level.id,updatedAt:0,level:structuredClone(level)};
      this.project({record,ref:await this.archive.put(record)});
    }
  }
  /** Explicit one-time migration; it never runs as a hidden write during server startup. */
  async migrate(campaign:LevelConfig[]){
    const legacy=this.db.prepare('SELECT * FROM custom_levels').all() as unknown as Row[];
    await this.hydrate();await this.seed(campaign);
    for(const row of legacy){
      const draft:ArchiveRecord={id:row.id,revision:row.revision,category:'draft',ownerId:row.owner_id,ownerName:row.owner_name,updatedAt:row.updated_at,level:JSON.parse(row.draft)};
      if(row.archived_revision!==row.revision)this.project({record:draft,ref:await this.archive.put(draft)});
      if(row.published&&!this.latest('community',row.id).some(e=>e.record.revision===row.published_revision)){const record={...draft,category:'community' as const,revision:row.published_revision!,level:JSON.parse(row.published)};this.project({record,ref:await this.archive.put(record)});}
    }
  }
  save(ownerId:string,ownerName:string,value:unknown,id?:string,revision?:number,createId?:string):Promise<StoredLevel>{return this.serial(async()=>{
    const level=cleanDraft(value),now=Date.now();
    if(id){this.get(ownerId,id);if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1)throw new LevelError(400,'Missing draft revision.');const result=this.db.prepare('UPDATE custom_levels SET draft=?,owner_name=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(JSON.stringify(level),ownerName,now,id,ownerId,revision);if(!result.changes)throw new LevelError(409,'This draft changed in another tab. Reload it from My levels before saving.');}
    else {
      id=createId??randomUUID();const prior=this.row(id);
      if(prior){if(prior.owner_id!==ownerId||prior.draft!==JSON.stringify(level)||prior.revision!==1)throw new LevelError(409,'This draft identifier is already in use. Reload it from My levels.');}
      else {const count=this.db.prepare('SELECT COUNT(*) AS n FROM custom_levels WHERE owner_id=?').get(ownerId)!;if(Number(count.n)>=100)throw new LevelError(409,'Your account has reached the 100-draft limit.');this.db.prepare('INSERT INTO custom_levels(id,owner_id,owner_name,draft,revision,updated_at) VALUES(?,?,?,?,1,?)').run(id,ownerId,ownerName,JSON.stringify(level),now);}
    }
    const row=this.row(id)!,record:ArchiveRecord={id,revision:row.revision,category:'draft',ownerId,ownerName,updatedAt:row.updated_at,level};
    this.project({record,ref:await this.activity.publish(this.activity.enqueue(record,[ownerId],`Draft revision ${record.revision}`))});return this.get(ownerId,id);
  });}
  publish(ownerId:string,id:string,revision:number,target:'community'|'campaign'='community'):Promise<StoredLevel>{return this.serial(async()=>{
    const draft=this.get(ownerId,id);if(draft.revision!==revision)throw new LevelError(409,'Save and reload the current draft before publishing.');
    const check=verifySolution(draft.level);if(!check.valid)throw new LevelError(422,check.message);
    const row=this.row(id)!;
    if(row.archived_revision!==revision)throw new LevelError(409,'This draft has not been confirmed on Arkiv. Reload it and save before publishing.');
    const prior=this.campaign().find(c=>c.id===id),slot=prior?.slot??Math.max(0,...this.campaign().map(c=>c.slot))+1;
    const record:ArchiveRecord={id,revision,category:target,ownerId,ownerName:draft.ownerName,updatedAt:row.updated_at,
      ...(target==='campaign'?{campaignSlot:slot}:{lifetimeDays:2 as const}),level:{...draft.level,...(target==='campaign'?{id:slot}:{})}};
    const ref=await this.activity.publish(this.activity.enqueue(record,[ownerId],`${target==='campaign'?'Campaign':'Community'} publication · revision ${revision}`));this.project({record,ref});return {...this.get(ownerId,id),publication:{...ref,category:target}};
  });}
  private latest(category:'community'|'campaign',id?:string){const rows=this.db.prepare('SELECT record,ref FROM level_publications WHERE category=?'+(id?' AND record_id=?':'')+' ORDER BY revision DESC').all(...(id?[category,id]:[category]));const seen=new Set<string>();return rows.flatMap(row=>{const record=JSON.parse(String(row.record)) as ArchiveRecord;if(seen.has(record.id))return [];seen.add(record.id);const ref=JSON.parse(String(row.ref)) as ArchiveRef;if(BigInt(ref.expiresAt)<=this.observedHead)return [];return [{record,ref}];});}
  campaign():CampaignSummary[]{return this.latest('campaign').map(({record:r,ref})=>({id:r.id,name:r.level.name,subtitle:r.level.subtitle,ownerName:r.ownerName,revision:r.revision,publishedRevision:r.revision,updatedAt:r.updatedAt,width:r.level.width,height:r.level.height,totalSteps:r.level.totalSteps,slot:r.campaignSlot!,entityKey:ref.entityKey,txHash:ref.txHash,storage:this.storage})).sort((a,b)=>a.slot-b.slot);}
  campaignSnapshots():PublishedSnapshot[]{return this.campaign().map(c=>{const entry=this.latest('campaign',c.id)[0];return {level:structuredClone(entry.record.level),revision:c.revision,id:c.id,slot:c.slot,ref:entry.ref};});}
  published(id:string):PublishedSnapshot|null {const entry=this.latest('community',id)[0];return entry?{level:structuredClone(entry.record.level),revision:entry.record.revision,ref:entry.ref,id}:null;}
  forPlay(id:string){return this.campaignSnapshots().find(s=>s.id===id)??this.published(id);}
  async validateSnapshot(snapshot:PublishedSnapshot){if(!snapshot.ref)throw new LevelError(503,'Published level has no archive reference.');const record=await this.archive.read(snapshot.ref);if(record.id!==snapshot.id||record.revision!==snapshot.revision||canonicalJSON(record.level)!==canonicalJSON(snapshot.level))throw new LevelError(503,'Archived level differs from the selected revision.');}
  recordWin(ids:string[],entityKey:string){for(const id of ids)this.db.prepare('INSERT OR IGNORE INTO level_wins(account_id,entity_key) VALUES(?,?)').run(id,entityKey);}
  canReveal(accountId:string,entityKey:string){return !!this.db.prepare('SELECT 1 FROM level_wins WHERE account_id=? AND entity_key=?').get(accountId,entityKey);}
  async solution(accountId:string,entityKey:string):Promise<ReferenceSolution>{
    if(!this.canReveal(accountId,entityKey))throw new LevelError(403,'Complete this published revision in co-op to unlock its reference solution.');
    const row=this.db.prepare("SELECT ref FROM level_publications WHERE entity_key=? AND category!='draft'").get(entityKey);if(!row)throw new LevelError(404,'Published revision unavailable.');
    const r=await this.archive.read(JSON.parse(String(row.ref)));return {name:r.level.name,solutionP1:r.level.solutionP1,solutionP2:r.level.solutionP2};
  }
  async template(accountId:string,id:string,admin:boolean){const entry=this.latest('campaign',id)[0];if(!entry)throw new LevelError(404,'Campaign chamber unavailable.');if(!admin&&!this.canReveal(accountId,entry.ref.entityKey))throw new LevelError(403,'Complete this campaign revision before using it as an editable template.');return (await this.archive.read(entry.ref)).level;}
  async refreshAvailability(){
    if(Date.now()-this.availabilityAt<10_000)return;
    if(this.availabilityRequest)return this.availabilityRequest;
    this.availabilityRequest=(async()=>{this.observedHead=await this.archive.head?.()??0n;this.availabilityAt=Date.now();})();
    try{await this.availabilityRequest;}finally{this.availabilityRequest=undefined;}
  }
  runs(levelId:string,role:1|2){
    const snapshot=this.forPlay(levelId);if(!snapshot?.ref)throw new LevelError(404,'Published chamber unavailable.');
    return this.db.prepare("SELECT id,record,ref FROM game_runs WHERE status='confirmed' ORDER BY rowid DESC").all().flatMap(row=>{
      const record=JSON.parse(String(row.record)) as ArchiveRecord,ref=JSON.parse(String(row.ref)) as ArchiveRef;
      if(record.run?.levelKey!==snapshot.ref!.entityKey||record.run.role!==role||BigInt(ref.expiresAt)<=this.observedHead)return [];
      return [{id:String(row.id),name:record.ownerName,role,turns:record.level.solutionP1.length,mode:record.run.mode,createdAt:record.updatedAt,entityKey:ref.entityKey,expiresAt:ref.expiresAt,txHash:ref.txHash,storage:this.storage}];
    }).slice(0,100);
  }
  async echo(snapshot:PublishedSnapshot,role:1|2,runId?:string){
    await this.validateSnapshot(snapshot);
    if(!runId)return {moves:structuredClone((role===1?snapshot.level.solutionP1:snapshot.level.solutionP2).slice(0,verifySolution(snapshot.level).step)),name:'Creator solution',source:'creator'};
    const row=this.db.prepare("SELECT record,ref FROM game_runs WHERE id=? AND status='confirmed'").get(runId);
    if(!row)throw new LevelError(404,'Player run unavailable or not confirmed.');
    const cached=JSON.parse(String(row.record)) as ArchiveRecord,r=await this.archive.read(JSON.parse(String(row.ref)));
    if(canonicalJSON(r)!==canonicalJSON(cached)||r.category!=='run'||r.run?.levelKey!==snapshot.ref?.entityKey||r.run?.role!==role)throw new LevelError(409,'This replay does not match the selected role and level revision.');
    return {moves:structuredClone(role===1?r.level.solutionP1:r.level.solutionP2),name:r.ownerName,source:r.id};
  }
  /** Only server-simulated winners call this; the witness is independently replayed before enqueueing. */
  captureRun(snapshot:PublishedSnapshot,user:{id:string;displayName:string},role:1|2,moves:[import('../../src/core/types').Direction[],import('../../src/core/types').Direction[]],mode:'coop'|'solo',source:string){
    if(!snapshot.ref)throw new LevelError(503,'Run has no published revision.');
    const level={...structuredClone(snapshot.level),solutionP1:[...moves[0]],solutionP2:[...moves[1]]};
    if(!verifySolution(level).valid)throw new LevelError(422,'Only winning runs can be archived.');
    const id=createHash('sha256').update(JSON.stringify([snapshot.ref.entityKey,user.id,role,moves[role-1],Math.floor(Date.now()/172_800_000)])).digest('hex');
    const record:ArchiveRecord={id,revision:1,category:'run',ownerId:user.id,ownerName:user.displayName,updatedAt:Date.now(),lifetimeDays:2,level,run:{levelKey:snapshot.ref.entityKey,role,mode,source}};
    this.db.prepare("INSERT OR IGNORE INTO game_runs(id,record,status) VALUES(?,?,'pending')").run(id,JSON.stringify(record));
    return this.publishRun(id);
  }
  private publishRun(id:string){return this.serial(async()=>{
    const row=this.db.prepare('SELECT record,ref,status FROM game_runs WHERE id=?').get(id);if(!row)return;
    if(row.status==='confirmed')return 'confirmed' as const;
    try{const record=JSON.parse(String(row.record)) as ArchiveRecord;const ref=await this.activity.publish(this.activity.enqueue(record,[record.ownerId],`Winning run · P${record.run!.role}`));if(!this.closed)this.project({record,ref});return 'confirmed' as const;}
    catch(error){if(!this.closed)this.db.prepare("UPDATE game_runs SET error=? WHERE id=?").run(error instanceof ArchiveError?error.message:'Arkiv run publication is pending.',id);return 'pending' as const;}
  });}
  moveSequence(accountId:string,sessionId:string,sequences:number[]){return this.activity.moves(accountId,sessionId,sequences);}
  activityFeed(accountId:string){return this.activity.feed(accountId);}
  captureMove(snapshot:PublishedSnapshot,sessionId:string,sequence:number,turn:number,inputs:[import('../../src/core/types').Direction,import('../../src/core/types').Direction],audience:string[],mode:'solo'|'coop'){
    if(!snapshot.ref)throw new LevelError(503,'Move has no published revision.');
    const record:import('../arkiv/archive').MoveRecord={id:createHash('sha256').update(JSON.stringify([sessionId,sequence])).digest('hex'),revision:1,category:'move',ownerId:audience[0],ownerName:'',updatedAt:Date.now(),lifetimeDays:2,
      move:{levelKey:snapshot.ref.entityKey,sessionId,turn,sequence,mode,inputs:[...inputs]}};
    this.activity.enqueue(record,audience,`Turn ${turn} · move pair ${sequence}`);
    void this.flushMoves().catch(()=>{});
  }
  async flushMoves(){
    if(this.flushingMoves||this.closed)return;this.flushingMoves=true;
    try{for(const id of this.activity.pendingMoves()){
      if(this.closed)return;
      try{await this.serial(()=>this.activity.publish(id));}catch{break;}
    }}finally{this.flushingMoves=false;}
  }
  async flushRuns(){for(const row of this.db.prepare("SELECT id FROM game_runs WHERE status='pending' ORDER BY rowid LIMIT 4").all()){if(this.closed)return;const status=await this.publishRun(String(row.id));if(status!=='confirmed')break;}}
  async drain(){while(this.flushingMoves)await this.queue;await this.queue;}
  close(){this.closed=true;this.db.close();this.archive.close();}
}
