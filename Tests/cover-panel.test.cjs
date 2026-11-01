const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function boot(){
  const elements=new Map(),calls=[];let notify;
  // 面板会改 aria 属性（音域「自动」按钮的按下态），桩要能承接
  // 音色胶囊和分析结论是运行时 createElement 出来的，桩也得支持建节点与挂子节点，
  // 否则真浏览器里正常、测试里报 replaceChildren is not a function。
  const make=(id)=>({id,value:'',textContent:'',dataset:{},disabled:false,open:false,hidden:false,attributes:{},children:[],style:{},
    setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},
    appendChild(child){this.children.push(child);return child;},
    replaceChildren(...kids){this.children=kids;this.textContent='';}});
  const $=id=>{if(!elements.has(id))elements.set(id,make(id));return elements.get(id);};
  const ready=job=>({selected:{title:'synthetic song'},model:{ready:true},songs:[],job});
  const host={onCoverState:cb=>notify=cb,cover:async p=>{calls.push(p);return {ok:true,state:ready({status:'preparing'})};}};
  const document={getElementById:$,createElement:tag=>make(`<${tag}>`),querySelectorAll:()=>[],body:{dataset:{}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../MALFOY-ENGINE/web/live2d/companion-panel.js'),'utf8'),{window:{malfoyHost:host},document,setTimeout,clearTimeout});
  return {$,calls,notify,ready};
}

test('make cover button invokes the host and visibly enters the busy state',async()=>{
  const b=boot();b.notify(b.ready(null));assert.equal(b.$('start-cover').disabled,false);
  await b.$('start-cover').onclick();assert.equal(b.calls[0].action,'start');
  assert.match(b.$('cover-status').textContent,/准备原曲/);
  assert.equal(b.$('start-cover').disabled,true);assert.equal(b.$('cancel-cover').disabled,false);
  assert.equal(b.$('cover-studio').open,true);
});

test('model chunk progress and precise failures are visible and controls recover',()=>{
  const b=boot();b.notify(b.ready({status:'converting',progress:{current:2,total:10}}));
  assert.match(b.$('cover-status').textContent,/第 2 \/ 10 段/);assert.equal(b.$('start-cover').disabled,true);
  b.notify(b.ready({status:'error',error:'歌声音色转换失败（退出码 9）；可重试。'}));
  assert.match(b.$('cover-status').textContent,/歌声音色转换失败.*9/);
  assert.equal(b.$('start-cover').disabled,false);assert.equal(b.$('cancel-cover').disabled,true);
});

test('自动模式下显示推算出来的半音数，而不是让用户猜',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,
    tune:{semitones:null,recommended:6,reason:'原唱低音区 115Hz，建议升 6 个半音。'}});
  assert.match(b.$('shift-value').textContent,/自动 · \+6 半音/);
  assert.equal(b.$('shift-value').dataset.auto,'true');
  assert.equal(b.$('shift-auto').getAttribute('aria-pressed'),'true');
  // 滑块位置要跟着推荐值，用户改的时候是从推荐值出发而不是从 0 出发
  assert.equal(b.$('shift-range').value,'6');
  assert.match(b.$('shift-note').textContent,/115Hz/);
});

test('手动指定音域后不再标自动，滑块停在用户设的值上',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,
    tune:{semitones:4,recommended:6,reason:''}});
  assert.match(b.$('shift-value').textContent,/^\+4 半音$/);
  assert.equal(b.$('shift-value').dataset.auto,'false');
  assert.equal(b.$('shift-auto').getAttribute('aria-pressed'),'false');
  assert.equal(b.$('shift-range').value,'4');
});

test('试听完成后按钮转为再听一版，状态里说清用的是几个半音',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:{status:'preview-done',shift:6},
    tune:{semitones:null},preview:{url:'file:///p.m4a',semitones:6}});
  assert.equal(b.$('preview-cover').textContent,'再听一版');
  assert.equal(b.$('preview-cover').dataset.ready,'true');
  assert.match(b.$('cover-status').textContent,/\+6 半音/);
  // 试听不进曲库，所以不能触发列表刷新，也不该出现「已完成」
  assert.doesNotMatch(b.$('cover-status').textContent,/翻唱已完成/);
});

