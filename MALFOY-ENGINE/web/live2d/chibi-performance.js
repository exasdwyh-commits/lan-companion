/* Semantic performances. No model, storage, IPC, or business success inference. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.ChibiPerformance=api;})(globalThis,function(){
  "use strict";
  const SCENES=Object.freeze({
    idle:{frames:[0],expression:"平静",prop:null},happy:{frames:[1],expression:"开心",prop:null},
    shy:{frames:[2],expression:"害羞",prop:null},thinking:{frames:[3],expression:"思考",prop:"问号"},
    working:{frames:[4,5],expression:"专注",prop:"眼镜、电脑"},reading:{frames:[6,7],expression:"专注阅读",prop:"书"},
    singing:{frames:[8,9],expression:"陶醉",prop:"麦克风、音符"},sleeping:{frames:[10,11],expression:"困倦",prop:"抱枕"},
    surprised:{frames:[12],expression:"惊讶",prop:null},sad:{frames:[13],expression:"委屈",prop:null},
    celebrating:{frames:[14],expression:"得意开心",prop:"星星"},waving:{frames:[15],expression:"微笑",prop:null},
    speaking:{frames:[0,1],expression:"说话",prop:null},
    // Walk cels live in a dedicated atlas (ChibiWalk); frames stay empty here so
    // the 16-pose atlas keeps index space untouched and absence degrades to idle.
    walk:{frames:[],expression:"走路",prop:null},
    // Dance cels (ChibiDance) same pattern; event-driven goofy state.
    dance:{frames:[],expression:"欢脱",prop:null},
  });
  const ACTIVITIES=new Set(["idle","thinking","working","reading","singing","speaking","sleeping"]);
  const EVENTS=Object.freeze({
    pet:{scene:"happy",duration:2.8,priority:30},shy:{scene:"shy",duration:3,priority:30},
    greet:{scene:"waving",duration:2.8,priority:30},surprise:{scene:"surprised",duration:2.4,priority:50},
    dance:{scene:"dance",duration:7,priority:35},
    "task-complete":{scene:"celebrating",duration:4,priority:60},
    "task-failed":{scene:"sad",duration:4.5,priority:60},
    "chat-failed":{scene:"sad",duration:3,priority:60},
    "good-night":{scene:"sleeping",duration:8,priority:40},
  });
  const ACTION_SCENES={look:"thinking",nod:"happy",stretch:"waving",greet:"waving",sway:"shy"};
  class Director{
    constructor(rng=Math.random){this.rng=rng;this.time=0;this.activity="idle";this.event=null;this.ambient=null;this.nextAmbient=7;this.idleFor=0;this.lastAmbient=null;this.scene="idle";this.sceneAge=0;}
    setActivity(name){
      if(!ACTIVITIES.has(name))return false;
      if(this.activity!==name){this.activity=name;this.ambient=null;this.idleFor=0;this.nextAmbient=this.time+6;}
      return true;
    }
    notify(name){
      if(!Object.hasOwn(EVENTS,name))return false;
      const spec=EVENTS[name];
      if(this.event && spec.priority<this.event.priority)return false;
      this.event={...spec,name,until:this.time+spec.duration};this.ambient=null;this.idleFor=0;return true;
    }
    emote(scene){
      if(!Object.hasOwn(SCENES,scene))return false;
      this.event={scene,name:"preview:"+scene,priority:70,until:this.time+4};this.idleFor=0;return true;
    }
    express(scene){
      if(!Object.hasOwn(SCENES,scene)||this.event?.priority>25)return false;
      this.event={scene,name:"emotion:"+scene,priority:25,until:this.time+3};return true;
    }
    tick(dt,context={}){
      dt=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,.25));this.time+=dt;
      if(this.event && this.time>=this.event.until)this.event=null;
      if(this.ambient && this.time>=this.ambient.until)this.ambient=null;
      const moving=["walk","jump","fall"].includes(context.locomotion);
      const occupied=this.activity!=="idle"||context.dragging||context.userNear||moving||this.event;
      this.idleFor=occupied?0:this.idleFor+dt;
      if(occupied)this.ambient=null;
      if(!occupied&&!context.reducedMotion&&!this.ambient&&this.time>=this.nextAmbient){
        const pool=this.idleFor>75?["sleeping"]:["happy","shy","waving","thinking"].filter(x=>x!==this.lastAmbient);
        const scene=pool[Math.min(pool.length-1,Math.floor(this.rng()*pool.length))];
        this.ambient={scene,until:this.time+(scene==="sleeping"?12:3.2)};this.lastAmbient=scene;this.nextAmbient=this.time+9+this.rng()*8;
      }
      let scene=this.event?.scene||this.ambient?.scene||this.activity;
      if(this.activity!=="idle" && (!this.event || this.event.priority<50))scene=this.activity;
      if(context.gesture && this.activity==="idle"&&!this.event&&!this.ambient)scene=ACTION_SCENES[context.gesture]||scene;
      if(context.dragging||context.locomotion==="jump"||context.locomotion==="fall")scene="surprised";
      // Dance is a dedicated-atlas scene; without that atlas fall back to a
      // regular cel so the reaction never renders a wrong pose.
      if(scene==="dance"&&!context.danceEnabled)scene="happy";
      // Walk cels override idle only: business activities, gestures, reactions
      // and dragging all keep their own pose while stationary or moving.
      if(context.walkEnabled&&scene!=="surprised"&&context.locomotion==="walk"&&this.activity==="idle"
        &&!this.event&&!this.ambient&&!context.gesture)scene="walk";
      if(scene!==this.scene){this.scene=scene;this.sceneAge=0;}else this.sceneAge+=dt;
      const spec=SCENES[scene],t=this.sceneAge,quiet=context.reducedMotion;
      const WALK_CYCLE=.16,DANCE_CYCLE=.22;
      const walk=scene==="walk"?Math.floor(t/WALK_CYCLE)%(context.walkFrames||6):null;
      const dance=scene==="dance"?(quiet?0:Math.floor(t/DANCE_CYCLE)%(context.danceFrames||8)):null;
      let variant=0;
      if(!quiet){
        if(scene==="working")variant=t%1.8>1.52?1:0;
        if(scene==="reading")variant=t%4.2>3.45?1:0;
        if(scene==="singing")variant=Math.floor(t/.65)%2;
        if(scene==="speaking")variant=Math.floor(t/.9)%2;
      }
      if(scene==="sleeping")variant=t>2.3?1:0;
      const bob=quiet||context.dragging?0:(scene==="celebrating"?Math.abs(Math.sin(t*6))*.035:scene==="singing"?Math.sin(t*3)*.009:scene==="walk"?0:Math.sin(this.time*1.8)*.0025);
      // Walk/dance cels carry their own motion; frame stays 0 as a safe idle
      // fallback for any consumer that ignores the dedicated atlas index.
      return this.state={scene,frame:(scene==="walk"||scene==="dance")?0:spec.frames[variant]??spec.frames[0],walk,dance,expression:spec.expression,prop:spec.prop,
        activity:this.activity,event:this.event?.name||null,age:t,bob,tilt:quiet?0:(scene==="shy"?-.025:scene==="singing"?Math.sin(t*2.2)*.025:context.dragging?Math.sin(this.time*7)*.025:0),
        reducedMotion:!!quiet};
    }
  }
  return {SCENES,EVENTS,ACTIVITIES,Director};
});
