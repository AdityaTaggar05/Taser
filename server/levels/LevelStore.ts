import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {cleanDraft} from '../../src/core/levelValidation';
import {verifySolution} from '../../src/editor/solution';
import type {LevelConfig} from '../../src/core/types';
import type {LevelSummary,StoredLevel} from '../../src/editor/types';
export class LevelError extends Error {constructor(readonly status:number,message:string){super(message);}}
interface Row {id:string;owner_id:string;owner_name:string;draft:string;revision:number;published:string|null;published_revision:number|null;updated_at:number}
/** Persistence boundary: published snapshots never change when an author saves a draft. */
export class LevelStore {
  private db:DatabaseSync;
  constructor(path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS custom_levels(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,owner_name TEXT NOT NULL,draft TEXT NOT NULL,revision INTEGER NOT NULL,published TEXT,published_revision INTEGER,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS custom_levels_owner ON custom_levels(owner_id);`);}
  private row(id:string){return this.db.prepare('SELECT * FROM custom_levels WHERE id=?').get(id) as unknown as Row|undefined;}
  private summary(row:Row,published=false):LevelSummary {const level=JSON.parse(published?row.published!:row.draft) as LevelConfig;return {id:row.id,name:level.name,subtitle:level.subtitle,ownerName:row.owner_name,revision:row.revision,publishedRevision:row.published_revision,updatedAt:row.updated_at,width:level.width,height:level.height,totalSteps:level.totalSteps};}
  list(ownerId:string):LevelSummary[]{return (this.db.prepare('SELECT * FROM custom_levels WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').all(ownerId) as unknown as Row[]).map(row=>this.summary(row));}
  community():LevelSummary[]{return (this.db.prepare('SELECT * FROM custom_levels WHERE published IS NOT NULL ORDER BY updated_at DESC LIMIT 100').all() as unknown as Row[]).map(row=>this.summary(row,true));}
  get(ownerId:string,id:string):StoredLevel {const row=this.row(id);if(!row||row.owner_id!==ownerId)throw new LevelError(404,'Draft not found in your account.');return {...this.summary(row),level:JSON.parse(row.draft)};}
  save(ownerId:string,ownerName:string,value:unknown,id?:string,revision?:number):StoredLevel {
    const level=cleanDraft(value),now=Date.now();
    if(id){this.get(ownerId,id);if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1)throw new LevelError(400,'Missing draft revision.');const result=this.db.prepare('UPDATE custom_levels SET draft=?,owner_name=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(JSON.stringify(level),ownerName,now,id,ownerId,revision!);if(!result.changes)throw new LevelError(409,'This draft changed in another tab. Reload it from My levels before saving.');}
    else{const count=this.db.prepare('SELECT COUNT(*) AS n FROM custom_levels WHERE owner_id=?').get(ownerId)!;if(Number(count.n)>=100)throw new LevelError(409,'Your account has reached the 100-draft limit.');id=randomUUID();this.db.prepare('INSERT INTO custom_levels(id,owner_id,owner_name,draft,revision,updated_at) VALUES(?,?,?,?,1,?)').run(id,ownerId,ownerName,JSON.stringify(level),now);}
    return this.get(ownerId,id);
  }
  publish(ownerId:string,id:string,revision:number):StoredLevel {
    const draft=this.get(ownerId,id);if(draft.revision!==revision)throw new LevelError(409,'Save and reload the current draft before publishing.');
    const check=verifySolution(draft.level);if(!check.valid)throw new LevelError(422,check.message);
    const result=this.db.prepare('UPDATE custom_levels SET published=draft,published_revision=revision,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(Date.now(),id,ownerId,revision);if(!result.changes)throw new LevelError(409,'Draft changed during verification. Save and publish again.');return this.get(ownerId,id);
  }
  published(id:string):{level:LevelConfig;revision:number}|null {const row=this.row(id);return row?.published?{level:JSON.parse(row.published),revision:row.published_revision!}:null;}
  close(){this.db.close();}
}
