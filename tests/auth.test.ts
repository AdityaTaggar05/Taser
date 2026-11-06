import {it,expect} from 'vitest';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthService} from '../server/auth/AuthService';
import {authFixture} from './authFixture';

it('requires credentials, isolates tab sessions, and issues one-use tickets revoked on logout',async()=>{
  const f=await authFixture();try{
    const a=f.browser(),b=f.browser();
    expect((await a.request('session')).data.user).toBeNull();expect((await a.request('socket-ticket',{})).status).toBe(401);
    expect((await a.request('demo',{username:'atlas',password:'wrong'})).status).toBe(401);
    const signed=await a.login();expect(signed.status).toBe(200);expect(signed.data.user.displayName).toBe('Atlas');
    const setCookie=signed.headers.getSetCookie().join(';');expect(setCookie).toContain('HttpOnly');expect(setCookie).toContain('SameSite=Strict');expect(setCookie).toContain(`/api/auth/${a.context}`);
    expect((await b.request('session')).data.user).toBeNull();await b.login('nova');
    expect((await a.request('session')).data.user.displayName).toBe('Atlas');expect((await b.request('session')).data.user.displayName).toBe('Nova');
    const ticket=await a.ticket(),identity=f.auth.consumeTicket(ticket)!;expect(identity.user.displayName).toBe('Atlas');expect(f.auth.consumeTicket(ticket)).toBeNull();
    const revoked=await a.ticket();await a.request('logout',{});expect(f.auth.isActive(identity.key)).toBe(false);expect(f.auth.consumeTicket(revoked)).toBeNull();
    expect((await a.request('session')).data.user).toBeNull();expect((await b.request('session')).data.user.displayName).toBe('Nova');
  }finally{await f.close();}
});
it('does not enable development accounts by default',async()=>{
  const f=await authFixture({demoEnabled:false});try{const a=f.browser();expect((await a.request('session')).data.demoEnabled).toBe(false);expect((await a.login()).status).toBe(404);}finally{await f.close();}
});
it('binds SIWE to the site and nonce, verifies the signature, rejects replay and returns a stable identity',async()=>{
  const f=await authFixture();try{
    const a=f.browser(),wallet=privateKeyToAccount(generatePrivateKey());
    async function signIn(){const response=await a.request('challenge',{address:wallet.address,chainId:1});expect(response.status).toBe(200);const message=response.data.message as string;expect(message).toContain(new URL(f.origin).host+' wants you to sign in');expect(message).toContain('URI: '+f.origin);const signature=await wallet.signMessage({message});return {response:await a.request('wallet',{signature}),signature};}
    const first=await signIn();expect(first.response.status).toBe(200);expect(first.response.data.user.walletAddress).toBe(wallet.address.toLowerCase());expect(first.response.data.user.kind).toBe('wallet');
    expect((await a.request('wallet',{signature:first.signature})).status).toBe(401);
    await a.request('logout',{});const second=await signIn();expect(second.response.data.user.id).toBe(first.response.data.user.id);
    const challenge=await a.request('challenge',{address:wallet.address,chainId:1});const wrong=privateKeyToAccount(generatePrivateKey());expect((await a.request('wallet',{signature:await wrong.signMessage({message:challenge.data.message})})).status).toBe(401);
    expect((await a.request('challenge',{address:wallet.address,chainId:1},{Origin:'https://other.example'})).status).toBe(403);
    expect((await a.request('logout',{}, {Origin:''})).status).toBe(403);
  }finally{await f.close();}
});
it('expires wallet challenges, sessions and tickets on server time',async()=>{
  let now=Date.now();const f=await authFixture({now:()=>now});try{
    const a=f.browser();await a.login();const ticket=await a.ticket();now+=30_001;expect(f.auth.consumeTicket(ticket)).toBeNull();
    const wallet=privateKeyToAccount(generatePrivateKey()),challenge=await a.request('challenge',{address:wallet.address,chainId:1});now+=5*60_000+1;
    expect((await a.request('wallet',{signature:await wallet.signMessage({message:challenge.data.message})})).status).toBe(401);
    now+=24*60*60_000;expect((await a.request('session')).data.user).toBeNull();expect((await a.request('socket-ticket',{})).status).toBe(401);
  }finally{await f.close();}
});
it('persists account progress, hashes session tokens and never accepts client completion claims',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'weldpoint-auth-')),path=join(dir,'accounts.sqlite');const f=await authFixture({databasePath:path});let id='';
  try{const a=f.browser(),login=await a.login();id=login.data.user.id;expect((await a.request('session',{completed:[1,2,3]})).status).toBe(404);expect((await a.request('session')).data.user.completed).toEqual([]);f.auth.recordCompletion([id],2);f.auth.recordCompletion([id],2);expect((await a.request('session')).data.user.completed).toEqual([2]);expect(f.auth.isActive(a.cookies.get('weldpoint_session')!)).toBe(false);}finally{await f.close();}
  try{const restored=new AuthService({databasePath:path});try{expect(restored.profile(id)?.completed).toEqual([2]);}finally{restored.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
it('rejects oversized payloads and rate limits repeated credentials',async()=>{
  const f=await authFixture();try{const a=f.browser();expect((await a.request('demo',{password:'x'.repeat(9000)})).status).toBe(413);for(let n=0;n<12;n++)await a.request('demo',{username:'invalid',password:'x'});expect((await a.login()).status).toBe(429);}finally{await f.close();}
});
it('does not restore previously signed-in demo sessions when demo authentication is disabled',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'weldpoint-demo-disabled-')),path=join(dir,'accounts.sqlite');const enabled=await authFixture({databasePath:path});let sessionKey='';
  try{const account=enabled.browser();await account.login();sessionKey=enabled.auth.consumeTicket(await account.ticket())!.key;expect(enabled.auth.isActive(sessionKey)).toBe(true);}finally{await enabled.close();}
  try{const production=new AuthService({databasePath:path,demoEnabled:false});try{expect(production.isActive(sessionKey)).toBe(false);}finally{production.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
