import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {ThemePublication} from '../arkiv/ThemePublication';
import {validateDeployment,type Deployment} from '../../src/assets/schema';
import {themeSources} from '../../src/assets/sources';
export interface ThemeReader {readonly signer:string;readTheme(entityKey:string):Promise<ThemePublication>}
export async function trustedThemePointer(archive:ThemeReader,deployment:Deployment,themeId:string){
  validateDeployment(deployment);const proof=deployment.arkiv;if(!proof||proof.publisher.toLowerCase()!==archive.signer.toLowerCase())throw new Error('Theme is not published on Arkiv');
  const record=await archive.readTheme(proof.entityKey);
  if(record.themeId!==themeId||record.swarmReference!==deployment.reference||record.manifestSha256!==deployment.manifestSha256||record.releaseSha256!==deployment.releaseSha256)throw new Error('Published theme does not match deployment');
  return {entityKey:proof.entityKey,publisher:proof.publisher,chainId:7794095,themeId:record.themeId,version:record.version,swarmReference:record.swarmReference,manifestSha256:record.manifestSha256,releaseSha256:record.releaseSha256};
}
export async function themeApi(req:IncomingMessage,res:ServerResponse,archive:unknown){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.writeHead(405);res.end(JSON.stringify({error:'Method not allowed'}));return;}
  const source=themeSources.find(source=>req.url==='/api/themes/'+source.id);
  if(!source){res.writeHead(404);res.end(JSON.stringify({error:'Theme not found'}));return;}
  try{
    if(!archive||typeof (archive as ThemeReader).readTheme!=='function')throw new Error();
    const deployment=validateDeployment(JSON.parse(await readFile(resolve(source.deploymentFile),'utf8')));
    const pointer=await trustedThemePointer(archive as ThemeReader,deployment,source.id);res.writeHead(200);res.end(JSON.stringify(pointer));
  }catch{res.writeHead(503);res.end(JSON.stringify({error:'Published artwork is temporarily unavailable. Please retry.'}));}
}
