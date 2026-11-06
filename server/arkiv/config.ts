import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import type {Hex} from 'viem';
import {ArkivArchive} from './ArkivArchive';
import {UnconfiguredArchive} from './archive';
export const SERVER_ENV_KEYS=['APP_ORIGIN','DEMO_AUTH','AUTH_DB_PATH','ETHEREUM_RPC_URL','SEPOLIA_RPC_URL','ARKIV_ACCESS_KEY','ARKIV_PRIVATE_KEY','ARKIV_ENCRYPTION_KEY','ARKIV_NAMESPACE','ARKIV_JOURNAL_PATH','ARKIV_MAX_TX_FEE_GLM','ARKIV_DAILY_FEE_BUDGET_GLM','CAMPAIGN_PUBLISHER_WALLETS','CRE_MODE','CRE_REGISTRY_ADDRESS','CRE_SEPOLIA_RPC_URL','CRE_API_TOKEN'];
export function loadServerEnv(){const values:Record<string,string>={};for(const file of ['.env','.env.local'])if(existsSync(file))Object.assign(values,parseEnv(readFileSync(file,'utf8')));for(const key of SERVER_ENV_KEYS)if(process.env[key]===undefined&&values[key]!==undefined)process.env[key]=values[key];}
export function configuredArchive(){
  const env=process.env;
  if(!env.ARKIV_ACCESS_KEY&&!env.ARKIV_PRIVATE_KEY&&!env.ARKIV_ENCRYPTION_KEY)return new UnconfiguredArchive();
  if(!env.ARKIV_ACCESS_KEY||!env.ARKIV_PRIVATE_KEY||!env.ARKIV_ENCRYPTION_KEY)throw new Error('Complete the server-only Arkiv configuration before starting.');
  return new ArkivArchive({accessKey:env.ARKIV_ACCESS_KEY,privateKey:env.ARKIV_PRIVATE_KEY as Hex,encryptionKey:env.ARKIV_ENCRYPTION_KEY,
    namespace:env.ARKIV_NAMESPACE??'weldpoint',databasePath:env.ARKIV_JOURNAL_PATH??resolve('.data/arkiv.sqlite'),maxTxFee:env.ARKIV_MAX_TX_FEE_GLM??'0',dailyBudget:env.ARKIV_DAILY_FEE_BUDGET_GLM??'0'});
}
