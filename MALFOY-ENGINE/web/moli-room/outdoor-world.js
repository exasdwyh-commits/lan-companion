/* Third-person outdoor island — visual baseline from img2threejs Tropical Island
 * (https://img2threejs.io/#/demo/tropical-island): radial silhouette beach,
 * sand/grass palette, cabin·dock·boat·palms·campfire composition.
 * Reimplemented as Three r128 primitives (no measured surface buffers / no GLB).
 * Gameplay IPC (fishing / garden) unchanged. */
(function () {
'use strict';

window.createOutdoorWorld = function ({ THREE, camera, controls, renderer, houseRoot, onToast, host }) {
  const T = THREE;
  const outdoor = new T.Scene();
  outdoor.name = 'lan-outdoor';
  outdoor.background = new T.Color(0xbfe4ee);
  outdoor.fog = new T.Fog(0xc5e4f0, 32, 95);

  /* Scale the diorama (~radius 4–5) up so third-person walking feels open. */
  const S = 2.45;
  const WATER_Y = 0.02;

  const PALETTE = {
    sand: new T.Color(0xf3dfa8),
    sandShadow: new T.Color(0xe1c68d),
    grass: new T.Color(0x8cae3c),
    grassDeep: new T.Color(0x5f8e2d),
    waterDeep: new T.Color(0x08739e),
    waterShelf: new T.Color(0x46c6bd),
    foam: new T.Color(0xfdfdfd),
    hull: new T.Color(0x7d4f30),
    rock: new T.Color(0x808a8f),
    rockWarm: new T.Color(0xc9684b),
    chimney: new T.Color(0x9a9c98),
  };

  function hash2(x, y, seed) {
    const v = Math.sin(x * 127.1 + y * 311.7 + (seed || 0.137) * 19.19) * 43758.5453;
    return v - Math.floor(v);
  }
  function smooth(v) { return v * v * (3 - 2 * v); }
  function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function valueNoise(x, y, cell) {
    const gx = x / cell, gy = y / cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = smooth(gx - x0), ty = smooth(gy - y0);
    const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
    const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
  }

  /* Sixteen radial samples — same coastline idea as tropical-island. */
  const SIL = [1.05, 1.18, 1.28, 1.22, 1.06, 0.92, 0.86, 0.92,
    1.06, 1.16, 1.18, 1.06, 0.94, 0.86, 0.88, 0.96];
  function silhouetteAt(theta) {
    const t = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const indexF = (t / (Math.PI * 2)) * SIL.length;
    const i0 = Math.floor(indexF) % SIL.length;
    const i1 = (i0 + 1) % SIL.length;
    const frac = indexF - Math.floor(indexF);
    return 4 * S * (SIL[i0] + (SIL[i1] - SIL[i0]) * smooth(frac));
  }
  function heightAt(x, z) {
    const theta = Math.atan2(z / 0.85, x);
    const q = Math.hypot(x, z / 0.85) / silhouetteAt(theta);
    const relief = (valueNoise(x, z, 0.6 * S) - 0.5) * 0.055 * S * (1 - smoothstep(0.85, 1, q));
    return (0.54 - 0.38 * smoothstep(0.52, 0.84, q)
      - 0.16 * smoothstep(0.88, 1, q) - 0.55 * smoothstep(1, 1.18, q)) * S + relief;
  }
  function sampleAt(x, z) {
    const theta = Math.atan2(z / 0.85, x);
    const q = Math.hypot(x, z / 0.85) / silhouetteAt(theta);
    const y = heightAt(x, z);
    const grassEdge = q + (valueNoise(x + 8, z, 0.45 * S) - 0.5) * 0.055;
    const color = PALETTE.grass.clone().lerp(PALETTE.grassDeep, valueNoise(x, z, 0.35 * S) * 0.35);
    color.lerp(PALETTE.sand, smoothstep(0.75, 0.82, grassEdge));
    color.lerp(PALETTE.sandShadow, smoothstep(0.91, 1.18, q) * 0.35);
    return { y, color, onGrass: q < 0.78, onSand: q >= 0.78 && q < 1, q };
  }

  function std(hex, extra) {
    return new T.MeshStandardMaterial(Object.assign({
      color: hex, roughness: 0.9, metalness: 0, flatShading: true,
    }, extra || {}));
  }
  function put(geo, mat, x, y, z, parent, shadow) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow !== false;
    m.receiveShadow = true;
    (parent || outdoor).add(m);
    return m;
  }

  /* —— lights / sky (day-leaning tropical palette) —— */
  outdoor.add(new T.HemisphereLight(0xcae9f3, 0x6b6850, 0.7));
  const sun = new T.DirectionalLight(0xfff0d0, 1.35);
  sun.position.set(-7 * S * 0.35, 11, 4 * S * 0.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 55;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -14;
  sun.shadow.camera.right = sun.shadow.camera.top = 14;
  sun.shadow.bias = -0.0002;
  outdoor.add(sun);
  outdoor.add(new T.AmbientLight(0xcfe6f6, 0.28));

  const sky = new T.Mesh(
    new T.SphereGeometry(110, 28, 18),
    new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: {
        dayZenith: { value: new T.Color(0x528ecc) },
        dayHorizon: { value: new T.Color(0xcbe8e6) },
      },
      vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: [
        'uniform vec3 dayZenith, dayHorizon; varying vec3 vD;',
        'void main(){ float a=pow(max(vD.y,0.),0.45);',
        'vec3 c=mix(dayHorizon, dayZenith, a);',
        'gl_FragColor=vec4(c,1.); }',
      ].join('\n'),
    })
  );
  outdoor.add(sky);

  /* —— radial beach mesh —— */
  const radial = 42;
  const angular = 96;
  const vCount = 1 + radial * (angular + 1);
  const positions = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const indices = [];
  function writeVertex(i, x, z) {
    const s = sampleAt(x, z);
    positions[i * 3] = x; positions[i * 3 + 1] = s.y; positions[i * 3 + 2] = z;
    colors[i * 3] = s.color.r; colors[i * 3 + 1] = s.color.g; colors[i * 3 + 2] = s.color.b;
  }
  writeVertex(0, 0, 0);
  for (let r = 1; r <= radial; r++) {
    for (let a = 0; a <= angular; a++) {
      const theta = a / angular * Math.PI * 2;
      const radius = silhouetteAt(theta) * r / radial * 1.18;
      writeVertex(1 + (r - 1) * (angular + 1) + a, Math.cos(theta) * radius, Math.sin(theta) * radius * 0.85);
    }
  }
  for (let a = 0; a < angular; a++) indices.push(0, 2 + a, 1 + a);
  for (let r = 0; r < radial - 1; r++) {
    for (let a = 0; a < angular; a++) {
      const i = 1 + r * (angular + 1) + a;
      const j = i + angular + 1;
      indices.push(i, i + 1, j, i + 1, j + 1, j);
    }
  }

  /* Path cabin → dock (scaled tropical PATH_SAMPLES) */
  const PATH = [
    { x: -1.5, z: -2.6, r: 0.23 }, { x: -1.65, z: -1.4, r: 0.25 },
    { x: -1.45, z: -0.4, r: 0.25 }, { x: -0.9, z: 0.75, r: 0.3 },
    { x: 0.15, z: 1.35, r: 0.3 }, { x: 1.3, z: 1.9, r: 0.28 },
    { x: 2.3, z: 2.7, r: 0.3 },
  ].map((p) => ({ x: p.x * S, z: p.z * S, r: p.r * S }));
  for (let i = 0; i < vCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (y < 0.12 * S) continue;
    let dist = Infinity;
    for (let j = 1; j < PATH.length; j++) {
      const a = PATH[j - 1], b = PATH[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const width = a.r + (b.r - a.r) * t;
      dist = Math.min(dist, Math.hypot(x - a.x - dx * t, z - a.z - dz * t) / width);
    }
    const blend = 1 - smoothstep(0.65, 1.15, dist);
    if (blend <= 0) continue;
    colors[i * 3] += (PALETTE.sand.r * 0.88 - colors[i * 3]) * blend;
    colors[i * 3 + 1] += (PALETTE.sand.g * 0.8 - colors[i * 3 + 1]) * blend;
    colors[i * 3 + 2] += (PALETTE.sand.b * 0.7 - colors[i * 3 + 2]) * blend;
  }

  const landGeo = new T.BufferGeometry();
  landGeo.setAttribute('position', new T.BufferAttribute(positions, 3));
  landGeo.setAttribute('color', new T.BufferAttribute(colors, 3));
  landGeo.setIndex(indices);
  landGeo.computeVertexNormals();
  const grass = new T.Mesh(landGeo, new T.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0, flatShading: false,
  }));
  grass.receiveShadow = true;
  grass.castShadow = false;
  grass.name = 'lan-island';
  outdoor.add(grass);

  /* —— ocean: shelf colour + soft waves + foam along silhouette —— */
  function wave(x, z, t) {
    return Math.sin(x * 0.35 + t * 1.2) * 0.045
      + Math.sin(z * 0.28 + t * 0.95) * 0.04
      + Math.sin((x + z) * 0.18 + t * 0.55) * 0.028;
  }
  const SEA = 120, SEA_SEG = 72;
  const waterGeo = new T.PlaneGeometry(SEA, SEA, SEA_SEG, SEA_SEG);
  waterGeo.rotateX(-Math.PI / 2);
  const wPos = waterGeo.attributes.position;
  const wCol = new Float32Array(wPos.count * 3);
  const waterBase = new Float32Array(wPos.count * 3);
  for (let i = 0; i < wPos.count; i++) {
    const x = wPos.getX(i), z = wPos.getZ(i);
    waterBase[i * 3] = x; waterBase[i * 3 + 1] = 0; waterBase[i * 3 + 2] = z;
    const theta = Math.atan2(z / 0.85, x);
    const q = Math.hypot(x, z / 0.85) / Math.max(0.001, silhouetteAt(theta));
    const shelf = 1 - smoothstep(1.0, 1.7, q);
    const c = PALETTE.waterDeep.clone().lerp(PALETTE.waterShelf, shelf * 0.85);
    wCol[i * 3] = c.r; wCol[i * 3 + 1] = c.g; wCol[i * 3 + 2] = c.b;
  }
  waterGeo.setAttribute('color', new T.BufferAttribute(wCol, 3));
  const water = new T.Mesh(waterGeo, new T.MeshStandardMaterial({
    vertexColors: true, transparent: true, opacity: 0.88,
    roughness: 0.22, metalness: 0.08, flatShading: false,
  }));
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  outdoor.add(water);

  const seaFloor = new T.Mesh(
    new T.PlaneGeometry(SEA + 30, SEA + 30),
    std(0x0d4f6e, { roughness: 1, flatShading: false })
  );
  seaFloor.rotation.x = -Math.PI / 2;
  seaFloor.position.y = WATER_Y - 4.5;
  outdoor.add(seaFloor);

  /* Foam ring following coastline (tube of small cards) */
  const foamGroup = new T.Group();
  const foamMat = new T.MeshBasicMaterial({
    color: 0xfdfdfd, transparent: true, opacity: 0.42, depthWrite: false, side: T.DoubleSide,
  });
  for (let a = 0; a < 72; a++) {
    const theta = a / 72 * Math.PI * 2;
    const r = silhouetteAt(theta) * 1.02;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r * 0.85;
    const card = new T.Mesh(new T.PlaneGeometry(0.55 * S, 0.22 * S), foamMat);
    card.rotation.x = -Math.PI / 2;
    card.position.set(x, WATER_Y + 0.03, z);
    foamGroup.add(card);
  }
  outdoor.add(foamGroup);

  function tagFish(obj, spot) {
    obj.userData.spot = spot;
    obj.userData.lanOutdoor = 'fish';
    obj.traverse((c) => { c.userData.spot = spot; c.userData.lanOutdoor = 'fish'; });
  }

  const wood = std(0xb07a42, { roughness: 0.78 });
  const woodD = std(0x6e4a24, { roughness: 0.86 });
  const woodPale = std(0xd8c3a0, { roughness: 0.82 });

  /* Slot helpers (tropical PROP_SLOTS × S) */
  const slot = (x, z) => ({ x: x * S, z: z * S, y: heightAt(x * S, z * S) });

  /* —— wooden cabin —— */
  const houseSlot = slot(0, -0.65);
  const cottage = new T.Group();
  cottage.position.set(houseSlot.x, houseSlot.y, houseSlot.z);
  cottage.rotation.y = Math.PI;
  const cabinW = 2.15 * S * 0.42, cabinD = 1.9 * S * 0.42, cabinH = 1.15 * S * 0.55;
  put(new T.BoxGeometry(cabinW, cabinH, cabinD), woodPale, 0, cabinH * 0.5, 0, cottage);
  // gabled roof
  const roofGroup = new T.Group();
  roofGroup.position.y = cabinH * 0.92;
  const roofMat = std(0x6a4a32, { roughness: 0.92 });
  const roofL = put(new T.BoxGeometry(cabinW * 1.12, 0.08, cabinD * 0.72), roofMat, 0, 0.25, 0, roofGroup);
  roofL.rotation.x = 0.55;
  const roofR = put(new T.BoxGeometry(cabinW * 1.12, 0.08, cabinD * 0.72), roofMat, 0, 0.25, 0, roofGroup);
  roofR.rotation.x = -0.55;
  put(new T.BoxGeometry(cabinW * 1.14, 0.35, 0.08), roofMat, 0, 0.42, 0, roofGroup);
  cottage.add(roofGroup);
  put(new T.BoxGeometry(0.28 * S * 0.45, 0.55 * S * 0.45, 0.06), woodD, 0, 0.32 * S * 0.45, cabinD * 0.51, cottage);
  put(new T.BoxGeometry(0.28 * S * 0.4, 0.28 * S * 0.4, 0.05), std(0x7ec8e8, { roughness: 0.25, flatShading: false }), -cabinW * 0.28, 0.55 * S * 0.45, cabinD * 0.51, cottage);
  put(new T.BoxGeometry(0.28 * S * 0.4, 0.28 * S * 0.4, 0.05), std(0x7ec8e8, { roughness: 0.25, flatShading: false }), cabinW * 0.28, 0.55 * S * 0.45, cabinD * 0.51, cottage);
  // chimney
  put(new T.BoxGeometry(0.22 * S * 0.4, 0.7 * S * 0.45, 0.22 * S * 0.4), std(PALETTE.chimney.getHex()), -cabinW * 0.28, cabinH + 0.25, -cabinD * 0.15, cottage);
  outdoor.add(cottage);

  /* —— palms —— */
  function makePalm(sx, sz, yaw) {
    const p = slot(sx, sz);
    const g = new T.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = yaw;
    const h = 3.6 * S * 0.42;
    const trunk = put(new T.CylinderGeometry(0.07 * S * 0.5, 0.13 * S * 0.5, h, 7), woodD, 0, h * 0.5, 0, g);
    trunk.rotation.z = 0.12;
    for (let i = 0; i < 8; i++) {
      const frond = put(new T.ConeGeometry(0.22 * S * 0.45, 1.2 * S * 0.42, 4), std(0x2f7a45), 0, h * 0.95, 0, g);
      const ang = (i / 8) * Math.PI * 2;
      frond.rotation.set(1.05, ang, 0);
      frond.position.set(Math.sin(ang) * 0.25 * S * 0.4, h * 0.92, Math.cos(ang) * 0.25 * S * 0.4);
    }
    put(new T.SphereGeometry(0.1 * S * 0.45, 6, 5), std(0xc4553a), 0.1, h * 0.82, 0.05, g);
    outdoor.add(g);
    return g;
  }
  [[-2.6, -1.3, -0.4], [-1.0, -2.4, 0.5], [1.6, -1.7, -0.7], [2.5, 0.4, 0.9]].forEach((p) => makePalm(...p));

  /* —— dock / pier (fishing spot) —— */
  const dockSlot = { x: 3.4 * S, z: 3.4 * S, y: -0.12 * S };
  const pier = new T.Group();
  pier.position.set(dockSlot.x, WATER_Y + 0.28, dockSlot.z);
  pier.rotation.y = 1.0;
  const pierLen = 3.2 * S * 0.55;
  for (let i = 0; i < 10; i++) {
    put(new T.BoxGeometry(1.35 * S * 0.45, 0.07, 0.28 * S * 0.45), i % 2 ? wood : woodD, 0, 0, i * 0.32 * S * 0.45, pier);
  }
  [[-0.55, 0.2], [0.55, 0.2], [-0.55, 1.4], [0.55, 1.4], [-0.55, 2.5], [0.55, 2.5]].forEach(([x, z]) => {
    put(new T.CylinderGeometry(0.06, 0.08, 1.1, 6), woodD, x * S * 0.45, -0.45, z * S * 0.45, pier);
  });
  put(new T.BoxGeometry(0.05, 0.05, pierLen * 0.85), wood, -0.55 * S * 0.45, 0.35, pierLen * 0.35, pier);
  put(new T.BoxGeometry(0.05, 0.05, pierLen * 0.85), wood, 0.55 * S * 0.45, 0.35, pierLen * 0.35, pier);
  outdoor.add(pier);
  tagFish(pier, 'pier');

  /* —— moored boat —— */
  const boat = new T.Group();
  boat.position.set(5.3 * S, WATER_Y + 0.08, 4.55 * S);
  boat.rotation.y = Math.PI - 0.45;
  put(new T.CylinderGeometry(0.14 * S * 0.45, 0.42 * S * 0.45, 1.6 * S * 0.45, 8, 1, true), wood, 0, 0.12, 0, boat).rotation.z = Math.PI / 2;
  put(new T.BoxGeometry(1.55 * S * 0.45, 0.08, 0.55 * S * 0.45), woodD, 0, 0.22, 0, boat);
  put(new T.BoxGeometry(0.04, 0.55 * S * 0.45, 0.04), woodD, 0, 0.5, -0.15, boat);
  outdoor.add(boat);

  /* —— shoreline rocks (reef fishing) —— */
  const reef = new T.Group();
  const rockSlot = slot(-2.8, 1.3);
  reef.position.set(rockSlot.x, rockSlot.y, rockSlot.z);
  [[0, 0.4, 0, 0.55], [0.55, 0.2, 0.3, 0.32], [-0.5, 0.25, -0.25, 0.3],
    [0.25, 0.35, -0.4, 0.25], [-0.2, 0.28, 0.45, 0.22]].forEach(([x, y, z, s], i) => {
    const m = put(new T.DodecahedronGeometry(s * S * 0.55, 0), std(i === 3 ? PALETTE.rockWarm.getHex() : PALETTE.rock.getHex()), x * S * 0.45, y * S * 0.45, z * S * 0.45, reef);
    m.rotation.set(0.4, 0.9, 0.2);
  });
  outdoor.add(reef);
  tagFish(reef, 'reef');

  /* —— red rock islet (far fishing / landmark) —— */
  const redRock = new T.Group();
  redRock.position.set(6.3 * S, WATER_Y - 0.05, -4.5 * S);
  put(new T.DodecahedronGeometry(0.9 * S * 0.45, 0), std(PALETTE.rockWarm.getHex()), 0, 0.55 * S * 0.4, 0, redRock);
  put(new T.DodecahedronGeometry(0.45 * S * 0.45, 0), std(0xa85a40), 0.5, 0.3, 0.2, redRock);
  outdoor.add(redRock);

  /* —— inland pond (lake fishing) —— */
  const lake = new T.Group();
  const lakeXZ = { x: -3.2 * S, z: 0.4 * S };
  lake.position.set(lakeXZ.x, heightAt(lakeXZ.x, lakeXZ.z) - 0.02, lakeXZ.z);
  const pond = put(new T.CircleGeometry(0.85 * S * 0.55, 28), new T.MeshStandardMaterial({
    color: 0x1e7596, roughness: 0.12, metalness: 0.18, transparent: true, opacity: 0.92, flatShading: false,
  }), 0, 0.06, 0, lake);
  pond.rotation.x = -Math.PI / 2;
  pond.castShadow = false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    put(new T.DodecahedronGeometry(0.1 + (i % 3) * 0.04, 0), std(0x7a746c), Math.cos(a) * 0.9 * S * 0.5, 0.1, Math.sin(a) * 0.8 * S * 0.5, lake);
  }
  outdoor.add(lake);
  tagFish(lake, 'lake');

  /* —— campfire + log benches —— */
  const fireSlot = slot(-1.5, 1.75);
  const camp = new T.Group();
  camp.position.set(fireSlot.x, fireSlot.y, fireSlot.z);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const log = put(new T.CylinderGeometry(0.08, 0.09, 0.75 * S * 0.45, 7), woodD, Math.cos(a) * 0.7 * S * 0.4, 0.08, Math.sin(a) * 0.7 * S * 0.4, camp);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = Math.PI / 2 - a;
  }
  put(new T.DodecahedronGeometry(0.12, 0), std(0x3a322c), 0, 0.08, 0, camp);
  const flame = put(new T.ConeGeometry(0.12, 0.35, 5), std(0xff8a3a, {
    emissive: 0xff6a20, emissiveIntensity: 0.85, transparent: true, opacity: 0.9, flatShading: false,
  }), 0, 0.28, 0, camp, false);
  const fireLight = new T.PointLight(0xff9a4a, 0.85, 6.5, 2);
  fireLight.position.set(0, 0.45, 0);
  camp.add(fireLight);
  outdoor.add(camp);

  /* —— crate / barrel / lantern —— */
  const crateSlot = slot(-1.3, 0.05);
  put(new T.BoxGeometry(0.38 * S * 0.45, 0.38 * S * 0.45, 0.38 * S * 0.45), wood, crateSlot.x, crateSlot.y + 0.19 * S * 0.45, crateSlot.z);
  const barrelSlot = slot(1.36, 0.45);
  put(new T.CylinderGeometry(0.2 * S * 0.45, 0.22 * S * 0.45, 0.48 * S * 0.45, 10), woodD, barrelSlot.x, barrelSlot.y + 0.24 * S * 0.45, barrelSlot.z);

  const lampSlot = slot(1.9, 2.3);
  const lamp = new T.Group();
  lamp.position.set(lampSlot.x, lampSlot.y, lampSlot.z);
  put(new T.CylinderGeometry(0.04, 0.05, 1.0 * S * 0.45, 6), woodD, 0, 0.5 * S * 0.45, 0, lamp);
  put(new T.BoxGeometry(0.22 * S * 0.4, 0.28 * S * 0.4, 0.22 * S * 0.4), std(0xffe08a, {
    emissive: 0xffb84a, emissiveIntensity: 0.55, roughness: 0.4, flatShading: false,
  }), 0, 1.05 * S * 0.45, 0, lamp);
  const lampLight = new T.PointLight(0xffb864, 0.55, 5, 2);
  lampLight.position.set(0, 1.05 * S * 0.45, 0);
  lamp.add(lampLight);
  outdoor.add(lamp);

  /* —— garden beds (near cabin left grass) —— */
  const plots = [];
  const plotRoot = new T.Group();
  const plotBase = { x: -2.2 * S, z: -0.2 * S };
  plotRoot.position.set(plotBase.x, heightAt(plotBase.x, plotBase.z), plotBase.z);
  outdoor.add(plotRoot);
  const soil = std(0x6a4630, { roughness: 0.98 });
  const frame = std(0x8d6236, { roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const row = (i / 3) | 0, col = i % 3;
    const bed = new T.Group();
    bed.position.set(col * 1.05, 0, row * 1.05);
    put(new T.BoxGeometry(0.92, 0.16, 0.92), soil, 0, 0.08, 0, bed);
    put(new T.BoxGeometry(1.0, 0.08, 0.07), frame, 0, 0.14, 0.46, bed);
    put(new T.BoxGeometry(1.0, 0.08, 0.07), frame, 0, 0.14, -0.46, bed);
    put(new T.BoxGeometry(0.07, 0.08, 0.92), frame, 0.46, 0.14, 0, bed);
    put(new T.BoxGeometry(0.07, 0.08, 0.92), frame, -0.46, 0.14, 0, bed);
    bed.userData.plot = 'p' + i;
    bed.userData.lanOutdoor = 'garden';
    const crop = new T.Group();
    put(new T.CylinderGeometry(0.025, 0.035, 0.2, 5), std(0x3f7a3a), 0, 0.26, 0, crop);
    const leaf = put(new T.SphereGeometry(0.11, 8, 6), std(0x7dbe55), 0, 0.38, 0, crop);
    crop.userData.leaf = leaf;
    crop.visible = false;
    bed.add(crop);
    plotRoot.add(bed);
    plots.push({ id: 'p' + i, bed, crop, leaf });
  }

  /* pebbles + starfish + grass tufts */
  for (let i = 0; i < 28; i++) {
    const t = (i * 1.7) % (Math.PI * 2);
    const r = 3.0 * S * 0.55 + ((i * 19) % 70) / 70 * 1.1 * S;
    const x = Math.cos(t) * r, z = Math.sin(t) * r * 0.85;
    const s = sampleAt(x, z);
    if (!s.onSand) continue;
    const size = 0.05 + ((i * 7) % 9) / 90;
    const pebble = put(new T.DodecahedronGeometry(1, 0), std(0xbcb6a8), x, s.y + size * 0.4, z);
    pebble.scale.setScalar(size * S * 0.55);
    pebble.rotation.set(((i * 11) % 13) / 7, ((i * 17) % 23) / 9, 0);
  }
  {
    const x = -0.4 * S, z = 2.9 * S;
    const s = sampleAt(x, z);
    const starShape = new T.Shape();
    starShape.moveTo(0, 0.18);
    [[0.05, 0.05], [0.18, 0.05], [0.07, -0.04], [0.11, -0.18], [0, -0.1],
      [-0.11, -0.18], [-0.07, -0.04], [-0.18, 0.05], [-0.05, 0.05]].forEach(([px, py]) => starShape.lineTo(px, py));
    starShape.closePath();
    const geom = new T.ExtrudeGeometry(starShape, { depth: 0.04, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    const star = new T.Mesh(geom, std(0xc14b30, { roughness: 0.6 }));
    star.position.set(x, s.y + 0.025, z);
    star.scale.setScalar(S * 0.45);
    star.castShadow = true;
    outdoor.add(star);
  }

  const tufts = new T.InstancedMesh(new T.ConeGeometry(0.035, 0.18, 4), std(0x4e9a46), 220);
  const dummy = new T.Object3D();
  let placed = 0;
  for (let i = 0; placed < 220 && i < 900; i++) {
    const a = hash2(i, 11) * Math.PI * 2;
    const r = 1.0 * S + hash2(i, 13) * 3.8 * S;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.85;
    const s = sampleAt(x, z);
    if (!s.onGrass || s.y < 0.15 * S) continue;
    // keep clear of cabin / plots / path
    if (Math.hypot(x - houseSlot.x, z - houseSlot.z) < 1.4) continue;
    if (Math.hypot(x - plotBase.x - 1, z - plotBase.z - 0.5) < 1.8) continue;
    dummy.position.set(x, s.y + 0.04, z);
    dummy.rotation.y = hash2(i, 17) * 6;
    dummy.scale.setScalar(0.75 + hash2(i, 19) * 0.9);
    dummy.updateMatrix();
    tufts.setMatrixAt(placed++, dummy.matrix);
  }
  tufts.count = placed;
  outdoor.add(tufts);

  /* —— player —— */
  const player = new T.Group();
  player.name = 'lan-outdoor-player';
  const body = new T.Group();
  const skin = std(0xf3d2c4, { roughness: 0.7, flatShading: false });
  const navy = std(0x1b2747, { roughness: 0.72, flatShading: false });
  const hairMat = std(0x2a4f9a, { roughness: 0.55, flatShading: false });
  put(new T.SphereGeometry(0.22, 14, 12), skin, 0, 0.72, 0, body).scale.set(1, 1.05, 0.9);
  const hair = put(new T.SphereGeometry(0.24, 14, 12), hairMat, 0, 0.86, -0.02, body);
  hair.scale.set(1.05, 1.15, 1.1);
  put(new T.ConeGeometry(0.07, 0.18, 5), hairMat, -0.16, 0.95, 0, body).rotation.z = 0.7;
  put(new T.ConeGeometry(0.07, 0.18, 5), hairMat, 0.16, 0.95, 0, body).rotation.z = -0.7;
  put(new T.CylinderGeometry(0.2, 0.32, 0.28, 12), navy, 0, 0.42, 0, body);
  const tail = put(new T.ConeGeometry(0.1, 0.28, 6), hairMat, 0, 0.34, -0.22, body);
  tail.rotation.x = 1.2;
  player.add(body);
  player.position.set(0.2 * S, heightAt(0.2 * S, 1.2 * S), 1.2 * S);
  outdoor.add(player);

  /* —— HUD —— */
  const hud = document.createElement('div');
  hud.className = 'lan-outdoor-hud';
  hud.innerHTML = '<div class="lan-outdoor-card"><strong>海边小岛</strong><p>WASD / 点地走动 · 点码头钓鱼 · 点菜地种浇收</p><p class="lan-outdoor-hint">F 就近抛竿 · Esc / H 回家</p><button type="button" class="lan-outdoor-home">回到小屋</button></div>';
  const style = document.createElement('style');
  style.textContent = `.lan-outdoor-hud{position:fixed;left:16px;top:16px;z-index:55;pointer-events:none;display:none}.lan-outdoor-hud.on{display:block}.lan-outdoor-card{pointer-events:auto;max-width:260px;padding:12px 14px;border-radius:14px;background:rgba(252,249,242,.94);border:2px solid #1d1a22;box-shadow:4px 4px 0 rgba(29,26,34,.45);font:13px/1.45 "PingFang SC",sans-serif;color:#2a2437}.lan-outdoor-card strong{display:block;font-size:15px;margin-bottom:4px}.lan-outdoor-card p{margin:0 0 6px}.lan-outdoor-hint{opacity:.72;font-size:12px}.lan-outdoor-home{border:1.5px solid #1d1a22;background:#1d1a22;color:#fdf7e6;border-radius:10px;padding:7px 12px;font:inherit;cursor:pointer}.lan-outdoor-home:hover{background:#3a3350}body.lan-outdoors nav.bar,body.lan-outdoors .lc-chat{opacity:.35}`;
  document.head.appendChild(style);
  document.body.appendChild(hud);
  hud.querySelector('.lan-outdoor-home').onclick = () => goHome();

  let mode = 'house';
  const keys = Object.create(null);
  let target = null;
  let gardenSnap = null;
  let weather = 'clear';
  let tAcc = 0;
  let casting = false;

  const camOffset = new T.Vector3(0, 4.6, 8.0);
  const look = new T.Vector3();
  const wish = new T.Vector3();
  const raycaster = new T.Raycaster();
  const ndc = new T.Vector2();
  const maxWalkR = silhouetteAt(0) * 0.92;

  function setMode(next) {
    if (next === mode) return mode;
    mode = next;
    if (houseRoot) houseRoot.visible = mode === 'house';
    if (controls) controls.enabled = mode === 'house';
    document.body.classList.toggle('lan-outdoors', mode === 'outdoors');
    hud.classList.toggle('on', mode === 'outdoors');
    if (mode === 'outdoors') {
      player.position.y = heightAt(player.position.x, player.position.z);
      camera.position.copy(player.position).add(camOffset);
      look.copy(player.position).add(new T.Vector3(0, 1.0, 0));
      camera.lookAt(look);
      refreshGarden();
      onToast?.('到海边了 · WASD 走动，Esc 回家');
    } else onToast?.('回到小屋了');
    return mode;
  }

  async function refreshGarden() {
    if (!host?.homestead) return;
    try {
      const snap = await host.homestead();
      if (!snap?.ok) return;
      gardenSnap = snap.garden;
      applyGardenVisual(snap.garden);
    } catch (_) { /* preview */ }
  }

  function applyGardenVisual(garden) {
    if (!garden || !Array.isArray(garden.plots)) return;
    for (const p of plots) {
      const row = garden.plots.find((x) => x.id === p.id);
      if (!row || !row.species) { p.crop.visible = false; continue; }
      p.crop.visible = true;
      const prog = typeof row.stage === 'number' ? row.stage : 0.3;
      const h = row.ripe || row.ready ? 1.35 : row.withered ? 0.35 : 0.45 + prog;
      p.crop.scale.set(1, h, 1);
      if (p.leaf && p.leaf.material) {
        p.leaf.material.color.setHex(row.ripe || row.ready ? 0xe8c84a : row.withered ? 0x8a7a5a : 0x5aaa55);
      }
    }
  }

  function clampIsland(pos) {
    const r = Math.hypot(pos.x, pos.z / 0.85);
    const edge = silhouetteAt(Math.atan2(pos.z / 0.85, pos.x)) * 0.9;
    if (r > edge) {
      const k = edge / r;
      pos.x *= k;
      pos.z *= k;
    }
    pos.y = Math.max(heightAt(pos.x, pos.z), WATER_Y + 0.02);
  }

  function nearestFishSpot() {
    const spots = [
      { id: 'pier', pos: pier.position },
      { id: 'reef', pos: reef.position },
      { id: 'lake', pos: lake.position },
    ];
    let best = null, bestD = 3.2;
    for (const s of spots) {
      const d = Math.hypot(player.position.x - s.pos.x, player.position.z - s.pos.z);
      if (d < bestD) { bestD = d; best = s.id; }
    }
    return best;
  }

  function update(dt) {
    if (mode !== 'outdoors') return;
    tAcc += dt;
    const wp = water.geometry.attributes.position;
    for (let i = 0; i < wp.count; i++) {
      const x = waterBase[i * 3], z = waterBase[i * 3 + 2];
      wp.setY(i, wave(x, z, tAcc));
    }
    wp.needsUpdate = true;
    foamMat.opacity = 0.34 + Math.sin(tAcc * 1.5) * 0.1;
    flame.scale.y = 0.85 + Math.sin(tAcc * 9) * 0.18;
    flame.rotation.y = tAcc * 2.2;
    fireLight.intensity = 0.7 + Math.sin(tAcc * 7) * 0.2;
    hair.rotation.y = Math.sin(tAcc * 1.4) * 0.04;
    tail.rotation.y = Math.sin(tAcc * 2.2) * 0.35;

    wish.set(0, 0, 0);
    if (keys.KeyW || keys.ArrowUp) wish.z -= 1;
    if (keys.KeyS || keys.ArrowDown) wish.z += 1;
    if (keys.KeyA || keys.ArrowLeft) wish.x -= 1;
    if (keys.KeyD || keys.ArrowRight) wish.x += 1;
    if (wish.lengthSq() > 0) {
      wish.normalize();
      const ang = Math.atan2(camera.position.x - player.position.x, camera.position.z - player.position.z);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const lx = wish.x * ca + wish.z * sa;
      const lz = -wish.x * sa + wish.z * ca;
      player.position.x += lx * 3.4 * dt;
      player.position.z += lz * 3.4 * dt;
      player.rotation.y = Math.atan2(lx, lz);
      body.position.y = Math.abs(Math.sin(tAcc * 10)) * 0.03;
      target = null;
    } else if (target) {
      const dx = target.x - player.position.x;
      const dz = target.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12) target = null;
      else {
        player.position.x += (dx / dist) * 3.1 * dt;
        player.position.z += (dz / dist) * 3.1 * dt;
        player.rotation.y = Math.atan2(dx, dz);
        body.position.y = Math.abs(Math.sin(tAcc * 10)) * 0.03;
      }
    } else body.position.y = 0;
    clampIsland(player.position);

    const desired = player.position.clone().add(camOffset);
    camera.position.lerp(desired, 1 - Math.exp(-dt * 3.5));
    look.copy(player.position).add(new T.Vector3(0, 1.05, 0));
    camera.lookAt(look);
  }

  function render() {
    if (mode !== 'outdoors') return false;
    renderer.render(outdoor, camera);
    return true;
  }

  function onKey(e, down) {
    if (mode !== 'outdoors') return;
    if (down && (e.code === 'Escape' || e.code === 'KeyH')) { e.preventDefault(); goHome(); return; }
    if (down && e.code === 'KeyF') {
      e.preventDefault();
      const spot = nearestFishSpot();
      if (spot) void castAt(spot);
      else onToast?.('再靠近码头、礁石或湖心一点');
      return;
    }
    keys[e.code] = down;
  }

  function pickGround(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects([grass, pier, reef, lake, ...plots.map((p) => p.bed)], true)[0] || null;
  }

  function tagFrom(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData && o.userData.lanOutdoor) return o.userData;
    return null;
  }

  async function castAt(spot) {
    if (casting) return;
    if (!host?.fishing?.cast) { onToast?.('请在 App 里钓鱼'); return; }
    casting = true;
    try {
      const r = await host.fishing.cast({ spot, weather });
      if (r?.ok) onToast?.(`钓到了 ${r.name}（${r.cm}cm）`);
      else onToast?.(r?.reason === 'closed' ? '这个钓点现在没开' : r?.reason === 'cooldown' ? '再等一会儿' : r?.reason === 'wrong-weather' ? '天气不对' : (r?.error || '没钓到'));
    } finally { casting = false; }
  }

  async function tendPlot(plotId) {
    if (!host?.garden) { onToast?.('请在 App 里照料花园'); return; }
    const snap = gardenSnap || (await host.homestead())?.garden;
    const row = snap?.plots?.find((p) => p.id === plotId);
    if (!row) return;
    if (!row.species) {
      const species = Object.keys(snap.seeds || {}).find((k) => (snap.seeds[k] || 0) > 0) || 'daisy';
      const r = await host.garden.plant(plotId, species);
      onToast?.(r?.ok === false ? (r.error || r.reason || '种不了') : `种下了 ${species}`);
    } else if (row.ripe || row.ready) {
      const r = await host.garden.harvest(plotId);
      onToast?.(r?.ok === false ? (r.error || r.reason || '收不了') : '收获了');
    } else if (row.withered) {
      const r = await host.garden.clear(plotId);
      onToast?.(r?.ok === false ? (r.error || '清不了') : '清掉枯株了');
    } else {
      const r = await host.garden.water(plotId);
      onToast?.(r?.ok === false ? (r.error || '浇不了') : '浇了水');
    }
    await refreshGarden();
  }

  async function onClick(ev) {
    if (mode !== 'outdoors') return;
    if (ev.target && ev.target.closest && ev.target.closest('.lan-outdoor-hud')) return;
    const hit = pickGround(ev.clientX, ev.clientY);
    if (!hit) return;
    const meta = tagFrom(hit.object);
    if (meta && meta.lanOutdoor === 'fish') { await castAt(meta.spot || 'pier'); return; }
    if (meta && meta.lanOutdoor === 'garden') { await tendPlot(meta.plot); return; }
    target = hit.point.clone();
  }

  function goOut() { return setMode('outdoors'); }
  function goHome() { return setMode('house'); }

  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (mode === 'outdoors') { e.stopPropagation(); void onClick(e); }
  }, true);

  return {
    outdoor,
    get mode() { return mode; },
    setMode,
    update,
    render,
    refreshGarden,
    goOut,
    goHome,
  };
};
})();
