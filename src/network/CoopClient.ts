import type { ClientCommand, ServerMessage, SessionState, JoinIntent } from './protocol';
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'full';
export class CoopClient {
  state: SessionState | null = null;
  status: ConnectionStatus = 'connecting';
  notice: string | null = null;
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
    const url = new URL('/co-op', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.socket = ws;
    const handshake = setTimeout(() => ws.close(), 20_000);
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
      if (m.type === 'welcome') {
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
        clearTimeout(handshake);
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
        clearTimeout(handshake);
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
      { type: 'ready'; ready: boolean } | { type: 'start' } | { type: 'lobby'; revision: number },
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
    clearTimeout(this.retry);
    this.socket?.close();
  }
}
