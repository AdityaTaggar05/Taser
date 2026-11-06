import Phaser from 'phaser';
import './style.css';
import type {CampaignSummary} from './editor/types';
let levels:CampaignSummary[]=[];
import { isLive, type Direction, type StepSnapshot } from './core/types';
import { BoardView } from './render/BoardView';
import { environments, buildEnvironment, preloadEnvironment, type EnvironmentPack } from './render/environment';
import { KEY_MOVES } from './input/TurnBuffer';
import { Hud } from './ui/Hud';
import { GameAudio } from './ui/audio';
import { HomeScreen } from './ui/HomeScreen';
import {PublishedLevels} from './ui/PublishedLevels';
import { TitleBackdrop } from './render/TitleBackdrop';
import { CoopClient } from './network/CoopClient';
import { RemoteView } from './network/RemoteView';
import type { SessionState } from './network/protocol';
import {AuthClient} from './auth/AuthClient';
import {SignInScreen} from './ui/SignInScreen';
import {EditorScreen} from './editor/EditorScreen';
import {LevelClient} from './editor/LevelClient';
import {registeredThemes,initializeThemes} from './assets/catalog';
import {applyThemeInterface} from './assets/interface';
import './assets/theme.css';

const artworkStatus=document.createElement('div');artworkStatus.className='theme-asset-warning';artworkStatus.setAttribute('role','status');artworkStatus.textContent='Loading chamber artwork…';document.body.append(artworkStatus);
try{await initializeThemes();artworkStatus.textContent='Loading sprite sheets…';}catch{artworkStatus.setAttribute('role','alert');artworkStatus.textContent='Chamber artwork is unavailable. Please reload to retry.';throw new Error('Artwork initialization failed');}

