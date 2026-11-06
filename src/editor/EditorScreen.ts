import {KEY_MOVES} from '../input/TurnBuffer';
import {cleanDraft} from '../core/levelValidation';
import {computeLaserTiles,isExitOpen} from '../core/engine';
import {hasCoord,sameCoord,type Coord,type Direction,type LevelConfig} from '../core/types';
import {environments,type AssetRole} from '../render/environment';
import type {PlayerProfile} from '../auth/types';
import {EditorModel,blankLevel} from './EditorModel';
import {verifySolution} from './solution';
import {LevelClient} from './LevelClient';
import type {EditorTool,EditorView,LevelSummary,StoredLevel,LevelCatalog} from './types';
import './editor.css';
const tools:Array<[EditorTool,string,string]>=[['floor','·','Floor'],['wall','▧','Wall'],['ice','≈','Ice'],['p1','1','P1 spawn'],['p2','2','P2 spawn'],['box1','□','P1 box'],['box2','□','P2 box'],['weld','◇','Weld target'],['switch1','S1','P1 switch'],['switch2','S2','P2 switch'],['exit1','E1','P1 exit'],['exit2','E2','P2 exit'],['midpoint','S*','Midpoint switch'],['laser','↧','Laser emitter'],['receiver','R1','P1 receiver'],['erase','×','Erase overlays']];
const arrows:Record<Direction,string>={U:'↑',D:'↓',L:'←',R:'→',W:'Wait'};
const dragTools:EditorTool[]=['floor','wall','ice','switch1','switch2','erase'];
interface Actions {home:()=>void;play:(id:string)=>void;fullscreen:()=>void}
/** Authoring workspace. The simulated state comes from the same engine as co-op. */
export class EditorScreen {
  readonly root=document.createElement('main');
  model=new EditorModel();
  private catalog:LevelCatalog={campaign:[],canPublishCampaign:false,storage:'unconfigured'};private draftId=crypto.randomUUID();
  private user:PlayerProfile|null=null;private stored:StoredLevel|null=null;private dirty=false;
  private tool:EditorTool='wall';private box=0;private view:EditorView='author';private busy=false;
  private generation=0;private libraryRequest=0;private active=false;
  private observer:ResizeObserver;
  constructor(private api:LevelClient,private actions:Actions){
    this.root.id='creator';this.root.hidden=true;
    this.root.innerHTML=`<header class="creator-top"><button data-editor="home" aria-label="Return to home">⌂</button><span class="creator-wordmark">WELDPOINT <small>CHAMBER CREATOR</small></span><span class="creator-save-state" role="status">Unsaved draft</span><div class="creator-actions"><button data-editor="new">New</button><button data-editor="undo-edit" title="Undo design edit (Ctrl/Cmd+Z)">Undo</button><button data-editor="redo-edit" title="Redo design edit (Ctrl/Cmd+Shift+Z)">Redo</button><button data-editor="library">My levels / Community</button><button data-editor="import">Import</button><button data-editor="export">Export</button><button data-editor="save">Save draft</button><button class="primary" data-editor="publish">Publish to community</button><button data-editor="publish-campaign" hidden>Publish to campaign</button></div></header>
    <div class="creator-workspace"><aside class="creator-sidebar"><label class="creator-label" for="creator-template">START FROM A TEMPLATE</label><select id="creator-template"><option value="">Choose a chamber…</option></select><label class="creator-label" for="creator-name">CHAMBER NAME</label><input id="creator-name" maxlength="80"/><label class="creator-label" for="creator-subtitle">DESCRIPTION</label><input id="creator-subtitle" maxlength="180"/><div class="creator-fields"><label>Width<input id="creator-width" type="number" min="2" max="20"/></label><label>Height<input id="creator-height" type="number" min="2" max="20"/></label><label>Turns<input id="creator-turns" type="number" min="2" max="32" step="2"/></label><label>Box pairs<select id="creator-boxes">${Array.from({length:6},(_,i)=>`<option>${i+1}</option>`).join('')}</select></label></div><label class="creator-label" for="creator-environment">ENVIRONMENT</label><select id="creator-environment">${Object.keys(environments).map(id=>`<option value="${id}">${id.toUpperCase()}</option>`).join('')}</select><label class="creator-checkbox"><input type="checkbox" id="creator-mirrors"/> Mirror boxes</label><label class="creator-label" for="creator-laser-dir">LASER DIRECTION</label><select id="creator-laser-dir"><option value="D">↓ South</option><option value="U">↑ North</option><option value="L">← West</option><option value="R">→ East</option></select><div class="creator-tool-heading"><span class="creator-label">PLACE OBJECTS</span><label for="creator-box-id">Box identity <select id="creator-box-id"></select></label></div><div class="creator-tools" role="toolbar" aria-label="Placement tools">${tools.map(([id,icon,label])=>`<button data-tool="${id}" aria-pressed="false"><b>${icon}</b><span>${label}</span></button>`).join('')}</div><p class="creator-note">Select a box identity before placing its P1 start, P2 start and weld target. Use Floor to remove walls/ice. Erase removes optional overlays; move required objects with their tool.</p></aside>
    <section class="creator-centre"><div class="creator-stage-top"><div class="creator-view-tabs" role="group" aria-label="Board perspective"><button data-view="author">Author</button><button data-view="p1">P1 view</button><button data-view="p2">P2 view</button></div><span class="creator-board-meta"></span><select id="creator-zoom" aria-label="Grid zoom"><option value="fit">Fit grid</option><option value="48">48 px</option><option value="64">64 px</option><option value="86">86 px</option></select><button data-editor="fullscreen" aria-label="Fullscreen">⛶</button></div><div class="creator-stage"><div class="creator-grid" role="grid" aria-label="Level grid"></div></div><div class="creator-stage-caption">AUTHOR VIEW · Both timelines and hidden weld targets are visible here only.</div><section class="creator-test"><div class="creator-test-top"><div><strong>Solution recorder</strong><small>WASD / Space: P1 · Arrows / Enter: P2. Both inputs commit a turn.</small></div><button data-editor="test">Start playtest</button><button data-editor="replay">Replay solution</button><button data-editor="edit" hidden>Back to editing</button></div><div class="creator-test-controls" hidden>${([1,2] as const).map(p=>`<div class="creator-player p${p}"><strong>P${p}</strong>${(['L','U','D','R','W'] as Direction[]).map(d=>`<button data-test-player="${p}" data-direction="${d}" aria-label="P${p} ${d==='W'?'Wait':{U:'Up',D:'Down',L:'Left',R:'Right'}[d]}">${arrows[d]}</button>`).join('')}<button data-cancel-player="${p}">Cancel</button><span class="creator-queued"></span></div>`).join('')}<button data-editor="undo-turn">Undo turn</button><button data-editor="capture" class="primary">Use winning solution</button></div><div class="creator-solution" aria-label="Recorded solution"></div><div class="creator-message" role="status" aria-live="polite"></div></section></section></div>
    <input id="creator-file" type="file" accept="application/json,.json" hidden/><dialog class="home-dialog creator-library" aria-labelledby="creator-library-title"><button class="dialog-close" data-editor="close-library" aria-label="Close level library">×</button><span class="home-kicker">CHAMBER LIBRARY</span><h2 id="creator-library-title">Build. Verify. Share.</h2><div class="creator-library-tabs"><button data-library="mine">My levels</button><button data-library="community">Community</button></div><p class="creator-library-status" role="status"></p><div class="creator-level-list"></div></dialog><dialog class="home-dialog" id="creator-published" aria-labelledby="creator-published-title"><button class="dialog-close" data-editor="close-published" aria-label="Close published level">×</button><span class="home-kicker">VERIFIED · ENCRYPTED ON ARKIV</span><h2 id="creator-published-title">Your chamber is live.</h2><p>Open this link with a partner signed in on another account. It uses the shared two-player room.</p><label class="creator-label" for="creator-share-link">LEVEL LINK</label><input id="creator-share-link" readonly/><button data-editor="copy-link" class="home-dialog-primary">Copy link</button><button data-editor="play-published" class="home-dialog-primary">Play together ↗</button><p class="creator-copy-status" role="status"></p><p class="creator-archive-proof"></p></dialog>`;
    document.body.append(this.root);
    this.root.addEventListener('click',e=>this.click(e));
    this.root.querySelector('.creator-grid')!.addEventListener('pointerdown',e=>{const event=e as PointerEvent;if(event.button!==0)return;const tile=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-cell]');if(tile&&dragTools.includes(this.tool)&&!this.model.engine){event.preventDefault();this.paint(tile);}});
    this.root.querySelector('.creator-grid')!.addEventListener('pointerover',e=>{const event=e as PointerEvent;if(event.buttons!==1||!dragTools.includes(this.tool)||this.model.engine)return;const tile=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-cell]');if(tile)this.paint(tile);});
    this.root.addEventListener('change',e=>this.change(e));
    this.observer=new ResizeObserver(()=>{if(this.active)this.sizeGrid();});this.observer.observe(this.root.querySelector('.creator-stage')!);
    this.syncFields();this.render();
  }
  private el<T extends HTMLElement=HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  private message(text:string){this.el('.creator-message').textContent=text;}
  private recoveryKey(){let tab='memory';try{tab=sessionStorage.getItem('weldpoint:auth-context')??tab;}catch{}return `weldpoint:editor:${this.user?.id}:${tab}`;}
  private recover(){try{const raw=localStorage.getItem(this.recoveryKey());if(raw){const data=JSON.parse(raw);this.model=new EditorModel(cleanDraft(data.level));this.stored=data.stored??null;this.draftId=data.draftId??crypto.randomUUID();this.dirty=true;this.message('Recovered your unsaved draft from this browser. Save it to your account when ready.');}}catch{this.message('Your previous local recovery could not be loaded. Import a level or start a new draft.');}}
  private remember(){if(!this.user)return;try{if(this.dirty)localStorage.setItem(this.recoveryKey(),JSON.stringify({level:this.model.level,draftId:this.draftId,stored:this.stored?{...this.stored,level:undefined}:null}));else localStorage.removeItem(this.recoveryKey());}catch{this.message('Browser recovery is unavailable. Save this draft to your account before leaving.');}}
  setUser(user:PlayerProfile|null){if(user?.id===this.user?.id)return;this.generation++;this.user=user;this.catalog={campaign:[],canPublishCampaign:false,storage:'unconfigured'};this.draftId=crypto.randomUUID();this.stored=null;this.dirty=false;this.model=new EditorModel();this.view='author';if(user)this.recover();this.syncFields();this.render();}
  show(visible:boolean){this.active=visible;this.root.hidden=!visible;if(!visible)this.root.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());else{this.render();this.sizeGrid();void this.loadCatalog();}}
  private replace(level:LevelConfig,stored:StoredLevel|null=null){if(this.dirty&&!window.confirm('Replace the current unsaved draft? Export or save it first if you want to keep it.'))return;this.generation++;this.model=new EditorModel(level);this.draftId=crypto.randomUUID();this.stored=stored;this.dirty=!stored;this.view='author';this.box=0;this.remember();this.syncFields();this.render();this.message(stored?'Draft loaded.':'New draft. Place objects, then record a winning solution.');}
  private changed(){this.dirty=true;this.remember();this.render();}
  private paint(tile:HTMLButtonElement){if(this.model.engine||this.busy)return;const coord=tile.dataset.cell!.split(',').map(Number) as Coord;try{if(this.model.paint(this.tool,coord,this.box)){this.changed();this.message('Design changed. Record a fresh solution before publishing.');}}catch(error){this.message((error as Error).message);}}
  private click(e:MouseEvent){
    const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button||button.disabled)return;
    if(button.dataset.cell){this.paint(button);return;}
    if(button.dataset.tool){this.tool=button.dataset.tool as EditorTool;this.render();return;}
    if(button.dataset.view){this.view=button.dataset.view as EditorView;this.render();return;}
    if(button.dataset.library){void this.library(button.dataset.library==='community');return;}
    if(button.dataset.testPlayer){try{this.model.queue(Number(button.dataset.testPlayer) as 1|2,button.dataset.direction as Direction);this.message(this.model.engine!.state.message);this.render();}catch(error){this.message((error as Error).message);}return;}
    if(button.dataset.cancelPlayer){this.model.pending[Number(button.dataset.cancelPlayer)-1]=null;this.render();return;}
    const action=button.dataset.editor;
    try{
      if(action==='home'){this.actions.home();return;}
      if(action==='undo-edit'||action==='redo-edit'){action==='undo-edit'?this.model.undo():this.model.redo();this.dirty=true;this.remember();this.syncFields();this.render();this.message('Design history restored.');return;}
      if(action==='new'){this.replace(blankLevel());return;}
      if(action==='library'){this.el<HTMLDialogElement>('.creator-library').showModal();void this.library(false);return;}
      if(action==='close-library'){this.el<HTMLDialogElement>('.creator-library').close();return;}
      if(action==='close-published'){this.el<HTMLDialogElement>('#creator-published').close();return;}
      if(action==='fullscreen'){this.actions.fullscreen();return;}
      if(action==='import'){this.el<HTMLInputElement>('#creator-file').click();return;}
      if(action==='export'){this.export();return;}
      if(action==='save'||action==='publish'||action==='publish-campaign'){void this.persist(action!=='save',action==='publish-campaign'?'campaign':'community');return;}
      if(action==='test'||action==='replay'){this.model.start();this.view='p1';if(action==='replay'){const l=this.model.level;if(l.solutionP1.length!==l.totalSteps||l.solutionP2.length!==l.totalSteps)throw new Error('This draft has no complete recorded solution.');for(let k=0;k<l.totalSteps;k++){this.model.queue(1,l.solutionP1[k]);this.model.queue(2,l.solutionP2[k]);}}this.message(this.model.engine!.state.message);this.render();return;}
      if(action==='edit'){this.model.engine=null;this.view='author';this.render();return;}
      if(action==='undo-turn'){this.model.undoTurn();this.render();this.message('Turn undone. Choose both inputs again.');return;}
      if(action==='capture'){const check=this.model.capture();this.dirty=true;this.remember();this.message(check.message+' Save or publish this draft.');this.render();return;}
      if(action==='copy-link'){const link=this.el<HTMLInputElement>('#creator-share-link');void navigator.clipboard.writeText(link.value).then(()=>{this.el('.creator-copy-status').textContent='Link copied.';}).catch(()=>{link.select();this.el('.creator-copy-status').textContent='Select and copy the link above.';});return;}
      if(action==='play-published'&&this.stored){this.actions.play(this.stored.id);return;}
    }catch(error){this.message((error as Error).message);this.render();}
  }
  private change(e:Event){
    const input=e.target as HTMLInputElement|HTMLSelectElement;
    try{
      if(this.busy)return;
      if(input.id==='creator-file'){const file=(input as HTMLInputElement).files?.[0];if(file){if(file.size>65_536)throw new Error('Import a JSON file smaller than 64 KB.');const generation=this.generation;void file.text().then(text=>{if(generation!==this.generation)return;try{this.replace(cleanDraft(JSON.parse(text)));}catch(error){this.message((error as Error).message);}}).catch(()=>this.message('Could not read the level file.'));}input.value='';return;}
      if(input.id==='creator-template'){if(input.value)void this.loadTemplate(input.value);input.value='';return;}
      if(input.id==='creator-zoom'){this.sizeGrid();return;}
      if(input.id==='creator-box-id'){this.box=Number(input.value);this.render();return;}
      if(this.model.engine)return;
      let changed=false;
      if(input.id==='creator-name'||input.id==='creator-subtitle')changed=this.model.edit(l=>{l[input.id==='creator-name'?'name':'subtitle']=input.value;});
      if(input.id==='creator-width'||input.id==='creator-height')changed=this.model.resize(Number(this.el<HTMLInputElement>('#creator-width').value),Number(this.el<HTMLInputElement>('#creator-height').value));
      if(input.id==='creator-turns')changed=this.model.edit(l=>{l.totalSteps=Number(input.value);l.weldStep=l.totalSteps/2;});
      if(input.id==='creator-boxes'){changed=this.model.boxCount(Number(input.value));this.box=Math.min(this.box,this.model.level.initialBoxesP1.length-1);}
      if(input.id==='creator-environment')changed=this.model.edit(l=>{l.environment=input.value;});
      if(input.id==='creator-mirrors')changed=this.model.edit(l=>{l.hasMirrorBox=(input as HTMLInputElement).checked;});
      if(input.id==='creator-laser-dir')changed=this.model.edit(l=>{if(l.laserEmitter)l.laserEmitter.dir=input.value as Direction;});
      if(changed){this.changed();this.syncFields();this.message('Draft changed. Previous solution cleared.');}
    }catch(error){this.message((error as Error).message);this.syncFields();}
  }
  private syncFields(){
    const l=this.model.level;
    for(const [id,value] of Object.entries({'creator-name':l.name,'creator-subtitle':l.subtitle,'creator-width':l.width,'creator-height':l.height,'creator-turns':l.totalSteps,'creator-boxes':l.initialBoxesP1.length,'creator-environment':l.environment??'foundry','creator-laser-dir':l.laserEmitter?.dir??'D'}))this.el<HTMLInputElement|HTMLSelectElement>('#'+id).value=String(value);
    this.el<HTMLInputElement>('#creator-mirrors').checked=!!l.hasMirrorBox;
    this.el('#creator-box-id').innerHTML=l.initialBoxesP1.map((_,i)=>`<option value="${i}">${String.fromCharCode(65+i)}</option>`).join('');this.el<HTMLSelectElement>('#creator-box-id').value=String(this.box);
  }
  private render(){
    const engine=this.model.engine,l=this.model.level;
    this.el('[data-editor="publish-campaign"]').hidden=!this.catalog.canPublishCampaign;
    this.el('.creator-save-state').textContent=this.dirty?'Unsaved changes':this.stored?`${this.stored.archivedRevision===this.stored.revision?'Arkiv confirmed':'Archive pending'} · revision ${this.stored.revision}${this.stored.publishedRevision?' · published '+this.stored.publishedRevision:''}`:'New draft';
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>{b.disabled=!!engine||this.busy;b.setAttribute('aria-pressed',String(b.dataset.tool===this.tool));});
    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{b.disabled=!!engine&&b.dataset.view==='author';b.setAttribute('aria-pressed',String(b.dataset.view===this.view));});
    this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('.creator-sidebar input,.creator-sidebar select').forEach(i=>i.disabled=!!engine||this.busy);
    this.root.querySelectorAll<HTMLButtonElement>('.creator-actions button').forEach(b=>b.disabled=this.busy);
    this.el<HTMLButtonElement>('[data-editor="undo-edit"]').disabled=!!engine||!this.model.canUndo||this.busy;this.el<HTMLButtonElement>('[data-editor="redo-edit"]').disabled=!!engine||!this.model.canRedo||this.busy;
    this.el<HTMLButtonElement>('[data-editor="test"]').textContent=engine?'Restart playtest':'Start playtest';
    this.el('[data-editor="edit"]').hidden=!engine;this.el('.creator-test-controls').hidden=!engine;
    this.el<HTMLButtonElement>('[data-editor="capture"]').disabled=engine?.state.status!=='VICTORY'||this.busy;
    this.el<HTMLButtonElement>('[data-editor="undo-turn"]').disabled=!engine||engine.state.step===0;
    this.el<HTMLButtonElement>('[data-editor="replay"]').disabled=l.solutionP1.length!==l.totalSteps||l.solutionP2.length!==l.totalSteps;
    this.root.querySelectorAll<HTMLButtonElement>('[data-test-player]').forEach(b=>{const player=Number(b.dataset.testPlayer) as 1|2,direction=b.dataset.direction as Direction,error=engine?.selectionError(player,direction);b.disabled=!engine||!!error;b.title=error??'';b.classList.toggle('selected',this.model.pending[player-1]===direction);});
    this.root.querySelectorAll<HTMLElement>('.creator-queued').forEach((el,i)=>{el.textContent=this.model.pending[i]?arrows[this.model.pending[i]!]+' queued':'';});
    this.el('.creator-board-meta').textContent=engine?`TURN ${engine.state.step} / ${l.totalSteps} · ${engine.state.step<l.weldStep?'WRITE':'REPLAY'}`:`${l.width} × ${l.height} · ${l.totalSteps} TURNS · WELD ${l.weldStep}`;
    this.el('.creator-stage-caption').textContent=this.view==='author'?'AUTHOR VIEW · Both timelines and hidden weld targets are visible here only.':`P${this.view==='p1'?1:2} VIEW · Partner objectives, boxes and weld targets are hidden.${engine?' Playtest only: use both input rows below.':''}`;
    const recorded=engine?this.model.moves:[l.solutionP1,l.solutionP2];
    this.el('.creator-solution').textContent=`P1 ${recorded[0].map(d=>arrows[d]).join(' ')||'—'}    |    P2 ${recorded[1].map(d=>arrows[d]).join(' ')||'—'}`;
    this.renderGrid();this.sizeGrid();
  }
  private renderGrid(){
    const l=this.model.level,s=this.model.engine?.state,pack=environments[l.environment??'foundry']??environments.foundry,grid=this.el('.creator-grid');
    const focused=(document.activeElement as HTMLElement)?.closest<HTMLButtonElement>('[data-cell]')?.dataset.cell;
    grid.replaceChildren();grid.setAttribute('aria-rowcount',String(l.height));grid.setAttribute('aria-colcount',String(l.width));
    grid.style.setProperty('--cols',String(l.width));grid.style.setProperty('--rows',String(l.height));grid.dataset.environment=pack.id;
    const author=this.view==='author',player=this.view==='p2'?2:1,boxes1=s?.boxesP1??l.initialBoxesP1,boxes2=s?.boxesP2??l.initialBoxesP2;
    const boxes=player===1?boxes1:boxes2,laser=computeLaserTiles(boxes,l);
    const at=(coord:Coord|undefined,p:Coord)=>!!coord&&sameCoord(coord,p);
    for(let y=l.height;y>=1;y--)for(let x=1;x<=l.width;x++){
      const pos:Coord=[x,y],tile=document.createElement('button');tile.className='creator-tile';tile.dataset.cell=pos.join(',');tile.setAttribute('role','gridcell');tile.tabIndex=x===1&&y===l.height?0:-1;
      const labels:string[]=[];const marker=(text:string,kind:string,asset?:AssetRole)=>{const span=document.createElement('span');span.className='tile-object '+kind;span.textContent=text;if(asset&&pack.assets[asset]){const img=document.createElement('img');img.src=pack.assets[asset]!;img.alt='';span.prepend(img);}tile.append(span);labels.push(text);};
      const wall=hasCoord(l.walls,pos),ice=hasCoord(l.iceTiles,pos);tile.classList.toggle('tile-wall',wall);tile.classList.toggle('tile-ice',ice);
      const texture=pack.assets[wall?'wall':ice?'ice':'floor'];if(texture)tile.style.backgroundImage=`url("${texture}")`;
      if(wall)labels.push('wall');if(ice)labels.push('ice');
      for(const p of [1,2] as const){if(!author&&player!==p)continue;const own=p===1?boxes1:boxes2;const switches=p===1?l.switchesP1:l.switchesP2;
        if(hasCoord(switches,pos))marker(`S${p}`,`tile-switch p${p}${hasCoord(own,pos)?' held':''}`);
        if(at(p===1?l.exitP1:l.exitP2,pos))marker(`E${p}`,`tile-exit p${p}${isExitOpen(p,own,computeLaserTiles(own,l),l)?' open':''}`);
        own.forEach((box,i)=>{if(at(box,pos))marker(`${String.fromCharCode(65+i)}${author?'·'+p:''}`,`tile-box p${p}${l.hasMirrorBox?' tile-mirror':''}`,l.hasMirrorBox?'mirror':'box');});
        if(at(p===1?(s?.p1Pos??l.initialP1):(s?.p2Pos??l.initialP2),pos))marker(`P${p}`,`tile-player p${p}`,p===1?'p1':'p2');
      }
      if(author)l.weldTargets.forEach((target,i)=>{if(at(target,pos))marker(`◇${String.fromCharCode(65+i)}`,'tile-weld');});
      if(author&&at(l.midpointSwitchRequired,pos))marker('S*','tile-midpoint');
      if(at(l.laserEmitter?.pos,pos))marker(arrows[l.laserEmitter!.dir],'tile-emitter');
      if((author||player===1)&&at(l.laserReceiverP1,pos))marker('R1','tile-receiver');
      if(!author&&hasCoord(laser,pos))tile.classList.add('tile-laser');
      if(s&&this.model.engine?.nextBoxes(player)?.some(p=>at(p,pos)))tile.classList.add('tile-next');
      const coordinates=document.createElement('small');coordinates.textContent=`${x},${y}`;tile.append(coordinates);
      tile.setAttribute('aria-label',`${x},${y}: ${labels.join(', ')||'floor'}`);tile.title=tile.getAttribute('aria-label')!;grid.append(tile);if(focused===tile.dataset.cell){tile.tabIndex=0;tile.focus({preventScroll:true});}
    }
  }
  private sizeGrid(){if(!this.active)return;const rect=this.el('.creator-stage').getBoundingClientRect(),l=this.model.level;const size=Math.max(18,Math.min(86,Math.floor(Math.min((rect.width-36)/l.width,(rect.height-28)/l.height))));const zoom=this.el<HTMLSelectElement>('#creator-zoom').value;this.el('.creator-grid').style.setProperty('--tile',(zoom==='fit'?size:Number(zoom))+'px');}
  private async persist(publish:boolean,target:'community'|'campaign'='community'){
    if(this.busy)return;
    if(publish){const check=verifySolution(this.model.level);if(!check.valid){this.message('Cannot publish: '+check.message);return;}}
    const generation=this.generation;this.busy=true;this.render();this.message(publish?'Verifying and publishing encrypted level to Arkiv…':'Saving encrypted draft to Arkiv…');
    try{
      const saved=!this.dirty&&this.stored&&this.stored.archivedRevision===this.stored.revision?this.stored:await this.api.save(this.model.level,this.stored?.id,this.stored?.revision,this.draftId);if(generation!==this.generation)return;
      this.stored=saved;this.dirty=false;this.remember();
      if(publish){const published=await this.api.publish(saved.id,saved.revision,target);if(generation!==this.generation)return;this.stored=published;this.el<HTMLInputElement>('#creator-share-link').value=new URL(`#play/${saved.id}`,location.href).href;this.el('.creator-copy-status').textContent='';const proof=this.el('.creator-archive-proof');proof.replaceChildren();if(published.publication){const ref=published.publication;const a=document.createElement('a');a.textContent='View encrypted entity on Arkiv ↗';a.href=`https://rabdi.explorer.arkiv.network/entity/${ref.entityKey}`;a.target='_blank';a.rel='noopener noreferrer';proof.append(a,document.createTextNode(` · ${ref.category} · expiry block ${ref.expiresAt}`));}this.el<HTMLDialogElement>('#creator-published').showModal();}
      if(publish)void this.loadCatalog();
      this.message(publish?`Published to ${target} on Arkiv. The server verified both operators reaching their exits.`:'Encrypted draft confirmed on Arkiv.');
    }catch(error){if(generation===this.generation)this.message((error as Error).message);}finally{this.busy=false;this.render();}
  }
  private async loadCatalog(){const generation=this.generation;try{const catalog=await this.api.catalog();if(generation!==this.generation)return;this.catalog=catalog;const select=this.el<HTMLSelectElement>('#creator-template');select.replaceChildren(new Option('Choose a completed chamber…',''));for(const c of catalog.campaign)select.add(new Option(`Chamber ${c.slot}: ${c.name}`,c.id));this.el('[data-editor="publish-campaign"]').hidden=!catalog.canPublishCampaign;}catch(error){if(generation===this.generation)this.message((error as Error).message);}}
  private async loadTemplate(id:string){const generation=this.generation;this.busy=true;this.render();try{const {level}=await this.api.template(id);if(generation!==this.generation)return;level.name+=' remix';this.replace(level);}catch(error){if(generation===this.generation)this.message((error as Error).message);}finally{this.busy=false;this.render();}}
  private async library(community:boolean){
    const generation=this.generation,request=++this.libraryRequest,status=this.el('.creator-library-status'),list=this.el('.creator-level-list');list.replaceChildren();status.textContent='Loading levels…';
    this.root.querySelectorAll<HTMLButtonElement>('[data-library]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.library==='community')===community)));
    try{const entries=await (community?this.api.community():this.api.mine());if(generation!==this.generation||request!==this.libraryRequest)return;list.replaceChildren();status.textContent=entries.length?`${entries.length} ${community?'published chambers':'drafts'}`:community?'No published chambers yet. Publish a verified solution to add one.':'No saved drafts yet. Create a blank chamber or use a campaign template.';for(const entry of entries)this.libraryCard(entry,community,list);}catch(error){if(generation===this.generation&&request===this.libraryRequest)status.textContent=(error as Error).message;}
  }
  private libraryCard(entry:LevelSummary,community:boolean,list:HTMLElement){
    const card=document.createElement('article'),title=document.createElement('h3'),description=document.createElement('p'),meta=document.createElement('small');title.textContent=entry.name||'Untitled chamber';description.textContent=entry.subtitle;meta.textContent=`${entry.width}×${entry.height} · ${entry.totalSteps} turns · by ${entry.ownerName} · ${entry.publishedRevision?'published r'+entry.publishedRevision:'draft'}`;card.append(title,description,meta);
    const button=document.createElement('button');button.textContent=community?'Play together ↗':'Edit draft ↗';button.addEventListener('click',()=>{if(community){this.actions.play(entry.id);return;}const generation=this.generation;button.disabled=true;void this.api.get(entry.id).then(stored=>{if(generation!==this.generation)return;this.replace(stored.level,stored);this.el<HTMLDialogElement>('.creator-library').close();}).catch(error=>this.el('.creator-library-status').textContent=(error as Error).message).finally(()=>button.disabled=false);});card.append(button);list.append(card);
  }
  private export(){const blob=new Blob([JSON.stringify(this.model.level,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(this.model.level.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()||'chamber')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.message('Exported this draft and its recorded solution as JSON.');}
  key(event:KeyboardEvent){
    if(this.busy||this.root.querySelector('dialog[open]'))return;
    const target=event.target as HTMLElement;
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyS'){event.preventDefault();if(target.matches('input,select,textarea'))target.blur();void this.persist(false);return;}
    if(target.matches('input,select,textarea'))return;
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyZ'){event.preventDefault();if(this.model.engine)this.model.undoTurn();else{event.shiftKey?this.model.redo():this.model.undo();this.dirty=true;this.remember();this.syncFields();}this.render();return;}
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyY'&&!this.model.engine){event.preventDefault();this.model.redo();this.dirty=true;this.remember();this.syncFields();this.render();return;}
    if(this.model.engine&&KEY_MOVES[event.code]&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      if(target.tagName==='BUTTON'&&(event.code==='Enter'||event.code==='Space'))return;
      event.preventDefault();if(event.repeat)return;
      try{const [player,direction]=KEY_MOVES[event.code];this.model.queue(player,direction);this.message(this.model.engine.state.message);this.render();}catch(error){this.message((error as Error).message);}return;
    }
    const cell=target.closest<HTMLButtonElement>('[data-cell]');
    if(cell&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)){event.preventDefault();const [x,y]=cell.dataset.cell!.split(',').map(Number);const next:Coord=[x+(event.code==='ArrowRight'?1:event.code==='ArrowLeft'?-1:0),y+(event.code==='ArrowUp'?1:event.code==='ArrowDown'?-1:0)];const nextCell=this.root.querySelector<HTMLButtonElement>(`[data-cell="${next.join(',')}"]`);if(nextCell){cell.tabIndex=-1;nextCell.tabIndex=0;nextCell.focus();}}
  }
  destroy(){this.observer.disconnect();this.root.remove();}
}
