import {cre,Runner,HTTPClient,EVMClient,consensusIdenticalAggregation,encodeCallMsg,LAST_FINALIZED_BLOCK_NUMBER,LATEST_BLOCK_NUMBER,prepareReportRequest,type Runtime,type NodeRuntime,type HTTPPayload} from '@chainlink/cre-sdk';
import {encodeFunctionData,decodeFunctionResult,encodeAbiParameters,bytesToHex,zeroAddress,type Hex} from 'viem';
import {hash32,registryAbi} from '../../src/certification/model';
import {assessSubmission} from './verify';
interface Config {apiBase:string;registry:Hex;mode:'simulation'|'don';authorizedKeys:Array<{type:'KEY_TYPE_ECDSA_EVM';publicKey:string}>}
function replay(node:NodeRuntime<Config>,id:string,commitment:string,token:string):string {
  const response=new HTTPClient().sendRequest(node,{url:node.config.apiBase+'/api/cre/submissions/'+id,method:'GET',headers:{Authorization:'Bearer '+token},cacheSettings:{store:false,maxAge:'0s'}}).result();
  if(response.statusCode!==200||response.body.length>96_000)throw new Error('Verification input unavailable.');
  const input:unknown=JSON.parse(new TextDecoder().decode(response.body));
  return JSON.stringify(assessSubmission(input,commitment,id));
}
const handle=(runtime:Runtime<Config>,payload:HTTPPayload):string=>{
  const {submissionId}=JSON.parse(new TextDecoder().decode(payload.input)) as {submissionId:unknown};
  if(!hash32(submissionId))throw new Error('Invalid submission ID.');
  const evm=new EVMClient(EVMClient.SUPPORTED_CHAIN_SELECTORS['ethereum-testnet-sepolia']);
  const data=encodeFunctionData({abi:registryAbi,functionName:'requests',args:[submissionId]});
  const read=evm.callContract(runtime,{call:encodeCallMsg({from:zeroAddress,to:runtime.config.registry,data}),blockNumber:runtime.config.mode==='simulation'?LATEST_BLOCK_NUMBER:LAST_FINALIZED_BLOCK_NUMBER}).result();
  const commitment=decodeFunctionResult({abi:registryAbi,functionName:'requests',data:bytesToHex(read.data)});
  if(!hash32(commitment)||/^0x0+$/.test(commitment))throw new Error('Register the frozen submission onchain before verification.');
  const token=runtime.getSecret({id:'TASER_VERIFIER_TOKEN'}).result().value;
  const result=JSON.parse(runtime.runInNodeMode(replay,consensusIdenticalAggregation<string>())(submissionId,commitment,token).result()) as {id:Hex;commitment:Hex;valid:boolean;steps:number};
  const report=runtime.report(prepareReportRequest(encodeAbiParameters([{type:'bytes32'},{type:'bytes32'},{type:'bool'},{type:'uint32'},{type:'uint256'},{type:'address'}],[result.id,result.commitment,result.valid,result.steps,11155111n,runtime.config.registry]))).result();
  evm.writeReport(runtime,{receiver:runtime.config.registry,report,gasConfig:{gasLimit:'350000'}}).result();
  runtime.log('Submission '+submissionId+' replay completed: '+(result.valid?'winning':'rejected'));
  return JSON.stringify({submissionId,valid:result.valid,steps:result.steps,mode:runtime.config.mode});
};
export async function main(){
  const runner=await Runner.newRunner<Config>();await runner.run(config=>{
    if(!/^https:\/\/[^/]+/.test(config.apiBase)&&!(config.mode==='simulation'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(config.apiBase)))throw new Error('Use HTTPS or a local simulation endpoint.');
    if(!/^0x[a-fA-F0-9]{40}$/.test(config.registry)||config.registry===zeroAddress||!['simulation','don'].includes(config.mode))throw new Error('Configure the registry and execution mode.');
    if(config.mode==='don'&&!config.authorizedKeys?.length)throw new Error('Configure authorized HTTP trigger keys before deployment.');
    return [cre.handler(new cre.capabilities.HTTPCapability().trigger({authorizedKeys:config.authorizedKeys??[]}),handle)];
  });
}
