const assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const path=require("node:path");
const {Director,SCENES}=require("../MALFOY-ENGINE/web/live2d/chibi-performance.js");
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS: "+name);}
function step(d,seconds,ctx={}){let s;for(let i=0;i<seconds*60;i++)s=d.tick(1/60,ctx);return s;}
const WALK={walkEnabled:true,walkFrames:6,locomotion:"walk"};

test("walk cels engage for idle roaming and cycle through the walk atlas",()=>{
  const d=new Director();
  assert.equal(d.tick(.1,WALK).scene,"walk");
  assert.equal(d.tick(.1,WALK).walk,0);
  const seen=new Set();for(let i=0;i<120;i++)seen.add(d.tick(1/60,WALK).walk);
  assert.equal(seen.size,6);
  assert.deepEqual([...seen].sort((a,b)=>a-b),[0,1,2,3,4,5]);
});

test("frame stays 0 while walking so consumers without walk support degrade to idle",()=>{
  const d=new Director();const s=step(d,2,WALK);
  assert.equal(s.scene,"walk");assert.equal(s.frame,0);assert.equal(s.walk,Math.floor(2/.16)%6);
  assert.equal(SCENES.walk.frames.length,0);
});

test("without a loaded walk atlas the gait falls back to today's behaviour",()=>{
  const d=new Director();const s=d.tick(.1,{locomotion:"walk",walkEnabled:false,walkFrames:6});
  assert.equal(s.scene,"idle");assert.equal(s.walk,null);assert.equal(s.frame,0);
});

test("reactions and dragging keep priority over walk cels",()=>{
  const d=new Director();
  d.notify("surprise");assert.equal(d.tick(.1,WALK).scene,"surprised");
  const p=new Director();p.notify("pet");assert.equal(p.tick(.1,WALK).scene,"happy");
  assert.equal(d.tick(.1,{...WALK,dragging:true}).scene,"surprised");
  const e=new Director();e.tick(.1,{...WALK,locomotion:"jump"});assert.equal(e.tick(.1,{...WALK,locomotion:"jump"}).scene,"surprised");
});

test("business activities never turn a stationary pose into walking",()=>{
  for(const name of ["working","reading","singing"]){
    const d=new Director();d.setActivity(name);
    assert.equal(d.tick(.1,{...WALK,locomotion:"idle"}).scene,name);
    assert.equal(d.tick(.1,{...WALK,locomotion:"walk"}).scene,name);
  }
});

test("explicit gestures override the walk loop",()=>{
  const d=new Director();
  assert.equal(d.tick(.1,{...WALK,gesture:"look"}).scene,"thinking");
  assert.equal(d.tick(.1,{...WALK,gesture:"nod"}).scene,"happy");
});

test("walk cycle honours a smaller atlas frame count",()=>{
  const d=new Director();const seen=new Set();
  for(let i=0;i<120;i++)seen.add(d.tick(1/60,{walkEnabled:true,walkFrames:4,locomotion:"walk"}).walk);
  assert.deepEqual([...seen].sort((a,b)=>a-b),[0,1,2,3]);
});

test("embedded walk module stays consistent with its canonical sources",()=>{
  const root=path.join(__dirname,"..");
  const out=execFileSync("python3",[path.join(root,"scripts/prepare-chibi-texture.py"),"--check"],{cwd:root,encoding:"utf8"});
  assert.match(out,/PASS: embedded texture/);
});
console.log(`\n${passed} walk-cycle checks passed; visual gait acceptance happens in the preview, not here.`);
