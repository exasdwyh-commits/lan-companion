// 歌姬模式的面板：三件事各自可有可无，面板要把「现在卡在哪一步」说清楚。
// 桩与 cover-panel 同构（面板脚本是同一个），只补 vocalist 那一侧。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function boot(){
  const elements=new Map(),calls=[];let notify=null,notifyV=null;
  const make=(id)=>({id,value:'',textContent:'',dataset:{},disabled:false,open:false,hidden:false,title:'',attributes:{},children:[],style:{},
    setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},
    appendChild(child){this.children.push(child);return child;},
    replaceChildren(...kids){this.children=kids;this.textContent='';}});
  const $=id=>{if(!elements.has(id))elements.set(id,make(id));return elements.get(id);};
  const document={activeElement:null,getElementById:$,createElement:tag=>make(`<${tag}>`),querySelectorAll:()=>[],body:{dataset:{}}};
  const host={
    onCoverState:cb=>notify=cb,
    onVocalistState:cb=>notifyV=cb,
    cover:async p=>({ok:true,state:{selected:null,model:{ready:true},songs:[],job:null}}),
    vocalist:async p=>{calls.push(p);return {ok:true,state:lastState};},
    library:async()=>({songs:[],books:[]}),
  };
  let lastState=null;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../MALFOY-ENGINE/web/live2d/companion-panel.js'),'utf8'),
    {window:{malfoyHost:host},document,setTimeout,clearTimeout});
  return {
    $,calls,document,
    push:v=>{lastState=v;notifyV&&notifyV(v);},
  };
}

const base=(over={})=>({
  ready:{configured:true,model:'music-3.0',error:''},
  dress:{ready:true,error:'',voice:'清冷'},
  draft:{theme:'海',style:'民谣',title:'',lyrics:'[Verse]\n潮水'},
  job:null,song:null,songs:[],
  ...over,
});
const SONG={id:'a'.repeat(8)+'-1111-1111-1111-111111111111',title:'海的信',url:'file:///s.m4a',herUrl:null,
  lyrics:'[Verse]\n潮水把沙子写成字',model:'music-3.0',duration:187};

test('没配音乐模型时说清要写哪个环境变量，并把「作曲」按死',()=>{
  const b=boot();
  b.push(base({ready:{configured:false,model:'music-3.0',error:'还没配 MiniMax 的 API Key。写进 ~/.hermes/.env 的 MINIMAX_API_KEY=... 就能用。'}}));
  assert.equal(b.$('vocalist-generate').disabled,true);
  assert.match(b.$('vocalist-status').textContent,/MINIMAX_API_KEY/);
  // 写词走的是本机模型池，跟音乐 key 无关，不该被一起按掉
  assert.equal(b.$('vocalist-write').disabled,false);
});

test('三个阶段的进度各说各的话，且都有取消出口',()=>{
  const b=boot();
  for(const [status,re] of [['writing',/想词/],['composing',/谱曲/],['encoding',/转码/],['dressing',/换成她的声音/]]){
    b.push(base({job:{status}}));
    assert.match(b.$('vocalist-status').textContent,re,status);
    assert.equal(b.$('vocalist-cancel').disabled,false,status);
    assert.equal(b.$('vocalist-generate').disabled,true,status);
  }
});

test('做完把标题、版本、时长摆出来，并立刻刷新曲库',()=>{
  const b=boot();
  b.push(base({job:{status:'composing'},song:null}));
  b.push(base({job:{status:'done'},song:SONG}));
  assert.equal(b.$('vocalist-result').hidden,false);
  assert.equal(b.$('vocalist-title').textContent,'海的信');
  assert.match(b.$('vocalist-meta').textContent,/生成版/);
  assert.match(b.$('vocalist-meta').textContent,/3:07/);
  assert.match(b.$('vocalist-status').textContent,/做好了/);
  assert.equal(b.$('vocalist').open,true,'做完要展开，否则用户不知道成了');
});

test('有她唱版时多出「听生成版」这个对照，按钮改成「重新让她唱」',()=>{
  const b=boot();
  b.push(base({job:{status:'done'},song:{...SONG,herUrl:'file:///her.m4a'}}));
  assert.equal(b.$('vocalist-play-alt').hidden,false);
  assert.equal(b.$('vocalist-dress').textContent,'重新让她唱');
  assert.match(b.$('vocalist-meta').textContent,/她本人的声音/);

  b.push(base({job:{status:'done'},song:SONG}));
  assert.equal(b.$('vocalist-play-alt').hidden,true,'没有第二个版本就别给一个点了没反应的按钮');
  assert.equal(b.$('vocalist-dress').textContent,'让她本人唱');
});

test('换声环境不在时只禁这一档，歌本身还能听',()=>{
  const b=boot();
  b.push(base({job:{status:'done'},song:SONG,dress:{ready:false,error:'「清冷」还缺一段干净人声参考。'}}));
  assert.equal(b.$('vocalist-dress').disabled,true);
  assert.match(b.$('vocalist-dress').title,/干净人声/);
  assert.equal(b.$('vocalist-result').hidden,false,'原版成品不该因为换声不可用而不显示');
});

test('用户正在打歌词时不回写，避免每敲一个字就被抢回旧值',()=>{
  const b=boot();
  b.document.activeElement=b.$('vocalist-lyrics');
  b.$('vocalist-lyrics').value='我自己写的半句';
  b.push(base({draft:{theme:'海',style:'民谣',lyrics:'[Verse]\n后端记着的旧词'}}));
  assert.equal(b.$('vocalist-lyrics').value,'我自己写的半句');
  // 主题框没在编辑，照常同步
  assert.equal(b.$('vocalist-theme').value,'海');
});

test('生成时把框里的歌词一起交上去，而不是后端记着的',async()=>{
  const b=boot();
  b.push(base({}));
  b.$('vocalist-theme').value='海边';
  b.$('vocalist-style').value='民谣';
  b.$('vocalist-lyrics').value='[Verse]\n手改的词一';
  await b.$('vocalist-generate').onclick();
  const call=b.calls[b.calls.length-1];
  assert.equal(call.action,'generate');
  assert.equal(call.patch.lyrics,'[Verse]\n手改的词一');
  assert.equal(call.patch.theme,'海边');
});

test('写词只带主题和曲风 —— 把旧歌词也发过去会让模型照着改而不是重写',async()=>{
  const b=boot();
  b.push(base({}));
  b.$('vocalist-theme').value='海边';
  b.$('vocalist-lyrics').value='旧的词';
  await b.$('vocalist-write').onclick();
  const call=b.calls[b.calls.length-1];
  assert.equal(call.action,'write');
  assert.equal(call.patch.lyrics,undefined);
});

test('播放默认走她唱版，对照按钮显式要生成版',async()=>{
  const b=boot();
  b.push(base({job:{status:'done'},song:{...SONG,herUrl:'file:///her.m4a'}}));
  await b.$('vocalist-play').onclick();
  assert.equal(b.calls.at(-1).action,'play');
  assert.equal(b.calls.at(-1).which,undefined,'默认版本由后端决定，面板不硬编码');
  await b.$('vocalist-play-alt').onclick();
  assert.equal(b.calls.at(-1).which,'main');
});
