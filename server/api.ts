import type {IncomingMessage,ServerResponse} from 'node:http';
import {AuthService} from './auth/AuthService';
import {LevelApi} from './levels/LevelApi';
import {LevelStore} from './levels/LevelStore';
import {themeApi} from './assets/ThemeApi';
export function applicationApi(auth:AuthService,levels:LevelStore){const editor=new LevelApi(auth,levels);return (req:IncomingMessage,res:ServerResponse)=>req.url?.startsWith('/api/themes/')?themeApi(req,res,levels.archive):/\/levels(?:\/|\?|$)/.test(req.url??'')?editor.handle(req,res):auth.handle(req,res);}
