import { defineConfig,loadEnv, type Plugin,type ViteDevServer,type PreviewServer } from 'vite';
import { attachCoop } from './server/socket';
import {AuthService} from './server/auth/AuthService';
function setup(server:Pick<ViteDevServer,'httpServer'|'middlewares'>|Pick<PreviewServer,'httpServer'|'middlewares'>,dev:boolean){
  if(!server.httpServer)return;
  const auth=new AuthService({demoEnabled:process.env.DEMO_AUTH==='true'||(dev&&process.env.DEMO_AUTH!=='false')});
  server.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/api/auth/'))void auth.handle(req,res);else next();});
  const close=attachCoop(server.httpServer,auth);server.httpServer.once('close',()=>{close();auth.close();});
}
function coop():Plugin {
  return { name:'weldpoint-coop',
    configureServer(server){setup(server,true);},
    configurePreviewServer(server){setup(server,false);},
  };
}
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'');
  for(const key of ['APP_ORIGIN','DEMO_AUTH','AUTH_DB_PATH','ETHEREUM_RPC_URL','SEPOLIA_RPC_URL'])if(process.env[key]===undefined&&env[key]!==undefined)process.env[key]=env[key];
  return {plugins:[coop()],server:{host:'0.0.0.0',port:5173,strictPort:true},preview:{host:'0.0.0.0',port:4173,strictPort:true}};
});
