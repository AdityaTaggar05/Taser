import { ARKIV_NETWORK, explorerLink, type ArkivFeed, type ArkivActivity } from '../network/arkiv';
import type { LevelClient, ArchiveReference } from '../editor/LevelClient';
import type { SessionState } from '../network/protocol';
import { PositionHistory } from './PositionHistory';
import { ArchiveArrival, VerificationSignals } from './ArchiveSignal';
import { ArchiveGuide } from './ArchiveGuide';
import './arkiv.css';

/** One live archive across routes. Account changes and hidden screens cancel outstanding work. */
export class ArkivPanel {
  readonly root = document.createElement('aside');
  private toggle = document.createElement('button');
  private content = document.createElement('section');
  private activityContent = document.createElement('div');
  private contextContent = document.createElement('div');
  private hero = document.createElement('header');
  private guide = new ArchiveGuide();
  private positions: PositionHistory;
  private signals = new VerificationSignals();
  private arrival: ArchiveArrival;
  private docked = false;
  private wide = window.matchMedia('(min-width: 1100px)');
  private resize = () => {
    if (this.docked) this.expand(this.wide.matches);
  };
  private visibility = () => {
    if (!this.visible) return;
    this.generation++;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.arrival.clear();
    this.silentNextPoll = true;
    if (!document.hidden) void this.poll(this.generation);
  };
  private feed: ArkivFeed | null = null;
  private user: string | null = null;
  private visible = false;
  private expanded = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private unsubscribe: (() => void) | undefined;
  private publicationKey: string | undefined;
  private lastRender = '';
  private error = '';
  private silentNextPoll = true;

