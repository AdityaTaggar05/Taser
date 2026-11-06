import rawLevels from './levels.json';
import {validateLevel} from '../../src/core/level';
import type {LevelConfig} from '../../src/core/types';
/** Server-only migration seeds and deterministic test fixtures. Never import from browser code. */
export const levels:LevelConfig[]=rawLevels.map(level=>{validateLevel(level);return level;});
