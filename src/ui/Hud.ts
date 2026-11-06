import { isLive, type Direction } from '../core/types';
import type { Player, SessionState } from '../network/protocol';
import type { ConnectionStatus } from '../network/CoopClient';
import type { RemoteView } from '../network/RemoteView';
import type {CampaignSummary,ReferenceSolution} from '../editor/types';
export interface HudActions {
  level:(index:number)=>void;undo:()=>void;reset:()=>void;fullscreen:()=>void;
  solution:()=>void;queue:(direction:Direction)=>void;inspect:(step:number|null)=>void;theme:()=>void;sound:()=>void;cancel:()=>void;home:()=>void;party:()=>void;
}
const arrows:Record<Direction,string>={U:'↑',D:'↓',L:'←',R:'→',W:'·'};
export class Hud {
  readonly root=document.getElementById('hud')!;
  helpOpen=false;private hintOpen=false;private player:Player=1;
  constructor(private levels:CampaignSummary[],private actions:HudActions){
    this.root.innerHTML=`
      <header class="topbar"><div class="wordmark"><span class="mark">⌁</span> WELDPOINT<span class="edition">TEMPORAL PINCER / ONLINE CO-OP</span></div>
      <nav class="levels" aria-label="Level selector">${levels.map((l,i)=>`<button data-level="${i}" title="${l.name}" aria-label="Level ${i+1}: ${l.name}">${String(i+1).padStart(2,'0')}</button>`).join('')}<span class="level-caption">CHAMBERS</span></nav>
      <div class="utilities"><button data-action="home" aria-label="Return to home" title="Leave session and return home">⌂</button><button data-action="sound" aria-label="Toggle sound" id="sound">SFX ON</button><button data-action="theme" aria-label="Change environment">◐</button><button data-action="help" aria-label="How to play">?</button><button data-action="fullscreen" aria-label="Fullscreen">⛶</button></div></header>
      <section class="mission"><div><span class="eyebrow" id="chamber"></span><h1 id="level-name"></h1></div><div class="phase"><span id="phase-led"></span><span id="phase-name"></span><small id="phase-detail"></small></div><div class="turn-count"><span>TURN</span><strong id="turn">00</strong><span id="turn-total">/ 08</span></div></section>
      <div id="preview-banner" hidden>REVIEWING YOUR HISTORY <button data-action="live">Return to live ↗</button></div>
      <div id="connection" class="connection" role="status" aria-live="polite">Connecting to the shared chamber…</div>
      <footer class="console"><div class="timeline-row"><div class="timeline-label">TIMELINE<span>0 → 8</span></div><div id="timeline" class="timeline" aria-label="Recorded turn history"></div><div class="history-actions"><button data-action="undo" id="undo" title="Undo for both players (Backspace / Z)">↶ <span>Undo</span></button><button data-action="reset" id="reset" title="Reset for both players (R)">↺ <span>Reset</span></button><button data-action="hint">Reference route</button></div></div>
      <div class="controls-row"><div id="operator" class="operator p1"><span class="operator-label" id="operator-label">YOU</span><div class="dpad" aria-label="Your moves">${(['L','U','D','R','W'] as Direction[]).map(d=>`<button data-move="${d}" aria-label="${d==='W'?'Wait':{L:'Move left',U:'Move up',D:'Move down',R:'Move right'}[d]}">${d==='W'?'WAIT':arrows[d]}</button>`).join('')}</div><span class="queued" id="queue">CHOOSE MOVE</span><button data-action="cancel" id="cancel" class="cancel" hidden>Cancel</button></div>
      <div class="transmission" role="status" aria-live="polite"><span class="status-dot"></span><span id="message"></span></div><div class="peer-status" id="peer-status">PARTNER OFFLINE</div></div></footer>
      <div id="hint" class="hint" hidden></div>
      <div id="outcome" class="outcome" hidden><span id="outcome-kicker"></span><h2 id="outcome-title"></h2><p id="outcome-message"></p><div id="outcome-actions"></div></div>
      <div id="help" class="modal" hidden><section role="dialog" aria-modal="true" aria-labelledby="help-title"><span class="eyebrow">OPERATOR FIELD GUIDE</span><h2 id="help-title">Two operators.<br/>Opposite ends of time.</h2><p>Co-op uses a private invitation: both operators confirm Ready, then the host starts. Solo pairs you with a fixed creator or player replay. Its future moves stay hidden.</p><ol><li><strong id="help-write">WRITE · Turns 1–4</strong>Coordinate box positions with your partner. A shove moves the box while you stay put.</li><li><strong id="help-weld">WELD · Turn 4</strong>Matching boxes must meet; some chambers also require unmarked fixed positions.</li><li><strong id="help-replay">REPLAY · Turns 5–8</strong>Boxes follow your partner’s history in reverse. Keep clear and reach both open exits together before time expires.</li></ol><p class="help-keys">WASD or arrows: move · Space / Enter: wait<br/>Both queued inputs commit a turn. Cancel or change yours before your partner commits.<br/>Backspace / Z: shared undo · R: shared reset · F: fullscreen<br/>Return Home to choose another challenge. Solo wins publish your run; only co-op wins unlock progress and reference routes.</p><button data-action="close-help" class="primary">Return to chamber ↗</button></section></div>`;
    this.root.addEventListener('click',e=>{
      const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b||b.disabled)return;if((e as MouseEvent).detail>0)b.blur();
      if(b.dataset.level!==undefined){this.hintOpen=false;actions.level(Number(b.dataset.level));return;}
      if(b.dataset.move){actions.queue(b.dataset.move as Direction);return;}
      if(b.dataset.step!==undefined){actions.inspect(Number(b.dataset.step));return;}
      const action=b.dataset.action;
      if(action==='help'||action==='close-help'){this.toggleHelp();return;}
      if(action==='hint'){actions.solution();return;}
      if(action==='live'){actions.inspect(null);return;}
      if(action==='next'){actions.level(Number(b.dataset.next));return;}
      if(action&&action in actions)(actions[action as keyof HudActions] as ()=>void)();
    });
  }
  setLevels(levels:CampaignSummary[]){
    if(JSON.stringify(levels)===JSON.stringify(this.levels)&&this.root.querySelectorAll('[data-level]').length===levels.length)return;
    this.levels=levels;const nav=this.root.querySelector('.levels')!;nav.replaceChildren();
    levels.forEach((level,i)=>{const b=document.createElement('button');b.dataset.level=String(i);b.title=level.name;b.setAttribute('aria-label',`Chamber ${level.slot}: ${level.name}`);b.textContent=String(level.slot).padStart(2,'0');nav.append(b);});
    const caption=document.createElement('span');caption.className='level-caption';caption.textContent='CHAMBERS';nav.append(caption);
  }
  clearSolution(){this.hintOpen=false;this.root.querySelector('#hint')!.replaceChildren();this.root.querySelector('#hint')!.setAttribute('hidden','');}
  showSolution(solution:ReferenceSolution){const hint=this.root.querySelector('#hint')!;hint.replaceChildren();const title=document.createElement('b');title.textContent=`REFERENCE · ${solution.name}`;hint.append(title);for(const [i,moves] of [solution.solutionP1,solution.solutionP2].entries()){const row=document.createElement('span');row.textContent=`P${i+1} ${moves.map(m=>arrows[m]).join(' ')}`;hint.append(row);}const close=document.createElement('button');close.textContent='Close';close.onclick=()=>this.clearSolution();hint.append(close);this.hintOpen=true;hint.removeAttribute('hidden');}
  toggleHelp(force?:boolean){this.helpOpen=force??!this.helpOpen;this.root.querySelector('#help')!.toggleAttribute('hidden',!this.helpOpen);if(this.helpOpen)this.root.querySelector<HTMLButtonElement>('[data-action="close-help"]')!.focus();}
  render(view:RemoteView|null,session:SessionState|null,status:ConnectionStatus,notice:string|null,completed:Set<number>,previewSeconds=0){
    const connected=status==='connected',preview=!!session?.preview,paired=connected&&!!session?.partnerConnected&&!preview;
    if(session)this.player=session.player;
    const text=status==='full'?(notice??'Both player slots are occupied.'):!connected?(status==='connecting'?'Connecting to the shared chamber…':'Connection lost. Reconnecting…'):!paired?`You are P${this.player}. Waiting for your partner. Open this chamber from Published levels and choose P${this.player===1?2:1}.`:`You are P${this.player} · ${this.player===1?'FORWARD':'REVERSE'} · PARTNER CONNECTED`;
    this.root.querySelector<HTMLElement>('.levels')!.hidden=!!session?.party;
    this.root.querySelector('.edition')!.textContent=session?.mode==='solo'?'TEMPORAL PINCER / SOLO':'TEMPORAL PINCER / CO-OP';
    this.root.querySelector('#connection')!.classList.toggle('initial-preview',previewSeconds>0);
    this.root.querySelector<HTMLButtonElement>('[data-action=help]')!.disabled=preview;
    this.set('connection',previewSeconds>0?`INITIAL OVERLAY · Study both timelines · ${previewSeconds}s`:session?.mode==='solo'&&connected?`SOLO · P${this.player} · REPLAY: ${session.echoName??'Creator solution'}`:text);this.root.querySelector('#connection')!.classList.toggle('paired',paired);
    document.body.dataset.player=String(this.player);
    this.set('operator-label',session?`P${this.player} · YOU`:status==='full'?'NO SLOT':'CONNECTING');this.root.querySelector('#operator')!.className=`operator p${this.player}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b,i)=>{b.disabled=!paired;b.classList.toggle('active',i===(session?.levelIndex??0));b.classList.toggle('completed',completed.has(this.levels[i].slot));});
    for(const id of ['undo','reset'])this.root.querySelector<HTMLButtonElement>('#'+id)!.disabled=!paired||(id==='undo'&&(!session||session.history.length<2));
    this.root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b=>{const error=session?.moveErrors[b.dataset.move as Direction];b.disabled=!paired||!view||view.inspecting!==null||!!error;b.title=error??'';b.classList.toggle('selected',session?.pendingMove===b.dataset.move);});
    const pending=session?.pendingMove;
    this.set('queue',pending?`${arrows[pending]} QUEUED`:'CHOOSE MOVE');this.root.querySelector('#queue')!.classList.toggle('ready',!!pending);
    this.root.querySelector('#cancel')!.toggleAttribute('hidden',!pending);this.root.querySelector<HTMLButtonElement>('#cancel')!.disabled=!paired;
    this.set('peer-status',session?.mode==='solo'?'REPLAY READY':!paired?'PARTNER OFFLINE':session?.partnerReady?'PARTNER READY':'PARTNER CHOOSING');
    this.root.querySelector('#peer-status')!.classList.toggle('ready',paired&&!!session?.partnerReady);
    this.root.querySelector<HTMLButtonElement>('[data-action="hint"]')!.disabled=preview||!session?.solutionAvailable;
    this.root.querySelector<HTMLButtonElement>('[data-action="hint"]')!.title=session?.solutionAvailable?'View the verified reference route':'Complete this revision to unlock its reference route';
    if(!view||!session){this.root.querySelector('#outcome')!.setAttribute('hidden','');return;}
    const s=view.state,l=view.level;
    this.set('chamber',session.customLevelId?'COMMUNITY CHAMBER':`CHAMBER ${String(l.id).padStart(2,'0')} / ${String(this.levels.length).padStart(2,'0')}`);this.set('level-name',l.name);
    this.root.querySelector('.timeline-label span')!.textContent=`0 → ${l.totalSteps}`;
    this.root.querySelector<HTMLElement>('#timeline')!.style.overflowX=l.totalSteps>12?'auto':'';
    this.set('help-write',`WRITE · Turns 1–${l.weldStep}`);this.set('help-weld',`WELD · Turn ${l.weldStep}`);this.set('help-replay',`REPLAY · Turns ${l.weldStep+1}–${l.totalSteps}`);
    this.set('turn',String(s.step).padStart(2,'0'));this.set('turn-total',`/ ${String(l.totalSteps).padStart(2,'0')}`);
    this.set('phase-name',previewSeconds>0?'INITIAL CONFIGURATION':s.step<l.weldStep?'WRITING HISTORY':s.status==='WELD_SUCCESS'?'CAUSALITY WELDED':'LOCKED REPLAY');
    this.set('phase-detail',previewSeconds>0?'MOVES LOCKED UNTIL COUNTDOWN ENDS':s.step<l.weldStep?`CONVERGE AT TURN ${l.weldStep}`:`EXIT TOGETHER BY TURN ${l.totalSteps}`);
    this.root.querySelector('#phase-led')!.className=s.status==='WELD_SUCCESS'?'welded':'';
    const publication=s.status==='VICTORY'?(session.runPublication==='confirmed'?' Your winning run is published.':session.runPublication==='pending'?' Your run is saved; Arkiv publication pending.':''):'';
    this.set('message',previewSeconds>0?'Remember both starting layouts. Your own perspective returns when the countdown ends.':notice??s.message+publication);
    this.root.querySelector('#preview-banner')!.toggleAttribute('hidden',view.inspecting===null);
    this.root.querySelector('#timeline')!.innerHTML=Array.from({length:l.totalSteps+1},(_,k)=>`<button data-step="${k}" ${preview||k>=session.history.length?'disabled':''} class="${k===s.step?'current ':''}${k===l.weldStep?'weld ':''}${k<s.step?'past':''}" aria-label="Review turn ${k}"><i></i><span>${k===l.weldStep?'WELD':k}</span></button>`).join('');
    const terminal=!isLive(s.status)&&view.inspecting===null,victory=s.status==='VICTORY';
    const outcome=this.root.querySelector('#outcome')!;outcome.toggleAttribute('hidden',!terminal);outcome.classList.toggle('victory',victory);
    if(terminal){this.set('outcome-kicker',victory?'TRANSMISSION COMPLETE':'TIMELINE INTERRUPTED');this.set('outcome-title',victory?'Timeline secured.':s.status==='PARADOX_WELD'?'Causality fractured.':s.status==='LASER_DEATH'?'Signal lost.':s.status==='OUT_OF_TIME'?'Out of time.':'History obstructed.');this.set('outcome-message',s.message+publication+(session.mode==='solo'?' Solo practice does not unlock campaign progress or reference solutions.':''));this.root.querySelector('#outcome-actions')!.innerHTML=`${!victory?`<button data-action="undo" ${paired?'':'disabled'}>↶ Undo turn</button>`:''}<button class="primary" data-action="reset" ${paired?'':'disabled'}>Try again</button><button data-action="party" ${session.mode==='coop'&&!connected?'disabled':''}>${session.mode==='coop'?'Go to party':'Back to solo'}</button>`;}
  }
  setSound(on:boolean){this.set('sound',on?'SFX ON':'SFX OFF');}
  private set(id:string,text:string){this.root.querySelector('#'+id)!.textContent=text;}
}
