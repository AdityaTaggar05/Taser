import { describe, it, expect } from 'vitest';
import { GameEngine, resolvePhase1Move, computeLaserTiles, isExitOpen } from '../src/core/engine';
import { levels, parseLevel } from '../src/core/level';
import { TurnBuffer } from '../src/input/TurnBuffer';
import { sameCoord } from '../src/core/types';

describe('documented level solutions', () => {
  for (const l of levels) it(`${l.id}: ${l.name} welds and wins in exactly eight turns`, () => {
    const e = new GameEngine(l);
    l.solutionP1.forEach((move,i) => {
      const s = e.executeStep(move,l.solutionP2[i]);
      expect(s.step).toBe(i+1);
      if (s.step === l.weldStep) { expect(s.status).toBe('WELD_SUCCESS'); expect(s.boxesP1).toEqual(l.weldTargets); }
      else if (s.step < l.totalSteps) expect(s.status).toBe(s.step < l.weldStep ? 'PLAYING_PHASE_1' : 'PLAYING_PHASE_2');
      if (s.step > l.weldStep) { expect(s.boxesP1).toEqual(e.stateStack[l.totalSteps-s.step].boxesP2); expect(s.boxesP2).toEqual(e.stateStack[l.totalSteps-s.step].boxesP1); }
    });
    expect(e.state.status).toBe('VICTORY'); expect(e.exitOpen(1)).toBe(true); expect(e.exitOpen(2)).toBe(true);
    expect(e.executeStep('W','W').step).toBe(8);
  });
});
it('stationary shoves do not move the player; blocked shoves change nothing', () => {
  const l = levels[0], r = resolvePhase1Move([1,2],[[2,2]],'R',l);
  expect(r.nextPlayer).toEqual([1,2]); expect(r.nextBoxes).toEqual([[3,2]]);
  expect(resolvePhase1Move([2,2],[[2,3]],'U',l).nextBoxes).toEqual([[2,3]]);
  expect(resolvePhase1Move([1,2],[[2,2],[3,2]],'R',l).nextBoxes).toEqual([[2,2],[3,2]]);
});
it('a queued move can be replaced before the other player commits', () => {
  const turns: string[] = [], buffer = new TurnBuffer((a,b) => turns.push(a+b),()=>{});
  buffer.queue(1,'U'); buffer.queue(1,'R'); expect(turns).toEqual([]);
  buffer.queue(2,'L'); expect(turns).toEqual(['RL']); expect(buffer.pending).toEqual([null,null]);
});
it('undo restores a failed weld and permits a new branch without stale history', () => {
  const e = new GameEngine(levels[0]); for (let i=0;i<4;i++) e.executeStep('W','W');
  expect(e.state.status).toBe('PARADOX_WELD'); e.undo(); expect(e.state.step).toBe(3); e.undo(); e.undo(); e.undo();
  for (let i=0;i<8;i++) e.executeStep(levels[0].solutionP1[i],levels[0].solutionP2[i]);
  expect(e.state.status).toBe('VICTORY'); e.undo(); expect(e.state.step).toBe(7); expect(e.executeStep('U','D').status).toBe('VICTORY');
});
it('locked replay kills a player who remains on an incoming box', () => {
  const e = new GameEngine(levels[0]); for (let i=0;i<4;i++) e.executeStep(levels[0].solutionP1[i],levels[0].solutionP2[i]);
  e.state.p1Pos = [5,2];
  expect(e.executeStep('W','L').status).toBe('PARADOX_COLLISION');
});
it('a direct attempt to move into a locked box fails', () => {
  const e = new GameEngine(levels[0]); for (let i=0;i<4;i++) e.executeStep(levels[0].solutionP1[i],levels[0].solutionP2[i]);
  e.executeStep('R','L'); e.executeStep('R','L');
  expect(e.executeStep('R','L').status).toBe('PLAYING_PHASE_2');
  expect(e.executeStep('R','L').status).toBe('PARADOX_COLLISION');
});
it('lasers bend east at the mirror and shield all cells below it', () => {
  const laser = computeLaserTiles([[4,2]],levels[3]);
  expect(laser).toContainEqual([7,2]); expect(laser).not.toContainEqual([4,1]);
  expect(isExitOpen(1,[[4,2]],laser,levels[3])).toBe(true);
  const e = new GameEngine(levels[3]); e.executeStep('W','L'); expect(e.executeStep('W','L').status).not.toBe('LASER_DEATH');
  const death = new GameEngine(levels[3]); death.executeStep('D','W'); death.executeStep('R','W'); expect(death.executeStep('R','W').status).toBe('LASER_DEATH');
});
it('ice slides in one shove, remains stationary, and replays as a catapult', () => {
  const r = resolvePhase1Move([7,3],[[6,3]],'L',levels[4]); expect(r.nextPlayer).toEqual([7,3]); expect(r.nextBoxes).toEqual([[2,3]]);
  const e = new GameEngine(levels[4]); for (let i=0;i<6;i++) e.executeStep(levels[4].solutionP1[i],levels[4].solutionP2[i]);
  expect(e.stateStack[5].boxesP1).toEqual([[2,3]]); expect(e.state.boxesP1).toEqual([[6,3]]);
});
it('missing the final exits runs out of time', () => {
  const e = new GameEngine(levels[0]); for (let i=0;i<7;i++) e.executeStep(levels[0].solutionP1[i],levels[0].solutionP2[i]);
  expect(e.executeStep('W','W').status).toBe('OUT_OF_TIME');
});
it('box identities cannot be swapped at the weld', () => {
  const e = new GameEngine(levels[2]); for (let i=0;i<3;i++) e.executeStep(levels[2].solutionP1[i],levels[2].solutionP2[i]);
  e.state.boxesP2.reverse(); expect(e.executeStep('D','U').status).toBe('PARADOX_WELD');
});
it('level import rejects invalid dimensions, walls and timelines', () => {
  expect(() => parseLevel(JSON.stringify({...levels[0], totalSteps:7}))).toThrow();
  expect(() => parseLevel(JSON.stringify({...levels[0], initialP1:[1,3]}))).toThrow();
  expect(sameCoord(parseLevel(JSON.stringify(levels[0])).initialP1,[1,1])).toBe(true);
});

