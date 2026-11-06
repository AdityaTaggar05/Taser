import {it,expect} from 'vitest';
import {str,bytes} from '@arkiv-network/sdk/schema';
import {bytesToHex} from 'viem';
import raw from '../public/themes/modern-gray/manifest.json';
import {makePack} from '../src/assets/catalog';
import {validateTheme,validateRelease,type ThemeRelease} from '../src/assets/schema';
import {loadPublishedTheme,sha256Hex} from '../src/assets/remote';
import {decodeThemePublication,type ThemePublication} from '../server/arkiv/ThemePublication';
import {trustedThemePointer} from '../server/assets/ThemeApi';
const publisher='0x'+'ab'.repeat(20),entityKey='0x'+'cd'.repeat(32),txHash='0x'+'ef'.repeat(32);
const record:ThemePublication={category:'theme',id:'modern-gray@1.0.0',revision:1,themeId:'modern-gray',version:'1.0.0',swarmReference:'a'.repeat(64),manifestSha256:'b'.repeat(64),releaseSha256:'c'.repeat(64),updatedAt:0};
function row(){return {$key:entityKey,$creator:publisher,$creationFlags:{readonly:true,permissionlessExtension:false},namespace:str('test'),theme_id:str(record.themeId),version:str(record.version),swarm_reference:str(record.swarmReference),manifest_sha256:str(record.manifestSha256),release_sha256:str(record.releaseSha256),content_type:str('application/json'),payload:bytes(bytesToHex(new TextEncoder().encode(JSON.stringify(record))))};}
it('binds public theme payload to publisher, immutable flags and explicit Swarm routing fields',()=>{
  expect(decodeThemePublication(row() as never,publisher,'test',entityKey)).toEqual(record);
  for(const modified of [{...row(),$creator:'0x'+'aa'.repeat(20)},{...row(),$creationFlags:{readonly:false,permissionlessExtension:false}},{...row(),swarm_reference:str('d'.repeat(64))},{...row(),namespace:str('wrong')}])expect(()=>decodeThemePublication(modified as never,publisher,'test',entityKey)).toThrow();
});
it('serves only the pinned, verified Arkiv publication; read failures are not a local fallback',async()=>{
  const d={reference:record.swarmReference,gateway:'https://bzz.limo',manifestSha256:record.manifestSha256,releaseSha256:record.releaseSha256,verifiedAt:'2026-11-06',arkiv:{entityKey,publisher,txHash}};
  expect((await trustedThemePointer({signer:publisher,readTheme:async()=>record},d,record.themeId)).swarmReference).toBe(record.swarmReference);
  await expect(trustedThemePointer({signer:publisher,readTheme:async()=>({...record,swarmReference:'d'.repeat(64)})},d,record.themeId)).rejects.toThrow();
  await expect(trustedThemePointer({signer:publisher,readTheme:async()=>{throw new Error('RPC unavailable');}},d,record.themeId)).rejects.toThrow();
});
it('loads the Arkiv pointer, Swarm release and manifest, checking both hashes before mapping every sheet',async()=>{
  const theme=validateTheme(structuredClone(raw)),manifestBytes=new TextEncoder().encode(JSON.stringify(theme)),manifestHash=await sha256Hex(manifestBytes);
  const release:ThemeRelease={schemaVersion:1,kind:'taser-theme-release',id:theme.id,version:theme.version,manifest:{reference:'d'.repeat(64),sha256:manifestHash,bytes:manifestBytes.length},sheets:Object.fromEntries(Object.entries(theme.sheets).map(([id,s])=>[id,{reference:'e'.repeat(64),path:s.file}]))};
  const releaseBytes=new TextEncoder().encode(JSON.stringify(release)),releaseHash=await sha256Hex(releaseBytes);
  const deployment={reference:record.swarmReference,gateway:'https://bzz.limo',manifestSha256:manifestHash,releaseSha256:releaseHash,verifiedAt:'2026-11-06',arkiv:{entityKey,publisher,txHash}};
  const pack=makePack(theme,deployment),urls:string[]=[];
  const transport=async(url:unknown)=>{urls.push(String(url));if(urls.length===1)return Response.json({entityKey,publisher,chainId:7794095,themeId:theme.id,version:theme.version,swarmReference:deployment.reference,manifestSha256:manifestHash,releaseSha256:releaseHash});return new Response(urls.length===2?releaseBytes:manifestBytes);};
  const loaded=await loadPublishedTheme(pack,transport as typeof fetch);expect(urls[0]).toBe('/api/themes/modern-gray');expect(urls[1]).toContain('/bzz/'+deployment.reference+'/release.json');expect(Object.keys(loaded.deployment.sheetReferences!)).toHaveLength(28);
  await expect(loadPublishedTheme({...pack,deployment:{...deployment,arkiv:undefined}},(async()=>new Response('corrupt')) as typeof fetch)).rejects.toThrow(/integrity/);
  const bad=structuredClone(release);bad.sheets['p1-idle'].path='../../.env.local';expect(()=>validateRelease(bad,theme)).toThrow();
});
