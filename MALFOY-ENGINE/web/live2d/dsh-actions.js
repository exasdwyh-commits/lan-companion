/* Catalog selection and optional quiet idle gestures. No audio or business commands. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DshActions=api;})(globalThis,function(){
  'use strict';
  const CATEGORIES={common:'常用',emotion:'表情',daily:'日常',food:'吃东西',play:'玩耍',music:'音乐',dance:'舞蹈',work:'工作',festival:'节日',fantasy:'奇趣'};
  const COMMON=['heart','hug','kiss','cheer','sad','cry','confused','smug','nod','shake-head','tea','reading','singing','chat','shunguai','wave','tickle','pout','stretch','sleep','sit'];
  const QUIET=['look','stretch','yawn','fan','mirror','bubbles','mumble','tea','phone','draw','cat','notes','confused','nod','happy'];
  function select(catalog,category='common',query=''){
    const q=query.trim().toLocaleLowerCase();
    return Object.entries(catalog).filter(([key,item])=>!item.hidden&&(q || category==='all' || (category==='common'?COMMON.includes(key):item.category===category))).filter(([key,item])=>!q||[key,item.label,CATEGORIES[item.category],item.generated?'新绘 表情 扩展':''].join(' ').toLocaleLowerCase().includes(q)).sort((a,b)=>category==='common'&&!q?COMMON.indexOf(a[0])-COMMON.indexOf(b[0]):0);
  }
  class IdleGestures{
    constructor({random=Math.random}={}){this.random=random;this.enabled=false;this.next=0;this.last=null;}
    reset(now){this.next=now+25000+this.random()*20000;}
    tick(c,now){
      if(!this.enabled || c.hidden || c.reducedMotion || c.menuOpen || c.activity!=='idle' || c.perched || c.dragging || c.manual || c.emotionAge<6){this.reset(now);return null;}
      if(c.scene!=='idle' || !['idle','perch'].includes(c.locomotion))return null;
      if(!this.next){this.reset(now);return null;}
      if(now<this.next)return null;
      this.reset(now);const pool=QUIET.filter(k=>k!==this.last);const key=pool[Math.min(pool.length-1,Math.floor(this.random()*pool.length))];this.last=key;return key;
    }
  }
  return {CATEGORIES,COMMON,select,IdleGestures};
});
