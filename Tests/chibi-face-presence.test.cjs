const assert=require("node:assert/strict");
const {Controller:Face}=require("../MALFOY-ENGINE/web/live2d/chibi-face.js");
const {Controller:Presence}=require("../MALFOY-ENGINE/web/live2d/chibi-presence.js");
let passed=0;function test(name,fn){fn();passed++;console.log("PASS: "+name);}
function step(c,seconds,ctx={},fps=60){let s;for(let i=0;i<Math.ceil(seconds*fps);i++)s=c.tick(1/fps,ctx);return s;}
test("facial override works during work without changing the supplied body context",()=>{
 const c=new Face(()=>.5),body={scene:"working",frame:4};assert.ok(c.setExpression("playful"));const f=c.tick(.1,body);
 assert.equal(f.expression,"playful");assert.equal(f.leftEye,0);assert.equal(f.rightEye,1);assert.deepEqual(body,{scene:"working",frame:4});
});
test("eyes, mouth, blush and brows can vary independently and invalid edits are atomic",()=>{
 const c=new Face();assert.ok(c.setParameters({eyes:.4,mouth:"open",mouthOpen:.8,blush:.9,brow:-.5}));const f=c.tick(.1);
 assert.equal(f.eyes,.4);assert.equal(f.mouthOpen,.8);assert.equal(f.blush,.9);assert.equal(f.brow,-.5);
 assert.equal(c.setParameters({eyes:1,blush:NaN}),false);assert.equal(c.tick(.1).eyes,.4);
 assert.equal(c.setParameters({__proto__:null,nope:1}),false);assert.equal(c.setExpression("constructor"),false);
});
test("a blink closes briefly then restores the selected expression",()=>{
 const c=new Face(()=>.5);c.setExpression("shy");c.blink();assert.equal(c.tick(.01).eyes,0);assert.equal(step(c,.3).eyes,.65);
});
test("speech mouth follows audio energy rather than an invented talk clock",()=>{
 const c=new Face();assert.equal(c.tick(.1,{scene:"speaking",speaking:true,audioLevel:0}).mouth,"small");
 assert.equal(c.tick(.1,{scene:"speaking",speaking:true,audioLevel:.8}).mouthOpen,.8);
});
test("facial override expires and sleeping restores closed eyes",()=>{
 const c=new Face();c.setExpression("surprised",{duration:.5});assert.equal(c.tick(.1,{scene:"sleeping",age:4}).expression,"surprised");
 assert.equal(step(c,1,{scene:"sleeping",age:4}).eyes,0);
});
test("gaze is bounded and reduced motion holds a useful expression without random blinking",()=>{
 const c=new Face(()=>0);const f=step(c,8,{scene:"working",lookX:999,lookY:-999,reducedMotion:true});
 assert.equal(f.expression,"focused");assert.equal(f.blinking,false);assert.equal(f.gazeX,0);assert.equal(f.gazeY,0);
 assert.ok(Math.abs(c.gaze.x)<=1&&Math.abs(c.gaze.y)<=1);
});
const bounds={width:900,height:600,charWidth:240,charHeight:240};
test("edge sequence actually hides, peeks and returns to a reachable location on all three sides",()=>{
 for(const side of ["left","right","bottom"]){
  const c=new Presence();assert.ok(c.peek(side,{x:450,y:598}));const phases=new Set(),positions={};let s;
  for(let i=0;i<340;i++){s=c.tick(1/60,bounds);phases.add(s.phase);if(s.kind==="peek")positions[s.phase]=s;}
  for(const phase of ["approaching","hiding","hidden","peeking","peek-hold","emerging"])assert.ok(phases.has(phase),side+phase);
  const hidden=positions.hidden,peek=positions["peek-hold"],end=positions.emerging;
  if(side==="bottom"){assert.ok(hidden.y>600+240);assert.ok(peek.y<hidden.y&&peek.y>600);}
  else {assert.ok(side==="left"?hidden.x< -120:hidden.x>1020);assert.ok(Math.abs(peek.x-450)<Math.abs(hidden.x-450));}
  assert.ok(end.x>0&&end.x<900&&end.y<=600);assert.equal(c.action,null);
 }
});
test("edge play cannot replace a world departure and rejects unknown borders",()=>{
 const c=new Presence();assert.equal(c.peek("window-title",{x:100,y:100}),false);assert.ok(c.travel("out","world"));
 assert.equal(c.peek("left",{x:100,y:100}),false);assert.equal(c.travel("out","desktop"),false);assert.equal(c.cancel(),false);
});
test("travel ends hidden on departure and fully visible on arrival, once",()=>{
 const c=new Presence();assert.ok(c.travel("out","world"));let final;
 for(let i=0;i<70;i++){const s=c.tick(1/60);if(s.completed)final=s;}
 assert.equal(final.opacity,0);assert.equal(final.target,"world");assert.equal(c.action,null);assert.ok(c.travel("in","world"));
 for(let i=0;i<70;i++){const s=c.tick(1/60);if(s.completed)final=s;}assert.equal(final.opacity,1);assert.equal(final.scale,1);
});
test("reduced motion never hides a peeking character and removes travel spin and shrink",()=>{
 const c=new Presence();c.peek("right",{x:300,y:500});const p=c.tick(.1,{...bounds,reducedMotion:true});
 assert.ok(p.completed);assert.ok(p.x<900);assert.equal(p.rotation,0);
 c.travel("out","world");const t=c.tick(.1,{reducedMotion:true});assert.equal(t.scale,1);assert.equal(t.rotation,0);assert.equal(t.portal,0);
});
test("presence timing is frame-rate independent and a long suspension is bounded",()=>{
 const sample=fps=>{const c=new Presence();c.peek("left",{x:450,y:598});return step(c,2,bounds,fps);};
 const a=sample(30),b=sample(120);assert.ok(Math.abs(a.x-b.x)<.0001);assert.equal(a.phase,b.phase);
 const c=new Presence();c.travel("out","world");assert.ok(c.tick(9999).progress<.25);
});
console.log(`\n${passed} independent face and presence checks passed; native IPC/window behavior requires separate verification.`);
