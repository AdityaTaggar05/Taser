import type {IncomingMessage,ServerResponse} from 'node:http';
import {AuthService} from './auth/AuthService';
import {LevelApi} from './levels/LevelApi';
import {CertificationApi} from './certification/Api';
import {LevelStore} from './levels/LevelStore';
export function applicationApi(auth:AuthService,levels:LevelStore){const editor=new LevelApi(auth,levels),certification=new CertificationApi(levels);return (req:IncomingMessage,res:ServerResponse)=>req.url?.startsWith('/api/cre/')?certification.handle(req,res):/\/levels(?:\/|\?|$)/.test(req.url??'')?editor.handle(req,res):auth.handle(req,res);}
