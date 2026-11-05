import type { LevelConfig, Direction, StepSnapshot } from '../core/types';
import { isLive } from '../core/types';
import type { GameEngine } from '../core/engine';
export interface HudActions {
  level: (index:number)=>void; undo:()=>void; reset:()=>void; fullscreen:()=>void;
  queue:(player:1|2,move:Direction)=>void; inspect:(step:number|null)=>void; theme:()=>void; sound:()=>void;
}
const arrows:Record<Direction,string> = {U:'↑',D:'↓',L:'←',R:'→',W:'·'};
export class Hud {
  readonly root=document.getElementById('hud')!;
  helpOpen=false;
  private hintOpen=false;
  constructor(private levels:LevelConfig[],private actions:HudActions) {
    this.root.innerHTML=`
      <header class="topbar">
        <div class="wordmark"><span class="mark">⌁</span> WELDPOINT<span class="edition">TEMPORAL PINCER / LOCAL CO-OP</span></div>
        <nav class="levels" aria-label="Level selector">${levels.map((l,i)=>`<button data-level="${i}" title="${l.name}" aria-label="Level ${i+1}: ${l.name}">${String(i+1).padStart(2,'0')}</button>`).join('')}<span class="level-caption">CHAMBERS</span></nav>
        <div class="utilities"><button data-action="sound" title="Toggle sound" aria-label="Toggle sound" id="sound">SFX ON</button><button data-action="theme" title="Change environment" aria-label="Change environment">◐</button><button data-action="help" title="How to play (H)" aria-label="How to play">?</button><button data-action="fullscreen" title="Fullscreen (F)" aria-label="Fullscreen">⛶</button></div>
      </header>
      <section class="mission"><div><span class="eyebrow" id="chamber"></span><h1 id="level-name"></h1></div><div class="phase"><span id="phase-led"></span><span id="phase-name"></span><small id="phase-detail"></small></div><div class="turn-count"><span>TURN</span><strong id="turn"></strong><span id="turn-total"></span></div></section>
      <div id="preview-banner" hidden>REVIEWING RECORDED HISTORY <button data-action="live">Return to live ↗</button></div>
      <footer class="console">
        <div class="timeline-row"><div class="timeline-label">TIMELINE <span id="time-direction">0 → 8</span></div><div id="timeline" class="timeline" aria-label="Recorded turn history"></div><div class="history-actions"><button data-action="undo" id="undo" title="Undo (Backspace / Z)">↶ <span>Undo</span></button><button data-action="reset" title="Reset (R)">↺ <span>Reset</span></button><button data-action="hint" title="Show reference inputs">Hint</button></div></div>
        <div class="controls-row"><div class="operator p1"><span class="operator-label">P1 <small>WASD</small></span><div class="dpad" aria-label="Player 1 moves">${this.pad(1)}</div><span class="queued" id="queue1">CHOOSE MOVE</span></div><div class="transmission" role="status" aria-live="polite"><span class="status-dot"></span><span id="message"></span></div><div class="operator p2"><span class="queued" id="queue2">CHOOSE MOVE</span><div class="dpad" aria-label="Player 2 moves">${this.pad(2)}</div><span class="operator-label">P2 <small>ARROWS</small></span></div></div>
      </footer>
      <div id="hint" class="hint" hidden></div>
      <div id="outcome" class="outcome" hidden><span id="outcome-kicker"></span><h2 id="outcome-title"></h2><p id="outcome-message"></p><div id="outcome-actions"></div></div>
      <div id="help" class="modal" hidden><section role="dialog" aria-modal="true" aria-labelledby="help-title"><span class="eyebrow">OPERATOR FIELD GUIDE</span><h2 id="help-title">Write the past.<br/>Survive its future.</h2><p>Two operators. One room. Opposite ends of time.</p><ol><li><strong>WRITE · Turns 1–4</strong>Coordinate box positions with your partner. A shove moves the box while you stay put.</li><li><strong>WELD · Turn 4</strong>Every box must meet its matching identity on both boards. Each operator sees only their own boxes and objectives. Weld positions are unmarked.</li><li><strong>REPLAY · Turns 5–8</strong>Boxes follow your partner’s history in reverse. Dotted lines show the next position. Keep clear and reach both open exits on turn 8.</li></ol><p class="help-keys"><b>P1</b> WASD · Space to wait<br/><b>P2</b> Arrow keys · Enter to wait<br/><b>Both inputs commit a turn.</b> Change your input until your partner queues theirs.<br/>Backspace / Z: undo · R: reset · F: fullscreen</p><button data-action="close-help" class="primary">Return to chamber ↗</button></section></div>`;
    this.root.addEventListener('click',e=>{
      const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;if((e as MouseEvent).detail>0)b.blur();
      if(b.dataset.level!==undefined){this.hintOpen=false;actions.level(Number(b.dataset.level));return;}
      if(b.dataset.move){actions.queue(Number(b.dataset.player) as 1|2,b.dataset.move as Direction);return;}
      if(b.dataset.step!==undefined){actions.inspect(Number(b.dataset.step));return;}
      const action=b.dataset.action;
      if(action==='help'||action==='close-help'){this.toggleHelp();return;}
      if(action==='hint'){this.hintOpen=!this.hintOpen;this.root.querySelector('#hint')!.toggleAttribute('hidden',!this.hintOpen);return;}
      if(action==='live'){actions.inspect(null);return;}
      if(action==='next'){actions.level(Number(b.dataset.next));return;}
      if(action&&action in actions)(actions[action as keyof HudActions] as ()=>void)();
    });
  }
  private pad(player:1|2){return (['L','U','D','R','W'] as Direction[]).map(d=>`<button data-player="${player}" data-move="${d}" aria-label="Player ${player} ${d==='W'?'wait':{L:'left',U:'up',D:'down',R:'right'}[d]}" title="${d==='W'?(player===1?'Space':'Enter'):'Move '+d}">${d==='W'?'WAIT':arrows[d]}</button>`).join('');}
  toggleHelp(force?:boolean){this.helpOpen=force??!this.helpOpen;this.root.querySelector('#help')!.toggleAttribute('hidden',!this.helpOpen);if(this.helpOpen)this.root.querySelector<HTMLButtonElement>('[data-action="close-help"]')!.focus();}
  render(engine:GameEngine,index:number,pending:[Direction|null,Direction|null],inspecting:number|null,completed:Set<number>,selectionNotice:string|null=null){
    const s=inspecting===null?engine.state:engine.stateStack[inspecting],l=engine.level;
    this.set('chamber',`CHAMBER ${String(l.id).padStart(2,'0')} / ${String(this.levels.length).padStart(2,'0')}`);this.set('level-name',l.name);
    this.set('turn',String(s.step).padStart(2,'0'));this.set('turn-total',`/ ${String(l.totalSteps).padStart(2,'0')}`);
    const phase=s.step<l.weldStep?'WRITING HISTORY':s.step===l.weldStep&&s.status==='WELD_SUCCESS'?'CAUSALITY WELDED':s.step>=l.weldStep?'LOCKED REPLAY':'WRITING HISTORY';
    this.set('phase-name',phase);this.set('phase-detail',s.step<l.weldStep?`CONVERGE AT TURN ${l.weldStep}`:`REACH BOTH EXITS AT TURN ${l.totalSteps}`);
    this.root.querySelector('#phase-led')!.className=s.status==='WELD_SUCCESS'?'welded':'';
    this.set('message',selectionNotice??s.message);
    this.root.querySelector('#preview-banner')!.toggleAttribute('hidden',inspecting===null);
    this.root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b,i)=>{b.classList.toggle('active',i===index);b.classList.toggle('completed',completed.has(this.levels[i].id));b.setAttribute('aria-current',i===index?'true':'false');});
    for(const player of [1,2] as const){const q=pending[player-1];this.set(`queue${player}`,q?`${arrows[q]} ${q==='W'?'WAIT':'QUEUED'}`:'CHOOSE MOVE');this.root.querySelector(`#queue${player}`)!.classList.toggle('ready',q!==null);}
    this.root.querySelector<HTMLButtonElement>('#undo')!.disabled=s.step===0;
    this.root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b=>{
      const error=engine.selectionError(Number(b.dataset.player) as 1|2,b.dataset.move as Direction);
      b.disabled=!isLive(s.status)||inspecting!==null||error!==null;
      b.title=error??(b.dataset.move==='W'?(b.dataset.player==='1'?'Space':'Enter'):'Move '+b.dataset.move);
      b.classList.toggle('selected',pending[Number(b.dataset.player)-1]===b.dataset.move);
    });
    const weld=l.weldStep;
    this.root.querySelector('#timeline')!.innerHTML=Array.from({length:l.totalSteps+1},(_,k)=>`<button data-step="${k}" ${k>engine.stateStack.length-1?'disabled':''} class="${k===s.step?'current ':''}${k===weld?'weld ':''}${k<s.step?'past':''}" title="${k===weld?'Midpoint weld':'Review turn '+k}" aria-label="Review turn ${k}" ${k===s.step?'aria-current="step"':''}><i></i><span>${k===weld?'WELD':k}</span></button>`).join('');
    const hint=this.root.querySelector('#hint')!;
    const onPath=engine.stateStack.every((state,k)=>k===0||JSON.stringify([state.p1Pos,state.p2Pos,state.boxesP1,state.boxesP2])===JSON.stringify(this.referenceState(l,k)));
    hint.innerHTML=`<b>REFERENCE · TURN ${Math.min(s.step+1,l.totalSteps)}</b><span>P1 ${arrows[l.solutionP1[s.step]??'W']} &nbsp; P2 ${arrows[l.solutionP2[s.step]??'W']}</span><small>${onPath?'Follow the paired inputs to learn this chamber.':'Your route differs. Undo or reset to follow the reference from the start.'}</small>`;
    hint.toggleAttribute('hidden',!this.hintOpen);
    const terminal=!isLive(s.status)&&inspecting===null, victory=s.status==='VICTORY';
    const outcome=this.root.querySelector('#outcome')!;outcome.toggleAttribute('hidden',!terminal);outcome.classList.toggle('victory',victory);
    if(terminal){this.set('outcome-kicker',victory?'TRANSMISSION COMPLETE':'TIMELINE INTERRUPTED');this.set('outcome-title',victory?'Timeline secured.':s.status==='PARADOX_WELD'?'Causality fractured.':s.status==='LASER_DEATH'?'Signal lost.':s.status==='OUT_OF_TIME'?'Out of time.':'History obstructed.');this.set('outcome-message',s.message);this.root.querySelector('#outcome-actions')!.innerHTML= victory ? `<button class="primary" data-action="${index<this.levels.length-1?'next':'reset'}" data-next="${index+1}">${index<this.levels.length-1?'Next chamber ↗':'Play again ↺'}</button>${index===this.levels.length-1?'<small>All five chambers complete.</small>':''}`:'<button data-action="undo" class="primary">↶ Undo turn</button><button data-action="reset">Restart chamber</button>';}
  }
  private referenceCache=new Map<number,unknown[][]>();
  private referenceState(l:LevelConfig,k:number): unknown[] {return this.referenceCache.get(l.id)?.[k]??[];}
  setReferences(id:number,states:StepSnapshot[]){this.referenceCache.set(id,states.map(s=>[s.p1Pos,s.p2Pos,s.boxesP1,s.boxesP2]));}
  setSound(on:boolean){this.set('sound',on?'SFX ON':'SFX OFF');}
  private set(id:string,text:string){this.root.querySelector('#'+id)!.textContent=text;}
}
