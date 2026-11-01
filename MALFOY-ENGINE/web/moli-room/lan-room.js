/* Wall photos, driven by the album.
 *
 * The frames are fixed: six positions on the two walls, created once at boot so
 * that the room's picking list never has to be rebuilt. What changes is which
 * photo sits in which slot — album.pin() decides that, this file only renders.
 */
(function () {
'use strict';
window.createLanRoom = function ({scene, originalPosters}) {
  const T=window.THREE, color=h=>new T.Color(h).convertSRGBToLinear();
  // Slot geometry is the wall rhythm: three of them are the original layout,
  // the rest are gaps that were already empty (below the poster, right of the
  // poster, further along the left wall). ry is the wall the frame hangs on.
  const SLOTS=[
    {x:-1.42,y:1.78,z:-2.00,ry:0,            maxW:.66,maxH:.90},
    {x:-0.62,y:1.94,z:-2.00,ry:0,            maxW:.62,maxH:.62},
    {x:-2.00,y:1.66,z:1.30,ry:Math.PI/2,     maxW:.58,maxH:.72},
    {x:-0.70,y:1.38,z:-2.00,ry:0,            maxW:.50,maxH:.34},
    {x:-2.00,y:1.86,z:0.34,ry:Math.PI/2,     maxW:.42,maxH:.52},
    {x:-2.00,y:1.30,z:2.00,ry:Math.PI/2,     maxW:.42,maxH:.52}
  ];
  for(const p of originalPosters)p.visible=false;
  const frames=[],status={loaded:0,errors:[],total:0};
  const frameMat=new T.MeshStandardMaterial({color:color(0xe9d5b4),roughness:.52,metalness:.08});
  const backing=new T.MeshStandardMaterial({color:color(0xf4eee1),roughness:.9});

  const dialog=document.createElement('dialog');dialog.className='lan-photo-view';dialog.setAttribute('aria-label','澜的照片');
  const close=document.createElement('button');close.className='lan-photo-close';close.textContent='关闭 ×';close.setAttribute('aria-label','关闭照片');
  const img=document.createElement('img'),caption=document.createElement('p'),note=document.createElement('p');
  note.className='lan-photo-note';
  dialog.append(close,img,caption,note);document.body.append(dialog);
  close.onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close();};
  dialog.addEventListener('close',()=>{img.removeAttribute('src');});

  // One group per slot, built once. The canvas texture is redrawn in place so a
  // re-pin never creates a new mesh (which would leave the old one pickable).
  const built=SLOTS.map((s,i)=>{
    const g=new T.Group();g.name='lan-photo-'+i;g.position.set(s.x,s.y,s.z);g.rotation.set(0,s.ry,0);
    g.visible=false;g.userData.tag=null;scene.add(g);
    const c=document.createElement('canvas');
    const tex=new T.CanvasTexture(c);tex.encoding=T.sRGBEncoding;tex.anisotropy=4;
    const surface=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshStandardMaterial({map:tex,roughness:.87}));
    const bar=new T.Mesh(new T.BoxGeometry(1,.02,.035),frameMat);
    const sideL=new T.Mesh(new T.BoxGeometry(.018,1,.035),frameMat);
    const sideR=new T.Mesh(new T.BoxGeometry(.018,1,.035),frameMat);
    const back=new T.Mesh(new T.BoxGeometry(1,1,.026),backing);
    g.add(back,surface,bar,sideL,sideR);
    frames.push(g);
    return {g,c,tex,surface,bar,sideL,sideR,back,slot:{...s,index:i},photo:null};
  });

  function paint(f,photo){
    const s=f.slot;
    const w=photo.w||s.maxW, h=photo.h||s.maxH;
    f.back.scale.set(w,h,1);f.back.position.set(0,0,0);
    f.surface.scale.set(w-.022,h-.022,1);f.surface.position.z=.019;
    f.bar.scale.set(w,.018,1);
    f.sideL.scale.set(1,h+.018,1);f.sideR.scale.set(1,h+.018,1);
    f.sideL.position.set(-w/2,0,.008);f.sideR.position.set(w/2,0,.008);
    const c=f.c, ctx=c.getContext('2d');
    c.width=Math.round(w*1300);c.height=Math.round(h*1300);
    const margin=c.width*.045,bottom=c.height*.105,px=margin,py=margin,pw=c.width-2*margin,ph=c.height-margin-bottom;
    const paper=()=>{
      ctx.fillStyle='#fffaf1';ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle='#455578';ctx.font=`${Math.round(c.width*.034)}px "PingFang SC", sans-serif`;
      ctx.textAlign='center';ctx.fillText(photo.title||'',c.width/2,c.height-bottom*.38);
    };
    paper();ctx.fillStyle='#c9d7e8';ctx.fillRect(px,py,pw,ph);f.tex.needsUpdate=true;
    const image=new Image();
    image.onload=()=>{
      paper();
      const ratio=pw/ph,ir=image.width/image.height;let sw=image.width,sh=image.height;
      if(ir>ratio)sw=sh*ratio;else sh=sw/ratio;
      const fx=.5,fy=.42;
      ctx.drawImage(image,(image.width-sw)*fx,(image.height-sh)*fy,sw,sh,px,py,pw,ph);
      f.tex.needsUpdate=true;status.loaded++;
    };
    image.onerror=()=>{status.errors.push(photo.url||'');ctx.fillStyle='#455578';ctx.font='18px sans-serif';ctx.fillText('照片加载失败',c.width/2,c.height/2);f.tex.needsUpdate=true;};
    image.src=photo.url;
    f.photo=photo;f.g.userData.tag='lan-photo-'+s.index;f.g.visible=true;
  }
  /** photos: [{url,title,note}] — index in the array is the wall slot. */
  function setPhotos(photos){
    status.loaded=0;status.errors=[];status.total=photos.length;
    for(const f of built){
      const p=photos[f.slot.index];
      if(p){paint(f,p);}
      else{f.photo=null;f.g.userData.tag=null;f.g.visible=false;}
    }
  }
  function open(i){
    const f=built[i];if(!f||!f.photo)return;
    img.src=f.photo.url;img.alt=f.photo.title||'';caption.textContent=f.photo.title||'';
    note.textContent=f.photo.note||'';note.style.display=f.photo.note?'block':'none';
    dialog.showModal();close.focus();
  }

  return {frames,status,open,setPhotos,slotCount:SLOTS.length};
};
})();
