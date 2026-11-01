const test=require('node:test'),assert=require('node:assert/strict');
const catalog=require('../MALFOY-ENGINE/web/live2d/dsh-catalog');
const {CATEGORIES,select,IdleGestures}=require('../MALFOY-ENGINE/web/live2d/dsh-actions');
const {semantic}=require('../MALFOY-ENGINE/web/live2d/dsh-motion');
test('every selectable action has a category; compatibility/transition clips do not inflate menu',()=>{
 assert.equal(select(catalog,'all').length,125);assert.ok(!catalog.cuddle&&!catalog.drag&&!catalog['sleep-in']);
 for(const [key,item] of Object.entries(catalog))assert.ok(CATEGORIES[item.category],key);
 const byCategory=Object.keys(CATEGORIES).filter(k=>k!=='common').flatMap(k=>select(catalog,k).map(([key])=>key));
 assert.equal(new Set(byCategory).size,125);assert.equal(byCategory.length,125);
});
test('search crosses categories, supports Chinese/generated, and renders no hidden duplicate',()=>{
 assert.ok(select(catalog,'food','比心').some(([key])=>key==='heart'));
 assert.equal(select(catalog,'common','新绘').length,19);
 assert.ok(select(catalog,'all','吃').length>=20);assert.equal(select(catalog,'all','不存在的动作').length,0);
 assert.equal(select(catalog,'common')[0][0],'heart');
});
test('fresh emotions use distinct clips and expire; business, dragging, walking and seat win',()=>{
 for(const [emotion,key] of [['angry','pout'],['sad','sad'],['surprised','surprise'],['curious','confused'],['love','heart'],['cry','cry']]){
  const c={activity:'idle',scene:'idle',emotion,emotionAge:0};assert.equal(semantic(c),key);assert.equal(semantic({...c,emotionAge:6}),'idle');
  assert.equal(semantic({...c,perched:true}),'sit');assert.equal(semantic({...c,dragging:true}),'drag');assert.equal(semantic({...c,activity:'reading'}),'reading');assert.equal(semantic({...c,locomotion:'walk'}),'walk');
 }
});
const idle={activity:'idle',scene:'idle',locomotion:'idle',emotionAge:30};
test('quiet random gestures wait, avoid consecutive repeats, and never interrupt protected states',()=>{
 const g=new IdleGestures({random:()=>0});g.enabled=true;assert.equal(g.tick(idle,0),null);assert.equal(g.tick(idle,24999),null);
 const first=g.tick(idle,25000);assert.ok(catalog[first]);assert.notEqual(g.tick(idle,50000),first);
 for(const extra of [{activity:'reading'},{perched:true},{dragging:true},{manual:true},{hidden:true},{menuOpen:true},{reducedMotion:true},{emotionAge:1}]){
  g.next=1;assert.equal(g.tick({...idle,...extra},60000),null);assert.ok(g.next>60000);
 }
 g.next=1;assert.equal(g.tick({...idle,locomotion:'walk'},90000),null);g.enabled=false;assert.equal(g.tick(idle,100000),null);
});
