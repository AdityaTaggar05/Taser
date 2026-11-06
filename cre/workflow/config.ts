import {isAddress,zeroAddress,type Hex} from 'viem';

type AuthorizedKey={type:'KEY_TYPE_ECDSA_EVM';publicKey:string};
export type Config=
  | {mode:'local-simulation';apiBase:string;authorizedKeys:AuthorizedKey[];registry?:never}
  | {mode:'simulation'|'don';apiBase:string;registry:Hex;authorizedKeys:AuthorizedKey[]};

/** Closed variants prevent a rehearsal config from silently acquiring a write path. */
export function parseConfig(value:unknown):Config {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid verification configuration.');
  const config=value as Record<string,unknown>,local=config.mode==='local-simulation';
  if(!['local-simulation','simulation','don'].includes(String(config.mode)))throw new Error('Unknown verification mode.');
  const allowed=local?['mode','apiBase','authorizedKeys']:['mode','apiBase','registry','authorizedKeys'];
  if(Object.keys(config).some(key=>!allowed.includes(key)))throw new Error('Unexpected verification configuration field.');
  if(typeof config.apiBase!=='string'||!(config.mode!=='don'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(config.apiBase)||/^https:\/\/[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*(?::\d+)?$/.test(config.apiBase)))throw new Error('Use an HTTPS origin, or loopback for simulation.');
  if(!Array.isArray(config.authorizedKeys)||config.authorizedKeys.some(key=>!key||typeof key!=='object'||key.type!=='KEY_TYPE_ECDSA_EVM'||typeof key.publicKey!=='string'||!isAddress(key.publicKey)||key.publicKey.toLowerCase()===zeroAddress))throw new Error('Invalid authorized HTTP trigger keys.');
  if(config.mode==='don'&&!config.authorizedKeys.length)throw new Error('Configure authorized HTTP trigger keys before deployment.');
  if(!local&&(typeof config.registry!=='string'||!isAddress(config.registry)||config.registry.toLowerCase()===zeroAddress))throw new Error('Configure a nonzero certification registry.');
  return config as Config;
}
