import { timelineArt, collectionArt, roleArt } from './TimelineArt';
import { icon } from './icons';
import { brandLogo } from './brand';
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
    this.root.innerHTML = `<header class="paper-header"><button class="text-button" data-home-action="back">← Back</button><a href="#" class="home-brand"><span class="brand-mark">${brandLogo()}</span> WELDPOINT</a><span class="folio">THE TEMPORAL CO-OP PUZZLE</span></header>
      <section class="setup-page"><section class="home-welcome" hidden><h1>WeldPoint</h1><button class="ink-button" data-home-action="begin">Continue</button></section><div class="section-heading"><h1>Set up your session.</h1></div>
      <form class="mode-form"><fieldset><legend> Players</legend><div class="segmented"><button type="button" data-choice="players" data-value="solo">Solo </button><button type="button" data-choice="players" data-value="coop">Co-op </button></div><div class="configuration-operators" aria-hidden="true"><span data-player="1"></span>${icon('arrow')}<span data-player="2"></span></div></fieldset>
      <fieldset><legend> Collection</legend><div class="segmented"><button type="button" data-choice="collection" data-value="campaign">Campaign </button><button type="button" data-choice="collection" data-value="community">Community </button></div>${collectionArt()}</fieldset>
      <fieldset><legend> Your role</legend><div class="segmented mode-roles"><button type="button" data-choice="role" data-value="1" data-player="1">Forward P1</button><button type="button" data-choice="role" data-value="2" data-player="2">Reverse P2</button></div>${roleArt()}</fieldset>
      <button class="ink-button mode-submit" type="submit">Select level ${icon('arrow')}</button></form>
      <section class="objective-picker" hidden><h1>Your next move.</h1><div class="objective-options"><button data-home-action="browse"><span class="objective-symbol">${icon('play')}</span><b>Play</b><span>${icon('arrow')}</span></button>${timelineArt('home-timeline')}<button data-home-action="create"><span class="objective-symbol">${icon('create')}</span><b>Create</b><span>${icon('arrow')}</span></button></div></section>
      <div class="setup-bottom"><button class="text-button" data-home-action="guide">${icon('book')} How to play</button><button class="text-button" data-home-action="leaderboard">${icon('trophy')} Leaderboard</button><form class="join-code-form"><label for="home-invite">Join a party</label><input id="home-invite" required pattern="${INVITE_PATTERN}" maxlength="6" minlength="6" placeholder="6-character code" aria-label="Co-op invite code"><button type="submit">Join ${icon('arrow')}</button></form></div></section>
      <footer class="paper-footer"><span>YOUR PAST. THEIR WAY FORWARD.</span></footer>`;
    document.body.append(this.root);
    this.account.id = 'home-profile';
    this.account.className = 'paper-dialog profile-dialog';
    this.account.setAttribute('aria-labelledby', 'profile-title');
    this.account.innerHTML = `<button class="dialog-close" data-home-action="close" aria-label="Close profile">×</button><p class="folio">OPERATOR PROFILE</p><h2 id="profile-title"></h2><p id="profile-kind"></p><p id="profile-address"></p><p id="profile-progress"></p><button class="setting-row" data-home-action="sound"><span>Sound effects</span><b id="home-sound"></b></button><button class="setting-row" data-home-action="theme"><span>Theme pack</span><b id="home-environment"></b></button><button class="setting-row" data-home-action="fullscreen"><span>Fullscreen</span><b>⛶</b></button><button class="setting-row" data-home-action="wallet"><span>Connect / switch wallet</span><b>↗</b></button><p id="profile-status" role="status"></p><button class="ink-button" data-home-action="logout">Sign out ↗</button>`;
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
      else if (name === 'browse') this.objective(false);
      else if (name === 'configure' || name === 'begin') this.objective(true);
      else if (name === 'back') {
        if (!this.root.querySelector<HTMLElement>('.mode-form')!.hidden) this.objective(true);
        else {
          this.root.querySelector<HTMLElement>('.objective-picker')!.hidden = true;
          this.root.querySelector<HTMLElement>('.home-welcome')!.hidden = false;
        }
      } else if (name === 'logout' || name === 'wallet') {
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
      location.hash = `${playOptions.players}/${playOptions.collection}`;
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
    this.objective(true);
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
    this.root.querySelector<HTMLElement>('.home-welcome')!.hidden = true;
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
      this.objective(true);
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
    this.account
      .querySelector('[data-home-action=sound]')!
      .setAttribute('aria-pressed', String(sound));
    this.account.querySelector('#home-environment')!.textContent = environment + ' →';
  }
  destroy() {
    this.root.remove();
    this.account.remove();
    this.profileButton.remove();
    this.guide.destroy();
  }
}
