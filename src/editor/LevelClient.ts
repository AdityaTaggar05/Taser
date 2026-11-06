import type { AuthClient } from '../auth/AuthClient';
import type { LevelConfig } from '../core/types';
import type { LevelSummary, StoredLevel, LevelCatalog, ReferenceSolution } from './types';
export interface ArchiveReference {
  name: string;
  entityKey?: string;
  txHash?: string;
  storage?: 'arkiv' | 'test' | 'unconfigured';
}
export class LevelClient {
  references: ArchiveReference[] = [];
  private listeners = new Set<() => void>();
  onReferences(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private observed<T extends ArchiveReference>(rows: T[]) {
    this.references = rows.slice(0, 12);
    this.listeners.forEach((listener) => listener());
    return rows;
  }
  clearReferences() {
    this.references = [];
  }
  activity(signal?: AbortSignal) {
    return this.auth.levelRequest<import('../network/arkiv').ArkivFeed>(
      '/activity',
      undefined,
      signal,
    );
  }
  moves(sessionId: string, sequences: number[], signal?: AbortSignal) {
    return this.auth.levelRequest<import('../network/arkiv').MoveSequenceFeed>(
      `/moves/${sessionId}?sequences=${sequences.join(',')}`,
      undefined,
      signal,
    );
  }
  constructor(private auth: AuthClient) {}

  async mine() {
    return (await this.auth.levelRequest<{ levels: LevelSummary[] }>()).levels;
  }

  async community() {
    return this.observed(
      (await this.auth.levelRequest<{ levels: LevelSummary[] }>('/community')).levels,
    );
  }

  async runs(id: string, role: 1 | 2) {
    return this.observed(
      (
        await this.auth.levelRequest<{ runs: import('./types').RunSummary[] }>(
          `/runs/${id}/${role}`,
        )
      ).runs,
    );
  }
  async catalog() {
    const catalog = await this.auth.levelRequest<LevelCatalog>('/catalog');
    this.observed(catalog.campaign.map((c) => ({ ...c, storage: catalog.storage })));
    return catalog;
  }
  globalLeaderboard(page = 0) {
    return this.auth.levelRequest<
      import('../leaderboard/types').RankingPage<import('../leaderboard/types').GlobalPlayer>
    >(`/leaderboard?page=${page}`);
  }
  levelLeaderboard(id: string, mode: 'coop' | 'solo' = 'coop', page = 0) {
    return this.auth.levelRequest<import('../leaderboard/types').LevelLeaderboard>(
      `/${id}/leaderboard?mode=${mode}&page=${page}`,
    );
  }
  heart(id: string, entityKey: string) {
    return this.auth.levelRequest<import('../leaderboard/types').LevelLeaderboard>(`/${id}/heart`, {
      entityKey,
    });
  }
  template(id: string) {
    return this.auth.levelRequest<{ level: LevelConfig }>(`/campaign/${id}/template`);
  }

  solution(entityKey: string) {
    return this.auth.levelRequest<ReferenceSolution>(`/solution/${entityKey}`);
  }

  get(id: string) {
    return this.auth.levelRequest<StoredLevel>('/' + id);
  }

  save(level: LevelConfig, id?: string, revision?: number, createId?: string) {
    return this.auth.levelRequest<StoredLevel>(id ? '/' + id : '', { level, revision, createId });
  }

  publish(id: string, revision: number, target: 'community' | 'campaign' = 'community') {
    return this.auth.levelRequest<StoredLevel>(`/${id}/publish`, { revision, target });
  }

  refreshCertification(id: string) {
    return this.auth.levelRequest<StoredLevel>(`/${id}/certification`, {});
  }
}
