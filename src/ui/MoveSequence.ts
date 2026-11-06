import type { LevelClient } from '../editor/LevelClient';
import { explorerLink, type MoveSequenceFeed } from '../network/arkiv';
import type { Direction } from '../core/types';
import './move-sequence.css';
const arrows: Record<Direction, string> = { U: '↑', D: '↓', L: '←', R: '→', W: '·' };
const names: Record<Direction, string> = { U: 'Up', D: 'Down', L: 'Left', R: 'Right', W: 'Wait' };
/** Shows only committed pairs fetched from the archive; queued inputs never enter this view. */
export class MoveSequence {
  private root: HTMLElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private scope = '';
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private sessionId = '';
  private sequences: number[] = [];
  private selected = 0;
  private feed: MoveSequenceFeed | null = null;
  private visible = () => {
    if (!document.hidden && this.scope) {
      this.stop();
      void this.poll(this.generation);
    }
  };
  constructor(
    private api: LevelClient,
    parent: Element,
    private inspect: (turn: number) => void,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'move-sequence';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Paired move block explorer');
    this.root.innerHTML =
      '<div class="move-sequence-heading"><strong>MOVE PAIRS <span>P1 | P2</span></strong><span class="move-query-status" role="status"></span></div><ol class="move-pairs" aria-label="Committed move pairs"></ol>';
    this.list = this.root.querySelector('ol')!;
    this.status = this.root.querySelector('.move-query-status')!;
    const nav = document.createElement('nav');
    nav.className = 'move-card-nav';
    nav.setAttribute('aria-label', 'Move pair history');
    nav.innerHTML =
      '<button aria-label="Previous move pair">← Previous</button><span>COMMITTED TOGETHER</span><button aria-label="Next move pair">Next →</button>';
    nav.querySelector('button')!.onclick = () => {
      if (this.selected > 1) this.inspect(this.selected - 1);
    };
    nav.querySelectorAll('button')[1].onclick = () => {
      if (this.selected < this.sequences.length) this.inspect(this.selected + 1);
    };
    this.root.append(nav);
    parent.append(this.root);
    document.addEventListener('visibilitychange', this.visible);
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
  }
  context(
    user: string | null,
    sessionId: string | undefined,
    sequences: number[],
    selected: number,
    visible: boolean,
  ) {
    const scope = visible && user && sessionId ? JSON.stringify([user, sessionId, sequences]) : '';
    this.selected = selected;
    if (scope === this.scope) {
      this.highlight();
      return;
    }
    const sameSession = this.sessionId === sessionId && this.scope !== '';
    this.stop();
    this.scope = scope;
    this.root.hidden = !scope;
    this.feed = null;
    this.list.replaceChildren();
    if (!scope) {
      this.sessionId = '';
      return;
    }
    this.sessionId = sessionId!;
    this.sequences = [...sequences];
    this.status.textContent = 'Querying…';
    this.render();
    if (!sameSession) this.list.scrollLeft = 0;
    void this.poll(this.generation);
  }
  private async poll(generation: number) {
    if (document.hidden) return;
    this.abort = new AbortController();
    try {
      const feed = await this.api.moves(this.sessionId, this.sequences, this.abort.signal);
      if (generation !== this.generation) return;
      this.feed = feed;
      this.render();
      this.status.textContent =
        feed.storage === 'test'
          ? 'TEST · 3s refresh'
          : feed.storage === 'unconfigured'
            ? 'Archive not configured'
            : 'Database queried · 3s refresh';
    } catch {
      if (generation !== this.generation) return;
      this.status.textContent = 'Query failed · retrying';
      this.root.dataset.stale = 'true';
    }
    if (generation === this.generation)
      this.timer = setTimeout(() => void this.poll(generation), 3000);
  }
  private render() {
    const focused = (document.activeElement as HTMLElement)?.dataset.sequence,
      nearEnd = this.list.scrollWidth - this.list.clientWidth - this.list.scrollLeft < 30;
    this.list.replaceChildren();
    this.root.dataset.stale = 'false';
    if (!this.sequences.length) {
      const empty = document.createElement('li');
      empty.className = 'move-sequence-empty';
      empty.textContent = 'Choose a move together. Each completed turn adds P1 + P2 here.';
      this.list.append(empty);
      return;
    }
    for (const [index, sequence] of this.sequences.entries()) {
      const move = this.feed?.moves.find((row) => row.sequence === sequence),
        state = move?.state ?? 'pending';
      const item = document.createElement('li');
      item.dataset.state = state;
      item.dataset.turn = String(index + 1);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.sequence = String(sequence);
      button.setAttribute('aria-label', `Review turn ${index + 1}, ${state}`);
      button.onclick = () => this.inspect(index + 1);
      const label = document.createElement('span');
      label.className = 'move-pair-turn';
      label.textContent = `T${index + 1}`;
      const cells = document.createElement('span');
      cells.className = 'move-pair-cells';
      for (const player of [1, 2]) {
        const cell = document.createElement('span'),
          input = move?.inputs?.[player - 1];
        cell.className = 'move-cell p' + player;
        cell.textContent = input ? (input === 'W' ? 'WAIT' : arrows[input]) : '…';
        if (input) cell.dataset.direction = input;
        cell.title = `P${player}: ${input ? names[input] : state === 'unavailable' ? 'Entity unavailable' : state === 'failed' ? 'Publication failed' : 'Awaiting database confirmation'}`;
        cell.setAttribute('aria-label', cell.title);
        cells.append(cell);
      }
      const badge = document.createElement('span');
      badge.className = 'move-pair-state';
      badge.textContent =
        state === 'confirmed'
          ? this.feed?.storage === 'test'
            ? 'Test record'
            : 'Confirmed'
          : state === 'failed'
            ? 'Failed'
            : state === 'unavailable'
              ? 'Unavailable'
              : 'Pending';
      button.append(label, cells, badge);
      item.append(button);
      const href = this.feed?.storage === 'arkiv' ? explorerLink('tx', move?.txHash) : undefined;
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '↗';
        link.className = 'move-pair-link';
        link.setAttribute('aria-label', `Open turn ${index + 1} transaction`);
        item.append(link);
      }
      this.list.append(item);
    }
    this.highlight();
    if (nearEnd) this.list.scrollLeft = this.list.scrollWidth;
    if (focused)
      this.list
        .querySelector<HTMLButtonElement>(`[data-sequence="${focused}"]`)
        ?.focus({ preventScroll: true });
  }
  private highlight() {
    const nav = this.root.querySelectorAll<HTMLButtonElement>('.move-card-nav button');
    nav[0].disabled = this.selected <= 1;
    nav[1].disabled = this.selected >= this.sequences.length;
    this.root.dataset.empty = String(this.selected === 0 || !this.sequences.length);
    let initial = this.list.querySelector<HTMLElement>('.move-initial');
    if (!initial) {
      initial = document.createElement('li');
      initial.className = 'move-initial';
      initial.textContent = 'Initial state · no move pair at turn 0.';
      this.list.append(initial);
    }
    initial.hidden = this.selected !== 0 || !this.sequences.length;
    this.list.querySelectorAll<HTMLElement>('[data-turn]').forEach((row) => {
      const current = Number(row.dataset.turn) === this.selected;
      row.classList.toggle('current', current);
      row.querySelector('button')?.setAttribute('aria-current', String(current));
    });
  }
  private stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.abort?.abort();
  }
  destroy() {
    this.scope = '';
    this.stop();
    document.removeEventListener('visibilitychange', this.visible);
    this.root.remove();
  }
}
