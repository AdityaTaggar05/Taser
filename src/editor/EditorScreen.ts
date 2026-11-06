import {KEY_MOVES} from '../input/TurnBuffer';
import {cleanDraft} from '../core/levelValidation';
import {computeLaserTiles,isExitOpen,type GameEngine} from '../core/engine';
import {hasCoord,sameCoord,isLive,type Coord,type Direction,type LevelConfig,type StepSnapshot} from '../core/types';
import {environments,type EnvironmentPack,type AssetRole} from '../render/environment';
import {registeredThemes} from '../assets/catalog';
import {applySprite,spriteElement} from '../assets/dom';
import type {PlayerProfile} from '../auth/types';
import {EditorModel,blankLevel} from './EditorModel';
import {verifySolution} from './solution';
import {LevelClient} from './LevelClient';
import type {EditorObjectTool,EditorTool,EditorView,LevelSummary,StoredLevel,LevelCatalog} from './types';
import './editor.css';

const tools:Array<[EditorTool,string]>=[
  ['p1','Player 1'],
  ['p2','Player 2'],
  ['box1','Box (P1)'],
  ['box2','Box (P2)'],
  ['switch1','P1 Switch'],
  ['switch2','P2 Switch'],
  ['exit1','P1 Exit'],
  ['exit2','P2 Exit'],
  ['midpoint','Midpoint Switch'],
  ['laser','Laser Turret'],
  ['receiver','Laser Receiver'],
  ['weld','Weld Target'],
  ['wall','Wall Block'],
  ['floor','Floor Tile'],
  ['ice','Ice Tile'],
  ['remove','Remove Item']
];
const arrows:Record<Direction,string>={U:'↑',D:'↓',L:'←',R:'→',W:'Wait'};
const paintTools:EditorTool[]=['floor','wall','ice','switch1','switch2','erase','remove'];
// Box starts and weld targets each have one position per selected identity.
const singlePlacementTools:EditorTool[]=['p1','p2','exit1','exit2','midpoint','laser','receiver','box1','box2','weld'];

type PlaytestSound='step'|'shove'|'weld'|'win'|'fail';
export interface Actions {
  home:()=>void;
  play:(id:string)=>void;
  fullscreen:()=>void;
  onPlaytest?:(
    engine:GameEngine|null,
    view:EditorView,
    previous?:StepSnapshot,
    animate?:boolean,
    sound?:PlaytestSound
  )=>void;
}

interface FoundItem {
  kind:EditorObjectTool;
  boxIndex:number;
}

/** Authoring workspace. The simulated state comes from the same engine as co-op. */
export class EditorScreen {
  readonly root=document.createElement('main');
  model=new EditorModel();
  private catalog:LevelCatalog={campaign:[],canPublishCampaign:false,storage:'unconfigured'};
  private draftId=crypto.randomUUID();
  private user:PlayerProfile|null=null;
  private stored:StoredLevel|null=null;
  private dirty=false;
  private tool:EditorTool|null=null;
  private box=0;
  private view:EditorView='author';
  private busy=false;
  private generation=0;
  private libraryRequest=0;
  private active=false;
  private wallMode=false;
  private pointerId:number|null=null;
  private strokeTool:EditorTool|null=null;
  private painted=new Set<string>();
  private dragItem:FoundItem|null=null;
  private dragFrom:Coord|null=null;
  private dragGhost:HTMLElement|null=null;
  private isDragging=false;
  private dragStartX=0;
  private dragStartY=0;
  private boundPointerMove=(e:PointerEvent)=>this.onGridPointerMove(e);
  private boundPointerUp=(e:PointerEvent)=>this.onGridPointerUp(e);
  private boundPointerCancel=(e:PointerEvent)=>{if(e.pointerId===this.pointerId)this.cancelGesture();};
  private boundBlur=()=>this.cancelGesture();
  private observer:ResizeObserver;

