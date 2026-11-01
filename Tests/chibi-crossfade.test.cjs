const assert=require("node:assert/strict");
const path=require("node:path");
// chibi-motion 的 UMD 在 node 走 module.exports 分支，手工挂回全局供 renderer 读取
const motion=require(path.join(__dirname,"../MALFOY-ENGINE/web/live2d/chibi-motion.js"));
globalThis.ChibiMotion=motion.ChibiMotion||motion;
const {ChibiRenderer}=require(path.join(__dirname,"../MALFOY-ENGINE/web/live2d/chibi-renderer.js"));
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS: "+name);}

/** 只借用 Renderer.prototype.render 的场景切换判定逻辑；drawScene 打桩记录。 */
function fakeRenderer(){
  const ctx={
    ready:true,gl:{clear(){}},drawn:[],
    _lastKey:undefined,_lastScene:null,_fadeFrom:null,_fadeUntil:0,
    drawScene(pose,scene,face,opacity){this.drawn.push({scene:scene&&scene.scene,frame:scene&&scene.frame,walk:scene&&scene.walk,opacity});return true;},
  };
  ctx.render=ChibiRenderer.Renderer.prototype.render.bind(ctx);
  return ctx;
}
const now0=1000;

test("同场景帧循环不触发淡入（walk 步态/眨眼帧连续播）",()=>{
  const r=fakeRenderer();
  r.render(null,{scene:"walk",walk:0,frame:0},null);
  r.render(null,{scene:"walk",walk:1,frame:0},null);
  r.render(null,{scene:"walk",walk:2,frame:0},null);
  assert.equal(r.drawn.length,3);
  assert.ok(r.drawn.every(d=>d.opacity===1));
});

test("场景切换触发双画：旧场景渐出、新场景渐入",()=>{
  const r=fakeRenderer();
  r._lastKey="idle";r._lastScene={scene:"idle",frame:0};
  r.render(null,{scene:"happy",frame:1},null);
  assert.equal(r.drawn.length,2);
  assert.equal(r.drawn[0].scene,"idle");
  assert.equal(r.drawn[1].scene,"happy");
  assert.ok(r.drawn[0].opacity>=0&&r.drawn[0].opacity<=1,"旧场景 alpha 在 [0,1]");
  assert.ok(r.drawn[1].opacity>=0&&r.drawn[1].opacity<=1,"新场景 alpha 在 [0,1]");
  assert.ok(Math.abs(r.drawn[0].opacity+r.drawn[1].opacity-1)<1e-9,"两侧 alpha 和为 1");
});

test("淡入只在 CROSSFADE_MS 内持续，之后恢复单画且清空来源",()=>{
  const r=fakeRenderer();
  r._lastKey="idle";r._lastScene={scene:"idle",frame:0};
  r.render(null,{scene:"happy",frame:1},null);
  assert.ok(r._fadeFrom);
  r._fadeUntil=0; // 时间走完
  r.drawn.length=0;
  r.render(null,{scene:"happy",frame:1},null);
  assert.equal(r.drawn.length,1);
  assert.equal(r.drawn[0].opacity,1);
  assert.equal(r._fadeFrom,null);
});

test("CROSSFADE_MS 常量在 100-250ms 手感区间且随模块导出",()=>{
  assert.ok(ChibiRenderer.CROSSFADE_MS>=100&&ChibiRenderer.CROSSFADE_MS<=250);
});

console.log(`\n${passed} crossfade checks passed; 视觉衔接以预览录屏验收为准。`);
