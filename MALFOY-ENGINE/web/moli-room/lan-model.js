/* Lan's generated mesh has no authored rig. Keep its original geometry/UVs;
   fit an anatomical rest rig, continuous four-weight skinning, then retarget
   the room's ink-character poses to these proportions. Lower bones are LOCAL
   to their upper bones: neither joint offsets nor rotations may be applied twice. */
(function () {
  'use strict';
  window.createLanModel = function ({ moli, rig }) {
    const T = window.THREE, V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
    const root = new T.Group(); root.name = 'lan-multiview-model-v2'; moli.add(root);
    rig.visible = false;
    const status = document.createElement('p'); status.className = 'lan-model-status';
    status.setAttribute('role', 'status'); status.textContent = '正在迎接澜…';
    document.querySelector('.tag').append(status);
    const info = { state: 'loading', triangles: 0, rigged: false, localHeight: .78,
      rigVersion: 15, source: './assets/lan-room/lan-v2-game.glb?v=20261101-11' };
    let kGeom = 1, bonesByName, skinnedMesh, joints;
    const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const ready = new Promise(resolve => {
      new T.GLTFLoader().load(info.source, gltf => {
        boot(gltf).then(() => resolve(true), fail);
      }, undefined, fail);
      function fail(error) {
        info.state = 'error'; status.dataset.state = 'error';
        status.textContent = '澜暂时没能到达，刷新重试';
        console.error('Lan model load failed', error); rig.visible = true; resolve(false);
      }
    });

    async function boot(gltf) {
      let srcMesh;
      gltf.scene.traverse(o => { if (o.isMesh && !srcMesh) srcMesh = o; });
      if (!srcMesh) throw new Error('no mesh in glb');
      const geo = srcMesh.geometry.clone();
      gltf.scene.updateMatrixWorld(true); geo.applyMatrix4(srcMesh.matrixWorld); geo.computeBoundingBox();
      const bb = geo.boundingBox, size = bb.getSize(V3());
      geo.translate(-(bb.min.x + size.x / 2), -bb.min.y, -(bb.min.z + size.z / 2));
      kGeom = size.y / info.localHeight;
      geo.translate(.039*kGeom,0,0); // centre the body, not the asymmetrical tail
      geo.computeBoundingBox();
      info.triangles = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const holder = new T.Group(); holder.scale.setScalar(1 / kGeom); root.add(holder);
      const point = a => V3(...a).multiplyScalar(kGeom);
      // Landmarks fitted to THIS model: chin/neck .41, sleeve .37-.25,
      // hem .15, shoes .03. The ink-body shoulders (.275) are not these joints.
      const J = joints = {
        neck: point([0, .405, .025]),
        shoulder: [[-.09,.375,.025],[.09,.375,.025]].map(point),
        elbow: [[-.132,.302,.055],[.132,.302,.055]].map(point),
        wrist: [[-.163,.247,.075],[.163,.247,.075]].map(point),
        hip: [[-.062,.175,.015],[.062,.175,.015]].map(point),
        knee: [[-.066,.102,.025],[.066,.102,.025]].map(point),
        ankle: [[-.069,.032,.045],[.069,.032,.045]].map(point)
      };
      const rb = new T.Bone(); rb.name = 'lan-root'; holder.add(rb);
      const bone = (name, pos, parent) => { const b = new T.Bone(); b.name = name; b.position.copy(pos); parent.add(b); return b; };
      const spine = bone('lan-spine', V3(), rb), head = bone('lan-head', J.neck, rb);
      const skirt = bone('lan-skirt', point([0,.235,.015]), rb);
      const armUp=[],armLo=[],legUp=[],legLo=[];
      for (const s of [0,1]) {
        armUp[s]=bone(`lan-arm-upper-${s}`,J.shoulder[s],rb);
        armLo[s]=bone(`lan-arm-lower-${s}`,J.elbow[s].clone().sub(J.shoulder[s]),armUp[s]);
        legUp[s]=bone(`lan-leg-upper-${s}`,J.hip[s],rb);
        legLo[s]=bone(`lan-leg-lower-${s}`,J.knee[s].clone().sub(J.hip[s]),legUp[s]);
      }
      bonesByName={root:rb,spine,head,skirt,armUp,armLo,legUp,legLo};
      const bones=[rb,spine,head,skirt,...armUp,...armLo,...legUp,...legLo];
      await loadWeights(geo, bones);
      // ?bones=1 draws every joint so skin deformation can be judged against
      // the skeleton instead of guessed from the silhouette.
      if(location.search.indexOf('bones=1')>=0){
        const dot=new T.SphereGeometry(.011,8,6);
        const hues=[0xff3355,0x33ddff,0xffcc00,0x66ff88];
        bones.forEach((b,i)=>{
          const m=new T.Mesh(dot,new T.MeshBasicMaterial({color:hues[i%4],depthTest:false}));
          m.renderOrder=999;b.add(m);
        });
      }
      const mat=srcMesh.material.clone(); mat.skinning=true; mat.needsUpdate=true;
      skinnedMesh=new T.SkinnedMesh(geo,mat); skinnedMesh.name='lan-smooth-skin';
      skinnedMesh.castShadow=true; skinnedMesh.receiveShadow=true; skinnedMesh.frustumCulled=false;
      holder.add(skinnedMesh);
      // Refresh ANCESTORS too. Capturing bind inverses under a stale moli/root
      // world matrix bakes a room position/heading into the rest skeleton.
      root.updateWorldMatrix(true,true);
      skinnedMesh.bind(new T.Skeleton(bones));
      /* The dress is a SINGLE-SIDED sheet: its back faces are culled, so looking
         up from the hem sees straight through onto skin. Re-draw skirt-dominated
         faces from the inside as matching navy fabric, and add soft fabric
         shorts inside the hem. No mosaic — that read as censorship, not clothing.
         Both ride the skirt bone so the outer silhouette stays unchanged. */
      let bloomersMesh = null;
      try {
        const navy = new T.Color(0x1b2747);
        const navySoft = new T.Color(0x243352);
        const skirtFaces = buildSkirtLining(geo, bones, bonesByName.skirt);
        if (skirtFaces) {
          const liningMat = new T.MeshStandardMaterial({
            color: navy, roughness: .92, metalness: 0, skinning: true, side: T.BackSide,
            /* Hem facing the mattress gets almost no key light; a tiny solid
               emissive keeps the lining readable as cloth instead of a black void. */
            emissive: navySoft, emissiveIntensity: .22
          });
          const lining = new T.SkinnedMesh(skirtFaces, liningMat);
          lining.name = 'lan-skirt-lining'; lining.frustumCulled = false;
          lining.castShadow = false; lining.receiveShadow = true;
          lining.bind(skinnedMesh.skeleton, skinnedMesh.bindMatrix);
          holder.add(lining);
        }
        /* Soft fabric shorts: short cylinder (not a mosaic blob). Radius stays
           well under the skirt hem (~0.22 m) so it never pokes outside. */
        const shortGeo = new T.CylinderGeometry(1, 1.05, 1, 16, 1, false);
        const bloomers = new T.Mesh(shortGeo, new T.MeshStandardMaterial({
          color: new T.Color(0x152038), roughness: .9, metalness: 0,
          emissive: new T.Color(0x1a2438), emissiveIntensity: .18
        }));
        bloomers.name = 'lan-bloomers'; bloomers.castShadow = false; bloomers.receiveShadow = true;
        bloomers.position.set(0, -.078 * kGeom, -.010 * kGeom);
        bloomers.scale.set(.118 * kGeom, .055 * kGeom, .108 * kGeom);
        bonesByName.skirt.add(bloomers);
        bloomersMesh = bloomers;
        info.costume = {
          liningFaces: skirtFaces ? skirtFaces.index.count / 3 : 0,
          bloomers: true, mosaic: false, fabric: true
        };
      } catch (error) {
        // A cosmetic addition must never cost the whole model: fall back to the
        // bare dress and say so, instead of tripping the loader's fail() path.
        info.costume = { error: String(error && error.message || error) };
        console.warn('Lan skirt lining unavailable', error);
      }
      info._bloomers = () => bloomersMesh;
      // The room's blanket solver asks syncBlanketProxy() to place a world-space
      // box over her lying silhouette before it raycasts (it used to measure the
      // hidden ink body, which lies at a different height than this mesh).
      info.state='ready'; info.rigged=true; status.textContent='澜已到小屋'; status.dataset.state='ready';
    }

    /* The lining must deform with the outer cloth, so it shares the attribute
       buffers and keeps only the faces whose three corners are all dominated by
       the skirt bone. Filtering here also keeps the back faces of the rest of the
       body (which may be wound either way) from ever being drawn. */
    function buildSkirtLining(geo, bones, skirtBone) {
      const id = bones.indexOf(skirtBone), idx = geo.index, n = geo.attributes.position.count;
      const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
      if (id < 0 || !idx || !si || !sw) return null;
      const iArr = si.array, wArr = sw.array, dom = new Uint16Array(n);
      for (let v = 0; v < n; v++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = wArr[v * 4 + k]; if (w > bw) { bw = w; best = iArr[v * 4 + k]; } }
        dom[v] = best;
      }
      const keep = [];
      for (let f = 0; f < idx.count; f += 3) {
        const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2);
        if (dom[a] === id && dom[b] === id && dom[c] === id) keep.push(a, b, c);
      }
      if (!keep.length) return null;
      const out = new T.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) if (geo.attributes[name]) out.setAttribute(name, geo.attributes[name]);
      out.setAttribute('skinIndex', si);
      out.setAttribute('skinWeight', sw);
      out.setIndex(new T.BufferAttribute(new Uint32Array(keep), 1));
      return out;
    }

    async function loadWeights(geo, bones) {
      const [response,cutsResponse]=await Promise.all([
        fetch('./assets/lan-room/lan-v2-skin.bin?v=20261101-15'),
        fetch('./assets/lan-room/lan-v2-contact-cuts.bin?v=20261101-15')
      ]);
      if(!response.ok)throw new Error('Lan skin weights unavailable');
      if(!cutsResponse.ok)throw new Error('Lan contact repair unavailable');
      const buffer=await response.arrayBuffer(), header=new DataView(buffer);
      const magic=new TextDecoder().decode(new Uint8Array(buffer,0,8));
      const n=geo.attributes.position.count;
      if(magic!=='LANSKIN1'||header.getUint32(8,true)!==n||header.getUint32(12,true)!==4||buffer.byteLength!==16+n*24)
        throw new Error('Lan skin weights do not match mesh');
      const indices=new Uint16Array(buffer,16,n*4),values=new Float32Array(buffer,16+n*8,n*4);
      let blended=0;
      for(let i=0;i<n;i++) {
        let sum=0;
        for(let k=0;k<4;k++){const j=i*4+k;if(indices[j]>=bones.length||!Number.isFinite(values[j])||values[j]<0)throw new Error('Invalid Lan skin influence');sum+=values[j];}
        if(Math.abs(sum-1)>1e-5)throw new Error('Unnormalised Lan skin influence');
        if(values[i*4+1]>.01)blended++;
      }
      geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));
      geo.setAttribute('skinWeight',new T.Float32BufferAttribute(values,4));
      // The generated mesh fused fingers/cuffs into the hem and hanging locks.
      // Cut those contact faces on the render copy; keep shoulder/neck surfaces.
      const cuts=new Uint32Array(await cutsResponse.arrayBuffer()),old=geo.index;
      const removed=new Set(cuts);
      if([...removed].some(i=>i>=old.count/3))throw new Error('Invalid Lan contact face');
      const repaired=new Uint32Array(old.count-removed.size*3);let at=0;
      for(let f=0;f<old.count/3;f++)if(!removed.has(f))for(let k=0;k<3;k++)repaired[at++]=old.getX(f*3+k);
      geo.setIndex(new T.BufferAttribute(repaired,1));
      info.triangles=repaired.length/3;
      info.contactTrianglesRemoved=removed.size;
      info.skin={vertices:n,blendedVertices:blended,method:'surface-geodesic',transitionScale:.025};
    }

    const dir=V3(),perp=V3(),globalLower=new T.Quaternion(),inverseUpper=new T.Quaternion();
    function solveChain(upper,lower,start,joint,endRest,target,hint) {
      const restUpper=joint.clone().sub(start),restLower=endRest.clone().sub(joint);
      const l1=restUpper.length(),l2=restLower.length();
      dir.copy(target).sub(start);const raw=dir.length();
      if(raw<1e-8)dir.copy(restUpper).normalize();else dir.divideScalar(raw);
      const len=clamp(raw,Math.abs(l1-l2)+1e-5,(l1+l2)*.995);
      const along=(l1*l1-l2*l2+len*len)/(2*len),h=Math.sqrt(Math.max(0,l1*l1-along*along));
      perp.copy(hint).addScaledVector(dir,-hint.dot(dir));
      if(perp.lengthSq()<1e-8){perp.set(0,0,1).addScaledVector(dir,-dir.z);if(perp.lengthSq()<1e-8)perp.set(1,0,0).addScaledVector(dir,-dir.x);}
      perp.normalize();
      const mid=start.clone().addScaledVector(dir,along).addScaledVector(perp,h);
      const end=start.clone().addScaledVector(dir,len);
      upper.position.copy(start);
      upper.quaternion.setFromUnitVectors(restUpper.clone().normalize(),mid.clone().sub(start).normalize());
      // The child translation is the BIND offset; its parent already moves it
      // to the IK elbow/knee. Convert the desired global rotation to local.
      lower.position.copy(restUpper);
      globalLower.setFromUnitVectors(restLower.clone().normalize(),end.clone().sub(mid).normalize());
      inverseUpper.copy(upper.quaternion).invert();lower.quaternion.copy(inverseUpper).multiply(globalLower);
      return end;   // ankle tip, in root-local geometry units
    }
    const target=V3(),hint=V3(),lookLocal=V3(),legEnd=[V3(),V3()];
    // Diagnostics: pelvis offset in metres and the sole height of each foot
    // above her floor plane (negative = clipped through it).
    const dbg={rootYm:0,soleL:0,soleR:0,floorGap:0};
    // A chibi body carries only .111 m of leg. The upstream sitting rule drops
    // the hip by .148 m (hips to zero), which is deeper than her whole leg, so
    // her pelvis and soles end up under the floor. Keep the pelvis above a
    // sitting height and let the soles do the grounding instead.
    const HIP_SEATED=.072;
    // Metres to slide her toward the headboard when lying down (see pose()).
    // Tuned so her crown lands on the pillow: with the quilt box ending at her
    // shoulders and the cloth easing ~0.35 m backwards, anything further toward
    // the foot leaves her face under the blanket.
    const LYING_SLIDE=.26;
    function pose(C,look,time,dt,bookHeld=false) {
      if(!info.rigged||!C)return;
      const J=joints,G=kGeom,b=bonesByName;
      const lying=smooth(.8,1.45,Math.abs(C.pitch));
      const seated=1-smooth(.02,.18,C.y);
      const grounded=1-lying;   // floor contact only applies while she is upright
      /* Her torso bottom sits at y .66 while this bed's mattress tops out at
         .53 (measured by raycast across the whole mattress), so she hovered
         0.13 m over the sheet and the quilt only lifted around her, never
         over her -- the "not in the quilt" look. Drop her the full 0.13 m so
         her back actually rests on the mattress; hair and hem may sink into
         the cloth. */
      let rootYm=(C.y-.19)*.78*(1-lying)-.07*lying;
      if(grounded>.5)rootYm=Math.max(rootYm,HIP_SEATED-J.hip[0].y/G);
      /* The room's lie anchor was tuned for the 0.78 ink body. This mesh is
         1.30 m from crown to sole, so the anchor puts her head through the
         headboard (z -2.03 against a bed that ends at -2.00) and leaves her
         legs past the quilt. Slide her toward the pillow while lying only. */
      b.root.position.set(0,rootYm*G,LYING_SLIDE*lying*G);
      b.root.rotation.set(C.pitch,0,C.roll);
      if(look) {
        moli.updateWorldMatrix(true,false);lookLocal.copy(look);moli.worldToLocal(lookLocal);
        const yaw=clamp(Math.atan2(lookLocal.x,lookLocal.z),-.32,.32);
        b.head.rotation.set(clamp((lookLocal.y-.6)*.2,-.12,.12)*(1-lying),yaw*(1-lying),Math.sin(time*1.3)*.008*(1-lying));
      } else b.head.rotation.set(0,0,0);
      for(const s of [0,1]) {
        const sign=s?1:-1,hand=s?C.hr:C.hl;
        // Retarget offsets from the source's standing hands/feet, not absolute
        // source coordinates. This preserves the model's anatomical bind pose.
        target.copy(J.wrist[s]).add(V3((hand.x-sign*.235)*.64,(hand.y-.08)*.64,(hand.z-.05)*.64).multiplyScalar(G));
        // A chibi head is wider than the ink body's. Route lifted wrists
        // outside the cheek/hair volume instead of through her face.
        const lift=smooth(.32,.50,target.y/G);
        target.x=sign*Math.max(Math.abs(target.x),(.163+.15*lift)*G);
        target.y=Math.min(target.y,.50*G);
        // A book is held in front of the bodice, below the face. The generic
        // cheek-avoidance clamp kept the fingertips away from the book edges.
        // A small reading-only adjustment avoids pulling fused cuff cloth.
        if (bookHeld && lying < .01) {
          target.x=sign*.150*G;
          target.z=Math.max(target.z,.16*G);
        }
        // Lying: the standing arm offsets splay her wrists out past the quilt.
        // Fold both arms along her sides using the model's own shoulder->wrist
        // vector, so nothing pokes through the blanket.
        if(lying>.001){
          const sr=J.shoulder[s],rest=J.wrist[s].clone().sub(sr);
          target.x=target.x*(1-lying)+(sr.x+sign*.042*G)*lying;
          target.y=target.y*(1-lying)+(sr.y+rest.y*.90)*lying;
          target.z=target.z*(1-lying)+(sr.z+rest.z*.90)*lying;
        }
        hint.set(sign,-.25,.6*(1-lying));
        solveChain(b.armUp[s],b.armLo[s],J.shoulder[s],J.elbow[s],J.wrist[s],target,hint);
        const foot=s?C.fr:C.fl,fh=s?C.lhr:C.lhl;
        // Lying upstream targets splay the ankles to +/-0.7 units; bring them
        // over the midline so the skirt can drape closed over the legs.
        const spread=1-.72*lying;
        target.copy(J.ankle[s]).add(V3((foot.x-sign*.083)*.70*spread,(foot.y+.166)*.70,(foot.z-.03)*.70).multiplyScalar(G));
        // The upstream foot offset was tuned on a 0.78 thin body; on this wider
        // chibi the same offset floats her soles ~3 cm above the floor when she
        // sits. Plant them while seated, and never aim a sole below the floor.
        const floorY=J.ankle[s].y-rootYm*G;
        const plant=seated*grounded;
        target.y=target.y*(1-plant)+floorY*plant;
        if(grounded>.5)target.y=Math.max(target.y,floorY);
        // Lying down: three things have to be fixed at once. The bind pose
        // carries the foot ~3 cm forward of the hip, and after the -90 deg body
        // rotation that "forward" points up. The ankle target is also slightly
        // closer than the leg is long, so IK must bend the knee, and the bend
        // direction (hint) also points up. Net result: legs tilted 12 deg off
        // the mattress. Drop the forward lean and aim at full extension so the
        // bend term collapses to zero.
        if(lying>.001){
          // The hips sit .176 m apart on a .146 m leg, so aiming straight along
          // the body axis splays her 31 deg and leaves the soles hanging .25 m
          // over the sheet -- that is the "frog legs + visible hem" the user saw.
          // Pull the ankles toward the midline and drop them onto the mattress.
          const H=J.hip[s],k=.998;
          target.x=target.x*(1-lying)+(H.x*.30)*lying;
          target.y=target.y*(1-lying)+(H.y-.105*G*k)*lying;
          target.z=target.z*(1-lying)+(H.z-.100*G*k)*lying;
        }
        hint.set(fh.x*(1-lying)+sign*.18*lying,fh.y,fh.z*(1-lying)+lying);
        legEnd[s].copy(solveChain(b.legUp[s],b.legLo[s],J.hip[s],J.knee[s],J.ankle[s],target,hint));
      }
      // If a leg still cannot reach the floor, lift the body rather than let
      // the sole sink through it.
      if(grounded>.5){
        const need=-Math.min(legEnd[0].y,legEnd[1].y)/G;
        if(need>rootYm){rootYm=need;b.root.position.y=rootYm*G;}
      }
      dbg.rootYm=+rootYm.toFixed(4);
      dbg.soleL=+(rootYm+(legEnd[0].y-J.ankle[0].y)/G).toFixed(4);   // sole height above her floor plane
      dbg.soleR=+(rootYm+(legEnd[1].y-J.ankle[1].y)/G).toFixed(4);
      // leg direction in body space: dy down, dz forward. In a lying pose the
      // body's "down" becomes horizontal along the bed and "forward" becomes up.
      dbg.legDyL=+((legEnd[0].y-J.hip[0].y)/G).toFixed(4);
      dbg.legDzL=+((legEnd[0].z-J.hip[0].z)/G).toFixed(4);
      dbg.lying=+lying.toFixed(3);
      // Lying: leave the hem on its natural axis. Standing, the skirt hangs along
      // local -Y; the -90 deg body rotation maps that to world +Z, i.e. it already
      // drapes along the mattress toward her feet and covers the thighs. Measured
      // crown heights: 0 rad -> .866, -0.28 -> .893, -0.5 -> .897, -1.1 -> .826.
      // Any extra twist stands the bell up and pushes it through the quilt, so
      // the lying term is left at zero and only the seated tilt remains.
      b.skirt.rotation.set(-seated*.25*(1-lying),0,Math.sin(time*1.1)*.008*(1-lying));
      /* Lying: thicken the fabric shorts slightly so a low camera into the hem
         still reads cloth, without changing standing silhouette. */
      const bloomers = info._bloomers && info._bloomers();
      if (bloomers) {
        const t = .55 + .45 * lying;
        bloomers.scale.set(.118 * G * (1 + .12 * lying), .055 * G * t, .108 * G * (1 + .10 * lying));
      }
    }
    function handAnchors() {
      if (!info.rigged) return null;
      root.updateWorldMatrix(true, true);
      const hands = [0,1].map(s => joints.wrist[s].clone().sub(joints.elbow[s]).applyMatrix4(bonesByName.armLo[s].matrixWorld));
      return { left: hands[0], right: hands[1], rotation: bonesByName.root.getWorldQuaternion(new T.Quaternion()) };
    }
    return {root,info,ready,pose,dbg,handAnchors,
      // Place `mesh` as a world-space box wrapping her lying body, derived from
      // the live bones. Returns false when she is not lying (blanket must not
      // wrap a standing body).
      syncBlanketProxy(mesh) {
        if (!info.rigged || !bonesByName) return false;
        const b = bonesByName;
        b.root.updateWorldMatrix(true, true);
        const q = new T.Quaternion(); b.root.getWorldQuaternion(q);
        const up = V3(0, 1, 0).applyQuaternion(q);
        if (up.y > 0.5) return false;
        // The quilt lifts wherever a downward ray hits her, so this proxy is the
        // whole geometry of "she is under the blanket". An 8-corner box only
        // ramps linearly from crown to hem: with scale.z .56 the taper left a
        // peak thickness of .31 m against her .33 m torso, which is why the cloth
        // stopped short of her shoulders and read as a body ON the quilt.
        // Subdivide the length and give it a chest-high thickness curve.
        if (!mesh.userData.lanQuiltShape) {
          const box = new T.BoxGeometry(1, 1, 1, 1, 8, 1), bp = box.attributes.position;
          const keys = [[-.5, .70], [-.25, .95], [0, 1], [.25, .86], [.5, .06]];
          const taperAt = (y) => {
            for (let i = 1; i < keys.length; i++) if (y <= keys[i][0]) {
              const y0 = keys[i - 1][0], a0 = keys[i - 1][1], y1 = keys[i][0], a1 = keys[i][1];
              return a0 + (a1 - a0) * (y - y0) / (y1 - y0);
            }
            return keys[keys.length - 1][1];
          };
          for (let i = 0; i < bp.count; i++) {
            const y = bp.getY(i);
            bp.setZ(i, bp.getZ(i) * taperAt(y));
            if (y > .1) bp.setX(i, bp.getX(i) * (1 - .55 * Math.min(1, (y - .1) / .4)));
          }
          bp.needsUpdate = true; box.computeVertexNormals();
          mesh.geometry = box; mesh.userData.lanQuiltShape = true;
        }
        const pelvis = b.root.getWorldPosition(V3());
        const head = b.head.getWorldPosition(V3());
        // The length axis runs crown-to-pelvis along `up`; the thickness axis is
        // world Y. Her bones ride the middle of the body while the cloth has to
        // clear her back, so nudge the box up by half her remaining girth.
        // Stop the head end at her shoulders: the +0.42 overhang pushed the
        // measure ray up around her face so the quilt covered her chin.
        const len = pelvis.distanceTo(head) - 0.12;
        mesh.position.copy(pelvis).add(head).multiplyScalar(0.5).addScaledVector(up, 0.06).add(V3(0, 0.05, 0));
        mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), up.clone().normalize());
        /* Hip width 1.28 (was 1.14): covers more of the hem cone from low angles. */
        mesh.scale.set(1.28, len, 0.48);
        mesh.updateMatrixWorld(true);
        return true;
      },
      focus(camera,controls){const position=moli.getWorldPosition(V3());controls.target.copy(position).add(V3(0,.64,0));camera.position.copy(position).add(V3(1.65,1.55,2.8));controls.update();}
    };
  };
})();
