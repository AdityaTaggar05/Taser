import {describe,it,expect} from 'vitest';
import {parseLevel} from '../src/core/level';
import {levels} from '../server/data/campaign';
import {cleanDraft,validateDraft} from '../src/core/levelValidation';
import {EditorModel,blankLevel} from '../src/editor/EditorModel';
import {verifySolution} from '../src/editor/solution';
const solve=(model:EditorModel,index=0)=>{for(let k=0;k<levels[index].solutionP1.length&&model.engine?.state.status!=='VICTORY';k++){model.queue(1,levels[index].solutionP1[k]);model.queue(2,levels[index].solutionP2[k]);}};
describe('creator witnesses',()=>{
  for(const level of levels)it(`replays both recorded roles using the actual engine: ${level.name}`,()=>{
    expect(verifySolution(level).valid).toBe(true);const model=new EditorModel(level);model.start();solve(model,level.id-1);expect(model.engine?.state.status).toBe('VICTORY');expect(model.capture().valid).toBe(true);
  });
  it('supports a blank floor with editable starter objects and records a fresh winning solution',()=>{
    const model=new EditorModel(blankLevel());expect(model.level.walls).toEqual([]);expect(verifySolution(model.level).valid).toBe(false);model.start();solve(model);expect(model.capture().valid).toBe(true);expect(parseLevel(JSON.stringify(model.level))).toEqual(model.level);
  });
  it('does not count blocked inputs or discard the other queued input',()=>{
    const model=new EditorModel(levels[0]);model.start();model.queue(2,'D');expect(()=>model.queue(1,'R')).toThrow('blocked');expect(model.engine?.state.step).toBe(0);expect(model.pending).toEqual([null,'D']);expect(model.moves).toEqual([[],[]]);model.queue(1,'U');expect(model.engine?.state.step).toBe(1);expect(model.moves).toEqual([['U'],['D']]);model.undoTurn();expect(model.moves).toEqual([[],[]]);expect(model.pending).toEqual([null,null]);
  });
  it('invalidates witnesses on edits and restores them only when undo restores the exact level',()=>{
    const model=new EditorModel(levels[0]);model.edit(l=>{l.subtitle='Updated description';});expect(model.level.solutionP1).toEqual([]);expect(()=>model.start()).not.toThrow();expect(verifySolution(model.level).valid).toBe(false);model.undo();expect(verifySolution(model.level).valid).toBe(true);model.redo();expect(model.level.solutionP1).toEqual([]);
  });
  it('allows incomplete layouts as drafts, blocks broken playtests and keeps paired identities aligned',()=>{
    const model=new EditorModel();model.boxCount(3);expect(model.level.initialBoxesP2).toHaveLength(3);expect(model.level.weldTargets).toHaveLength(3);model.paint('box1',[1,2],0);expect(()=>model.start()).toThrow('spawn');model.paint('box1',[2,3],0);model.paint('box1',[4,2],1);model.paint('box1',[5,2],2);model.boxCount(1);expect(model.level.weldTargets).toHaveLength(1);model.edit(l=>{l.walls.push([1,2]);});expect(()=>model.start()).toThrow('floor coordinate');model.paint('floor',[1,2],0);expect(()=>model.start()).not.toThrow();
  });
  it('requires an actual final victory rather than well-formed move arrays or a matching midpoint',()=>{
    const invalid=structuredClone(levels[0]);invalid.solutionP1[7]='W';const result=verifySolution(invalid);expect(result.valid).toBe(false);expect(result.step).toBe(8);expect(result.message).toContain('Time expired');invalid.solutionP1[0]='R';expect(verifySolution(invalid).message).toContain('Turn 1');
  });
  it('supports drag-and-drop object relocation and hierarchical removal',()=>{
    const model=new EditorModel(blankLevel());
    model.moveObject('p1',[1,2],[1,1]);
    expect(model.level.initialP1).toEqual([1,1]);
    model.moveObject('p2',[7,4],[7,5]);
    expect(model.level.initialP2).toEqual([7,5]);
    model.moveObject('box1',[2,3],[3,3],0);
    expect(model.level.initialBoxesP1[0]).toEqual([3,3]);
    model.moveObject('switch1',[6,3],[5,3]);
    expect(model.level.switchesP1).toEqual([[5,3]]);

    expect(model.level.switchesP1).toHaveLength(1);
    model.paint('switch1',[5,3],0);
    expect(model.level.switchesP1).toEqual([]);
    model.paint('switch1',[5,3],0);
    expect(model.level.switchesP1).toEqual([[5,3]]);

    model.paint('wall',[4,4],0);
    expect(model.level.walls.some(p=>p[0]===4&&p[1]===4)).toBe(true);
    model.paint('remove',[4,4],0);
    expect(model.level.walls.some(p=>p[0]===4&&p[1]===4)).toBe(false);

    model.paint('remove',[5,3],0);
    expect(model.level.switchesP1.some(p=>p[0]===5&&p[1]===3)).toBe(false);

    model.boxCount(2);
    expect(model.level.initialBoxesP1).toHaveLength(2);
    const box2Pos = model.level.initialBoxesP1[1];
    model.paint('remove',box2Pos,0);
    expect(model.level.initialBoxesP1).toHaveLength(1);
  });
  it('allows building a custom chamber end-to-end with the level making mechanics and recording a winning solution',()=>{
    const model=new EditorModel();
    model.resize(5,3);
    model.edit(l=>{l.totalSteps=4;l.weldStep=2;});
    model.paint('wall',[1,3],0);
    model.paint('wall',[5,3],0);
    model.moveObject('p1',model.level.initialP1,[1,1]);
    model.moveObject('p2',model.level.initialP2,[5,1]);
    model.moveObject('exit1',model.level.exitP1,[1,2]);
    model.moveObject('exit2',model.level.exitP2,[5,2]);
    model.moveObject('box1',model.level.initialBoxesP1[0],[2,1],0);
    model.moveObject('box2',model.level.initialBoxesP2[0],[4,1],0);
    model.moveObject('weld',model.level.weldTargets![0],[3,1],0);
    model.edit(l=>{l.switchesP1=[[3,1]];l.switchesP2=[[3,1]];});

    model.start();
    expect(model.engine).not.toBeNull();
    model.queue(1,'R');
    model.queue(2,'L');
    expect(model.engine?.state.step).toBe(1);
    model.queue(1,'W');
    model.queue(2,'W');
    expect(model.engine?.state.step).toBe(2);
    expect(model.engine?.state.status).toBe('WELD_SUCCESS');
    model.queue(1,'U');
    model.queue(2,'U');
    expect(model.engine?.state.status).toBe('VICTORY');
    const check=model.capture();
    expect(check.valid).toBe(true);
    expect(model.level.solutionP1).toEqual(['R','W','U']);
    expect(model.level.solutionP2).toEqual(['L','W','U']);
  });
});
it('bounds imported data and rejects inherited move names and malformed optional fields',()=>{
  for(const change of [{width:1000},{totalSteps:1000,weldStep:500},{solutionP1:['toString']},{solutionP1:['constructor']},{iceTiles:{}},{hasMirrorBox:'yes'},{name:'x'.repeat(81)},{laserEmitter:{pos:[1,1],dir:'W'}}])expect(()=>validateDraft({...blankLevel(),...change})).toThrow();
  expect(cleanDraft({...blankLevel(),script:'alert(1)',assets:{wall:'https://example.com'}})).not.toHaveProperty('script');expect(cleanDraft({...blankLevel(),assets:{}})).not.toHaveProperty('assets');
});
it('resizes every coordinate layer and requires overlap repairs rather than silently dropping paired boxes',()=>{
  const model=new EditorModel(levels[2]);model.resize(2,2);expect(model.level.initialBoxesP1).toHaveLength(2);for(const coord of [...(model.level.weldTargets??[]),...model.level.initialBoxesP1,...model.level.initialBoxesP2])expect(coord.every(n=>n<=2)).toBe(true);expect(()=>model.start()).toThrow();
});
it('verifies author-selected timelines rather than assuming the campaign has eight turns',()=>{
  for(const turns of [4,32]){const level=blankLevel();level.width=3;level.height=3;level.totalSteps=turns;level.weldStep=turns/2;level.initialP1=level.exitP1=[1,1];level.initialP2=level.exitP2=[3,1];level.initialBoxesP1=[[2,2]];level.initialBoxesP2=[[2,2]];level.weldTargets=[[2,2]];level.switchesP1=[[2,2]];level.switchesP2=[[2,2]];level.solutionP1=Array(turns).fill('W');level.solutionP2=Array(turns).fill('W');expect(verifySolution(level)).toMatchObject({valid:true,step:turns/2+1});}
});

