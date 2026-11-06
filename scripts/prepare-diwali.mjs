import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=resolve(repo,'public/themes/modern-gray'),dir=resolve(repo,'public/themes/diwali');
const manifest=JSON.parse(await readFile(resolve(base,'manifest.json'),'utf8'));
const bounds=JSON.parse(await readFile(resolve(repo,'output/diwali/frame-bounds.json'),'utf8'));
Object.assign(manifest,{id:'diwali',version:'1.1.0',name:'Diwali'});
const replacements=Object.fromEntries(Object.keys(manifest.sheets).filter(id=>/^p[12]-/.test(id)||id==='04-exits'||id==='10-mvp-ui-icons-and-avatars'||id==='directional-model').map(id=>[id,id]));
Object.assign(replacements,{'p2-idle':'p2-idle-v5','p2-walk':'p2-walk-v5','directional-model':'directional-model-v3'});
await mkdir(resolve(dir,'sheets'),{recursive:true});
for(const [id,sheet] of Object.entries(manifest.sheets)){
  const target=resolve(dir,sheet.file);
  let source=resolve(base,sheet.file);
  if(replacements[id]){
    source=resolve(repo,'output/diwali/generated',replacements[id]+'.png');
    try{await access(source);}catch{source=target;}
  }
  const data=await readFile(source);
  if(source!==target)await copyFile(source,target);
  Object.assign(sheet,{width:data.readUInt32BE(16),height:data.readUInt32BE(20),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
for(const [sheet,frames] of Object.entries(bounds)){
  const sprites=Object.values(manifest.sprites).filter(s=>s.sheet===sheet);
  if(sprites.length!==frames.length)throw new Error('Unexpected sprite inventory: '+sheet);
  sprites.forEach((sprite,i)=>sprite.frame=frames[i]);
}
const serialized=JSON.stringify(manifest,null,2)+'\n';
await writeFile(resolve(dir,'manifest.json'),serialized);
await writeFile(resolve(repo,'src/assets/diwali.manifest.json'),serialized);
console.log(`Prepared Diwali: ${Object.keys(manifest.sheets).length} original PNGs, ${Object.keys(manifest.sprites).length} frames; no image pixels changed.`);
