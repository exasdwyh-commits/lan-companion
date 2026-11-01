/* Shared stage renderer: authored performances, with the constrained rig fallback. */
(function (root) {
  "use strict";
  const {Rig,BONES}=root.ChibiMotion;
  const VIEW={left:-.10,top:-.045,width:1.20,height:1.09};
  // 场景切换交叉淡入时长（dsh-pet 双缓冲同款手感）。
  const CROSSFADE_MS=150;
  class Renderer {
    constructor(canvas,image) {
      this.canvas=canvas; this.image=image; this.rig=new Rig(image.naturalWidth/image.naturalHeight);
      this.ready=false; this.lost=false;
      const gl=canvas.getContext("webgl",{alpha:true,premultipliedAlpha:true,antialias:true});
      if (!gl) throw new Error("WebGL unavailable; keep original PNG");
      this.gl=gl;
      canvas.addEventListener("webglcontextlost",e=>{e.preventDefault();this.lost=true;this.ready=false;this.onFailure?.();});
      // Stage switches to PNG immediately. Reload restores the renderer rather
      // than replaying stale GL handles after context loss.
      const shader=(type,source)=>{
        const s=gl.createShader(type); gl.shaderSource(s,source);gl.compileShader(s);
        if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error("Chibi shader compilation failed");
        return s;
      };
      const program=gl.createProgram();
      gl.attachShader(program,shader(gl.VERTEX_SHADER,"attribute vec2 aPosition; attribute vec2 aUV; varying vec2 vUV; void main(){vUV=aUV;gl_Position=vec4(aPosition,0.,1.);}"));
      gl.attachShader(program,shader(gl.FRAGMENT_SHADER,"precision mediump float; varying vec2 vUV; uniform sampler2D uTexture; uniform float uOpacity; void main(){vec4 c=texture2D(uTexture,vUV);gl_FragColor=vec4(c.rgb,c.a*uOpacity);}"));
      gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error("Chibi shader link failed");
      gl.useProgram(program);
      this.data=new Float32Array(this.rig.vertices.length*4);
      this.currentUV=new Float32Array(this.rig.vertices.length*2);
      this.opacity=gl.getUniformLocation(program,"uOpacity");
      this.attributes=[];
      this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,this.data.byteLength,gl.DYNAMIC_DRAW);
      for (const [name,offset] of [["aPosition",0],["aUV",8]]) {
        const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);
        this.attributes.push([a,offset]);
      }
      const indices=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(this.rig.triangles),gl.STATIC_DRAW);
      this.indices=indices;
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      this.baseTexture=texture;
      gl.uniform1i(gl.getUniformLocation(program,"uTexture"),0);
      gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0,0,0,0);
      this.baseMask=this.makeMask(image,192,192);this.mask=this.baseMask;
      this.displayMode="weighted-mesh-webgl";
      this.ready=true;
    }
    makeMask(image,width,height){
      const mask=document.createElement("canvas");mask.width=width;mask.height=height;
      const ctx=mask.getContext("2d",{willReadFrequently:true});ctx.drawImage(image,0,0,width,height);
      return {width,height,data:ctx.getImageData(0,0,width,height).data};
    }
    async loadAtlas(asset){
      const independentFaces=!!(asset.faceBase&&root.ChibiFace);
      const image=new Image();image.src=independentFaces?asset.faceBase.url:asset.url;await image.decode();
      if(this.lost)throw new Error("Context lost before performance atlas loaded");
      const gl=this.gl,texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      this.atlas={...asset,texture,independentFaces,mask:this.makeMask(image,768,768)};
      if(independentFaces){
        this.faceCanvas=document.createElement("canvas");
        this.faceBuffer=gl.createBuffer();this.faceIndices=gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.faceIndices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);
        this.faceTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.faceTexture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      }
    }
    resize(height) {
      this.height=height;
      const w=height*this.rig.aspect*VIEW.width,h=height*VIEW.height;
      const dpr=Math.min(devicePixelRatio||1,2);
      this.canvas.style.width=w+"px";this.canvas.style.height=h+"px";
      if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)) {
        this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);
        this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
      }
      return {width:w,height:h,bottomPadding:height*(VIEW.top+VIEW.height-1)};
    }
    async loadWalk(asset){
      const frames=Array.isArray(asset?.frames)?asset.frames:null;
      if(!frames||frames.length<4||frames.length>8)throw new Error("walk atlas needs 4-8 cels");
      if(!Number.isFinite(asset.width)||!Number.isFinite(asset.height)||!asset.url)throw new Error("walk atlas metadata incomplete");
      for(const frame of frames){
        const [x,y,w,h]=frame.rect||[];
        if(![x,y,w,h].every(v=>Number.isFinite(v))||x<0||y<0||w<=0||h<=0||x+w>asset.width||y+h>asset.height)
          throw new Error("walk cel rect invalid: "+(frame.name||"?"));
      }
      const image=new Image();image.src=asset.url;await image.decode();
      if(this.lost)throw new Error("Context lost before walk atlas loaded");
      const gl=this.gl,texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      this.walkBuffer=gl.createBuffer();this.walkIndices=gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.walkIndices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);
      this.walkAtlas={...asset,texture};
    }
    // Dance atlas mirrors the walk path (own texture, one quad per cel).
    // Kept as a near-copy on purpose: walk is already shipped and verified;
    // refactor to a shared quad helper only with both paths green.
    async loadDance(asset){
      const frames=Array.isArray(asset?.frames)?asset.frames:null;
      if(!frames||frames.length<4||frames.length>8)throw new Error("dance atlas needs 4-8 cels");
      if(!Number.isFinite(asset.width)||!Number.isFinite(asset.height)||!asset.url)throw new Error("dance atlas metadata incomplete");
      for(const frame of frames){
        const [x,y,w,h]=frame.rect||[];
        if(![x,y,w,h].every(v=>Number.isFinite(v))||x<0||y<0||w<=0||h<=0||x+w>asset.width||y+h>asset.height)
          throw new Error("dance cel rect invalid: "+(frame.name||"?"));
      }
      const image=new Image();image.src=asset.url;await image.decode();
      if(this.lost)throw new Error("Context lost before dance atlas loaded");
      const gl=this.gl,texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      this.danceBuffer=gl.createBuffer();this.danceIndices=gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.danceIndices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);
      this.danceAtlas={...asset,texture};
    }
    renderDance(scene,opacity){
      const asset=this.danceAtlas,frames=asset.frames;
      const n=((Number.isInteger(scene.dance)?scene.dance:0)%frames.length+frames.length)%frames.length;
      const [sx,sy,sw,sh]=frames[n].rect;
      if(!asset._unit){let maxH=0;for(const f of frames)maxH=Math.max(maxH,f.rect[3]);asset._unit=1/maxH;}
      const hf=sh*asset._unit,wf=(sw/sh)*hf/this.rig.aspect;
      const angle=scene.tilt||0,c=Math.cos(angle),s=Math.sin(angle),bob=scene.bob||0;
      const gl=this.gl,data=new Float32Array(16);
      const u0=sx/asset.width,u1=(sx+sw)/asset.width,v0=sy/asset.height,v1=(sy+sh)/asset.height;
      [[-wf/2,-hf,u0,v0],[wf/2,-hf,u1,v0],[wf/2,0,u1,v1],[-wf/2,0,u0,v1]].forEach(([px,py,u,v],i)=>{
        const x=c*px-s*py+.5,y=s*px+c*py+.97-bob;
        data.set([((x-VIEW.left)/VIEW.width)*2-1,1-((y-VIEW.top)/VIEW.height)*2,u,v],i*4);
      });
      gl.bindTexture(gl.TEXTURE_2D,asset.texture);this.displayMode="dance-atlas-webgl";
      gl.uniform1f(this.opacity,opacity);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.danceBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
      for(const [a,offset] of this.attributes)gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.danceIndices);gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      for(const [a,offset] of this.attributes)gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);
      return true;
    }
    renderWalk(scene,opacity){
      const asset=this.walkAtlas,frames=asset.frames;
      const n=((Number.isInteger(scene.walk)?scene.walk:0)%frames.length+frames.length)%frames.length;
      const [sx,sy,sw,sh]=frames[n].rect;
      // Normalise cel heights to one character unit so feet stay on one ground
      // line even when generation margins differ between cels.
      if(!this.walkUnit){let maxH=0;for(const f of frames)maxH=Math.max(maxH,f.rect[3]);this.walkUnit=1/maxH;}
      const hf=sh*this.walkUnit,wf=(sw/sh)*hf/this.rig.aspect;
      const angle=scene.tilt||0,c=Math.cos(angle),s=Math.sin(angle),bob=scene.bob||0;
      const gl=this.gl,data=new Float32Array(16);
      const u0=sx/asset.width,u1=(sx+sw)/asset.width,v0=sy/asset.height,v1=(sy+sh)/asset.height;
      [[-wf/2,-hf,u0,v0],[wf/2,-hf,u1,v0],[wf/2,0,u1,v1],[-wf/2,0,u0,v1]].forEach(([px,py,u,v],i)=>{
        const x=c*px-s*py+.5,y=s*px+c*py+.97-bob;
        data.set([((x-VIEW.left)/VIEW.width)*2-1,1-((y-VIEW.top)/VIEW.height)*2,u,v],i*4);
      });
      gl.bindTexture(gl.TEXTURE_2D,asset.texture);this.displayMode="walk-atlas-webgl";
      // upload() is not used on this path; keep the opacity uniform explicit or
      // the first-ever frame multiplies alpha by the default uniform value 0.
      gl.uniform1f(this.opacity,opacity===undefined?1:opacity);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.walkBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
      for(const [a,offset] of this.attributes)gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.walkIndices);gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      for(const [a,offset] of this.attributes)gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);
      return true;
    }
    upload(opacity=1){
      const gl=this.gl;gl.uniform1f(this.opacity,opacity);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,this.data);gl.drawElements(gl.TRIANGLES,this.rig.triangles.length,gl.UNSIGNED_SHORT,0);
    }
    sprite(frame,scene){
      const asset=this.atlas,spec=asset.frames[frame],p=this.rig.deformed;
      const [sx,sy,sw,sh]=spec.rect,{width,height,x,y}=spec.layout;
      const angle=scene.tilt||0,c=Math.cos(angle),s=Math.sin(angle);
      this.rig.vertices.forEach((v,i)=>{
        const px=v.u*width+x-.5,py=v.v*height+y-.97;
        p[i*2]=c*px-s*py+.5;p[i*2+1]=s*px+c*py+.97-(scene.bob||0);
        const u=(sx+.5+v.u*(sw-1))/asset.width,uv=(sy+.5+v.v*(sh-1))/asset.height;
        this.currentUV[i*2]=u;this.currentUV[i*2+1]=uv;
        this.data[i*4]=((p[i*2]-VIEW.left)/VIEW.width)*2-1;
        this.data[i*4+1]=1-((p[i*2+1]-VIEW.top)/VIEW.height)*2;
        this.data[i*4+2]=u;this.data[i*4+3]=uv;
      });
    }
    drawFace(scene,face){
      const spec=this.atlas.frames[scene.frame],f=spec.face;if(!f||!face)return;
      root.ChibiFace.paint(this.faceCanvas,face,f);
      const gl=this.gl,data=new Float32Array(16),[sx,sy,sw,sh]=spec.rect,L=spec.layout;
      const ca=Math.cos(f.angle),sa=Math.sin(f.angle),c=Math.cos(scene.tilt||0),s=Math.sin(scene.tilt||0);
      [[-60,-32,0,0],[60,-32,1,0],[60,58,1,1],[-60,58,0,1]].forEach(([dx,dy,u,v],i)=>{
        const px=L.x+(f.x+ca*dx-sa*dy-sx)/sw*L.width-.5;
        const py=L.y+(f.y+sa*dx+ca*dy-sy)/sh*L.height-.97;
        const x=c*px-s*py+.5,y=s*px+c*py+.97-(scene.bob||0);
        data.set([((x-VIEW.left)/VIEW.width)*2-1,1-((y-VIEW.top)/VIEW.height)*2,u,v],i*4);
      });
      gl.bindTexture(gl.TEXTURE_2D,this.faceTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.faceCanvas);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.faceBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
      for(const [a,offset] of this.attributes)gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.faceIndices);gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      for(const [a,offset] of this.attributes)gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);
    }
    render(pose,scene,face) {
      if(!this.ready) return false;
      const gl=this.gl;gl.clear(gl.COLOR_BUFFER_BIT);
      // 场景级交叉淡入（dsh-pet 双缓冲思路）：场景名变化时旧场景渐出、
      // 新场景渐入；同场景内的帧循环（眨眼/walk 步态）不淡，避免糊帧。
      const key=scene?scene.scene:null;
      const now=(typeof performance!=="undefined"?performance.now():Date.now());
      if(this._lastKey!==undefined&&key!==null&&this._lastKey!==null&&key!==this._lastKey){
        this._fadeFrom={...this._lastScene};
        this._fadeUntil=now+CROSSFADE_MS;
      }
      this._lastKey=key;this._lastScene=scene?{...scene}:null;
      const fading=this._fadeUntil>now&&this._fadeFrom;
      if(fading){
        const t=Math.min(1,1-(this._fadeUntil-now)/CROSSFADE_MS);
        this.drawScene(pose,this._fadeFrom,null,1-t);
        this.drawScene(pose,scene,face,t);
        return true;
      }
      this._fadeFrom=null;
      return this.drawScene(pose,scene,face,1);
    }
    drawScene(pose,scene,face,opacity) {
      const gl=this.gl;
      if(this.danceAtlas && scene && scene.scene==="dance" && Number.isInteger(scene.dance)){
        const drawn=this.renderDance(scene,opacity);
        if(drawn && this.atlas && this.atlas.frames[scene.frame])this.sprite(scene.frame,{bob:scene.bob,tilt:scene.tilt});
        return drawn;
      }
      if(this.walkAtlas && scene && scene.scene==="walk" && Number.isInteger(scene.walk)){
        // Dedicated walk atlas: draw cels as one quad (gait is baked into the
        // cels), then refresh idle UVs so hit-testing keeps a real silhouette.
        const drawn=this.renderWalk(scene,opacity);
        if(drawn && this.atlas && this.atlas.frames[scene.frame])this.sprite(scene.frame,{bob:scene.bob,tilt:scene.tilt});
        return drawn;
      }
      if(this.atlas && scene && this.atlas.frames[scene.frame]){
        gl.bindTexture(gl.TEXTURE_2D,this.atlas.texture);this.mask=this.atlas.mask;this.displayMode="performance-atlas-webgl";
        // Authored silhouettes differ (standing, sitting, arms raised). Blending
        // two whole figures creates double faces and extra limbs. Use animation
        // cels at full opacity; the director supplies timing and small motion.
        this.sprite(scene.frame,scene);this.upload(opacity);
        if(opacity>=1&&this.atlas.independentFaces)this.drawFace(scene,face);return true;
      }
      this.mask=this.baseMask;this.displayMode="weighted-mesh-webgl";gl.bindTexture(gl.TEXTURE_2D,this.baseTexture);
      const p=this.rig.solve(pose),aspect=this.rig.aspect;
      this.rig.vertices.forEach((v,i)=>{
        this.data[i*4]=((p[i*2]/aspect-VIEW.left)/VIEW.width)*2-1;
        this.data[i*4+1]=1-((p[i*2+1]-VIEW.top)/VIEW.height)*2;
        this.data[i*4+2]=v.u;this.data[i*4+3]=v.v;
        this.currentUV[i*2]=v.u;this.currentUV[i*2+1]=v.v;
      });
      this.upload();
      return true;
    }
    hitTest(clientX,clientY) {
      if(!this.ready) return false;
      const r=this.canvas.getBoundingClientRect();
      if(!r.width||!r.height||clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom) return false;
      const x=((clientX-r.left)/r.width*VIEW.width+VIEW.left)*this.rig.aspect;
      const y=(clientY-r.top)/r.height*VIEW.height+VIEW.top;
      const p=this.rig.deformed,tri=this.rig.triangles;
      for(let i=0;i<tri.length;i+=3) {
        const a=tri[i],b=tri[i+1],c=tri[i+2];
        const ax=p[a*2],ay=p[a*2+1],bx=p[b*2],by=p[b*2+1],cx=p[c*2],cy=p[c*2+1];
        const det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
        if(Math.abs(det)<1e-10) continue;
        const wa=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/det;
        const wb=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/det,wc=1-wa-wb;
        if(wa<0||wb<0||wc<0) continue;
        const uv=this.currentUV,u=uv[a*2]*wa+uv[b*2]*wb+uv[c*2]*wc,v=uv[a*2+1]*wa+uv[b*2+1]*wb+uv[c*2+1]*wc;
        const {width,height,data}=this.mask;
        const mx=Math.max(0,Math.min(width-1,Math.floor(u*width))),my=Math.max(0,Math.min(height-1,Math.floor(v*height)));
        if(data[(my*width+mx)*4+3]>32) return true;
      }
      return false;
    }
    drawDebug(canvas) {
      if(!canvas) return;
      canvas.width=this.canvas.width;canvas.height=this.canvas.height;
      const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
      const project=m=>[(m[4]/this.rig.aspect-VIEW.left)/VIEW.width*w,(m[5]-VIEW.top)/VIEW.height*h];
      ctx.strokeStyle="#36e2cd";ctx.fillStyle="#ffdc88";ctx.lineWidth=2;
      BONES.forEach((bone,i)=>{
        const [x,y]=project(this.rig.world[i]);
        if(bone.parent>=0){const [px,py]=project(this.rig.world[bone.parent]);ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();}
        ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
      });
    }
  }
  async function load(canvas,url) {
    const image=new Image();image.src=url;
    await image.decode();return new Renderer(canvas,image);
  }
  root.ChibiRenderer={Renderer,load,VIEW,CROSSFADE_MS};
  if(typeof module==="object"&&module.exports)module.exports={ChibiRenderer:root.ChibiRenderer};
})(globalThis);
