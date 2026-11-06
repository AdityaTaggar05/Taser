import type { AuthClient } from '../auth/AuthClient';
import type { PredictionLobby, PublicMatch, PredictionOutcome } from './types';
import { environments } from '../assets/catalog';
import { spriteElement } from '../assets/dom';
import { computeLaserTiles, isExitOpen } from '../core/engine';
import { hasCoord, sameCoord } from '../core/types';
import './watch.css';
export class WatchScreen {
  readonly root = document.createElement('main');
  private active = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private selected: string | undefined;
  private user: string | null = null;
  private busy = false;
  constructor(private auth: AuthClient) {
    this.root.id = 'watch';
    this.root.hidden = true;
    this.root.innerHTML = /* HTML */ `
      <header class="published-header">
        <a href="#">← Home</a>
        <span>WELDPOINT / LIVE ARENA</span>
        <strong class="watch-balance"></strong>
      </header>
      <section class="published-content">
        <p class="archive-kicker">WATCH. PREDICT. KEEP HISTORY ALIVE.</p>
        <h1>Live co-op arena</h1>
        <p>
          Pick a public match or let chance choose. Predictions use test points with no cash value.
          Boards arrive on a 10-second delay.
        </p>
        <div class="watch-actions">
          <button data-watch="random">Watch random match ↗</button>
          <a href="#watch">All matches</a>
        </div>
        <p class="watch-status" role="status" aria-live="polite"></p>
        <div class="watch-detail"></div>
        <div class="watch-matches"></div>
      </section>
    `;
    this.root
      .querySelector('[data-watch=random]')!
      .addEventListener('click', () => void this.random());
    document.body.append(this.root);
  }
  show(show: boolean, route: string) {
    const user = this.auth.user?.id ?? null,
      id = /^#watch\/([a-f0-9-]{36})$/.exec(route)?.[1];
    if (this.active === show && this.selected === id && this.user === user) return;
    this.generation++;
    clearTimeout(this.timer);
    this.active = show;
    this.selected = id;
    this.user = user;
    this.root.hidden = !show;
    this.root.querySelector('.watch-detail')!.replaceChildren();
    this.root.querySelector('.watch-matches')!.replaceChildren();
    if (show) void this.load();
  }
  private status(message: string) {
    this.root.querySelector('.watch-status')!.textContent = message;
  }
  private async random() {
    const generation = this.generation;
    this.status('Finding a public match…');
    try {
      const match = await this.auth.bettingRequest<PublicMatch>('/random');
      if (generation === this.generation) location.hash = 'watch/' + match.id;
    } catch (error) {
      if (generation === this.generation) this.status((error as Error).message);
    }
  }
  private async load() {
    const generation = this.generation;
    if (!this.active) return;
    try {
      const lobby = await this.auth.bettingRequest<PredictionLobby>();
      if (generation !== this.generation) return;
      this.root.querySelector('.watch-balance')!.textContent =
        `${lobby.balance.toLocaleString()} test points`;
      const list = this.root.querySelector('.watch-matches')!;
      list.replaceChildren();
      for (const match of lobby.matches) {
        const card = document.createElement('article');
        card.className = 'archive-card';
        const title = document.createElement('h2'),
          detail = document.createElement('p'),
          link = document.createElement('a');
        title.textContent = match.name;
        detail.textContent = `${match.players.join(' + ')} · ${this.label(match)} · Pool ${match.pool.escape + match.pool.fail}`;
        link.href = '#watch/' + match.id;
        link.textContent = 'Watch & predict ↗';
        card.append(title, detail, link);
        list.append(card);
      }
      if (this.selected) {
        const match = await this.auth.bettingRequest<PublicMatch>('/' + this.selected);
        if (generation !== this.generation) return;
        this.renderMatch(match);
      }
      this.status(
        lobby.matches.length
          ? 'Predictions close when the host starts. Reset is a loss. Disconnect expiry, inactivity and server restart refund the pool.'
          : 'No public matches yet. Both operators must enable public broadcasting in a co-op lobby.',
      );
    } catch (error) {
      if (generation === this.generation) this.status((error as Error).message);
    } finally {
      if (this.active && generation === this.generation)
        this.timer = setTimeout(() => void this.load(), 2000);
    }
  }
  private label(match: PublicMatch) {
    return {
      open: 'Predictions open',
      locked: 'In progress',
      escape: 'Escaped',
      fail: 'Attempt lost',
      void: 'Refunded',
    }[match.status];
  }
  private renderMatch(match: PublicMatch) {
    const root = this.root.querySelector('.watch-detail')!,
      amount = root.querySelector<HTMLInputElement>('input')?.value ?? '25';
    // Preserve an active stake edit while polling; update the board once focus leaves the form.
    if (root.contains(document.activeElement)) return;
    root.replaceChildren();
    const title = document.createElement('h2'),
      meta = document.createElement('p');
    title.textContent = match.name;
    meta.textContent = `${match.players.join(' + ')} · ${this.label(match)} · Archive ${match.archive}`;
    root.append(title, meta);
    if (match.prediction) {
      const p = document.createElement('p');
      p.className = 'watch-receipt';
      p.textContent = `Your prediction: ${match.prediction.outcome === 'escape' ? 'Escape' : 'Fail'} · ${match.prediction.amount} points${match.prediction.payout === null ? '' : ` · Returned ${match.prediction.payout} points`}`;
      root.append(p);
    } else if (match.status === 'open') {
      const form = document.createElement('form');
      form.className = 'watch-prediction';
      const label = document.createElement('label'),
        stake = document.createElement('input');
      label.textContent = 'Stake (10–100 test points)';
      stake.type = 'number';
      stake.min = '10';
      stake.max = '100';
      stake.step = '1';
      stake.required = true;
      stake.value = amount;
      label.append(stake);
      form.append(label);
      for (const outcome of ['escape', 'fail'] as PredictionOutcome[]) {
        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = `${outcome === 'escape' ? 'Escape' : 'Fail'} · pool ${match.pool[outcome]}`;
        button.value = outcome;
        button.disabled = this.busy;
        form.append(button);
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity() || this.busy) return;
        const outcome = (event as SubmitEvent).submitter as HTMLButtonElement | null;
        if (outcome)
          void this.predict(match.id, outcome.value as PredictionOutcome, Number(stake.value));
      });
      root.append(form);
    }
    if (!match.frame) {
      const p = document.createElement('p');
      p.textContent =
        'Waiting for the delayed broadcast. No upcoming inputs or reference solutions are shared.';
      root.append(p);
      return;
    }
    const frame = match.frame,
      info = document.createElement('p');
    info.textContent = `Turn ${frame.state.step}/${frame.level.totalSteps} · ${frame.state.status.replaceAll('_', ' ')} · ${Math.max(10, Math.round((Date.now() - frame.observedAt) / 1000))}s ago`;
    root.append(info);
    const boards = document.createElement('div');
    boards.className = 'watch-boards';
    const pack = environments[frame.level.environment ?? 'foundry'] ?? environments.foundry;
    for (const player of [1, 2] as const) {
      const section = document.createElement('section'),
        heading = document.createElement('h3'),
        grid = document.createElement('div');
      heading.textContent = `P${player} perspective`;
      grid.className = 'watch-grid';
      grid.style.setProperty('--cols', String(frame.level.width));
      grid.setAttribute('role', 'img');
      grid.setAttribute('aria-label', `P${player} board at turn ${frame.state.step}`);
      const boxes = player === 1 ? frame.state.boxesP1 : frame.state.boxesP2,
        position = player === 1 ? frame.state.p1Pos : frame.state.p2Pos,
        laser = computeLaserTiles(boxes, frame.level);
      const exitOpen = isExitOpen(player, boxes, laser, frame.level);
      for (let y = frame.level.height; y >= 1; y--)
        for (let x = 1; x <= frame.level.width; x++) {
          const tile = document.createElement('div'),
            coord: [number, number] = [x, y];
          tile.className = 'watch-tile';
          const add = (id: string) => tile.append(spriteElement(pack, id));
          add(
            hasCoord(frame.level.walls, coord)
              ? 'wall'
              : hasCoord(frame.level.iceTiles, coord)
                ? 'ice'
                : 'floor',
          );
          if (hasCoord(player === 1 ? frame.level.switchesP1 : frame.level.switchesP2, coord))
            add(`switch.p${player}.${hasCoord(boxes, coord) ? 'held' : 'up'}`);
          if (sameCoord(player === 1 ? frame.level.exitP1 : frame.level.exitP2, coord))
            add(`exit.p${player}.${exitOpen ? 'open' : 'closed'}`);
          if (frame.level.laserEmitter && sameCoord(frame.level.laserEmitter.pos, coord))
            add(
              `laser.emitter.on.${({ U: 'north', D: 'south', L: 'west', R: 'east', W: 'south' } as const)[frame.level.laserEmitter.dir]}`,
            );
          if (
            player === 1 &&
            frame.level.laserReceiverP1 &&
            sameCoord(frame.level.laserReceiverP1, coord)
          )
            add(`laser.receiver.${hasCoord(laser, coord) ? 'on' : 'off'}.north`);
          if (hasCoord(laser, coord))
            add(
              `laser.beam.${frame.level.laserEmitter?.dir === 'L' || frame.level.laserEmitter?.dir === 'R' ? 'horizontal' : 'vertical'}`,
            );
          if (hasCoord(boxes, coord)) add(frame.level.hasMirrorBox ? 'mirror' : `crate.p${player}`);
          if (sameCoord(position, coord)) add(`p${player}`);
          grid.append(tile);
        }
      section.append(heading, grid);
      boards.append(section);
    }
    root.append(boards);
  }
  private async predict(id: string, outcome: PredictionOutcome, amount: number) {
    const generation = this.generation;
    this.busy = true;
    this.root
      .querySelectorAll<HTMLButtonElement>('.watch-prediction button')
      .forEach((b) => (b.disabled = true));
    try {
      await this.auth.bettingRequest('/' + id + '/predict', { outcome, amount });
      if (generation === this.generation) this.status('Prediction recorded.');
    } catch (error) {
      if (generation === this.generation) this.status((error as Error).message);
    } finally {
      this.busy = false;
      if (generation === this.generation) {
        clearTimeout(this.timer);
        void this.load();
      }
    }
  }
  destroy() {
    this.generation++;
    this.active = false;
    clearTimeout(this.timer);
    this.root.remove();
  }
}