  constructor(private api:LevelClient,private actions:Actions){
    this.root.id='creator';
    this.root.hidden=true;
    this.root.innerHTML=`<header class="creator-top"><button data-editor="home" aria-label="Return to home">⌂</button><span class="creator-wordmark">WELDPOINT <small>CHAMBER CREATOR</small></span><span class="creator-save-state" role="status">Unsaved draft</span><div class="creator-actions"><button data-editor="new">New</button><button data-editor="undo-edit" title="Undo design edit (Ctrl/Cmd+Z)">Undo</button><button data-editor="redo-edit" title="Redo design edit (Ctrl/Cmd+Shift+Z)">Redo</button><button data-editor="library">My levels / Community</button><button data-editor="import">Import</button><button data-editor="export">Export</button><button data-editor="save">Save draft</button><button class="primary" data-editor="publish">Publish to community</button><button data-editor="publish-campaign" hidden>Publish to campaign</button></div></header>
    <div class="creator-workspace"><aside class="creator-sidebar"><label class="creator-label" for="creator-template">START FROM A TEMPLATE</label><select id="creator-template"><option value="">Choose a chamber…</option></select><label class="creator-label" for="creator-name">CHAMBER NAME</label><input id="creator-name" maxlength="80"/><label class="creator-label" for="creator-subtitle">DESCRIPTION</label><input id="creator-subtitle" maxlength="180"/><div class="creator-fields"><label>Width<input id="creator-width" type="number" min="2" max="20"/></label><label>Height<input id="creator-height" type="number" min="2" max="20"/></label><label>Turns<input id="creator-turns" type="number" min="2" max="32" step="2"/></label><label>Box pairs<select id="creator-boxes">${Array.from({length:6},(_,i)=>`<option>${i+1}</option>`).join('')}</select></label></div><label class="creator-label" for="creator-environment">ENVIRONMENT</label><select id="creator-environment">${registeredThemes.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select><label class="creator-checkbox"><input type="checkbox" id="creator-mirrors"/> Mirror boxes</label><label class="creator-checkbox"><input type="checkbox" id="creator-fixed-weld"/> Require fixed weld positions</label><label class="creator-label" for="creator-laser-dir">LASER DIRECTION</label><select id="creator-laser-dir"><option value="D">↓ South</option><option value="U">↑ North</option><option value="L">← West</option><option value="R">→ East</option></select><div class="creator-tool-heading"><span class="creator-label">PLACE OBJECTS</span><label for="creator-box-id">Box identity <select id="creator-box-id"></select></label></div><div class="creator-tools" role="toolbar" aria-label="Placement tools"></div><p class="creator-note">Drag objects to move them, or select a tool and click to place it. Select a box identity before placing its starts and weld target. Single objects deselect after placement. Click a selected tool again or press Escape to return to dragging. Wall Mode skips occupied cells. Remove deletes optional items or extra box pairs; move required objects with their tool.</p></aside>
    <section class="creator-centre"><div class="creator-stage-top"><div class="creator-view-tabs" role="group" aria-label="Board perspective"><button data-view="author">Author</button><button data-view="p1">P1 view</button><button data-view="p2">P2 view</button></div><button class="creator-wall-mode-btn" data-editor="wall-mode" aria-pressed="false" title="Toggle Wall Mode (click or drag to add/remove walls)">🧱 Wall Mode</button><span class="creator-board-meta"></span><select id="creator-zoom" aria-label="Grid zoom"><option value="fit">Fit grid</option><option value="48">48 px</option><option value="64">64 px</option><option value="86">86 px</option></select><button data-editor="fullscreen" aria-label="Fullscreen">⛶</button></div><div class="creator-stage"><div class="creator-grid" role="grid" aria-label="Level grid"></div></div><div class="creator-stage-caption">AUTHOR VIEW · Drag &amp; drop players, boxes, switches and exits. Both timelines visible here.</div><section class="creator-test"><div class="creator-test-top"><div><strong>Solution recorder</strong><small>WASD / Space: P1 · Arrows / Enter: P2. Both inputs commit a turn.</small></div><button data-editor="test">Start playtest</button><button data-editor="replay">Replay solution</button><button data-editor="edit" hidden>Back to editing</button></div><div class="creator-test-controls" hidden>${([1,2] as const).map(p=>`<div class="creator-player p${p}"><strong>P${p}</strong>${(['L','U','D','R','W'] as Direction[]).map(d=>`<button data-test-player="${p}" data-direction="${d}" aria-label="P${p} ${d==='W'?'Wait':{U:'Up',D:'Down',L:'Left',R:'Right'}[d]}">${arrows[d]}</button>`).join('')}<button data-cancel-player="${p}">Cancel</button><span class="creator-queued"></span></div>`).join('')}<button data-editor="undo-turn">Undo turn</button><button data-editor="capture" class="primary">Use winning solution</button></div><div class="creator-solution" aria-label="Recorded solution"></div><div class="creator-message" role="status" aria-live="polite"></div></section></section></div>
    <input id="creator-file" type="file" accept="application/json,.json" hidden/><dialog class="home-dialog creator-library" aria-labelledby="creator-library-title"><button class="dialog-close" data-editor="close-library" aria-label="Close level library">×</button><span class="home-kicker">CHAMBER LIBRARY</span><h2 id="creator-library-title">Build. Verify. Share.</h2><div class="creator-library-tabs"><button data-library="mine">My levels</button><button data-library="community">Community</button></div><p class="creator-library-status" role="status"></p><div class="creator-level-list"></div></dialog><dialog class="home-dialog" id="creator-published" aria-labelledby="creator-published-title"><button class="dialog-close" data-editor="close-published" aria-label="Close published level">×</button><span class="home-kicker">VERIFIED · ENCRYPTED ON ARKIV</span><h2 id="creator-published-title">Your chamber is live.</h2><p>Open this link with a partner signed in on another account. Choose Solo or Co-op, then your role. For co-op, share the party invitation with your partner. Community publications are available for about 48 hours. Your chamber also appears in Published levels on the home screen.</p><label class="creator-label" for="creator-share-link">LEVEL LINK</label><input id="creator-share-link" readonly/><button data-editor="copy-link" class="home-dialog-primary">Copy link</button><button data-editor="play-published" class="home-dialog-primary">Choose P1 / P2 ↗</button><p class="creator-copy-status" role="status"></p><p class="creator-archive-proof"></p></dialog>`;
    document.body.append(this.root);
    this.root.addEventListener('click',e=>this.click(e));

    const grid=this.root.querySelector('.creator-grid')!;
    grid.addEventListener('pointerdown',e=>this.onGridPointerDown(e as PointerEvent));
    window.addEventListener('pointermove',this.boundPointerMove);
    window.addEventListener('pointerup',this.boundPointerUp);
    window.addEventListener('pointercancel',this.boundPointerCancel);
    window.addEventListener('blur',this.boundBlur);

    this.root.addEventListener('change',e=>this.change(e));
    this.observer=new ResizeObserver(()=>{
      if(this.active){
        this.sizeGrid();
        if(this.model.engine)this.notifyPlaytest(undefined,false);
      }
    });
    this.observer.observe(this.root.querySelector('.creator-stage')!);
    this.syncFields();
    this.render();
  }

