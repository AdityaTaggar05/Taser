import {expect,it} from 'vitest';
import {parseConfig} from '../cre/workflow/config';

const local={mode:'local-simulation',apiBase:'http://127.0.0.1:5185',authorizedKeys:[]};
it('keeps receiver-free rehearsal closed against write-capable configuration',()=>{
  expect(parseConfig(local).mode).toBe('local-simulation');
  expect(()=>parseConfig({...local,registry:'0x1111111111111111111111111111111111111111'})).toThrow('Unexpected');
  expect(()=>parseConfig({...local,mode:'unknown'})).toThrow('Unknown');
  expect(()=>parseConfig({...local,apiBase:'http://remote.example'})).toThrow('HTTPS');
  expect(()=>parseConfig({...local,apiBase:'https://example.com/@evil'})).toThrow('HTTPS');
});
it('requires an actual registry and authenticated HTTP trigger for DON execution',()=>{
  const live={mode:'don',apiBase:'https://taser.example',registry:'0x1111111111111111111111111111111111111111',authorizedKeys:[{type:'KEY_TYPE_ECDSA_EVM',publicKey:'0x2222222222222222222222222222222222222222'}]};
  expect(parseConfig(live).mode).toBe('don');
  expect(()=>parseConfig({...live,authorizedKeys:[]})).toThrow('authorized');
  expect(()=>parseConfig({...live,registry:'0x0000000000000000000000000000000000000000'})).toThrow('nonzero');
  expect(()=>parseConfig({...live,apiBase:'http://localhost:5173'})).toThrow('HTTPS');
});
