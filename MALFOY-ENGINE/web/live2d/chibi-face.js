/* Independent facial parameters. Body poses and props never change here. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.ChibiFace=api;})(globalThis,function(){
  "use strict";
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const PRESETS=Object.freeze({
    calm:{eyes:1,mouth:"smile",blush:.15,brow:0},
    happy:{eyes:.9,mouth:"open",blush:.55,brow:.1,smileEyes:true},
    shy:{eyes:.65,mouth:"pout",blush:.9,brow:.2},
    focused:{eyes:.8,mouth:"small",blush:.1,brow:-.15},
    sad:{eyes:.75,mouth:"sad",blush:.25,brow:.65,tears:.8},
    surprised:{eyes:1.15,mouth:"round",blush:.3,brow:.5},
    sleepy:{eyes:.35,mouth:"small",blush:.2,brow:0},
    sleeping:{eyes:0,mouth:"small",blush:.2,brow:0},
    playful:{eyes:1,mouth:"smile",blush:.5,brow:.1,wink:true},
    pout:{eyes:.7,mouth:"pout",blush:.7,brow:-.65},
  });
  const MOODS={idle:"calm",happy:"happy",shy:"shy",thinking:"focused",working:"focused",reading:"focused",singing:"happy",sleeping:"sleepy",surprised:"surprised",sad:"sad",celebrating:"happy",waving:"happy",speaking:"calm"};
  const MOUTHS=new Set(["smile","small","open","round","sad","pout"]);
  class Controller{
    constructor(rng=Math.random){this.rng=rng;this.time=0;this.nextBlink=2.5;this.blinkUntil=0;this.override=null;this.custom=null;this.gaze={x:0,y:0};}
    setExpression(name,options={}){
      if(!Object.hasOwn(PRESETS,name))return false;
      const duration=options.duration??6;if(!Number.isFinite(duration)||duration<.1||duration>30)return false;
      this.override={name,until:this.time+duration};this.custom=null;return true;
    }
    setParameters(values){
      if(!values||typeof values!=="object"||Array.isArray(values))return false;
      const keys=Object.keys(values);if(!keys.length||keys.some(k=>!["eyes","mouthOpen","blush","brow","mouth","wink"].includes(k)))return false;
      for(const key of keys){
        const v=values[key];
        if(key==="mouth"){if(!MOUTHS.has(v))return false;}
        else if(key==="wink"){if(typeof v!=="boolean")return false;}
        else if(!Number.isFinite(v)||v<(key==="brow"?-1:0)||v>(key==="eyes"?1.2:1))return false;
      }
      this.custom={...this.custom,...values,until:this.time+15};return true;
    }
    clear(){this.override=null;this.custom=null;}
    blink(){this.blinkUntil=this.time+.17;return true;}
    tick(dt,context={}){
      dt=clamp(Number.isFinite(dt)?dt:0,0,.25);this.time+=dt;
      if(this.override&&this.time>=this.override.until)this.override=null;
      if(this.custom&&this.time>=this.custom.until)this.custom=null;
      const quiet=!!context.reducedMotion;
      if(!quiet&&this.time>=this.nextBlink){this.blink();this.nextBlink=this.time+2.8+this.rng()*3.2;}
      const base=this.override?.name||((context.scene==="sleeping"&&context.age>2.3)?"sleeping":MOODS[context.scene])||"calm";
      const value={...PRESETS[base],...this.custom};
      const blink=!quiet&&this.time<this.blinkUntil;
      const f=1-Math.exp(-dt*8);
      this.gaze.x+=(clamp(context.lookX||0,-1,1)-this.gaze.x)*f;
      this.gaze.y+=(clamp(context.lookY||0,-1,1)-this.gaze.y)*f;
      let mouthOpen=this.custom?.mouthOpen??(value.mouth==="open"?.6:0);
      if(context.speaking){mouthOpen=clamp(context.audioLevel||0);value.mouth=mouthOpen>.08?"open":"small";}
      // A visual song preview has no audio; live speech uses the analyser only.
      else if(context.scene==="singing"&&!this.custom&&!quiet)mouthOpen=.45+.3*Math.sin(this.time*5);
      return this.state={expression:base,eyes:blink?0:value.eyes,leftEye:blink||value.wink?0:value.eyes,rightEye:blink?0:value.eyes,
        mouth:value.mouth,mouthOpen,blush:value.blush,brow:value.brow,tears:value.tears||0,smileEyes:!!value.smileEyes,
        gazeX:quiet?0:this.gaze.x,gazeY:quiet?0:this.gaze.y,blinking:blink,independent:true};
    }
  }
  function paint(canvas,face,spec){
    const ctx=canvas.getContext("2d"),scale=3;
    if(canvas.width!==360||canvas.height!==270){canvas.width=360;canvas.height=270;}
    ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,120,90);
    const ink="#35243d",cy=32,gap=spec.gap||60;
    ctx.lineCap="round";ctx.lineJoin="round";
    for(const side of [-1,1]){
      const cx=60+side*gap/2,open=side<0?face.leftEye:face.rightEye;
      const blush=ctx.createRadialGradient(cx,cy+17,0,cx,cy+17,14);
      blush.addColorStop(0,`rgba(250,113,145,${face.blush*.64})`);blush.addColorStop(1,"rgba(250,113,145,0)");
      ctx.fillStyle=blush;ctx.beginPath();ctx.ellipse(cx,cy+17,15,8,0,0,Math.PI*2);ctx.fill();
      ctx.save();ctx.translate(cx,cy);
      ctx.strokeStyle=ink;ctx.lineWidth=2;
      if(open<.08||face.smileEyes){
        ctx.beginPath();ctx.moveTo(-13,0);ctx.quadraticCurveTo(0,face.smileEyes?-12:7,13,0);ctx.stroke();
      }else{
        ctx.save();ctx.scale(1,open);
        // Broad irises and a shallow upper lid match the painted face; round
        // white sockets looked like a second pair of glasses over the artwork.
        ctx.beginPath();ctx.moveTo(-16,-5);ctx.bezierCurveTo(-8,-12,8,-12,16,-5);ctx.bezierCurveTo(13,14,-12,15,-16,-5);ctx.closePath();
        ctx.fillStyle="#fffdf9";ctx.fill();ctx.save();ctx.clip();
        const ix=face.gazeX*3,iy=face.gazeY*2;
        const iris=ctx.createLinearGradient(0,-12,0,13);iris.addColorStop(0,"#163f8c");iris.addColorStop(.5,"#378fd2");iris.addColorStop(1,"#9ee8fb");
        ctx.fillStyle=iris;ctx.beginPath();ctx.ellipse(ix,iy,13.5,14,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#14356c";ctx.beginPath();ctx.ellipse(ix,iy-2,4.5,7,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#fff";ctx.beginPath();ctx.ellipse(ix-4,iy-5,3,3.5,-.3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(ix+5,iy+6,1.6,0,Math.PI*2);ctx.fill();ctx.restore();
        ctx.strokeStyle=ink;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-16,-5);ctx.bezierCurveTo(-8,-12,8,-12,16,-5);ctx.stroke();
        ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-12,5);ctx.quadraticCurveTo(0,16,12,5);ctx.stroke();
        ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(side*14,-6);ctx.lineTo(side*18,-9);ctx.stroke();ctx.restore();
      }
      ctx.strokeStyle="#41456c";ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(-9,-19-side*face.brow*5);ctx.quadraticCurveTo(0,-21,9,-19+side*face.brow*5);ctx.stroke();
      if(face.tears){ctx.fillStyle=`rgba(164,231,255,${face.tears})`;ctx.beginPath();ctx.ellipse(side*10,13,3,6,side*.2,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#65b6e4";ctx.lineWidth=.7;ctx.stroke();}
      ctx.restore();
    }
    if(spec.mouthOccluded)return;
    ctx.save();ctx.translate(60,58);ctx.strokeStyle="#a96472";ctx.fillStyle="#ab4a65";ctx.lineWidth=1.5;
    ctx.beginPath();
    if(face.mouth==="open"||face.mouth==="round"){
      const h=face.mouth==="round"?7:3+face.mouthOpen*9,w=face.mouth==="round"?5:8;
      ctx.ellipse(0,1,w,h,0,0,Math.PI*2);ctx.fill();ctx.save();ctx.clip();ctx.fillStyle="#ff93a7";ctx.beginPath();ctx.ellipse(0,h+1,w,4,0,0,Math.PI*2);ctx.fill();ctx.restore();
    }else if(face.mouth==="pout"){
      ctx.moveTo(-10,0);ctx.quadraticCurveTo(-4,6,0,0);ctx.quadraticCurveTo(5,6,10,0);ctx.stroke();
    }else {const w=face.mouth==="small"?3.5:8;ctx.moveTo(-w,0);ctx.quadraticCurveTo(0,face.mouth==="sad"?-5:face.mouth==="small"?1:6,w,0);ctx.stroke();}
    ctx.restore();
  }
  return {Controller,PRESETS,paint};
});
