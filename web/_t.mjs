let starts = 0;
const param = () => ({ value: 0, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
const node = () => ({ gain: param(), frequency: param(), Q: param(), type:"", buffer:null, loop:false, playbackRate: param(), connect(n){return n;}, start(){ starts++; }, stop(){} });
class StubAC {
  constructor(){ this.now=0; this.sampleRate=44100; this.destination=node(); }
  get currentTime(){ return this.now; }
  createGain(){ return node(); } createBiquadFilter(){ return node(); } createBufferSource(){ return node(); }
  createBuffer(c,len){ return { getChannelData:()=>new Float32Array(len), duration: len/44100 }; }
  resume(){}
}
global.window = { AudioContext: StubAC };
const { FireAudio } = await import("./js/audio.js");
function run(heat, vigor, secs){
  starts = 0;
  const a = new FireAudio(); a.toggle();          // init+enable (1 bed start)
  const ctx = a.ctx;
  a.update(vigor, heat, false);
  const bedStarts = starts;                        // account for bed source
  for (let ms=0; ms<secs*1000; ms+=16){ ctx.now = ms/1000; a._tick(); }
  const pops = starts - bedStarts;
  return (pops/secs).toFixed(1);
}
console.log("pops/sec at vigor 0.8:");
for (const h of [0.08, 0.3, 0.6, 0.95]) console.log(`  heat ${h}: ${run(h, 0.8, 12)} pops/s`);
console.log("pops/sec at heat 0.6, varying vigor (rate should rise some):");
for (const v of [0.2, 0.6, 1.0]) console.log(`  vigor ${v}: ${run(0.6, v, 12)} pops/s`);
