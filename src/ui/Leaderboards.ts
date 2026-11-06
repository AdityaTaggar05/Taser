import './published.css';
import type { LevelClient } from '../editor/LevelClient';
import type {
  GlobalPlayer,
  LevelPlayer,
  LevelLeaderboard,
  RankingPage,
} from '../leaderboard/types';

export function remainingLifetime(expiry: LevelLeaderboard['expiry'], elapsedMs: number) {
  const seconds = Math.max(
    0,
    Math.ceil(
      Number(BigInt(expiry.expiresAt) - BigInt(expiry.currentBlock)) * expiry.blockSeconds -
        elapsedMs / 1000,
    ),
  );
  if (!seconds) return 'Checking chain expiration…';
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    rest = seconds % 60;
  return `Estimated time left ${hours}h ${String(minutes).padStart(2, '0')}m ${String(rest).padStart(2, '0')}s`;
}

export class Leaderboards {
  readonly root = document.createElement('main');
  private generation = 0;
  private loading = false;
  private page = 0;
  private mode: 'coop' | 'solo' = 'coop';
  private id: string | undefined;
  private board: LevelLeaderboard | undefined;
  private receivedAt = 0;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private clock: ReturnType<typeof setInterval> | undefined;
  private visible = () => {
    if (!document.hidden && !this.root.hidden) void this.load();
  };
  constructor(
    private api: LevelClient,
    private actions: { home: () => void; fullscreen: () => void },
  ) {
    this.root.id = 'leaderboards';
    this.root.hidden = true;
    document.body.append(this.root);
    document.addEventListener('visibilitychange', this.visible);
  }
  show(visible: boolean, hash = '') {
    this.generation++;
    clearTimeout(this.poll);
    clearInterval(this.clock);
    this.loading = false;
    this.board = undefined;
    this.root.hidden = !visible;
    if (!visible) {
      this.root.replaceChildren();
      return;
    }
    this.id = /^#leaderboard\/([a-f0-9-]{36})$/.exec(hash)?.[1];
    this.page = 0;
    this.mode = 'coop';
    this.root.innerHTML = `<header class="published-header"><button data-board="home">← Home</button><span>WELDPOINT / LEADERBOARDS</span><button data-board="fullscreen" aria-label="Fullscreen">⛶</button></header><section class="published-content"><p class="archive-kicker">VERIFIED ON THE TIMELINE</p><h1>Global leaderboard</h1><p class="archive-intro"></p><nav class="leaderboard-links"><a href="#leaderboard">Global standings ↗</a><a href="#coop/community">Browse chambers ↗</a></nav><div class="level-lifetime" hidden><p class="expiry-clock"></p><p class="expiry-block"></p><button data-board="heart">♡ Heart · add 1 hour</button><span class="heart-count"></span></div><div class="archive-tabs" hidden><button data-mode="coop" aria-pressed="true">Co-op</button><button data-mode="solo" aria-pressed="false">Solo</button></div><button class="archive-refresh" data-board="refresh">Refresh ↻</button><p class="leaderboard-personal"></p><div class="leaderboard-table"></div><nav class="leaderboard-pages" aria-label="Leaderboard pages"><button data-board="previous">← Previous</button><span class="leaderboard-page"></span><button data-board="next">Next →</button></nav><p class="archive-status" role="status" aria-live="polite"></p></section>`;
    this.root.querySelector('[data-board=home]')!.addEventListener('click', this.actions.home);
    this.root
      .querySelector('[data-board=fullscreen]')!
      .addEventListener('click', this.actions.fullscreen);
    this.root.querySelector('.archive-intro')!.textContent = this.id
      ? 'Best verified result per operator. Fewest turns wins; earlier results break ties. Solo and co-op have separate standings.'
      : 'Distinct chambers completed in co-op, including campaign and community. Repeat wins and revisions count once. Solo results appear on each chamber’s board.';
    this.root.querySelector<HTMLElement>('.level-lifetime')!.hidden = !this.id;
    this.root.querySelector<HTMLElement>('.archive-tabs')!.hidden = !this.id;
    this.button('refresh').onclick = () => {
      void this.load();
    };
    this.button('heart').onclick = () => {
      void this.heart();
    };
    this.button('previous').onclick = () => {
      if (!this.loading && this.page > 0) {
        this.page--;
        void this.load();
      }
    };
    this.button('next').onclick = () => {
      if (!this.loading) {
        this.page++;
        void this.load();
      }
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.onclick = () => {
        if (this.loading) return;
        this.mode = button.dataset.mode as 'coop' | 'solo';
        this.page = 0;
        this.root
          .querySelectorAll('[data-mode]')
          .forEach((tab) =>
            tab.setAttribute(
              'aria-pressed',
              String((tab as HTMLElement).dataset.mode === this.mode),
            ),
          );
        void this.load();
      };
    });
    this.clock = setInterval(() => this.countdown(), 1000);
    void this.load();
  }
  private button(name: string) {
    return this.root.querySelector<HTMLButtonElement>(`[data-board=${name}]`)!;
  }
  private status(message: string) {
    this.root.querySelector('.archive-status')!.textContent = message;
  }
  private countdown() {
    if (this.board && !document.hidden)
      this.root.querySelector('.expiry-clock')!.textContent = remainingLifetime(
        this.board.expiry,
        performance.now() - this.receivedAt,
      );
  }
  private async load(notice = '') {
    if (this.loading || this.root.hidden) return;
    this.loading = true;
    clearTimeout(this.poll);
    const generation = this.generation;
    this.button('refresh').disabled = true;
    this.button('heart').disabled = true;
    this.status('Loading verified standings…');
    try {
      const response = this.id
        ? await this.api.levelLeaderboard(this.id, this.mode, this.page)
        : await this.api.globalLeaderboard(this.page);
      if (generation !== this.generation) return;
      let scores: RankingPage<GlobalPlayer | LevelPlayer>;
      if ('scores' in response) {
        this.board = response;
        this.receivedAt = performance.now();
        scores = response.scores;
        this.root.querySelector('h1')!.textContent = response.level.name;
        this.root.querySelector('.expiry-block')!.textContent =
          `Expiry block ${response.expiry.expiresAt} · observed block ${response.expiry.currentBlock}. Block production determines expiry; this countdown is an estimate.`;
        const heart = this.button('heart');
        heart.disabled = response.hearts.hearted;
        heart.setAttribute('aria-pressed', String(response.hearts.hearted));
        heart.textContent = response.hearts.hearted
          ? '♥ Heart confirmed'
          : response.hearts.pending
            ? 'Retry heart confirmation'
            : '♡ Heart · add 1 hour';
        this.root.querySelector('.heart-count')!.textContent =
          `${response.hearts.count} confirmed ${response.hearts.count === 1 ? 'heart' : 'hearts'} · one per operator per revision`;
        this.countdown();
      } else scores = response;
      this.renderScores(scores);
      this.status(
        notice ||
          (scores.total
            ? 'Standings refresh every 15 seconds.'
            : this.id
              ? 'No verified wins yet. Complete this chamber to set the first score.'
              : 'No co-op completions yet. Secure a chamber with a partner to join the board.'),
      );
    } catch (error) {
      if (generation !== this.generation) return;
      this.board = undefined;
      this.root.querySelector('.expiry-clock')!.textContent = 'Expiry unavailable';
      this.root.querySelector('.leaderboard-table')!.replaceChildren();
      this.root.querySelector('.leaderboard-personal')!.textContent = '';
      this.button('previous').disabled = true;
      this.button('next').disabled = true;
      this.status((error as Error).message + ' Use Refresh to retry.');
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.button('refresh').disabled = false;
        this.poll = setTimeout(() => {
          if (document.hidden) this.visible();
          else void this.load();
        }, 15_000);
      }
    }
  }
  private renderScores(scores: RankingPage<GlobalPlayer | LevelPlayer>) {
    const table = document.createElement('table');
    table.className = 'leaderboard-results';
    const caption = table.createCaption();
    caption.textContent = this.id
      ? `${this.mode === 'coop' ? 'Co-op' : 'Solo'} · revision ${this.board!.level.revision}`
      : 'Global co-op completions';
    const header = table.createTHead().insertRow();
    for (const label of ['Rank', 'Operator', this.id ? 'Best turns' : 'Chambers completed']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      header.append(cell);
    }
    const body = table.createTBody();
    for (const entry of scores.entries) {
      const row = body.insertRow();
      if (entry.isYou) row.className = 'leaderboard-you';
      for (const value of [
        String(entry.rank),
        entry.name + (entry.isYou ? ' (you)' : ''),
        'completed' in entry ? String(entry.completed) : `${entry.turns} · P${entry.role}`,
      ])
        row.insertCell().textContent = value;
    }
    this.root.querySelector('.leaderboard-table')!.replaceChildren(table);
    this.root.querySelector('.leaderboard-personal')!.textContent = scores.me
      ? `Your rank: #${scores.me.rank} of ${scores.total}`
      : 'Complete a co-op chamber to enter the global standings.';
    if (this.id && !scores.me)
      this.root.querySelector('.leaderboard-personal')!.textContent =
        `Win this chamber in ${this.mode === 'coop' ? 'co-op' : 'solo'} to enter these standings.`;
    this.root.querySelector('.leaderboard-page')!.textContent =
      `Page ${scores.page + 1} of ${Math.max(1, Math.ceil(scores.total / scores.pageSize))}`;
    this.button('previous').disabled = this.page === 0;
    this.button('next').disabled = (this.page + 1) * scores.pageSize >= scores.total;
  }
  private async heart() {
    if (this.loading || !this.board || this.board.hearts.hearted) return;
    const generation = this.generation,
      id = this.id!,
      key = this.board.level.entityKey;
    this.loading = true;
    clearTimeout(this.poll);
    this.button('heart').disabled = true;
    this.button('refresh').disabled = true;
    this.status('Confirming heart and extending the chamber…');
    let notice = 'Heart confirmed. One hour added to the Arkiv expiration block.';
    try {
      await this.api.heart(id, key);
    } catch (error) {
      notice = (error as Error).message;
    }
    if (generation !== this.generation) return;
    this.loading = false;
    await this.load(notice);
  }
  destroy() {
    this.generation++;
    clearTimeout(this.poll);
    clearInterval(this.clock);
    document.removeEventListener('visibilitychange', this.visible);
    this.root.remove();
  }
}
