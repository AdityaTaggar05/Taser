import type {DatabaseSync} from 'node:sqlite';
import {ArchiveError,type ArchiveWrite,type LevelArchive,type ArchiveRef,type MoveRecord} from './archive';
import {canonicalJSON} from './canonical';
import type {MoveSequenceFeed,PairedMove,ArkivActivity,ArkivFeed} from '../../src/network/arkiv';
interface Row {id:string;record:string;audience:string;label:string;state:ArkivActivity['state'];ref:string|null;error:string|null}
/** Durable private outbox. The archive remains responsible for signing and reconciliation. */
export class ActivityStore {
  constructor(private db:DatabaseSync,private archive:LevelArchive){db.exec(`CREATE TABLE IF NOT EXISTS arkiv_activity(id TEXT PRIMARY KEY,record TEXT NOT NULL,audience TEXT NOT NULL,label TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',ref TEXT,error TEXT);`);}
  enqueue(record:ArchiveWrite,audience:string[],label:string){
    const id=`${record.category}:${record.id}:${record.revision}`;
    this.db.prepare('INSERT OR IGNORE INTO arkiv_activity(id,record,audience,label) VALUES(?,?,?,?)').run(id,JSON.stringify(record),JSON.stringify(audience),label);
    return id;
  }
  async publish(id:string):Promise<ArchiveRef>{
    const row=this.db.prepare('SELECT * FROM arkiv_activity WHERE id=?').get(id) as unknown as Row;
    if(row.ref)return JSON.parse(row.ref) as ArchiveRef;
    // Always reuse the original frozen intent, including its timestamp and encryption routing.
    const record=JSON.parse(row.record) as ArchiveWrite;
    this.db.prepare("UPDATE arkiv_activity SET state='pending',error=NULL WHERE id=?").run(id);
    try{const ref=await this.archive.put(record);this.db.prepare("UPDATE arkiv_activity SET state='confirmed',ref=?,error=NULL WHERE id=?").run(JSON.stringify(ref),id);return ref;}
    catch(error){
      const status=this.archive.writeStatus?.(record);
      const state=status?.txHash&&status.state!=='failed'?'pending':'failed';
      this.db.prepare('UPDATE arkiv_activity SET state=?,error=? WHERE id=?').run(state,error instanceof ArchiveError?error.message:'Archive unavailable. Publication will be retried.',id);
      throw error;
    }
  }
  pendingMoves(){return this.db.prepare("SELECT id FROM arkiv_activity WHERE id LIKE 'move:%' AND ref IS NULL ORDER BY rowid LIMIT 4").all().map(r=>String(r.id));}
  async moves(accountId:string,sessionId:string,sequences:number[]):Promise<MoveSequenceFeed>{
    if(!sequences.length)return {storage:this.archive.mode,moves:[]};
    const rows=this.db.prepare(`SELECT a.* FROM arkiv_activity a WHERE json_extract(a.record,'$.category')='move'
      AND json_extract(a.record,'$.move.sessionId')=? AND json_extract(a.record,'$.move.sequence') IN (${sequences.map(()=>'?').join(',')})
      AND EXISTS (SELECT 1 FROM json_each(a.audience) WHERE value=?) ORDER BY json_extract(a.record,'$.move.sequence') LIMIT 32`)
      .all(sessionId,...sequences,accountId) as unknown as Row[];
    const confirmed=rows.filter(row=>!!row.ref),found=await this.archive.queryMoves(confirmed.map(row=>JSON.parse(row.record) as MoveRecord));
    return {storage:this.archive.mode,moves:rows.map(row=>{
      const record=JSON.parse(row.record) as MoveRecord,status=this.archive.writeStatus?.(record),ref=row.ref?JSON.parse(row.ref) as ArchiveRef:undefined;
      const remote=found.find(entry=>entry.record.id===record.id);
      if(remote&&(remote.ref.entityKey!==ref?.entityKey||canonicalJSON(remote.record)!==canonicalJSON(record)))throw new ArchiveError(503,'Move evidence differs from the recorded turn.');
      const state:PairedMove['state']=ref?(remote?'confirmed':'unavailable'):status?.state==='failed'||row.state==='failed'?'failed':'pending';
      return {sequence:record.move.sequence,turn:record.move.turn,state,...(remote?{inputs:remote.record.move.inputs}:{}),
        ...(ref?.txHash||status?.txHash?{txHash:ref?.txHash||status?.txHash}:{}),...(ref?{entityKey:ref.entityKey}:{})};
    })};
  }
  feed(accountId:string):ArkivFeed {
    // Audience lookup is enforced in SQLite, before limiting; another user's activity never crosses the API boundary.
    const rows=this.db.prepare('SELECT a.* FROM arkiv_activity a WHERE EXISTS (SELECT 1 FROM json_each(a.audience) WHERE value=?) ORDER BY a.rowid DESC LIMIT 60').all(accountId) as unknown as Row[];
    return {storage:this.archive.mode,activities:rows.map(row=>{
      const record=JSON.parse(row.record) as ArchiveWrite,ref=row.ref?JSON.parse(row.ref) as ArchiveRef:undefined,status=this.archive.writeStatus?.(record);
      return {id:row.id,kind:record.category,label:row.label,createdAt:record.updatedAt,state:ref?'confirmed':status?.state==='confirmed'?'confirmed':status?.state==='failed'?'failed':row.state,
        txHash:ref?.txHash||status?.txHash,entityKey:ref?.entityKey||status?.entityKey,...(!ref&&status?.state!=='confirmed'&&row.error?{message:row.error}:{})};
    })};
  }
}
