import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {cleanDraft} from '../../src/core/levelValidation';
import {verifySolution} from '../../src/editor/solution';
import type {LevelConfig} from '../../src/core/types';
import type {LevelSummary,StoredLevel,CampaignSummary,ReferenceSolution} from '../../src/editor/types';
import {ArchiveError,UnconfiguredArchive,type LevelArchive,type ArchiveRecord,type ArchiveRef,type ArchivedLevel} from '../arkiv/archive';
import {canonicalJSON} from '../arkiv/canonical';
import {RULES_HASH,levelHash,witnessCommitment,checkInput,requestHash,validProof,type CertificationInfo,type VerificationInput,type CertificationProof} from '../../src/certification/model';
import {UnconfiguredRegistry,type CertificationRegistry} from '../certification/Registry';
interface SubmissionRow {id:string;level_id:string;revision:number;target:'community'|'campaign';status:CertificationInfo['status'];submitted_at:number;payload:string;proof:string|null;error:string|null}
interface SubmissionPayload {input:VerificationInput;draftRef:ArchiveRef;publication:ArchiveRecord}

export class LevelError extends Error {constructor(readonly status:number,message:string){super(message);}}
interface Row {id:string;owner_id:string;owner_name:string;draft:string;revision:number;published:string|null;published_revision:number|null;updated_at:number;archived_revision:number|null}
export interface PublishedSnapshot {level:LevelConfig;revision:number;ref?:ArchiveRef;id?:string;slot?:number}
/** SQLite is a private projection and write-recovery cache. Arkiv confirms every saved revision. */
export class LevelStore {
  private closed=false;private observedHead=0n;private availabilityAt=0;private certificationCursor=0;
  private db:DatabaseSync;private queue:Promise<unknown>=Promise.resolve();
  get storage(){return this.archive.mode;}
  constructor(path:string,readonly archive:LevelArchive=new UnconfiguredArchive(),readonly registry:CertificationRegistry=new UnconfiguredRegistry()){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS custom_levels(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,owner_name TEXT NOT NULL,draft TEXT NOT NULL,revision INTEGER NOT NULL,published TEXT,published_revision INTEGER,updated_at INTEGER NOT NULL,archived_revision INTEGER);
      CREATE INDEX IF NOT EXISTS custom_levels_owner ON custom_levels(owner_id);
      CREATE TABLE IF NOT EXISTS level_publications(entity_key TEXT PRIMARY KEY,record_id TEXT NOT NULL,revision INTEGER NOT NULL,category TEXT NOT NULL,record TEXT NOT NULL,ref TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_runs(id TEXT PRIMARY KEY,record TEXT NOT NULL,ref TEXT,status TEXT NOT NULL DEFAULT 'pending',error TEXT);
      CREATE TABLE IF NOT EXISTS level_locks(level_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS certification_submissions(id TEXT PRIMARY KEY,level_id TEXT NOT NULL,revision INTEGER NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL,submitted_at INTEGER NOT NULL,payload TEXT NOT NULL,proof TEXT,error TEXT);
      CREATE INDEX IF NOT EXISTS submission_level ON certification_submissions(level_id);
      CREATE TABLE IF NOT EXISTS level_wins(account_id TEXT NOT NULL,entity_key TEXT NOT NULL,PRIMARY KEY(account_id,entity_key));`);
    if(!(this.db.prepare('PRAGMA table_info(custom_levels)').all()).some(r=>r.name==='archived_revision'))this.db.exec('ALTER TABLE custom_levels ADD COLUMN archived_revision INTEGER');
  }
  private serial<T>(work:()=>Promise<T>){const task=this.queue.then(work);this.queue=task.catch(()=>{});return task;}
  private row(id:string){return this.db.prepare('SELECT * FROM custom_levels WHERE id=?').get(id) as unknown as Row|undefined;}
  private summary(row:Row,published=false):LevelSummary {
    const level=JSON.parse(published?row.published!:row.draft) as LevelConfig,certification=this.certificationInfo(row.id),mode=certification?.mode;
    return {id:row.id,name:level.name,subtitle:level.subtitle,ownerName:row.owner_name,revision:row.revision,publishedRevision:row.published_revision,updatedAt:row.updated_at,width:level.width,height:level.height,totalSteps:level.totalSteps,
      ...(!published?{archivedRevision:row.archived_revision}:{}),readonly:this.frozen(row.id),certification,verification:row.published_revision?(mode&&mode!=='unconfigured'?mode:'legacy'):undefined};
  }
  list(ownerId:string){return (this.db.prepare('SELECT * FROM custom_levels WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').all(ownerId) as unknown as Row[]).map(row=>this.summary(row));}
  community():LevelSummary[]{return this.latest('community').sort((a,b)=>b.record.updatedAt-a.record.updatedAt).slice(0,100).map(({record:r})=>({id:r.id,name:r.level.name,subtitle:r.level.subtitle,ownerName:r.ownerName,revision:r.revision,publishedRevision:r.revision,updatedAt:r.updatedAt,width:r.level.width,height:r.level.height,totalSteps:r.level.totalSteps,verification:r.certification?.proof.mode??'legacy'}));}
  get(ownerId:string,id:string):StoredLevel {const row=this.row(id);if(!row||row.owner_id!==ownerId)throw new LevelError(404,'Draft not found in your account.');const publication=this.db.prepare("SELECT ref,category FROM level_publications WHERE record_id=? AND category IN ('campaign','community') ORDER BY rowid DESC LIMIT 1").get(id);return {...this.summary(row),level:JSON.parse(row.draft),...(publication?{publication:{...JSON.parse(String(publication.ref)),category:publication.category}}:{})};}
  private project({record:r,ref}:ArchivedLevel){
    if(r.certification)this.db.prepare("UPDATE certification_submissions SET status='published',error=NULL WHERE id=?").run(r.certification.proof.request.id);
    if(r.category==='run'){this.db.prepare("INSERT INTO game_runs(id,record,ref,status) VALUES(?,?,?,'confirmed') ON CONFLICT(id) DO UPDATE SET ref=excluded.ref,status='confirmed',error=NULL").run(r.id,JSON.stringify(r),JSON.stringify(ref));return;}
    this.db.prepare('INSERT OR REPLACE INTO level_publications(entity_key,record_id,revision,category,record,ref) VALUES(?,?,?,?,?,?)').run(ref.entityKey,r.id,r.revision,r.category,JSON.stringify(r),JSON.stringify(ref));
    if(r.category==='campaign'||r.category==='community')this.db.prepare('INSERT OR IGNORE INTO level_locks VALUES(?)').run(r.id);
    if(r.category==='campaign'&&r.ownerId==='campaign')return;
    const prior=this.row(r.id);
    if(!prior)this.db.prepare('INSERT INTO custom_levels(id,owner_id,owner_name,draft,revision,updated_at,archived_revision) VALUES(?,?,?,?,?,?,?)').run(r.id,r.ownerId,r.ownerName,JSON.stringify(r.level),r.revision,r.updatedAt,r.category==='draft'?r.revision:null);
    else if(r.category==='draft'&&r.revision>=prior.revision)this.db.prepare('UPDATE custom_levels SET draft=?,revision=?,owner_name=?,updated_at=?,archived_revision=? WHERE id=? AND owner_id=?').run(JSON.stringify(r.level),r.revision,r.ownerName,r.updatedAt,r.revision,r.id,r.ownerId);
    if((r.category==='community'||r.category==='campaign')&&(!prior?.published_revision||r.revision>=prior.published_revision))this.db.prepare('UPDATE custom_levels SET published=?,published_revision=? WHERE id=? AND owner_id=?').run(JSON.stringify(r.level),r.revision,r.id,r.ownerId);
  }
  async hydrate(){
    // Only replace the public projection after a complete successful trusted remote traversal.
    const entries=await this.archive.list();
    for(const {record} of entries)if(record.certification){
      const {proof,salt}=record.certification;checkInput({request:proof.request,level:record.level,salt});
      const observed=await this.registry.read(proof.request);
      const identityMatches=observed&&observed.mode===proof.mode&&(proof.mode==='cli-simulation'?observed.mode==='cli-simulation'&&observed.receiptId===proof.receiptId&&observed.workflowHash===proof.workflowHash:observed.mode!=='cli-simulation'&&observed.registry.toLowerCase()===proof.registry.toLowerCase());
      if(!observed||!observed.valid||observed.steps!==proof.steps||!identityMatches)throw new LevelError(503,'Could not confirm an archived CRE verification. Check verification configuration and the private receipts.');
    }
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
    if(id){this.get(ownerId,id);if(this.frozen(id))throw new LevelError(409,'This submission is locked. Published levels cannot be edited.');if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1)throw new LevelError(400,'Missing draft revision.');const result=this.db.prepare('UPDATE custom_levels SET draft=?,owner_name=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(JSON.stringify(level),ownerName,now,id,ownerId,revision);if(!result.changes)throw new LevelError(409,'This draft changed in another tab. Reload it from My levels before saving.');}
    else {
      id=createId??randomUUID();const prior=this.row(id);
      if(prior){if(prior.owner_id===ownerId&&this.frozen(id))throw new LevelError(409,'This submission is locked. Published levels cannot be edited.');if(prior.owner_id!==ownerId||prior.draft!==JSON.stringify(level)||prior.revision!==1)throw new LevelError(409,'This draft identifier is already in use. Reload it from My levels.');}
      else {const count=this.db.prepare('SELECT COUNT(*) AS n FROM custom_levels WHERE owner_id=?').get(ownerId)!;if(Number(count.n)>=100)throw new LevelError(409,'Your account has reached the 100-draft limit.');this.db.prepare('INSERT INTO custom_levels(id,owner_id,owner_name,draft,revision,updated_at) VALUES(?,?,?,?,1,?)').run(id,ownerId,ownerName,JSON.stringify(level),now);}
    }
    const row=this.row(id)!,record:ArchiveRecord={id,revision:row.revision,category:'draft',ownerId,ownerName,updatedAt:row.updated_at,level};
    this.project({record,ref:await this.archive.put(record)});return this.get(ownerId,id);
  });}
  private submission(id:string){return this.db.prepare('SELECT * FROM certification_submissions WHERE level_id=? ORDER BY rowid DESC LIMIT 1').get(id) as unknown as SubmissionRow|undefined;}
  private frozen(id:string){const submission=this.submission(id);return !!this.row(id)?.published_revision||!!this.db.prepare('SELECT 1 FROM level_locks WHERE level_id=?').get(id)||!!submission&&submission.status!=='rejected';}
  private certificationInfo(id:string):CertificationInfo|undefined {
    const row=this.submission(id);if(!row){
      const archived=this.db.prepare("SELECT record FROM level_publications WHERE record_id=? AND category IN ('community','campaign') ORDER BY rowid DESC LIMIT 1").get(id);
      const record=archived?JSON.parse(String(archived.record)) as ArchiveRecord:undefined,proof=record?.certification?.proof;
      if(!proof)return;return {id:proof.request.id,status:'published',target:proof.request.target,submittedAt:record!.updatedAt,mode:proof.mode,message:'Published. This level is permanently read-only.',proof};
    }const proof=row.proof?JSON.parse(row.proof) as CertificationProof:undefined;
    return {id:row.id as `0x${string}`,status:row.status,target:row.target,submittedAt:row.submitted_at,mode:proof?.mode??this.registry.mode,
      message:row.status==='published'?'Published. This level is permanently read-only.':row.status==='rejected'?'The submitted solution was rejected. Correct the draft and submit again.':row.status==='approved'?'Verification confirmed. Arkiv publication is pending.':row.error??(this.registry.mode==='unconfigured'?'Waiting for CRE configuration. Your submitted level is locked.':this.registry.mode==='cli-simulation'?'Queued for CRE CLI simulation. Your submitted level is locked.':'Waiting for CRE verification.'),...(proof?{proof}:{})};
  }
  publish(ownerId:string,id:string,revision:number,target:'community'|'campaign'='community'):Promise<StoredLevel>{return this.serial(async()=>{
    const draft=this.get(ownerId,id),prior=this.submission(id);
    if(prior&&prior.status!=='rejected'){
      if(prior.revision!==revision||prior.target!==target)throw new LevelError(409,'This frozen submission cannot be changed.');
      await this.reconcileSubmission(prior);return this.get(ownerId,id);
    }
    if(this.frozen(id))throw new LevelError(409,'Published levels are permanently read-only.');
    if(draft.revision!==revision)throw new LevelError(409,'Save and reload the current draft before submitting.');
    const check=verifySolution(draft.level);if(!check.valid)throw new LevelError(422,check.message);
    if(draft.archivedRevision!==revision)throw new LevelError(409,'This draft has not been confirmed on Arkiv. Reload it and save before submitting.');
    const archived=this.db.prepare("SELECT ref FROM level_publications WHERE category='draft' AND record_id=? AND revision=? ORDER BY rowid DESC LIMIT 1").get(id,revision);
    if(!archived)throw new LevelError(409,'Confirmed encrypted draft unavailable.');
    const draftRef=JSON.parse(String(archived.ref)) as ArchiveRef;
    const reservations=this.db.prepare("SELECT payload FROM certification_submissions WHERE target='campaign'").all().map(row=>(JSON.parse(String(row.payload)) as SubmissionPayload).publication.campaignSlot??0);
    const slot=Math.max(0,...this.campaign().map(c=>c.slot),...reservations)+1,now=Date.now();
    const level={...draft.level,...(target==='campaign'?{id:slot}:{})},salt=('0x'+randomBytes(32).toString('hex')) as `0x${string}`,submissionId=('0x'+randomBytes(32).toString('hex')) as `0x${string}`;
    const request={id:submissionId,levelId:id,target,draftKey:draftRef.entityKey as `0x${string}`,levelHash:levelHash(level),witnessCommitment:witnessCommitment(level,salt),rulesHash:RULES_HASH};
    const publication:ArchiveRecord={id,revision,category:target,ownerId,ownerName:draft.ownerName,updatedAt:now,...(target==='campaign'?{campaignSlot:slot}:{lifetimeDays:2 as const}),level};
    const payload:SubmissionPayload={input:{request,level,salt},draftRef,publication};
    this.db.prepare("INSERT INTO certification_submissions(id,level_id,revision,target,status,submitted_at,payload) VALUES(?,?,?,?,'pending',?,?)").run(submissionId,id,revision,target,now,JSON.stringify(payload));
    await this.reconcileSubmission(this.submission(id)!);return this.get(ownerId,id);
  });}
  /** Operator-only HTTP adapter calls this; no session endpoint exposes witnesses. */
  async verificationInput(id:string):Promise<VerificationInput>{
    const row=this.db.prepare("SELECT * FROM certification_submissions WHERE id=? AND status='pending'").get(id) as unknown as SubmissionRow|undefined;
    if(!row)throw new LevelError(404,'Pending submission unavailable.');const payload=JSON.parse(row.payload) as SubmissionPayload;
    const record=await this.archive.read(payload.draftRef),level={...record.level,id:payload.input.level.id};
    if(record.id!==row.level_id||record.revision!==row.revision||canonicalJSON(level)!==canonicalJSON(payload.input.level))throw new LevelError(503,'The archived submission differs from its frozen input.');
    checkInput(payload.input);return payload.input;
  }
  pendingCertifications(){return (this.db.prepare("SELECT payload FROM certification_submissions WHERE status='pending' ORDER BY rowid LIMIT 10").all()).map(row=>(JSON.parse(String(row.payload)) as SubmissionPayload).input.request);}
  verificationRequest(id:string){const row=this.db.prepare("SELECT payload FROM certification_submissions WHERE id=? AND status='pending'").get(id);if(!row)throw new LevelError(404,'Pending submission unavailable.');return (JSON.parse(String(row.payload)) as SubmissionPayload).input.request;}
  refreshCertification(ownerId:string,id:string){return this.serial(async()=>{this.get(ownerId,id);const row=this.submission(id);if(row)await this.reconcileSubmission(row,true);return this.get(ownerId,id);});}
  private async reconcileSubmission(row:SubmissionRow,execute=false){
    if(this.closed||row.status==='rejected'||row.status==='published')return;
    const payload=JSON.parse(row.payload) as SubmissionPayload;
    try{
      let proof=row.proof?JSON.parse(row.proof) as CertificationProof:null;
      if(row.status==='pending'){
        proof=await this.registry.read(payload.input.request);
        if(!proof&&execute&&this.registry.verify)proof=await this.registry.verify(payload.input.request);
        if(!proof)return;
        if(!validProof(proof)||requestHash(proof.request)!==requestHash(payload.input.request)||proof.mode!==this.registry.mode)throw new Error('Certificate mismatch.');
        const replay=verifySolution(payload.input.level);if(proof.valid&&(!replay.valid||proof.steps!==replay.step))throw new Error('Winning turn mismatch.');
        if(this.closed)return;
        this.db.prepare('UPDATE certification_submissions SET status=?,proof=?,error=NULL WHERE id=?').run(proof.valid?'approved':'rejected',JSON.stringify(proof),row.id);
        if(!proof.valid)return;
      }
      if(!proof?.valid)return;
      if(proof.mode!==this.registry.mode)throw new Error('The verification mode changed before publication.');
      const record={...payload.publication,certification:{proof,salt:payload.input.salt}};
      const ref=await this.archive.put(record);if(this.closed)return;this.project({record,ref});
      this.db.prepare("UPDATE certification_submissions SET status='published',error=NULL WHERE id=?").run(row.id);
    }catch{if(!this.closed)this.db.prepare('UPDATE certification_submissions SET error=? WHERE id=?').run('Verification or publication is temporarily unavailable. Retry this same submission.',row.id);}
  }
  async flushCertifications(){
    // Rotate bounded batches so an unavailable certificate cannot starve later submissions.
    let rows=this.db.prepare("SELECT rowid AS cursor,id FROM certification_submissions WHERE status IN ('pending','approved') AND rowid>? ORDER BY rowid LIMIT 2").all(this.certificationCursor);
    if(!rows.length){this.certificationCursor=0;rows=this.db.prepare("SELECT rowid AS cursor,id FROM certification_submissions WHERE status IN ('pending','approved') ORDER BY rowid LIMIT 2").all();}
    for(const row of rows){if(this.closed)return;this.certificationCursor=Number(row.cursor);await this.serial(async()=>{const current=this.db.prepare('SELECT * FROM certification_submissions WHERE id=?').get(row.id) as unknown as SubmissionRow|undefined;if(current)await this.reconcileSubmission(current,true);});}
  }
  private latest(category:'community'|'campaign',id?:string){const rows=this.db.prepare('SELECT record,ref FROM level_publications WHERE category=?'+(id?' AND record_id=?':'')+' ORDER BY revision DESC').all(...(id?[category,id]:[category]));const seen=new Set<string>();return rows.flatMap(row=>{const record=JSON.parse(String(row.record)) as ArchiveRecord;if(seen.has(record.id))return [];seen.add(record.id);const ref=JSON.parse(String(row.ref)) as ArchiveRef;if(BigInt(ref.expiresAt)<=this.observedHead)return [];return [{record,ref}];});}
  campaign():CampaignSummary[]{return this.latest('campaign').map(({record:r,ref})=>({id:r.id,name:r.level.name,subtitle:r.level.subtitle,ownerName:r.ownerName,revision:r.revision,publishedRevision:r.revision,updatedAt:r.updatedAt,width:r.level.width,height:r.level.height,totalSteps:r.level.totalSteps,slot:r.campaignSlot!,entityKey:ref.entityKey,verification:r.certification?.proof.mode??('legacy' as const)})).sort((a,b)=>a.slot-b.slot);}
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
  async template(accountId:string,id:string,admin:boolean){const entry=this.latest('campaign',id)[0];if(!entry)throw new LevelError(404,'Campaign chamber unavailable.');if(entry.record.certification)throw new LevelError(403,'Certified levels are view-only and cannot be copied into the editor.');if(!admin&&!this.canReveal(accountId,entry.ref.entityKey))throw new LevelError(403,'Complete this campaign revision before using it as an editable template.');return (await this.archive.read(entry.ref)).level;}
  async refreshAvailability(){if(Date.now()-this.availabilityAt<10_000)return;this.observedHead=await this.archive.head?.()??0n;this.availabilityAt=Date.now();}
  runs(levelId:string,role:1|2){
    const snapshot=this.forPlay(levelId);if(!snapshot?.ref)throw new LevelError(404,'Published chamber unavailable.');
    return this.db.prepare("SELECT id,record,ref FROM game_runs WHERE status='confirmed' ORDER BY rowid DESC").all().flatMap(row=>{
      const record=JSON.parse(String(row.record)) as ArchiveRecord,ref=JSON.parse(String(row.ref)) as ArchiveRef;
      if(record.run?.levelKey!==snapshot.ref!.entityKey||record.run.role!==role||BigInt(ref.expiresAt)<=this.observedHead)return [];
      return [{id:String(row.id),name:record.ownerName,role,turns:record.level.solutionP1.length,mode:record.run.mode,createdAt:record.updatedAt,entityKey:ref.entityKey,expiresAt:ref.expiresAt}];
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
    try{const record=JSON.parse(String(row.record)) as ArchiveRecord;const ref=await this.archive.put(record);if(!this.closed)this.project({record,ref});return 'confirmed' as const;}
    catch(error){if(!this.closed)this.db.prepare("UPDATE game_runs SET error=? WHERE id=?").run(error instanceof ArchiveError?error.message:'Arkiv run publication is pending.',id);return 'pending' as const;}
  });}
  async flushRuns(){for(const row of this.db.prepare("SELECT id FROM game_runs WHERE status='pending' ORDER BY rowid LIMIT 4").all()){if(this.closed)return;const status=await this.publishRun(String(row.id));if(status!=='confirmed')break;}}
  async drain(){await this.queue;}
  close(){this.closed=true;this.db.close();this.archive.close();this.registry.close?.();}
}
