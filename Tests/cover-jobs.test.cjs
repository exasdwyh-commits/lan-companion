const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createCoverJobs,SVC_FILES}=require('../MALFOY-ENGINE/lib/cover-jobs');
function boot(t,extra={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lan-cover-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const workspace=path.join(root,'project');for(const file of ['../.venvs/sing/bin/python','third_party/seed-vc/inference.py',...SVC_FILES.map(f=>'.models/seedvc/'+f)]){const dest=path.join(workspace,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,'fixture');}const source=path.join(root,'original.mp3');fs.writeFileSync(source,'fixture');const processes=[],killed=[];const jobs=createCoverJobs({dir:path.join(root,'data'),workspace,ffmpeg:'/fixture/ffmpeg',spawnJob:(file,args,options)=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.pid=1000+processes.length;p.args=args;p.options=options;processes.push(p);return p;},killGroup:(...args)=>killed.push(args),...extra});return {jobs,source,processes,killed,workspace,root};}
test('cover job owns a copied input, runs the real pipeline as argv, preserves completed library across restart',async t=>{const b=boot(t);b.jobs.select(b.source);await b.jobs.start();const p=b.processes[0];assert.equal(p.args[0],path.join(b.workspace,'scripts/sing_cover_file.sh'));assert.notEqual(p.args[1],b.source);assert.equal(p.options.detached,true);p.stdout.emit('data','[2/4] separation\n');assert.equal(b.jobs.snapshot().job.status,'separating');p.stdout.emit('data','[3/4] convert\n');assert.equal(b.jobs.snapshot().job.status,'converting');fs.writeFileSync(p.args[2],Buffer.alloc(2000));p.emit('close',0);assert.equal(b.jobs.snapshot().job.status,'done');const song=b.jobs.snapshot().songs[0];assert.equal(song.engine,'seed-vc-svc-f0-44k');assert.ok(b.jobs.audio(song.id).url.endsWith('/cover.m4a'));const restarted=createCoverJobs({dir:path.join(b.root,'data'),workspace:b.workspace});assert.equal(restarted.snapshot().songs.length,1);assert.throws(()=>b.jobs.audio('../../private'));});
test('cancel kills the process group and rejects late success; failure never registers fake audio',async t=>{const b=boot(t);b.jobs.select(b.source);await b.jobs.start();const p=b.processes[0];b.jobs.cancel();assert.deepEqual(b.killed[0],[p.pid,'SIGTERM']);fs.writeFileSync(p.args[2],Buffer.alloc(2000));p.emit('close',0);assert.equal(b.jobs.snapshot().job.status,'cancelled');assert.equal(b.jobs.snapshot().songs.length,0);await b.jobs.start();b.processes[1].emit('close',1);assert.equal(b.jobs.snapshot().job.status,'error');assert.equal(b.jobs.snapshot().songs.length,0);});
test('missing singing weights are a hard error; no speech-model or TTS fallback',async t=>{const b=boot(t);b.jobs.select(b.source);fs.unlinkSync(path.join(b.workspace,'.models/seedvc',SVC_FILES[0]));await assert.rejects(b.jobs.start(),/歌声转换模型/);assert.equal(b.processes.length,0);assert.throws(()=>b.jobs.select(path.join(b.root,'payload.js')),/请选择/);});

test('cancel while preparing the target voice prevents a late model launch',async t=>{let finish;const b=boot(t,{reference:()=>new Promise(resolve=>finish=resolve)});b.jobs.select(b.source);const pending=b.jobs.start();b.jobs.cancel();finish({audio:'fixture'});await pending;assert.equal(b.processes.length,0);assert.equal(b.jobs.snapshot().job.status,'cancelled');});

test('pipeline failure reports a structured stage and code without retaining raw stderr',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.start();const p=b.processes[0];
  p.stderr.emit('data','private path /private/song-name.wav\n[cover-error] sta');
  p.stderr.emit('data','ge=shaping code=9\n');p.emit('close',9);
  const result=b.jobs.snapshot();assert.equal(result.job.status,'error');
  assert.match(result.job.error,/音色整形.*9/);assert.doesNotMatch(JSON.stringify(result),/private path|song-name/);
  assert.equal(result.songs.length,0);
});

test('unstructured failure still names the last known stage',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.start();const p=b.processes[0];
  p.stdout.emit('data','[3/4] conversion\n');p.stderr.emit('data','untrusted diagnostic\n');p.emit('close',2);
  assert.match(b.jobs.snapshot().job.error,/歌声音色转换.*2/);
});

test('cancelled processes cannot overwrite the replacement job diagnostics',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.start();const old=b.processes[0];
  b.jobs.cancel();await b.jobs.start();old.stderr.emit('data','[cover-error] stage=mixing code=7\n');old.emit('close',7);
  assert.equal(b.jobs.snapshot().job.status,'preparing');b.processes[1].emit('close',3);
  assert.match(b.jobs.snapshot().job.error,/原曲准备.*3/);
});

