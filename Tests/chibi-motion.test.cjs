const assert=require("node:assert/strict");
const {BONES,INDEX,Rig,Controller,random}=require("../MALFOY-ENGINE/web/live2d/chibi-motion.js");
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS: "+name);}
function step(controller,seconds,fps,context={}){for(let i=0;i<seconds*fps;i++)controller.tick(1/fps,context);}

test("bind pose reconstructs every source vertex with normalized nonnegative weights",()=>{
  const rig=new Rig();
  rig.vertices.forEach((v,i)=>{
    assert.ok(v.weights.every(([,w])=>w>=0 && Number.isFinite(w)));
    assert.ok(Math.abs(v.weights.reduce((n,[,w])=>n+w,0)-1)<1e-8);
    assert.ok(Math.abs(rig.deformed[i*2]-v.u*rig.aspect)<1e-7);
    assert.ok(Math.abs(rig.deformed[i*2+1]-v.v)<1e-7);
  });
});
test("hierarchy moves head children while leg bind pose stays grounded",()=>{
  const rig=new Rig(),p=new Float32Array(BONES.length);
  p[INDEX.head]=.07;rig.solve(p);
  assert.ok(Math.abs(rig.world[INDEX.hairL][4]-BONES[INDEX.hairL].x*rig.aspect)>.001);
  assert.ok(Math.abs(rig.world[INDEX.footL][5]-BONES[INDEX.footL].y)<1e-8);
});
test("whale tail moves separately without inheriting the tiny feet gait",()=>{
  const rig=new Rig(),weights=rig.weights(.80,.85);
  assert.ok(weights.some(([bone,w])=>bone===INDEX.tail && w>.95));
  assert.ok(weights.every(([bone])=>!BONES[bone].name.match(/leg|knee|foot/)));
  const pose=new Float32Array(BONES.length),i=rig.vertices.findIndex(v=>v.u>.78 && v.v>.83);
  const original=Array.from(rig.deformed.slice(i*2,i*2+2));
  pose[INDEX.tail]=.04;rig.solve(pose);
  assert.ok(Math.hypot(rig.deformed[i*2]-original[0],rig.deformed[i*2+1]-original[1])>.002);
  assert.ok(Math.abs(rig.world[INDEX.footR][5]-BONES[INDEX.footR].y)<1e-8);
});
test("30/60/120 Hz produce the same seeded action sequence and pose",()=>{
  const runs=[30,60,120].map(fps=>{const c=new Controller(42);step(c,120,fps);return c;});
  for(const c of runs.slice(1)){
    assert.deepEqual(c.state.history,runs[0].state.history);
    c.pose.forEach((n,i)=>assert.ok(Math.abs(n-runs[0].pose[i])<1e-7));
  }
});
test("automatic gestures respect cooldown, dwell time and no immediate repeats",()=>{
  const c=new Controller(17);step(c,300,60);
  assert.ok(c.history.length>10);
  c.history.forEach((event,i)=>{
    if(i){assert.notEqual(event.name,c.history[i-1].name);assert.ok(event.at-c.history[i-1].at>4);}
  });
});
test("interaction interrupts ambient gesture; lower priority cannot steal the body",()=>{
  const c=new Controller(1);
  assert.equal(c.requestAction("look",{priority:0}),true);
  assert.equal(c.requestAction("greet",{priority:2}),true);
  assert.equal(c.requestAction("stretch",{priority:0}),false);
  assert.equal(c.state.action,"greet");
});
test("working/reading own the body; finishing returns to ambient activity",()=>{
  const c=new Controller(1);c.setActivity("reading");step(c,60,60);
  assert.equal(c.state.action,null);assert.equal(c.requestAction("greet"),false);
  assert.equal(c.setActivity("unknown"),false);assert.equal(c.activity,"reading");
  c.setActivity("idle");step(c,10,60);assert.ok(c.history.length>0);
});
test("reduced motion disables automatic gestures and tones down gait",()=>{
  const c=new Controller(1);step(c,120,60,{reducedMotion:true,locomotion:"walk"});
  assert.equal(c.history.length,0);
  assert.ok(Math.abs(c.pose[INDEX.legL])<2*Math.PI/180);
});
test("untrusted action values are rejected and long durations are bounded",()=>{
  const c=new Controller(1);
  assert.equal(c.requestAction("__proto__"),false);
  assert.equal(c.requestAction("look",{duration:NaN}),false);
  assert.equal(c.requestAction("look",{priority:Infinity}),false);
  assert.equal(c.requestAction("look",{duration:1e9}),true);
  assert.equal(c.action.duration,8);
  step(c,10,60,{locomotion:"walk"});assert.equal(c.action,null);
});
test("long frame suspension is bounded, pose remains finite and within limits",()=>{
  const c=new Controller(33);c.tick(10000,{locomotion:"jump"});
  assert.ok(c.time<=.251);
  c.tick(NaN);c.tick(-1);
  for(let i=0;i<1000;i++)c.tick(1/30,{locomotion:i%2 ? "walk":"fall",lookX:1e6});
  c.pose.forEach((n,i)=>assert.ok(Number.isFinite(n)&&Math.abs(n)<=BONES[i].limit*Math.PI/180+1e-7));
});
test("constrained mixed poses do not invert or collapse mesh triangles",()=>{
  const rig=new Rig(),c=new Controller(9),rng=random(71);
  const names=["look","nod","stretch","greet","sway"];
  for(let frame=0;frame<600;frame++){
    if(frame%30===0)c.requestAction(names[Math.floor(rng()*names.length)]);
    const p=rig.solve(c.tick(1/30,{locomotion:frame%90<40 ? "walk":"idle",lookX:rng()*2-1}));
    const tri=rig.triangles;
    for(let j=0;j<tri.length;j+=3){
      const a=tri[j]*2,b=tri[j+1]*2,d=tri[j+2]*2;
      const area=(p[b]-p[a])*(p[d+1]-p[a+1])-(p[b+1]-p[a+1])*(p[d]-p[a]);
      assert.ok(area>1e-7,"folded triangle at frame "+frame);
    }
  }
});
console.log(`\n${passed} meaningful motion checks passed; no renderer/model/private-data acceptance implied.`);
