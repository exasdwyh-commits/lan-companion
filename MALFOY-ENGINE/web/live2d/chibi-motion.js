/* Shared by the current stage, motion preview and Node checks. No IPC or storage. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChibiMotion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TAU = Math.PI * 2, RAD = Math.PI / 180, STEP = 1 / 120;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function random(seed) {
    let state = seed >>> 0;
    return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  // Pivots in original texture UV; angle limits protect this SINGLE painted pose.
  // A layered rig can use the same hierarchy with its own bind pose and limits.
  const BONES = [
    { name: "root", parent: -1, x: .465, y: .97, limit: 2 },
    { name: "body", parent: 0, x: .465, y: .875, limit: 3 },
    { name: "head", parent: 1, x: .455, y: .535, limit: 5 },
    { name: "hairL", parent: 2, x: .225, y: .49, limit: 3 },
    { name: "hairR", parent: 2, x: .66, y: .49, limit: 3 },
    { name: "armL", parent: 1, x: .37, y: .565, limit: 6 },
    { name: "foreL", parent: 5, x: .345, y: .64, limit: 8 },
    { name: "armR", parent: 1, x: .54, y: .565, limit: 6 },
    { name: "foreR", parent: 7, x: .565, y: .64, limit: 8 },
    { name: "legL", parent: 0, x: .405, y: .88, limit: 4 },
    { name: "kneeL", parent: 9, x: .405, y: .92, limit: 4 },
    { name: "footL", parent: 10, x: .405, y: .955, limit: 3 },
    { name: "legR", parent: 0, x: .53, y: .88, limit: 4 },
    { name: "kneeR", parent: 12, x: .53, y: .92, limit: 4 },
    { name: "footR", parent: 13, x: .53, y: .955, limit: 3 },
    { name: "tail", parent: 1, x: .585, y: .875, limit: 3 },
  ];
  const INDEX = Object.fromEntries(BONES.map((b, i) => [b.name, i]));
  const ACTIONS = Object.freeze({
    look: { duration: [2.5, 4.2], cooldown: 7, weight: 3 },
    nod: { duration: [1.1, 1.6], cooldown: 6, weight: 1 },
    stretch: { duration: [3.2, 4.3], cooldown: 18, weight: 1 },
    greet: { duration: [1.8, 2.5], cooldown: 10, weight: 1.2 },
    sway: { duration: [2.5, 4], cooldown: 10, weight: 1.5 },
  });
  const ACTIVITIES = new Set(["idle", "thinking", "speaking", "working", "reading", "singing"]);

  // Affine matrices [a,b,c,d,tx,ty], in image-height units (correct aspect ratio).
  function multiply(a, b) {
    return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
      a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
      a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
  }
  function point(m, x, y) { return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]; }

  class Rig {
    constructor(aspect = 1, columns = 28, rows = 48) {
      this.aspect = aspect;
      this.world = []; this.skin = [];
      this.vertices = []; this.triangles = [];
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
        const u = x / columns, v = y / rows;
        this.vertices.push({ u, v, weights: this.weights(u, v) });
      }
      for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        const i = y * (columns + 1) + x, j = i + columns + 1;
        this.triangles.push(i, i + 1, j, i + 1, j + 1, j);
      }
      this.deformed = new Float32Array(this.vertices.length * 2);
      this.solve(new Float32Array(BONES.length));
    }
    weights(u, v) {
      // Continuous masks, no clipped/cut-out limbs. Hair behind arms cannot be
      // reconstructed from this bitmap, hence small-angle constraints above.
      const list = new Map();
      const add = (name, value) => { if (value > .00001) list.set(INDEX[name], (list.get(INDEX[name]) || 0) + value); };
      // Round v2 artwork: neck at .535, tiny feet below .89. The lower-right
      // tail must never inherit the old full-width "legs" mask.
      const head = 1 - smooth(.50, .565, v);
      const tail = (1-head) * smooth(.595, .715, u) * smooth(.70, .80, v);
      const legs = (1-head-tail) * smooth(.866, .91, v);
      const middle = 1-head-tail-legs;
      const side = smooth(.13, .205, Math.abs(u-.455));
      const hair = side * (1-smooth(.73, .80, v)) * smooth(.40, .56, v) * .82;
      const armX = u < .455 ? .36 : .55;
      const distance = Math.hypot((u-armX)/.085, (v-.635)/.095);
      const arm = (1-hair) * (1-smooth(.65, 1.15, distance)) *
        smooth(.54, .575, v) * (1-smooth(.70, .735, v));
      const fore = smooth(.61, .66, v);
      add("head", head);
      add(u < .455 ? "hairL" : "hairR", middle * hair);
      add(u < .455 ? "armL" : "armR", middle * arm * (1-fore));
      add(u < .455 ? "foreL" : "foreR", middle * arm * fore);
      add("body", middle * (1-hair-arm));
      add("tail", tail);
      const right = smooth(.452, .474, u), knee = smooth(.905, .94, v), foot = smooth(.94, .97, v);
      for (const [suffix, weight] of [["L", 1-right], ["R", right]]) {
        add("leg"+suffix, legs * weight * (1-knee));
        add("knee"+suffix, legs * weight * knee * (1-foot));
        add("foot"+suffix, legs * weight * knee * foot);
      }
      const total = [...list.values()].reduce((a,b) => a+b, 0);
      return [...list].map(([bone, weight]) => [bone, weight / total]);
    }
    solve(pose) {
      BONES.forEach((bone, i) => {
        const parent = BONES[bone.parent], x = bone.x*this.aspect, y = bone.y;
        const angle = clamp(Number.isFinite(pose[i]) ? pose[i] : 0, -bone.limit*RAD, bone.limit*RAD);
        const c = Math.cos(angle), s = Math.sin(angle);
        const local = [c,s,-s,c, x-(parent ? parent.x*this.aspect : 0), y-(parent ? parent.y : 0)];
        this.world[i] = parent ? multiply(this.world[bone.parent], local) : local;
        this.skin[i] = multiply(this.world[i], [1,0,0,1,-x,-y]);
      });
      this.vertices.forEach((vertex, i) => {
        let x=0,y=0;
        for (const [bone, weight] of vertex.weights) {
          const m=this.skin[bone],px=vertex.u*this.aspect,py=vertex.v;
          x += (m[0]*px+m[2]*py+m[4])*weight;
          y += (m[1]*px+m[3]*py+m[5])*weight;
        }
        this.deformed[i*2] = x; this.deformed[i*2+1] = y;
      });
      return this.deformed;
    }
  }

  class Controller {
    constructor(seed = 1) {
      this.rng = random(seed); this.time = 0; this.accumulator = 0;
      this.pose = new Float32Array(BONES.length);
      this.velocity = new Float32Array(BONES.length);
      this.phase = this.rng()*TAU; this.gait = 0; this.activity = "idle";
      this.action = null; this.cooldown = {}; this.nextIdle = 3+this.rng()*5;
      this.history = []; this.lastAutomatic = null; this.reducedMotion = false;
      this.look = 0; this.walkWeight = 0;
    }
    setActivity(name) {
      if (!ACTIVITIES.has(name)) return false;
      this.activity = name;
      if (name !== "idle") this.action = null;
      return true;
    }
    requestAction(name, { priority = 2, duration } = {}) {
      if (!Object.hasOwn(ACTIONS, name) || !Number.isFinite(priority)) return false;
      if (this.activity !== "idle" && priority < 3) return false;
      if (this.action && priority < this.action.priority) return false;
      if ((this.cooldown[name] || 0) > this.time && priority <= 0) return false;
      const spec = ACTIONS[name], span = spec.duration;
      const chosen = duration === undefined ? span[0]+this.rng()*(span[1]-span[0]) : duration;
      if (!Number.isFinite(chosen)) return false;
      this.action = { name, age: 0, duration: clamp(chosen, .6, 8), priority };
      this.cooldown[name] = this.time + this.action.duration + spec.cooldown;
      this.history.push({ name, at: this.time, priority });
      if (this.history.length > 40) this.history.shift();
      return true;
    }
    chooseIdle() {
      const candidates = Object.entries(ACTIONS).filter(([name]) =>
        name !== this.lastAutomatic && (this.cooldown[name] || 0) <= this.time);
      let total = candidates.reduce((n,[,v]) => n+v.weight,0), pick = this.rng()*total;
      for (const [name,spec] of candidates) {
        pick -= spec.weight;
        if (pick <= 0) { this.requestAction(name,{priority:0}); this.lastAutomatic=name; break; }
      }
      this.nextIdle = this.time+5+this.rng()*8;
    }
    step(context) {
      this.time += STEP;
      const walking = context.locomotion === "walk" && this.activity === "idle" && !context.dragging;
      this.walkWeight += ((walking ? 1 : 0)-this.walkWeight)*(1-Math.exp(-STEP*9));
      this.gait += STEP * clamp(Math.abs(context.speed || 62)/62, .4, 1.8) * 7;
      if (this.action) {
        this.action.age += STEP;
        if (this.action.age >= this.action.duration) this.action = null;
      }
      if (!this.reducedMotion && !walking && !context.dragging && this.activity === "idle" &&
          !this.action && this.time >= this.nextIdle) this.chooseIdle();
      const target = new Float32Array(BONES.length);
      const put = (name, angle) => { target[INDEX[name]] += angle*RAD; };
      const t=this.time, quiet=this.reducedMotion ? .18 : 1;
      this.look += (clamp(context.lookX || 0,-1,1)-this.look)*(1-Math.exp(-STEP*4));
      put("body", Math.sin(t*1.4+this.phase)*.5*quiet);
      put("head", (this.look*2.4+Math.sin(t*.7+this.phase)*.5)*quiet);
      put("tail", (Math.sin(t*1.7+this.phase)*1.2-this.velocity[INDEX.body]*4)*quiet);
      const gait=Math.sin(this.gait)*this.walkWeight*quiet;
      put("legL", gait*5); put("legR", -gait*5);
      put("kneeL", Math.max(0,-gait)*5); put("kneeR", Math.max(0,gait)*5);
      put("footL", -gait*2); put("footR", gait*2);
      put("armL", -gait*4); put("armR", gait*4);
      put("body", gait*.7);
      if (context.locomotion === "jump" || context.locomotion === "fall") {
        put("armL", 5*quiet); put("armR", -5*quiet);
        put("kneeL", 5*quiet); put("kneeR", 5*quiet);
      }
      if (this.action) {
        const {name,age,duration}=this.action;
        const envelope=smooth(0,.3,age)*(1-smooth(duration-.4,duration,age))*quiet;
        const wave=Math.sin(age*TAU*1.1)*envelope;
        if (name==="look") put("head", Math.sin(age*1.7)*3.3*envelope);
        if (name==="nod") { put("head",wave*3.5); put("body",wave*.6); }
        if (name==="stretch") { put("body",Math.sin(age*1.2)*2*envelope); put("armL",-6*envelope); put("armR",6*envelope); }
        if (name==="greet") { put("foreR",wave*8); put("armR",4*envelope); put("head",-1.5*envelope); }
        if (name==="sway") { put("body",wave*1.5); put("head",-wave*1.5); }
      }
      if (this.activity==="thinking" || this.activity==="working") put("head", 2*quiet);
      if (this.activity==="reading") { put("head",2.5*quiet); put("foreL",-3*quiet); put("foreR",3*quiet); }
      if (this.activity==="speaking") put("head", Math.sin(t*3.5)*1.4*quiet);
      if (this.activity==="singing") { put("body",Math.sin(t*2.4)*1.4*quiet); put("head",Math.sin(t*2.4+.6)*2*quiet); }
      // Hair follows the head with a softer, damped response. No unbounded noise.
      put("hairL", -this.velocity[INDEX.head]*8*quiet + Math.sin(t*1.1)*.7*quiet);
      put("hairR", -this.velocity[INDEX.head]*8*quiet + Math.sin(t*1.1+.7)*.7*quiet);
      BONES.forEach((bone,i) => {
        const limit=bone.limit*RAD;
        const goal=clamp(target[i],-limit,limit), omega=bone.name.startsWith("hair") ? 8 : 13;
        this.velocity[i] += (omega*omega*(goal-this.pose[i])-2*omega*this.velocity[i])*STEP;
        this.pose[i] = clamp(this.pose[i]+this.velocity[i]*STEP,-limit,limit);
      });
    }
    tick(dt, context = {}) {
      this.reducedMotion=!!context.reducedMotion;
      this.accumulator += clamp(Number.isFinite(dt) ? dt : 0,0,.25);
      while (this.accumulator+1e-9 >= STEP) { this.step(context); this.accumulator-=STEP; }
      return this.pose;
    }
    get state() {
      return { activity:this.activity, action:this.action && this.action.name, time:this.time,
        reducedMotion:this.reducedMotion, bones:BONES.length, history:this.history.slice() };
    }
  }
  return { BONES, ACTIONS, INDEX, Rig, Controller, random, clamp, multiply, point };
});
