import './home.css';
import {profileLabel} from '../auth/AuthClient';
import type {PlayerProfile} from '../auth/types';
interface HomeActions { play:()=>void;solo:()=>void; create:()=>void; community:()=>void; sound:()=>void; theme:()=>void; fullscreen:()=>void; logout:()=>Promise<void> }
export class HomeScreen {
  readonly root=document.createElement('main');
  constructor(private actions:HomeActions){
    this.root.id='home';
    this.root.innerHTML=`
      <header class="home-top"><a href="#" class="home-brand" aria-label="WeldPoint home"><span>⌁</span> WELDPOINT</a><button class="home-guest home-account" data-home-action="profile" aria-label="Open your profile"><span class="guest-avatar" aria-hidden="true">◇</span><span><b id="home-account-name"></b><small>Operator profile ↗</small></span></button></header>
      <section class="home-content" aria-labelledby="home-title"><div class="home-kicker"><span></span> A TEMPORAL CO-OP PUZZLE</div><h1 id="home-title">WELD<span>POINT<span class="title-period">.</span></span></h1><p class="home-tagline">Your past.<br/>Their way forward.</p><p class="home-description">Meet in the middle of time.<br/>Make it out together.</p>
      <nav class="home-menu" aria-label="Main menu"><div class="home-mode-buttons"><button class="home-play" data-home-action="play"><span><small>01 / ENTER THE TIMELINE</small>Play co-op</span><span class="play-arrow" aria-hidden="true">↗</span></button><button class="home-play home-solo" data-home-action="solo"><span><small>02 / FOLLOW AN ECHO</small>Play solo</span><span class="play-arrow" aria-hidden="true">↗</span></button></div><button class="home-browse" data-home-action="community">Published levels <span>Browse chambers ↗</span></button><div class="home-secondary"><button data-home-action="create">Level creator <span>＋</span></button><button data-home-action="guide">How to play <span>↗</span></button><button data-home-action="settings">Settings <span>＋</span></button></div></nav><p class="home-session-note">A live partner or a recorded echo · One timeline</p></section>
      <div class="home-art-label art-label-top" aria-hidden="true"><span>01 / FORWARD</span><i>t = 0 →</i></div><div class="home-art-label art-label-bottom" aria-hidden="true"><span>02 / REVERSE</span><i>← t = 8</i></div>
      <footer class="home-footer"><span>COOPERATE ACROSS TIME</span><span id="home-progress">00 / 05 CHAMBERS SECURED</span><button data-home-action="fullscreen" aria-label="Fullscreen">⛶ <span>FULLSCREEN</span></button></footer>
      <dialog class="home-dialog" id="home-guide" aria-labelledby="home-guide-title"><button class="dialog-close" data-home-action="close" aria-label="Close guide">×</button><span class="home-kicker">OPERATOR FIELD GUIDE</span><h2 id="home-guide-title">Two perspectives.<br/>One way home.</h2><p>Choose Co-op to host a private party: share its invite link or code, both confirm Ready, then the host starts. Choose Solo to play alongside a fixed creator solution or a winning player run. Each operator sees only their own timeline.</p><ol><li><b>01 / WRITE HISTORY</b>Move boxes into position. Shoving a box moves it while your operator stays put.</li><li><b>02 / MEET IN THE MIDDLE</b>At the midpoint, matching boxes must meet. Some chambers also require unmarked fixed positions.</li><li><b>03 / SURVIVE THE REPLAY</b>Your boxes retrace your partner’s history. Keep clear and reach both open exits together before time expires.</li></ol><div class="guide-keys"><span>MOVE <kbd>WASD</kbd> / <kbd>↑↓←→</kbd></span><span>WAIT <kbd>SPACE</kbd> / <kbd>ENTER</kbd></span><span>UNDO <kbd>Z</kbd> / <kbd>BACKSPACE</kbd></span></div><p class="guide-note">A turn happens only after both players choose a move. Talk to your partner. Experiment. Undo as often as you need.</p><button class="home-dialog-primary" data-home-action="close">Got it ↗</button></dialog>
      <dialog class="home-dialog" id="home-profile" aria-labelledby="profile-title"><button class="dialog-close" data-home-action="close" aria-label="Close profile">×</button><span class="home-kicker">OPERATOR PROFILE</span><h2 id="profile-title" class="profile-name"></h2><p id="profile-kind"></p><p id="profile-address" class="profile-address"></p><p id="profile-progress"></p><p id="profile-status" class="profile-status" role="status"></p><button class="home-dialog-primary profile-logout" data-home-action="logout">Sign out ↗</button></dialog><dialog class="home-dialog settings-dialog" id="home-settings" aria-labelledby="home-settings-title"><button class="dialog-close" data-home-action="close" aria-label="Close settings">×</button><span class="home-kicker">OPERATOR PREFERENCES</span><h2 id="home-settings-title">Set the atmosphere.</h2><button class="setting-row" data-home-action="sound"><span>Sound effects<small>Movement, welding & transmissions</small></span><b id="home-sound">ON</b></button><button class="setting-row" data-home-action="theme"><span>Environment<small>Choose the look of your chamber</small></span><b id="home-environment">FOUNDRY</b></button><button class="setting-row" data-home-action="fullscreen"><span>Fullscreen<small>Enter or leave fullscreen mode</small></span><b>⛶</b></button><button class="home-dialog-primary" data-home-action="close">Back to the timeline ↗</button></dialog>`;
    document.body.append(this.root);
    this.root.addEventListener('click',e=>{
      const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-home-action]');if(!button)return;
      const action=button.dataset.homeAction;
      if(action==='guide'||action==='settings'||action==='profile'){this.root.querySelector<HTMLDialogElement>(`#home-${action}`)!.showModal();return;}
      if(action==='close'){button.closest('dialog')?.close();return;}
      if(action==='logout'){button.disabled=true;void this.actions.logout().catch(()=>{this.root.querySelector('#profile-status')!.textContent='Could not sign out. Check your connection and retry.';}).finally(()=>{button.disabled=false;});return;}
      if(action&&action in this.actions)(this.actions[action as keyof HomeActions])();
    });
    this.root.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
  }
  get dialogOpen(){return !!this.root.querySelector('dialog[open]');}
  show(show:boolean){this.root.hidden=!show;if(!show)this.root.querySelectorAll('dialog[open]').forEach(d=>(d as HTMLDialogElement).close());}
  update(sound:boolean,environment:string,completed:number,total:number,user:PlayerProfile|null){
    if(user){
      this.root.querySelector('#home-account-name')!.textContent=profileLabel(user);
      this.root.querySelector('#profile-title')!.textContent=profileLabel(user);
      this.root.querySelector('#profile-kind')!.textContent=user.kind==='demo'?'Development account':'Ethereum account';
      this.root.querySelector('#profile-address')!.textContent=user.walletAddress??'Demo operator · for playtesting';
      this.root.querySelector('#profile-progress')!.textContent=`${completed} of ${total} chambers secured. Progress is saved to your account.`;
    }
    this.root.querySelector('#home-sound')!.textContent=sound?'ON':'OFF';
    this.root.querySelector('#home-environment')!.textContent=environment.toUpperCase();
    this.root.querySelector('#home-progress')!.textContent=`${String(completed).padStart(2,'0')} / ${String(total).padStart(2,'0')} CHAMBERS SECURED`;
  }
}
