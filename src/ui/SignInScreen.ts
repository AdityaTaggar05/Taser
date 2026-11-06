import type {AuthClient} from '../auth/AuthClient';
import './auth.css';
export class SignInScreen {
  readonly root=document.createElement('main');
  private busy=false;
  constructor(private auth:AuthClient){
    this.root.id='signin';
    this.root.innerHTML=`<a class="home-brand signin-brand" href="#"><span>⌁</span> WELDPOINT</a><section class="signin-panel" aria-labelledby="signin-title"><div class="home-kicker"><span></span> TWO OPERATORS. ONE TIMELINE.</div><h1 id="signin-title">Every timeline<br/>starts with you.</h1><p class="signin-intro">Sign in to enter the chambers.<br/>Your progress stays with your account.</p><button class="signin-wallet home-play" type="button"><span><small>YOUR WALLET. YOUR OPERATOR.</small>Sign in with Ethereum</span><span aria-hidden="true">↗</span></button><p class="signin-wallet-note">A signature to sign in. No transaction or gas required.</p><form class="demo-form" hidden><div class="signin-divider">DEVELOPMENT ACCOUNTS</div><div class="demo-choices"><button type="button" data-demo="atlas">Use Atlas</button><button type="button" data-demo="nova">Use Nova</button></div><label for="demo-username">Username</label><input id="demo-username" name="username" autocomplete="username" required maxlength="50"/><label for="demo-password">Password</label><input id="demo-password" name="password" type="password" autocomplete="current-password" required maxlength="200"/><button class="home-dialog-primary" type="submit">Sign in ↗</button></form><p class="signin-status" role="status" aria-live="polite"></p><button class="signin-retry" type="button" hidden>Retry connection ↗</button></section><footer class="signin-footer">COOPERATE ACROSS TIME</footer>`;
    document.body.append(this.root);
    this.root.querySelector('.signin-wallet')!.addEventListener('click',()=>void this.run(()=>auth.wallet()));
    this.root.querySelector('.signin-retry')!.addEventListener('click',()=>void this.run(()=>auth.refresh()));
    this.root.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget as HTMLFormElement;const data=new FormData(form);void this.run(()=>auth.demo(String(data.get('username')),String(data.get('password'))));});
    this.root.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach(button=>button.addEventListener('click',()=>{
      const name=button.dataset.demo!;(this.root.querySelector('#demo-username') as HTMLInputElement).value=name;
      (this.root.querySelector('#demo-password') as HTMLInputElement).value=name==='atlas'?'Atlas@WeldPoint26!':'Nova@WeldPoint26!';
      this.root.querySelector<HTMLInputElement>('#demo-password')!.focus();
    }));
  }
  private async run(action:()=>Promise<void>){
    if(this.busy)return;this.busy=true;this.message('Waiting for sign-in…');this.disable();
    try{await action();this.message(this.auth.error??'');if(this.auth.user)(this.root.querySelector('form') as HTMLFormElement).reset();}
    catch(error){const code=(error as {code?:number}).code;this.message(code===4001?'Signature cancelled. You can try again.':error instanceof Error?error.message:'Sign-in failed. Please try again.');}
    finally{this.busy=false;this.disable();}
  }
  private message(value:string){this.root.querySelector('.signin-status')!.textContent=value;}
  private disable(){this.root.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(el=>el.disabled=this.busy||!this.auth.ready);}
  update(){
    this.root.hidden=!!this.auth.user;
    (this.root.querySelector('form') as HTMLFormElement).hidden=!this.auth.state.demoEnabled;
    (this.root.querySelector('.signin-retry') as HTMLButtonElement).hidden=!this.auth.error;
    if(!this.busy)this.message(!this.auth.ready?'Restoring your session…':this.auth.error??'');
    this.disable();
  }
}
