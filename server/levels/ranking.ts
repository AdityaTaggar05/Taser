import type { RankingPage } from '../../src/leaderboard/types';
export const LEADERBOARD_PAGE_SIZE = 25;
/** Rank the entire ordered set before paging so personal rank stays accurate. */
export function rankingPage<T extends { accountId: string }, R>(
  rows: T[],
  viewer: string,
  page: number,
  present: (row: T, rank: number, isYou: boolean) => R,
): RankingPage<R> {
  const start = page * LEADERBOARD_PAGE_SIZE,
    index = rows.findIndex((row) => row.accountId === viewer);
  return {
    entries: rows
      .slice(start, start + LEADERBOARD_PAGE_SIZE)
      .map((row, i) => present(row, start + i + 1, row.accountId === viewer)),
    total: rows.length,
    page,
    pageSize: LEADERBOARD_PAGE_SIZE,
    me: index < 0 ? null : present(rows[index], index + 1, true),
  };
}
