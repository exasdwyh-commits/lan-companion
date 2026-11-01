/* Window coordinates are relative to the desktop stage, as supplied by host.windows. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WindowPerch=api;})(globalThis,function(){
  'use strict';
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function eligible(w,{width,height,charHeight,seated=false}){
    const headroom=charHeight*(seated?.78:1)+8;
    return w&&[w.x,w.y,w.w,w.h].every(Number.isFinite)&&w.w>240&&w.h>160&&w.x<width&&w.x+w.w>0&&w.y>=headroom&&w.y<height-12;
  }
  function match(previous,list){
    if(!previous)return null;
    const id=previous.id??previous.windowId;
    if(id!=null)return list.find(w=>(w.id??w.windowId)===id)||null;
    // The current macOS host only supplies pid/app/bounds. A single surviving
    // window can move any distance; with siblings prefer the closest geometry.
    const candidates=list.filter(w=>w.app===previous.app&&(previous.pid==null||w.pid===previous.pid));
    candidates.sort((a,b)=>score(a)-score(b));
    function score(w){return Math.abs(w.x-previous.x)+Math.abs(w.y-previous.y)+Math.abs(w.w-previous.w)+Math.abs(w.h-previous.h);}
    if(candidates.length===1)return candidates[0];
    return candidates.length&&score(candidates[0])<180?candidates[0]:null;
  }
  function follow(previous,current,x,{width,charHeight,aspect=.92}){
    const margin=charHeight*aspect*.5+8;
    const left=clamp(current.x+margin,margin,width-margin),right=clamp(current.x+current.w-margin,left,width-margin);
    return {x:clamp(x+current.x-previous.x,left,right),y:current.y};
  }
  function choose(list,geometry,x){return list.filter(w=>eligible(w,geometry)).sort((a,b)=>Math.abs(a.x+a.w/2-x)-Math.abs(b.x+b.w/2-x))[0]||null;}
  return {eligible,match,follow,choose};
});
