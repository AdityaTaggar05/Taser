import {importKey,encryptBytes,decryptBytes,CONTENT_TYPE} from 'arkiv-encryption';
import {cleanDraft} from '../../src/core/levelValidation';
import {verifySolution} from '../../src/editor/solution';
import {ArchiveError,type ArchiveRecord} from './archive';
export {CONTENT_TYPE};
/** The encrypted envelope binds its public routing fields; no solution digest is published. */
export class LevelCipher {
  private key:Promise<CryptoKey>;
  constructor(rawKey:string,readonly namespace:string){this.key=importKey(rawKey);}
  async encrypt(record:ArchiveRecord){return encryptBytes(await this.key,JSON.stringify({format:1,chainId:7794095,namespace:this.namespace,record}));}
  async decrypt(ciphertext:Uint8Array,expected:{id:string;revision:number;category:string}):Promise<ArchiveRecord>{
    try {
      const bytes=await decryptBytes(await this.key,ciphertext);
      const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      const r=envelope.record as ArchiveRecord;
      if(envelope.format!==1||envelope.chainId!==7794095||envelope.namespace!==this.namespace||
        !r||r.id!==expected.id||r.revision!==expected.revision||r.category!==expected.category||
        !['draft','community','campaign'].includes(r.category)||!Number.isSafeInteger(r.revision)||r.revision<1||
        typeof r.ownerId!=='string'||r.ownerId.length>128||typeof r.ownerName!=='string'||r.ownerName.length>128||
        !Number.isSafeInteger(r.updatedAt)||r.updatedAt<0||
        (r.category==='campaign'&&(!Number.isSafeInteger(r.campaignSlot)||r.campaignSlot!<1)))throw new Error();
      const level=cleanDraft(r.level);
      if(r.category!=='draft'&&!verifySolution(level).valid)throw new Error();
      return {id:r.id,revision:r.revision,category:r.category,ownerId:r.ownerId,ownerName:r.ownerName,updatedAt:r.updatedAt,
        ...(r.category==='campaign'?{campaignSlot:r.campaignSlot}:{}),level};
    }catch{throw new ArchiveError(503,'Encrypted level failed authentication or validation.');}
  }
}
