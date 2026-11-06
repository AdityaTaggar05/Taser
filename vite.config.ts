import { defineConfig,loadEnv, type Plugin,type ViteDevServer,type PreviewServer } from 'vite';
import { attachCoop } from './server/socket';
import {AuthService} from './server/auth/AuthService';
import {levelRuntime} from './server/levels/runtime';
import {SERVER_ENV_KEYS} from './server/arkiv/config';
import {applicationApi} from './server/api';
async function setup(server:Pick<ViteDevServer,'httpServer'|'middlewares'>|Pick<PreviewServer,'httpServer'|'middlewares'>,dev:boolean){
  if(!server.httpServer)return;
  const auth=new AuthService({demoEnabled:process.env.DEMO_AUTH==='true'||(dev&&process.env.DEMO_AUTH!=='false')});
  const levels=await levelRuntime(auth),api=applicationApi(auth,levels);
  server.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/api/auth/'))void api(req,res);else next();});
  const close=attachCoop(server.httpServer,auth,undefined,levels);server.httpServer.once('close',()=>{close();levels.close();auth.close();});
}
function coop():Plugin {
  return { name:'weldpoint-coop',
    async configureServer(server){await setup(server,true);},
    async configurePreviewServer(server){await setup(server,false);},
  };
}
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'');
  for(const key of SERVER_ENV_KEYS)if(process.env[key]===undefined&&env[key]!==undefined)process.env[key]=env[key];
  return {plugins:[coop()],server:{host:'0.0.0.0',port:5173,strictPort:true},preview:{host:'0.0.0.0',port:4173,strictPort:true}};
});
