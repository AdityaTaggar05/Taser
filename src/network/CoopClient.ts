import {
  JOIN_TIMEOUT_MS,
  type ClientCommand,
  type ServerMessage,
  type SessionState,
  type JoinIntent,
  type JoinProgress,
} from './protocol';
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'full';
export class CoopClient {
  state: SessionState | null = null;
  status: ConnectionStatus = 'connecting';
  notice: string | null = null;
  private progress: JoinProgress | undefined;
  private phase: 'sign-in' | 'connecting' = 'sign-in';
  private startedAt = Date.now();
  private loadingTimer: ReturnType<typeof setInterval> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  get loadingMessage() {
    if (this.status === 'connected' || this.status === 'full') return null;
    const source = this.progress?.storage === 'arkiv' ? 'Arkiv' : 'the archive';
    const step = this.progress
      ? {
          availability: `Checking chamber availability on ${source}…`,
          level: `Reading and verifying the chamber from ${source}…`,
          replay: `Loading and verifying the chamber and replay from ${source}…`,
          party: 'Creating your private session…',
        }[this.progress.stage]
      : this.phase === 'sign-in'
        ? 'Verifying your sign-in…'
        : 'Connecting to the game server…';
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    return `${step}${elapsed >= 1 ? ` (${elapsed}s)` : ''}${this.progress && this.progress.stage !== 'party' ? ' This is a read; no transaction is being sent.' : ''}`;
  }
  private stopLoading() {
    clearInterval(this.loadingTimer);
    clearTimeout(this.handshake);
  }
  retryJoin() {
    if (this.stopped || this.status !== 'full') return;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    clearTimeout(this.retry);
    this.notice = null;
    void this.connect();
  }
  private viewingOther = false;
  private studySelectionPending = false;
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private token: string | null = null;

  constructor(
    private changed: (previous: SessionState | null) => void,
    private getTicket: () => Promise<string>,
    private authRequired: () => void,
    private intent: JoinIntent,
    private sessionCreated: (id: string) => void = () => {},
  ) {
    if (intent.kind === 'resume')
      try {
        this.token = sessionStorage.getItem('weldpoint:seat:' + intent.id);
      } catch {}
    void this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    this.stopLoading();
    this.notice = null;
    this.progress = undefined;
    this.phase = 'sign-in';
    this.startedAt = Date.now();
    this.loadingTimer = setInterval(() => {
      if (!this.stopped) this.changed(this.state);
    }, 1000);
    this.studySelectionPending = false;
    this.status = this.state ? 'reconnecting' : 'connecting';
    this.changed(this.state);
    let ticket: string;
    try {
      ticket = await this.getTicket();
    } catch {
      if (!this.stopped) {
        this.status = 'reconnecting';
        this.notice = 'Could not join. Check your connection.';
        this.changed(this.state);
        this.retry = setTimeout(() => void this.connect(), 2000);
      }
      return;
    }
    if (this.stopped) return;
    this.phase = 'connecting';
    this.changed(this.state);
    const url = new URL('/co-op', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.socket = ws;
    const handshake = (this.handshake = setTimeout(() => {
      if (this.stopped || this.socket !== ws) return;
      this.stopLoading();
      this.status = 'full';
      this.notice = 'Loading the chamber took too long. Please retry.';
      this.changed(this.state);
      ws.close();
    }, JOIN_TIMEOUT_MS + 5000));
    ws.onopen = () =>
      ws.send(JSON.stringify({ type: 'join', ticket, token: this.token, intent: this.intent }));
    ws.onmessage = (event) => {
      if (this.stopped || this.socket !== ws) return;
      let m: ServerMessage;
      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }
      if (m.type === 'joining') {
        this.progress = m;
        this.changed(this.state);
      } else if (m.type === 'welcome') {
        this.token = m.token;
        if (m.sessionId) {
          this.intent = { kind: 'resume', id: m.sessionId };
          try {
            sessionStorage.setItem('weldpoint:seat:' + m.sessionId, m.token);
          } catch {}
          this.sessionCreated(m.sessionId);
        }
      } else if (m.type === 'auth_required') {
        clearTimeout(handshake);
        this.destroy();
        this.authRequired();
      } else if (m.type === 'state') {
        this.stopLoading();
        const previous = this.state,
          newAttempt = m.study?.attempt !== previous?.study?.attempt;
        if (!m.study || newAttempt) {
          this.viewingOther = false;
          this.studySelectionPending = false;
        }
        if (m.pendingMove !== null) this.studySelectionPending = false;
        this.state = m;
        this.status = 'connected';
        this.notice = null;
        this.changed(previous);
      } else if (m.type === 'full') {
        this.stopLoading();
        this.status = 'full';
        this.notice = m.message;
        this.changed(this.state);
      } else if (m.type === 'error') {
        this.studySelectionPending = false;
        this.notice = m.message;
        this.changed(this.state);
      }
    };
    ws.onclose = (event) => {
      clearTimeout(handshake);
      if (this.stopped || this.socket !== ws) return;
      if (event.code === 4401) {
        this.destroy();
        this.authRequired();
        return;
      }
      if (this.status === 'full') {
        this.changed(this.state);
        return;
      }
      this.progress = undefined;
      this.phase = 'connecting';
      this.startedAt = Date.now();
      this.status = 'reconnecting';
      this.changed(this.state);
      this.retry = setTimeout(() => void this.connect(), 1500);
    };
    ws.onerror = () => {};
  }

  get canStudy() {
    return (
      this.status === 'connected' &&
      !!this.state?.study &&
      !this.studySelectionPending &&
      this.state.party?.started !== false
    );
  }

  get otherPerspective() {
    return this.canStudy && this.viewingOther ? this.state?.study : undefined;
  }

  togglePerspective() {
    if (!this.canStudy) return;
    this.viewingOther = !this.viewingOther;
    this.changed(this.state);
  }

  get playable() {
    return (
      this.status === 'connected' &&
      !!this.state?.partnerConnected &&
      this.state.party?.started !== false
    );
  }

  send(command: ClientCommand) {
    if (!this.playable) return false;
    const sent = this.transmit(command);
    if (sent && command.type === 'move') {
      this.studySelectionPending = true;
      this.viewingOther = false;
      this.changed(this.state);
    }
    return sent;
  }

  party(
    command:
      | { type: 'broadcast'; enabled: boolean }
      | { type: 'ready'; ready: boolean }
      | { type: 'start' }
      | { type: 'lobby'; revision: number },
  ) {
    return this.transmit(command);
  }

  private transmit(value: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(value));
    return true;
  }

  showNotice(message: string) {
    this.notice = message;
    this.changed(this.state);
  }

  leave() {
    this.transmit({ type: 'leave' });
    if (this.intent.kind === 'resume')
      try {
        sessionStorage.removeItem('weldpoint:seat:' + this.intent.id);
      } catch {}
    this.token = null;
    this.destroy();
  }

  destroy() {
    this.stopped = true;
    this.stopLoading();
    clearTimeout(this.retry);
    this.socket?.close();
  }
}