test('zero exit without a finished audio file is a validation failure',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.start();b.processes[0].emit('close',0);
  assert.equal(b.jobs.snapshot().job.status,'error');assert.equal(b.jobs.snapshot().songs.length,0);
  assert.match(b.jobs.snapshot().job.error,/成品音频校验/);assert.doesNotMatch(b.jobs.snapshot().job.error,/退出码 0/);
});

test('chunk progress survives split output and rejects invalid counters',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.start();const p=b.processes[0];
  p.stdout.emit('data','[3/4] convert\n[cover-progress] chu');
  p.stdout.emit('data','nk=2 total=10\n');assert.deepEqual(b.jobs.snapshot().job.progress,{current:2,total:10});
  p.stdout.emit('data','[cover-progress] chunk=11 total=10\n');assert.deepEqual(b.jobs.snapshot().job.progress,{current:2,total:10});
  p.emit('close',1);
});

test('tune defaults to auto, accepts an explicit semitone, and rejects absurd values',async t=>{
  const b=boot(t);
  assert.equal(b.jobs.snapshot().tune.semitones,null);
  b.jobs.setTune(6);assert.equal(b.jobs.snapshot().tune.semitones,6);
  b.jobs.setTune(null);assert.equal(b.jobs.snapshot().tune.semitones,null);
  assert.throws(()=>b.jobs.setTune(99),/范围/);
});

test('auto tune leaves SHIFT unset so the pipeline derives it from the vocal range',async t=>{
  const b=boot(t);const saved=process.env.SHIFT;delete process.env.SHIFT;t.after(()=>{if(saved!==undefined)process.env.SHIFT=saved;});
  b.jobs.select(b.source);await b.jobs.start();
  // 不传 SHIFT 时 scripts/sing_cover_file.sh 会自己跑 voice_range.py
  assert.equal(b.processes[0].options.env.SHIFT,undefined);
});

test('an explicit tune is passed straight through to the pipeline',async t=>{
  const b=boot(t);b.jobs.select(b.source);b.jobs.setTune(-3);await b.jobs.start();
  assert.equal(b.processes[0].options.env.SHIFT,'-3');
});

test('the shift the script actually used is surfaced as the applied value',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.start();const p=b.processes[0];
  p.stdout.emit('data','[cover-shift] semitones=6\n');
  assert.equal(b.jobs.snapshot().tune.applied,6);
});

test('preview renders a short slice and never lands in the library',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.runPreview();const p=b.processes[0];
  assert.equal(p.options.env.PREVIEW_SEC,'25');
  assert.ok(p.args[2].endsWith('/preview.m4a'));
  fs.writeFileSync(p.args[2],Buffer.alloc(2000));p.emit('close',0);
  const snap=b.jobs.snapshot();
  assert.equal(snap.job.status,'preview-done');
  // 试听是过程产物：反复覆盖都不会往曲库里塞重复条目
  assert.equal(snap.songs.length,0);
  assert.ok(snap.preview.url.endsWith('/preview.m4a'));
  assert.ok(b.jobs.previewAudio().url.endsWith('/preview.m4a'));
});

test('a full render after a preview still registers exactly one song',async t=>{
  const b=boot(t);b.jobs.select(b.source);
  await b.jobs.runPreview();fs.writeFileSync(b.processes[0].args[2],Buffer.alloc(2000));b.processes[0].emit('close',0);
  await b.jobs.start();fs.writeFileSync(b.processes[1].args[2],Buffer.alloc(2000));b.processes[1].emit('close',0);
  assert.equal(b.jobs.snapshot().songs.length,1);
  assert.equal(b.jobs.snapshot().job.status,'done');
});

test('tune cannot be changed while a render is running',async t=>{
  const b=boot(t);b.jobs.select(b.source);await b.jobs.start();
  assert.throws(()=>b.jobs.setTune(4),/制作中/);
});

// 假音色档案：只实现 cover-jobs 真正用到的那几个方法。
// 真档案会去磁盘找参考音频，这层不该在单测里依赖文件系统。
function fakeVoices(state={current:'magnetic'}){
  const defs=[
    {id:'magnetic',name:'磁性',tone:'低音厚',range:{lo:165,hi:null},refPath:'/fixture/ref-magnetic.wav',usable:true},
    {id:'warm',name:'温暖',tone:'中音饱满',range:{lo:175,hi:null},refPath:'/fixture/ref-warm.wav',usable:true},
    {id:'sunyanzi',name:'孙燕姿',tone:'明亮',range:{lo:164.8,hi:493.9},refPath:'/fixture/ref-sunyanzi.wav',usable:true},
  ];
  return{
    list:()=>defs.map(v=>({...v,current:v.id===state.current})),
    find:id=>defs.find(v=>v.id===id)||null,
    current:()=>defs.find(v=>v.id===state.current)||defs[0],
    currentId:()=>state.current,
    set:id=>{const hit=defs.find(v=>v.id===id);if(!hit)throw new Error('没有这个音色');state.current=id;return hit;},
  };
}

