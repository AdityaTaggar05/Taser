import {describe,it,expect} from 'vitest';
import raw from '../public/themes/modern-gray/manifest.json';
import {validateTheme,validateDeployment,spriteUrl,REQUIRED_ANIMATIONS} from '../src/assets/schema';
const copy=()=>structuredClone(raw);
const deployment={reference:null,gateway:'https://gateway.example',verifiedAt:null,manifestSha256:null};
describe('theme contract',()=>{
  it('contains every approved player sequence and gameplay/UI role',()=>{
    const pack=validateTheme(copy());expect(Object.keys(pack.sheets)).toHaveLength(28);expect(Object.keys(pack.sprites)).toHaveLength(556);
    expect(REQUIRED_ANIMATIONS).toHaveLength(74);expect(pack.presentation.boxIdentityLabels).toBe(false);expect(pack.animations['fx.weld'].visibility).toBe('after-success-only');
  });
  it('rejects missing roles, frame overflow, path traversal and malformed animation',()=>{
    const a=copy();delete (a.sprites as Record<string,unknown>)['exit.p1.open'];expect(()=>validateTheme(a)).toThrow(/missing/);
    const b=copy();b.sprites['tile.floor'].frame.x=99999;expect(()=>validateTheme(b)).toThrow(/bounds/);
    const c=copy();c.sheets['02-environment-tiles'].file='../../.env.local';expect(()=>validateTheme(c)).toThrow(/sheet/);
    const d=copy();delete (d.animations as Record<string,unknown>)['player.p2.walk.north'];expect(()=>validateTheme(d)).toThrow(/missing animation/);
    const e=copy();(e.animations['fx.weld'] as {visibility:string}).visibility='before';expect(()=>validateTheme(e)).toThrow(/visibility/);
  });
  it('resolves all sheets from the immutable Swarm collection when configured',()=>{
    const m=validateTheme(copy()),d={...deployment,reference:'a'.repeat(64)};
    for(const sheet of Object.keys(m.sheets))expect(spriteUrl(m,d,sheet)).toBe(`https://gateway.example/bzz/${d.reference}/${m.sheets[sheet].file}`);
    expect(spriteUrl(m,deployment,'01-crates-and-mirrors')).toMatch(/^\/themes\/modern-gray\//);
    expect(()=>validateDeployment({...d,gateway:'https://secret:password@example.com'})).toThrow();
    expect(()=>validateDeployment({...d,reference:'invalid'})).toThrow();
  });
});
