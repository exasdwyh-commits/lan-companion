'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn}=require('child_process');
const {pathToFileURL}=require('url');
const SVC_FILES=['svc/DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth','svc/config_dit_mel_seed_uvit_whisper_base_f0_44k.yml','svc/rmvpe.pt','whisper-small/model.safetensors','whisper-small/config.json','whisper-small/preprocessor_config.json','bigvgan44/config.json','bigvgan44/bigvgan_generator.pt','campplus/campplus_cn_common.bin'];
// 试听片段长度。25 秒够听出副歌的音域和音色，又不至于在 MPS 上跑太久。
const PREVIEW_SEC=25;
// 管线在分离之后会写这个文件：音域、BPM、调性、每个音色的推荐升幅。
const REPORT_FILE='report.json';
function findWorkspace(engine){return [process.env.LAN_PROJECT_ROOT,path.resolve(engine,'..'),path.resolve(engine,'../../../../..')].filter(Boolean).find(p=>fs.existsSync(path.join(p,'scripts/sing_cover_file.sh')))||null;}
function createCoverJobs({dir,workspace,ffmpeg,reference,voiceProfiles,publish=()=>{},spawnJob=spawn,killGroup=(pid,signal)=>process.kill(-pid,signal)}){
  const root=path.join(dir,'covers'),index=path.join(root,'library.json');fs.mkdirSync(root,{recursive:true});
  let selected=null,child=null,job=null,rows=[],preparing=false,generation=0;
  // 升调设置：null = 让脚本按人声音域自动判定；整数 = 用户手动指定。
  let tune={semitones:null};
  // 上一次的音域分析结果（脚本写在 work/range.json），用来给面板显示推荐值。
  let range=null;
  // 完整的歌曲分析（work/report.json）：带 BPM、调性和每个音色的方案。
  let report=null;
  // 试听产物。只在内存里记，不落进曲库 —— 试听是过程产物，做完整首才入库。
  let preview=null;
  try{rows=JSON.parse(fs.readFileSync(index,'utf8')).filter(x=>/^[a-f0-9-]{36}$/.test(x.id)&&fs.existsSync(path.join(root,x.id,'cover.m4a')));}catch(_){}
  function dependencies(){
    if(!workspace)return {ready:false,error:'未找到本机翻唱运行环境。'};
    const python=process.env.SING_PYTHON||path.resolve(workspace,'../.venvs/sing/bin/python');
    if(!fs.existsSync(python)||!fs.existsSync(path.join(workspace,'third_party/seed-vc/inference.py')))return {ready:false,error:'翻唱 Python 环境尚未就绪。'};
    if(SVC_FILES.some(f=>!fs.existsSync(path.join(workspace,'.models/seedvc',f))))return {ready:false,error:'歌声转换模型正在准备或尚未安装，准备好后再开始。'};
    return {ready:true,python};
  }
  function readRange(folder){
    try{range=JSON.parse(fs.readFileSync(path.join(folder,'work','range.json'),'utf8'));}catch(_){/* 还没分析过就保持 null */}
  }
  function readReport(folder){
    try{report=JSON.parse(fs.readFileSync(path.join(folder,'work',REPORT_FILE),'utf8'));}catch(_){report=null;}
  }
  function currentVoice(){
    if(!voiceProfiles)return null;
    const id=voiceProfiles.currentId();
    return (id&&voiceProfiles.find(id))||voiceProfiles.current()||null;
  }
  // 报告里对「当前音色」的方案。用户切音色后不用重跑分析 —— 音域和 BPM 是歌的属性，
  // 换音色只换推荐值，各音色的结论分析时已经一次算全了。
  function currentPlan(){
    if(!report||!Array.isArray(report.voices))return null;
    const id=voiceProfiles?voiceProfiles.currentId():null;
    return report.voices.find(v=>v.id===id)||report.voices[0]||null;
  }
  const snapshot=()=>({
    selected:selected?{title:selected.title}:null,
    job:job?{id:job.id,title:job.title,status:job.status,kind:job.kind,shift:job.shift??null,error:job.error||null,...(job.progress?{progress:{...job.progress}}:{})}:null,
    model:dependencies(),
    songs:rows.map(r=>({...r})),
    voices:voiceProfiles?voiceProfiles.list().map(v=>({
      id:v.id,name:v.name,tone:v.tone,usable:v.usable,
      lo:v.range.lo,hi:v.range.hi,lowNote:v.lowNote,highNote:v.highNote,
      current:v.id===voiceProfiles.currentId(),
    })):[],
    // 歌的分析结果：音域、BPM、调性、各音色方案。UI 直接照着念，不用自己算。
    analysis:report?{...report}:null,
    tune:{
      semitones:tune.semitones,
      applied:job?.shift??null,
      recommended:currentPlan()?.semitones??range?.recommend?.semitones??null,
      reason:currentPlan()?.reason||range?.recommend?.reason||'',
      floor:currentVoice()?.range?.lo??range?.recommend?.targetFloor??null,
      // 音域分位数从报告里取；老 work 目录没有 report 时退回 range.json。
      source:report?.vocal
        ?{p05:report.vocal.p05,p50:report.vocal.p50,p90:report.vocal.p90}
        :(range?.source?{p05:range.source.p05,p50:range.source.p50,p90:range.source.p90}:null),
      conflict:Boolean(currentPlan()?.conflict),
      keyAfter:currentPlan()?.keyAfter||null,
    },
    preview:preview?{semitones:preview.semitones,url:pathToFileURL(preview.file).href}:null,
  });
  function emit(){publish(snapshot());}
  function select(file){
    if(child||preparing)throw new Error('先取消当前翻唱，才能更换原曲。');
    const ext=path.extname(file).toLowerCase();
    if(!['.mp3','.wav','.m4a','.flac','.ogg','.aac'].includes(ext))throw new Error('请选择 MP3、WAV、M4A 或 FLAC 音频。');
    if(fs.statSync(file).size>200*1024*1024)throw new Error('原曲上限 200MB，请先裁剪。');
    const id=crypto.randomUUID(),folder=path.join(root,id);fs.mkdirSync(folder);const dest=path.join(folder,'source'+ext);fs.copyFileSync(file,dest);
    selected={id,file:dest,title:path.basename(file,ext).slice(0,100)};job=null;preview=null;range=null;report=null;emit();return snapshot();
  }
  function cancel(){
    if(!child&&!preparing)return snapshot();
    generation++;preparing=false;job.status='cancelled';
    const old=child;child=null;if(!old){emit();return snapshot();}
    try{killGroup(old.pid,'SIGTERM');}catch(_){}
    const timer=setTimeout(()=>{try{killGroup(old.pid,'SIGKILL');}catch(_){}},2000);timer.unref?.();old.once('close',()=>clearTimeout(timer));emit();return snapshot();
  }
  // 手动指定升调半音数；传 null 回到自动。
  function setTune(semitones){
    if(semitones===null||semitones===undefined){tune.semitones=null;emit();return snapshot();}
    const value=Math.round(Number(semitones));
    if(!Number.isFinite(value)||value< -12||value>12)throw new Error('升调范围是 -12 到 +12 个半音。');
    if(child||preparing)throw new Error('制作中不能改音域，先取消或等它跑完。');
    tune.semitones=value;emit();return snapshot();
  }
  // 换音色只换「谁在唱」。音域推荐值不用重算 —— 分析时已经把每个音色的方案
  // 一次算全了，切过去直接读报告里那一档。
  function setVoice(id){
    if(!voiceProfiles)throw new Error('音色档案还没有加载。');
    if(child||preparing)throw new Error('制作中不能换音色，等这首跑完或先取消。');
    voiceProfiles.set(id);emit();return snapshot();
  }
  async function analyze(){return launch('analyze');}
  async function launch(kind){
    if(child||preparing)throw new Error(kind==='analyze'?'上一首还在跑，等它结束或先取消。':'已经在制作一首翻唱。');
    if(!selected)throw new Error('先打开一首真正唱出来的原曲。');
    const deps=dependencies();if(!deps.ready)throw new Error(deps.error);
    const source=selected,folder=path.dirname(source.file);
    const output=path.join(folder,kind==='preview'?'preview.m4a':'cover.m4a');
    job={id:source.id,title:source.title,status:kind==='analyze'?'analyzing':'preparing',kind,shift:Number.isInteger(tune.semitones)?tune.semitones:null,error:null};
    const own=++generation;preparing=true;emit();
    let ref=null;
    // 分析只读音频，不需要参考音色 —— 别为了算个音域先合成一段。
    const voice=kind==='analyze'?null:currentVoice();
    if(voice&&voice.refPath)ref=voice.refPath;
    else if(kind!=='analyze'&&reference){
      try{const sample=await reference();if(own!==generation)return snapshot();if(!sample?.audio)throw new Error('女主参考音色未就绪。');ref=path.join(folder,'reference.mp3');fs.writeFileSync(ref,Buffer.from(sample.audio,'base64'));job.voice=sample.voice;}
      catch(error){if(own===generation){preparing=false;job.status='error';job.error=error.message;emit();}throw error;}
    }
    if(own!==generation)return snapshot();preparing=false;
    // SHIFT 不传时脚本自己按人声音域算 —— 见 scripts/voice_range.py。
    // 音色的音域（lo/hi）必须一起传下去，否则脚本只能按通用女声下界算，
    // 换音色就没有任何参数差异了。
    const env={...process.env,SING_PYTHON:deps.python,FFMPEG:ffmpeg,WORK:path.join(folder,'work'),KEEP_WORK:'1',STEPS:'30',...(ref?{REF:ref}:{})};
    if(voice&&voice.id)env.VOICE=voice.id;
    if(voice?.range?.lo)env.VOICE_LO=String(voice.range.lo);
    if(voice?.range?.hi)env.VOICE_HI=String(voice.range.hi);
    if(voice?.name)env.VOICE_NAME=voice.name;
    if(Number.isInteger(tune.semitones))env.SHIFT=String(tune.semitones);
    if(kind==='preview')env.PREVIEW_SEC=String(PREVIEW_SEC);
    if(kind==='analyze')env.ANALYZE_ONLY='1';
    const proc=spawnJob('/bin/bash',[path.join(workspace,'scripts/sing_cover_file.sh'),source.file,output],{cwd:workspace,detached:true,stdio:['ignore','pipe','pipe'],env});child=proc;
    let buffer='',errorBuffer='',failureStage=null,failureCode=null;
    const stageLabels={analyzing:'歌曲分析',analyze:'歌曲分析',source:'原曲准备',preparing:'原曲准备',separating:'人声与伴奏分离',converting:'歌声音色转换',shaping:'音色整形',mixing:'伴奏混音',validating:'成品音频校验'};
    proc.stdout.on('data',data=>{
      if(child!==proc)return;buffer+=String(data);const lines=buffer.split('\n');buffer=lines.pop().slice(-1000);
      for(const line of lines){
        const m=line.match(/^\[([1-4])\/4\]/);if(m){job.status=['preparing','separating','converting','mixing'][Number(m[1])-1];emit();}
        const progress=line.match(/^\[cover-progress\] chunk=(\d{1,5}) total=(\d{1,5})\r?$/);
        if(progress){const current=Number(progress[1]),total=Number(progress[2]);if(current>0&&current<=total){job.progress={current,total};emit();}}
        // 脚本定好调后会回显实际用的半音数，自动模式下这是唯一能拿到推荐值的地方。
        const shifted=line.match(/^\[cover-shift\] semitones=(-?\d{1,2})\r?$/);
        if(shifted){job.shift=Number(shifted[1]);readRange(folder);emit();}
      }
    });
    // Never retain raw subprocess logs: source paths and book/chat data do not
    // belong in diagnostics. Failure is explicit and never falls back to TTS.
    proc.stderr.on('data',data=>{
      if(child!==proc)return;
      errorBuffer+=String(data);const lines=errorBuffer.split('\n');errorBuffer=lines.pop().slice(-256);
      for(const line of lines){
        const m=line.match(/^\[cover-error\] stage=(source|separating|converting|shaping|mixing|validating) code=(\d{1,3})\r?$/);
        if(m){failureStage=m[1];failureCode=Number(m[2]);}
      }
    });
    const timeout=setTimeout(()=>{if(child===proc){cancel();job.status='error';job.error='制作超过 30 分钟，已停止。';emit();}},30*60*1000);timeout.unref?.();
    function fail(code){if(child!==proc)return;clearTimeout(timeout);child=null;
      const stage=stageLabels[failureStage||job.status]||'翻唱制作';
      const exit=failureCode??(Number.isInteger(code)?code:null);
      job.status='error';job.error=stage+'失败'+(exit!==null?'（退出码 '+exit+'）':'')+'；可重试并复用已完成步骤。';emit();}
    proc.once('error',()=>fail());
    proc.once('close',code=>{
      clearTimeout(timeout);if(child!==proc)return;
      // 分析模式不产音频，成功与否只看 report.json 有没有出来。
      if(kind==='analyze'){
        if(code!==0){fail(code);return;}
        child=null;readReport(folder);readRange(folder);
        if(!report){job.status='error';job.error='没能分析出音域：这首歌可能没有人声，或人声分离失败。';emit();return;}
        job.status='analyze-done';emit();return;
      }
      if(code!==0||!fs.existsSync(output)||fs.statSync(output).size<1000){if(code===0){failureStage='validating';failureCode=null;}fail(code===0?undefined:code);return;}
      child=null;readRange(folder);readReport(folder);
      if(kind==='preview'){
        // 试听不进曲库：它只是「这个参数听起来行不行」的证据，还可能被反复覆盖。
        preview={file:output,semitones:job.shift??0};job.status='preview-done';emit();return;
      }
      job.status='done';rows=rows.filter(r=>r.id!==source.id);
      rows.unshift({id:source.id,title:source.title,createdAt:new Date().toISOString(),engine:'seed-vc-svc-f0-44k'+(job.shift?`@${job.shift>0?'+':''}${job.shift}`:''),duration:Math.round(job.duration||0)||undefined});
      fs.writeFileSync(index+'.tmp',JSON.stringify(rows,null,2));fs.renameSync(index+'.tmp',index);emit();
    });emit();return snapshot();
  }
  async function start(){return launch('full');}
  async function runPreview(){return launch('preview');}
  function audio(id){const song=rows.find(r=>r.id===id);if(!song)throw new Error('找不到这首已完成的翻唱。');return {id:song.id,title:song.title,url:pathToFileURL(path.join(root,song.id,'cover.m4a')).href};}
  function previewAudio(){if(!preview)throw new Error('还没有试听片段。');return {id:'preview',title:(job?.title||selected?.title||'试听')+'（试听）',url:pathToFileURL(preview.file).href};}
  return {snapshot,select,start,runPreview,analyze,cancel,setTune,setVoice,audio,previewAudio};
}
module.exports={createCoverJobs,findWorkspace,SVC_FILES};
