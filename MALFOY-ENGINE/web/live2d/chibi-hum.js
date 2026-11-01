/* Dance humming controller: pure decision logic, no DOM/audio access.
   The stage feeds scene state each frame and performs the returned action. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.ChibiHum=api;})(globalThis,function(){
  "use strict";
  class HumController{
    constructor(){this.playing=false;}
    reset(){this.playing=false;}
    update(scene,context={}){
      const should=!!(scene&&scene.scene==="dance"&&context.audioReady&&!context.speaking&&!context.reducedMotion);
      if(should===this.playing)return null;
      this.playing=should;
      return should?"play":"stop";
    }
  }
  return {HumController};
});
