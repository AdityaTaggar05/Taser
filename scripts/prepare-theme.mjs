import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {applyObjectArt} from './lib/object-art.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),art=resolve(repo,'../output');
const dir=resolve(repo,'public/themes/modern-gray');await mkdir(resolve(dir,'sheets'),{recursive:true});
const manifest={schemaVersion:1,id:'modern-gray',version:'1.1.0',name:'Modern Gray',
  palette:{background:'#151b1e',floor:'#bdc3c7',wall:'#7c858c',edge:'#454d54',p1:'#815751',p2:'#65a090',weld:'#e4e7e8',ink:'#e4e7e8'},
  presentation:{boxIdentityLabels:false},sheets:{},sprites:{},animations:{}};
const sha=data=>createHash('sha256').update(data).digest('hex');
async function sheet(id,path){const data=await readFile(path),file='sheets/'+id+'.png';await copyFile(path,resolve(dir,file));manifest.sheets[id]={file,width:data.readUInt32BE(16),height:data.readUInt32BE(20),bytes:data.length,sha256:sha(data)};return id;}
function sprite(id,sheet,rect,render={width:1,height:1,originX:.5,originY:.5}){manifest.sprites[id]={sheet,frame:rect,render};return id;}
const players=JSON.parse(await readFile(resolve(art,'player-sprites/v1/manifest.json'),'utf8'));
for(const item of players.sheets){
  const id=await sheet(item.id,resolve(art,'player-sprites/v1',item.file));
  for(const frame of item.frames){const parts=frame.name.split('_'),direction=parts[2],index=Number(parts[3]);sprite(`player.${item.player}.${item.animation}.${direction}.${index}`,id,{x:frame.x,y:frame.y,w:frame.w,h:frame.h},{width:1.18,height:1.18,originX:.5,originY:.875});}
  for(const direction of players.layout.rowDirections)manifest.animations[`player.${item.player}.${item.animation}.${direction}`]={frames:Array.from({length:6},(_,i)=>`player.${item.player}.${item.animation}.${direction}.${i}`),fps:item.suggestedFps,loop:item.loop};
}
const mvp=JSON.parse(await readFile(resolve(art,'mvp-sprites/v1/manifest.json'),'utf8'));
const ids={
  '01-crates-and-mirrors':['crate.neutral','crate.p1','crate.p2','mirror.slash.off','mirror.slash.on','mirror.backslash.off','mirror.backslash.on','replay.neutral.crate'],
  '02-environment-tiles':['tile.floor','tile.floor.seam','tile.floor.detail','tile.ice','tile.ice.shimmer','wall.solid','wall.horizontal','wall.vertical','wall.outer.ne','wall.outer.se','wall.outer.sw','wall.outer.nw','wall.inner.ne','wall.inner.se','wall.inner.sw','wall.inner.nw'],
  '03-pressure-switches':['neutral','p1','p2'].flatMap(p=>['up','press1','press2','held','release1','release2'].map(s=>`switch.${p}.${s}`)),
  '04-exits':['neutral','p1','p2'].flatMap(p=>['closed','opening1','opening2','opening3','open','entry'].map(s=>`exit.${p}.${s}`)),
  '05-laser-equipment':['emitter.off','emitter.on','receiver.off','receiver.on'].flatMap(s=>['north','east','south','west'].map(d=>`laser.${s}.${d}`)),
  '06-laser-segments-and-impacts':['laser.beam.horizontal','laser.beam.vertical','laser.bend.ne','laser.bend.se','laser.bend.sw','laser.bend.nw','laser.cap.horizontal','laser.cap.vertical',...Array.from({length:4},(_,i)=>`fx.impact.${i}`),...Array.from({length:4},(_,i)=>`fx.emission.${i}`)],
  '07-physical-effects':['shove','footsteps','iceSlide','catapult'].flatMap(s=>Array.from({length:6},(_,i)=>`fx.${s}.${i}`)),
  '08-resolution-effects':['laserDeath','paradox','weld','victory'].flatMap(s=>Array.from({length:6},(_,i)=>`fx.${s}.${i}`)),
  '09-replay-indicators':['p1','p2'].flatMap(p=>['path.h','path.v','destination','crate','forward','reverse','clockwise','counterclockwise'].map(s=>`replay.${p}.${s}`)),
  '10-mvp-ui-icons-and-avatars':['ui.emblem','ui.wallet','avatar.default','avatar.missing','avatar.demo.atlas','avatar.demo.nova','role.p1','role.p2','status.connecting','status.waiting','status.ready','status.disconnected','status.reconnecting','status.full','notice.invalid','notice.shared']
};
for(const item of mvp.sheets){
  const id=await sheet(item.id,resolve(art,'mvp-sprites/v1',item.file));
  item.frames.forEach((f,i)=>{const name=ids[item.id][i];const frame=f.contentBounds??f.frame;const playerArt=name.startsWith('avatar.');let render={width:.84,height:.84,originX:.5,originY:.5};
    if(name.startsWith('tile.'))render={width:1,height:1,originX:.5,originY:.5};
    if(name.startsWith('wall.'))render={width:1,height:1.2,originX:.5,originY:.67};
    if(name.startsWith('switch.'))render={width:.68,height:.68,originX:.5,originY:.5};
    if(name.startsWith('exit.'))render={width:.96,height:1.08,originX:.5,originY:.58};
    // Effect cells retain their common canvas/pivot rather than trimming each frame.
    sprite(name,id,name.startsWith('fx.')?f.frame:frame,render);
    if(playerArt)manifest.sprites[name].render={width:.85,height:1,originX:.5,originY:.5};
  });
}
for(const name of ['shove','footsteps','iceSlide','catapult','laserDeath','paradox','weld','victory','impact','emission'])manifest.animations['fx.'+name]={frames:Array.from({length:['impact','emission'].includes(name)?4:6},(_,i)=>`fx.${name}.${i}`),fps:12,loop:false,...(name==='weld'?{visibility:'after-success-only'}:{})};
await sheet('directional-model',resolve(art,'player-sprites/v1/directional-model-sheet.png'));
await sheet('approved-reference',resolve(art,'artstyle-exploration/11-light-gray-neutral.png'));
await applyObjectArt(manifest,dir,repo);
const serialized=JSON.stringify(manifest,null,2)+'\n';
await writeFile(resolve(dir,'manifest.json'),serialized);
await writeFile(resolve(repo,'src/assets/modern-gray.manifest.json'),serialized);
console.log(`Prepared ${Object.keys(manifest.sheets).length} original PNGs, ${Object.keys(manifest.sprites).length} semantic sprites and ${Object.keys(manifest.animations).length} animations. No image pixels changed.`);
