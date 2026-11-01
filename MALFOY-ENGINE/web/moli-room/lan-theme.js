/* Lan's seaside theme: the world outside the window becomes ocean instead of meadow,
   the room's palette moves to cream / light wood / mist blue, and a few whale props
   come in. Everything here is additive — moli-room keeps its own sky, weather and
   day-night systems, so this module only tints and dresses what is already there. */
(function () {
'use strict';

window.createLanTheme = function ({ scene, THREE, mat, GY, ground, hillMats, leafMats, trunkMat, rockMat, W, skyU }) {
  const T = THREE, V = (x, y, z) => new T.Vector3(x, y, z);
  const col = h => new T.Color(h).convertSRGBToLinear();
  const M = (c, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: col(c), roughness: 0.82, metalness: 0, flatShading: true }, o));
  const mesh = (geo, m, x, y, z, p = scene, shadow = true) => {
    const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; p.add(o); return o;
  };
  const group = (parent, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const ball = (parent, m, x, y, z, rx, ry, rz) => { const o = mesh(new T.SphereGeometry(1, 20, 14), m, x, y, z, parent); o.scale.set(rx, ry, rz); return o; };
  const cyl = (parent, m, rt, rb, h, n, x, y, z) => mesh(new T.CylinderGeometry(rt, rb, h, n), m, x, y, z, parent);
  const boxMesh = (w, h, d, m, x, y, z, parent) => mesh(new T.BoxGeometry(w, h, d), m, x, y, z, parent);

  /* ---------- 1. palette: cream walls, light wood, mist blue ---------- */
  const P = {
    wall: 0xe9e3d6, wainscot: 0xb9c6d2, cap: 0xcdbfa6,
    stone: 0xd6cdbb, stoneD: 0xb8ae9c,
    wood: 0xbd8f5c, woodD: 0x8a6039, woodL: 0xd8ae7c,
    blue: 0x5b8ec9, blueL: 0x9cc4e8, blueD: 0x3f6ea3,
    sand: 0xe6d9bd, foam: 0xf4f7f4,
  };
  const before = {};
  /* shared prop materials — declared before the jetty, which borrows the whale blue */
  const whaleMat = M(P.blue, { roughness: 0.42, flatShading: false });
  const whaleBelly = M(0xf3f6f8, { roughness: 0.5, flatShading: false });
  const whaleFin = M(P.blueD, { roughness: 0.45, flatShading: false });
  const glassMat = new T.MeshPhysicalMaterial({ color: col(0xbfe0ee), roughness: 0.12, transmission: 0.6, thickness: 0.4, transparent: true, opacity: 0.55 });
  const retint = (name, hex) => {
    const m = mat[name]; if (!m) return;
    before[name] = m.color.clone();
    m.color.copy(col(hex));
  };
  retint('wall', P.wall); retint('wainscot', P.wainscot); retint('cap', P.cap);
  retint('stone', P.stone); retint('stoneD', P.stoneD);
  retint('wood', P.wood); retint('woodD', P.woodD); retint('woodL', P.woodL);

  /* the lawn becomes a sandy spit, and the distant hills turn to sea.
     The sun here is strong enough to bleach a pale sand to white, so the beach
     tone is picked dark enough to still read as sand in full daylight. */
  const groundBase = col(0x9c8058);
  for (const m of leafMats || []) m.color.copy(col(0x6f8f7a));

  /* ---------- 2. the sea replaces the meadow ---------- */
  /* The upstream lawn is a 40-unit disc that would swallow any water plane, so it
     is replaced by a sandy spit and the sea takes over everything beyond it. The
     upstream mesh stays in the scene but hidden, so its weather tint keeps working
     and nothing else has to change. */
  const SHORE_R = 7.4;
  let groundMesh = ground;
  if (ground) {
    before.ground = ground.material.color.clone();
    /* the stock lawn material carries the upstream snow-overlay shader; under this
       sun it blows out to white and reads as concrete, so the beach gets a plain
       sand material of its own */
    const sand = M(0x9c8058, { roughness: 0.94, flatShading: false });
    sand.color.copy(groundBase);
    const spit = new T.Mesh(new T.CircleGeometry(SHORE_R, 64), sand);
    spit.rotation.x = -Math.PI / 2;
    spit.position.set(ground.position.x, GY, ground.position.z);
    spit.receiveShadow = true;
    scene.add(spit);
    ground.visible = false;                       // the big lawn is gone; the spit takes over
    groundMesh = spit;
  }

  /* The upstream distant hills are a ring of 22 solid cones standing on the lawn.
     With the lawn replaced by water they would stand in the sea as a wall of
     green spikes blocking the whole horizon, so they leave the stage and a
     handful of low islets take their place — far enough out and low enough to
     stay quiet, which is what the scene plan asks of the distant view. */
  const isles = [];
  for (const m of hillMats || []) { m.color.copy(col(0x9aa6ae)); m.roughness = 0.9; }
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry || o.geometry.type !== 'ConeGeometry') return;
    if (!hillMats.includes(o.material)) return;
    o.visible = false;                      // the upstream hill ring is retired
    isles.push(o);
  });

  /* low sea islands: squashed cones just breaking the surface */
  const isleMat = M(0x8b9aa4, { roughness: 0.92, flatShading: true });
  const isleCap = M(0x6f8a84, { roughness: 0.95, flatShading: true });
  {
    const H = i => { const x = Math.sin(i * 91.7 + 13.3) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.9 + i / 9 * Math.PI * 1.8 + H(i) * 0.25;
      const r = 26 + H(i + 40) * 16;
      const w = 1.2 + H(i + 70) * 2.0;
      const h = 0.4 + H(i + 100) * 0.75;
      const g = group(scene, Math.cos(a) * r, GY - 0.12, Math.sin(a) * r);
      const rock = mesh(new T.ConeGeometry(w, h, 7), isleMat, 0, 0, 0, g);
      rock.scale.set(1, 1, 0.7 + H(i + 130) * 0.5);
      rock.rotation.y = H(i + 160) * 3;
      const top = mesh(new T.ConeGeometry(w * 0.46, h * 0.42, 7), isleCap, 0, h * 0.26, 0, g);
      top.scale.set(1, 1, 0.85);
      top.rotation.y = rock.rotation.y;
    }
  }

  /* a soft rim of sand right at the waterline hides the cut edge of the spit */
  const rim = mesh(new T.RingGeometry(SHORE_R - 0.55, SHORE_R + 0.5, 96),
    new T.MeshBasicMaterial({ color: col(0xe8dcbe), transparent: true, opacity: 0.85, depthWrite: false }),
    0, GY + 0.006, 0, scene, false);
  rim.rotation.x = -Math.PI / 2;
  rim.renderOrder = -0.7;

  const SEA_R = 46;
  const seaMat = new T.MeshStandardMaterial({
    color: col(0x4f8fae), roughness: 0.16, metalness: 0.22, flatShading: false,
  });
  /* The water is a ring, not a disc: a full disc would overlap the sand and the
     two near-coplanar surfaces would z-fight into stripes across the whole beach.
     The ring's inner edge tucks just under the sand so the waterline stays clean. */
  const sea = mesh(new T.RingGeometry(SHORE_R - 0.4, SEA_R, 128), seaMat, 0, GY - 0.05, 0, scene, false);
  sea.rotation.x = -Math.PI / 2;
  sea.renderOrder = -0.5;

  /* a moving swell: two overlapping wave trains. The crests only live on the water
     — they fade out over the sand spit and again toward the horizon, so the beach
     stays a beach instead of turning into a sheet of white stripes. */
  const waveGeo = new T.RingGeometry(SHORE_R - 0.2, SEA_R, 96, 40);
  waveGeo.rotateX(-Math.PI / 2);
  const waveU = { t: { value: 0 } };
  const waveMat = new T.ShaderMaterial({
    uniforms: waveU, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `
      varying vec2 vP; uniform float t;
      void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `
      varying vec2 vP; uniform float t;
      void main(){
        float w = sin(vP.x * 0.55 + t * 0.9) * 0.5 + sin(vP.y * 0.42 - t * 0.7) * 0.5;
        float w2 = sin((vP.x + vP.y) * 0.9 + t * 1.4);
        float band = smoothstep(0.55, 1.0, w * 0.6 + w2 * 0.25);
        float d = length(vP);
        /* only on open water, and strongest a little way out from the shore */
        float water = smoothstep(${SHORE_R}, ${SHORE_R + 3.0}, d);
        /* fade the crests out toward the horizon so the far water stays flat */
        float far = 1.0 - smoothstep(16.0, 40.0, d);
        float a = band * water * far;
        gl_FragColor = vec4(vec3(0.72, 0.86, 0.92) * a * 0.42, a * 0.30);
      }`,
  });
  const waves = mesh(waveGeo, waveMat, 0, GY - 0.03, 0, scene, false);
  waves.renderOrder = -0.4;

  /* a low foam line where the water meets the beach */
  const foamMat = new T.MeshBasicMaterial({ color: col(0xf2f6f4), transparent: true, opacity: 0.5, depthWrite: false });
  const foam = mesh(new T.RingGeometry(SHORE_R + 0.28, SHORE_R + 0.72, 96), foamMat, 0, GY + 0.014, 0, scene, false);
  foam.rotation.x = -Math.PI / 2;
  foam.renderOrder = -0.3;

  /* ---------- 2b. the jetty out to the water ---------- */
  /* Without it the house sits on a disc of sand with no connection to the sea.
     A short plank walkway running from the beach into the water gives the place a
     front door onto the ocean and breaks the hard circle of the shoreline. */
  const jetty = group(scene, 1.15, GY, -2.35);
  {
    const plank = M(0xb59268, { roughness: 0.82, flatShading: false });
    const post = M(0x8f7150, { roughness: 0.88, flatShading: false });
    const DECK_W = 0.92, DECK_L = 3.6, DECK_Y = 0.055;
    /* the deck, laid as separate boards so it does not read as one solid slab */
    for (let i = 0; i < 11; i++) {
      const b = boxMesh(DECK_W, 0.035, DECK_L / 11 * 0.86, plank, 0, DECK_Y, -i * (DECK_L / 11) - DECK_L / 22, jetty);
      b.rotation.y = 0;
      b.position.x = 0;
    }
    /* two side rails on short posts */
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const z = -i * (DECK_L / 4.6) - 0.15;
        cyl(jetty, post, 0.028, 0.032, 0.46, 6, side * (DECK_W / 2 - 0.04), DECK_Y + 0.23, z);
      }
      const rail = cyl(jetty, post, 0.024, 0.024, DECK_L * 0.86, 6, side * (DECK_W / 2 - 0.04), DECK_Y + 0.44, -DECK_L * 0.42);
      rail.rotation.x = Math.PI / 2;
    }
    /* the piles that hold it above the water */
    for (const side of [-1, 1]) for (const z of [-0.4, -2.2]) {
      cyl(jetty, post, 0.05, 0.06, 0.9, 6, side * (DECK_W / 2 - 0.1), DECK_Y - 0.42, z);
    }
    /* a small dinghy tied up at the end */
    const boat = group(jetty, 0.05, DECK_Y - 0.16, -DECK_L + 0.35);
    const hull = M(0xe8e2d4, { roughness: 0.55, flatShading: false });
    const boatBody = ball(boat, hull, 0, 0, 0, 0.17, 0.085, 0.38);
    boatBody.rotation.y = 0.25;
    const stripe = ball(boat, whaleMat, 0, 0.012, 0, 0.172, 0.03, 0.36);
    stripe.rotation.y = 0.25;
    for (const side of [-1, 1]) {
      const oar = cyl(boat, post, 0.014, 0.014, 0.62, 5, side * 0.1, 0.04, 0.02);
      oar.rotation.set(0, 0, side * 0.5); oar.rotation.y = 0.2;
    }
  }

  /* ---------- 2c. beach props: driftwood, a striped parasol ---------- */
  {
    const drift = M(0xa8927a, { roughness: 0.9, flatShading: true });
    for (const [x, z, r, s] of [[-4.2, -5.1, 0.4, 0.9], [3.4, 5.0, -0.8, 0.7], [-5.4, 1.4, 1.4, 0.6]]) {
      const d = cyl(scene, drift, 0.055 * s, 0.07 * s, 0.86 * s, 6, x, GY + 0.06 * s, z);
      d.rotation.set(0, r, Math.PI / 2);
      d.rotation.z = 0.1;
    }
    /* a parasol out on the sand, off to the side so it never blocks the view */
    const umb = group(scene, -4.6, GY, 4.4);
    const pole = cyl(umb, M(0xe6e0d4, { roughness: 0.6, flatShading: false }), 0.018, 0.02, 1.5, 6, 0, 0.75, 0);
    const canopy = mesh(new T.ConeGeometry(0.62, 0.34, 12, 1, true),
      M(0xe4a0a0, { roughness: 0.72, flatShading: false, side: T.DoubleSide }), 0, 1.42, 0, umb);
    canopy.castShadow = true;
    const tip = ball(umb, M(0xf2ede4, { roughness: 0.6, flatShading: false }), 0, 1.62, 0, 0.03, 0.05, 0.03);
  }

  /* ---------- 3. room props: a whale here and there ---------- */
  /* the shared prop materials live up here because the jetty below also borrows
     the whale blue for its dinghy stripe */
  /* a little whale figurine: the kind you keep on a shelf */
  function whaleFigure(parent, scale) {
    const g = group(parent);
    g.scale.setScalar(scale);
    const body = ball(g, whaleMat, 0, 0, 0, 0.10, 0.072, 0.062);
    body.rotation.z = 0.08;
    const belly = ball(g, whaleBelly, 0, -0.026, 0.012, 0.082, 0.046, 0.052);
    const tail = group(g, -0.094, 0.012, 0);
    const fluke = mesh(new T.ShapeGeometry((() => {
      const s = new T.Shape(); s.moveTo(0, 0);
      s.bezierCurveTo(-0.03, 0.035, -0.075, 0.05, -0.105, 0.012);
      s.bezierCurveTo(-0.075, -0.012, -0.03, -0.03, 0, 0); return s;
    })(), 16), whaleFin, 0, 0, 0, tail);
    fluke.rotation.x = -Math.PI / 2;
    for (const side of [-1, 1]) {
      const f = mesh(new T.SphereGeometry(1, 12, 8), whaleFin, 0.01, -0.03, side * 0.045, g);
      f.scale.set(0.032, 0.008, 0.018); f.rotation.y = side * 0.5;
    }
    ball(g, whaleBelly, 0.072, 0.022, 0.052, 0.014, 0.010, 0.010);
    return g;
  }

  /* a whale-tail wall hook by the door, and a glass float on the sill */
  const hook = group(scene, -1.86, 1.62, -1.96);
  {
    const m = M(P.woodL, { roughness: 0.55 });
    const plate = mesh(new T.CylinderGeometry(0.03, 0.03, 0.012, 12), m, 0, 0, 0, hook);
    plate.rotation.x = Math.PI / 2;
    const stem = cyl(hook, m, 0.008, 0.008, 0.07, 8, 0, -0.03, 0.035);
    stem.rotation.x = Math.PI / 2.4;
    const tail = mesh(new T.ShapeGeometry((() => {
      const s = new T.Shape(); s.moveTo(0, 0);
      s.bezierCurveTo(-0.018, 0.022, -0.048, 0.034, -0.068, 0.008);
      s.bezierCurveTo(-0.048, -0.008, -0.018, -0.02, 0, 0); return s;
    })(), 16), whaleMat, 0, -0.075, 0.05, hook);
    tail.rotation.x = -Math.PI / 2;
  }

  /* a whale on the windowsill, looking out at the water it lives in */
  const sillWhale = whaleFigure(scene, 1.15);
  sillWhale.position.set(1.42, 1.06, -2.24);
  sillWhale.rotation.y = -0.5;

  /* a shell and a driftwood bowl on the desk side of the room */
  const shell = group(scene, -1.72, 0.545, -1.72);
  {
    const m = M(0xf0e2d0, { roughness: 0.55, flatShading: false });
    const s = new T.Shape();
    s.moveTo(0, 0); s.bezierCurveTo(0.03, 0.02, 0.055, 0.05, 0.06, 0.075);
    s.bezierCurveTo(0.045, 0.055, 0.02, 0.03, 0, 0);
    const geo = new T.LatheGeometry([new T.Vector2(0.001, 0), new T.Vector2(0.035, 0.012), new T.Vector2(0.058, 0.05), new T.Vector2(0.062, 0.082)], 14);
    mesh(geo, m, 0, 0, 0, shell);
  }

  /* a whale-shaped cushion on the bed */
  const cushion = whaleFigure(scene, 1.9);
  cushion.position.set(-1.62, 0.60, -1.16);
  cushion.rotation.y = 0.7;
  cushion.rotation.z = -0.12;

  /* a glass float by the radio shelf, echoing the sea outside */
  const float = group(scene, -1.62, 1.335, -0.72);
  {
    const b = ball(float, glassMat, 0, 0.03, 0, 0.045, 0.045, 0.045);
    b.material = glassMat;
    const inner = ball(float, whaleBelly, 0, 0.026, 0, 0.018, 0.016, 0.018);
  }

  /* ---------- 4. keep the room's own systems in charge of the new colours ---------- */
  const api = {
    sea, waves, foam, groundBase, groundMesh,
    /* moli-room drives this from its own frame loop: night, rain and snow all
       still work, they just land on water instead of on grass. */
    update(t, night, rain, cover) {
      waveU.t.value = t;
      const dusk = col(0x4f8fae), nightCol = col(0x1d3a52), storm = col(0x54707d);
      const c = seaMat.color;
      c.copy(dusk).lerp(nightCol, night);
      if (rain > 0.05) c.lerp(storm, Math.min(0.7, rain * 0.8));
      seaMat.roughness = 0.16 + rain * 0.4;
      foamMat.opacity = 0.5 + Math.sin(t * 1.4) * 0.08 - rain * 0.25;
      waveMat.opacity = 0.9;
      if (cover > 0.02) { seaMat.color.lerp(col(0xc9d6dd), cover * 0.35); }
      /* The upstream fog starts just past the house, which was tuned for a small
         meadow. Over open water it swallows the whole sea and turns it into a
         white sheet, so the haze is pushed back until the water keeps its colour
         and only the far horizon dissolves. */
      scene.fog.near = Math.max(scene.fog.near, 24);
      scene.fog.far = Math.max(scene.fog.far, 62);
    },
    /* restore the upstream palette if the theme is ever turned off */
    restore() {
      for (const k in before) mat[k] && mat[k].color.copy(before[k]);
      if (before.ground && ground) ground.material.color.copy(before.ground);
      if (ground) ground.visible = true;
      if (groundMesh && groundMesh !== ground) { scene.remove(groundMesh); groundMesh.dispose && groundMesh.dispose(); }
    },
  };
  return api;
};
})();