describe('editor object edits',()=>{
  it('removes one overlay without also erasing the wall underneath',()=>{
    const model=new EditorModel();
    model.paint('switch1',[4,4],0);model.edit(l=>{l.walls.push([4,4]);});
    model.paint('remove',[4,4],0);
    expect(model.level.switchesP1).not.toContainEqual([4,4]);
    expect(model.level.walls).toContainEqual([4,4]);
    model.paint('remove',[4,4],0);
    expect(model.level.walls).not.toContainEqual([4,4]);
  });
  it('removes the corresponding pair and weld target, and restores all three on undo',()=>{
    const model=new EditorModel();model.boxCount(3);
    const before=structuredClone(model.level);
    model.paint('remove',before.initialBoxesP2[1],0);
    expect(model.level.initialBoxesP1).toEqual([before.initialBoxesP1[0],before.initialBoxesP1[2]]);
    expect(model.level.initialBoxesP2).toEqual([before.initialBoxesP2[0],before.initialBoxesP2[2]]);
    expect(model.level.weldTargets).toEqual([before.weldTargets![0],before.weldTargets![2]]);
    model.undo();expect(model.level).toEqual(before);
    model.redo();expect(model.level.initialBoxesP1).toHaveLength(2);
  });
  it('preserves required objects and the last box pair when removing',()=>{
    const model=new EditorModel();
    const before=structuredClone(model.level);
    for(const pos of [before.initialP1,before.initialP2,before.exitP1,before.exitP2,...before.initialBoxesP1,...before.initialBoxesP2])model.paint('remove',pos,0);
    expect(model.level.initialP1).toEqual(before.initialP1);
    expect(model.level.initialP2).toEqual(before.initialP2);
    expect(model.level.exitP1).toEqual(before.exitP1);
    expect(model.level.exitP2).toEqual(before.exitP2);
    expect(model.level.initialBoxesP1).toEqual(before.initialBoxesP1);
    expect(model.level.initialBoxesP2).toEqual(before.initialBoxesP2);
  });
  it('keeps a same-cell drop a no-op and invalidates the solution only on a real move',()=>{
    const model=new EditorModel(levels[0]);
    const before=structuredClone(model.level);
    expect(model.moveObject('p1',before.initialP1,before.initialP1)).toBe(false);
    expect(model.canUndo).toBe(false);expect(model.level).toEqual(before);
    model.moveObject('p1',before.initialP1,[4,4]);
    expect(model.level.solutionP1).toEqual([]);expect(model.level.solutionP2).toEqual([]);
    model.undo();expect(model.level).toEqual(before);
  });
  it('moves optional objects without toggling them and clears walls at the destination',()=>{
    const model=new EditorModel();
    model.paint('laser',[3,3],0);model.edit(l=>{l.laserEmitter!.dir='L';});
    model.paint('wall',[4,4],0);model.moveObject('laser',[3,3],[4,4]);
    expect(model.level.laserEmitter).toEqual({pos:[4,4],dir:'L'});
    expect(model.level.walls).not.toContainEqual([4,4]);
    model.paint('switch1',[4,4],0);model.moveObject('switch1',[6,3],[4,4]);
    expect(model.level.switchesP1).toEqual([[4,4]]);
    model.moveObject('p1',model.level.initialP1,[-1,20]);
    expect(model.level.initialP1).toEqual([1,5]);
  });
});

it('protects every object layer from wall painting, including objects hidden in a player view',()=>{
  const level=blankLevel();
  level.midpointSwitchRequired=[2,5];level.laserEmitter={pos:[3,5],dir:'D'};level.laserReceiverP1=[4,5];
  const model=new EditorModel(level);
  const occupied=[level.initialP1,level.initialP2,level.exitP1,level.exitP2,
    ...level.initialBoxesP1,...level.initialBoxesP2,...level.weldTargets!,
    ...level.switchesP1,...level.switchesP2,level.midpointSwitchRequired,level.laserEmitter.pos,level.laserReceiverP1];
  const before=structuredClone(model.level);
  for(const pos of occupied)expect(model.paint('wall',pos,0)).toBe(false);
  expect(model.level).toEqual(before);expect(model.canUndo).toBe(false);
  expect(model.paint('wall',[1,5],0)).toBe(true);
  expect(model.level.walls).toEqual([[1,5]]);
});
