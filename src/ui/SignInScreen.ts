import { icon } from './icons';
import { brandLogo } from './brand';
import type { AuthClient } from '../auth/AuthClient';
import './auth.css';
export class SignInScreen {
  readonly root = document.createElement('main');
  private busy = false;

  constructor(private auth: AuthClient) {
    this.root.id = 'signin';
    this.root.innerHTML = /* HTML */ `
      <a class="home-brand signin-brand" href="#">
        <span class="brand-mark">${brandLogo()}</span>
        WELDPOINT
      </a>
      <section class="landing-panel">
        <button class="landing-back text-button" type="button">← Back</button>

        <h1>
          WELDPOINT
          <span>Meet in the middle of time.</span>
        </h1>
        <figure class="landing-art" aria-label="Two opposing timelines meet at a central weld">
          <img
            class="convergence-art"
            src="/illustrations/convergence.png"
            alt=""
            width="1952"
            height="488"
          />
          <img class="clock-art clock-forward" src="/illustrations/clock-forward.png" alt="" />
          <img class="clock-art clock-reverse" src="/illustrations/clock-reverse.png" alt="" />
        </figure>
        <button class="ink-button landing-enter" type="button">Sign in ${icon('arrow')}</button>
      </section>
      <section class="signin-panel" hidden aria-labelledby="signin-title">
        <button class="signin-back text-button" type="button">← Back</button>
        <h1 id="signin-title">Sign in.</h1>
        <img class="signin-art" src="/illustrations/home.png" alt="" width="900" height="300" />

        <button class="signin-wallet home-play" type="button">
          <span>Sign in with Ethereum</span>
          ${icon('arrow')}
        </button>
        <p class="signin-wallet-note">A signature to sign in. No transaction or gas required.</p>
        <form class="demo-form" hidden>
          <div class="signin-divider">DEVELOPMENT ACCOUNTS</div>
          <div class="demo-choices">
            <button type="button" data-demo="atlas">Atlas</button>
            <button type="button" data-demo="nova">Nova</button>
          </div>
          <details class="demo-credentials">
            <summary>Use account credentials</summary>
            <label for="demo-username">Username</label>
            <input
              id="demo-username"
              name="username"
              autocomplete="username"
              required
              maxlength="50"
            />
            <label for="demo-password">Password</label>
            <input
              id="demo-password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
              maxlength="200"
            />
            <button class="home-dialog-primary" type="submit">Sign in ${icon('arrow')}</button>
          </details>
        </form>
        <p class="signin-status" role="status" aria-live="polite"></p>
        <button class="signin-retry" type="button" hidden>Retry connection ↗</button>
      </section>
      <footer class="signin-footer">COOPERATE ACROSS TIME</footer>
    `;
    document.body.append(this.root);
    const landingBack = this.root.querySelector<HTMLButtonElement>('.landing-back')!;
    landingBack.disabled = history.length <= 1;
    landingBack.onclick = () => history.back();
    this.root.querySelector('.signin-back')!.addEventListener('click', () => {
      this.root.querySelector<HTMLElement>('.landing-panel')!.hidden = false;
      this.root.querySelector<HTMLElement>('.signin-panel')!.hidden = true;
    });
    this.root.querySelector('.landing-enter')!.addEventListener('click', () => this.onboarding());
    this.root.querySelector('.signin-brand')!.addEventListener('click', () => {
      this.root.querySelector<HTMLElement>('.landing-panel')!.hidden = false;
      this.root.querySelector<HTMLElement>('.signin-panel')!.hidden = true;
    });
    this.root
      .querySelector('.signin-wallet')!
      .addEventListener('click', () => void this.run(() => auth.wallet()));
    this.root
      .querySelector('.signin-retry')!
      .addEventListener('click', () => void this.run(() => auth.refresh()));
    this.root.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      void this.run(() => auth.demo(String(data.get('username')), String(data.get('password'))));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((button) =>
      button.addEventListener('click', () => {
        const name = button.dataset.demo!;
        const password = name === 'atlas' ? 'Atlas@WeldPoint26!' : 'Nova@WeldPoint26!';
        void this.run(() => auth.demo(name, password));
      }),
    );
  }

  private onboarding() {
    this.root.querySelector<HTMLElement>('.landing-panel')!.hidden = true;
    this.root.querySelector<HTMLElement>('.signin-panel')!.hidden = false;
  }

  private async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.message('Waiting for sign-in…');
    this.disable();
    try {
      await action();
      this.message(this.auth.error ?? '');
      if (this.auth.user) (this.root.querySelector('form') as HTMLFormElement).reset();
    } catch (error) {
      const code = (error as { code?: number }).code;
      this.message(
        code === 4001
          ? 'Signature cancelled. You can try again.'
          : error instanceof Error
            ? error.message
            : 'Sign-in failed. Please try again.',
      );
    } finally {
      this.busy = false;
      this.disable();
    }
  }

  private message(value: string) {
    this.root.querySelector('.signin-status')!.textContent = value;
  }

  private disable() {
    this.root
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not(.landing-back),input')
      .forEach((el) => (el.disabled = this.busy || !this.auth.ready));
  }

  update() {
    if (location.hash === '#onboarding') this.onboarding();
    this.root.hidden = !!this.auth.user;
    (this.root.querySelector('form') as HTMLFormElement).hidden = !this.auth.state.demoEnabled;
    (this.root.querySelector('.signin-retry') as HTMLButtonElement).hidden = !this.auth.error;
    if (!this.busy)
      this.message(!this.auth.ready ? 'Restoring your session…' : (this.auth.error ?? ''));
    this.disable();
  }
}
