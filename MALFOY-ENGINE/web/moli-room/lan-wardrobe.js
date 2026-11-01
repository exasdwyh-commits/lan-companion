/* Three themed outfits on Lan's existing mesh. The base positions, UVs, index,
   skin weights and skeleton never change; new cloth uses the same skeleton. */
(function () {
  'use strict';
  const STYLES = [
    { id: 'tide', name: '潮汐经典', sub: '海蓝礼裙 · 贝壳与珍珠', cloth: 0x285f86, light: 0xf2ead9, accent: 0xc8e7ed, roughness: .78, swatches: ['#286288','#f1eadc','#c6b68a'] },
    { id: 'mist', name: '雾蓝书房', sub: '针织小披肩 · 暖白系带', cloth: 0x88a9ae, light: 0xf6ecd9, accent: 0xb87568, roughness: .96, swatches: ['#88a9ae','#f6ecd9','#b87568'] },
    { id: 'astral', name: '星海晚宴', sub: '星绣披风 · 月牙发饰', cloth: 0x51466f, light: 0xe2dfed, accent: 0xd6b878, roughness: .69, swatches: ['#51466f','#ddd9eb','#d6b878'] }
  ];
  const KEY = 'lan.room.wardrobe.v1';
  window.createLanWardrobe = function ({ model, THREE: T = window.THREE, onFocus = () => {} }) {
    let chosen = 'tide', available = false, stored = true, mesh, groups = {}, fabric;
    try { const value = localStorage.getItem(KEY); if (STYLES.some(s => s.id === value)) chosen = value; } catch (_) { stored = false; }
    const state = { ready: false, id: chosen, styles: STYLES.map(s => ({id:s.id,name:s.name})), storage: stored, error: null };
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ic lan-wardrobe-button';
    button.setAttribute('aria-label', '澜的衣橱'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'lan-wardrobe'); button.dataset.tip = '澜的衣橱';
    button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 5a3 3 0 0 1 6 0c0 1.5-3 2.2-3 4v1L3.5 16a1.6 1.6 0 0 0 .9 3h15.2a1.6 1.6 0 0 0 .9-3L12 10"/></svg>';
    document.querySelector('nav.bar')?.append(button);
    const panel = document.createElement('section'); panel.id = 'lan-wardrobe'; panel.className = 'lan-wardrobe'; panel.hidden = true;
    panel.setAttribute('aria-label', '澜的衣橱'); panel.innerHTML = '<div class="lw-heading"><div><small>LAN · ATELIER</small><h2>澜的衣橱</h2></div><button class="lw-close" type="button" aria-label="收起衣橱">×</button></div><p class="lw-intro">今天，想穿哪一身？</p><div class="lw-cards" role="group" aria-label="选择造型"></div><p class="lw-status" role="status">正在整理衣橱…</p><button class="lw-focus" type="button">看看造型 ↗</button>';
    document.body.append(panel);
    const status = panel.querySelector('.lw-status'), cards = new Map();
    for (const s of STYLES) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'lw-card'; card.dataset.outfit = s.id; card.disabled = true;
      card.setAttribute('aria-label', '换上' + s.name); card.setAttribute('aria-pressed', String(chosen === s.id));
      const cape = s.id === 'tide' ? '' : '<path d="M36 22 24 57 39 66 50 49 62 66 77 57 64 22" fill="'+s.swatches[0]+'" stroke="'+s.swatches[2]+'" stroke-width="1.8"/>';
      card.innerHTML = '<span class="lw-look" style="--outfit:'+s.swatches[0]+'"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="m39 25-8 8 8 15-16 37q27 12 54 0L61 48l8-15-8-8-11 5Z" fill="'+s.swatches[0]+'"/><path d="M43 33h14l-2 18 11 29q-16 7-32 0l11-29Z" fill="'+s.swatches[1]+'"/>'+cape+'<path d="m43 30 7 7 7-7" fill="none" stroke="'+s.swatches[2]+'" stroke-width="3"/><circle cx="50" cy="39" r="3" fill="'+s.swatches[2]+'"/>'+(s.id==='astral'?'<path d="m74 12 2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1Z" fill="#d6b878"/>':'')+'</svg></span><span class="lw-card-copy"><strong>'+s.name+'</strong><small>'+s.sub+'</small><span class="lw-swatches">'+s.swatches.map(c=>'<i style="background:'+c+'"></i>').join('')+'</span></span><span class="lw-check" aria-hidden="true">✓</span>';
      card.onclick = () => select(s.id); panel.querySelector('.lw-cards').append(card); cards.set(s.id, card);
    }
    function show(open) { panel.hidden = !open; button.setAttribute('aria-expanded', String(open)); if (open) panel.querySelector('.lw-close').focus(); }
    button.onclick = () => show(panel.hidden);
    panel.querySelector('.lw-close').onclick = () => { show(false); button.focus(); };
    panel.querySelector('.lw-focus').onclick = () => { show(false); onFocus(); };
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); show(false); button.focus(); } });
    function select(id) {
      const style = STYLES.find(s => s.id === id); if (!available || !style) return false;
      chosen = state.id = id;
      fabric.cloth.value.setHex(style.cloth).convertSRGBToLinear(); fabric.light.value.setHex(style.light).convertSRGBToLinear(); fabric.roughness.value = style.roughness;
      for (const [key, group] of Object.entries(groups)) group.visible = key === id;
      for (const [key, card] of cards) card.setAttribute('aria-pressed', String(key === id));
      try { localStorage.setItem(KEY, id); } catch (_) { state.storage = false; }
      status.textContent = '已换上「' + style.name + '」' + (state.storage ? ' · 下次回来还穿这身' : ' · 本次有效');
      model.info.appearance = { id, name: style.name, sameSkeleton: true, garmentPieces: id === 'tide' ? 0 : 1 };
      return true;
    }
    const ready = model.ready.then(ok => {
      if (!ok) throw new Error('人物尚未加载');
      model.root.traverse(o => { if (o.name === 'lan-smooth-skin') mesh = o; });
      if (!mesh) throw new Error('人物网格不可用');
      const G = 1 / mesh.parent.scale.x, geo = mesh.geometry, indices = geo.attributes.skinIndex, weights = geo.attributes.skinWeight, pos = geo.attributes.position;
      const region = new Float32Array(pos.count * 2);
      const b = mesh.skeleton.bones, headIndex = b.findIndex(o => o.name === 'lan-head');
      for (let i = 0; i < pos.count; i++) {
        let head = 0, legs = 0;
        for (let k = 0; k < 4; k++) { const index = indices.array[i*4+k], w = weights.array[i*4+k]; if (index === headIndex) head += w; if (b[index]?.name.startsWith('lan-leg')) legs += w; }
        const y = pos.getY(i)/G;
        region[i*2] = y > .14 && y < .405 && head < .12 && legs < .25 ? 1 : 0;
        region[i*2+1] = head > .6 ? 1 : 0;
      }
      geo.setAttribute('lanSurface', new T.BufferAttribute(region, 2));
      fabric = { cloth: {value:new T.Color()}, light: {value:new T.Color()}, roughness: {value:.8} };
      // Keep GLTF's texture/normal settings and skinning flag. Only regional
      // color and cloth roughness change; hair and skin retain their texture.
      mesh.material = mesh.material.clone();
      mesh.material.onBeforeCompile = shader => {
        model.info.appearanceShader = {compiled:true, fabricVertices:region.filter((v,i)=>i%2===0&&v>.5).length};
        Object.assign(shader.uniforms, {lanCloth:fabric.cloth,lanLight:fabric.light,lanRoughness:fabric.roughness});
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 lanSurface; varying vec2 vLanSurface;');
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLanSurface=lanSurface;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLanSurface; uniform vec3 lanCloth; uniform vec3 lanLight; uniform float lanRoughness;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nfloat lanCool=smoothstep(0.003,0.055,diffuseColor.b-diffuseColor.r);\nfloat lanLum=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));\nfloat lanFabric=clamp(vLanSurface.x,0.0,1.0);\nfloat lanNavy=max(lanCool,1.0-smoothstep(0.06,0.24,lanLum));\nvec3 lanTint=lanCloth*(0.46+0.86*sqrt(max(0.0,lanLum)));\ndiffuseColor.rgb=mix(diffuseColor.rgb,lanTint,lanNavy*lanFabric*0.94);\nfloat lanPale=smoothstep(0.44,0.8,lanLum)*(1.0-lanCool);\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*lanLight,lanFabric*lanPale*0.4);');
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,lanRoughness,clamp(vLanSurface.x,0.0,1.0));\nroughnessFactor=mix(roughnessFactor,0.43,clamp(vLanSurface.y,0.0,1.0)*lanCool*0.45);');
      };
      mesh.material.customProgramCacheKey = () => 'lan-regional-fabric-v1'; mesh.material.needsUpdate = true;
      for (const style of STYLES) groups[style.id] = accessories(style, mesh, G);
      available = state.ready = true; for (const card of cards.values()) card.disabled = false;
      select(chosen); return true;
    }).catch(error => { state.error = String(error.message || error); status.textContent = '衣橱暂时未能打开，请刷新重试'; console.warn('Lan wardrobe:', error); return false; });
    return { ready, state, select, show, button, panel };

    function accessories(style, skin, G) {
      const holder = new T.Group(); holder.name = 'outfit-' + style.id; skin.parent.add(holder);
      const rootBone = skin.skeleton.bones.find(b => b.name === 'lan-root'), head = skin.skeleton.bones.find(b => b.name === 'lan-head');
      const bodyPieces = new T.Group(); bodyPieces.name = style.id + '-body-accessories'; rootBone.add(bodyPieces); bodyPieces.scale.setScalar(G);
      const headPieces = new T.Group(); headPieces.name = style.id + '-hair-accessories'; head.add(headPieces); headPieces.scale.setScalar(G);
      // All outfit pieces are switched together, including bone-parented props.
      Object.defineProperty(holder, 'visible', { get(){return bodyPieces.visible;}, set(v){bodyPieces.visible=headPieces.visible=v; for(const o of holder.children)o.visible=v;} });
      const metal = new T.MeshStandardMaterial({color:style.id==='mist'?0xbdc9c3:0xd7c08e,metalness:.58,roughness:.38});
      const pearl = new T.MeshStandardMaterial({color:0xf5e7d0,metalness:.08,roughness:.28});
      const trim = new T.MeshStandardMaterial({color:style.accent,roughness:.72,metalness:.05});
      function add(geometry, material, parent, position, name) { const o=new T.Mesh(geometry,material);o.name=name;o.position.fromArray(position);parent.add(o);o.castShadow=true;o.receiveShadow=true;return o; }
      function curve(points, radius, material, parent, name) {return add(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),32,radius,5,false),material,parent,[0,0,0],name);}
      const pendant = add(new T.SphereGeometry(.013,16,12),metal,bodyPieces,[0,.36,.132],'shell-brooch'); pendant.scale.set(1,.85,.32);
      for (let i=0;i<5;i++) curve([[0,.352,.138],[(i-2)*.004,.36,.139],[(i-2)*.004,.367,.135]],.0007,pearl,bodyPieces,'shell-ridge');
      curve([[-.047,.386,.088],[-.030,.369,.122],[0,.361,.133],[.030,.369,.122],[.047,.386,.088]],.0016,metal,bodyPieces,'fine-collar-chain');
      if(style.id==='tide') {
        for(let i=0;i<7;i++){const a=i/6*Math.PI;add(new T.SphereGeometry(.004,8,6),pearl,headPieces,[-.132+Math.cos(a)*.023,.202+Math.sin(a)*.017,.153],'pearl-hairpin');}
      } else {
        const cape=makeCape(style,skin,G); holder.add(cape);
        if(style.id==='mist') {
          for(const side of [-1,1]) {const tie=add(new T.SphereGeometry(.015,12,8),trim,bodyPieces,[side*.016,.355,.141],'velvet-ribbon');tie.scale.set(1.3,.58,.2);tie.rotation.z=side*.45;}
          curve([[0,.35,.143],[-.009,.32,.148],[-.018,.303,.151]],.0024,trim,bodyPieces,'ribbon-tail');
          curve([[.003,.35,.143],[.010,.32,.148],[.018,.310,.151]],.0024,trim,bodyPieces,'ribbon-tail');
        } else {
          const shape = new T.Shape();shape.absarc(0,0,.021,.35,Math.PI*2-.35,false);shape.absarc(.009,0,.017,-.6,-Math.PI*2+.6,true);
          const moon=add(new T.ExtrudeGeometry(shape,{depth:.003,bevelEnabled:true,bevelSize:.0006,bevelThickness:.0006,bevelSegments:1,steps:1}),metal,headPieces,[-.132,.222,.151],'crescent-hairpin');moon.rotation.z=-.4;
          curve([[-.129,.202,.155],[-.132,.184,.157],[-.128,.169,.158]],.0008,metal,headPieces,'moon-chain');
          add(new T.SphereGeometry(.0045,10,8),pearl,headPieces,[-.128,.167,.158],'moon-pearl');
        }
      }
      holder.visible=false; return holder;
    }
    function makeCape(style, skin, G) {
      const rows=14, cols=48, positions=[],uv=[],index=[],si=[],sw=[];
      const bones=skin.skeleton.bones, rootIndex=bones.findIndex(b=>b.name==='lan-root'), skirtIndex=bones.findIndex(b=>b.name==='lan-skirt');
      const upper=[0,1].map(s=>bones.findIndex(b=>b.name==='lan-arm-upper-'+s));
      for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){
        const v=r/rows,u=c/cols,theta=.62+u*(Math.PI*2-1.24),back=(1-Math.cos(theta))/2;
        const length=style.id==='mist'?.075:.105+.085*back;
        const radius=.062+.115*Math.sin(v*Math.PI/2),depth=.074+v*(style.id==='mist'?.048:.080);
        const pleat=1+.022*Math.sin(theta*14)*v;
        const x=Math.sin(theta)*radius*pleat,y=.399-length*v,z=.014+Math.cos(theta)*depth*pleat;
        positions.push(x*G,y*G,z*G);uv.push(u,1-v);
        const armWeight=Math.abs(Math.sin(theta))*.30*v,skirtWeight=style.id==='astral'?Math.max(0,v-.65)*.45:0;
        si.push(rootIndex,upper[x<0?0:1],skirtIndex,rootIndex);sw.push(1-armWeight-skirtWeight,armWeight,skirtWeight,0);
        if(r<rows&&c<cols){const a=r*(cols+1)+c,b=a+cols+1;index.push(a,b,a+1,b,b+1,a+1);}
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(si,4));geo.setAttribute('skinWeight',new T.Float32BufferAttribute(sw,4));geo.setIndex(index);geo.computeVertexNormals();
      const c=document.createElement('canvas');c.width=512;c.height=512;const g=c.getContext('2d');
      g.fillStyle='#'+new T.Color(style.cloth).getHexString();g.fillRect(0,0,512,512);
      if(style.id==='mist') {
        g.strokeStyle='rgba(240,235,218,.24)';g.lineWidth=1.5;
        for(let x=0;x<512;x+=12){g.beginPath();for(let y=0;y<512;y+=12){g.moveTo(x,y);g.lineTo(x+4,y+5);g.lineTo(x,y+10);}g.stroke();}
      } else {
        g.strokeStyle='#c8b681';g.fillStyle='#dfcd98';g.lineWidth=1.1;
        for(let i=0;i<26;i++){const x=26+(i*137%460),y=35+(i*83%410),s=i%4===0?5:2.5;g.beginPath();g.moveTo(x-s,y);g.lineTo(x,y+s);g.lineTo(x+s,y);g.lineTo(x,y-s);g.closePath();g.fill();}
        g.beginPath();g.moveTo(70,74);g.lineTo(158,130);g.lineTo(256,89);g.lineTo(355,152);g.stroke();
      }
      g.strokeStyle=style.id==='mist'?'#e1d7c0':'#cbb780';g.lineWidth=9;g.strokeRect(5,5,502,502);
      const tex=new T.CanvasTexture(c);tex.encoding=T.sRGBEncoding;tex.anisotropy=4;
      const mat=new T.MeshStandardMaterial({map:tex,color:0xffffff,roughness:style.roughness,metalness:0,skinning:true,side:T.DoubleSide});
      const cape=new T.SkinnedMesh(geo,mat);cape.name=style.id==='mist'?'knitted-capelet':'star-embroidered-cape';cape.frustumCulled=false;cape.castShadow=true;cape.receiveShadow=true;
      // Same bind space as the original mesh: no extra transform, no new bones.
      cape.bind(skin.skeleton,skin.bindMatrix);return cape;
    }
  };
})();
