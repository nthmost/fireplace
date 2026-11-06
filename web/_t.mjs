const param = () => ({ value: 0, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
const node = () => ({ gain: param(), frequency: param(), Q: param(), type:"", buffer:null, loop:false, playbackRate: param(), connect(n){return n;}, start(){}, stop(){} });
class StubAC { constructor(){ this.now=0; this.sampleRate=44100; this.destination=node(); } get currentTime(){return this.now;} createGain(){return node();} createBiquadFilter(){return node();} createBufferSource(){return node();} createBuffer(c,len){return {getChannelData:()=>new Float32Array(len),duration:len/44100};} resume(){} }
global.window = { AudioContext: StubAC };
const { FireAudio } = await import("./js/audio.js");
const a = new FireAudio(); a.toggle(); a.update(0.9,0.9,false);
for(let ms=0;ms<3000;ms+=16){ a.ctx.now=ms/1000; a._tick(); }
console.log("reworked pop paths ran without error; crackleBus gain:", a.crackleBus.gain.value);
