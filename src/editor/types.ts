import type {LevelConfig} from '../core/types';
export interface LevelSummary {id:string;name:string;subtitle:string;ownerName:string;revision:number;publishedRevision:number|null;updatedAt:number;width:number;height:number;totalSteps:number}
export interface StoredLevel extends LevelSummary {level:LevelConfig}
export type EditorTool='floor'|'wall'|'ice'|'p1'|'p2'|'box1'|'box2'|'weld'|'switch1'|'switch2'|'exit1'|'exit2'|'midpoint'|'laser'|'receiver'|'erase';
export type EditorView='author'|'p1'|'p2';
