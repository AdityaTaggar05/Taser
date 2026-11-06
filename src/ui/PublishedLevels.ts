import './published.css';
import type {LevelClient} from '../editor/LevelClient';
import type {LevelSummary} from '../editor/types';
import type {Player} from '../network/protocol';

/** Metadata only: no puzzle layout or reference route is requested here. */
export class PublishedLevels {
  readonly root=document.createElement('main');
  private request=0;
  private category:'community'|'campaign'='community';
  private selected:string|undefined;
  private choosing=false;
  private entries:LevelSummary[]=[];
  constructor(private api:LevelClient,private actions:{home:()=>void;play:(id:string|undefined,player:Player)=>void;fullscreen:()=>void}){
    this.root.id='published-levels';this.root.hidden=true;
    this.root.innerHTML=`<header class="published-header"><button data-library="home">← Home</button><span>WELDPOINT / CHAMBER ARCHIVE</span><button data-library="fullscreen" aria-label="Fullscreen">⛶</button></header><section class="published-content"><p class="archive-kicker">BUILT BY OPERATORS · STORED ON ARKIV</p><h1>Published levels</h1><p class="archive-intro">Pick a chamber. Choose your perspective. Meet in the middle.</p><nav class="archive-tabs" aria-label="Level collection"><button data-library="community">Community</button><button data-library="campaign">Campaign</button><button data-library="refresh">Refresh ↻</button></nav><p class="archive-status" role="status"></p><div class="archive-grid"></div><section class="role-choice" hidden aria-labelledby="role-title"><p class="archive-kicker">CHOOSE YOUR PERSPECTIVE</p><h2 id="role-title">Enter the timeline</h2><p class="role-level"></p><div class="role-options"><button data-player="1"><b>P1 <span>→</span></b><strong>Forward time</strong><small>Write the past. Your partner’s history becomes your way out.</small></button><button data-player="2"><b>P2 <span>←</span></b><strong>Reverse time</strong><small>Start at the other end. Meet your partner at the midpoint.</small></button></div><p class="role-note">Two signed-in players must choose opposite roles on the same chamber. An occupied role waits until it is free. This playtest has one shared room.</p><button data-library="back">← Published levels</button></section></section>`;
    document.body.append(this.root);
    this.root.addEventListener('click',event=>{
      const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button)return;
      if(button.dataset.player){this.actions.play(this.selected,Number(button.dataset.player) as Player);return;}
      const action=button.dataset.library;
      if(action==='home')this.actions.home();
      else if(action==='fullscreen')this.actions.fullscreen();
      else if(action==='back')location.hash='community';
      else if(action==='community'||action==='campaign'){this.category=action;void this.load();}
      else if(action==='refresh')void this.load();
    });
  }
  show(visible:boolean,choosing=false,id?:string){
    this.root.hidden=!visible;this.root.classList.toggle("choosing-role",choosing);this.request++;this.choosing=choosing;this.selected=id;
    if(!visible){this.entries=[];this.root.querySelector('.archive-grid')!.replaceChildren();return;}
    this.root.querySelector('h1')!.textContent=choosing?'Choose your role':'Published levels';
    this.root.querySelector<HTMLElement>('.archive-tabs')!.hidden=choosing;
    this.root.querySelector<HTMLElement>('.archive-grid')!.hidden=choosing;
    this.root.querySelector<HTMLElement>('.role-choice')!.hidden=!choosing;
    this.root.querySelector<HTMLElement>('.archive-intro')!.hidden=choosing;
    const selected=this.entries.find(level=>level.id===id);
    this.root.querySelector('.role-level')!.textContent=selected?selected.name:id?'Published chamber / '+id:'Campaign / shared co-op room';
    this.status('');this.root.querySelector<HTMLElement>('.archive-status')!.hidden=choosing;
    if(!choosing)void this.load();
  }
  private status(message:string){this.root.querySelector('.archive-status')!.textContent=message;}
  private async load(){
    const request=++this.request;
    this.root.querySelectorAll<HTMLButtonElement>('.archive-tabs button[data-library=community],.archive-tabs button[data-library=campaign]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.library===this.category)));
    this.root.querySelector('.archive-grid')!.setAttribute('aria-busy','true');
    this.root.querySelector('.archive-grid')!.replaceChildren();this.status('Loading confirmed publications…');
    try{
      const entries=this.category==='community'?await this.api.community():(await this.api.catalog()).campaign;
      if(request!==this.request||this.root.hidden||this.choosing)return;
      this.entries=entries;this.render();
    }catch(error){if(request===this.request)this.status((error as Error).message+' Use Refresh to retry.');}
    finally{if(request===this.request)this.root.querySelector('.archive-grid')!.setAttribute('aria-busy','false');}
  }
  private render(){
    const grid=this.root.querySelector('.archive-grid')!;grid.replaceChildren();
    this.status(this.entries.length?`${this.entries.length} published ${this.entries.length===1?'chamber':'chambers'} · verified winning solutions`:'No community chambers yet. Publish a winning level in Level creator, or explore Campaign.');
    for(const level of this.entries){
      const card=document.createElement('article');card.className='archive-card';
      const meta=document.createElement('p');meta.className='archive-kicker';meta.textContent=`${level.width} × ${level.height} / ${level.totalSteps} TURNS / REV ${level.publishedRevision??level.revision}`;
      const name=document.createElement('h2');name.textContent=level.name;
      const subtitle=document.createElement('p');subtitle.className='archive-subtitle';subtitle.textContent=level.subtitle;
      const author=document.createElement('p');author.className='archive-author';author.textContent=`By ${level.ownerName}`;
      const play=document.createElement('a');play.href='#play/'+level.id;play.className='archive-play';play.textContent='Choose P1 / P2 ↗';
      card.append(meta,name,subtitle,author,play);grid.append(card);
    }
  }
  destroy(){this.request++;this.root.remove();}
}
