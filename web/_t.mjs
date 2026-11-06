const popTimes = [];
const param = () => ({ value:0, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
const node = () => ({ gain:param(), frequency:param(), Q:param(), type:"", buffer:null, loop:false, playbackRate:param(), connect(n){return n;}, start(t){ if(typeof t==='number') popTimes.push(t); }, stop(){} });
class StubAC { constructor(){ this.now=0; this.sampleRate=44100; this.destination=node(); } get currentTime(){return this.now;} createGain(){return node();} createBiquadFilter(){return node();} createBufferSource(){return node();} createBuffer(c,len){return {getChannelData:()=>new Float32Array(len),duration:len/44100};} resume(){} }
global.window = { AudioContext: StubAC };
const { FireAudio } = await import("./js/audio.js");
function run(h,v,secs){
  popTimes.length=0;
  const a=new FireAudio(); a.toggle(); a.update(v,h,false);
  for(let ms=0;ms<secs*1000;ms+=16){ a.ctx.now=ms/1000; a._tick(); }
  const ts=popTimes.filter(t=>t<=secs).sort((x,y)=>x-y);
  let minGap=Infinity; for(let i=1;i<ts.length;i++) minGap=Math.min(minGap, ts[i]-ts[i-1]);
  return { rate:(ts.length/secs).toFixed(1), minGap:(minGap*1000).toFixed(0) };
}
for(const [h,v] of [[0.08,0.5],[0.4,0.7],[0.95,0.9]]){
  const r=run(h,v,30);
  console.log(`heat ${h}, vigor ${v}: ${r.rate} pops/s, closest two pops = ${r.minGap}ms apart`);
}
