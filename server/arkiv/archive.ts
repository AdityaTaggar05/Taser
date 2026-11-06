import type {LevelConfig} from '../../src/core/types';
export type LevelCategory='draft'|'community'|'campaign'|'run';
export interface ArchiveRecord {
  id:string; revision:number; category:LevelCategory; ownerId:string; ownerName:string;
  updatedAt:number; campaignSlot?:number; level:LevelConfig; lifetimeDays?:2;
  run?:{levelKey:string;role:1|2;mode:'coop'|'solo';source:string};
}
export interface MoveRecord {
  id:string;revision:1;category:'move';ownerId:string;ownerName:string;updatedAt:number;lifetimeDays:2;
  move:{levelKey:string;sessionId:string;turn:number;sequence:number;mode:'coop'|'solo';inputs:[import('../../src/core/types').Direction,import('../../src/core/types').Direction]};
}
export type ArchiveWrite=ArchiveRecord|MoveRecord;
export interface WriteStatus {state:'pending'|'confirmed'|'failed';txHash?:string;entityKey?:string}
export interface ArchiveRef {entityKey:string;txHash:string;expiresAt:string}
export interface ArchivedMove {record:MoveRecord;ref:ArchiveRef}
export interface ArchivedLevel {record:ArchiveRecord;ref:ArchiveRef}
export interface LevelArchive {
  readonly mode:'arkiv'|'test'|'unconfigured';
  list():Promise<ArchivedLevel[]>;
  put(record:ArchiveWrite):Promise<ArchiveRef>;
  queryMoves(records:MoveRecord[]):Promise<ArchivedMove[]>;
  writeStatus?(record:ArchiveWrite):WriteStatus|undefined;
  read(ref:ArchiveRef):Promise<ArchiveRecord>;
  head?():Promise<bigint>;
  close():void;
}
export class ArchiveError extends Error {constructor(readonly status:number,message:string){super(message);}}
/** Explicit deterministic test adapter; the application never selects it as a fallback. */
export class MemoryArchive implements LevelArchive {
  readonly mode='test';head?:()=>Promise<bigint>;readonly entries=new Map<string,{record:ArchiveWrite;ref:ArchiveRef}>();
  async list(){return structuredClone([...this.entries.values()].filter((e):e is ArchivedLevel=>e.record.category!=='move'));}
  async put(record:ArchiveWrite){const key=`${record.category}:${record.id}:${record.revision}`;
    const existing=this.entries.get(key);if(existing){if(JSON.stringify(existing.record)!==JSON.stringify(record))throw new ArchiveError(409,'Archive revision conflict.');return existing.ref;}
    const ref={entityKey:'0x'+crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),txHash:'test-only',expiresAt:'999999999'};this.entries.set(key,structuredClone({record,ref}));return ref;}
  async queryMoves(records:MoveRecord[]){const ids=new Set(records.map(r=>r.id));return structuredClone([...this.entries.values()].filter((e):e is ArchivedMove=>e.record.category==='move'&&ids.has(e.record.id)));}
  async read(ref:ArchiveRef){const found=[...this.entries.values()].find(e=>e.ref.entityKey===ref.entityKey);if(!found||found.record.category==='move')throw new ArchiveError(503,'Archived level unavailable.');return structuredClone(found.record);}
  close(){}
}
export class UnconfiguredArchive implements LevelArchive {
  readonly mode='unconfigured';
  private fail():never{throw new ArchiveError(503,'Arkiv storage is not configured. Complete npm run arkiv:setup and configure write budgets.');}
  async list():Promise<ArchivedLevel[]>{return [];}
  async queryMoves():Promise<ArchivedMove[]>{return this.fail();}
  async put():Promise<ArchiveRef>{return this.fail();}
  async read():Promise<ArchiveRecord>{return this.fail();}
  close(){}
}
