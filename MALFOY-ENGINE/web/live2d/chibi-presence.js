/* Screen-edge play and travel timing, independent of native windows/IPC. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.ChibiPresence=api;})(globalThis,function(){
  "use strict";
  const clamp=v=>Math.max(0,Math.min(1,v)),ease=v=>{v=clamp(v);return v*v*(3-2*v);};
  const lerp=(a,b,t)=>a+(b-a)*ease(t);
  class Controller{
    constructor(){this.action=null;this.serial=0;this.state={active:false,phase:"present",scale:1,opacity:1,rotation:0,portal:0};}
    peek(side,anchor){
      if(!["left","right","bottom"].includes(side)||this.action?.kind==="travel")return false;
      if(!anchor||![anchor.x,anchor.y].every(Number.isFinite))return false;
      this.action={kind:"peek",side,anchor:{x:anchor.x,y:anchor.y},t:0,id:++this.serial};return true;
    }
    travel(direction,target){
      if(!["in","out"].includes(direction)||!["desktop","world","dormant"].includes(target)||this.action?.kind==="travel"&&this.action.direction==="out")return false;
      this.action={kind:"travel",direction,target,t:0,id:++this.serial};return true;
    }
    cancel(){if(this.action?.kind==="travel")return false;this.action=null;this.state={active:false,phase:"present",scale:1,opacity:1,rotation:0,portal:0};return true;}
    tick(dt,context={}){
      dt=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,.25));
      const a=this.action,base={active:false,phase:"present",scale:1,opacity:1,rotation:0,portal:0};
      if(!a)return this.state=base;
      a.t+=dt;
      if(a.kind==="travel"){
        const duration=context.reducedMotion ? .12 : 1.05,k=clamp(a.t/duration),q=ease(k),arriving=a.direction==="in";
        const visible=arriving?q:1-q;
        const result={...base,active:true,id:a.id,kind:a.kind,target:a.target,direction:a.direction,phase:arriving?"arriving":"departing",
          progress:k,scale:context.reducedMotion?1:.08+.92*visible,opacity:visible,rotation:context.reducedMotion?0:(1-visible)*-.22,
          lift:context.reducedMotion?0:Math.sin(k*Math.PI)*34,portal:context.reducedMotion?0:Math.sin(k*Math.PI)};
        if(k===1){result.active=false;result.completed=true;this.action=null;}
        return this.state=result;
      }
      const {width:W,height:H,charWidth:w,charHeight:h}=context;
      if(![W,H,w,h].every(v=>Number.isFinite(v)&&v>0)){this.cancel();return this.state;}
      const side=a.side,start=a.anchor,bottom=side==="bottom",left=side==="left";
      const inside=bottom?{x:start.x,y:H-2}:{x:left?w*.55:W-w*.55,y:Math.min(H-2,Math.max(h,start.y))};
      const hidden=bottom?{x:inside.x,y:H+h*1.08}:{x:left?-w*.65:W+w*.65,y:inside.y};
      const peek=bottom?{x:inside.x,y:H+h*.63}:{x:left?-w*.16:W+w*.16,y:inside.y};
      // Reduced motion retains an accessible, visible pose; it never slides offscreen.
      if(context.reducedMotion){this.action=null;return this.state={...base,id:a.id,completed:true,kind:"peek",x:inside.x,y:inside.y,phase:"peek-static"};}
      const t=a.t;let from,to,k,phase;
      if(t<.8){from=start;to=inside;k=t/.8;phase="approaching";}
      else if(t<1.3){from=inside;to=hidden;k=(t-.8)/.5;phase="hiding";}
      else if(t<1.8){from=hidden;to=hidden;k=1;phase="hidden";}
      else if(t<2.35){from=hidden;to=peek;k=(t-1.8)/.55;phase="peeking";}
      else if(t<4.1){from=peek;to=peek;k=1;phase="peek-hold";}
      else if(t<4.55){from=peek;to=hidden;k=(t-4.1)/.45;phase="hiding-again";}
      else {from=hidden;to=inside;k=(t-4.55)/.7;phase="emerging";}
      const result={...base,active:t<5.25,id:a.id,kind:"peek",side,phase,x:lerp(from.x,to.x,k),y:lerp(from.y,to.y,k),
        rotation:bottom?0:(left ? .1 : -.1)*Math.sin(clamp((t-1.8)/2.3)*Math.PI),progress:clamp(t/5.25)};
      if(t>=5.25){result.completed=true;result.x=inside.x;result.y=inside.y;this.action=null;}
      return this.state=result;
    }
  }
  return {Controller};
});
