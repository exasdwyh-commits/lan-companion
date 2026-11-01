(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CompanionPlayback=api;})(globalThis,function(){
  'use strict';
  // 单一播音主体：歌、朗读、聊天共用同一个 <audio>。
  // 聊天改成流式后一句一个音频片段，所以这里多了一条「排队」能力：
  // load() 是「换台」（打断当前），enqueue() 是「接着说」（等上一条播完）。
  //
  // stop() 默认带 90ms 淡出。参考实现是 AIri 的打断链路
  // （ref/airi-v0.14.1 packages/audio/src/browser/audio-output.ts:116-122）：
  // 用音频时钟做 linearRamp，而不是直接 pause()。理由很实在 ——
  // 说话说到一半被硬切，听起来是「设备坏了」；淡出 90ms 听起来是「她停下了」。
  const DEFAULTS={fadeMs:90};
  class Player{
    constructor({audio,prepare=()=>{},active=()=>{},text=()=>{},progress=()=>{},fadeMs=DEFAULTS.fadeMs,clock=null}){
      Object.assign(this,{audio,prepare,active,text,progress});
      this.current=null;this.lastReport=0;this.lastLyric=null;this.generation=0;
      this.queue=[];
      this.fadeMs=Math.max(0,Number(fadeMs)||0);
      // 注入时钟：淡出要能被单测驱动，否则只能靠 sleep 去等真实毫秒。
      this.clock=clock||{now:()=>Date.now(),setInterval:(f,ms)=>setInterval(f,ms),clearInterval:(id)=>clearInterval(id)};
      this.fade=null;
      audio.addEventListener('ended',()=>this.finish('ended'));
      audio.addEventListener('error',()=>this.finish('error'));
      audio.addEventListener('timeupdate',()=>{
        const p=this.current;if(!p)return;
        if(p.lyrics?.length){const line=[...p.lyrics].reverse().find(l=>l.at<=audio.currentTime)?.zh;if(line&&line!==this.lastLyric){this.lastLyric=line;this.text(line);}}
        if(Date.now()-this.lastReport>500){this.lastReport=Date.now();this.report('time');}
      });
    }
    report(event){if(this.current?.token!=null)this.progress({token:this.current.token,event,time:this.audio.currentTime||0,duration:Number.isFinite(this.audio.duration)?this.audio.duration:0});}
    finish(event){
      if(!this.current)return;
      // 后面还有片段时不要报「停止说话」：逐句播报中间那一瞬间
      // 会让她从 speaking 掉回 idle，表情和动作会跟着抖一下。
      const more=this.queue.length>0;
      if(!more)this.active(this.current.kind,false);
      this.report(event);this.current=null;
      if(more)this._start(this.queue.shift());
    }
    /** 停播。opts.fadeMs 覆盖默认淡出；0 = 硬停。 */
    stop(opts){
      const ms=opts&&typeof opts.fadeMs==='number'?opts.fadeMs:this.fadeMs;
      const kind=this.current?.kind??null;
      // 立刻把「正在播」清掉：停止后新的 enqueue 不该还排在一条已经死掉的音轨后面。
      this.generation++;this.queue.length=0;this.current=null;
      if(kind)this.active(kind,false);
      if(ms>0&&!this.audio.paused)return this._fadeOut(ms);
      this._halt();
    }
    _cancelFade(){if(this.fade){try{this.clock.clearInterval(this.fade);}catch(_){}this.fade=null;}}
    _halt(){
      this._cancelFade();
      try{this.audio.pause();}catch(_){}
      try{this.audio.removeAttribute('src');this.audio.load();}catch(_){}
      try{this.audio.volume=1;}catch(_){}
    }
    _fadeOut(ms){
      this._cancelFade();
      const from=Number.isFinite(this.audio.volume)?this.audio.volume:1;
      const t0=this.clock.now();
      this.fade=this.clock.setInterval(()=>{
        const k=Math.min(1,(this.clock.now()-t0)/ms);
        try{this.audio.volume=Math.max(0,from*(1-k));}catch(_){}
        if(k>=1)this._halt();   // _halt 里会 clearInterval
      },10);
    }
    /** 换台：立刻打断在播的内容，清空排队。不求淡出——换内容是切换，不是句尾。 */
    load(p){this.stop({fadeMs:0});return this._start(p);}
    /** 接着说：上一条播完自动接上。用于流式回复的逐句播报。 */
    enqueue(p){
      if(!p)return;
      if(this.current){this.queue.push(p);return;}
      // 没有正在播的内容就立刻开始，别让第一句白等一个队列周期
      return this._start(p);
    }
    _start(p){
      this._cancelFade();   // 淡出途中被新内容顶替：音量必须立刻恢复，否则新的一句是哑的
      const own=this.generation;this.current=p;this.lastLyric=null;
      this.prepare();this.audio.volume=Math.max(0,Math.min(1,p.gain??1));
      this.audio.src=p.audio?'data:'+(p.mime||'audio/mp3')+';base64,'+p.audio:p.url;
      if(p.time>0)this.audio.addEventListener('loadedmetadata',()=>{if(own===this.generation)this.audio.currentTime=p.time;},{once:true});
      if(p.text)this.text(p.text);
      if(p.paused)return;
      this.active(p.kind,true);
      return this.audio.play().catch(()=>{if(own===this.generation)this.finish('error');});
    }
    command(p){
      if(!p||typeof p!=='object')return;
      if(p.action==='load')return this.load(p);
      if(p.action==='stop')return this.stop({fadeMs:p.fadeMs});
      if(p.token!==this.current?.token)return;
      if(p.action==='pause'){this.audio.pause();this.active(this.current.kind,false);}
      if(p.action==='resume'){this.active(this.current.kind,true);this.audio.play().catch(()=>this.finish('error'));}
    }
    get snapshot(){return {kind:this.current?.kind||null,token:this.current?.token??null,paused:this.audio.paused,time:this.audio.currentTime||0,duration:Number.isFinite(this.audio.duration)?this.audio.duration:0,queued:this.queue.length};}
  }
  return {Player,DEFAULTS};
});
