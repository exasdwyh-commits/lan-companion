const assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const path=require("node:path");
const {Director,SCENES,EVENTS}=require("../MALFOY-ENGINE/web/live2d/chibi-performance.js");
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS: "+name);}
function step(d,seconds,ctx={}){let s;for(let i=0;i<seconds*60;i++)s=d.tick(1/60,ctx);return s;}
const DANCE={danceEnabled:true,danceFrames:8,locomotion:"idle",userNear:true};

test("dance event engages the dedicated dance scene and cycles its cels",()=>{
  const d=new Director();
  assert.equal(d.notify("dance"),true);
  assert.equal(d.tick(.1,DANCE).scene,"dance");
  assert.equal(d.tick(.1,DANCE).dance,0);
  const seen=new Set();for(let i=0;i<160;i++)seen.add(d.tick(1/60,DANCE).dance);
  assert.equal(seen.size,8);
  assert.equal(SCENES.dance.frames.length,0);
  assert.equal(d.tick(.1,DANCE).frame,0); // safe idle fallback index
});

test("dance expires after its duration and returns to idle",()=>{
  const d=new Director();d.notify("dance");
  assert.equal(step(d,7,DANCE).scene,"dance");
  assert.equal(step(d,.5,DANCE).scene,"idle");
  assert.equal(d.tick(.1,DANCE).dance,null);
});

test("business activities keep working; dance is event-only",()=>{
  const d=new Director();d.setActivity("working");d.notify("dance");
  assert.equal(d.tick(.1,{...DANCE,userNear:false}).scene,"working");
  assert.equal(EVENTS.dance.priority,35);
});

test("dance outranks walking and loses only to higher-priority reactions",()=>{
  const d=new Director();d.notify("dance");
  const both={danceEnabled:true,danceFrames:8,walkEnabled:true,walkFrames:6,locomotion:"walk",userNear:true};
  assert.equal(d.tick(.1,both).scene,"dance");
  const e=new Director();e.notify("dance");e.notify("surprise");
  assert.equal(e.tick(.1,both).scene,"surprised");
});

test("reduced motion keeps the dance pose without cycling",()=>{
  const d=new Director();d.notify("dance");
  const s=step(d,3,{danceEnabled:true,danceFrames:8,reducedMotion:true,userNear:true});
  assert.equal(s.scene,"dance");assert.equal(s.dance,0);
});

test("embedded modules stay consistent with canonical sources (walk+dance optional)",()=>{
  const root=path.join(__dirname,"..");
  const out=execFileSync("python3",[path.join(root,"scripts/prepare-chibi-texture.py"),"--check"],{cwd:root,encoding:"utf8"});
  assert.match(out,/PASS: embedded texture/);
});

const {HumController}=require("../MALFOY-ENGINE/web/live2d/chibi-hum.js");

test("humming starts on dance entry, stays silent while held, stops on exit",()=>{
  const h=new HumController();
  assert.equal(h.update({scene:"dance"},{audioReady:true}),null===h.playing?"play":"play");
  const h2=new HumController();
  assert.equal(h2.update({scene:"dance"},{audioReady:true}),"play");
  assert.equal(h2.update({scene:"dance"},{audioReady:true}),null);
  assert.equal(h2.update({scene:"idle"},{audioReady:true}),"stop");
  assert.equal(h2.update({scene:"idle"},{audioReady:true}),null);
});

test("humming yields to speaking and resumes, but never plays without audio",()=>{
  const h=new HumController();
  h.update({scene:"dance"},{audioReady:true});
  assert.equal(h.update({scene:"dance"},{audioReady:true,speaking:true}),"stop");
  assert.equal(h.update({scene:"dance"},{audioReady:true}),"play");
  const q=new HumController();
  assert.equal(q.update({scene:"dance"},{audioReady:false}),null);
  assert.equal(q.update({scene:"dance"},{audioReady:true,reducedMotion:true}),null);
});
console.log(`\n${passed} dance-state checks passed; goofy visual acceptance happens in the preview.`);
