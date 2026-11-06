import type { LevelConfig } from '../core/types';
export interface LevelSummary {
  id: string;
  name: string;
  subtitle: string;
  ownerName: string;
  revision: number;
  publishedRevision: number | null;
  updatedAt: number;
  width: number;
  height: number;
  totalSteps: number;
  archivedRevision?: number | null;
  readonly?: boolean;
  certification?: import('../certification/model').CertificationInfo;
  verification?: 'legacy' | import('../certification/model').CertificationMode;
  entityKey?: string;
  txHash?: string;
  storage?: 'arkiv' | 'test' | 'unconfigured';
}
export interface StoredLevel extends LevelSummary {
  level: LevelConfig;
  publication?: {
    category: 'campaign' | 'community';
    entityKey: string;
    expiresAt: string;
    txHash: string;
  };
}
export interface CampaignSummary extends LevelSummary {
  slot: number;
  entityKey: string;
}
export interface LevelCatalog {
  campaign: CampaignSummary[];
  canPublishCampaign: boolean;
  storage: 'arkiv' | 'test' | 'unconfigured';
}
export interface ReferenceSolution {
  name: string;
  solutionP1: import('../core/types').Direction[];
  solutionP2: import('../core/types').Direction[];
}
export type EditorTool =
  | 'floor'
  | 'wall'
  | 'ice'
  | 'p1'
  | 'p2'
  | 'box1'
  | 'box2'
  | 'weld'
  | 'switch1'
  | 'switch2'
  | 'exit1'
  | 'exit2'
  | 'midpoint'
  | 'laser'
  | 'receiver'
  | 'erase'
  | 'remove';
export type EditorObjectTool = Exclude<EditorTool, 'floor' | 'wall' | 'ice' | 'erase' | 'remove'>;
export type EditorView = 'author' | 'p1' | 'p2';

export interface RunSummary {
  id: string;
  name: string;
  role: 1 | 2;
  turns: number;
  mode: 'solo' | 'coop';
  createdAt: number;
  entityKey: string;
  expiresAt: string;
  txHash?: string;
  storage?: 'arkiv' | 'test' | 'unconfigured';
}
