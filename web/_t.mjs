const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}});
let starts=0;
const node=()=>({gain:param(),frequency:param(),Q:param(),type:"",buffer:null,loop:false,playbackRate:param(),connect(n){return n;},start(t){if(typeof t==='number')starts++;},stop(){}});
class StubAC{constructor(){this.now=0;this.sampleRate=44100;this.destination=node();}get currentTime(){return this.now;}createGain(){return node();}createBiquadFilter(){return node();}createBufferSource(){return node();}createBuffer(c,len){return{getChannelData:()=>new Float32Array(len),duration:len/44100};}resume(){}}
global.window={AudioContext:StubAC};
const {FireAudio}=await import("./js/audio.js");
function run(mode,{pieceRate=0,heat=0,vigor=0.6,up=0,done=false},secs=20){
  starts=0; const a=new FireAudio(mode); a.toggle();
  const bed=starts;
  for(let ms=0;ms<secs*1000;ms+=16){a.ctx.now=ms/1000; a.update(vigor,heat,done,{pieceRate,upPeers:up}); a._tick();}
  return ((starts-bed)/secs).toFixed(1);
}
console.log("pieces mode (heat ignored, tracks pieceRate):");
console.log("  pieceRate 1:", run("pieces",{pieceRate:1,heat:0.1}),"ev/s");
console.log("  pieceRate 4:", run("pieces",{pieceRate:4,heat:0.1}),"ev/s");
console.log("  pieceRate 0 (done, nothing arriving):", run("pieces",{pieceRate:0,heat:0.9,done:true}),"ev/s  (want ~0)");
console.log("aesthetic mode (tracks heat):");
console.log("  heat 0.1:", run("aesthetic",{heat:0.1}),"ev/s");
console.log("  heat 0.9:", run("aesthetic",{heat:0.9}),"ev/s");
console.log("events mode, seeding (pops + exhales):");
console.log("  pieceRate 2, up 5:", run("events",{pieceRate:2,up:5}),"ev/s  (crackles + whooshes)");
