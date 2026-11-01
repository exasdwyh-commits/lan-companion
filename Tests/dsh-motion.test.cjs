const test=require('node:test');
const assert=require('node:assert/strict');
const {Player,semantic}=require('../MALFOY-ENGINE/web/live2d/dsh-motion');
class Video{constructor(){this.style={};this.paused=true;}load(){}pause(){this.paused=true;}play(){this.paused=false;return Promise.resolve();}}
const flush=()=>new Promise(r=>setImmediate(r));
function boot(){const videos=[];const p=new Player({container:{append(){}},createVideo:()=>{const v=new Video;videos.push(v);return v;}});return {p,videos};}
test('late decoded load cannot replace a newer requested action',async()=>{const {p,videos}=boot();const late=videos[1].onloadeddata;p.play('dance');const next=videos[1].onloadeddata;late();await flush();assert.equal(p.ready,false);next();await flush();assert.equal(p.key,'dance');assert.equal(p.pending,null);});
test('previous decoded buffer stays visible until the new buffer is playing',async()=>{const {p,videos}=boot();videos[1].onloadeddata();await flush();p.play('wave');assert.equal(videos[1].style.opacity,'1');assert.equal(videos[0].style.opacity,'0');videos[0].onloadeddata();await flush();assert.equal(videos[1].style.opacity,'0');assert.equal(videos[1].paused,true);assert.equal(p.key,'wave');});
test('sleep enters, loops, wakes; cancelled sleep completion cannot restore sleeping',async()=>{const {p,videos}=boot();videos[1].onloadeddata();await flush();p.sleep();videos[0].onloadeddata();await flush();const oldEnded=videos[0].onended;oldEnded();videos[1].onloadeddata();await flush();assert.equal(p.key,'sleep');assert.equal(videos[1].loop,true);p.wake();oldEnded();assert.equal(p.pending,'wake');videos[0].onloadeddata();await flush();videos[0].onended();assert.equal(p.pending,'idle');assert.equal(p.sleeping,false);});
test('drag interrupts manual actions and ongoing sleep, and work/reading map to real motion files',async()=>{const {p}=boot();p.sleep();p.tick({dragging:true});assert.equal(p.pending,'drag');assert.equal(p.sleeping,false);assert.equal(semantic({scene:'working'}),'working');assert.equal(semantic({scene:'reading'}),'reading');});
test('both packaged copies preserve all source hashes and noncommercial notices',()=>{const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const root=path.join(__dirname,'..'),source=path.join(root,'assets/dsh-pet-desktop-v1'),web=path.join(root,'MALFOY-ENGINE/web/live2d/dsh-motion');const m=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));const c=require('../MALFOY-ENGINE/web/live2d/dsh-catalog');assert.equal(Object.keys(m.actions).length,128);assert.equal(Object.keys(c).length,125);for(const key of Object.keys(c))assert.ok(m.actions[key],key);for(const item of Object.values(m.actions)){for(const dir of [source,web])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,item.file))).digest('hex'),item.sha256);}assert.match(fs.readFileSync(path.join(web,'NOTICE.md'),'utf8'),/CC BY-NC-SA 4.0/);});

test('business state takes body priority over walking and a manual gesture',async()=>{
 const {p,videos}=boot();videos[1].onloadeddata();await flush();p.play('dance');p.tick({activity:'reading',scene:'happy',locomotion:'walk'});assert.equal(p.manual,false);assert.equal(p.pending,'reading');
 assert.equal(semantic({scene:'singing'}),'singing');assert.equal(semantic({scene:'speaking'}),'chat');assert.equal(semantic({scene:'idle',perched:true}),'sit');assert.equal(semantic({dragging:true,activity:'reading'}),'drag');
});
test('automatic finite reaction can be requested again after returning idle',async()=>{
 const {p,videos}=boot();videos[1].onloadeddata();await flush();p.tick({scene:'happy'});videos[0].onloadeddata();await flush();videos[0].onended();assert.equal(p.lastAuto,null);videos[1].onloadeddata();await flush();p.tick({scene:'happy'});assert.equal(p.pending,'happy');
});
test('seat uses a pelvis anchor so legs hang below the window',async()=>{
 const {p,videos}=boot();p.container.style={};p.play('sit');videos[1].onloadeddata();await flush();p.place(400,300,180,true);const top=parseFloat(p.container.style.top);assert.equal(top,120);assert.ok(top+parseFloat(p.container.style.height)>300);p.release();assert.equal(p.manual,false);
});

test('ambient thought does not cancel an explicit manual loop; seated idle stays seated',()=>{const {p}=boot();p.play('reading');p.tick({activity:'idle',scene:'thinking'});assert.equal(p.manual,true);assert.equal(p.pending,'reading');assert.equal(semantic({activity:'idle',scene:'shy',perched:true}),'sit');});
