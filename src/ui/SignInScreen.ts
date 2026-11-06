import type { AuthClient } from '../auth/AuthClient';
import './auth.css';
export class SignInScreen {
  readonly root = document.createElement('main');
  private busy = false;

  constructor(private auth: AuthClient) {
    this.root.id = 'signin';
    this.root.innerHTML = /* HTML */ `
      <a class="home-brand signin-brand" href="#">
        <span>⌁</span>
        WELDPOINT
      </a>
      <section class="landing-panel">
        <button class="landing-back text-button" type="button">← Back</button>
        <p class="folio">A TEMPORAL CO-OP PUZZLE</p>
        <div class="landing-emblem" aria-hidden="true">↔</div>
        <h1>
          WELDPOINT
          <span>Meet in the middle of time.</span>
        </h1>
        <button class="ink-button landing-enter" type="button">
          Log in / Sign up
          <span>↗</span>
        </button>
        <p class="landing-caption">Your past. Their way forward.</p>
      </section>
      <section class="signin-panel" hidden aria-labelledby="signin-title">
        <button class="signin-back text-button" type="button">← Back</button>
        <div class="home-kicker">
          <span></span>
          TWO OPERATORS. ONE TIMELINE.
        </div>
        <h1 id="signin-title">Meet your operator.</h1>

        <button class="signin-wallet home-play" type="button">
          <span>Connect Ethereum wallet</span>
          <span aria-hidden="true">↗</span>
        </button>
        <p class="signin-wallet-note">A signature to sign in. No transaction or gas required.</p>
        <form class="demo-form" hidden>
          <div class="signin-divider">DEVELOPMENT ACCOUNTS</div>
          <div class="demo-choices">
            <button type="button" data-demo="atlas">Use Atlas</button>
            <button type="button" data-demo="nova">Use Nova</button>
          </div>
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
          <button class="home-dialog-primary" type="submit">Sign in ↗</button>
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
        (this.root.querySelector('#demo-username') as HTMLInputElement).value = name;
        (this.root.querySelector('#demo-password') as HTMLInputElement).value =
          name === 'atlas' ? 'Atlas@WeldPoint26!' : 'Nova@WeldPoint26!';
        this.root.querySelector<HTMLInputElement>('#demo-password')!.focus();
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
