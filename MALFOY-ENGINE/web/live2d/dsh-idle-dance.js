/* Occasional idle dance: one finite humming session, cancelled by real activity. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DshIdleDance=api;})(globalThis,function(){
 'use strict';
 class Controller{
  constructor({media,createAudio=url=>new Audio(url),random=Math.random,onError=()=>{}}){
   Object.assign(this,{media,createAudio,random,onError});this.enabled=true;this.sound=true;this.volume=.35;this.track=media.defaultTrack;this.next=0;this.session=null;this.audio=null;this.generation=0;this.error=null;
  }
  reset(now){this.next=now+180000+this.random()*180000;}
  stop(now){const active=!!this.session;this.session=null;this.generation++;if(this.audio){this.audio.pause();try{this.audio.currentTime=0;}catch(_){}}this.reset(now);return active;}
  setTrack(key,now){if(!this.media.tracks[key])return false;this.stop(now);this.audio=null;this.track=key;return true;}
  setSound(on){this.sound=!!on;if(this.audio)this.audio.muted=!this.sound;}
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));if(this.audio)this.audio.volume=this.volume;}
  request(now,manual=false){if(!this.media.tracks[this.track])return false;this.stop(now);this.error=null;this.session={requestedAt:now,startedAt:null,manual};return true;}
  tick(c,now){
   const blocked=!c.available||c.activity!=='idle'||c.speaking||c.mediaPlaying||c.hidden||c.reducedMotion||c.perched||c.dragging||c.travel;
   if(blocked){const was=this.stop(now);return was?'stop':null;}
   const s=this.session;
   if(s){
    if(s.startedAt!=null && (c.key!=='shunguai'||c.pending&&c.pending!=='shunguai'||!c.manual)){this.stop(now);return 'stop';}
    if(s.startedAt==null){
     if(now-s.requestedAt>5000){this.stop(now);return 'stop';}
     if(c.key!=='shunguai'||c.pending)return null;
     s.startedAt=now;
     if(!this.audio)this.audio=this.createAudio(this.media.tracks[this.track].url);
     const audio=this.audio,own=++this.generation;audio.loop=false;audio.volume=this.volume;audio.muted=!this.sound;audio.currentTime=0;
     Promise.resolve(audio.play()).then(()=>{if(own!==this.generation)audio.pause();}).catch(()=>{if(own!==this.generation)return;audio.pause();this.error='浏览器未允许声音，请点击“立即跳一段”再试。';this.onError(this.error);});
    }
    if(now-s.startedAt>=this.media.tracks[this.track].duration*1000){this.stop(now);return 'stop';}
    return null;
   }
   if(!this.enabled||c.menuOpen){this.reset(now);return null;}
   if(c.manual||c.emotionAge<6)return null;
   if(!this.next){this.reset(now);return null;}
   if(now<this.next||c.scene!=='idle'||!['idle','perch'].includes(c.locomotion))return null;
   this.request(now);return 'start';
  }
  rate(videoDuration){const duration=this.media.tracks[this.track].duration;return videoDuration>0?videoDuration*Math.max(1,Math.round(duration/videoDuration))/duration:1;}
  get snapshot(){return {active:!!this.session,started:!!this.session&&this.session.startedAt!=null,enabled:this.enabled,sound:this.sound,volume:this.volume,track:this.track,nextAt:this.next,error:this.error,audioPaused:this.audio?.paused??true,audioTime:this.audio?.currentTime||0,audioMuted:this.audio?.muted??!this.sound};}
 }
 return {Controller};
});
