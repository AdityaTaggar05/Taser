import { defineConfig, type Plugin } from 'vite';
import { attachCoop } from './server/socket';
function coop():Plugin {
  return { name:'weldpoint-coop',
    configureServer(server){if(server.httpServer){const close=attachCoop(server.httpServer);server.httpServer.once('close',close);}},
    configurePreviewServer(server){const close=attachCoop(server.httpServer);server.httpServer.once('close',close);},
  };
}
export default defineConfig({plugins:[coop()],server:{host:'0.0.0.0',port:5173,strictPort:true},preview:{host:'0.0.0.0',port:4173,strictPort:true}});
