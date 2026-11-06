import { copyBoxes, DIR_DELTA, hasCoord, inBounds, isLive, sameCoord, type Coord, type Direction, type LevelConfig, type MoveResult, type StepSnapshot } from './types';
import { validateLevel } from './level';

const solid = (p: Coord, l: LevelConfig) => !inBounds(p, l.width, l.height) || hasCoord(l.walls, p);
export function resolvePhase1Move(playerPos: Coord, boxes: Coord[], dir: Direction, level: LevelConfig): MoveResult {
  const [dx, dy] = DIR_DELTA[dir], nextBoxes = copyBoxes(boxes);
  const stay = (): MoveResult => ({ nextPlayer: [...playerPos], nextBoxes, shovedBoxIndex: null });
  if (dir === 'W') return stay();
  const target: Coord = [playerPos[0] + dx, playerPos[1] + dy];
  if (solid(target, level)) return stay();
  const index = boxes.findIndex(b => sameCoord(b, target));
  if (index < 0) return { nextPlayer: target, nextBoxes, shovedBoxIndex: null };
  const beyond: Coord = [target[0] + dx, target[1] + dy];
  if (solid(beyond, level) || hasCoord(nextBoxes, beyond)) return stay();
  nextBoxes[index] = beyond;
  while (hasCoord(level.iceTiles, nextBoxes[index])) {
    const next: Coord = [nextBoxes[index][0] + dx, nextBoxes[index][1] + dy];
    if (solid(next, level) || hasCoord(nextBoxes, next)) break;
    nextBoxes[index] = next;
  }
  return { nextPlayer: [...playerPos], nextBoxes, shovedBoxIndex: index };
}

export function computeLaserTiles(boxes: Coord[], level: LevelConfig): Coord[] {
  if (!level.laserEmitter) return [];
  let [x,y] = level.laserEmitter.pos, [dx,dy] = DIR_DELTA[level.laserEmitter.dir];
  const tiles: Coord[] = [], visited = new Set<string>();
  while (!solid([x,y], level)) {
    const key = `${x},${y},${dx},${dy}`;
    if (visited.has(key)) break;
    visited.add(key); tiles.push([x,y]);
    if (hasCoord(boxes, [x,y])) {
      if (!level.hasMirrorBox) break;
      // Cartesian backslash mirror: South→East, East→South, North→West, West→North.
      [dx,dy] = [-dy,-dx];
    }
    x += dx; y += dy;
  }
  return tiles;
}
export function isExitOpen(player: 1 | 2, boxes: Coord[], laser: Coord[], level: LevelConfig): boolean {
  const switches = player === 1 ? level.switchesP1 : level.switchesP2;
  return (switches.length > 0 && switches.every(p => hasCoord(boxes,p))) || (player === 1 && !!level.laserReceiverP1 && hasCoord(laser,level.laserReceiverP1));
}

