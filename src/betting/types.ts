import type { LevelConfig, StepSnapshot } from '../core/types';
export type PredictionOutcome = 'escape' | 'fail';
export type MarketStatus = 'open' | 'locked' | 'escape' | 'fail' | 'void';
export interface WatchFrame {
  level: LevelConfig;
  state: StepSnapshot;
  observedAt: number;
}
export interface PublicMatch {
  id: string;
  name: string;
  players: string[];
  status: MarketStatus;
  createdAt: number;
  deadline: number;
  pool: { escape: number; fail: number };
  prediction: { outcome: PredictionOutcome; amount: number; payout: number | null } | null;
  frame: WatchFrame | null;
  delaySeconds: number;
  archive: 'pending' | 'confirmed' | 'expired';
}
export interface PredictionLobby {
  balance: number;
  matches: PublicMatch[];
  unit: 'test points';
}
