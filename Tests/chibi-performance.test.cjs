const assert=require("node:assert/strict");
const {Director,SCENES}=require("../MALFOY-ENGINE/web/live2d/chibi-performance.js");
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS: "+name);}
function step(d,seconds,ctx={}){let s;for(let i=0;i<seconds*60;i++)s=d.tick(1/60,ctx);return s;}
test("activities use visibly distinct authored poses, expressions and props",()=>{
 const d=new Director(()=>.3),frames=new Set();
 for(const name of ["thinking","working","reading","singing","sleeping"]){d.setActivity(name);const s=d.tick(.01);frames.add(s.frame);assert.ok(s.prop);assert.equal(s.scene,name);}
 assert.equal(frames.size,5);
});
test("paired work/read/song performances actually advance",()=>{
 for(const name of ["working","reading","singing"]){const d=new Director();d.setActivity(name);const seen=new Set();for(let i=0;i<300;i++)seen.add(d.tick(1/60).frame);assert.equal(seen.size,2,name);}
});
test("drag takes precedence, then returns to the ongoing reading activity",()=>{
 const d=new Director();d.setActivity("reading");assert.equal(d.tick(.1,{dragging:true}).scene,"surprised");assert.equal(d.tick(.1).scene,"reading");
});
test("a low priority touch cannot replace failure feedback, which expires",()=>{
 const d=new Director();d.notify("task-failed");assert.equal(d.notify("pet"),false);assert.equal(d.tick(.1).scene,"sad");assert.notEqual(step(d,5).scene,"sad");
});
test("reaction expiration restores the existing business activity",()=>{
 const d=new Director();d.setActivity("reading");d.notify("surprise");assert.equal(d.tick(.1).scene,"surprised");assert.equal(step(d,3).scene,"reading");
});
test("ambient performances cannot introduce a laptop/book/mic during real work",()=>{
 const d=new Director(()=>.1);d.setActivity("working");for(let i=0;i<900;i++){const s=d.tick(.1);assert.equal(s.scene,"working");assert.equal(s.prop,"眼镜、电脑");}
});
test("reduced motion retains the meaningful pose and prop without automatic cycling",()=>{
 const d=new Director();d.setActivity("singing");const s=step(d,10,{reducedMotion:true});assert.equal(s.frame,SCENES.singing.frames[0]);assert.equal(s.bob,0);assert.equal(s.tilt,0);assert.ok(s.prop);
});
test("invalid semantic requests are rejected and long suspension cannot skip sleep onset",()=>{
 const d=new Director();assert.equal(d.setActivity("__proto__"),false);assert.equal(d.notify("constructor"),false);assert.equal(d.emote("bad"),false);d.tick(9999);assert.ok(d.time<=.25);assert.equal(d.activity,"idle");
});
console.log(`\n${passed} semantic performance checks passed; no real model/job/song acceptance implied.`);
