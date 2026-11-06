import './home.css';
import { profileLabel } from '../auth/AuthClient';
import type { PlayerProfile } from '../auth/types';
import { Guide } from './Guide';
import { INVITE_PATTERN, normalizeInviteCode } from '../network/invite';
import { playOptions, saveOptions } from './preferences';
interface HomeActions {
  play: () => void;
  solo: () => void;
  create: () => void;
  community: () => void;
  leaderboard: () => void;
  sound: () => void;
  theme: () => void;
  fullscreen: () => void;
  logout: () => Promise<void>;
}
export class HomeScreen {
  readonly root = document.createElement('main');
  private account = document.createElement('dialog');
  private profileButton = document.createElement('button');
  private guide = new Guide();
  constructor(private actions: HomeActions) {
    this.root.id = 'home';
    this.root.innerHTML = `<header class="paper-header"><a href="#" class="home-brand"><span>⌁</span> WELDPOINT</a><span class="folio">THE TEMPORAL CO-OP PUZZLE</span></header>
      <section class="setup-page"><div class="section-heading"><p class="folio">01 / CONFIGURE YOUR TIMELINE</p><h1>Choose your perspective.</h1><p>One chamber. Two operators. Opposite directions.</p></div>
      <form class="mode-form"><fieldset><legend><span>01</span> Players</legend><div class="segmented"><button type="button" data-choice="players" data-value="solo">Solo <small>Follow a recorded echo</small></button><button type="button" data-choice="players" data-value="coop">Co-op <small>Bring a live partner</small></button></div></fieldset>
      <fieldset><legend><span>02</span> Collection</legend><div class="segmented"><button type="button" data-choice="collection" data-value="campaign">Campaign <small>The original chambers</small></button><button type="button" data-choice="collection" data-value="community">Community <small>Made by other operators</small></button></div></fieldset>
      <fieldset><legend><span>03</span> Your role</legend><div class="segmented mode-roles"><button type="button" data-choice="role" data-value="1" data-player="1">Forward <small>P1 · Write the past →</small></button><button type="button" data-choice="role" data-value="2" data-player="2">Reverse <small>P2 · Meet the future ←</small></button></div></fieldset>
      <button class="ink-button mode-submit" type="submit">Select level <span>↗</span></button></form>
      <section class="objective-picker" hidden><p class="folio">02 / CHOOSE YOUR OBJECTIVE</p><h1>What brings you here?</h1><div class="objective-options"><button data-home-action="browse"><span class="objective-symbol">↔</span><b>Play a level</b><small>Enter a chamber. Find a way home.</small><span>01 ↗</span></button><button data-home-action="create"><span class="objective-symbol">⊞</span><b>Create a level</b><small>Build, solve, and publish your own.</small><span>02 ↗</span></button></div><button class="text-button" data-home-action="configure">← Change game options</button></section>
      <div class="setup-bottom"><button class="text-button" data-home-action="guide">How to play ↗</button><button class="text-button" data-home-action="leaderboard">Leaderboard ↗</button><form class="join-code-form"><label for="home-invite">Have a co-op code?</label><input id="home-invite" required pattern="${INVITE_PATTERN}" maxlength="6" minlength="6" placeholder="6-character code" aria-label="Co-op invite code"><button type="submit">Join →</button></form></div></section>
      <footer class="paper-footer"><span>ETHGLOBAL / MUMBAI 2026</span><span>YOUR PAST. THEIR WAY FORWARD.</span></footer>`;
    document.body.append(this.root);
    this.account.id = 'home-profile';
    this.account.className = 'paper-dialog profile-dialog';
    this.account.setAttribute('aria-labelledby', 'profile-title');
    this.account.innerHTML = `<button class="dialog-close" data-home-action="close" aria-label="Close profile">×</button><p class="folio">OPERATOR PROFILE</p><h2 id="profile-title"></h2><p id="profile-kind"></p><p id="profile-address"></p><p id="profile-progress"></p><button class="setting-row" data-home-action="sound"><span>Sound effects</span><b id="home-sound"></b></button><button class="setting-row" data-home-action="theme"><span>Theme pack<small>Artwork distributed through Swarm</small></span><b id="home-environment"></b></button><button class="setting-row" data-home-action="fullscreen"><span>Fullscreen</span><b>⛶</b></button><button class="setting-row" data-home-action="wallet"><span>Connect / switch wallet<small>Sign in with another Ethereum account</small></span><b>↗</b></button><p id="profile-status" role="status"></p><button class="ink-button" data-home-action="logout">Sign out ↗</button>`;
    document.body.append(this.account);
    this.profileButton.className = 'global-profile';
    this.profileButton.innerHTML =
      '<span class="guest-avatar"></span><span id="home-account-name">Profile</span><span>⌄</span>';
    this.profileButton.setAttribute('aria-label', 'Open profile and settings');
    this.profileButton.onclick = () => this.account.showModal();
    document.body.append(this.profileButton);
    this.account.addEventListener('keydown', (e) => e.stopPropagation());
    const action = (event: Event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-home-action]');
      if (!b) return;
      const name = b.dataset.homeAction!;
      if (name === 'guide') this.guide.show();
      else if (name === 'close') this.account.close();
      else if (name === 'browse')
        location.hash = `${playOptions.players}/${playOptions.collection}`;
      else if (name === 'configure') this.objective(false);
      else if (name === 'logout' || name === 'wallet') {
        b.disabled = true;
        void actions
          .logout()
          .then(() => {
            this.account.close();
            if (name === 'wallet') location.hash = 'onboarding';
          })
          .catch(() => {
            this.account.querySelector('#profile-status')!.textContent =
              'Could not sign out. Please retry.';
          })
          .finally(() => {
            b.disabled = false;
          });
      } else if (name in actions) void actions[name as keyof HomeActions]();
    };
    this.root.addEventListener('click', action);
    this.account.addEventListener('click', action);
    this.root.querySelector('.mode-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.objective(true);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) => {
      button.onclick = () => {
        const key = button.dataset.choice!;
        if (key === 'role') playOptions.role = Number(button.dataset.value) as 1 | 2;
        else if (key === 'players') playOptions.players = button.dataset.value as 'solo' | 'coop';
        else playOptions.collection = button.dataset.value as 'campaign' | 'community';
        saveOptions();
        this.choices();
      };
    });
    this.root.querySelector('.join-code-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = normalizeInviteCode(
        this.root.querySelector<HTMLInputElement>('#home-invite')!.value,
      );
      if (code) location.hash = 'invite/' + code;
    });
    this.choices();
  }
  private choices() {
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-choice]')
      .forEach((b) =>
        b.setAttribute(
          'aria-pressed',
          String(
            String(playOptions[b.dataset.choice as keyof typeof playOptions]) === b.dataset.value,
          ),
        ),
      );
  }
  private objective(show: boolean) {
    this.root.querySelector<HTMLElement>('.mode-form')!.hidden = show;
    this.root.querySelector<HTMLElement>('.section-heading')!.hidden = show;
    this.root.querySelector<HTMLElement>('.objective-picker')!.hidden = !show;
  }
  openGuide(show = true) {
    if (show) this.guide.show();
    else this.guide.root.close();
  }
  get dialogOpen() {
    return this.account.open || this.guide.root.open;
  }
  show(show: boolean) {
    this.root.hidden = !show;
    if (show) {
      this.objective(false);
      this.choices();
    }
  }
  update(
    sound: boolean,
    environment: string,
    completed: number,
    total: number,
    user: PlayerProfile | null,
  ) {
    this.profileButton.hidden = !user;
    if (user) {
      this.profileButton.querySelector('#home-account-name')!.textContent = profileLabel(user);
      this.account.querySelector('#profile-title')!.textContent = profileLabel(user);
      this.account.querySelector('#profile-kind')!.textContent =
        user.kind === 'demo' ? 'Development account' : 'Ethereum account';
      this.account.querySelector('#profile-address')!.textContent =
        user.walletAddress ?? 'Atlas & Nova · playtest operators';
      this.account.querySelector('#profile-progress')!.textContent =
        `${completed} / ${total} campaign chambers secured`;
    } else this.account.close();
    this.account.querySelector('#home-sound')!.textContent = sound ? 'ON' : 'OFF';
    this.account.querySelector('#home-environment')!.textContent = environment + ' →';
  }
  destroy() {
    this.root.remove();
    this.account.remove();
    this.profileButton.remove();
    this.guide.destroy();
  }
}
