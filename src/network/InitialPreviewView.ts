import {computeLaserTiles,isExitOpen} from '../core/engine';
import type {LevelConfig,StepSnapshot} from '../core/types';
import type {Player} from './protocol';
/** Renderer-only adapter for the temporary, sanitized initial overlay. */
export class InitialPreviewView {
  readonly lastShoves:[null,null]=[null,null];
  readonly state:StepSnapshot;
  constructor(readonly level:LevelConfig){
    this.state={step:0,status:'PLAYING_PHASE_1',message:'Study both initial configurations.',p1Pos:level.initialP1,p2Pos:level.initialP2,boxesP1:level.initialBoxesP1,boxesP2:level.initialBoxesP2};
  }
  exitOpen(player:Player){const boxes=player===1?this.state.boxesP1:this.state.boxesP2;return isExitOpen(player,boxes,computeLaserTiles(boxes,this.level),this.level);}
  nextBoxes(){return null;}
}
