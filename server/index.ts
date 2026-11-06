import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachCoop } from './socket';
import {AuthService} from './auth/AuthService';
import {levelRuntime} from './levels/runtime';
import {loadServerEnv} from './arkiv/config';
loadServerEnv();
import {applicationApi} from './api';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
if(!existsSync(resolve(root,'index.html')))throw new Error('Run npm run build before npm start.');
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
const auth=new AuthService({demoEnabled:process.env.DEMO_AUTH==='true'});
const levels=await levelRuntime(auth),api=applicationApi(auth,levels);
const server=createServer((req,res)=>{
  if(req.url?.startsWith('/api/auth/')){void api(req,res);return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let path:string;try{path=decodeURIComponent(new URL(req.url??'/', 'http://local').pathname);}catch{res.writeHead(400);res.end();return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(resolve(root)+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
  if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
const close=attachCoop(server,auth,undefined,levels);
server.listen(Number(process.env.PORT??5173),'0.0.0.0',()=>console.log(`WeldPoint co-op listening on port ${process.env.PORT??5173}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{close();server.close(()=>{levels.close();auth.close();process.exit(0);});});
