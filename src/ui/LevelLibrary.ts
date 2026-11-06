import type { LevelClient } from '../editor/LevelClient';
import type { LevelSummary } from '../editor/types';
import type { LevelLeaderboard } from '../leaderboard/types';
import { playOptions, saveOptions } from './preferences';
import { certificateEvidence } from './CertificateEvidence';
export function expirySeconds(expiry: LevelLeaderboard['expiry'], now = Date.now()) {
  return Math.max(
    0,
    Number(BigInt(expiry.expiresAt) - BigInt(expiry.currentBlock)) * expiry.blockSeconds -
      Math.max(0, now - expiry.observedAt) / 1000,
  );
}
export class LevelLibrary {
  private entries: LevelSummary[] = [];
  private stats = new Map<string, LevelLeaderboard>();
  private selected = '';
  private sort = 'newest';
  private search = '';
  private alive = true;
  private timer: ReturnType<typeof setInterval>;
  private rows: HTMLTableSectionElement;
  constructor(
    private root: Element,
    private api: LevelClient,
    mode: 'solo' | 'coop',
    category: 'campaign' | 'community',
    private status: (s: string) => void,
  ) {
    playOptions.players = mode;
    playOptions.collection = category;
    saveOptions();
    root.innerHTML = `<div class="library-layout"><section class="level-database"><div class="database-toolbar"><label class="search-label">⌕ <input type="search" placeholder="Find a chamber…" aria-label="Search levels"></label><label class="sort-label">Sort <select aria-label="Sort levels"><option value="newest">Newest</option><option value="popular">Most popular</option>${category === 'community' ? '<option value="expiry">Expiring first</option>' : ''}</select></label><button class="library-refresh" aria-label="Refresh levels">↻</button></div><div class="database-scroll"><table class="chamber-table"><thead><tr><th scope="col">Title</th><th scope="col">Creator / runner</th><th scope="col">Likes</th>${category === 'community' ? '<th scope="col">Time to expiry</th>' : ''}</tr></thead><tbody></tbody></table></div><p class="database-footnote">ARKIV / Published chambers · expiry estimated from block time</p></section><aside class="launch-panel"><p class="folio">YOUR TIMELINE</p><div class="option-cycler"><small>PLAYERS</small><button data-cycle="players" aria-label="Change players">‹</button><b data-option="players"></b><button data-cycle="players" aria-label="Next players">›</button></div><div class="option-cycler"><small>COLLECTION</small><button data-cycle="collection" aria-label="Change collection">‹</button><b data-option="collection"></b><button data-cycle="collection" aria-label="Next collection">›</button></div><div class="option-cycler"><small>ROLE</small><button data-cycle="role" aria-label="Change role">‹</button><b data-option="role"></b><button data-cycle="role" aria-label="Next role">›</button></div><div class="selected-chamber"><span class="folio">SELECTED CHAMBER</span><h2>Choose a level</h2><p></p></div><button class="ink-button start-chamber" disabled>Start <span>↗</span></button><div class="selected-evidence"></div><a class="text-button" href="#">← Back</a></aside></div>`;
    this.rows = root.querySelector('tbody')!;
    root.querySelector('input')!.addEventListener('input', (e) => {
      this.search = (e.target as HTMLInputElement).value.toLowerCase();
      this.render();
    });
    root.querySelector('select')!.addEventListener('change', (e) => {
      this.sort = (e.target as HTMLSelectElement).value;
      this.render();
    });
    root.querySelector('.library-refresh')!.addEventListener('click', () => void this.load());
    root.querySelectorAll<HTMLButtonElement>('[data-cycle]').forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.cycle === 'role') {
            playOptions.role = playOptions.role === 1 ? 2 : 1;
            saveOptions();
            this.options();
          } else {
            if (b.dataset.cycle === 'players')
              playOptions.players = playOptions.players === 'solo' ? 'coop' : 'solo';
            else
              playOptions.collection =
                playOptions.collection === 'campaign' ? 'community' : 'campaign';
            saveOptions();
            location.hash = `${playOptions.players}/${playOptions.collection}`;
          }
        }),
    );
    root.querySelector('.start-chamber')!.addEventListener('click', () => {
      if (this.selected)
        location.hash = `${playOptions.players}/${playOptions.collection}/${this.selected}/p${playOptions.role}`;
    });
    this.options();
    this.timer = setInterval(() => this.updateClocks(), 1000);
    void this.load();
  }
  private options() {
    for (const [key, value] of Object.entries({
      players: playOptions.players === 'solo' ? 'Solo' : 'Co-op',
      collection: playOptions.collection === 'campaign' ? 'Campaign' : 'Community',
      role: playOptions.role === 1 ? 'Forward' : 'Reverse',
    }))
      this.root.querySelector(`[data-option=${key}]`)!.textContent = value;
  }
  private async load() {
    const button = this.root.querySelector<HTMLButtonElement>('.library-refresh')!;
    if (button.disabled) return;
    button.disabled = true;
    this.status('Loading published chambers…');
    try {
      let storage: string | undefined;
      if (playOptions.collection === 'campaign') {
        const catalog = await this.api.catalog();
        this.entries = catalog.campaign;
        storage = catalog.storage;
      } else {
        this.entries = await this.api.community();
        storage = this.entries[0]?.storage;
      }
      if (!this.alive) return;
      this.root.querySelector('.database-footnote')!.textContent =
        `${storage === 'test' ? 'TEST ARCHIVE / Simulated records' : storage === 'unconfigured' ? 'ARKIV NOT CONFIGURED' : storage ? 'ARKIV / Published chambers' : 'No publications'} ${playOptions.collection === 'community' ? ' · estimated expiry' : ''}`;
      if (!this.entries.some((e) => e.id === this.selected)) {
        this.selected = '';
        this.root.querySelector<HTMLButtonElement>('.start-chamber')!.disabled = true;
      }
      this.stats.clear();
      this.render();
      let cursor = 0,
        unavailable = 0;
      // Bound parallel requests; rankings also supply authoritative likes and expiry observations.
      await Promise.all(
        Array.from({ length: Math.min(4, this.entries.length) }, async () => {
          while (this.alive && cursor < this.entries.length) {
            const entry = this.entries[cursor++];
            try {
              const stats = await this.api.levelLeaderboard(entry.id, playOptions.players);
              if (this.alive) this.stats.set(entry.id, stats);
            } catch {
              unavailable++;
            }
          }
        }),
      );
      if (!this.alive) return;
      this.render();
      this.status(
        this.entries.length
          ? `${this.entries.length} chambers${unavailable ? ' · Some likes and expiry data are unavailable. Refresh to retry.' : ' · Select a chamber to begin.'}`
          : 'No published chambers yet. Create and publish the first one.',
      );
    } catch (e) {
      if (this.alive) this.status((e as Error).message + ' Refresh to retry.');
    } finally {
      if (this.alive) button.disabled = false;
    }
  }
  private render() {
    const focused = (document.activeElement as HTMLElement)?.dataset.selectLevel;
    this.rows.replaceChildren();
    const entries = this.entries
      .filter((e) => `${e.name} ${e.ownerName}`.toLowerCase().includes(this.search))
      .sort((a, b) => {
        if (this.sort === 'popular')
          return (
            (this.stats.get(b.id)?.hearts.count ?? -1) -
              (this.stats.get(a.id)?.hearts.count ?? -1) || b.updatedAt - a.updatedAt
          );
        if (this.sort === 'expiry')
          return (
            (this.stats.has(a.id) ? expirySeconds(this.stats.get(a.id)!.expiry) : Infinity) -
              (this.stats.has(b.id) ? expirySeconds(this.stats.get(b.id)!.expiry) : Infinity) ||
            b.updatedAt - a.updatedAt
          );
        return b.updatedAt - a.updatedAt;
      });
    for (const entry of entries) {
      const tr = this.rows.insertRow();
      tr.dataset.levelId = entry.id;
      const select = document.createElement('button');
      select.dataset.selectLevel = entry.id;
      select.textContent = entry.name;
      select.setAttribute('aria-pressed', String(entry.id === this.selected));
      select.onclick = () => this.select(entry);
      tr.insertCell().append(select);
      const by = tr.insertCell(),
        creator = document.createElement('span'),
        runner = document.createElement('small');
      creator.textContent = entry.ownerName;
      runner.textContent = this.stats.get(entry.id)?.scores.entries[0]?.name
        ? 'Best: ' + this.stats.get(entry.id)!.scores.entries[0].name
        : this.stats.has(entry.id)
          ? 'No ranked runner'
          : 'Rank unavailable';
      by.append(creator, runner);
      const likes = tr.insertCell(),
        board = document.createElement('a');
      board.href = '#leaderboard/' + entry.id;
      board.textContent = this.stats.has(entry.id)
        ? '♡ ' + this.stats.get(entry.id)!.hearts.count
        : '—';
      board.setAttribute('aria-label', `Likes and leaderboard for ${entry.name}`);
      likes.append(board);
      if (playOptions.collection === 'community') {
        const expiry = tr.insertCell();
        expiry.dataset.expiryId = entry.id;
      }
      tr.onclick = (event) => {
        if (!(event.target as HTMLElement).closest('a,button')) this.select(entry);
      };
      tr.classList.toggle('selected', entry.id === this.selected);
    }
    if (!entries.length) {
      const cell = this.rows.insertRow().insertCell();
      cell.colSpan = 4;
      cell.className = 'database-empty';
      cell.textContent = this.entries.length
        ? 'No chambers match your search.'
        : 'Your next challenge will appear here.';
    }
    this.updateClocks();
    if (focused)
      Array.from(this.rows.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.dataset.selectLevel === focused)
        ?.focus({ preventScroll: true });
  }
  private updateClocks() {
    this.root.querySelectorAll<HTMLElement>('[data-expiry-id]').forEach((cell) => {
      const stats = this.stats.get(cell.dataset.expiryId!);
      if (!stats) {
        cell.textContent = '—';
        cell.title = 'Expiry not available';
        return;
      }
      const secs = expirySeconds(stats.expiry);
      cell.textContent =
        secs > 0
          ? `≈ ${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`
          : 'Check expiry';
      cell.title = `Estimated from observed block ${stats.expiry.currentBlock}; expires at block ${stats.expiry.expiresAt}. Refresh for latest chain state.`;
    });
  }
  private select(entry: LevelSummary) {
    this.selected = entry.id;
    this.root.querySelector('.selected-chamber h2')!.textContent = entry.name;
    this.root.querySelector('.selected-chamber p')!.textContent =
      `${entry.width} × ${entry.height} · ${entry.totalSteps} turns`;
    this.root.querySelector<HTMLButtonElement>('.start-chamber')!.disabled = false;
    const evidence = this.root.querySelector('.selected-evidence')!;
    evidence.replaceChildren();
    if (entry.certificate) {
      const el = certificateEvidence(entry.certificate);
      if (el) evidence.append(el);
    }
    this.render();
  }
  destroy() {
    this.alive = false;
    clearInterval(this.timer);
  }
}