let playing=false,editing=false,screenInitialized=false,screenUser:string|null=null,screenRoute='';
let inspection:number|null=null,pack:EnvironmentPack=environments.foundry;
let preferredTheme:string|null=null;
let scene:ChamberScene|undefined,client:CoopClient|undefined;
const audio=new GameAudio(),completed=new Set<number>();
try{audio.enabled=localStorage.getItem('weldpoint:sound')!=='off';const savedTheme=localStorage.getItem('weldpoint:theme');if(savedTheme&&Object.hasOwn(environments,savedTheme)){pack=environments[savedTheme];preferredTheme=pack.id;}}catch{/* Preferences are optional. */}
function view(){return client?.state?.level?new RemoteView(client.state.level,client.state,inspection):null;}
function refresh(){
  hud.render(view(),client?.state??null,client?.status??'connecting',client?.notice??null,completed);
  home.update(audio.enabled,pack.name,completed.size,levels.length,auth.user);
  applyThemeInterface(pack,auth.user,client?.status,!!client?.state?.partnerReady);
}
function queue(direction:Direction){
  const session=client?.state;if(!session||!client?.playable||hud.helpOpen||inspection!==null)return;
  const error=session.moveErrors[direction];if(error){client.showNotice(error);return;}
  client.send({type:'move',direction,revision:session.revision});
}
function command(type:'undo'|'reset'|'cancel'){
  if(!client?.state)return;
  if(type==='undo'&&inspection!==null){inspection=null;scene?.redraw();return;}
  inspection=null;client.send({type,revision:client.state.revision});
}
function level(index:number){if(client?.state)client.send({type:'level',index,revision:client.state.revision});}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{/* Viewport still fills embedded previews. */}}
function toggleTheme(){pack=registeredThemes[(registeredThemes.indexOf(pack)+1)%registeredThemes.length];preferredTheme=pack.id;try{localStorage.setItem('weldpoint:theme',pack.id);}catch{}scene?.redraw();editor.refreshTheme();refresh();}
function toggleSound(){audio.enabled=!audio.enabled;try{localStorage.setItem('weldpoint:sound',audio.enabled?'on':'off');}catch{}hud.setSound(audio.enabled);refresh();}
const hud=new Hud(levels,{solution:()=>{void revealSolution();},home:()=>{location.hash='';},level,undo:()=>command('undo'),reset:()=>command('reset'),cancel:()=>command('cancel'),queue,fullscreen,
  inspect:step=>{inspection=step===((client?.state?.history.length??0)-1)?null:step;scene?.redraw();},
  theme:toggleTheme,sound:toggleSound,
});
hud.setSound(audio.enabled);
const auth=new AuthClient(()=>{
  completed.clear();auth.user?.completed.forEach(id=>completed.add(id));
  signin.update();editor.setUser(auth.user);syncScreen();refresh();void loadCatalog();
});
const signin=new SignInScreen(auth);
const home=new HomeScreen({play:()=>{location.hash='play';},create:()=>{location.hash='create';},community:()=>{location.hash='community';},sound:toggleSound,theme:toggleTheme,fullscreen,logout:async()=>{await auth.logout();location.hash='';}});
const levelApi=new LevelClient(auth);
const library=new PublishedLevels(levelApi,{home:()=>{location.hash='';},play:(id,player)=>{location.hash='play/'+(id?id+'/':'')+'p'+player;},fullscreen});
const editor=new EditorScreen(levelApi,{home:()=>{location.hash='';},play:id=>{location.hash='play/'+id;},fullscreen});
let catalogUser:string|null=null,catalogRequest=0;
async function loadCatalog(){
  const user=auth.user?.id??null;if(user===catalogUser)return;catalogUser=user;const request=++catalogRequest;hud.clearSolution();levels=[];hud.setLevels(levels);if(!user)return;
  try{const catalog=await levelApi.catalog();if(request!==catalogRequest||auth.user?.id!==user)return;levels=catalog.campaign;hud.setLevels(levels);refresh();}catch{if(request===catalogRequest)catalogUser=null;}
}
async function revealSolution(){
  const session=client?.state,key=session?.publicationKey,user=auth.user?.id;if(!key||!session.solutionAvailable)return;
  try{const solution=await levelApi.solution(key);if(client?.state?.publicationKey===key&&auth.user?.id===user)hud.showSolution(solution);}catch(error){client?.showNotice((error as Error).message);}
}
function syncScreen(){
  const route=/^#play(?:\/([a-f0-9-]{36}))?(?:\/p([12]))?$/.exec(location.hash);
  const custom=route?.[1],player=route?.[2]?Number(route[2]) as 1|2:undefined;
  const choosing=!!auth.user&&!!route&&!player;
  const browsing=!!auth.user&&(location.hash==='#community'||choosing);
  const next=!!auth.user&&!!route&&!!player;
  const nextEditing=!!auth.user&&location.hash==='#create';
  if(screenInitialized&&next===playing&&nextEditing===editing&&screenRoute===location.hash&&screenUser===(auth.user?.id??null))return;
  client?.leave();client=undefined;screenUser=auth.user?.id??null;
  screenInitialized=true;playing=next;editing=nextEditing;screenRoute=location.hash;inspection=null;hud.toggleHelp(false);hud.clearSolution();
  hud.root.hidden=!playing;home.show(!playing&&!editing&&!browsing&&!!auth.user);library.show(browsing,choosing,custom);editor.show(editing);signin.update();document.body.dataset.screen=playing?'play':editing?'creator':browsing?'library':auth.user?'home':'signin';
  if(playing){client=new CoopClient(receive,()=>auth.ticket(),()=>auth.expired(),custom,player);}
  scene?.redraw();refresh();
}
function receive(previous:SessionState|null){
  const current=client?.state;if(!current){refresh();return;}
  const changed=!previous||previous.revision!==current.revision||previous.player!==current.player;
  if(changed)inspection=null;
  const last=current.history.at(-1)!;
  const animate=!!previous&&current.levelIndex===previous.levelIndex&&current.customLevelId===previous.customLevelId&&current.player===previous.player&&last.step===previous.history.at(-1)!.step+1;
  if(animate)audio.play(last.status==='VICTORY'?'win':!isLive(last.status)?'fail':last.status==='WELD_SUCCESS'?'weld':current.shove!==null?'shove':'step');
  if(!current.customLevelId&&last.status==='VICTORY'&&previous?.history.at(-1)?.status!=='VICTORY')void auth.refresh();
  if(current.campaign){levels=current.campaign;hud.setLevels(levels);}
  if(previous?.publicationKey!==current.publicationKey)hud.clearSolution();
  if(!previous||previous.levelIndex!==current.levelIndex||previous.customLevelId!==current.customLevelId){const environment=preferredTheme??current.level?.environment;if(environment&&environments[environment])pack=environments[environment];}
  const old=animate?new RemoteView(previous!.level!,previous!).state:undefined;
  scene?.redraw(old,animate);refresh();
}
class ChamberScene extends Phaser.Scene {
  private board:BoardView|undefined;
  private title:TitleBackdrop|undefined;
  private artworkReady=false;
  constructor(){super('chamber');}
  preload(){for(const p of registeredThemes)preloadEnvironment(this,p);this.load.on('loaderror',()=>{artworkStatus.setAttribute('role','alert');artworkStatus.textContent='Artwork could not be loaded. Check the asset gateway and reload to retry.';document.body.append(artworkStatus);});}
  create(){scene=this;this.title=new TitleBackdrop(this);try{for(const p of registeredThemes)buildEnvironment(this,p);}catch(error){console.error('Theme registration failed',error);artworkStatus.setAttribute('role','alert');artworkStatus.textContent='Chamber artwork could not be prepared. Please reload to retry.';document.body.append(artworkStatus);this.cameras.main.setBackgroundColor(pack.palette.background);return;}this.artworkReady=true;artworkStatus.remove();this.scale.on('resize',()=>this.redraw());this.redraw();}
  redraw(previous?:StepSnapshot,animate=false){
    if(!this.artworkReady)return;
    this.cameras.main.setBackgroundColor(pack.palette.background);
    document.body.dataset.environment=pack.id;
    if(!playing){this.board?.destroy();this.board=undefined;if(editing)this.title?.clear();else this.title?.draw(this.scale.width,this.scale.height,pack);refresh();return;}
    this.title?.clear();
    const current=view();
    if(current){
      const index=(current.session.player-1) as 0|1;
      if(!this.board||this.board.index!==index){this.board?.destroy();this.board=new BoardView(this,index);}
      const width=this.scale.width,top=document.querySelector('.mission')!.getBoundingClientRect().bottom+48;
      const bottom=document.querySelector('.console')!.getBoundingClientRect().top-10,side=width<700?8:24;
      this.board.render(current,{x:side,y:top,width:width-side*2,height:Math.max(130,bottom-top)},pack,previous,animate);
    }
    document.body.dataset.environment=pack.id;refresh();
  }
}
const game=new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#151b1e',antialias:false,pixelArt:true,scale:{mode:Phaser.Scale.RESIZE,width:window.innerWidth,height:window.innerHeight},scene:[ChamberScene],render:{roundPixels:true},audio:{noAudio:true}});
syncScreen();void auth.refresh();
window.addEventListener('hashchange',syncScreen);
window.addEventListener('keydown',e=>{
  if(editing){editor.key(e);return;}
  const target=e.target as HTMLElement;if(target.matches('input,textarea,select'))return;
  if(!playing){
    if(!auth.user||home.dialogOpen||home.root.hidden)return;
    if(e.code==='KeyF'){e.preventDefault();void fullscreen();}
    if(e.code==='Enter'&&target.tagName!=='BUTTON'&&target.tagName!=='A'){e.preventDefault();location.hash='play';}
    return;
  }
  if(e.code==='Escape'){hud.toggleHelp(false);inspection=null;scene?.redraw();return;}
  if(e.code==='KeyH'){e.preventDefault();if(!e.repeat)hud.toggleHelp();return;}
  if(hud.helpOpen)return;
  if(target.tagName==='BUTTON'&&(e.code==='Enter'||e.code==='Space'))return;
  if(KEY_MOVES[e.code]){e.preventDefault();if(!e.repeat)queue(KEY_MOVES[e.code][1]);return;}
  if(e.repeat)return;
  if(e.code==='Backspace'||e.code==='KeyZ'){e.preventDefault();command('undo');}
  if(e.code==='KeyR')command('reset');if(e.code==='KeyF'){e.preventDefault();void fullscreen();}
  if(/^Digit[1-9]$/.test(e.code)&&Number(e.code.slice(-1))<=levels.length)level(Number(e.code.slice(-1))-1);
  if(e.code==='Digit0'&&levels.length>=10)level(9);
});
// Keep the queued move when switching tabs; it is already acknowledged by the server.
window.addEventListener('pagehide',()=>{client?.destroy();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
if(import.meta.hot)import.meta.hot.dispose(()=>{client?.destroy();auth.destroy();editor.destroy();library.destroy();home.root.remove();signin.root.remove();hud.root.remove();game.destroy(true);});
refresh();
