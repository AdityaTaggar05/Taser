import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,fsyncSync,closeSync,unlinkSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createPublicClient,http,encodeFunctionData,encodeDeployData,keccak256,parseEther,formatEther,zeroHash,type Hex} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {sepolia} from 'viem/chains';
import {randomBytes} from 'node:crypto';
import {registryAbi,requestHash,validRequest,type CertificationRequest} from '../../src/certification/model';
for(const file of ['.env','.env.local'])if(existsSync(file))for(const [key,value] of Object.entries(parseEnv(readFileSync(file,'utf8'))))if(key.startsWith('CRE_')&&process.env[key]===undefined)process.env[key]=value;
const action=process.argv[2]??'check',write=process.argv.includes('--write');
const env=process.env,root=resolve('.data/cre');mkdirSync(root,{recursive:true,mode:0o700});
function durable(path:string,value:unknown){const fd=openSync(path,'w',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
const required=(key:string)=>{const value=env[key];if(!value)throw new Error('Configure '+key+' locally.');return value;};
function client(){return createPublicClient({chain:sepolia,transport:http(required('CRE_SEPOLIA_RPC_URL'),{retryCount:0}),cacheTime:0});}
function mode(){if(!['simulation','don'].includes(required('CRE_MODE')))throw new Error('CRE_MODE must be simulation or don.');return env.CRE_MODE as 'simulation'|'don';}
async function request():Promise<CertificationRequest>{
  const id=process.argv[process.argv.indexOf('--submission')+1];if(!/^0x[a-fA-F0-9]{64}$/.test(id??''))throw new Error('Pass --submission 0x<submission ID shown in the editor>.');
  const base=env.CRE_API_BASE??'http://localhost:5173';const response=await fetch(base+'/api/cre/submissions/'+id+'/request',{headers:{Authorization:'Bearer '+required('CRE_API_TOKEN')},redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error('Submission request is unavailable; check the operator token and pending status.');const value:unknown=await response.json();if(!validRequest(value))throw new Error('Malformed submission request.');return value;
}
async function transaction(operation:string,data:Hex,to?:Hex){
  const account=privateKeyToAccount(required('CRE_ETH_PRIVATE_KEY') as Hex),rpc=client();if(await rpc.getChainId()!==11155111)throw new Error('Sepolia only.');
  const lock=resolve(root,account.address.toLowerCase()+'.lock');let lockFd:number;
  try{lockFd=openSync(lock,'wx',0o600);writeFileSync(lockFd,String(process.pid));}catch{throw new Error('Another CRE operator process owns this signer. Resolve its lock before proceeding.');}
  const journalPath=resolve(root,account.address.toLowerCase()+'.journal.json');
  type Intent={operation:string;hash:Hex;signed:Hex;maximum:string;day:string;phase:'submitting'|'confirmed'|'reverted'};
  const journal:Intent[]=existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):[];
  try{
    const prior=journal.find(p=>p.operation===operation);
    if(prior){
      const receipt=await rpc.getTransactionReceipt({hash:prior.hash}).catch(()=>null);if(!receipt)throw new Error('The prior transaction is not confirmed. Reconcile its recorded hash; this command will not resend it.');
      prior.phase=receipt.status==='success'?'confirmed':'reverted';durable(journalPath,journal);if(receipt.status!=='success')throw new Error('The prior transaction reverted; inspect it before creating a new operation.');console.log('Confirmed existing transaction:',prior.hash);return receipt;
    }
    if(journal.some(p=>p.phase==='submitting'))throw new Error('Reconcile the pending journal transaction before creating another.');
    const gas=(await rpc.estimateGas({account,data,...(to?{to}:{})}))*120n/100n,gasPrice=await rpc.getGasPrice(),maximum=gas*gasPrice;
    console.log('Estimated maximum fee:',formatEther(maximum),'Sepolia ETH');
    if(!write){console.log('Quote only. Review budgets and pass --write to send.');return;}
    const max=parseEther(env.CRE_MAX_TX_FEE_ETH??'0'),daily=parseEther(env.CRE_DAILY_FEE_BUDGET_ETH??'0'),day=new Date().toISOString().slice(0,10);
    const reserved=journal.filter(p=>p.day===day).reduce((sum,p)=>sum+BigInt(p.maximum),0n);
    if(maximum>max||reserved+maximum>daily||max===0n||daily===0n)throw new Error('CRE transaction or daily budget would be exceeded. Configure reviewed Sepolia ETH caps.');
    const signed=await account.signTransaction({chainId:11155111,nonce:await rpc.getTransactionCount({address:account.address,blockTag:'pending'}),gas,gasPrice,data,...(to?{to}:{}),type:'legacy'}),hash=keccak256(signed);
    const intent:Intent={operation,hash,signed,maximum:maximum.toString(),day,phase:'submitting'};journal.push(intent);durable(journalPath,journal);
    try{await rpc.sendRawTransaction({serializedTransaction:signed});}catch{throw new Error('Transaction recorded before submission; outcome uncertain. Retry this exact command to reconcile, not resend.');}
    console.log('Submitted transaction:',hash);const receipt=await rpc.waitForTransactionReceipt({hash,timeout:120_000});intent.phase=receipt.status==='success'?'confirmed':'reverted';durable(journalPath,journal);if(receipt.status!=='success')throw new Error('Transaction reverted.');return receipt;
  }finally{closeSync(lockFd);unlinkSync(lock);}
}
async function run(){
  if(action==='setup'){
    const file='.env.local',old=existsSync(file)?readFileSync(file,'utf8'):'',values=parseEnv(old),lines:string[]=[];
    if(!values.CRE_ETH_PRIVATE_KEY&&!env.CRE_ETH_PRIVATE_KEY)lines.push('CRE_ETH_PRIVATE_KEY='+generatePrivateKey());
    if(!values.CRE_API_TOKEN&&!env.CRE_API_TOKEN)lines.push('CRE_API_TOKEN='+randomBytes(32).toString('hex'));
    if(lines.length)writeFileSync(file,old+(old.endsWith('\n')?'':'\n')+'\n# CRE operator secrets (never share or commit).\n'+lines.join('\n')+'\n',{mode:0o600});
    const signer=privateKeyToAccount((values.CRE_ETH_PRIVATE_KEY??env.CRE_ETH_PRIVATE_KEY??parseEnv(readFileSync(file,'utf8')).CRE_ETH_PRIVATE_KEY) as Hex).address;console.log('CRE Sepolia signer:',signer);console.log('Secrets saved locally. Configure the remaining values from .env.example; no transaction sent.');return;
  }
  if(action==='check'){
    console.log('CRE mode:',env.CRE_MODE??'unconfigured');console.log('CLI:',spawnSync(env.CRE_BIN??'cre',['version'],{encoding:'utf8'}).status===0?'installed':'install CRE CLI and run cre login');
    console.log('API token:',(env.CRE_API_TOKEN?.length??0)>=32?'configured':'missing');console.log('Registry:',env.CRE_REGISTRY_ADDRESS??'not configured');
    if(env.CRE_ETH_PRIVATE_KEY)console.log('Signer:',privateKeyToAccount(env.CRE_ETH_PRIVATE_KEY as Hex).address);return;
  }
  if(action==='deploy'){
    await import('./compile-contract.mjs');const artifact=JSON.parse(readFileSync(resolve(root,'registry.json'),'utf8'));
    const forwarder=required('CRE_FORWARDER_ADDRESS') as Hex;if(!await client().getCode({address:forwarder}))throw new Error('The selected forwarder has no contract code.');
    const workflowId=mode()==='simulation'?zeroHash:required('CRE_WORKFLOW_ID') as Hex;
    const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode,args:[forwarder,workflowId,mode()==='simulation']});
    const receipt=await transaction('deploy:'+keccak256(data),data);if(receipt?.contractAddress)console.log('Set CRE_REGISTRY_ADDRESS='+receipt.contractAddress);return;
  }
  if(action==='register'){
    const submission=await request(),address=required('CRE_REGISTRY_ADDRESS') as Hex,rpc=client(),commitment=requestHash(submission);
    const prior=await rpc.readContract({address,abi:registryAbi,functionName:'requests',args:[submission.id]});
    if(prior===commitment){console.log('The immutable request is already registered.');return;}if(prior!==zeroHash)throw new Error('Onchain request differs from this submission.');
    await transaction('register:'+submission.id,encodeFunctionData({abi:registryAbi,functionName:'registerSubmission',args:[submission.id,commitment]}),address);return;
  }
  if(action==='simulate'){
    if(mode()!=='simulation')throw new Error('The simulator requires a separately deployed simulation registry.');if(write)throw new Error('This command is dry-run only. Review and run the documented CRE CLI --broadcast command separately when ready.');
    const submission=await request();
    durable(resolve(root,'config.json'),{apiBase:env.CRE_API_BASE??'http://localhost:5173',registry:required('CRE_REGISTRY_ADDRESS'),mode:'simulation',authorizedKeys:[]});
    writeFileSync(resolve(root,'project.yaml'),'staging-settings:\n  rpcs:\n    - chain-name: ethereum-testnet-sepolia\n      url: '+JSON.stringify(required('CRE_SEPOLIA_RPC_URL'))+'\n',{mode:0o600});
    writeFileSync(resolve(root,'workflow.yaml'),'staging-settings:\n  user-workflow:\n    workflow-name: taser-level-certification\n  workflow-artifacts:\n    workflow-path: ../../cre/workflow/main.ts\n    config-path: ./config.json\n    secrets-path: ../../cre/workflow/secrets.yaml\n',{mode:0o600});
    durable(resolve(root,'trigger.json'),{submissionId:submission.id});
    const childEnv={...env};for(const key of Object.keys(childEnv))if(key.startsWith('ARKIV_'))delete childEnv[key];
    const child=spawnSync(env.CRE_BIN??'cre',['workflow','simulate','.','--target','staging-settings','--non-interactive','--trigger-index','0','--http-payload','@trigger.json','--wasm','workflow.wasm'],{cwd:root,env:childEnv,stdio:'inherit'});
    if(child.status!==0)throw new Error('CRE simulation did not complete. Check CLI login, registered request, configuration and RPC.');return;
  }
  throw new Error('Unknown CRE command.');
}
run().catch(error=>{console.error(error instanceof Error&&/^(Configure |Pass --|CRE_MODE|CRE simulation|CRE transaction|The |Another |Reconcile |Onchain |Sepolia only|Transaction |This command|Unknown CRE|Malformed |Submission request)/.test(error.message)?error.message:'CRE operation failed. Check local configuration and the private transaction journal.');process.exitCode=1;});
