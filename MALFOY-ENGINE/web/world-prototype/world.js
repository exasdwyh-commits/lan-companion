(() => {
  const container = document.getElementById('canvas');
  const bubble = document.getElementById('bubble');
  const activity = document.getElementById('activity');
  const detail = document.getElementById('detail');
  const state = window.worldPrototype = {ready:false, mode:'idle', position:{x:0,z:0}, target:null, place:'center', auto:true, autoVisits:0, path:[], lighting:'day', error:null};
  try {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xaac1d9);
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
    const renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe7f4ff,0x8495af,2));
    const light = new THREE.DirectionalLight(0xfff3d8,2); light.position.set(-3,8,6); scene.add(light);
    const mat = (c, extra={}) => new THREE.MeshStandardMaterial({color:c,roughness:.85,...extra});
    const box = (w,h,d,c,x,y,z) => {const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(c));m.position.set(x,y,z);scene.add(m);return m};
    const floor=box(8,.18,6,0xe5e8e2,0,-.1,0); box(8,3.5,.16,0xd4e4e8,0,1.75,-3); box(.16,3.5,6,0xc1d6de,-4,1.75,0);
    for(let x=-3.6;x<4;x+=.8)box(.015,.006,6,0xc8d9da,x,.001,0);
    box(3.35,2.25,.07,0xf4eee1,.25,2.17,-2.89); const windowSky=box(2.98,1.9,.08,0x84bed2,.25,2.17,-2.82);
    box(.09,1.94,.09,0xf8f2e4,.25,2.17,-2.75);box(3,.09,.09,0xf8f2e4,.25,2.17,-2.74);
    const seaLines=[]; for(let i=0;i<6;i++){const wave=box(.55+i*.15,.018,.012,0xd2eff0,-.9+i*.42,1.58+i*.085,-2.69);seaLines.push(wave)}
    const sun = new THREE.Mesh(new THREE.CircleGeometry(.25,32),mat(0xffedc4));sun.position.set(1,2.65,-2.7);scene.add(sun);
    box(3.3,.12,.3,0xf7f0e1,.25,1.05,-2.7);
    box(1.75,.15,1,0xc7a984,-2.45,1.05,-1.65);for(const x of [-3.15,-1.75])for(const z of [-2,-1.3])box(.1,1,.1,0xa88770,x,.52,z);
    box(.5,.05,.38,0x779eb4,-2.4,1.15,-1.65);box(.45,.04,.3,0xf3ebd9,-2.37,1.2,-1.65);
    box(1.35,.24,1.35,0xd8e4e6,2.55,.35,-1.55);box(1.35,.92,.18,0xc1d3dc,2.55,.8,-2.12);
    box(1.12,.12,1.1,0xf4f0e6,2.55,.55,-1.53);box(.52,.17,.38,0xaacbd2,2.53,.68,-1.8);
    const rug=new THREE.Mesh(new THREE.CircleGeometry(1.55,64),mat(0xaac8d6));rug.rotation.x=-Math.PI/2;rug.position.set(.25,.02,.25);rug.scale.set(1.3,1,1);scene.add(rug);
    box(.85,.12,.85,0xe0c9a7,-2.9,.28,1.9); box(.65,.5,.65,0xb9d5d5,-2.9,.57,1.9);
    const vase = new THREE.Mesh(new THREE.SphereGeometry(.3,20,16),mat(0x799bb5));vase.position.set(-2.9,1,1.9);scene.add(vase);
    for(let i=0;i<5;i++){const flower=new THREE.Mesh(new THREE.SphereGeometry(.12,12,10),mat(i%2?0xecf3ed:0xaad1cf));flower.position.set(-2.9+Math.sin(i*2)*.3,1.25+i*.06,1.9+Math.cos(i*2)*.3);scene.add(flower)}
    // Small, original room details give the world a lived-in scale without external assets.
    const sphere=(rx,ry,rz,color,x,y,z)=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),mat(color));mesh.scale.set(rx,ry,rz);mesh.position.set(x,y,z);scene.add(mesh);return mesh};
    const cylinder=(rt,rb,h,color,x,y,z)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,20),mat(color));mesh.position.set(x,y,z);scene.add(mesh);return mesh};
    // Window dressing, clouds and a distant island remain behind the window frame.
    box(.22,2.12,.14,0xe9f0e9,-1.3,2.12,-2.67);box(.22,2.12,.14,0xe9f0e9,1.8,2.12,-2.67);
    for(const x of [-1.37,1.87]){box(.16,.08,.18,0xb6d0d0,x,1.7,-2.56);box(.08,2.15,.1,0xf8f2e6,x,2.15,-2.63)}
    sphere(.48,.10,.015,0xdcece6,-.55,2.62,-2.69);sphere(.28,.13,.015,0xdcece6,-.35,2.65,-2.68);
    sphere(.48,.11,.018,0x83a6a3,-.65,1.65,-2.68);sphere(.24,.16,.018,0x779d99,-.73,1.68,-2.67);
    // A wall shelf of tiny books and keepsakes sits behind the walkable area.
    box(1.15,.08,.27,0xc5a887,-2.66,2.3,-2.8);
    const bookColors=[0x648ca1,0xe3b9a8,0x93b8b2,0xd4c6a9,0x7893a5];
    bookColors.forEach((color,i)=>box(.12,.36+(i%2)*.08,.15,color,-3.08+i*.14,2.52,-2.73));
    sphere(.1,.1,.1,0xf0dcc0,-2.17,2.46,-2.7);
    // A readable bedside nook: quilt, cushions, bedside lantern and books.
    box(1.12,.08,.56,0xc6dfe0,2.55,.64,-1.25);box(1.1,.025,.06,0xf5ede4,2.55,.69,-1.37);
    sphere(.32,.10,.19,0xf7f1e9,2.42,.72,-1.83);sphere(.18,.09,.16,0xb6d4d6,2.75,.74,-1.84);
    box(.37,.32,.4,0xc9ad8d,3.45,.17,-1.9);cylinder(.095,.12,.19,0xf8e7bb,3.45,.43,-1.9);sphere(.085,.09,.085,0xffefc8,3.45,.56,-1.9);
    // Desk lamp and a warm cup next to the existing open book.
    cylinder(.13,.15,.035,0x718fa0,-2.95,1.16,-1.9);cylinder(.025,.025,.4,0x718fa0,-2.95,1.35,-1.9);
    cylinder(.06,.18,.17,0xf1e3cb,-2.95,1.59,-1.9);cylinder(.09,.08,.14,0xe4f0ea,-1.94,1.2,-1.43);
    // Window light and contact shadows are inexpensive transparent meshes.
    const lightPatch=new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.35),new THREE.MeshBasicMaterial({color:0xfff2d1,transparent:true,opacity:.17,depthWrite:false,side:THREE.DoubleSide}));lightPatch.rotation.x=-Math.PI/2;lightPatch.rotation.z=-.25;lightPatch.position.set(.85,.012,-1.1);scene.add(lightPatch);
    function contact(x,z,sx,sz){const m=new THREE.Mesh(new THREE.CircleGeometry(1,32),new THREE.MeshBasicMaterial({color:0x516d7a,transparent:true,opacity:.12,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.set(x,.014,z);m.scale.set(sx,sz,1);scene.add(m)}
    contact(-2.45,-1.65,1.08,.65);contact(2.55,-1.55,.95,.85);contact(-2.9,1.9,.55,.55);
    const lampGlow=new THREE.PointLight(0xffd39e,0,5);lampGlow.position.set(-2.5,1.7,-1.55);scene.add(lampGlow);
    const motes=[];for(let i=0;i<14;i++){const mote=new THREE.Mesh(new THREE.SphereGeometry(.025,8,6),new THREE.MeshBasicMaterial({color:0xfaf4cf,transparent:true,opacity:.55}));mote.position.set(-3+(i*1.71)%6,.5+(i*.79)%2.3,-2+(i*1.31)%4);mote.userData.baseY=mote.position.y;scene.add(mote);motes.push(mote)}
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.45,32),new THREE.MeshBasicMaterial({color:0x496779,transparent:true,opacity:.2,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.025;scene.add(shadow);
    const texture=new THREE.TextureLoader().load('../../../assets/whale-chibi-directions-2026-10-31/B-master-v1.png',()=>{state.ready=true},undefined,()=>{state.error='character image failed';document.getElementById('failure').hidden=false});texture.colorSpace=THREE.SRGBColorSpace;
    const character=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));character.scale.set(1.8,1.98,1);character.position.set(0,1,0);scene.add(character);
    const marker = new THREE.Mesh(new THREE.RingGeometry(.12,.17,32),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.8,side:THREE.DoubleSide}));marker.rotation.x=-Math.PI/2;marker.position.y=.035;marker.visible=false;scene.add(marker);
    const places={window:{x:.3,z:-1.45,label:'在窗边看海',message:'海风很轻，陪我看一会儿吧。'},desk:{x:-1.5,z:-.9,label:'来到书桌旁',message:'今天要读哪一本书呢？'},rest:{x:1.4,z:-1,label:'在休息区旁',message:'先在这里休息一下吧。'},center:{x:0,z:.4,label:'正在房间里',message:'我回来啦。'}};
    let destination=null, route=[], angle=.65, pitch=.72, distance=13.5, drag=null, moved=false;
    let nextAutoAt=performance.now()+6000, autoIndex=0;
    const autoPlaces=['window','desk','center','rest'];
    const obstacles=[[-3.45,-1.5,-2.3,-1.0],[1.7,3.4,-2.4,-.65],[-3.5,-2.3,1.35,2.55]];
    const grid={step:.25,minX:-3.5,minZ:-2.5,cols:29,rows:21};
    function worldCell(x,z){return {x:Math.round((x-grid.minX)/grid.step),z:Math.round((z-grid.minZ)/grid.step)}}
    function point(c){return {x:grid.minX+c.x*grid.step,z:grid.minZ+c.z*grid.step}}
    function blocked(c){if(c.x<0||c.z<0||c.x>=grid.cols||c.z>=grid.rows)return true;const p=point(c);return obstacles.some(([x1,x2,z1,z2])=>p.x>=x1&&p.x<=x2&&p.z>=z1&&p.z<=z2)}
    function nearest(c){let best=null;for(let z=0;z<grid.rows;z++)for(let x=0;x<grid.cols;x++){const n={x,z};if(blocked(n))continue;const d=(x-c.x)**2+(z-c.z)**2;if(!best||d<best.d)best={...n,d}}return best}
    function findPath(from,to){const start=nearest(worldCell(from.x,from.z)),end=nearest(worldCell(to.x,to.z));if(!start||!end)return [];const id=c=>c.x+','+c.z, open=[start], came=new Map(),score=new Map([[id(start),0]]),closed=new Set();while(open.length){open.sort((a,b)=>(score.get(id(a))+Math.abs(a.x-end.x)+Math.abs(a.z-end.z))-(score.get(id(b))+Math.abs(b.x-end.x)+Math.abs(b.z-end.z)));const cur=open.shift(),k=id(cur);if(k===id(end)){const path=[];let node=cur;while(id(node)!==id(start)){path.push(point(node));node=came.get(id(node))}return path.reverse()}closed.add(k);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const n={x:cur.x+dx,z:cur.z+dz},nk=id(n);if(blocked(n)||closed.has(nk))continue;const cost=score.get(k)+1;if(cost<(score.get(nk)??Infinity)){came.set(nk,cur);score.set(nk,cost);if(!open.some(v=>id(v)===nk))open.push(n)}}}return []}
    const lightingButton=document.getElementById('lighting');lightingButton.addEventListener('click',()=>{const night=state.lighting==='day';state.lighting=night?'night':'day';scene.background.setHex(night?0x263e62:0xaac1d9);windowSky.material.color.setHex(night?0x436582:0x84bed2);sun.material.color.setHex(night?0xf1f2e4:0xffedc4);light.intensity=night?.55:2;lampGlow.intensity=night?3:0;lightPatch.material.opacity=night?.025:.17;lightingButton.textContent=night?'☼ 切换日光':'☾ 切换夜色';lightingButton.setAttribute('aria-pressed',String(night));document.querySelector('.stage').classList.toggle('night',night)});
    const autoButton=document.getElementById('autoplay');
    autoButton.addEventListener('click',()=>{state.auto=!state.auto;autoButton.setAttribute('aria-pressed',String(state.auto));autoButton.innerHTML='<i></i>自主探索：'+(state.auto?'开启':'暂停');nextAutoAt=performance.now()+6000;detail.textContent=state.auto?'她会自己在小屋里走动':'自主探索已暂停，仍可选择地点'});
    function updateCamera(){camera.position.set(Math.sin(angle)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.cos(angle)*Math.cos(pitch)*distance);camera.lookAt(0,.65,0)} updateCamera();
    function go(x,z,key,automatic=false){nextAutoAt=performance.now()+14000;const path=findPath({x:character.position.x,z:character.position.z},{x,z});if(!path.length){nextAutoAt=performance.now()+9000;if(Math.hypot(character.position.x-x,character.position.z-z)<.4){const p=places[key];state.place=key||'floor';activity.textContent=p?p.label:'正在房间里';bubble.textContent=p?p.message:'这里的风景也不错。'}return}if(automatic)state.autoVisits++;route=path;const last=route[route.length-1];destination={...last,key};state.path=route.map(p=>({...p}));state.target={...destination};state.mode='moving';state.place=key||'floor';marker.visible=true;marker.position.x=destination.x;marker.position.z=destination.z;activity.textContent='正在走过去';detail.textContent='她会绕开小屋里的家具';bubble.textContent='好，我过去看看。';document.querySelectorAll('[data-place]').forEach(b=>b.classList.toggle('active',b.dataset.place===key))}
    document.querySelectorAll('[data-place]').forEach(button=>button.addEventListener('click',()=>{const p=places[button.dataset.place];go(p.x,p.z,button.dataset.place)}));
    const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
    const hotspots=[];
    function hotspot(key,x,y,z,w,h,d){const hit=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({visible:false}));hit.position.set(x,y,z);hit.userData.place=key;scene.add(hit);hotspots.push(hit)}
    hotspot('window',.25,2.1,-2.72,3.25,2.1,.2);hotspot('desk',-2.45,.9,-1.65,1.8,1.2,1);hotspot('rest',2.55,.6,-1.55,1.4,1.2,1.4);
    renderer.domElement.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,angle,pitch};moved=false;renderer.domElement.setPointerCapture(e.pointerId)});
    renderer.domElement.addEventListener('pointermove',e=>{if(!drag){const r=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(mouse,camera);renderer.domElement.style.cursor=ray.intersectObjects(hotspots).length?'pointer':'grab';return}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)moved=true;if(moved){angle=THREE.MathUtils.clamp(drag.angle-dx*.006,-1.15,1.3);pitch=THREE.MathUtils.clamp(drag.pitch+dy*.005,.35,1.15);updateCamera()}});
    renderer.domElement.addEventListener('pointerup',e=>{if(drag&&!moved){const r=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(mouse,camera);const hits=ray.intersectObjects([...hotspots,floor]);if(hits.length){const key=hits[0].object.userData.place;if(key){const p=places[key];go(p.x,p.z,key)}else go(hits[0].point.x,hits[0].point.z,null)}}drag=null});
    renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();distance=THREE.MathUtils.clamp(distance+e.deltaY*.008,9,18);updateCamera()},{passive:false});
    function resize(){const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}window.addEventListener('resize',resize);resize();
    let previous=performance.now();function frame(now){const dt=Math.min((now-previous)/1000,.05);previous=now;
      if(destination){const next=route[0];const dx=next.x-character.position.x,dz=next.z-character.position.z,dist=Math.hypot(dx,dz),step=Math.min(dist,dt*1.35);if(dist<=step+.001){character.position.x=next.x;character.position.z=next.z;route.shift();state.path=route.map(p=>({...p}));if(!route.length){const key=destination.key,p=places[key];state.mode='idle';activity.textContent=p?p.label:'正在房间里';detail.textContent=key==='window'?'停下来看看海':key==='desk'?'在书桌旁稍作停留':key==='rest'?'在休息区旁放松一会儿':state.auto?'她会自己在小屋里走动':'自主探索已暂停';nextAutoAt=now+9000;bubble.textContent=p?p.message:'这里的风景也不错。';marker.visible=false;destination=null;state.target=null}}else{character.position.x+=dx/dist*step;character.position.z+=dz/dist*step}}
      if(!destination&&state.auto&&now>=nextAutoAt){const key=autoPlaces[autoIndex++%autoPlaces.length],p=places[key];go(p.x,p.z,key,true)}
      character.position.y=1+(destination?Math.abs(Math.sin(now*.012))*.075:Math.sin(now*.002)*.015);shadow.position.x=character.position.x;shadow.position.z=character.position.z;state.position={x:character.position.x,z:character.position.z};
      seaLines.forEach((wave,i)=>{wave.position.x=-.9+i*.42+Math.sin(now*.0005+i)*.08});motes.forEach((m,i)=>{m.position.y=m.userData.baseY+Math.sin(now*.001+i)*.09;m.material.opacity=state.lighting==='night'?.7:.3});
      const screen=character.position.clone().add(new THREE.Vector3(0,1.18,0)).project(camera);bubble.style.left=((screen.x+1)*50)+'%';bubble.style.top=((1-screen.y)*50)+'%';bubble.style.opacity=screen.z<1?'1':'0';
      renderer.render(scene,camera);requestAnimationFrame(frame)}requestAnimationFrame(frame);
  } catch(error){state.error=String(error);document.getElementById('failure').hidden=false;console.error(error)}
})();