test('音色胶囊标出当前档，缺参考的那档禁用而不是消失',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,tune:{semitones:null},analysis:null,
    voices:[
      {id:'magnetic',name:'磁性',tone:'低音厚、略带沙',usable:true,current:true},
      {id:'sunyanzi',name:'孙燕姿',tone:'锥形波明亮',usable:false,current:false},
    ]});
  const chips=b.$('voice-picker').children;
  assert.equal(chips.length,2);
  assert.equal(chips[0].getAttribute('aria-pressed'),'true');
  assert.equal(chips[0].disabled,false);
  assert.match(chips[0].textContent,/磁性/);
  // 缺参考音频的档位必须留着并说明缺什么，悄悄藏起来用户会以为「没这个选项」
  assert.equal(chips[1].dataset.off,'true');
  assert.equal(chips[1].getAttribute('aria-disabled'),'true');
  assert.match(chips[1].textContent,/待启用/);
  // 但不能做成点不动的死按钮：点一下要能被告知缺什么、放到哪
  assert.equal(chips[1].disabled,false);
  assert.match(b.$('voice-name').textContent,/磁性/);
  assert.match(b.$('voice-note').textContent,/低音厚/);
});

test('点音色胶囊发出的是换音色指令，不是改音域',async()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,tune:{semitones:null},analysis:null,
    voices:[{id:'magnetic',name:'磁性',usable:true,current:true},{id:'warm',name:'温暖',usable:true,current:false}]});
  await b.$('voice-picker').children[1].onclick();
  // 面板跑在独立 vm realm 里，deepEqual 会因原型不同而误报，逐字段比
  const last=b.calls.at(-1);
  assert.equal(last.action,'voice');
  assert.equal(last.id,'warm');
  // 换音色不该顺手改音域，那是两个独立的东西
  assert.equal(b.calls.some(c=>c.action==='tune'),false);
});

test('分析结果被翻成人话：什么调、多快、升几个半音',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,voices:[],
    tune:{semitones:null,recommended:6,keyAfter:'E 小调',conflict:false},
    analysis:{key:{label:'A# 小调'},tempo:123,vocal:{span:18.2},advice:['节奏和速度不用调。']}});
  const box=b.$('analysis');
  assert.equal(box.hidden,false);
  const facts=box.children[0].children[0].textContent;
  assert.match(facts,/A# 小调/);
  assert.match(facts,/123 BPM/);
  assert.match(facts,/18\.2 个半音/);
  assert.match(box.children[1].textContent,/升 6 个半音/);
  assert.match(box.children[1].textContent,/E 小调/);
  assert.equal(box.dataset.conflict,'false');
});

test('不用升调时说「保持原调」，不说「升 0 个半音」',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,voices:[],
    tune:{semitones:null,recommended:0},analysis:{key:{label:'C 大调'},tempo:90,vocal:{span:12}}});
  assert.match(b.$('analysis').children[1].textContent,/保持原调/);
  assert.doesNotMatch(b.$('analysis').children[1].textContent,/升 0/);
});

test('唱不到的时候分析块带警告标记，让人一眼看见',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,voices:[],
    tune:{semitones:null,recommended:1,conflict:true},
    analysis:{key:{label:'D 小调'},tempo:100,vocal:{span:24.8}}});
  assert.equal(b.$('analysis').dataset.conflict,'true');
});

test('选了歌就能点分析，分析中按钮禁用并给出进度文案',()=>{
  const b=boot();
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,tune:{},voices:[],analysis:null});
  assert.equal(b.$('analyze-cover').disabled,false);
  assert.equal(b.$('analyze-cover').textContent,'分析这首歌');
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:{status:'analyzing'},tune:{},voices:[],analysis:null});
  assert.equal(b.$('analyze-cover').disabled,true);
  assert.match(b.$('cover-status').textContent,/分析/);
  assert.match(b.$('analyze-state').textContent,/分析中/);
});

test('没选歌时不能分析；分析完按钮变成重新分析',()=>{
  const b=boot();
  b.notify({selected:null,model:{ready:true},songs:[],job:null,tune:{},voices:[],analysis:null});
  assert.equal(b.$('analyze-cover').disabled,true);
  b.notify({selected:{title:'x'},model:{ready:true},songs:[],job:null,tune:{},voices:[],
    analysis:{key:{label:'A# 小调'},tempo:123,vocal:{span:18.2}}});
  assert.equal(b.$('analyze-cover').textContent,'重新分析');
});
