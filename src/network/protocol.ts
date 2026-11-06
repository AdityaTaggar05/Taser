import type { Coord, Direction, GameStatus, LevelConfig } from '../core/types';
export type Player = 1 | 2;
export const DIRECTIONS: Direction[] = ['U', 'D', 'L', 'R', 'W'];
export interface PlayerFrame {
  step: number;
  position: Coord;
  boxes: Coord[];
  status: GameStatus;
  message: string;
}
export interface SessionState {
  type: 'state';
  mode?: PlayMode;
  party?: PartyState;
  echoName?: string;
  runPublication?: 'pending' | 'confirmed';
  player: Player;
  revision: number;
  levelIndex: number;
  study?: { attempt: number; player: Player; level: LevelConfig };
  customLevelId?: string;
  customRevision?: number;
  level?: LevelConfig;
  campaign?: import('../editor/types').CampaignSummary[];
  publicationKey?: string;
  solutionAvailable?: boolean;
  history: PlayerFrame[];
  nextBoxes: Coord[] | null;
  shove: number | null;
  pendingMove: Direction | null;
  partnerReady: boolean;
  partnerConnected: boolean;
  moveErrors: Record<Direction, string | null>;
}
export type ServerMessage =
  | SessionState
  | { type: 'welcome'; token: string; sessionId?: string }
  | { type: 'error'; message: string }
  | { type: 'full'; message: string }
  | { type: 'auth_required'; message: string };
export type ClientCommand =
  | { type: 'move'; direction: Direction; revision: number }
  | { type: 'undo' | 'reset' | 'cancel'; revision: number }
  | { type: 'level'; index: number; revision: number };
export function parseCommand(value: unknown): ClientCommand | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (!Number.isSafeInteger(m.revision) || (m.revision as number) < 0) return null;
  if (m.type === 'move' && DIRECTIONS.includes(m.direction as Direction))
    return m as unknown as ClientCommand;
  if (m.type === 'undo' || m.type === 'reset' || m.type === 'cancel')
    return m as unknown as ClientCommand;
  if (m.type === 'level' && Number.isInteger(m.index)) return m as unknown as ClientCommand;
  return null;
}
export type PlayMode = 'coop' | 'solo';
export type JoinIntent =
  | { kind: 'create'; mode: PlayMode; levelId: string; player: Player; runId?: string }
  | { kind: 'invite'; code: string }
  | { kind: 'resume'; id: string };
export interface PartyState {
  id: string;
  code: string;
  host: boolean;
  started: boolean;
  members: Array<{ name: string; player: Player; ready: boolean; connected: boolean }>;
}