  constructor(
    private api: LevelClient,
    inspect: (step: number) => void = () => {},
  ) {
    this.positions = new PositionHistory(inspect);
    this.arrival = new ArchiveArrival(() =>
      this.expanded ? this.hero.querySelector<HTMLElement>('.arkiv-core')! : this.toggle,
    );
    this.root.id = 'arkiv-panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Arkiv block explorer');
    this.toggle.type = 'button';
    this.toggle.className = 'arkiv-toggle';
    this.toggle.setAttribute('aria-controls', 'arkiv-panel-content');
    this.content.id = 'arkiv-panel-content';
    this.content.hidden = true;
    this.hero.className = 'arkiv-hero';
    this.hero.innerHTML = `
      <div class="arkiv-hero-top"><span class="arkiv-eyebrow">THE ONCHAIN RECORD</span><span class="arkiv-network"></span></div>
      <div class="arkiv-hero-art" aria-hidden="true">
        <div class="arkiv-orbit orbit-one"></div><div class="arkiv-orbit orbit-two"></div><div class="arkiv-orbit orbit-three"></div>
        <div class="arkiv-core"><svg viewBox="0 0 64 64" fill="none"><path d="m32 8 21 12v24L32 56 11 44V20L32 8Z"/><path d="m11 20 21 12 21-12M32 32v24M21.5 14l21 12v12l-21 12V26l21-12"/></svg></div>
        <span class="arkiv-orbit-star star-one">+</span><span class="arkiv-orbit-star star-two">+</span>
      </div>
      <h2>Every move.<br><em>An imprint.</em></h2>
      <p class="arkiv-hero-note">Two timelines. One shared history.</p>
      <div class="arkiv-pipeline"><span>PLAY</span><i></i><span>ENCRYPT</span><i></i><span>VERIFY</span><b>↗</b></div>`;
    this.contextContent.className = 'arkiv-context';
    this.contextContent.hidden = true;
    this.activityContent.className = 'arkiv-feed';
    try {
      this.expanded = localStorage.getItem('weldpoint:explorer') === 'expanded';
    } catch {}
    this.toggle.addEventListener('click', () => {
      if (!this.docked || this.wide.matches) return;
      this.expand(!this.expanded);
    });
    this.root.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && this.docked && !this.wide.matches) {
        this.expand(false);
        this.toggle.focus();
      }
    });
    this.content.append(
      this.hero,
      this.guide.root,
      this.contextContent,
      this.activityContent,
      this.positions.root,
    );
    this.root.append(this.toggle, this.content);
    document.body.append(this.root);
    this.wide.addEventListener('change', this.resize);
    document.addEventListener('visibilitychange', this.visibility);
    this.expand(this.expanded);
  }

  context(key?: string, session?: SessionState, selected = 0) {
    this.positions.render(session, selected);
    this.contextContent.hidden = !session;
    if (session) {
      const name = document.createElement('strong');
      name.textContent = session.level?.name ?? 'Active chamber';
      const label = document.createElement('span');
      label.className = 'arkiv-eyebrow';
      label.textContent = 'CURRENT CHAMBER';
      const step = document.createElement('span');
      step.className = 'arkiv-context-turn';
      step.textContent = `T${String(selected).padStart(2, '0')} / ${String(session.level?.totalSteps ?? 8).padStart(2, '0')}`;
      this.contextContent.replaceChildren(label, name, step);
    }
    if (this.publicationKey === key) return;
    this.publicationKey = key;
    this.render();
  }

  show(visible: boolean, user: string | null, docked = false, homeSlot?: HTMLElement) {
    if (this.visible === visible && this.user === user && this.docked === docked) return;
    const enteringGameplay = docked && !this.docked;
    this.docked = docked;
    this.root.dataset.docked = String(docked);
    this.root.dataset.placement = docked ? 'level' : 'home';
    const parent = docked ? document.body : (homeSlot ?? document.body);
    if (this.root.parentElement !== parent) parent.append(this.root);
    this.guide.root.hidden = docked;
    this.hero.querySelector('h2')!.innerHTML = docked
      ? 'Every move.<br><em>An imprint.</em>'
      : 'Play is fleeting.<br><em>History has a home.</em>';
    this.hero.querySelector('.arkiv-hero-note')!.textContent = docked
      ? 'Committed turns. Encrypted records. Verified receipts.'
      : 'The archive behind every chamber, echo and move.';
    this.lastRender = '';
    if (!docked || (enteringGameplay && this.wide.matches)) this.expand(true);
    else if (enteringGameplay) this.expand(false);
    const changedUser = this.user !== user;
    this.stop();
    this.visible = visible;
    this.user = user;
    this.root.hidden = !visible;
    this.silentNextPoll = true;
    if (changedUser) {
      this.feed = null;
      this.error = '';
      this.signals.reset();
      this.api.clearReferences();
      this.publicationKey = undefined;
      this.lastRender = '';
    }
    if (!visible) return;
    this.unsubscribe = this.api.onReferences(() => this.render());
    this.render();
    if (!document.hidden) void this.poll(this.generation);
  }

  private expand(value: boolean) {
    this.expanded = value;
    this.content.hidden = !value;
    this.toggle.setAttribute('aria-expanded', String(value));
    try {
      localStorage.setItem('weldpoint:explorer', value ? 'expanded' : 'minimized');
    } catch {}
    this.render();
  }

  private async poll(generation: number) {
    this.abort = new AbortController();
    let arrivals: ArkivActivity[] = [];
    try {
      const feed = await this.api.activity(this.abort.signal);
      if (generation !== this.generation) return;
      arrivals = this.signals.receive(feed, this.silentNextPoll);
      this.silentNextPoll = false;
      this.feed = feed;
      this.error = '';
    } catch {
      if (generation !== this.generation) return;
      this.error = 'Signal interrupted. Retrying…';
    }
    if (generation !== this.generation) return;
    this.render();
    this.arrival.receive(arrivals);
    this.timer = setTimeout(() => void this.poll(generation), 3000);
  }

  private link(label: string, kind: 'tx' | 'entity', value?: string) {
    const href = explorerLink(kind, value);
    if (!href) return null;
    const a = document.createElement('a');
    a.textContent = label + ' ↗';
    a.href = href;
    a.title = value!;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  private render() {
    const activities = this.feed?.activities ?? [];
    const test = this.feed?.storage === 'test';
    const live = this.feed?.storage === 'arkiv';
    const pending = activities.filter((a) => a.state === 'pending').length;
    const confirmed = activities.filter((a) => a.state === 'confirmed').length;
    const failed = activities.filter((a) => a.state === 'failed').length;
    this.root.dataset.signal =
      this.error || failed ? 'interrupted' : pending ? 'pending' : live ? 'live' : 'idle';
    this.toggle.innerHTML =
      '<span class="arkiv-brand-icon" aria-hidden="true">◈</span><span class="arkiv-brand">ARKIV<span>EXPLORER</span></span><span class="arkiv-toggle-state"></span><span class="arkiv-toggle-chevron" aria-hidden="true"></span>';
    this.toggle.querySelector('.arkiv-toggle-state')!.textContent = test
      ? 'TEST'
      : this.error
        ? 'RETRYING'
        : pending
          ? `${pending} IN FLIGHT`
          : live
            ? 'LIVE'
            : 'STANDBY';
    this.toggle.querySelector('.arkiv-toggle-chevron')!.textContent = this.expanded ? '−' : '+';
    this.toggle.setAttribute(
      'aria-label',
      !this.docked
        ? 'Arkiv archive overview'
        : `${this.expanded ? 'Minimize' : 'Expand'} Arkiv explorer`,
    );
    if (!this.expanded) return;
    const signature = JSON.stringify([
      this.feed,
      this.error,
      this.api.references,
      this.publicationKey,
    ]);
    if (signature === this.lastRender) return;
    this.lastRender = signature;
    this.hero.querySelector('.arkiv-network')!.textContent = test
      ? 'TEST NETWORK'
      : live
        ? `${ARKIV_NETWORK.name.toUpperCase()} / LIVE`
        : 'AWAITING SIGNAL';
    const focused = (document.activeElement as HTMLAnchorElement)?.href;
    const stats = document.createElement('div');
    stats.className = 'arkiv-stats';
    for (const [value, label] of [
      [confirmed, test ? 'TEST RECORDS' : 'VERIFIED'],
      [pending, 'IN FLIGHT'],
      [activities.length, 'RECENT WRITES'],
    ] as const) {
      const stat = document.createElement('div');
      const number = document.createElement('strong');
      number.textContent = String(value).padStart(2, '0');
      const caption = document.createElement('span');
      caption.textContent = label;
      stat.append(number, caption);
      stats.append(stat);
    }
    const header = document.createElement('div');
    header.className = 'arkiv-heading';
    const title = document.createElement('h3');
    title.textContent = 'Recent archive writes';
    const badge = document.createElement('span');
    badge.className = 'arkiv-feed-badge';
    badge.textContent = test
      ? 'SIMULATED'
      : this.error
        ? 'RECONNECTING'
        : pending
          ? 'SYNCING'
          : 'AUTO SYNC';
    header.append(title, badge);
    const status = document.createElement('p');
    status.className = 'arkiv-status';
    status.setAttribute('role', 'status');
    status.textContent =
      this.error ||
      (!this.feed
        ? 'Listening for archive activity…'
        : test
          ? 'Test archive · no blockchain writes'
          : this.feed.storage === 'unconfigured'
            ? 'Arkiv is not configured.'
            : failed
              ? `${failed} ${failed === 1 ? 'write needs' : 'writes need'} attention. Gameplay continues.`
              : 'Your writes + public chamber publications · latest receipts');
    const legend = document.createElement('p');
    legend.className = 'arkiv-legend';
    legend.textContent =
      'In flight = awaiting receipt · Verified = receipt + stored entity checked. Counts cover this recent feed, not the whole chain.';
    const list = document.createElement('ol');
    list.className = 'arkiv-activity';
    list.setAttribute('aria-label', 'Recent archive writes');
    for (const activity of activities) this.activity(list, activity, !live);
    if (!activities.length) {
      const empty = document.createElement('li');
      empty.className = 'arkiv-empty';
      empty.innerHTML =
        '<span aria-hidden="true">⌁</span><strong>History starts with a move.</strong><p>Complete a turn together.<br>Its receipt lands right here.</p>';
      list.append(empty);
    }
    const refs = document.createElement('footer');
    refs.className = 'arkiv-refs';
    const heading = document.createElement('span');
    heading.className = 'arkiv-eyebrow';
    heading.textContent = 'SOURCE / ARKIV';
    refs.append(heading);
    if (live) {
      const a = document.createElement('a');
      a.textContent = 'Open explorer ↗';
      a.href = ARKIV_NETWORK.explorer;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      refs.append(a);
    }
    const references: ArchiveReference[] = this.publicationKey
      ? [{ name: 'Chamber entity', entityKey: this.publicationKey, storage: this.feed?.storage }]
      : this.api.references;
    for (const ref of references) {
      if (ref.storage !== 'arkiv') continue;
      const row = document.createElement('p');
      const entity = this.link(ref.name, 'entity', ref.entityKey);
      const tx = this.link('Publication transaction', 'tx', ref.txHash);
      if (entity) row.append(entity);
      if (tx) row.append(tx);
      if (row.childNodes.length) refs.append(row);
    }
    const note = document.createElement('small');
    note.textContent = test
      ? 'Simulated receipts. No live transaction links.'
      : live
        ? `${ARKIV_NETWORK.name} · ${ARKIV_NETWORK.chainId} · encrypted moves`
        : 'Waiting for the archive connection.';
    refs.append(note);
    this.activityContent.replaceChildren(stats, header, status, legend, list, refs);
    if (focused)
      Array.from(this.content.querySelectorAll('a'))
        .find((a) => a.href === focused)
        ?.focus({ preventScroll: true });
  }

  private activity(list: HTMLElement, a: ArkivActivity, test: boolean) {
    const row = document.createElement('li');
    row.dataset.state = a.state;
    row.dataset.activityId = a.id;
    row.dataset.kind = a.kind;
    const mark = document.createElement('span');
    mark.className = 'arkiv-record-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = a.state === 'confirmed' ? '✓' : a.state === 'failed' ? '!' : '↗';
    const body = document.createElement('div');
    body.className = 'arkiv-record-body';
    const meta = document.createElement('div');
    meta.className = 'arkiv-record-meta';
    const kind = document.createElement('span');
    kind.textContent =
      a.kind === 'move'
        ? 'PAIRED MOVE'
        : a.kind === 'run'
          ? 'WINNING RUN'
          : `${a.kind.toUpperCase()} RECORD`;
    const time = document.createElement('time');
    time.dateTime = new Date(a.createdAt).toISOString();
    time.textContent = new Date(a.createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    meta.append(kind, time);
    const label = document.createElement('strong');
    label.className = 'arkiv-record-label';
    label.textContent = a.label;
    const state = document.createElement('span');
    state.className = 'arkiv-write-state';
    state.textContent = test
      ? `TEST · ${a.state === 'confirmed' ? 'recorded' : a.state}`
      : a.state === 'confirmed'
        ? 'Chain verified'
        : a.state === 'failed'
          ? 'Failed'
          : a.txHash
            ? 'Pending verification'
            : 'Queued for takeoff';
    const bottom = document.createElement('div');
    bottom.className = 'arkiv-record-bottom';
    bottom.append(state);
    if (!test) {
      const tx = this.link('Transaction', 'tx', a.txHash);
      const entity = this.link('Entity', 'entity', a.entityKey);
      if (tx) bottom.append(tx);
      if (entity) bottom.append(entity);
    }
    body.append(meta, label, bottom);
    if (a.message) {
      const message = document.createElement('p');
      message.className = 'arkiv-record-message';
      message.textContent = a.message;
      body.append(message);
    }
    row.append(mark, body);
    list.append(row);
  }

  private stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.arrival.clear();
  }

  destroy() {
    this.stop();
    this.wide.removeEventListener('change', this.resize);
    document.removeEventListener('visibilitychange', this.visibility);
    this.arrival.destroy();
    this.root.remove();
  }
}
