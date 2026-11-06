import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {AuthService} from '../../server/auth/AuthService.ts';
import {LevelStore} from '../../server/levels/LevelStore.ts';
import {MemoryArchive} from '../../server/arkiv/archive.ts';
import {applicationApi} from '../../server/api.ts';
import {attachCoop} from '../../server/socket.ts';
import {levels} from '../../server/data/campaign.ts';
// Isolated browser fixture: never loads .env.local or creates an Arkiv signer.
const auth=new AuthService({databasePath:':memory:',demoEnabled:true});
const archive=new MemoryArchive(),put=archive.put.bind(archive);let fail=false;
archive.put=async record=>{if(record.category==='move'){await new Promise(r=>setTimeout(r,150));if(fail)throw new Error('test offline');}return put(record);};
const store=new LevelStore(':memory:',archive);await store.seed(levels);
const snapshot=store.campaignSnapshots()[0];await store.captureRun(snapshot,{id:'fixture',displayName:'Fixture echo'},2,[levels[0].solutionP1,levels[0].solutionP2],'coop','live');
const api=applicationApi(auth,store),root=resolve('dist');
const server=createServer((req,res)=>{
 if(req.url==='/__test/fail'){fail=true;res.end('ok');return;}
 if(req.url==='/__test/recover'){fail=false;void store.flushMoves();res.end('ok');return;}
 if(req.url?.startsWith('/api/auth/')){void api(req,res);return;}
 const file=resolve(root,'.'+(req.url==='/'?'/index.html':req.url!.split('?')[0]));
 if(!file.startsWith(root+'/')||!existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'} as Record<string,string>)[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
});
const close=attachCoop(server,auth,undefined,store);
server.listen(5191,'127.0.0.1',()=>console.log('TEST ARCHIVE ONLY http://127.0.0.1:5191'));
const shutdown=()=>{close();server.close(()=>{void store.drain().then(()=>{store.close();auth.close();process.exit(0);});});};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
