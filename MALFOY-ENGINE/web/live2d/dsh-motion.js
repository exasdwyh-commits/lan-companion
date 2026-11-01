/* dsh-pet animation playback. Art attribution: ./dsh-motion/NOTICE.md.
 * A decoded next frame replaces the current frame; generation guards late loads.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./dsh-catalog') : root.DshCatalog);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DshMotion = api;
})(globalThis, function (catalog) {
  'use strict';
  const LABELS=Object.fromEntries(Object.entries(catalog).map(([key,item])=>[key,item.label]));
  // Compatibility cue is hidden from the catalog, not counted as new art.
  const COMPAT={cuddle:'shy'};
  const BUSINESS={thinking:'thinking',working:'working',reading:'reading',singing:'singing',speaking:'chat'};
  const ANCHORS=Object.fromEntries(Object.entries(catalog).map(([key,item])=>[key,item.anchorY||330]));
  const EMOTIONS={happy:'happy',joy:'tickle',excited:'cheer',shy:'shy',sad:'sad',cry:'cry',angry:'pout',surprised:'surprise',curious:'confused',confused:'confused',love:'heart',affectionate:'hug',proud:'smug',smug:'smug',sleepy:'yawn',sorry:'apology'};
  function semantic(c) {
    if(c.dragging)return 'drag';
    if(BUSINESS[c.activity])return BUSINESS[c.activity];
    if(c.activity==null&&BUSINESS[c.scene])return BUSINESS[c.scene];
    if(c.locomotion==='walk')return 'walk';
    if(c.perched)return 'sit';
    if(c.emotionAge>=0 && c.emotionAge<5 && EMOTIONS[c.emotion])return EMOTIONS[c.emotion];
    return BUSINESS[c.scene] || ({dance:'shunguai',waving:'wave',celebrating:'success',shy:'shy',happy:'happy',sad:'sad',surprised:'surprise',sleeping:'sleep'})[c.scene] || 'idle';
  }
  class Player {
    constructor({container,createVideo=()=>document.createElement('video'),onReady=()=>{},onError=()=>{}}) {
      Object.assign(this,{container,onReady,onError});
      this.videos=[createVideo(),createVideo()];this.front=0;this.key=null;this.pending=null;this.generation=0;this.ready=false;this.enabled=true;this.manual=false;this.sleeping=false;this.lastAuto=null;
      for(const video of this.videos){video.muted=true;video.autoplay=false;video.playsInline=true;video.preload='auto';video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;pointer-events:none;';container.append(video);}
      this.set('idle',{loop:true});
    }
    set(key,{loop=false,done=null,restart=false}={}) {
      if(!restart&&(this.pending===key || this.key===key && !this.pending))return;
      const own=++this.generation, index=1-this.front, video=this.videos[index];
      this.pending=key;video.pause();video.onloadeddata=null;video.onended=null;video.onerror=null;
      video.playbackRate=1;video.src='./dsh-motion/'+key+'.webm';video.loop=loop;video.load();
      const fail=()=>{if(own!==this.generation)return;this.pending=null;if(!this.ready){this.enabled=false;this.onError(key);}else{this.manual=false;this.sleeping=false;this.lastAuto=null;this.onError(key);}};
      video.onerror=fail;
      video.onloadeddata=()=>{
        if(own!==this.generation)return;
        // Wait for playback before exposing this buffer. The previous frame stays visible on failure.
        Promise.resolve(video.play()).then(()=>{
          if(own!==this.generation){video.pause();return;}
          const old=this.videos[this.front];old.style.opacity='0';old.pause();
          video.style.opacity='1';this.front=index;this.key=key;this.pending=null;this.ready=true;this.onReady();
          video.onended=()=>{if(own!==this.generation)return;if(done)done();else{this.manual=false;this.lastAuto=null;this.set('idle',{loop:true});}};
        }).catch(fail);
      };
    }
    play(key,{loop=false}={}) {
      key=COMPAT[key]||key;
      if(key==='sleep'){this.sleep();return;}
      if(key==='wake'){this.wake();return;}
      if(!LABELS[key])return;
      this.sleeping=false;this.manual=true;this.lastAuto=null;this.set(key,{loop:loop||['idle','reading','sit'].includes(key),restart:true});
    }
    sleep(){this.sleeping=true;this.manual=true;this.set('sleep-in',{done:()=>{if(this.sleeping)this.set('sleep',{loop:true});}});}
    wake(){this.sleeping=false;this.manual=true;this.set('wake',{done:()=>{this.manual=false;this.set('idle',{loop:true});}});}
    release(){this.manual=false;this.sleeping=false;this.lastAuto=null;}
    tick(c){
      if(!this.enabled)return;
      if(c.dragging){if(this.sleeping)this.sleeping=false;this.manual=false;this.lastAuto='drag';this.set('drag',{loop:true});return;}
      if(this.manual && (BUSINESS[c.activity]||(c.activity==null&&BUSINESS[c.scene])))this.release();
      if(this.manual)return;
      const key=semantic(c);
      if(key===this.lastAuto)return;
      this.lastAuto=key;
      if(key==='sleep'){this.sleep();return;}
      this.set(key,{loop:['idle','walk','working','reading','thinking','singing','chat','sit'].includes(key)});
    }
    place(x,y,height,visible){
      this.container.style.display=visible&&this.enabled&&this.ready?'block':'none';
      this.container.style.width=(height*640/270)+'px';this.container.style.height=(height*360/270)+'px';
      this.container.style.left=x+'px';this.container.style.top=(y-height*(ANCHORS[this.key]||330)/270)+'px';
      if(!visible)for(const v of this.videos)v.pause();
      else if(this.ready){const v=this.videos[this.front];if(v.paused&&!v.ended)v.play().catch(()=>{});}
    }
    rect(){const r=this.container.getBoundingClientRect();return {left:r.left+r.width*.31,top:r.top+r.height*.16,width:r.width*.38,height:r.height*.77,right:r.left+r.width*.69,bottom:r.top+r.height*.93};}
    hitTest(x,y){
      const r=this.container.getBoundingClientRect();if(!this.ready||x<r.left||x>r.right||y<r.top||y>r.bottom)return false;
      try{
        if(!this.hitCanvas){this.hitCanvas=document.createElement('canvas');this.hitCanvas.width=160;this.hitCanvas.height=90;this.hitContext=this.hitCanvas.getContext('2d',{willReadFrequently:true});}
        const ctx=this.hitContext;ctx.clearRect(0,0,160,90);ctx.drawImage(this.videos[this.front],0,0,160,90);
        return ctx.getImageData(Math.max(0,Math.min(159,Math.floor((x-r.left)/r.width*160))),Math.max(0,Math.min(89,Math.floor((y-r.top)/r.height*90))),1,1).data[3]>24;
      }catch(_){const b=this.rect();return x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom;}
    }
    stop(){this.generation++;this.pending=null;for(const v of this.videos)v.pause();}
    get snapshot(){return {key:this.key,pending:this.pending,ready:this.ready,enabled:this.enabled,sleeping:this.sleeping,manual:this.manual};}
  }
  return {Player,LABELS,semantic,ANCHORS,catalog,EMOTIONS};
});
