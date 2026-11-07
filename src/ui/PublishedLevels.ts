import './published.css';
import { LevelLibrary } from './LevelLibrary';
import { explorerLink } from '../network/arkiv';
import type { LevelClient } from '../editor/LevelClient';
import type { LevelSummary } from '../editor/types';
import { verificationLabel } from '../certification/model';
import { certificateEvidence } from './CertificateEvidence';
import { INVITE_LENGTH, INVITE_PATTERN, normalizeInviteCode } from '../network/invite';
export class PublishedLevels {
  readonly root = document.createElement('main');
  private request = 0;
  private database?: LevelLibrary;

  constructor(
    private api: LevelClient,
    private actions: { home: () => void; fullscreen: () => void },
  ) {
    this.root.id = 'published-levels';
    this.root.hidden = true;
    document.body.append(this.root);
  }

  show(visible: boolean, hash = '') {
    this.database?.destroy();
    this.database = undefined;
    this.root.hidden = !visible;
    const request = ++this.request;
    if (!visible) {
      this.root.replaceChildren();
      return;
    }
    this.root.innerHTML = /* HTML */ `
      <header class="published-header">
        <button data-menu="home">← Back</button>
        <span>WELDPOINT / CHALLENGES</span>
        <button data-menu="fullscreen" aria-label="Fullscreen">⛶</button>
      </header>
      <section class="published-content">
        <h1></h1>
        <p class="archive-intro"></p>
        <div class="menu-body"></div>
        <p class="archive-status" role="status"></p>
      </section>
    `;
    this.root.querySelector('[data-menu=home]')!.addEventListener('click', () => {
      if (/\/runs$/.test(hash)) location.hash = hash.replace(/\/runs$/, '');
      else if (/\/p[12]$/.test(hash)) location.hash = hash.replace(/\/[a-f0-9-]{36}\/p[12]$/, '');
      else this.actions.home();
    });
    this.root
      .querySelector('[data-menu=fullscreen]')!
      .addEventListener('click', this.actions.fullscreen);
    const body = this.root.querySelector('.menu-body')!,
      title = this.root.querySelector('h1')!,
      intro = this.root.querySelector('.archive-intro')!;
    const mode = /^#(solo|coop)/.exec(hash)?.[1] as 'solo' | 'coop' | undefined;
    const selected = /\/(?:campaign|community|chamber)\/([a-f0-9-]{36})/.exec(hash)?.[1];
    const legacy = /^#play\/([a-f0-9-]{36})/.exec(hash)?.[1];
    const category = hash.includes('/campaign') ? 'campaign' : 'community';
    const role = /\/p([12])/.exec(hash)?.[1];
    const status = (message: string) => {
      if (this.request === request)
        this.root.querySelector('.archive-status')!.textContent = message;
    };
    const link = (text: string, href: string, parent = body, css = 'archive-play') => {
      const a = document.createElement('a');
      a.textContent = text;
      a.href = href;
      a.className = css;
      parent.append(a);
      return a;
    };
    if (!mode) {
      title.textContent = 'Choose how to play';
      intro.textContent = 'A live partner or an echo from another timeline.';
      const choices = document.createElement('div');
      choices.className = 'mode-choice';
      body.append(choices);
      link('Co-op →', legacy ? '#coop/chamber/' + legacy : '#coop', choices);
      link('Solo →', legacy ? '#solo/chamber/' + legacy : '#solo', choices);
      return;
    }
    if (!hash.includes('/')) {
      title.textContent = mode === 'solo' ? 'Solo challenges' : 'Co-op challenges';
      intro.textContent =
        mode === 'solo'
          ? 'Choose a chamber, then play alongside a fixed creator or player replay.'
          : 'Choose a chamber and invite your partner to a private party.';
      const choices = document.createElement('div');
      choices.className = 'collection-choice';
      body.append(choices);
      link('Campaign →', '#' + mode + '/campaign', choices);
      link('Community →', '#' + mode + '/community', choices);
      if (mode === 'coop') {
        const form = document.createElement('form');
        form.className = 'join-code-form';
        form.innerHTML = /* HTML */ `
          <label for="invite-code">Have an invitation?</label>
          <input
            id="invite-code"
            required
            maxlength="${INVITE_LENGTH}"
            minlength="${INVITE_LENGTH}"
            placeholder="6-character code"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            pattern="${INVITE_PATTERN}"
          />
          <button type="submit">Join party ↗</button>
        `;
        form.onsubmit = (event) => {
          event.preventDefault();
          const code = normalizeInviteCode(form.querySelector('input')!.value);
          if (code) location.hash = 'invite/' + code;
        };
        body.append(form);
      }
      return;
    }
    if (selected && !role) {
      title.textContent = 'Choose your role';
      intro.textContent =
        mode === 'coop'
          ? 'Your invited partner will take the opposite role.'
          : 'Your replay partner will play the opposite role.';
      const choices = document.createElement('div');
      choices.className = 'role-options';
      body.append(choices);
      for (const player of [1, 2]) {
        const a = link('', hash + '/p' + player, choices, 'role-link');
        a.dataset.player = String(player);
        a.innerHTML = /* HTML */ `
          <b>
            P${player}
            <span>${player === 1 ? '→' : '←'}</span>
          </b>
          <strong>${player === 1 ? 'Forward' : 'Reverse'} time</strong>
          <small>
            ${player === 1 ? 'Write the past. Find your way out through your partner’s history.' : 'Begin at the other end. Meet in the middle of time.'}
          </small>
        `;
      }
      link('Chamber leaderboard ↗', '#leaderboard/' + selected);
      link('← Choose another chamber', '#' + mode + '/' + category);
      return;
    }
    if (selected && role && mode === 'solo') {
      title.textContent = hash.endsWith('/runs') ? 'Player runs' : 'Choose your replay';
      intro.textContent = `You play P${role}. The replay controls P${role === '1' ? 2 : 1}; its future moves stay hidden.`;
      if (!hash.endsWith('/runs')) {
        const choices = document.createElement('div');
        choices.className = 'echo-options';
        body.append(choices);
        link('Creator solution →', hash + '/creator', choices, 'run-choice');
        link('Player runs →', hash + '/runs', choices, 'run-choice');
        status('');
      } else {
        const list = document.createElement('div');
        body.append(list);
        const retry = document.createElement('button');
        retry.className = 'archive-refresh';
        retry.textContent = 'Refresh runs ↻';
        retry.onclick = () => this.show(true, hash);
        body.prepend(retry);
        link('← Replay sources', hash.replace(/\/runs$/, ''));
        status('Loading confirmed runs…');
        void this.api
          .runs(selected, role === '1' ? 2 : 1)
          .then((runs) => {
            if (this.request !== request) return;
            status(runs.length ? 'Verified winning runs.' : 'No player runs yet.');
            for (const run of runs) {
              const row = document.createElement('article');
              row.className = 'run-entry';
              link(
                `${run.name} · P${run.role} · ${run.turns} turns · ${run.mode}`,
                hash.replace(/\/runs$/, '/run/' + run.id),
                row,
                'run-choice',
              );
              this.proof(run, row);
              list.append(row);
            }
          })
          .catch((error) => status((error as Error).message));
      }
      return;
    }
    title.textContent = 'The chamber archive.';
    intro.textContent =
      category === 'campaign'
        ? 'Original puzzles. A shared way forward.'
        : 'Built by operators. Kept alive by the community.';
    this.database = new LevelLibrary(body, this.api, mode, category, status);
  }