describe('move selection validation', () => {
  it('rejects wall and out-of-bounds inputs without changing state or consuming either turn', () => {
    const e = new GameEngine(levels[0]), initial = structuredClone(e.state);
    for (const [a,b] of [['R','D'],['L','D'],['U','U']] as const) {
      expect(e.executeStep(a,b)).toEqual(initial);
      expect(e.stateStack).toHaveLength(1);
    }
    expect(e.executeStep('U','D').step).toBe(1);
    expect(e.state.p1Pos).toEqual([1,2]); expect(e.state.p2Pos).toEqual([7,2]);
  });
  it('does not queue invalid moves or clear the waiting partner selection', () => {
    const e = new GameEngine(levels[0]);
    const buffer = new TurnBuffer((a,b)=>e.executeStep(a,b),()=>{},(p,d)=>e.selectionError(p,d)===null);
    buffer.queue(2,'D');
    expect(buffer.queue(1,'R')).toBe(false);
    expect(buffer.pending).toEqual([null,'D']); expect(e.state.step).toBe(0);
    expect(buffer.queue(1,'U')).toBe(true);
    expect(e.state.step).toBe(1); expect(buffer.pending).toEqual([null,null]);
  });
  it('keeps a previously valid move when its replacement is blocked', () => {
    const e = new GameEngine(levels[0]);
    const buffer = new TurnBuffer((a,b)=>e.executeStep(a,b),()=>{},(p,d)=>e.selectionError(p,d)===null);
    buffer.queue(1,'U'); expect(buffer.queue(1,'R')).toBe(false);
    expect(buffer.pending).toEqual(['U',null]); buffer.queue(2,'D');
    expect(e.state.p1Pos).toEqual([1,2]); expect(e.state.step).toBe(1);
  });
  it('rejects shoves blocked by a wall, boundary or another box', () => {
    const fixtures = [
      new GameEngine({...levels[0],initialP1:[1,2],walls:[...levels[0].walls,[3,2]]}),
      new GameEngine({...levels[0],initialP1:[6,2],initialBoxesP1:[[7,2]]}),
      new GameEngine({...levels[2],initialP1:[2,4],initialBoxesP1:[[3,4],[4,4]]}),
    ];
    for (const e of fixtures) {
      expect(e.selectionError(1,'R')).toContain('cannot be shoved');
      expect(e.executeStep('R','W').step).toBe(0); expect(e.stateStack).toHaveLength(1);
    }
  });
  it('accepts stationary shoves and explicit waits', () => {
    const e = new GameEngine(levels[0]); e.executeStep('U','D');
    expect(e.selectionError(1,'R')).toBeNull();
    expect(e.executeStep('R','L').step).toBe(2);
    expect(e.state.p1Pos).toEqual([1,2]); expect(e.state.boxesP1).toEqual([[3,2]]);
    expect(e.executeStep('W','W').step).toBe(3);
  });
  it('rejects replay-phase wall bumps without advancing locked boxes', () => {
    const e = new GameEngine(levels[0]);
    for (let i=0;i<4;i++) e.executeStep(levels[0].solutionP1[i],levels[0].solutionP2[i]);
    const weld = structuredClone(e.state);
    expect(e.selectionError(1,'U')).toContain('path blocked');
    expect(e.executeStep('U','L')).toEqual(weld); expect(e.stateStack).toHaveLength(5);
    expect(e.executeStep('R','L').step).toBe(5);
  });
  it('rejects malformed replay directions without advancing', () => {
    const e = new GameEngine(levels[0]);
    expect(e.executeStep('invalid' as 'U','W').step).toBe(0);
    expect(e.executeStep('W','toString' as 'U').step).toBe(0);
  });
});
