import type {IncomingMessage,ServerResponse} from 'node:http';
import {AuthService} from './auth/AuthService';
import {LevelApi} from './levels/LevelApi';
import {LevelStore} from './levels/LevelStore';
export function applicationApi(auth:AuthService,levels:LevelStore){const editor=new LevelApi(auth,levels);return (req:IncomingMessage,res:ServerResponse)=>/\/levels(?:\/|\?|$)/.test(req.url??'')?editor.handle(req,res):auth.handle(req,res);}
