import { GameEngine } from '../core/engine';
import { validateLevel } from '../core/level';
import type { LevelConfig } from '../core/types';
import { cloneData } from '../core/clone';
export interface SolutionCheck {
  valid: boolean;
  step: number;
  message: string;
}
/** This verifies one witness, rather than enumerating every possible solution. */
export function verifySolution(level: LevelConfig): SolutionCheck {
  try {
    validateLevel(level);
    const engine = new GameEngine(level);
    for (let k = 0; k < level.solutionP1.length; k++) {
      for (const player of [1, 2] as const) {
        const error = engine.selectionError(
          player,
          (player === 1 ? level.solutionP1 : level.solutionP2)[k],
        );
        if (error) return { valid: false, step: k, message: `Turn ${k + 1}: ${error}` };
      }
      const state = engine.executeStep(level.solutionP1[k], level.solutionP2[k]);
      if (state.status === 'VICTORY')
        return {
          valid: true,
          step: state.step,
          message: `Verified: both operators exit on turn ${state.step}.`,
        };
      if (!['PLAYING_PHASE_1', 'WELD_SUCCESS', 'PLAYING_PHASE_2'].includes(state.status))
        return { valid: false, step: state.step, message: `Turn ${state.step}: ${state.message}` };
    }
    return {
      valid: false,
      step: engine.state.step,
      message: 'The recorded solution must reach both open exits.',
    };
  } catch (error) {
    return {
      valid: false,
      step: 0,
      message: error instanceof Error ? error.message : 'Invalid level.',
    };
  }
}
export function simulationLevel(draft: LevelConfig) {
  const level = cloneData(draft);
  level.solutionP1 = Array(level.totalSteps).fill('W');
  level.solutionP2 = Array(level.totalSteps).fill('W');
  validateLevel(level);
  return level;
}
