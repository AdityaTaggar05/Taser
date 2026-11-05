export class GameAudio {
  enabled=true;private context:AudioContext|null=null;
  play(kind:'step'|'shove'|'weld'|'fail'|'win') {
    if(!this.enabled)return;
    try {
      this.context??=new AudioContext();void this.context.resume();
      const notes=kind==='weld'?[220,330,440]:kind==='win'?[330,440,550,660]:kind==='fail'?[160,110]:[kind==='shove'?100:240];
      notes.forEach((freq,i)=>{const c=this.context!,o=c.createOscillator(),g=c.createGain(),at=c.currentTime+i*.09;o.type=kind==='shove'?'triangle':'sine';o.frequency.setValueAtTime(freq,at);g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.045,at+.01);g.gain.exponentialRampToValueAtTime(.001,at+.14);o.connect(g);g.connect(c.destination);o.start(at);o.stop(at+.16);});
    }catch{/* Audio is optional when the browser blocks an output device. */}
  }
}
