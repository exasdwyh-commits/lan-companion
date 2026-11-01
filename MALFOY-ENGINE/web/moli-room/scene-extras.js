/* Scene extras — light shafts, dust motes, rain on the glass, fireflies.
   Additive and self-contained: moli-room keeps its own sky, weather and day/night
   (see W and world.altDeg), and this module only reads them. Nothing here owns
   state; if it fails to build, the room looks exactly as it did before.

   Why these four and not a new post-processing stack:
   the room already renders through bloom → tilt-shift → ACES grade. Adding a
   second composer would fight that chain. What the room was missing is not
   polish on the pipeline but *volume inside the frame* — light with air in it,
   weather you can see from indoors, and something alive at night.

   Coordinates are the room's own (index.html): floor y = GY = −0.44, back wall
   inner face z ≈ −2.00, window rect x∈[0.65,1.65] y∈[0.875,2.025] on that wall. */
(function () {
'use strict';

window.createSceneExtras = function ({ scene, THREE, W, sun, world, camera, quality = 'high' }) {
  const T = THREE;
  const WIN = { x0: 0.65, x1: 1.65, y0: 0.875, y1: 2.025, z: -1.995 };
  const FLOOR_Y = -0.44;

  const FX = {
    shafts: null, dust: null, rain: null, flies: null,
    enabled: true, quality, t: 0, seed: 1337,
  };

  /* Deterministic per-instance randomness: the same room always grows the same
     dust. Matters more than it looks — a particle field that reshuffles on every
     load reads as "noise", not as "this place". */
  function rnd() {
    FX.seed = (FX.seed * 1664525 + 1013904223) >>> 0;
    return FX.seed / 4294967296;
  }

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };

  /* ---------- 1. light shafts through the window ------------------------------ */

  const SHAFT_VERT = `
    attribute float aEdge;
    varying vec2 vUv2;
    varying float vEdge;
    void main() {
      vUv2 = uv; vEdge = aEdge;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

  const SHAFT_FRAG = `
    uniform vec3 uColor;
    uniform float uIntensity, uTime, uNoise;
    varying vec2 vUv2;
    varying float vEdge;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      /* across the beam: soft at both edges, brightest down the middle */
      float across = sin(3.14159 * clamp(vUv2.x, 0.0, 1.0));
      across = pow(across, 2.2);
      /* along the beam: strongest at the glass, gone before it piles up on the floor */
      float along = pow(1.0 - clamp(vUv2.y, 0.0, 1.0), 2.6);
      /* slow drifting motes inside the beam so the shaft is not a static card */
      float n = vnoise(vec2(vUv2.x * 3.0 + uTime * 0.015, vUv2.y * 2.0 - uTime * 0.05));
      float grain = mix(1.0, 0.55 + 0.9 * n, uNoise);
      float a = across * along * grain * vEdge * uIntensity;
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor * a, a);
    }`;

  function buildShaft() {
    const g = new T.BufferGeometry();
    /* window corners (winding matters: we want the beam visible from inside,
       and double-sided-less is cheaper and filters correctly) */
    const corners = [
      [WIN.x0, WIN.y0], [WIN.x1, WIN.y0], [WIN.x1, WIN.y1], [WIN.x0, WIN.y1],
    ];
    const pos = [], uv = [], edge = [], idx = [];
    /* four ribbons, one per window edge, each extruded to its projected end */
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const base = pos.length / 3;
      const pts = [a, b, null, null];
      for (const p of pts) {
        if (!p) continue;
        pos.push(p[0], p[1], WIN.z);
        edge.push(1);
      }
      /* end points are filled in per-frame by aimShaft(); reserve the slots */
      for (let k = 0; k < 2; k++) { pos.push(0, 0, 0); edge.push(0); }
      uv.push(0, 0, 1, 0, 0, 1, 1, 1);
      idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('aEdge', new T.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    g.userData.windowCorners = corners;
    return g;
  }

  /* Re-project the beam's far end along the sun direction each time the sun moves.
     Done on the CPU because the far end must land on the floor (or on the wall),
     and doing that in a shader means giving the shader the room's box too. */
  function aimShaft(dir) {
    const g = FX.shafts && FX.shafts.geometry;
    if (!g) return;
    const attr = g.getAttribute('position');
    const corners = g.userData.windowCorners;
    /* dir points from the room toward the sun; light travels the other way */
    const dx = -dir.x, dy = -dir.y, dz = -dir.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      /* how far until this corner's ray hits the floor or the back wall? */
      let t = 4;
      if (uy < -0.02) t = Math.min(t, (FLOOR_Y - c[1]) / uy);
      if (uz < -0.02) t = Math.min(t, (-2.02 - WIN.z) / uz + 0.02);
      t = Math.max(1.0, Math.min(t, 4));
      const base = i * 4;
      attr.setXYZ(base + 2, c[0] + ux * t, c[1] + uy * t, WIN.z + uz * t);
      attr.setXYZ(base + 3, (corners[(i + 1) % 4])[0] + ux * t, (corners[(i + 1) % 4])[1] + uy * t, WIN.z + uz * t);
    }
    attr.needsUpdate = true;
    g.computeBoundingSphere();
  }

  function buildShafts() {
    const mat = new T.ShaderMaterial({
      uniforms: {
        uColor: { value: new T.Color(1.0, 0.86, 0.62) },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uNoise: { value: FX.quality === 'high' ? 1 : 0 },
      },
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
    });
    const mesh = new T.Mesh(buildShaft(), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.name = 'fx-shafts';
    scene.add(mesh);
    FX.shafts = mesh;
  }

  /* ---------- 2. dust motes hanging in the beam ------------------------------- */

  const DUST_VERT = `
    attribute vec3 aSeed;
    uniform float uTime, uPixel;
    varying float vTwinkle;
    void main() {
      vec3 p = position + vec3(
        sin(uTime * 0.29 + aSeed.x * 6.283) * 0.05,
        sin(uTime * 0.19 + aSeed.y * 6.283) * 0.035 + sin(uTime * 0.07) * 0.02,
        sin(uTime * 0.23 + aSeed.z * 6.283) * 0.05);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vTwinkle = 0.55 + 0.45 * sin(uTime * (0.7 + aSeed.x * 1.6) + aSeed.y * 6.283);
      gl_PointSize = uPixel * (0.012 + aSeed.z * 0.010) * (12.0 / max(0.6, -mv.z));
      gl_Position = projectionMatrix * mv;
    }`;

  const DUST_FRAG = `
    uniform float uIntensity;
    uniform vec3 uColor;
    varying float vTwinkle;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r = dot(d, d);
      if (r > 0.25) discard;
      float a = (1.0 - r * 4.0);
      a *= a * vTwinkle * uIntensity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(uColor * a, a);
    }`;

  function buildDust() {
    const count = FX.quality === 'high' ? 420 : 160;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      /* sample inside the wedge the beam sweeps: window plane → floor */
      const u = rnd();
      pos[i * 3] = WIN.x0 + (WIN.x1 - WIN.x0) * rnd() + (rnd() - 0.5) * 0.9;
      pos[i * 3 + 1] = WIN.y0 + (WIN.y1 - WIN.y0) * rnd() - u * 1.4;
      pos[i * 3 + 2] = WIN.z + 0.1 + rnd() * 1.5;
      seed[i * 3] = rnd(); seed[i * 3 + 1] = rnd(); seed[i * 3 + 2] = rnd();
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new T.BufferAttribute(seed, 3));
    const mat = new T.ShaderMaterial({
      uniforms: {
        uColor: { value: new T.Color(1.0, 0.9, 0.72) },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uPixel: { value: 1 },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    const pts = new T.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    pts.name = 'fx-dust';
    scene.add(pts);
    FX.dust = pts;
  }

  /* ---------- 3. rain running down the glass ---------------------------------- */

  const RAIN_FRAG = `
    uniform sampler2D tDiffuse;
    uniform float uRain, uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      /* vertical bands of droplets, each band drifting at its own speed */
      float cols = 26.0, rows = 34.0;
      vec2 cell = vec2(uv.x * cols, uv.y * rows);
      vec2 id = floor(cell);
      vec2 f = fract(cell) - 0.5;
      float h = hash(id);
      /* only some cells hold a bead, and they slide down over time */
      float alive = step(0.45, h);
      float slide = fract(h * 7.0 + uTime * (0.05 + h * 0.12));
      vec2 offset = vec2((h - 0.5) * 0.55, (slide - 0.5) * 0.9);
      float d = length((f - offset) * vec2(1.0, 1.45));
      float bead = smoothstep(0.30, 0.02, d) * alive;
      /* thin trails behind each bead */
      float trail = smoothstep(0.42, 0.0, abs(f.x - offset.x)) * smoothstep(0.5, -0.1, f.y - offset.y) * alive * 0.35;
      /* a light condensation veil so the view outside softens */
      float veil = 0.12 * (0.6 + 0.4 * sin(uv.y * 40.0 + uTime * 0.6));
      float a = (bead * 0.55 + trail * 0.30 + veil) * uRain;
      vec3 c = vec3(0.78, 0.86, 0.98) * a;
      gl_FragColor = vec4(c, a);
    }`;

  function buildRainGlass() {
    const g = new T.PlaneGeometry(WIN.x1 - WIN.x0, WIN.y1 - WIN.y0);
    const mat = new T.ShaderMaterial({
      uniforms: { uRain: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    const mesh = new T.Mesh(g, mat);
    mesh.position.set((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, WIN.z + 0.004);
    mesh.renderOrder = 5;
    mesh.name = 'fx-rainglass';
    scene.add(mesh);
    FX.rain = mesh;
  }

  /* ---------- 4. fireflies outside, only once the sun is down ------------------ */

  const FLY_VERT = `
    attribute vec3 aSeed;
    uniform float uTime, uPixel;
    varying float vPulse;
    void main() {
      vec3 p = position + vec3(
        sin(uTime * 0.5 + aSeed.x * 6.283) * 0.45,
        sin(uTime * 0.37 + aSeed.y * 6.283) * 0.22,
        sin(uTime * 0.44 + aSeed.z * 6.283) * 0.30);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vPulse = pow(0.5 + 0.5 * sin(uTime * (0.9 + aSeed.x) + aSeed.z * 6.283), 2.0);
      gl_PointSize = uPixel * (0.02 + aSeed.y * 0.012) * (14.0 / max(0.6, -mv.z));
      gl_Position = projectionMatrix * mv;
    }`;

  const FLY_FRAG = `
    uniform float uIntensity;
    uniform vec3 uColor;
    varying float vPulse;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r = dot(d, d);
      if (r > 0.25) discard;
      float core = smoothstep(0.25, 0.0, r);
      float halo = smoothstep(0.25, 0.02, r) * 0.35;
      float a = (core + halo) * vPulse * uIntensity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(uColor * a, a);
    }`;

  function buildFireflies() {
    const count = FX.quality === 'high' ? 46 : 20;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      /* Kept inside the window's cone. Fireflies spread across the whole
         garden would be 90% hidden behind the back wall — invisible particles
         still cost fill rate, and "there are fireflies somewhere" is not an
         effect. Everything we spawn is something you can actually see. */
      pos[i * 3] = WIN.x0 - 1.0 + (WIN.x1 - WIN.x0 + 2.0) * rnd();
      pos[i * 3 + 1] = 0.25 + rnd() * 1.75;
      pos[i * 3 + 2] = -2.45 - rnd() * 1.9;
      seed[i * 3] = rnd(); seed[i * 3 + 1] = rnd(); seed[i * 3 + 2] = rnd();
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new T.BufferAttribute(seed, 3));
    const mat = new T.ShaderMaterial({
      uniforms: {
        uColor: { value: new T.Color(1.0, 0.92, 0.55) },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uPixel: { value: 1 },
      },
      vertexShader: FLY_VERT,
      fragmentShader: FLY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    const pts = new T.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    pts.name = 'fx-fireflies';
    scene.add(pts);
    FX.flies = pts;
  }

  /* ---------- build / update -------------------------------------------------- */

  const state = { alt: 30, rain: 0, cloud: 0, fog: 0, night: 0 };

  function readState() {
    /* world.altDeg is the room's own sun altitude; W.* is the smoothed weather */
    state.alt = num(world && world.altDeg, 30);
    state.rain = clamp01(num(W && W.rain, 0));
    state.cloud = clamp01(num(W && W.cloud, 0));
    state.fog = clamp01(num(W && W.fog, 0));
    state.night = smooth(6, -4, state.alt);    // 0 in daylight, 1 once the sun is well down
  }

  /* Direction pointing from the room toward the sun.
     The room positions its sun as `target + dir * -14`, so `position` alone is
     only the direction if the target sits at the origin. Subtracting the target
     makes it exact no matter where the room moves it. */
  function sunDir() {
    if (sun && sun.position) {
      const tgt = sun.target && sun.target.position;
      const v = tgt ? sun.position.clone().sub(tgt) : sun.position.clone();
      const len = Math.hypot(v.x, v.y, v.z);
      if (len > 1e-5) return { x: v.x / len, y: v.y / len, z: v.z / len };
    }
    return { x: 0.4, y: 0.7, z: 0.5 };
  }

  function update(dt, pixelRatio) {
    if (!FX.enabled) return;
    FX.t += Math.min(0.1, dt || 0.016);
    readState();
    const t = FX.t;

    if (FX.shafts) {
      const dir = sunDir();
      aimShaft(dir);
      /* Low sun = long, obvious shafts. Cloud and rain eat them. */
      const low = smooth(2, 16, state.alt) * (1 - smooth(34, 62, state.alt) * 0.65);
      const clear = (1 - 0.8 * state.cloud) * (1 - 0.6 * state.rain);
      FX.shafts.material.uniforms.uIntensity.value = clamp01(low * clear * 0.30);
      FX.shafts.material.uniforms.uTime.value = t;
      FX.shafts.material.uniforms.uNoise.value = FX.quality === 'high' ? 1 : 0;
    }
    if (FX.dust) {
      const u = FX.dust.material.uniforms;
      u.uTime.value = t;
      u.uPixel.value = num(pixelRatio, 1) * 90;
      /* dust only reads where there is a beam to catch it */
      u.uIntensity.value = FX.shafts ? FX.shafts.material.uniforms.uIntensity.value * 0.55 : 0;
    }
    if (FX.rain) {
      const u = FX.rain.material.uniforms;
      u.uTime.value = t;
      /* ramps in early: a drizzle should already show on the glass */
      u.uRain.value = smooth(0.02, 0.55, state.rain);
    }
    if (FX.flies) {
      const u = FX.flies.material.uniforms;
      u.uTime.value = t;
      u.uPixel.value = num(pixelRatio, 1) * 90;
      /* glow-worms do not come out in the rain */
      u.uIntensity.value = state.night * (1 - 0.85 * state.rain) * (1 - 0.4 * state.fog) * 0.9;
    }
  }

  /**
   * Screen coverage of one of our objects, in normalised page coordinates.
   *
   * This exists because pixel-diffing screenshots is the wrong instrument in this
   * room: the ocean outside the window and the grade pass's film grain make every
   * frame differ from the next by ~10% of its pixels, which drowns a subtle shaft.
   * Projecting the geometry through the actual camera answers the question we
   * actually care about — "is it on screen, and how much of it" — with no noise:
   *   area = 0 means the effect is outside the frame (a silent no-op);
   *   area tiny means it is technically there and visually absent.
   */
  function coverage(obj) {
    if (!obj || !camera || !obj.geometry) return null;
    const pos = obj.geometry.getAttribute('position');
    if (!pos || !pos.count) return null;
    obj.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const m = new T.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(obj.matrixWorld);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (!isFinite(v.x) || !isFinite(v.y)) continue;
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      n += 1;
    }
    if (!n) return null;
    const cw = Math.max(0, Math.min(1, x1) - Math.max(-1, x0));
    const ch = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
    return {
      x0: (x0 + 1) / 2, x1: (x1 + 1) / 2,
      y0: (1 - y1) / 2, y1: (1 - y0) / 2,
      area: (cw / 2) * (ch / 2),
      onScreen: cw > 0 && ch > 0,
    };
  }

  function dispose() {
    for (const key of ['shafts', 'dust', 'rain', 'flies']) {
      const obj = FX[key];
      if (!obj) continue;
      if (obj.parent) obj.parent.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
      FX[key] = null;
    }
  }

  try {
    buildShafts();
    buildDust();
    buildRainGlass();
    buildFireflies();
    aimShaft(sunDir());
  } catch (error) {
    console.warn('[fx] scene extras failed, room unchanged:', error && error.message);
    dispose();
    FX.enabled = false;
  }

  return {
    update,
    /* Toggling also hides the objects, not just the uniform updates: that makes
       on/off comparable inside a single page load, which is how the headless
       probe measures the contribution without character animation noise. */
    setEnabled(on) {
      FX.enabled = !!on;
      for (const key of ['shafts', 'dust', 'rain', 'flies']) {
        const obj = FX[key];
        if (obj) obj.visible = FX.enabled;
      }
    },
    getEnabled() { return FX.enabled; },
    setQuality(q) {
      if (q === FX.quality) return;
      FX.quality = q === 'low' ? 'low' : 'high';
      /* rebuild the particle layers at the new density */
      for (const key of ['dust', 'flies']) {
        const obj = FX[key];
        if (obj) { scene.remove(obj); obj.geometry.dispose(); obj.material.dispose(); FX[key] = null; }
      }
      try { buildDust(); buildFireflies(); } catch (_) { /* keep whatever we have */ }
    },
    /* read-only snapshot for probes and for the diagnostics panel */
    info() {
      return {
        enabled: FX.enabled, quality: FX.quality,
        shaftIntensity: FX.shafts ? FX.shafts.material.uniforms.uIntensity.value : 0,
        dustIntensity: FX.dust ? FX.dust.material.uniforms.uIntensity.value : 0,
        rainIntensity: FX.rain ? FX.rain.material.uniforms.uRain.value : 0,
        flyIntensity: FX.flies ? FX.flies.material.uniforms.uIntensity.value : 0,
        alt: state.alt, night: state.night,
        coverage: {
          shafts: coverage(FX.shafts),
          rain: coverage(FX.rain),
          flies: coverage(FX.flies),
        },
      };
    },
    dispose,
  };
};
})();
