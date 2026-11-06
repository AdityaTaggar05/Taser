import {keccak256,stringToHex,type Hex,isAddress} from 'viem';
import type {LevelConfig} from '../core/types';
export const RULES_HASH=keccak256(stringToHex('taser-rules-v1'));
export type CertificationMode='simulation'|'don'|'test';
export interface CertificationRequest {id:Hex;levelId:string;target:'community'|'campaign';draftKey:Hex;levelHash:Hex;witnessCommitment:Hex;rulesHash:Hex}
export interface CertificationProof {request:CertificationRequest;mode:CertificationMode;chainId:number;registry:Hex;blockNumber:string;valid:boolean;steps:number}
export interface CertificationInfo {id:Hex;status:'pending'|'approved'|'published'|'rejected';mode:CertificationMode|'unconfigured';target:'community'|'campaign';submittedAt:number;message:string;proof?:CertificationProof}
export interface VerificationInput {request:CertificationRequest;level:LevelConfig;salt:Hex}
export function canonical(value:unknown):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const object=value as Record<string,unknown>;return '{'+Object.keys(object).filter(k=>object[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(object[k])).join(',')+'}';
}
const digest=(value:unknown)=>keccak256(stringToHex(canonical(value)));
export function levelHash(level:LevelConfig){const {solutionP1:_,solutionP2:__,...layout}=level;return digest(layout);}
export function witnessCommitment(level:LevelConfig,salt:Hex){return digest(['taser-witness-v1',salt,level.solutionP1,level.solutionP2]);}
export function requestHash(request:CertificationRequest){return digest(['taser-submission-v1',request]);}
export const hash32=(value:unknown):value is Hex=>typeof value==='string'&&/^0x[a-fA-F0-9]{64}$/.test(value);
export function validRequest(value:unknown):value is CertificationRequest {
  if(!value||typeof value!=='object')return false;const r=value as CertificationRequest;
  return [r.id,r.draftKey,r.levelHash,r.witnessCommitment,r.rulesHash].every(hash32)&&typeof r.levelId==='string'&&/^[a-f0-9-]{36}$/.test(r.levelId)&&['community','campaign'].includes(r.target);
}
export function checkInput(input:VerificationInput){
  if(!validRequest(input.request)||!hash32(input.salt)||input.request.rulesHash!==RULES_HASH||levelHash(input.level)!==input.request.levelHash||witnessCommitment(input.level,input.salt)!==input.request.witnessCommitment)throw new Error('Submission commitment mismatch.');
}
export function validProof(value:unknown):value is CertificationProof {
  if(!value||typeof value!=='object')return false;const p=value as CertificationProof;
  return validRequest(p.request)&&['simulation','don','test'].includes(p.mode)&&p.chainId===11155111&&typeof p.registry==='string'&&isAddress(p.registry)&&typeof p.blockNumber==='string'&&/^\d+$/.test(p.blockNumber)&&typeof p.valid==='boolean'&&Number.isInteger(p.steps)&&p.steps>=0&&p.steps<=32;
}
export const registryAbi=[
  {type:'function',name:'simulation',stateMutability:'view',inputs:[],outputs:[{type:'bool'}]},
  {type:'function',name:'requests',stateMutability:'view',inputs:[{name:'id',type:'bytes32'}],outputs:[{type:'bytes32'}]},
  {type:'function',name:'registerSubmission',stateMutability:'nonpayable',inputs:[{name:'id',type:'bytes32'},{name:'commitment',type:'bytes32'}],outputs:[]},
  {type:'function',name:'certifications',stateMutability:'view',inputs:[{name:'id',type:'bytes32'}],outputs:[{name:'commitment',type:'bytes32'},{name:'valid',type:'bool'},{name:'steps',type:'uint32'},{name:'exists',type:'bool'}]},
] as const;
