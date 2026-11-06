import {DIR_DELTA,inBounds,type Coord,type LevelConfig} from './types';
export const LEVEL_LIMITS={size:20,turns:32,boxes:6} as const;
/** Bounded draft shape. Temporary overlaps are allowed while authoring. */
export function validateDraft(value:unknown):asserts value is LevelConfig {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a level object.');
  const l=value as LevelConfig;
  if(!Number.isSafeInteger(l.id)||l.id<1)throw new Error('Level id must be a positive integer.');
  if(typeof l.name!=='string'||l.name.length>80||typeof l.subtitle!=='string'||l.subtitle.length>180)throw new Error('Use a name up to 80 characters and a subtitle up to 180 characters.');
  if(![l.width,l.height].every(n=>Number.isInteger(n)&&n>=2&&n<=LEVEL_LIMITS.size))throw new Error('Board dimensions must be between 2 and 20.');
  if(!Number.isInteger(l.totalSteps)||l.totalSteps<2||l.totalSteps>LEVEL_LIMITS.turns||l.totalSteps%2||l.weldStep!==l.totalSteps/2)throw new Error('Use an even timeline of 2–32 turns, with the weld halfway through.');
  const coord=(p:unknown):p is Coord=>Array.isArray(p)&&p.length===2&&p.every(Number.isInteger)&&inBounds(p as Coord,l.width,l.height);
  for(const key of ['walls','weldTargets','switchesP1','switchesP2','initialBoxesP1','initialBoxesP2'] as const){if(!Array.isArray(l[key])||l[key].length>l.width*l.height||!l[key].every(coord))throw new Error(`Invalid coordinates: ${key}.`);}
  if(l.iceTiles!==undefined&&(!Array.isArray(l.iceTiles)||l.iceTiles.length>l.width*l.height||!l.iceTiles.every(coord)))throw new Error('Invalid ice coordinates.');
  for(const key of ['initialP1','initialP2','exitP1','exitP2'] as const)if(!coord(l[key]))throw new Error(`Invalid coordinate: ${key}.`);
  const count=l.initialBoxesP1.length;
  if(count<1||count>LEVEL_LIMITS.boxes||l.initialBoxesP2.length!==count||l.weldTargets.length!==count)throw new Error('Use 1–6 corresponding boxes and weld targets.');
  if(l.midpointSwitchRequired!==undefined&&!coord(l.midpointSwitchRequired))throw new Error('Invalid midpoint switch.');
  if(l.laserEmitter!==undefined&&(!l.laserEmitter||!coord(l.laserEmitter.pos)||!['U','D','L','R'].includes(l.laserEmitter.dir)))throw new Error('Invalid laser emitter.');
  if(l.laserReceiverP1!==undefined&&!coord(l.laserReceiverP1))throw new Error('Invalid laser receiver.');
  if(l.hasMirrorBox!==undefined&&typeof l.hasMirrorBox!=='boolean')throw new Error('Invalid mirror setting.');
  if(l.environment!==undefined&&(typeof l.environment!=='string'||!/^[a-z0-9_-]{1,32}$/.test(l.environment)))throw new Error('Invalid environment identifier.');
  for(const moves of [l.solutionP1,l.solutionP2])if(!Array.isArray(moves)||moves.length>l.totalSteps||!moves.every(d=>typeof d==='string'&&Object.hasOwn(DIR_DELTA,d)))throw new Error('Solutions must contain only U, D, L, R or W, up to the timeline length.');
}
/** Strip unknown imported fields; level files cannot supply scripts or asset URLs. */
export function cleanDraft(value:unknown):LevelConfig {
  validateDraft(value);
  const result={} as LevelConfig;
  for(const key of ['id','name','subtitle','width','height','totalSteps','weldStep','walls','iceTiles','weldTargets','midpointSwitchRequired','switchesP1','switchesP2','laserEmitter','laserReceiverP1','hasMirrorBox','exitP1','exitP2','initialP1','initialP2','initialBoxesP1','initialBoxesP2','solutionP1','solutionP2','environment'] as const){if(value[key]!==undefined)Object.assign(result,{[key]:structuredClone(value[key])});}
  return result;
}
