import rawLevels from '../data/levels.json';
import { inBounds, hasCoord, type LevelConfig, type Coord, DIR_DELTA } from './types';

/** Public boundary shared by the runtime and a future editor's JSON import/export. */
export function validateLevel(value: unknown): asserts value is LevelConfig {
  const l = value as LevelConfig;
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
  if (l.iceTiles && !l.iceTiles.every(isCoord)) throw new Error('Invalid ice tiles.');
  for (const field of ['initialP1', 'initialP2', 'exitP1', 'exitP2'] as const) if (!isCoord(l[field]) || hasCoord(l.walls, l[field])) throw new Error(`Invalid floor coordinate: ${field}`);
  for (const p of [...(l.weldTargets ?? []), ...l.switchesP1, ...l.switchesP2, ...l.initialBoxesP1, ...l.initialBoxesP2, ...(l.iceTiles ?? [])]) if (hasCoord(l.walls, p)) throw new Error('Entities cannot occupy walls.');
  if (!l.initialBoxesP1.length || l.initialBoxesP1.length !== l.initialBoxesP2.length) throw new Error('Each box needs a stable corresponding identity.');
  if (l.weldTargets && l.weldTargets.length !== l.initialBoxesP1.length) throw new Error('Each box needs a corresponding weld target when weld targets are specified.');
  if (hasCoord(l.initialBoxesP1, l.initialP1) || hasCoord(l.initialBoxesP2, l.initialP2)) throw new Error('A spawn cannot overlap its boxes.');
  if (l.midpointSwitchRequired && (!isCoord(l.midpointSwitchRequired) || hasCoord(l.walls, l.midpointSwitchRequired))) throw new Error('Invalid midpoint switch.');
  if (l.laserEmitter && (!isCoord(l.laserEmitter.pos) || !['U','D','L','R'].includes(l.laserEmitter.dir) || hasCoord(l.walls, l.laserEmitter.pos))) throw new Error('Invalid laser emitter.');
  if (l.laserReceiverP1 && (!isCoord(l.laserReceiverP1) || hasCoord(l.walls, l.laserReceiverP1))) throw new Error('Invalid laser receiver.');
  for (const solution of [l.solutionP1, l.solutionP2]) if (!Array.isArray(solution) || solution.length !== l.totalSteps || !solution.every(d => d in DIR_DELTA)) throw new Error('Reference solutions must contain T valid directions.');
}
export function parseLevel(json: string): LevelConfig { const value: unknown = JSON.parse(json); validateLevel(value); return structuredClone(value); }
export const levels: LevelConfig[] = rawLevels.map(value => { validateLevel(value); return value; });