  private notifyPlaytest(previous?:StepSnapshot,animate=false,sound?:PlaytestSound){
    this.actions.onPlaytest?.(this.active?this.model.engine:null,this.view,previous,animate,sound);
  }

  private environment():EnvironmentPack{
    const id=this.model.level.environment??'foundry';
    const pack=Object.hasOwn(environments,id)?environments[id]:environments.foundry;
    return pack;
  }

  private findItemAt(pos:Coord):FoundItem|null{
    const l=this.model.level,items:FoundItem[]=[];
    const add=(kind:EditorObjectTool,coord:Coord|undefined,boxIndex=0)=>{
      if(coord&&sameCoord(coord,pos))items.push({kind,boxIndex});
    };
    for(const player of [1,2] as const){
      if(this.view!=='author'&&this.view!==`p${player}`)continue;
      add(player===1?'p1':'p2',player===1?l.initialP1:l.initialP2);
      (player===1?l.initialBoxesP1:l.initialBoxesP2).forEach((p,i)=>add(player===1?'box1':'box2',p,i));
      add(player===1?'exit1':'exit2',player===1?l.exitP1:l.exitP2);
      (player===1?l.switchesP1:l.switchesP2).forEach(p=>add(player===1?'switch1':'switch2',p));
    }
    if(this.view==='author'){
      (l.weldTargets??[]).forEach((p,i)=>add('weld',p,i));
      add('midpoint',l.midpointSwitchRequired);
    }
    add('laser',l.laserEmitter?.pos);
    if(this.view!=='p2')add('receiver',l.laserReceiverP1);
    // The selected tool makes overlapping objects individually reachable.
    return items.find(item=>item.kind===this.tool&&item.boxIndex===this.box)
      ??items.find(item=>item.kind===this.tool)??items[0]??null;
  }

  private tileAt(e:PointerEvent){
    const tile=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLButtonElement>('[data-cell]');
    return tile&&this.root.contains(tile)?tile:null;
  }

