import type { SessionState } from '../network/protocol';
import type { ConnectionStatus } from '../network/CoopClient';
export class PartyLobby {
  readonly root = document.createElement('main');
  private ready = false;

  constructor(actions: { leave: () => void; ready: (ready: boolean) => void; start: () => void }) {
    this.root.id = 'party-lobby';
    this.root.hidden = true;
    this.root.innerHTML = /* HTML */ `
      <header class="published-header">
        <button data-party="leave">← Leave party</button>
        <span>WELDPOINT / PRIVATE PARTY</span>
      </header>
      <section class="published-content">
        <p class="archive-kicker">MEET BEFORE THE TIMELINE</p>
        <h1>Your party</h1>
        <h2 class="party-level"></h2>
        <p class="party-status" role="status"></p>
        <div class="party-members"></div>
        <section class="party-invite">
          <label for="party-link">INVITE LINK</label>
          <input id="party-link" readonly />
          <button data-party="copy">Copy invite link</button>
          <p>
            Or share this join code:
            <strong class="party-code"></strong>
          </p>
          <small>
            The other operator takes the opposite role. Both must be Ready; the host starts.
          </small>
        </section>
        <div class="party-actions">
          <button data-party="ready">Ready</button>
          <button data-party="start">Start challenge ↗</button>
        </div>
        <p class="party-copy-status" role="status"></p>
      </section>
    `;
    document.body.append(this.root);
    this.root.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-party]')
        ?.dataset.party;
      if (action === 'leave') actions.leave();
      else if (action === 'ready') actions.ready(!this.ready);
      else if (action === 'start') actions.start();
      else if (action === 'copy') void this.copyInvite();
    });
  }

  private async copyInvite() {
    try {
      await navigator.clipboard.writeText(
        this.root.querySelector<HTMLInputElement>('input')!.value,
      );
      this.root.querySelector('.party-copy-status')!.textContent = 'Invite link copied.';
    } catch {
      this.root.querySelector('.party-copy-status')!.textContent =
        'Select and copy the invite link above.';
    }
  }

  render(
    show: boolean,
    state: SessionState | null,
    status: ConnectionStatus,
    notice: string | null,
  ) {
    this.root.hidden = !show;
    if (!show) return;
    const party = state?.party;
    this.root.querySelector('.party-level')!.textContent = state?.level?.name ?? 'Connecting…';
    this.root.querySelector('.party-status')!.textContent =
      notice ??
      (status !== 'connected'
        ? 'Connecting to your private session…'
        : party?.members.length === 2
          ? party.members.every((m) => m.ready)
            ? 'Both operators are Ready. The host can start.'
            : 'Both operators are here. Confirm Ready to begin.'
          : 'Waiting for your invited operator.');
    this.root.querySelector('.party-code')!.textContent = party?.code ?? '…';
    this.root.querySelector<HTMLInputElement>('input')!.value = party
      ? new URL('#invite/' + party.code, location.href).href
      : '';
    this.root.querySelector<HTMLElement>('.party-invite')!.hidden = !party;
    const members = this.root.querySelector('.party-members')!;
    members.replaceChildren();
    for (const member of party?.members ?? []) {
      const card = document.createElement('article');
      card.className = 'archive-card';
      card.dataset.partyPlayer = String(member.player);
      const name = document.createElement('h2');
      name.textContent = member.name;
      const detail = document.createElement('p');
      detail.textContent = `P${member.player} · ${member.connected ? (member.ready ? 'READY' : 'NOT READY') : 'RECONNECTING'}`;
      card.append(name, detail);
      members.append(card);
    }
    this.ready = party?.members.find((m) => m.player === state?.player)?.ready ?? false;
    const ready = this.root.querySelector<HTMLButtonElement>('[data-party=ready]')!;
    ready.textContent = this.ready ? 'Not ready' : 'Ready';
    ready.disabled = status !== 'connected' || !party;
    ready.setAttribute('aria-pressed', String(this.ready));
    const start = this.root.querySelector<HTMLButtonElement>('[data-party=start]')!;
    start.hidden = !party?.host;
    start.disabled =
      status !== 'connected' ||
      party?.members.length !== 2 ||
      !party.members.every((m) => m.connected && m.ready);
  }

  destroy() {
    this.root.remove();
  }
}
