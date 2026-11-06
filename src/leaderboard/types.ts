export interface RankedPlayer {
  rank: number;
  name: string;
  isYou: boolean;
}
export interface GlobalPlayer extends RankedPlayer {
  completed: number;
}
export interface LevelPlayer extends RankedPlayer {
  turns: number;
  achievedAt: number;
  role: 1 | 2;
}
export interface RankingPage<T> {
  entries: T[];
  total: number;
  page: number;
  pageSize: number;
  me: T | null;
}
export interface LevelLeaderboard {
  level: { id: string; name: string; revision: number; entityKey: string };
  expiry: { expiresAt: string; currentBlock: string; observedAt: number; blockSeconds: number };
  hearts: { count: number; hearted: boolean; pending: boolean };
  mode: 'coop' | 'solo';
  scores: RankingPage<LevelPlayer>;
}