  private proof(ref: { entityKey?: string; txHash?: string; storage?: string }, parent: Element) {
    if (ref.storage !== 'arkiv') return;
    const links = document.createElement('div');
    links.className = 'archive-proof-links';
    for (const [kind, label, value] of [
      ['entity', 'Archived entity', ref.entityKey],
      ['tx', 'Publication transaction', ref.txHash],
    ] as const) {
      const href = explorerLink(kind, value);
      if (!href) continue;
      const a = document.createElement('a');
      a.textContent = label + ' ↗';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      links.append(a);
    }
    parent.append(links);
  }
  private card(level: LevelSummary, parent: Element, href: string) {
    const card = document.createElement('article');
    card.className = 'archive-card';
    for (const [tag, text, css] of [
      [
        'p',
        `${level.width} × ${level.height} / ${level.totalSteps} TURNS / ${verificationLabel(level.verification)}`,
        'archive-kicker',
      ],
      ['h2', level.name, ''],
      ['p', level.subtitle, 'archive-subtitle'],
      ['p', 'By ' + level.ownerName, 'archive-author'],
    ]) {
      const el = document.createElement(tag);
      el.textContent = text;
      el.className = css;
      card.append(el);
    }
    const play = document.createElement('a');
    play.href = href;
    play.className = 'archive-play';
    play.textContent = 'Choose P1 / P2 ↗';
    const board = document.createElement('a');
    board.href = '#leaderboard/' + level.id;
    board.className = 'archive-play';
    board.textContent = 'Leaderboard & hearts ♡';
    card.append(play, board);
    this.proof(level, card);
    if (level.certificate) {
      const evidence = certificateEvidence(level.certificate);
      if (evidence) card.append(evidence);
    }
    parent.append(card);
  }

  destroy() {
    this.database?.destroy();
    this.request++;
    this.root.remove();
  }
}