  private onGridPointerDown(e:PointerEvent){
    if(e.button!==0||!e.isPrimary||!this.active||this.model.engine||this.busy)return;
    const tile=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-cell]');
    if(!tile)return;
    e.preventDefault();
    this.cancelGesture();
    this.pointerId=e.pointerId;
    this.el('.creator-grid').setPointerCapture(e.pointerId);
    const pos=tile.dataset.cell!.split(',').map(Number) as Coord;
    if(this.wallMode||(this.tool&&['wall','floor','ice','erase','remove'].includes(this.tool))){
      this.strokeTool=this.wallMode?(hasCoord(this.model.level.walls,pos)?'floor':'wall'):this.tool;
      this.paintStroke(tile);
      return;
    }
    this.dragItem=this.findItemAt(pos);
    if(this.dragItem&&['box1','box2','weld'].includes(this.dragItem.kind)){
      this.box=this.dragItem.boxIndex;this.el<HTMLSelectElement>('#creator-box-id').value=String(this.box);
    }
    this.dragFrom=pos;
    this.dragStartX=e.clientX;
    this.dragStartY=e.clientY;
    if(!this.dragItem){
      if(this.tool&&paintTools.includes(this.tool)){this.strokeTool=this.tool;this.paintStroke(tile);}
      else this.paint(tile);
    }
  }

  private paintStroke(tile:HTMLButtonElement){
    const cell=tile.dataset.cell!;
    if(this.painted.has(cell))return;
    this.painted.add(cell);
    if(this.wallMode&&this.strokeTool==='floor'&&!hasCoord(this.model.level.walls,cell.split(',').map(Number) as Coord))return;
    this.paint(tile,this.strokeTool!);
  }

  private onGridPointerMove(e:PointerEvent){
    if(e.pointerId!==this.pointerId)return;
    if(!this.active||this.busy||this.model.engine){this.cancelGesture();return;}
    const tile=this.tileAt(e);
    if(this.strokeTool){if(tile)this.paintStroke(tile);return;}
    if(!this.dragItem)return;
    if(!this.isDragging&&Math.hypot(e.clientX-this.dragStartX,e.clientY-this.dragStartY)>4){
      this.isDragging=true;
      this.dragGhost=document.createElement('div');
      this.dragGhost.className='creator-drag-ghost';
      this.dragGhost.innerHTML=this.renderToolIcon(this.dragItem.kind,this.environment());
      document.body.append(this.dragGhost);
      this.root.querySelector(`[data-cell="${this.dragFrom!.join(',')}"]`)?.classList.add('is-drag-source');
    }
    if(this.dragGhost){
      this.dragGhost.style.left=`${e.clientX-24}px`;
      this.dragGhost.style.top=`${e.clientY-24}px`;
      this.root.querySelector('.drop-target')?.classList.remove('drop-target');
      tile?.classList.add('drop-target');
    }
  }

  private onGridPointerUp(e:PointerEvent){
    if(e.pointerId!==this.pointerId)return;
    const item=this.dragItem,from=this.dragFrom,dragged=this.isDragging,tile=this.tileAt(e);
    this.cancelGesture();
    if(!this.active||this.busy||this.model.engine||!item||!from||!tile)return;
    try{
      if(dragged){
        const to=tile.dataset.cell!.split(',').map(Number) as Coord;
        const changed=this.model.moveObject(item.kind,from,to,item.boxIndex);
        if(this.tool&&singlePlacementTools.includes(this.tool))this.tool=null;
        if(changed){
          this.changed();
          this.message('Object moved. Record a fresh solution before publishing.');
        }else this.render();
      }else this.paint(tile);
    }catch(error){this.message((error as Error).message);}
  }

  private cancelGesture(){
    this.dragGhost?.remove();this.dragGhost=null;
    this.root.querySelectorAll('.drop-target,.is-drag-source').forEach(t=>t.classList.remove('drop-target','is-drag-source'));
    const grid=this.el('.creator-grid');
    if(this.pointerId!==null&&grid.hasPointerCapture(this.pointerId))grid.releasePointerCapture(this.pointerId);
    this.pointerId=null;this.strokeTool=null;this.painted.clear();
    this.dragItem=null;this.dragFrom=null;this.isDragging=false;
  }

  private el<T extends HTMLElement=HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  private message(text:string){this.el('.creator-message').textContent=text;}
  private recoveryKey(){let tab='memory';try{tab=sessionStorage.getItem('weldpoint:auth-context')??tab;}catch{}return `weldpoint:editor:${this.user?.id}:${tab}`;}
  private recover(){try{const raw=localStorage.getItem(this.recoveryKey());if(raw){const data=JSON.parse(raw);this.model=new EditorModel(cleanDraft(data.level));this.stored=data.stored??null;this.draftId=data.draftId??crypto.randomUUID();this.dirty=true;this.message('Recovered your unsaved draft from this browser. Save it to your account when ready.');}}catch{this.message('Your previous local recovery could not be loaded. Import a level or start a new draft.');}}
  private remember(){if(!this.user)return;try{if(this.dirty)localStorage.setItem(this.recoveryKey(),JSON.stringify({level:this.model.level,draftId:this.draftId,stored:this.stored?{...this.stored,level:undefined}:null}));else localStorage.removeItem(this.recoveryKey());}catch{this.message('Browser recovery is unavailable. Save this draft to your account before leaving.');}}
  setUser(user:PlayerProfile|null){if(user?.id===this.user?.id)return;this.cancelGesture();this.tool=null;this.box=0;this.wallMode=false;this.generation++;this.user=user;this.catalog={campaign:[],canPublishCampaign:false,storage:'unconfigured'};this.draftId=crypto.randomUUID();this.stored=null;this.dirty=false;this.model=new EditorModel();this.view='author';if(user)this.recover();this.syncFields();this.render();}
  show(visible:boolean){
    this.cancelGesture();this.tool=null;this.wallMode=false;
    this.active=visible;this.root.hidden=!visible;
    if(!visible){
      this.root.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());
      this.model.engine=null;
    }else void this.loadCatalog();
    this.render();
  }
  private replace(level:LevelConfig,stored:StoredLevel|null=null){if(this.dirty&&!window.confirm('Replace the current unsaved draft? Export or save it first if you want to keep it.'))return;this.cancelGesture();this.generation++;this.model=new EditorModel(level);this.draftId=crypto.randomUUID();this.stored=stored;this.dirty=!stored;this.view='author';this.box=0;this.tool=null;this.wallMode=false;this.remember();this.syncFields();this.render();this.message(stored?'Draft loaded.':'New draft. Place objects, then record a winning solution.');}
  private changed(){this.box=Math.min(this.box,this.model.level.initialBoxesP1.length-1);this.dirty=true;this.remember();this.syncFields();this.render();}
  private paint(tile:HTMLButtonElement,tool:EditorTool|null=this.tool){
    if(!tool||this.model.engine||this.busy)return;
    const coord=tile.dataset.cell!.split(',').map(Number) as Coord;
    try{
      const changed=this.model.paint(tool,coord,this.box);
      const deselect=singlePlacementTools.includes(tool);
      if(deselect)this.tool=null;
      if(changed){
        this.changed();
        this.message(tool==='remove'?'Item removed.':'Design changed. Record a fresh solution before publishing.');
      }else if(deselect)this.render();
    }catch(error){this.message((error as Error).message);}
  }

  private queuePlaytest(player:1|2,direction:Direction){
    if(!this.model.engine)return;
    const prevSnapshot=this.model.engine.state;
    const prevStep=this.model.engine.state.step;
    this.model.queue(player,direction);
    this.message(this.model.engine.state.message);
    const currStep=this.model.engine.state.step;
    if(currStep>prevStep){
      const last=this.model.engine.state;
      const sound:PlaytestSound=
        last.status==='VICTORY'?'win':
        !isLive(last.status)?'fail':
        last.status==='WELD_SUCCESS'?'weld':
        this.model.engine.lastShoves.some(s=>s!==null)?'shove':'step';
      this.render(prevSnapshot,true,sound);
    }else this.render();
  }

  private click(e:MouseEvent){
    const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button||button.disabled)return;
    if(button.dataset.cell){
      // Pointer gestures are handled above; detail 0 covers keyboard activation.
      if(e.detail===0)this.paint(button,this.wallMode?(hasCoord(this.model.level.walls,button.dataset.cell.split(',').map(Number) as Coord)?'floor':'wall'):this.tool);
      return;
    }
    if(button.dataset.tool){this.cancelGesture();this.wallMode=false;this.tool=this.tool===button.dataset.tool?null:button.dataset.tool as EditorTool;this.render();return;}
    if(button.dataset.view){this.cancelGesture();this.view=button.dataset.view as EditorView;this.render();return;}
    if(button.dataset.library){void this.library(button.dataset.library==='community');return;}
    if(button.dataset.testPlayer){
      try{
        this.queuePlaytest(Number(button.dataset.testPlayer) as 1|2,button.dataset.direction as Direction);
      }catch(error){
        this.message((error as Error).message);
      }
      return;
    }
    if(button.dataset.cancelPlayer){
      this.model.pending[Number(button.dataset.cancelPlayer)-1]=null;
      this.render();
      return;
    }
    const action=button.dataset.editor;
    try{
      if(action==='wall-mode'){
        this.cancelGesture();this.tool=null;this.wallMode=!this.wallMode;
        this.render();
        this.message(this.wallMode?'Wall Mode ON: Start on a wall to remove walls, or on floor to build.':'Select a tool to place objects, or drag an existing object.');
        return;
      }
      if(action==='home'){this.actions.home();return;}
      if(action==='undo-edit'||action==='redo-edit'){this.cancelGesture();action==='undo-edit'?this.model.undo():this.model.redo();this.dirty=true;this.remember();this.syncFields();this.render();this.message('Design history restored.');return;}
      if(action==='new'){this.replace(blankLevel());return;}
      if(action==='library'){this.el<HTMLDialogElement>('.creator-library').showModal();void this.library(false);return;}
      if(action==='close-library'){this.el<HTMLDialogElement>('.creator-library').close();return;}
      if(action==='close-published'){this.el<HTMLDialogElement>('#creator-published').close();return;}
      if(action==='fullscreen'){this.actions.fullscreen();return;}
      if(action==='import'){this.el<HTMLInputElement>('#creator-file').click();return;}
      if(action==='export'){this.export();return;}
      if(action==='save'||action==='publish'||action==='publish-campaign'){void this.persist(action!=='save',action==='publish-campaign'?'campaign':'community');return;}
      if(action==='test'||action==='replay'){
        this.cancelGesture();
        if(action==='replay'){const check=verifySolution(this.model.level);if(!check.valid)throw new Error(check.message);}
        this.model.start();
        this.view='author';
        this.wallMode=false;this.tool=null;
        if(action==='replay'){
          const l=this.model.level;
          for(let k=0;k<l.solutionP1.length&&this.model.engine?.state.status!=='VICTORY';k++){
            this.model.queue(1,l.solutionP1[k]);
            this.model.queue(2,l.solutionP2[k]);
          }
        }
        this.message(this.model.engine!.state.message);
        this.render();
        return;
      }
      if(action==='edit'){
        this.model.engine=null;
        this.view='author';this.tool=null;this.wallMode=false;
        this.render();
        return;
      }
      if(action==='undo-turn'){
        this.model.undoTurn();
        this.render();
        this.message('Turn undone. Choose both inputs again.');
        return;
      }
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
      if(input.id==='creator-fixed-weld')changed=this.model.edit(l=>{if((input as HTMLInputElement).checked)l.weldTargets=l.initialBoxesP1.map(p=>[...p]);else delete l.weldTargets;});
      if(input.id==='creator-mirrors')changed=this.model.edit(l=>{l.hasMirrorBox=(input as HTMLInputElement).checked;});
      if(input.id==='creator-laser-dir')changed=this.model.edit(l=>{if(l.laserEmitter)l.laserEmitter.dir=input.value as Direction;});
      if(changed){this.changed();this.message('Draft changed. Previous solution cleared.');}
    }catch(error){this.message((error as Error).message);this.syncFields();}
  }

  private syncFields(){
    const l=this.model.level;
    for(const [id,value] of Object.entries({'creator-name':l.name,'creator-subtitle':l.subtitle,'creator-width':l.width,'creator-height':l.height,'creator-turns':l.totalSteps,'creator-boxes':l.initialBoxesP1.length,'creator-environment':environments[l.environment??'foundry']?.id??'modern-gray','creator-laser-dir':l.laserEmitter?.dir??'D'}))this.el<HTMLInputElement|HTMLSelectElement>('#'+id).value=String(value);
    this.el<HTMLInputElement>('#creator-mirrors').checked=!!l.hasMirrorBox;
    this.el<HTMLInputElement>('#creator-fixed-weld').checked=!!l.weldTargets?.length;
    this.box=Math.min(this.box,l.initialBoxesP1.length-1);
    this.el('#creator-box-id').innerHTML=l.initialBoxesP1.map((_,i)=>`<option value="${i}">${String.fromCharCode(65+i)}</option>`).join('');this.el<HTMLSelectElement>('#creator-box-id').value=String(this.box);
  }

  private renderToolIcon(id:EditorTool,pack:EnvironmentPack):string{
    const role=id==='box1'||id==='box2'?(this.model.level.hasMirrorBox?'mirror':id==='box1'?'crate.p1':'crate.p2'):id;
    if(['p1','p2','box1','box2','wall','floor','ice'].includes(id)){
      const icon=spriteElement(pack,role,'tool-asset-icon');
      if(id==='box1'||id==='box2')return `<div class="tool-asset-container">${icon.outerHTML}<span class="tool-corner-badge ${id==='box1'?'p1':'p2'}">${id==='box1'?'P1':'P2'}</span></div>`;
      return icon.outerHTML;
    }
    switch(id){
      case 'switch1':
        return `<span class="tool-game-badge switch p1">S1</span>`;
      case 'switch2':
        return `<span class="tool-game-badge switch p2">S2</span>`;
      case 'exit1':
        return `<span class="tool-game-badge exit p1">E1</span>`;
      case 'exit2':
        return `<span class="tool-game-badge exit p2">E2</span>`;
      case 'midpoint':
        return `<span class="tool-game-badge midpoint">◆</span>`;
      case 'laser':{
        const dir=this.model.level.laserEmitter?.dir??'D';
        const arrow=({D:'▼',U:'▲',L:'◀',R:'▶',W:'·'})[dir];
        return `<span class="tool-game-badge laser">${arrow}</span>`;
      }
      case 'receiver':
        return `<span class="tool-game-badge receiver">R1</span>`;
      case 'weld':
        return `<span class="tool-game-badge weld">W</span>`;
      case 'remove':
        return `<span class="tool-game-badge remove">✕</span>`;
      default:
        return `<span class="tool-game-badge">${id}</span>`;
    }
  }

  private renderToolButtons(){
    const pack=this.environment();
    const toolsContainer=this.el('.creator-tools');
    const key=`${pack.id}:${!!this.model.level.hasMirrorBox}:${this.model.level.laserEmitter?.dir??'D'}`;
    if(toolsContainer.childElementCount&&toolsContainer.dataset.icons===key)return;
    toolsContainer.dataset.icons=key;
    toolsContainer.innerHTML=tools.map(([id,label])=>{
      return `<button data-tool="${id}" aria-pressed="${this.tool===id}" title="${label}">
        ${this.renderToolIcon(id,pack)}
        <span>${label}</span>
      </button>`;
    }).join('');
  }

  private render(previous?:StepSnapshot,animate=false,sound?:PlaytestSound){
    const engine=this.model.engine,l=this.model.level;
    this.root.classList.toggle('playtesting',!!engine);
    this.root.dataset.environment=this.environment().id;
    this.el<HTMLInputElement>('#creator-fixed-weld').checked=!!l.weldTargets?.length;
    this.el('[data-editor="publish-campaign"]').hidden=!this.catalog.canPublishCampaign;
    this.el('.creator-save-state').textContent=this.dirty?'Unsaved changes':this.stored?`${this.stored.archivedRevision===this.stored.revision?'Arkiv confirmed':'Archive pending'} · revision ${this.stored.revision}${this.stored.publishedRevision?' · published '+this.stored.publishedRevision:''}`:'New draft';

    this.renderToolButtons();
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>{b.disabled=!!engine||this.busy;b.setAttribute('aria-pressed',String(b.dataset.tool===this.tool));});
    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.view===this.view));});
    this.root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('.creator-sidebar input,.creator-sidebar select').forEach(i=>i.disabled=!!engine||this.busy);
    this.root.querySelectorAll<HTMLButtonElement>('.creator-actions button').forEach(b=>b.disabled=this.busy);

    const wallModeBtn=this.el<HTMLButtonElement>('[data-editor="wall-mode"]');
    if(wallModeBtn){
      wallModeBtn.classList.toggle('active',this.wallMode);
      wallModeBtn.setAttribute('aria-pressed',String(this.wallMode));
      wallModeBtn.textContent=this.wallMode?'🧱 Wall Mode: ON':'🧱 Wall Mode: OFF';
      wallModeBtn.disabled=!!engine||this.busy;
    }

    this.el<HTMLButtonElement>('[data-editor="undo-edit"]').disabled=!!engine||!this.model.canUndo||this.busy;
    this.el<HTMLButtonElement>('[data-editor="redo-edit"]').disabled=!!engine||!this.model.canRedo||this.busy;
    this.el<HTMLButtonElement>('[data-editor="test"]').textContent=engine?'Restart playtest':'Start playtest';
    this.el('[data-editor="edit"]').hidden=!engine;
    this.el('.creator-test-controls').hidden=!engine;
    this.el<HTMLButtonElement>('[data-editor="capture"]').disabled=engine?.state.status!=='VICTORY'||this.busy;
    this.el<HTMLButtonElement>('[data-editor="undo-turn"]').disabled=!engine||engine.state.step===0;
    this.el<HTMLButtonElement>('[data-editor="replay"]').disabled=l.solutionP1.length<=l.weldStep||l.solutionP1.length!==l.solutionP2.length;
    this.root.querySelectorAll<HTMLButtonElement>('[data-test-player]').forEach(b=>{
      const player=Number(b.dataset.testPlayer) as 1|2,direction=b.dataset.direction as Direction,error=engine?.selectionError(player,direction);
      b.disabled=!engine||!!error;
      b.title=error??'';
      b.classList.toggle('selected',this.model.pending[player-1]===direction);
    });
    this.root.querySelectorAll<HTMLElement>('.creator-queued').forEach((el,i)=>{el.textContent=this.model.pending[i]?arrows[this.model.pending[i]!]+' queued':'';});
    this.el('.creator-board-meta').textContent=engine?`TURN ${engine.state.step} / ${l.totalSteps} · ${engine.state.step<l.weldStep?'WRITE':'REPLAY'}`:`${l.width} × ${l.height} · ${l.totalSteps} TURNS · WELD ${l.weldStep}`;
    this.el('.creator-stage-caption').textContent=this.wallMode
      ?'🧱 WALL MODE ACTIVE · Click or drag to build/remove walls. Occupied cells are protected.'
      :engine
        ?`PLAYTEST ACTIVE · View: ${this.view==='author'?'Convergence (Shared Grid)':this.view==='p1'?'P1 Perspective':'P2 Perspective'}. Input moves below or with WASD / Arrow keys.`
        :this.view==='author'
          ?'AUTHOR VIEW · Drag & drop players, boxes, switches, exits. Both timelines visible here.'
          :`P${this.view==='p1'?1:2} VIEW · Partner objectives, boxes and weld targets are hidden.`;
    const recorded=engine?this.model.moves:[l.solutionP1,l.solutionP2];
    this.el('.creator-solution').textContent=`P1 ${recorded[0].map(d=>arrows[d]).join(' ')||'—'}    |    P2 ${recorded[1].map(d=>arrows[d]).join(' ')||'—'}`;

    if(!engine){
      this.renderGrid();
      this.sizeGrid();
    }
    this.el<HTMLSelectElement>('#creator-zoom').disabled=!!engine;
    this.notifyPlaytest(previous,animate,sound);
  }

  private renderGrid(){
    const l=this.model.level,pack=this.environment(),grid=this.el('.creator-grid');
    const focused=(document.activeElement as HTMLElement)?.closest<HTMLButtonElement>('[data-cell]')?.dataset.cell;
    grid.replaceChildren();grid.setAttribute('aria-rowcount',String(l.height));grid.setAttribute('aria-colcount',String(l.width));
    grid.style.setProperty('--cols',String(l.width));grid.style.setProperty('--rows',String(l.height));grid.dataset.environment=pack.id;
    grid.classList.toggle('wall-mode-active',this.wallMode);
    const author=this.view==='author',player=this.view==='p2'?2:1,boxes1=l.initialBoxesP1,boxes2=l.initialBoxesP2;
    const boxes=player===1?boxes1:boxes2,laser=computeLaserTiles(boxes,l);
    const at=(coord:Coord|undefined,p:Coord)=>!!coord&&sameCoord(coord,p);

    for(let y=l.height;y>=1;y--)for(let x=1;x<=l.width;x++){
      const pos:Coord=[x,y],tile=document.createElement('button');tile.className='creator-tile';tile.dataset.cell=pos.join(',');tile.setAttribute('role','gridcell');tile.tabIndex=x===1&&y===l.height?0:-1;
      const labels:string[]=[];const marker=(text:string,kind:string,asset?:AssetRole|string)=>{const span=document.createElement('span');span.className='tile-object '+kind;if(asset)applySprite(span,pack,asset);else span.textContent=text;tile.append(span);labels.push(text);};
      const wall=hasCoord(l.walls,pos),ice=hasCoord(l.iceTiles,pos);tile.classList.toggle('tile-wall',wall);tile.classList.toggle('tile-ice',ice);
      tile.append(spriteElement(pack,wall?'wall':ice?'ice':'floor','theme-ground'));
      if(wall)labels.push('wall');if(ice)labels.push('ice');
      for(const p of [1,2] as const){if(!author&&player!==p)continue;const own=p===1?boxes1:boxes2;const switches=p===1?l.switchesP1:l.switchesP2;
        if(hasCoord(switches,pos))marker(`S${p}`,`tile-switch p${p}`,`switch.p${p}.${hasCoord(own,pos)?'held':'up'}`);
        if(at(p===1?l.exitP1:l.exitP2,pos))marker(`E${p}`,`tile-exit p${p}`,`exit.p${p}.${isExitOpen(p,own,computeLaserTiles(own,l),l)?'open':'closed'}`);
        own.forEach((box,i)=>{if(at(box,pos))marker(`${String.fromCharCode(65+i)}${author?'·'+p:''}`,`tile-box p${p}`,l.hasMirrorBox?`mirror.backslash.${hasCoord(laser,pos)?'on':'off'}`:`crate.p${p}`);});
        if(at(p===1?l.initialP1:l.initialP2,pos))marker(`P${p}`,`tile-player p${p}`,p===1?'p1':'p2');
      }
      if(author)(l.weldTargets??[]).forEach((target,i)=>{if(at(target,pos))marker(`◇${String.fromCharCode(65+i)}`,'tile-weld','replay.neutral.crate');});
      if(author&&at(l.midpointSwitchRequired,pos))marker('S*','tile-midpoint','switch.neutral.up');
      if(at(l.laserEmitter?.pos,pos))marker(arrows[l.laserEmitter!.dir],'tile-emitter',`laser.emitter.on.${({U:'north',D:'south',L:'west',R:'east',W:'south'} as const)[l.laserEmitter!.dir]}`);
      if((author||player===1)&&at(l.laserReceiverP1,pos))marker('R1','tile-receiver',`laser.receiver.${hasCoord(laser,pos)?'on':'off'}.north`);
      if(!author&&hasCoord(laser,pos))marker('laser','tile-laser','laser.beam.horizontal');
      const coordinates=document.createElement('small');coordinates.textContent=`${x},${y}`;tile.append(coordinates);
      tile.setAttribute('aria-label',`${x},${y}: ${labels.join(', ')||'floor'}`);tile.title=tile.getAttribute('aria-label')!;
      grid.append(tile);
      if(focused===tile.dataset.cell){tile.tabIndex=0;tile.focus({preventScroll:true});}
    }
    const icons:Record<string,string>={floor:'floor',wall:'wall',ice:'ice',p1:'p1',p2:'p2',box1:'crate.p1',box2:'crate.p2',weld:'replay.neutral.crate',switch1:'switch.p1.up',switch2:'switch.p2.up',exit1:'exit.p1.closed',exit2:'exit.p2.closed',midpoint:'switch.neutral.up',laser:'laser.emitter.on.south',receiver:'laser.receiver.off.north',erase:'notice.invalid'};
    this.root.querySelectorAll<HTMLElement>('[data-tool] b').forEach(el=>{const id=el.parentElement!.dataset.tool!;el.textContent='';applySprite(el,pack,icons[id]);el.classList.add('theme-palette-icon');});
  }
  refreshTheme(){const select=this.el<HTMLSelectElement>('#creator-environment');select.replaceChildren(...registeredThemes.map(p=>new Option(p.name,p.id)));select.value=environments[this.model.level.environment??'foundry']?.id??'modern-gray';this.render();}
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
    if(event.code==='Escape'){this.cancelGesture();this.tool=null;this.wallMode=false;this.render();return;}
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyS'){event.preventDefault();if(target.matches('input,select,textarea'))target.blur();void this.persist(false);return;}
    if(target.matches('input,select,textarea'))return;
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyZ'){
      event.preventDefault();this.cancelGesture();
      if(this.model.engine){
        this.model.undoTurn();
        this.render();
      }else{
        event.shiftKey?this.model.redo():this.model.undo();
        this.dirty=true;
        this.remember();
        this.syncFields();
        this.render();
      }
      return;
    }
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyY'&&!this.model.engine){event.preventDefault();this.model.redo();this.dirty=true;this.remember();this.syncFields();this.render();return;}
    if(this.model.engine&&KEY_MOVES[event.code]&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      if(target.tagName==='BUTTON'&&(event.code==='Enter'||event.code==='Space'))return;
      event.preventDefault();if(event.repeat)return;
      try{
        const [player,direction]=KEY_MOVES[event.code];
        this.queuePlaytest(player,direction);
      }catch(error){
        this.message((error as Error).message);
      }
      return;
    }
    const cell=target.closest<HTMLButtonElement>('[data-cell]');
    if(cell&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)){event.preventDefault();const [x,y]=cell.dataset.cell!.split(',').map(Number);const next:Coord=[x+(event.code==='ArrowRight'?1:event.code==='ArrowLeft'?-1:0),y+(event.code==='ArrowUp'?1:event.code==='ArrowDown'?-1:0)];const nextCell=this.root.querySelector<HTMLButtonElement>(`[data-cell="${next.join(',')}"]`);if(nextCell){cell.tabIndex=-1;nextCell.tabIndex=0;nextCell.focus();}}
  }

  destroy(){
    this.cancelGesture();this.active=false;this.model.engine=null;this.notifyPlaytest();
    window.removeEventListener('pointermove',this.boundPointerMove);
    window.removeEventListener('pointerup',this.boundPointerUp);
    window.removeEventListener('pointercancel',this.boundPointerCancel);
    window.removeEventListener('blur',this.boundBlur);
    this.observer.disconnect();
    this.root.remove();
  }
}
