import { inBounds, hasCoord, type LevelConfig, type Coord, DIR_DELTA } from './types';
import {validateDraft} from './levelValidation';
import {cloneData} from './clone';

/** Public boundary shared by the runtime and a future editor's JSON import/export. */
export function validateLevel(value: unknown): asserts value is LevelConfig {
  validateDraft(value);
  const l = value as LevelConfig;
  if(!l.name.trim())throw new Error('Give the chamber a name.');
  if (!l || !Number.isInteger(l.id) || typeof l.name !== 'string' || typeof l.subtitle !== 'string') throw new Error('Level needs an id, name and subtitle.');
  if (![l.width, l.height, l.totalSteps].every(n => Number.isInteger(n) && n > 0) || l.totalSteps % 2 || l.weldStep !== l.totalSteps / 2) throw new Error('Dimensions must be positive integers; timeline must be even with weld at T/2.');
  const isCoord = (p: unknown): p is Coord => Array.isArray(p) && p.length === 2 && p.every(Number.isInteger) && inBounds(p as Coord, l.width, l.height);
  for (const field of ['walls', 'switchesP1', 'switchesP2', 'initialBoxesP1', 'initialBoxesP2'] as const) {
    if (!Array.isArray(l[field]) || !l[field].every(isCoord)) throw new Error(`Invalid coordinates: ${field}`);
    if (new Set(l[field].map(p => p.join(','))).size !== l[field].length) throw new Error(`Duplicate coordinates: ${field}`);
  }
  if (l.weldTargets) {
    if (!Array.isArray(l.weldTargets) || !l.weldTargets.every(isCoord)) throw new Error('Invalid coordinates: weldTargets');
    if (new Set(l.weldTargets.map(p => p.join(','))).size !== l.weldTargets.length) throw new Error('Duplicate coordinates: weldTargets');
  }
  if (l.iceTiles && new Set(l.iceTiles.map(p=>p.join(','))).size!==l.iceTiles.length)throw new Error('Duplicate ice tiles.');
  if (l.iceTiles && !l.iceTiles.every(isCoord)) throw new Error('Invalid ice tiles.');
  for (const field of ['initialP1', 'initialP2', 'exitP1', 'exitP2'] as const) if (!isCoord(l[field]) || hasCoord(l.walls, l[field])) throw new Error(`Invalid floor coordinate: ${field}`);
  for (const p of [...(l.weldTargets ?? []), ...l.switchesP1, ...l.switchesP2, ...l.initialBoxesP1, ...l.initialBoxesP2, ...(l.iceTiles ?? [])]) if (hasCoord(l.walls, p)) throw new Error('Entities cannot occupy walls.');
  if (!l.initialBoxesP1.length || l.initialBoxesP1.length !== l.initialBoxesP2.length) throw new Error('Each box needs a stable corresponding identity.');
  if (l.weldTargets?.length && l.weldTargets.length !== l.initialBoxesP1.length) throw new Error('Each box needs a corresponding weld target when weld targets are specified.');
  if (hasCoord(l.initialBoxesP1, l.initialP1) || hasCoord(l.initialBoxesP2, l.initialP2)) throw new Error('A spawn cannot overlap its boxes.');
  if (l.midpointSwitchRequired && (!isCoord(l.midpointSwitchRequired) || hasCoord(l.walls, l.midpointSwitchRequired))) throw new Error('Invalid midpoint switch.');
  if (l.laserEmitter && (!isCoord(l.laserEmitter.pos) || !['U','D','L','R'].includes(l.laserEmitter.dir) || hasCoord(l.walls, l.laserEmitter.pos))) throw new Error('Invalid laser emitter.');
  if (l.laserReceiverP1 && (!isCoord(l.laserReceiverP1) || hasCoord(l.walls, l.laserReceiverP1))) throw new Error('Invalid laser receiver.');
  if(!l.switchesP1.length&&!l.laserReceiverP1)throw new Error('P1 needs an exit switch or laser receiver.');
  if(!l.switchesP2.length)throw new Error('P2 needs an exit switch.');
  if(l.laserReceiverP1&&!l.laserEmitter)throw new Error('A receiver needs a laser emitter.');
  if(l.solutionP1.length!==l.solutionP2.length||l.solutionP1.length<=l.weldStep||l.solutionP1.length>l.totalSteps)throw new Error('Reference solutions must contain matching move lists ending after the weld and within the timeline.');
  for (const solution of [l.solutionP1,l.solutionP2]) if(!solution.every(d=>Object.hasOwn(DIR_DELTA,d)))throw new Error('Reference solutions contain an invalid direction.');
}
export function parseLevel(json: string): LevelConfig { const value: unknown = JSON.parse(json); validateLevel(value); return cloneData(value); }
