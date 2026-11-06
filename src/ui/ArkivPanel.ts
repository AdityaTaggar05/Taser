import {ARKIV_NETWORK,explorerLink,type ArkivFeed,type ArkivActivity} from '../network/arkiv';
import type {LevelClient,ArchiveReference} from '../editor/LevelClient';
import './arkiv.css';
/** One panel across routes. Polls only while visible; stale responses cannot cross account boundaries. */
export class ArkivPanel {
  readonly root=document.createElement('aside');
  private toggle=document.createElement('button');private content=document.createElement('section');
  private feed:ArkivFeed|null=null;private user:string|null=null;private visible=false;private expanded=false;
  private generation=0;private timer:ReturnType<typeof setTimeout>|undefined;private abort:AbortController|undefined;
  private unsubscribe:(()=>void)|undefined;private publicationKey:string|undefined;private lastRender='';private error='';
  constructor(private api:LevelClient){
    this.root.id='arkiv-panel';this.root.hidden=true;this.root.setAttribute('aria-label','Arkiv block explorer');
    this.toggle.type='button';this.toggle.className='arkiv-toggle';this.toggle.setAttribute('aria-controls','arkiv-panel-content');
    this.content.id='arkiv-panel-content';this.content.hidden=true;
    try{this.expanded=localStorage.getItem('weldpoint:explorer')==='expanded';}catch{}
    this.toggle.addEventListener('click',()=>this.expand(!this.expanded));
    this.root.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){this.expand(false);this.toggle.focus();}});
    this.root.append(this.toggle,this.content);document.body.append(this.root);this.expand(this.expanded);
  }
  context(key?:string){if(this.publicationKey===key)return;this.publicationKey=key;this.render();}
  show(visible:boolean,user:string|null){
    if(this.visible===visible&&this.user===user)return;
    const changedUser=this.user!==user;this.stop();this.visible=visible;this.user=user;this.root.hidden=!visible;
    if(changedUser){this.feed=null;this.error='';this.api.clearReferences();this.publicationKey=undefined;this.lastRender='';}
    if(!visible)return;
    this.unsubscribe=this.api.onReferences(()=>this.render());this.render();void this.poll(this.generation);
  }
  private expand(value:boolean){
    this.expanded=value;this.content.hidden=!value;this.toggle.setAttribute('aria-expanded',String(value));
    try{localStorage.setItem('weldpoint:explorer',value?'expanded':'minimized');}catch{}
    this.render();
  }
  private async poll(generation:number){
    this.abort=new AbortController();
    try{const feed=await this.api.activity(this.abort.signal);if(generation!==this.generation)return;this.feed=feed;this.error='';}
    catch{if(generation!==this.generation)return;this.error='Activity unavailable. Displayed results may be stale; retrying…';}
    if(generation!==this.generation)return;this.render();this.timer=setTimeout(()=>void this.poll(generation),3000);
  }
  private link(label:string,kind:'tx'|'entity',value?:string){
    const href=explorerLink(kind,value);if(!href)return null;
    const a=document.createElement('a');a.textContent=label+' ↗';a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;
  }
  private render(){
    const activities=this.feed?.activities??[],test=this.feed?.storage==='test';
    const pending=activities.filter(a=>a.state==='pending').length,failed=activities.filter(a=>a.state==='failed').length;
    this.toggle.textContent=`${this.expanded?'−':'+'} Arkiv explorer${test?' · TEST':pending?' · '+pending+' pending':failed?' · '+failed+' failed':''}`;
    if(!this.expanded)return;
    const signature=JSON.stringify([this.feed,this.error,this.api.references,this.publicationKey]);if(signature===this.lastRender)return;this.lastRender=signature;
    const focused=(document.activeElement as HTMLAnchorElement)?.href;
    const header=document.createElement('div');header.className='arkiv-heading';
    const title=document.createElement('strong');title.textContent=test?'Test archive · no blockchain writes':`${ARKIV_NETWORK.name} · chain ${ARKIV_NETWORK.chainId}`;header.append(title);
    if(this.feed?.storage==='arkiv'){const a=document.createElement('a');a.textContent='Open explorer ↗';a.href=ARKIV_NETWORK.explorer;a.target='_blank';a.rel='noopener noreferrer';header.append(a);}
    const description=document.createElement('p');description.textContent=test?'Simulated archive results. No live transaction or entity links.':this.feed?.storage==='unconfigured'?'Arkiv is not configured. No on-chain writes are available.':'One completed P1 + P2 turn → encrypted queue → transaction → verified entity. Moves never wait for confirmation.';
    const status=document.createElement('p');status.className='arkiv-status';status.setAttribute('role','status');status.textContent=this.error||(!this.feed?'Loading activity…':`${activities.length} recent writes · ${pending} pending · ${failed} failed${test?' · test results only':''}`);
    const list=document.createElement('ol');list.className='arkiv-activity';list.setAttribute('aria-label','Recent archive writes');
    for(const activity of activities)this.activity(list,activity,test||this.feed?.storage!=='arkiv');
    if(!activities.length){const empty=document.createElement('li');empty.textContent='No writes recorded for your account yet. Archive reads do not create transactions.';list.append(empty);}
    const refs=document.createElement('div');refs.className='arkiv-refs';const heading=document.createElement('strong');heading.textContent='Archive references · reads, not new writes';refs.append(heading);
    const references:ArchiveReference[]=this.publicationKey?[{name:'Current chamber',entityKey:this.publicationKey,storage:this.feed?.storage}]:this.api.references;
    for(const ref of references){if(ref.storage!=='arkiv')continue;const row=document.createElement('p');const entity=this.link(ref.name,'entity',ref.entityKey),tx=this.link('Publication transaction','tx',ref.txHash);if(entity)row.append(entity);if(tx)row.append(tx);if(row.childNodes.length)refs.append(row);}
    this.content.replaceChildren(header,description,status,list,refs);
    if(focused){const replacement=Array.from(this.content.querySelectorAll('a')).find(a=>a.href===focused);replacement?.focus({preventScroll:true});}
  }
  private activity(list:HTMLElement,a:ArkivActivity,test:boolean){
    const row=document.createElement('li');row.dataset.state=a.state;
    const label=document.createElement('strong');label.textContent=a.label;
    const state=document.createElement('span');state.className='arkiv-write-state';state.textContent=test?`TEST · ${a.state==='confirmed'?'recorded':a.state}`:a.state==='confirmed'?'Confirmed':a.state==='failed'?'Failed':a.txHash?'Pending verification':'Pending · queued';
    const flow=document.createElement('p');flow.className='arkiv-flow';flow.textContent=test?'Local test adapter → simulated result':a.state==='confirmed'?'Queued → submitted → verified on-chain':a.state==='failed'?(a.txHash?'Queued → submitted → failed':'Queued → failed before confirmation'):a.txHash?'Queued → submitted → awaiting verification':'Queued → awaiting submission';
    const time=document.createElement('time');time.dateTime=new Date(a.createdAt).toISOString();time.textContent=new Date(a.createdAt).toLocaleTimeString();
    row.append(label,state,flow,time);
    if(a.message){const message=document.createElement('p');message.textContent=a.message;row.append(message);}
    if(!test){const tx=this.link('Transaction','tx',a.txHash),entity=this.link('Entity','entity',a.entityKey);if(tx)row.append(tx);if(entity)row.append(entity);}
    list.append(row);
  }
  private stop(){this.generation++;clearTimeout(this.timer);this.abort?.abort();this.unsubscribe?.();this.unsubscribe=undefined;}
  destroy(){this.stop();this.root.remove();}
}
