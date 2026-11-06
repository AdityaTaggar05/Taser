import type {DatabaseSync} from 'node:sqlite';
import {ArchiveError,type ArchiveWrite,type LevelArchive,type ArchiveRef} from './archive';
import type {ArkivActivity,ArkivFeed} from '../../src/network/arkiv';
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
