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
    const model=new EditorModel(levels[0]);model.paint('wall',[1,2],0);expect(model.level.solutionP1).toEqual([]);expect(()=>model.start()).not.toThrow();expect(verifySolution(model.level).valid).toBe(false);model.undo();expect(verifySolution(model.level).valid).toBe(true);model.redo();expect(model.level.solutionP1).toEqual([]);
  });
  it('allows incomplete layouts as drafts, blocks broken playtests and keeps paired identities aligned',()=>{
    const model=new EditorModel();model.boxCount(3);expect(model.level.initialBoxesP2).toHaveLength(3);expect(model.level.weldTargets).toHaveLength(3);model.paint('box1',[1,2],0);expect(()=>model.start()).toThrow('spawn');model.paint('box1',[2,3],0);model.paint('box1',[4,2],1);model.paint('box1',[5,2],2);model.boxCount(1);expect(model.level.weldTargets).toHaveLength(1);model.paint('wall',[1,2],0);expect(()=>model.start()).toThrow('floor coordinate');model.paint('floor',[1,2],0);expect(()=>model.start()).not.toThrow();
  });
  it('requires an actual final victory rather than well-formed move arrays or a matching midpoint',()=>{
    const invalid=structuredClone(levels[0]);invalid.solutionP1[7]='W';const result=verifySolution(invalid);expect(result.valid).toBe(false);expect(result.step).toBe(8);expect(result.message).toContain('Time expired');invalid.solutionP1[0]='R';expect(verifySolution(invalid).message).toContain('Turn 1');
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
