import type {CertificationRegistry} from '../server/certification/Registry';
import type {CertificationRequest,CertificationProof} from '../src/certification/model';
/** Explicit test injection, never selected by the application. */
export class ImmediateTestRegistry implements CertificationRegistry {
  readonly mode='test';
  async read(request:CertificationRequest):Promise<CertificationProof>{return {request,mode:'test',chainId:11155111,registry:'0x1111111111111111111111111111111111111111',blockNumber:'100',valid:true,steps:8};}
}