test('音色档案的参考音频和音域都要传到管线',async t=>{
  const b=boot(t,{voiceProfiles:fakeVoices({current:'sunyanzi'})});
  b.jobs.select(b.source);await b.jobs.start();
  const env=b.processes[0].options.env;
  // 参考音频直接指向档案里的 wav，不再落一份 reference.mp3
  assert.equal(env.REF,'/fixture/ref-sunyanzi.wav');
  assert.equal(env.VOICE,'sunyanzi');
  // 上下界必须传：脚本自己不知道当前选了哪档音色
  assert.equal(env.VOICE_LO,'164.8');
  assert.equal(env.VOICE_HI,'493.9');
});

test('没有上界的音色不传 VOICE_HI，脚本按不设限处理',async t=>{
  const b=boot(t,{voiceProfiles:fakeVoices({current:'magnetic'})});
  b.jobs.select(b.source);await b.jobs.start();
  assert.equal(b.processes[0].options.env.VOICE_HI,undefined);
  assert.equal(b.processes[0].options.env.VOICE_LO,'165');
});

test('切音色会落到档案上，并且不需要重跑分析就能换推荐值',async t=>{
  const state={current:'magnetic'};
  const b=boot(t,{voiceProfiles:fakeVoices(state)});
  b.jobs.select(b.source);await b.jobs.analyze();
  const p=b.processes[0],folder=path.dirname(p.args[2]);
  fs.mkdirSync(path.join(folder,'work'),{recursive:true});
  fs.writeFileSync(path.join(folder,'work','report.json'),JSON.stringify({
    tempo:123,key:{label:'A# 小调'},vocal:{p05:115,p50:232,p90:329,span:18.2},advice:[],
    voices:[
      {id:'magnetic',name:'磁性',semitones:6,conflict:false,keyAfter:'E 小调'},
      {id:'warm',name:'温暖',semitones:7,conflict:false,keyAfter:'F 小调'},
    ],
  }));
  p.emit('close',0);
  assert.equal(b.jobs.snapshot().tune.recommended,6);
  b.jobs.setVoice('warm');
  assert.equal(state.current,'warm');
  assert.equal(b.jobs.snapshot().tune.recommended,7);
  assert.equal(b.jobs.snapshot().tune.keyAfter,'F 小调');
});

test('制作中不能换音色，否则正在跑的那首会带着旧参考做完',async t=>{
  const b=boot(t,{voiceProfiles:fakeVoices()});
  b.jobs.select(b.source);await b.jobs.start();
  assert.throws(()=>b.jobs.setVoice('sunyanzi'),/制作中|取消/);
});

test('分析模式只读报告：不合成音频、不入曲库',async t=>{
  const b=boot(t,{voiceProfiles:fakeVoices()});
  b.jobs.select(b.source);await b.jobs.analyze();
  const p=b.processes[0];
  assert.equal(p.options.env.ANALYZE_ONLY,'1');
  assert.equal(p.options.env.PREVIEW_SEC,undefined);
  const folder=path.dirname(p.args[2]);
  fs.mkdirSync(path.join(folder,'work'),{recursive:true});
  fs.writeFileSync(path.join(folder,'work','report.json'),JSON.stringify({
    tempo:123,key:{label:'A# 小调'},vocal:{p05:115,p50:232,p90:329,span:18.2},advice:['节奏不用调'],
    voices:[{id:'magnetic',name:'磁性',semitones:6,conflict:false,keyAfter:'E 小调'}],
  }));
  p.emit('close',0);
  const snap=b.jobs.snapshot();
  assert.equal(snap.job.status,'analyze-done');
  assert.equal(snap.analysis.tempo,123);
  assert.equal(snap.tune.recommended,6);
  assert.equal(snap.songs.length,0);
});

test('分析退出码 0 但没有报告算失败，不能假装分析成功',async t=>{
  const b=boot(t,{voiceProfiles:fakeVoices()});
  b.jobs.select(b.source);await b.jobs.analyze();
  b.processes[0].emit('close',0);
  const snap=b.jobs.snapshot();
  assert.equal(snap.job.status,'error');
  assert.match(snap.job.error,/分析|人声/);
  assert.equal(snap.analysis,null);
});

test('分析不需要参考音色，别为了算音域先合成一段',async t=>{
  let asked=false;
  const b=boot(t,{voiceProfiles:fakeVoices(),reference:async()=>{asked=true;return {audio:'x'};}});
  b.jobs.select(b.source);await b.jobs.analyze();
  assert.equal(asked,false);
});
