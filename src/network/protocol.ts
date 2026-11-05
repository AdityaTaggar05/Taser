import type { Coord, Direction, GameStatus } from '../core/types';
export type Player = 1 | 2;
export const DIRECTIONS: Direction[] = ['U','D','L','R','W'];
export interface PlayerFrame {
  step: number; position: Coord; boxes: Coord[]; status: GameStatus; message: string;
}
export interface SessionState {
  type: 'state'; player: Player; revision: number; levelIndex: number;
  history: PlayerFrame[]; nextBoxes: Coord[] | null; shove: number | null;
  pendingMove: Direction | null; partnerReady: boolean; partnerConnected: boolean;
  moveErrors: Record<Direction, string | null>;
}
export type ServerMessage = SessionState | { type: 'welcome'; token: string } | { type: 'error'; message: string } | { type: 'full'; message: string };
export type ClientCommand = { type:'move'; direction:Direction; revision:number } | { type:'undo'|'reset'|'cancel'; revision:number } | { type:'level'; index:number; revision:number };
export function parseCommand(value: unknown): ClientCommand | null {
  if (!value || typeof value!=='object') return null;
  const m=value as Record<string,unknown>;
  if (!Number.isSafeInteger(m.revision) || (m.revision as number)<0) return null;
  if (m.type==='move' && DIRECTIONS.includes(m.direction as Direction)) return m as unknown as ClientCommand;
  if (m.type==='undo'||m.type==='reset'||m.type==='cancel') return m as unknown as ClientCommand;
  if (m.type==='level' && Number.isInteger(m.index)) return m as unknown as ClientCommand;
  return null;
}
