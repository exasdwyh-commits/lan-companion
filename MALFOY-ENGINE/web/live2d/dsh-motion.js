/* dsh-pet animation playback. Art attribution: ./dsh-motion/NOTICE.md.
 * A decoded next frame replaces the current frame; generation guards late loads.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DshMotion = api;
})(globalThis, function () {
  'use strict';
  const LABELS = { idle:'发呆',wave:'挥手',walk:'散步',sleep:'睡觉',wake:'起床',thinking:'想事情',working:'写代码',success:'庆祝',dance:'跳舞',sway:'摇摆舞',stretch:'伸懒腰',snack:'吃零食',cat:'撸猫',magic:'变朵花',bubbles:'吐泡泡',shy:'害羞',happy:'开心',game:'玩魔方',flute:'吹笛子',reading:'做笔记',look:'张望',whale:'小鲸鱼' };
  function semantic(c) {
    if(c.dragging)return 'drag';
    if(c.locomotion==='walk')return 'walk';
    return ({thinking:'thinking',working:'working',reading:'reading',singing:'dance',speaking:'wave',waving:'wave',celebrating:'success',shy:'shy',happy:'happy',sleeping:'sleep'})[c.scene] || 'idle';
  }
  class Player {
    constructor({container,createVideo=()=>document.createElement('video'),onReady=()=>{},onError=()=>{}}) {
      Object.assign(this,{container,onReady,onError});
      this.videos=[createVideo(),createVideo()];this.front=0;this.key=null;this.pending=null;this.generation=0;this.ready=false;this.enabled=true;this.manual=false;this.sleeping=false;this.lastAuto=null;
      for(const video of this.videos){video.muted=true;video.autoplay=false;video.playsInline=true;video.preload='auto';video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;pointer-events:none;';container.append(video);}
      this.set('idle',{loop:true});
    }
    set(key,{loop=false,done=null}={}) {
      if(this.pending===key || this.key===key && !this.pending)return;
      const own=++this.generation, index=1-this.front, video=this.videos[index];
      this.pending=key;video.pause();video.onloadeddata=null;video.onended=null;video.onerror=null;
      video.src='./dsh-motion/'+key+'.webm';video.loop=loop;video.load();
      const fail=()=>{if(own!==this.generation)return;this.pending=null;if(!this.ready){this.enabled=false;this.onError(key);}else{this.manual=false;this.sleeping=false;this.lastAuto=null;this.onError(key);}};
      video.onerror=fail;
      video.onloadeddata=()=>{
        if(own!==this.generation)return;
        // Wait for playback before exposing this buffer. The previous frame stays visible on failure.
        Promise.resolve(video.play()).then(()=>{
          if(own!==this.generation){video.pause();return;}
          const old=this.videos[this.front];old.style.opacity='0';old.pause();
          video.style.opacity='1';this.front=index;this.key=key;this.pending=null;this.ready=true;this.onReady();
          video.onended=()=>{if(own!==this.generation)return;if(done)done();else{this.manual=false;this.set('idle',{loop:true});}};
        }).catch(fail);
      };
    }
    play(key) {
      if(key==='sleep'){this.sleep();return;}
      if(key==='wake'){this.wake();return;}
      if(!LABELS[key])return;
      this.sleeping=false;this.manual=true;this.set(key,{loop:key==='idle'});
    }
    sleep(){this.sleeping=true;this.manual=true;this.set('sleep-in',{done:()=>{if(this.sleeping)this.set('sleep',{loop:true});}});}
    wake(){this.sleeping=false;this.manual=true;this.set('wake',{done:()=>{this.manual=false;this.set('idle',{loop:true});}});}
    tick(c){
      if(!this.enabled)return;
      if(c.dragging){if(this.sleeping)this.sleeping=false;this.manual=false;this.lastAuto='drag';this.set('drag',{loop:true});return;}
      if(this.manual)return;
      const key=semantic(c);
      if(key===this.lastAuto)return;
      this.lastAuto=key;
      if(key==='sleep'){this.sleep();return;}
      this.set(key,{loop:['idle','walk','working','reading','thinking'].includes(key)});
    }
    place(x,y,height,visible){
      this.container.style.display=visible&&this.enabled&&this.ready?'block':'none';
      this.container.style.width=(height*640/270)+'px';this.container.style.height=(height*360/270)+'px';
      this.container.style.left=x+'px';this.container.style.top=(y-height*330/270)+'px';
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
  return {Player,LABELS,semantic};
});
