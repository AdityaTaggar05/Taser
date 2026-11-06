import type { AuthClient } from '../auth/AuthClient';
import type { LevelConfig } from '../core/types';
import type { LevelSummary, StoredLevel, LevelCatalog, ReferenceSolution } from './types';
export class LevelClient {
  constructor(private auth: AuthClient) {}

  async mine() {
    return (await this.auth.levelRequest<{ levels: LevelSummary[] }>()).levels;
  }

  async community() {
    return (await this.auth.levelRequest<{ levels: LevelSummary[] }>('/community')).levels;
  }

  async runs(id: string, role: 1 | 2) {
    return (
      await this.auth.levelRequest<{ runs: import('./types').RunSummary[] }>(`/runs/${id}/${role}`)
    ).runs;
  }

  catalog() {
    return this.auth.levelRequest<LevelCatalog>('/catalog');
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
