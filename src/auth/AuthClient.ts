import type { AuthState, PlayerProfile } from './types';
interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
export class AuthClient {
  state: AuthState = { user: null, demoEnabled: false };
  ready = false;
  error: string | null = null;
  private context: string;
  private revision = 0;
  private timer: ReturnType<typeof setInterval>;

  constructor(private changed: () => void) {
    let context: string | null = null;
    try {
      context = sessionStorage.getItem('weldpoint:auth-context');
    } catch {}
    this.context =
      context && /^[a-f0-9]{32}$/.test(context)
        ? context
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('');
    try {
      sessionStorage.setItem('weldpoint:auth-context', this.context);
    } catch {}
    this.timer = setInterval(() => {
      void this.refresh();
    }, 60_000);
  }

  get user() {
    return this.state.user;
  }

  private async request<T>(action: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/auth/${this.context}/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(action.startsWith('levels') ? 90_000 : 15_000),
    });
    const value = await response.json();
    if (!response.ok) {
      if (response.status === 401 && (action === 'socket-ticket' || action.startsWith('levels')))
        this.expired();
      throw new Error(value.error ?? 'Sign-in service is unavailable.');
    }
    return value as T;
  }

  async refresh() {
    const revision = this.revision;
    try {
      const state = await this.request<AuthState>('session');
      if (revision !== this.revision) return;
      this.state = state;
      this.error = null;
    } catch {
      if (revision !== this.revision) return;
      this.error = 'Cannot reach the sign-in service. Check your connection and retry.';
    }
    this.ready = true;
    this.changed();
  }

  async demo(username: string, password: string) {
    this.revision++;
    this.state = await this.request<AuthState>('demo', { username, password });
    this.error = null;
    this.changed();
  }

  async wallet() {
    this.revision++;
    const provider = (window as Window & { ethereum?: WalletProvider }).ethereum;
    if (!provider)
      throw new Error(
        'Open this site in an Ethereum wallet browser or install a browser wallet, then reload.',
      );
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    const address = accounts?.[0];
    if (!address) throw new Error('No wallet account was selected.');
    const chainId = Number(await provider.request({ method: 'eth_chainId' }));
    const { message } = await this.request<{ message: string }>('challenge', { address, chainId });
    const hex =
      '0x' +
      Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join(
        '',
      );
    const signature = await provider.request({ method: 'personal_sign', params: [hex, address] });
    this.state = await this.request<AuthState>('wallet', { signature });
    this.error = null;
    this.changed();
  }

  levelRequest<T>(path = '', body?: unknown) {
    return this.request<T>('levels' + path, body);
  }

  async ticket() {
    return (await this.request<{ ticket: string }>('socket-ticket', {})).ticket;
  }

  async logout() {
    this.revision++;
    await this.request('logout', {});
    this.expired();
  }

  expired() {
    this.revision++;
    this.state = { ...this.state, user: null };
    this.changed();
  }

  destroy() {
    clearInterval(this.timer);
  }
}
export function profileLabel(user: PlayerProfile) {
  return user.ensName ?? user.displayName;
}
