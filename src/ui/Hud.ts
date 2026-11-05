import { isLive, type Direction, type LevelConfig } from '../core/types';
import type { Player, SessionState } from '../network/protocol';
import type { ConnectionStatus } from '../network/CoopClient';
import type { RemoteView } from '../network/RemoteView';
export interface HudActions {
  level:(index:number)=>void;undo:()=>void;reset:()=>void;fullscreen:()=>void;
  queue:(direction:Direction)=>void;inspect:(step:number|null)=>void;theme:()=>void;sound:()=>void;cancel:()=>void;
}
const arrows:Record<Direction,string>={U:'↑',D:'↓',L:'←',R:'→',W:'·'};
export class Hud {
  readonly root=document.getElementById('hud')!;
  helpOpen=false;private hintOpen=false;private player:Player=1;
  constructor(private levels:LevelConfig[],private actions:HudActions){
    this.root.innerHTML=`
      <header class="topbar"><div class="wordmark"><span class="mark">⌁</span> WELDPOINT<span class="edition">TEMPORAL PINCER / ONLINE CO-OP</span></div>
      <nav class="levels" aria-label="Level selector">${levels.map((l,i)=>`<button data-level="${i}" title="${l.name}" aria-label="Level ${i+1}: ${l.name}">${String(i+1).padStart(2,'0')}</button>`).join('')}<span class="level-caption">CHAMBERS</span></nav>
      <div class="utilities"><button data-action="sound" aria-label="Toggle sound" id="sound">SFX ON</button><button data-action="theme" aria-label="Change environment">◐</button><button data-action="help" aria-label="How to play">?</button><button data-action="fullscreen" aria-label="Fullscreen">⛶</button></div></header>
      <section class="mission"><div><span class="eyebrow" id="chamber"></span><h1 id="level-name"></h1></div><div class="phase"><span id="phase-led"></span><span id="phase-name"></span><small id="phase-detail"></small></div><div class="turn-count"><span>TURN</span><strong id="turn">00</strong><span id="turn-total">/ 08</span></div></section>
      <div id="preview-banner" hidden>REVIEWING YOUR HISTORY <button data-action="live">Return to live ↗</button></div>
      <div id="connection" class="connection" role="status" aria-live="polite">Connecting to the shared chamber…</div>
      <footer class="console"><div class="timeline-row"><div class="timeline-label">TIMELINE<span>0 → 8</span></div><div id="timeline" class="timeline" aria-label="Recorded turn history"></div><div class="history-actions"><button data-action="undo" id="undo" title="Undo for both players (Backspace / Z)">↶ <span>Undo</span></button><button data-action="reset" id="reset" title="Reset for both players (R)">↺ <span>Reset</span></button><button data-action="hint">Hint</button></div></div>
      <div class="controls-row"><div id="operator" class="operator p1"><span class="operator-label" id="operator-label">YOU</span><div class="dpad" aria-label="Your moves">${(['L','U','D','R','W'] as Direction[]).map(d=>`<button data-move="${d}" aria-label="${d==='W'?'Wait':{L:'Move left',U:'Move up',D:'Move down',R:'Move right'}[d]}">${d==='W'?'WAIT':arrows[d]}</button>`).join('')}</div><span class="queued" id="queue">CHOOSE MOVE</span><button data-action="cancel" id="cancel" class="cancel" hidden>Cancel</button></div>
      <div class="transmission" role="status" aria-live="polite"><span class="status-dot"></span><span id="message"></span></div><div class="peer-status" id="peer-status">PARTNER OFFLINE</div></div></footer>
      <div id="hint" class="hint" hidden></div>
      <div id="outcome" class="outcome" hidden><span id="outcome-kicker"></span><h2 id="outcome-title"></h2><p id="outcome-message"></p><div id="outcome-actions"></div></div>
      <div id="help" class="modal" hidden><section role="dialog" aria-modal="true" aria-labelledby="help-title"><span class="eyebrow">OPERATOR FIELD GUIDE</span><h2 id="help-title">Two operators.<br/>Opposite ends of time.</h2><p>Open this same URL on two browsers or devices. The first player becomes P1; the second becomes P2. Each sees only their own timeline.</p><ol><li><strong>WRITE · Turns 1–4</strong>Coordinate box positions with your partner. A shove moves the box while you stay put.</li><li><strong>WELD · Turn 4</strong>Matching boxes must meet at the required unmarked positions.</li><li><strong>REPLAY · Turns 5–8</strong>Boxes follow your partner’s history in reverse. Keep clear and reach both exits on turn 8.</li></ol><p class="help-keys">WASD or arrows: move · Space / Enter: wait<br/>Both queued inputs commit a turn. Cancel or change yours before your partner commits.<br/>Backspace / Z: shared undo · R: shared reset · F: fullscreen<br/>Either player can change the chamber for both.</p><button data-action="close-help" class="primary">Return to chamber ↗</button></section></div>`;
    this.root.addEventListener('click',e=>{
      const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b||b.disabled)return;if((e as MouseEvent).detail>0)b.blur();
      if(b.dataset.level!==undefined){this.hintOpen=false;actions.level(Number(b.dataset.level));return;}
      if(b.dataset.move){actions.queue(b.dataset.move as Direction);return;}
      if(b.dataset.step!==undefined){actions.inspect(Number(b.dataset.step));return;}
      const action=b.dataset.action;
      if(action==='help'||action==='close-help'){this.toggleHelp();return;}
      if(action==='hint'){this.hintOpen=!this.hintOpen;this.root.querySelector('#hint')!.toggleAttribute('hidden',!this.hintOpen);return;}
      if(action==='live'){actions.inspect(null);return;}
      if(action==='next'){actions.level(Number(b.dataset.next));return;}
      if(action&&action in actions)(actions[action as keyof HudActions] as ()=>void)();
    });
  }
  toggleHelp(force?:boolean){this.helpOpen=force??!this.helpOpen;this.root.querySelector('#help')!.toggleAttribute('hidden',!this.helpOpen);if(this.helpOpen)this.root.querySelector<HTMLButtonElement>('[data-action="close-help"]')!.focus();}
  render(view:RemoteView|null,session:SessionState|null,status:ConnectionStatus,notice:string|null,completed:Set<number>){
    const connected=status==='connected', paired=connected&&!!session?.partnerConnected;
    if(session)this.player=session.player;
    const text=status==='full'?(notice??'Both player slots are occupied.'):!connected?(status==='connecting'?'Connecting to the shared chamber…':'Connection lost. Reconnecting…'):!paired?`You are P${this.player}. Waiting for your partner—open this same URL on another browser or device.`:`You are P${this.player} · ${this.player===1?'FORWARD':'REVERSE'} · PARTNER CONNECTED`;
    this.set('connection',text);this.root.querySelector('#connection')!.classList.toggle('paired',paired);
    document.body.dataset.player=String(this.player);
    this.set('operator-label',session?`P${this.player} · YOU`:status==='full'?'NO SLOT':'CONNECTING');this.root.querySelector('#operator')!.className=`operator p${this.player}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b,i)=>{b.disabled=!paired;b.classList.toggle('active',i===(session?.levelIndex??0));b.classList.toggle('completed',completed.has(this.levels[i].id));});
    for(const id of ['undo','reset'])this.root.querySelector<HTMLButtonElement>('#'+id)!.disabled=!paired||(id==='undo'&&(!session||session.history.length<2));
    this.root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b=>{const error=session?.moveErrors[b.dataset.move as Direction];b.disabled=!paired||!view||view.inspecting!==null||!!error;b.title=error??'';b.classList.toggle('selected',session?.pendingMove===b.dataset.move);});
    const pending=session?.pendingMove;
    this.set('queue',pending?`${arrows[pending]} QUEUED`:'CHOOSE MOVE');this.root.querySelector('#queue')!.classList.toggle('ready',!!pending);
    this.root.querySelector('#cancel')!.toggleAttribute('hidden',!pending);this.root.querySelector<HTMLButtonElement>('#cancel')!.disabled=!paired;
    this.set('peer-status',!paired?'PARTNER OFFLINE':session?.partnerReady?'PARTNER READY':'PARTNER CHOOSING');
    this.root.querySelector('#peer-status')!.classList.toggle('ready',paired&&!!session?.partnerReady);
    this.root.querySelector<HTMLButtonElement>('[data-action="hint"]')!.disabled=!session;
    if(!view||!session){this.root.querySelector('#outcome')!.setAttribute('hidden','');return;}
    const s=view.state,l=view.level;
    this.set('chamber',`CHAMBER ${String(l.id).padStart(2,'0')} / ${String(this.levels.length).padStart(2,'0')}`);this.set('level-name',l.name);
    this.set('turn',String(s.step).padStart(2,'0'));this.set('turn-total',`/ ${String(l.totalSteps).padStart(2,'0')}`);
    this.set('phase-name',s.step<l.weldStep?'WRITING HISTORY':s.status==='WELD_SUCCESS'?'CAUSALITY WELDED':'LOCKED REPLAY');
    this.set('phase-detail',s.step<l.weldStep?`CONVERGE AT TURN ${l.weldStep}`:`REACH BOTH EXITS AT TURN ${l.totalSteps}`);
    this.root.querySelector('#phase-led')!.className=s.status==='WELD_SUCCESS'?'welded':'';
    this.set('message',notice??s.message);
    this.root.querySelector('#preview-banner')!.toggleAttribute('hidden',view.inspecting===null);
    this.root.querySelector('#timeline')!.innerHTML=Array.from({length:l.totalSteps+1},(_,k)=>`<button data-step="${k}" ${k>=session.history.length?'disabled':''} class="${k===s.step?'current ':''}${k===l.weldStep?'weld ':''}${k<s.step?'past':''}" aria-label="Review turn ${k}"><i></i><span>${k===l.weldStep?'WELD':k}</span></button>`).join('');
    const hint=this.root.querySelector('#hint')!;
    const move=(this.player===1?l.solutionP1:l.solutionP2)[s.step];
    hint.innerHTML=`<b>REFERENCE · YOUR NEXT INPUT</b><span>P${this.player} ${arrows[move??'W']}</span><small>Reference route from the chamber start. Your current route may differ.</small>`;hint.toggleAttribute('hidden',!this.hintOpen);
    const terminal=!isLive(s.status)&&view.inspecting===null,victory=s.status==='VICTORY';
    const outcome=this.root.querySelector('#outcome')!;outcome.toggleAttribute('hidden',!terminal);outcome.classList.toggle('victory',victory);
    if(terminal){this.set('outcome-kicker',victory?'TRANSMISSION COMPLETE':'TIMELINE INTERRUPTED');this.set('outcome-title',victory?'Timeline secured.':s.status==='PARADOX_WELD'?'Causality fractured.':s.status==='LASER_DEATH'?'Signal lost.':s.status==='OUT_OF_TIME'?'Out of time.':'History obstructed.');this.set('outcome-message',s.message);this.root.querySelector('#outcome-actions')!.innerHTML=victory?`<button class="primary" data-action="${session.levelIndex<this.levels.length-1?'next':'reset'}" data-next="${session.levelIndex+1}" ${paired?'':'disabled'}>${session.levelIndex<this.levels.length-1?'Next chamber ↗':'Play again ↺'}</button>`:`<button data-action="undo" class="primary" ${paired?'':'disabled'}>↶ Undo turn</button><button data-action="reset" ${paired?'':'disabled'}>Restart chamber</button>`;}
  }
  setSound(on:boolean){this.set('sound',on?'SFX ON':'SFX OFF');}
  private set(id:string,text:string){this.root.querySelector('#'+id)!.textContent=text;}
}
