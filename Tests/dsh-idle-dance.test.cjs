const test=require('node:test'),assert=require('node:assert/strict');
const {Controller}=require('../MALFOY-ENGINE/web/live2d/dsh-idle-dance');
const media={defaultTrack:'reference',tracks:{reference:{url:'reference.m4a',duration:15},synth:{url:'synth.m4a',duration:7.5}}};
const idle={available:true,activity:'idle',key:'idle',manual:false,scene:'idle',locomotion:'idle',emotionAge:30};
function boot(play=()=>Promise.resolve()){const audio={play,pause(){this.paused=true;},currentTime:0};return {audio,c:new Controller({media,random:()=>0,createAudio:()=>audio})};}
test('rare automatic cue waits 3 minutes; quiet manual gestures pause without starving the schedule',()=>{
 const {c}=boot();assert.equal(c.tick(idle,0),null);assert.equal(c.tick({...idle,manual:true},170000),null);assert.equal(c.tick(idle,179999),null);assert.equal(c.tick(idle,180000),'start');assert.equal(c.snapshot.active,true);
});
test('audio starts only after dance video decodes, plays once, and stops at track end',()=>{
 const {c,audio}=boot();let plays=0;audio.play=()=>{plays++;return Promise.resolve();};c.request(0,true);
 c.tick({...idle,pending:'shunguai'},0);assert.equal(plays,0);c.tick({...idle,key:'shunguai',manual:true},100);assert.equal(plays,1);
 c.tick({...idle,key:'shunguai',manual:true},500);assert.equal(plays,1);assert.equal(audio.loop,false);assert.equal(c.tick({...idle,key:'shunguai',manual:true},15100),'stop');assert.equal(audio.paused,true);assert.equal(c.snapshot.active,false);
});
test('business, hidden stage, drag, reduced motion, seating and another audio source cancel immediately',()=>{
 for(const extra of [{activity:'reading'},{activity:'singing'},{speaking:true},{hidden:true},{dragging:true},{reducedMotion:true},{perched:true},{available:false},{mediaPlaying:true},{travel:true}]){
 const {c,audio}=boot();c.request(0);c.tick({...idle,key:'shunguai',manual:true},1);assert.equal(c.tick({...idle,...extra},2),'stop');assert.equal(audio.paused,true);
 }
});
test('sound and volume controls apply to current session; stop prevents late audio resumption',async()=>{
 let resolve;const {c,audio}=boot(()=>new Promise(r=>resolve=r));c.setSound(false);c.setVolume(.2);c.request(0,true);c.tick({...idle,key:'shunguai',manual:true},1);assert.equal(audio.muted,true);assert.equal(audio.volume,.2);c.setSound(true);assert.equal(audio.muted,false);c.stop(2);audio.paused=false;resolve();await new Promise(r=>setImmediate(r));assert.equal(audio.paused,true);
});
test('failed playback reports once without retry per frame; timeout and replacement gestures finish session',async()=>{
 const {c}=boot(()=>Promise.reject(Error('autoplay')));c.request(0,true);c.tick({...idle,key:'shunguai',manual:true},1);await new Promise(r=>setImmediate(r));assert.match(c.snapshot.error,/立即跳一段/);assert.equal(c.tick({...idle,key:'heart',pending:'heart',manual:true},2),'stop');c.request(10,true);assert.equal(c.tick({...idle,pending:'shunguai'},5011),'stop');
});
test('cycle rate aligns whole video loops to the original audio duration; unavailable track is rejected',()=>{const {c}=boot();assert.equal(c.rate(7.5),1);assert.equal(c.setTrack('missing',0),false);assert.equal(c.setTrack('synth',0),true);assert.equal(c.rate(7.5),1);});
test('reference source and runtime audio preserve recorded hashes and are not the old synthetic track',()=>{
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const root=path.join(__dirname,'..'),pack=path.join(root,'assets/dsh-pet-desktop-v1'),meta=JSON.parse(fs.readFileSync(path.join(pack,'special-idle.json')));
 assert.equal(meta.defaultTrack,'reference');assert.match(meta.sourceVideo.page,/7695469152915747574/);assert.ok(meta.tracks.reference.duration>14&&meta.tracks.reference.duration<16);assert.notEqual(meta.tracks.reference.sha256,meta.tracks.synth.sha256);
 for(const item of Object.values(meta.tracks))for(const dir of [pack,path.join(root,'MALFOY-ENGINE/web/live2d/dsh-motion')])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,item.file))).digest('hex'),item.sha256);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(pack,meta.sourceVideo.file))).digest('hex'),meta.sourceVideo.sha256);
});
