import { computeLaserTiles, isExitOpen } from '../core/engine';
import { isLive, type Coord, type LevelConfig, type StepSnapshot } from '../core/types';
import type { PlayerFrame, SessionState, Player } from './protocol';
/** Renderer adapter built entirely from the current player's server projection. */
export class RemoteView {
  readonly stateStack: StepSnapshot[];
  readonly lastShoves: [number | null, number | null] = [null, null];

  constructor(
    readonly level: LevelConfig,
    readonly session: SessionState,
    readonly inspecting: number | null = null,
  ) {
    this.stateStack = session.history.map((frame) => this.snapshot(frame));
    this.lastShoves[session.player - 1] = session.shove;
  }

  private snapshot(f: PlayerFrame): StepSnapshot {
    const own = this.session.player === 1;
    return {
      step: f.step,
      status: f.status,
      message: f.message,
      p1Pos: own ? f.position : [0, 0],
      p2Pos: own ? [0, 0] : f.position,
      boxesP1: own ? f.boxes : [],
      boxesP2: own ? [] : f.boxes,
    };
  }

  get state() {
    return this.stateStack[this.inspecting ?? this.stateStack.length - 1];
  }

  exitOpen(player: Player, s = this.state) {
    const boxes = player === 1 ? s.boxesP1 : s.boxesP2;
    return isExitOpen(player, boxes, computeLaserTiles(boxes, this.level), this.level);
  }

  nextBoxes(player: Player): Coord[] | null {
    if (
      player !== this.session.player ||
      this.state.step < this.level.weldStep ||
      !isLive(this.state.status)
    )
      return null;
    if (this.inspecting !== null) return this.session.history[this.inspecting + 1]?.boxes ?? null;
    return this.session.nextBoxes;
  }
}
