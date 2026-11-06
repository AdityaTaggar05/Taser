import type {LevelConfig} from '../../src/core/types';
import {creationExpiration,HEART_EXTENSION} from './expiration';
export type LevelCategory='draft'|'community'|'campaign'|'run';
export interface ArchiveRecord {
  id:string; revision:number; category:LevelCategory; ownerId:string; ownerName:string;
  updatedAt:number; campaignSlot?:number; level:LevelConfig; lifetimeDays?:2;
  run?:{levelKey:string;role:1|2;mode:'coop'|'solo';source:string};
}
export interface ArchiveRef {entityKey:string;txHash:string;expiresAt:string}
export interface ArchivedLevel {record:ArchiveRecord;ref:ArchiveRef}
export interface LevelArchive {
  readonly mode:'arkiv'|'test'|'unconfigured';
  list():Promise<ArchivedLevel[]>;
  put(record:ArchiveRecord):Promise<ArchiveRef>;
  read(ref:ArchiveRef):Promise<ArchiveRecord>;
  inspect(ref:ArchiveRef):Promise<ArchivedLevel>;
  extend(ref:ArchiveRef,accountId:string):Promise<ArchiveRef>;
  head?():Promise<bigint>;
  close():void;
}
export class ArchiveError extends Error {constructor(readonly status:number,message:string){super(message);}}
/** Explicit deterministic test adapter; the application never selects it as a fallback. */
export class MemoryArchive implements LevelArchive {
  readonly mode='test';head?:()=>Promise<bigint>;readonly entries=new Map<string,ArchivedLevel>();
  private hearts=new Map<string,ArchiveRef>();
  async list(){return structuredClone([...this.entries.values()]);}
  async put(record:ArchiveRecord){const key=`${record.category}:${record.id}:${record.revision}`;
    const existing=this.entries.get(key);if(existing){if(JSON.stringify(existing.record)!==JSON.stringify(record))throw new ArchiveError(409,'Archive revision conflict.');return existing.ref;}
    const ref={entityKey:'0x'+crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),txHash:'test-only',expiresAt:((await this.head?.()??0n)+creationExpiration(record).minLifetime).toString()};this.entries.set(key,structuredClone({record,ref}));return ref;}
  async inspect(ref:ArchiveRef){const found=[...this.entries.values()].find(e=>e.ref.entityKey===ref.entityKey);if(!found)throw new ArchiveError(503,'Archived level unavailable.');if(BigInt(found.ref.expiresAt)<= (await this.head?.()??0n))throw new ArchiveError(410,'This publication has expired.');return structuredClone(found);}
  async read(ref:ArchiveRef){return (await this.inspect(ref)).record;}
  async extend(ref:ArchiveRef,accountId:string){const operation=ref.entityKey+':'+accountId,prior=this.hearts.get(operation);if(prior)return structuredClone(prior);const live=await this.inspect(ref);live.ref.expiresAt=(BigInt(live.ref.expiresAt)+HEART_EXTENSION.minLifetime).toString();const entry=[...this.entries.values()].find(e=>e.ref.entityKey===ref.entityKey)!;entry.ref=live.ref;this.hearts.set(operation,structuredClone(live.ref));return live.ref;}
  close(){}
}
export class UnconfiguredArchive implements LevelArchive {
  readonly mode='unconfigured';
  private fail():never{throw new ArchiveError(503,'Arkiv storage is not configured. Complete npm run arkiv:setup and configure write budgets.');}
  async list():Promise<ArchivedLevel[]>{return [];}
  async put():Promise<ArchiveRef>{return this.fail();}
  async read():Promise<ArchiveRecord>{return this.fail();}
  async inspect():Promise<ArchivedLevel>{return this.fail();}
  async extend():Promise<ArchiveRef>{return this.fail();}
  close(){}
}
