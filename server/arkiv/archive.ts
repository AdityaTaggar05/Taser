import type {LevelConfig} from '../../src/core/types';
export type LevelCategory='draft'|'community'|'campaign';
export interface ArchiveRecord {
  id:string; revision:number; category:LevelCategory; ownerId:string; ownerName:string;
  updatedAt:number; campaignSlot?:number; level:LevelConfig;
}
export interface ArchiveRef {entityKey:string;txHash:string;expiresAt:string}
export interface ArchivedLevel {record:ArchiveRecord;ref:ArchiveRef}
export interface LevelArchive {
  readonly mode:'arkiv'|'test'|'unconfigured';
  list():Promise<ArchivedLevel[]>;
  put(record:ArchiveRecord):Promise<ArchiveRef>;
  read(ref:ArchiveRef):Promise<ArchiveRecord>;
  close():void;
}
export class ArchiveError extends Error {constructor(readonly status:number,message:string){super(message);}}
/** Explicit deterministic test adapter; the application never selects it as a fallback. */
export class MemoryArchive implements LevelArchive {
  readonly mode='test';readonly entries=new Map<string,ArchivedLevel>();
  async list(){return structuredClone([...this.entries.values()]);}
  async put(record:ArchiveRecord){const key=`${record.category}:${record.id}:${record.revision}`;
    const existing=this.entries.get(key);if(existing){if(JSON.stringify(existing.record)!==JSON.stringify(record))throw new ArchiveError(409,'Archive revision conflict.');return existing.ref;}
    const ref={entityKey:'0x'+crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),txHash:'test-only',expiresAt:'999999999'};this.entries.set(key,structuredClone({record,ref}));return ref;}
  async read(ref:ArchiveRef){const found=[...this.entries.values()].find(e=>e.ref.entityKey===ref.entityKey);if(!found)throw new ArchiveError(503,'Archived level unavailable.');return structuredClone(found.record);}
  close(){}
}
export class UnconfiguredArchive implements LevelArchive {
  readonly mode='unconfigured';
  private fail():never{throw new ArchiveError(503,'Arkiv storage is not configured. Complete npm run arkiv:setup and configure write budgets.');}
  async list():Promise<ArchivedLevel[]>{return [];}
  async put():Promise<ArchiveRef>{return this.fail();}
  async read():Promise<ArchiveRecord>{return this.fail();}
  close(){}
}
