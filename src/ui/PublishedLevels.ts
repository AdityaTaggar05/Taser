import './published.css';
import type {LevelClient} from '../editor/LevelClient';
import type {LevelSummary} from '../editor/types';
export class PublishedLevels {
  readonly root=document.createElement('main');private request=0;
  constructor(private api:LevelClient,private actions:{home:()=>void;fullscreen:()=>void}){
    this.root.id='published-levels';this.root.hidden=true;document.body.append(this.root);
  }
  show(visible:boolean,hash=''){
    this.root.hidden=!visible;const request=++this.request;if(!visible){this.root.replaceChildren();return;}
    this.root.innerHTML=`<header class="published-header"><button data-menu="home">← Home</button><span>WELDPOINT / CHALLENGES</span><button data-menu="fullscreen" aria-label="Fullscreen">⛶</button></header><section class="published-content"><p class="archive-kicker">TWO PERSPECTIVES · ONE TIMELINE</p><h1></h1><p class="archive-intro"></p><div class="menu-body"></div><p class="archive-status" role="status"></p></section>`;
    this.root.querySelector('[data-menu=home]')!.addEventListener('click',this.actions.home);this.root.querySelector('[data-menu=fullscreen]')!.addEventListener('click',this.actions.fullscreen);
    const body=this.root.querySelector('.menu-body')!,title=this.root.querySelector('h1')!,intro=this.root.querySelector('.archive-intro')!;
    const mode=/^#(solo|coop)/.exec(hash)?.[1] as 'solo'|'coop'|undefined;
    const selected=/\/(?:campaign|community|chamber)\/([a-f0-9-]{36})/.exec(hash)?.[1];
    const legacy=/^#play\/([a-f0-9-]{36})/.exec(hash)?.[1];
    const category=hash.includes('/campaign')?'campaign':'community';
    const role=/\/p([12])/.exec(hash)?.[1];
    const status=(message:string)=>{if(this.request===request)this.root.querySelector('.archive-status')!.textContent=message;};
    const link=(text:string,href:string,parent=body,css='archive-play')=>{const a=document.createElement('a');a.textContent=text;a.href=href;a.className=css;parent.append(a);return a;};
    if(!mode){
      title.textContent='Choose how to play';intro.textContent='A live partner or an echo from another timeline.';
      const choices=document.createElement('div');choices.className='mode-choice';body.append(choices);
      link('Co-op →',legacy?'#coop/chamber/'+legacy:'#coop',choices);link('Solo →',legacy?'#solo/chamber/'+legacy:'#solo',choices);return;
    }
    if(!hash.includes('/')){
      title.textContent=mode==='solo'?'Solo challenges':'Co-op challenges';intro.textContent=mode==='solo'?'Choose a chamber, then play alongside a fixed creator or player replay.':'Choose a chamber and invite your partner to a private party.';
      const choices=document.createElement('div');choices.className='collection-choice';body.append(choices);
      link('Campaign →','#'+mode+'/campaign',choices);link('Community →','#'+mode+'/community',choices);
      if(mode==='coop'){
        const form=document.createElement('form');form.className='join-code-form';form.innerHTML='<label for="invite-code">Have an invitation?</label><input id="invite-code" required maxlength="12" minlength="12" placeholder="12-character code" autocomplete="off" pattern="[a-fA-F0-9]{12}"/><button type="submit">Join party ↗</button>';
        form.onsubmit=event=>{event.preventDefault();const code=form.querySelector('input')!.value.trim().toUpperCase();if(/^[A-F0-9]{12}$/.test(code))location.hash='invite/'+code;};body.append(form);
      }return;
    }
    if(selected&&!role){
      title.textContent='Choose your role';intro.textContent=mode==='coop'?'Your invited partner will take the opposite role.':'Your replay partner will play the opposite role.';
      const choices=document.createElement('div');choices.className='role-options';body.append(choices);
      for(const player of [1,2]){const a=link('',hash+'/p'+player,choices,'role-link');a.innerHTML=`<b>P${player} <span>${player===1?'→':'←'}</span></b><strong>${player===1?'Forward':'Reverse'} time</strong><small>${player===1?'Write the past. Find your way out through your partner’s history.':'Begin at the other end. Meet in the middle of time.'}</small>`;}
      link('← Choose another chamber','#'+mode+'/'+category);return;
    }
    if(selected&&role&&mode==='solo'){
      title.textContent=hash.endsWith('/runs')?'Player runs':'Choose your replay';intro.textContent=`You play P${role}. The replay controls P${role==='1'?2:1}; its future moves stay hidden.`;
      if(!hash.endsWith('/runs')){
        const choices=document.createElement('div');choices.className='echo-options';body.append(choices);
        link('Creator solution →',hash+'/creator',choices,'run-choice');link('Player runs →',hash+'/runs',choices,'run-choice');
        status('Solo wins automatically publish your human run. Only co-op wins unlock campaign progress and reference solutions.');
      }else{
        const list=document.createElement('div');body.append(list);const retry=document.createElement('button');retry.className='archive-refresh';retry.textContent='Refresh runs ↻';retry.onclick=()=>this.show(true,hash);body.prepend(retry);link('← Replay sources',hash.replace(/\/runs$/,''));
        status('Loading confirmed runs…');void this.api.runs(selected,role==='1'?2:1).then(runs=>{
          if(this.request!==request)return;status(runs.length?'Verified winning runs for this exact chamber revision. Available for about 48 hours.':'No matching player runs yet. Try the creator solution first.');
          for(const run of runs)link(`${run.name} · P${run.role} · ${run.turns} turns · ${run.mode}`,hash.replace(/\/runs$/,'/run/'+run.id),list,'run-choice');
        }).catch(error=>status((error as Error).message));
      }return;
    }
    title.textContent=category==='campaign'?'Campaign challenges':'Community challenges';intro.textContent=category==='community'?'Verified community publications, available for about 48 hours.':'Choose a campaign chamber.';
    const grid=document.createElement('div');grid.className='archive-grid';body.append(grid);
    const refresh=document.createElement('button');refresh.textContent='Refresh ↻';refresh.className='archive-refresh';refresh.onclick=()=>this.show(true,hash);body.prepend(refresh);
    status('Loading confirmed publications…');
    void (category==='campaign'?this.api.catalog().then(c=>c.campaign):this.api.community()).then(entries=>{
      if(this.request!==request)return;status(entries.length?`${entries.length} published ${entries.length===1?'chamber':'chambers'} · winning solutions verified`:'No community chambers yet. Publish a winning level in Level creator.');
      for(const level of entries)this.card(level,grid,'#'+mode+'/'+category+'/'+level.id);
      link('← Challenge collections','#'+mode);
    }).catch(error=>status((error as Error).message+' Use Refresh to retry.'));
  }
  private card(level:LevelSummary,parent:Element,href:string){
    const card=document.createElement('article');card.className='archive-card';
    for(const [tag,text,css] of [['p',`${level.width} × ${level.height} / ${level.totalSteps} TURNS / REV ${level.publishedRevision??level.revision}`,'archive-kicker'],['h2',level.name,''],['p',level.subtitle,'archive-subtitle'],['p','By '+level.ownerName,'archive-author']]){const el=document.createElement(tag);el.textContent=text;el.className=css;card.append(el);}
    const play=document.createElement('a');play.href=href;play.className='archive-play';play.textContent='Choose P1 / P2 ↗';card.append(play);parent.append(card);
  }
  destroy(){this.request++;this.root.remove();}
}
