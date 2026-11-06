import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, AuthService } from '../auth/AuthService';
import { ArchiveError } from '../arkiv/archive';
import { campaignPublisher } from './policy';
import { LevelError, LevelStore } from './LevelStore';
export class LevelApi {
  private limits = new Map<string, { count: number; until: number }>();

  constructor(
    private auth: AuthService,
    private store: LevelStore,
  ) {}

  private limit(id: string) {
    const now = Date.now();
    for (const [key, row] of this.limits) if (row.until <= now) this.limits.delete(key);
    const row = this.limits.get(id);
    if (!row) {
      this.limits.set(id, { count: 1, until: now + 60_000 });
      return;
    }
    if (++row.count > 20)
      throw new LevelError(429, 'Too many level writes. Try again in a minute.');
  }

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
      const url = new URL(req.url ?? '/', 'http://local'),
        match = /^\/api\/auth\/([a-f0-9]{32})\/levels(?:\/(.*))?$/.exec(url.pathname);
      if (!match) throw new LevelError(404, 'Unknown level endpoint.');
      const identity = this.auth.authorize(req, match[1], req.method !== 'GET'),
        path = match[2] ?? '',
        admin = campaignPublisher(identity.user, this.auth.demoEnabled);
      if (req.method === 'GET') {
        const moves = /^moves\/([a-f0-9-]{36})$/.exec(path);
        if (moves) {
          const raw = url.searchParams.get('sequences') ?? '';
          const sequences = raw ? raw.split(',').map(Number) : [];
          if (
            raw.length > 512 ||
            sequences.length > 32 ||
            sequences.some((n) => !Number.isSafeInteger(n) || n < 1) ||
            new Set(sequences).size !== sequences.length
          )
            throw new LevelError(400, 'Invalid move sequence.');
          json(200, await this.store.moveSequence(identity.user.id, moves[1], sequences));
          return;
        }
        if (path === 'activity') {
          json(200, this.store.activityFeed(identity.user.id));
          return;
        }
        const pageText = url.searchParams.get('page') ?? '0';
        if (!/^(0|[1-9][0-9]{0,4})$/.test(pageText))
          throw new LevelError(400, 'Invalid leaderboard page.');
        const page = Number(pageText);
        if (path === 'leaderboard') {
          json(200, this.auth.globalLeaderboard(this.store.completions(), identity.user.id, page));
          return;
        }
        const board = /^([a-f0-9-]{36})\/leaderboard$/.exec(path);
        if (board) {
          const mode = url.searchParams.get('mode') ?? 'coop';
          if (mode !== 'coop' && mode !== 'solo')
            throw new LevelError(400, 'Unknown leaderboard mode.');
          json(200, await this.store.leaderboard(board[1], identity.user.id, mode, page));
          return;
        }
        if (path === 'catalog' || path === 'community' || path.startsWith('runs/'))
          await this.store.refreshAvailability();
        const runs = /^runs\/([a-f0-9-]{36})\/([12])$/.exec(path);
        if (runs) {
          json(200, { runs: this.store.runs(runs[1], Number(runs[2]) as 1 | 2) });
          return;
        }
        if (path === 'catalog') {
          json(200, {
            campaign: this.store.campaign(),
            canPublishCampaign: admin,
            storage: this.store.storage,
          });
          return;
        }
        const solution = /^solution\/(0x[a-fA-F0-9]{64})$/.exec(path);
        if (solution) {
          json(200, await this.store.solution(identity.user.id, solution[1]));
          return;
        }
        const template = /^campaign\/([a-f0-9-]{36})\/template$/.exec(path);
        if (template) {
          json(200, { level: await this.store.template(identity.user.id, template[1], admin) });
          return;
        }
        if (path && path !== 'community' && !/^[a-f0-9-]{36}$/.test(path))
          throw new LevelError(404, 'Unknown level endpoint.');
        json(
          200,
          path === 'community'
            ? { levels: this.store.community() }
            : path
              ? this.store.get(identity.user.id, path)
              : { levels: this.store.list(identity.user.id) },
        );
        return;
      }
      if (req.method !== 'POST') throw new LevelError(405, 'Method not allowed.');
      const write = /^([a-f0-9-]{36})(?:\/(publish|certification|heart))?$/.exec(path);
      if (path && !write) throw new LevelError(404, 'Unknown level endpoint.');
      if (!req.headers['content-type']?.startsWith('application/json'))
        throw new LevelError(415, 'Send JSON data.');
      this.limit(identity.user.id);
      let raw = '';
      for await (const part of req) {
        raw += part.toString();
        if (Buffer.byteLength(raw) > 65_536)
          throw new LevelError(413, 'Level file is too large (maximum 64 KB).');
      }
      let body: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        body = value as Record<string, unknown>;
      } catch {
        throw new LevelError(400, 'Invalid JSON level request.');
      }
      if (write?.[2] === 'heart') {
        if (typeof body.entityKey !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(body.entityKey))
          throw new LevelError(400, 'Missing publication identity.');
        json(200, await this.store.heart(write[1], identity.user.id, body.entityKey));
        return;
      }
      if (write?.[2] === 'certification') {
        json(200, await this.store.refreshCertification(identity.user.id, write[1]));
        return;
      }
      if (write?.[2] === 'publish') {
        if (!Number.isSafeInteger(body.revision))
          throw new LevelError(400, 'Missing draft revision.');
        if (body.target !== undefined && body.target !== 'community' && body.target !== 'campaign')
          throw new LevelError(400, 'Unknown publishing destination.');
        if (body.target === 'campaign' && !admin)
          throw new LevelError(403, 'Only the campaign publisher account can publish to campaign.');
        json(
          200,
          await this.store.publish(
            identity.user.id,
            write[1],
            body.revision as number,
            body.target as 'campaign' | 'community' | undefined,
          ),
        );
        return;
      }
      if (
        body.createId !== undefined &&
        (typeof body.createId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.createId))
      )
        throw new LevelError(400, 'Invalid draft identifier.');
      try {
        json(
          200,
          await this.store.save(
            identity.user.id,
            identity.user.displayName,
            body.level,
            write?.[1],
            body.revision as number | undefined,
            body.createId as string | undefined,
          ),
        );
      } catch (error) {
        if (error instanceof LevelError || error instanceof ArchiveError) throw error;
        throw new LevelError(422, 'Invalid level layout.');
      }
    } catch (error) {
      if (!res.headersSent)
        json(
          error instanceof LevelError || error instanceof AuthError || error instanceof ArchiveError
            ? error.status
            : 500,
          {
            error:
              error instanceof LevelError ||
              error instanceof AuthError ||
              error instanceof ArchiveError
                ? error.message
                : 'Could not process the level. Please retry.',
          },
        );
      else res.end();
    }
  }
}