/** Deterministic, renderer-free simulation. Box array indices are stable identities. */
export class GameEngine {
  readonly level: LevelConfig;
  stateStack: StepSnapshot[] = [];
  lastShoves: [number | null, number | null] = [null,null];
  constructor(level: LevelConfig) { validateLevel(level); this.level = structuredClone(level); this.reset(); }
  get state(): StepSnapshot { return this.stateStack[this.stateStack.length - 1]; }
  reset() {
    const l = this.level;
    this.stateStack = [{ step: 0, p1Pos: [...l.initialP1], p2Pos: [...l.initialP2], boxesP1: copyBoxes(l.initialBoxesP1), boxesP2: copyBoxes(l.initialBoxesP2), status: 'PLAYING_PHASE_1', message: `Meet at the weld. Every box must match at turn ${l.weldStep}.` }];
    this.lastShoves = [null,null];
  }
  undo() { if (this.stateStack.length > 1) this.stateStack.pop(); this.lastShoves = [null,null]; return this.state; }
  exitOpen(player: 1 | 2, state = this.state) { const boxes = player === 1 ? state.boxesP1 : state.boxesP2; return isExitOpen(player, boxes, computeLaserTiles(boxes,this.level), this.level); }
  nextBoxes(player: 1 | 2): Coord[] | null {
    const s = this.state, l = this.level;
    if (s.step < l.weldStep || s.step >= l.totalSteps || !isLive(s.status)) return null;
    return copyBoxes(this.stateStack[l.totalSteps - s.step - 1][player === 1 ? 'boxesP2' : 'boxesP1']);
  }
  /** Reject blocked selections without advancing either player's timeline. Hazards still resolve on commit. */
  selectionError(player: 1 | 2, dir: Direction): string | null {
    if (!isLive(this.state.status)) return 'This timeline has ended. Undo or reset to continue.';
    if (!Object.hasOwn(DIR_DELTA, dir)) return `P${player}: unknown move.`;
    if (dir === 'W') return null;
    const pos = player === 1 ? this.state.p1Pos : this.state.p2Pos;
    const [dx, dy] = DIR_DELTA[dir], target: Coord = [pos[0] + dx, pos[1] + dy];
    if (solid(target, this.level)) return `P${player}: path blocked. Choose another move or Wait.`;
    if (this.state.step < this.level.weldStep) {
      const boxes = player === 1 ? this.state.boxesP1 : this.state.boxesP2;
      const result = resolvePhase1Move(pos, boxes, dir, this.level);
      if (sameCoord(pos, result.nextPlayer) && result.shovedBoxIndex === null) {
        return `P${player}: that box cannot be shoved. Choose another move or Wait.`;
      }
    }
    return null;
  }
  executeStep(p1: Direction, p2: Direction): StepSnapshot {
    const prev = this.state, l = this.level;
    // Also enforce validation for direct simulation/replay callers: reject the whole pair atomically.
    if (this.selectionError(1, p1) || this.selectionError(2, p2)) return prev;
    const s: StepSnapshot = structuredClone(prev); s.step++;
    this.lastShoves = [null,null];
    if (s.step <= l.weldStep) {
      const a = resolvePhase1Move(prev.p1Pos, prev.boxesP1, p1, l), b = resolvePhase1Move(prev.p2Pos, prev.boxesP2, p2, l);
      s.p1Pos = a.nextPlayer; s.boxesP1 = a.nextBoxes; s.p2Pos = b.nextPlayer; s.boxesP2 = b.nextBoxes;
      this.lastShoves = [a.shovedBoxIndex,b.shovedBoxIndex];
      s.message = this.lastShoves.some(v => v !== null) ? 'Stationary shove. The box moves; you stay.' : 'History is being written. Coordinate box positions with your partner.';
    } else {
      s.status = 'PLAYING_PHASE_2';
      s.boxesP1 = copyBoxes(this.stateStack[l.totalSteps - s.step].boxesP2);
      s.boxesP2 = copyBoxes(this.stateStack[l.totalSteps - s.step].boxesP1);
      for (const player of [1,2] as const) {
        const pos = player === 1 ? prev.p1Pos : prev.p2Pos, dir = player === 1 ? p1 : p2;
        const [dx,dy] = DIR_DELTA[dir], target: Coord = [pos[0]+dx,pos[1]+dy];
        const next = solid(target,l) ? [...pos] as Coord : target;
        // Resolve against this turn's locked boxes. Walking into a vacated tile is legal.
        if (hasCoord(player === 1 ? s.boxesP1 : s.boxesP2,next)) {
          s.status = 'PARADOX_COLLISION'; s.message = `P${player} obstructed locked history at (${next.join(', ')}). Undo to choose another route.`;
        }
        if (player === 1) s.p1Pos = next; else s.p2Pos = next;
      }
      if (s.status !== 'PARADOX_COLLISION') s.message = 'History is locked. Follow the dotted trajectories and reach both exits.';
    }
    if (isLive(s.status)) {
      for (const player of [1,2] as const) {
        const boxes = player === 1 ? s.boxesP1 : s.boxesP2, pos = player === 1 ? s.p1Pos : s.p2Pos;
        if (hasCoord(computeLaserTiles(boxes,l),pos) && !hasCoord(boxes,pos)) { s.status = 'LASER_DEATH'; s.message = `P${player} entered the active laser at (${pos.join(', ')}). Undo and use the mirror's shadow.`; }
      }
    }
    if (isLive(s.status) && s.step === l.weldStep) {
      const identityMatch = s.boxesP1.every((box,i) => sameCoord(box,s.boxesP2[i]));
      const targetsMatch = !l.weldTargets?.length || l.weldTargets.every((target,i) => sameCoord(target,s.boxesP1[i]));
      const switchHeld = !l.midpointSwitchRequired || hasCoord(s.boxesP1,l.midpointSwitchRequired);
      if (identityMatch && targetsMatch && switchHeld) { s.status = 'WELD_SUCCESS'; s.message = 'CAUSALITY WELDED. Your partner’s history is now your future.'; }
      else { s.status = 'PARADOX_WELD'; s.message = 'Weld failed. Matching box identities must meet at the required coordinates. Undo to repair history.'; }
    }
    if (isLive(s.status) && s.step > l.weldStep) {
      if (sameCoord(s.p1Pos,l.exitP1) && sameCoord(s.p2Pos,l.exitP2) && this.exitOpen(1,s) && this.exitOpen(2,s)) {
        s.status = 'VICTORY';
        s.message = s.step < l.totalSteps ? 'Timeline secured. Both operators extracted mid-flight.' : 'Timeline secured. Both operators made it home.';
      } else if (s.step === l.totalSteps) {
        s.status = 'OUT_OF_TIME';
        s.message = 'Time expired. Both operators must occupy their open exits simultaneously.';
      }
    }
    this.stateStack.push(s); return s;
  }
}
