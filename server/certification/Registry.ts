import {createPublicClient,http,zeroAddress,type Hex} from 'viem';
import {sepolia} from 'viem/chains';
import {registryAbi,requestHash,type CertificationRequest,type CertificationProof,type CertificationMode} from '../../src/certification/model';
export interface CertificationRegistry {readonly mode:CertificationMode|'unconfigured';read(request:CertificationRequest):Promise<CertificationProof|null>}
export class UnconfiguredRegistry implements CertificationRegistry {readonly mode='unconfigured';async read(_request:CertificationRequest){return null;}}
export class SepoliaRegistry implements CertificationRegistry {
  private client;
  constructor(readonly mode:'simulation'|'don',private address:Hex,rpc:string){this.client=createPublicClient({chain:sepolia,transport:http(rpc,{retryCount:0,timeout:15_000}),cacheTime:0});}
  async read(request:CertificationRequest):Promise<CertificationProof|null>{
    if(await this.client.getChainId()!==sepolia.id)throw new Error('Certification network mismatch.');
    const block=this.mode==='don'?await this.client.getBlock({blockTag:'finalized'}):await this.client.getBlock({blockNumber:BigInt(Math.max(0,Number(await this.client.getBlockNumber())-2))});
    const args={address:this.address,abi:registryAbi,blockNumber:block.number} as const;
    const simulated=await this.client.readContract({...args,functionName:'simulation'});if(simulated!==(this.mode==='simulation'))throw new Error('Certification environment mismatch.');
    const [commitment,valid,steps,exists]=await this.client.readContract({...args,functionName:'certifications',args:[request.id]});
    if(!exists)return null;if(commitment!==requestHash(request))throw new Error('Certificate commitment mismatch.');
    return {request,mode:this.mode,chainId:sepolia.id,registry:this.address,blockNumber:block.number.toString(),valid,steps};
  }
}
export function configuredRegistry():CertificationRegistry {
  const mode=process.env.CRE_MODE??'unconfigured';if(mode==='unconfigured')return new UnconfiguredRegistry();
  if(!['simulation','don'].includes(mode)||!/^0x[a-fA-F0-9]{40}$/.test(process.env.CRE_REGISTRY_ADDRESS??'')||process.env.CRE_REGISTRY_ADDRESS===zeroAddress||!process.env.CRE_SEPOLIA_RPC_URL)throw new Error('Complete CRE_MODE, CRE_REGISTRY_ADDRESS and CRE_SEPOLIA_RPC_URL.');
  return new SepoliaRegistry(mode as 'simulation'|'don',process.env.CRE_REGISTRY_ADDRESS as Hex,process.env.CRE_SEPOLIA_RPC_URL);
}
