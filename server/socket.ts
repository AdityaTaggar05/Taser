import type { EventEmitter } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import type { Peer, PublishedLevelLoader } from './CoopRoom';
import type { AuthService, SessionIdentity } from './auth/AuthService';
import { LevelError, type LevelStore } from './levels/LevelStore';
import { JOIN_TIMEOUT_MS } from '../src/network/protocol';
import { Sessions } from './game/Sessions';
export function attachCoop(
  server: EventEmitter,
  auth: AuthService,
  _legacyLoader?: PublishedLevelLoader,
  store?: LevelStore,
) {
  if (!store) throw new Error('Game sessions require a published level store.');
  const sessions = new Sessions(auth, store),
    wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  let closing = false,
    flushing = false;
  const identities = new Map<WebSocket, { identity: SessionIdentity; peer: Peer }>(),
    alive = new Map<WebSocket, boolean>();
  const reject = (ws: WebSocket, peer: Peer) => {
    sessions.disconnect(peer, true);
    peer.send({ type: 'auth_required', message: 'Your session ended. Please sign in again.' });
    ws.close(4401, 'Sign in required');
  };
  const unsubscribe = auth.onRevoke((key) => {
    for (const [ws, e] of identities) if (e.identity.key === key) reject(ws, e.peer);
  });
  const upgrade = (
    request: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    if (request.url?.split('?')[0] !== '/co-op') return;
    if (request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host) {
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  };
  server.on('upgrade', upgrade);
  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    const peer: Peer = {
      send: (message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      },
      close: () => ws.close(1000),
    };
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    let joined = false,
      joining = false,
      count = 0,
      start = Date.now();
    const timer = setTimeout(() => ws.close(1008, 'Join timeout'), 5000);
    ws.on('message', (raw) => {
      if (joining) return;
      if (Date.now() - start > 1000) {
        count = 0;
        start = Date.now();
      }
      if (++count > 40) {
        ws.close(1008, 'Too many commands');
        return;
      }
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(raw.toString());
        if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error();
      } catch {
        peer.send({ type: 'error', message: 'Malformed game message.' });
        return;
      }
      if (!joined) {
        if (m.type !== 'join') {
          ws.close(1008, 'Join required');
          return;
        }
        clearTimeout(timer);
        const identity = auth.consumeTicket(m.ticket);
        if (!identity) {
          reject(ws, peer);
          return;
        }
        identities.set(ws, { identity, peer });
        joining = true;
        joinTimer = setTimeout(() => {
          peer.send({ type: 'full', message: 'Loading the chamber took too long. Please retry.' });
          ws.close(1013, 'Join timeout');
        }, JOIN_TIMEOUT_MS);
        void sessions
          .join(
            peer,
            identity.user,
            m.intent,
            typeof m.token === 'string' && m.token.length <= 128 ? m.token : undefined,
            () => !closing && ws.readyState === WebSocket.OPEN && auth.isActive(identity.key),
          )
          .then(() => {
            if (closing || ws.readyState !== WebSocket.OPEN || !auth.isActive(identity.key)) {
              sessions.disconnect(peer, true);
              return;
            }
            joined = true;
          })
          .catch((error) => {
            peer.send({
              type: 'full',
              message:
                error instanceof LevelError
                  ? error.message
                  : 'The archived challenge could not be loaded. Return home and retry.',
            });
            peer.close();
          })
          .finally(() => {
            clearTimeout(joinTimer);
            joining = false;
          });
        return;
      }
      const entry = identities.get(ws);
      if (!entry || !auth.isActive(entry.identity.key)) {
        reject(ws, peer);
        return;
      }
      if (m.type === 'leave') {
        sessions.disconnect(peer, true);
        peer.close();
        return;
      }
      sessions.receive(peer, m);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      clearTimeout(joinTimer);
      alive.delete(ws);
      identities.delete(ws);
      if (!closing) sessions.disconnect(peer);
    });
    ws.on('error', () => {});
  });
  const maintenance = setInterval(() => {
    auth.sweep();
    sessions.sweep();
    if (!flushing) {
      flushing = true;
      void store
        .flushHearts()
        .then(() => store.flushRuns())
        .then(() => store.flushCertifications())
        .then(() => store.betting.flush())
        .then(() => store.flushMoves())
        .catch(() => {})
        .finally(() => (flushing = false));
    }
    for (const [ws, ok] of alive) {
      const e = identities.get(ws);
      if (e && !auth.isActive(e.identity.key)) {
        reject(ws, e.peer);
        continue;
      }
      if (!ok) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 10_000);
  maintenance.unref();
  return () => {
    closing = true;
    unsubscribe();
    clearInterval(maintenance);
    server.off('upgrade', upgrade);
    sessions.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
