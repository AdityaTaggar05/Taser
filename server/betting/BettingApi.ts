import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, AuthService } from '../auth/AuthService';
import { BettingService, PredictionError } from './BettingService';
export class BettingApi {
  private limits = new Map<string, { count: number; until: number }>();
  constructor(
    private auth: AuthService,
    private betting: BettingService,
  ) {}
  async handle(req: IncomingMessage, res: ServerResponse) {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    try {
      const path = new URL(req.url ?? '/', 'http://local').pathname,
        match =
          /^\/api\/auth\/([a-f0-9]{32})\/betting(?:\/([a-f0-9-]{36}|random)(\/predict)?)?$/.exec(
            path,
          );
      if (!match) throw new PredictionError(404, 'Unknown prediction endpoint.');
      const identity = this.auth.authorize(req, match[1], req.method !== 'GET');
      const now = Date.now();
      for (const [id, row] of this.limits) if (row.until <= now) this.limits.delete(id);
      const limit = this.limits.get(identity.user.id) ?? { count: 0, until: now + 60_000 };
      if (++limit.count > 120)
        throw new PredictionError(429, 'Too many prediction requests. Try again shortly.');
      this.limits.set(identity.user.id, limit);
      if (req.method === 'GET' && !match[3]) {
        if (!match[2]) {
          json(200, this.betting.list(identity.user.id));
          return;
        }
        const value =
          match[2] === 'random'
            ? this.betting.random(identity.user.id)
            : this.betting.view(match[2], identity.user.id);
        if (!value) throw new PredictionError(404, 'Public match unavailable.');
        json(200, value);
        return;
      }
      if (req.method !== 'POST' || !match[3] || match[2] === 'random')
        throw new PredictionError(405, 'Method not allowed.');
      if (!req.headers['content-type']?.startsWith('application/json'))
        throw new PredictionError(415, 'Send JSON data.');
      let raw = '';
      for await (const part of req) {
        raw += part.toString();
        if (Buffer.byteLength(raw) > 2048)
          throw new PredictionError(413, 'Prediction request is too large.');
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      } catch {
        throw new PredictionError(400, 'Invalid prediction request.');
      }
      json(200, this.betting.predict(match[2], identity.user.id, body.outcome, body.amount));
    } catch (error) {
      json(error instanceof PredictionError || error instanceof AuthError ? error.status : 500, {
        error:
          error instanceof PredictionError || error instanceof AuthError
            ? error.message
            : 'Prediction service unavailable.',
      });
    }
  }
}
