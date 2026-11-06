import { BettingApi } from './betting/BettingApi';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthService } from './auth/AuthService';
import { LevelApi } from './levels/LevelApi';
import { CertificationApi } from './certification/Api';
import { LevelStore } from './levels/LevelStore';
import { themeApi } from './assets/ThemeApi';
export function applicationApi(auth: AuthService, levels: LevelStore) {
  const editor = new LevelApi(auth, levels),
    certification = new CertificationApi(levels),
    betting = new BettingApi(auth, levels.betting);
  return (req: IncomingMessage, res: ServerResponse) =>
    req.url?.startsWith('/api/themes/')
      ? themeApi(req, res, levels.archive)
      : req.url?.startsWith('/api/cre/')
        ? certification.handle(req, res)
        : /\/betting(?:\/|\?|$)/.test(req.url ?? '')
          ? betting.handle(req, res)
          : /\/levels(?:\/|\?|$)/.test(req.url ?? '')
            ? editor.handle(req, res)
            : auth.handle(req, res);
}
