(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WhaleWorldVideo = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const STATES = ["idle", "touch", "quiet", "sleep"];
  // 动作片尾淡出判据：只对非循环的触摸片段生效，循环待机不需要。
  function tailFadeActive(state, remaining, fade = 0.4) {
    return state === "touch" && Number.isFinite(remaining) && remaining > 0 && remaining <= fade;
  }
  class Lifecycle {
    constructor(config = {}) {
      this.quietAfter = config.quietAfterSeconds || 60;
      this.sleepAfter = config.sleepAfterSeconds || 300;
      this.state = "idle"; this.idle = 0; this.active = true;
      this.paused = false; this.hidden = false; this.busy = false;
      this.onchange = () => {};
    }
    set(state) {
      if (!STATES.includes(state)) return false;
      this.idle = state === "quiet" ? this.quietAfter : 0;
      if (state !== this.state) { this.state = state; this.onchange(state); }
      return true;
    }
    interact(touch = false) {
      this.idle = 0;
      if (this.state === "sleep" || this.state === "quiet") return this.set("idle");
      if (touch && !this.busy && this.state !== "touch") this.set("touch");
      return true;
    }
    tick(dt) {
      if (!this.active || this.paused || this.hidden || this.busy || !Number.isFinite(dt) || dt <= 0) return;
      this.idle += dt;
      if (this.idle >= this.sleepAfter && this.state !== "sleep") this.set("sleep");
      else if (this.idle >= this.quietAfter && this.state === "idle") this.set("quiet");
    }
    finishTouch() { if (this.state === "touch") this.set("idle"); }
  }
  // A new frame must be decoded before the old clip disappears. Tokens cancel
  // late loads; the touch clip waits for the short idle loop's boundary.
  class Player {
    constructor(container, config, callbacks = {}) {
      this.container = container; this.config = config; this.callbacks = callbacks;
      this.sceneId = config.defaultScene || "day";
      this.machine = new Lifecycle(config); this.machine.onchange = state => this.prepare(state);
      this.slots = [...container.querySelectorAll("video")];
      this.anchor = container.querySelector ? container.querySelector("#world-anchor") : null;
      this.fading = false;
      this.current = null; this.pending = null; this.generation = 0; this.error = null;
      this.cueReturn = null;
      this.machine.active = false;
      this.applyScene();
      for (const video of this.slots) {
        video.addEventListener("timeupdate", () => this.boundary(video));
        video.addEventListener("ended", () => {
          if (video !== this.current) return;
          if (video.dataset.after) { const after = video.dataset.after; delete video.dataset.after; this.prepare(after); return; }
          if (video.dataset.cue) {
            this.cueReturn = null;
            if (this.sceneId === video.dataset.cueScene) this.prepare(video.dataset.cueReturn || "idle");
            return;
          }
          if (video.dataset.state === "touch") this.machine.finishTouch();
        });
      }
    }
    get running() { const m = this.machine; return m.active && !m.paused && !m.hidden; }
    get snapshot() { return { state: this.machine.state, scene: this.sceneId, playing: this.current?.dataset.state || null,
      paused: this.machine.paused, hidden: this.machine.hidden, active: this.machine.active,
      idleSeconds: this.machine.idle, loading: !!this.pending, error: this.error }; }
    sync() {
      this.container.hidden = !this.machine.active;
      for (const v of this.slots) {
        if (v === this.current && this.running) v.play().catch(() => this.fail("播放被系统暂停，请点继续"));
        else v.pause();
      }
      this.callbacks.change?.(this.snapshot);
    }
    activate(active) {
      this.machine.active = !!active;
      if (active && !this.current && !this.pending) this.prepare(this.machine.state);
      this.sync();
    }
    pause(value) { this.machine.paused = !!value; this.sync(); }
    hide(value) { this.machine.hidden = !!value; this.sync(); }
    busy(value) { this.machine.busy = !!value; if (value) this.machine.interact(); }
    scene() { return this.config.scenes?.[this.sceneId] || null; }
    resolveClip(state) {
      const scene = this.scene();
      const clip = scene ? scene.clips?.[state] : this.config.clips?.[state];
      if (!clip && scene?.inheritBase && this.config.clips?.[state]) return this.config.clips[state];
      return clip || null;
    }
    applyScene() {
      const scene = this.scene();
      if (!scene) return false;
      this.container.dataset.scene = this.sceneId;
      const bg = this.container.querySelector?.("#world-background");
      if (bg && scene.background) bg.src = "./world-media/" + scene.background;
      if (this.anchor && scene.anchor) this.anchor.src = "./world-media/" + scene.anchor;
      return true;
    }
    setScene(id) {
      if (!this.config.scenes?.[id] || id === this.sceneId) return false;
      this.generation++;
      this.pending?.cancel?.(); this.pending = null; this.cueReturn = null;
      this.sceneId = id; this.error = null; this.machine.idle = 0;
      this.applyScene(); this.setAnchor(true);
      if (this.machine.active || this.current) void this.prepare("idle");
      this.callbacks.change?.(this.snapshot);
      return true;
    }
    interact(touch = false) {
      if (touch && !this.resolveClip("touch")) { this.machine.idle = 0; return false; }
      return this.machine.interact(touch);
    }
    set(state) { if (!this.resolveClip(state)) return false; return this.machine.set(state); }
    tick(dt) { if (this.scene()?.automaticIdle !== false) this.machine.tick(dt); }
    playCue(name) {
      const cue = this.config.cues?.[name];
      if (!cue || cue.scene && cue.scene !== this.sceneId || this.cueReturn) return false;
      this.cueReturn = { scene: this.sceneId, state: cue.returnState || this.machine.state };
      void this.prepareCue(name, cue);
      return true;
    }
    async prepareCue(name, cue) {
      const token = ++this.generation;
      this.pending?.cancel?.();
      const candidate = this.slots.find(v => v !== this.current);
      const pending = { token, candidate, state: "cue:" + name, ready: false, cancel: null };
      this.pending = pending;
      candidate.style.opacity = "0"; candidate.pause(); this.setAnchor(true);
      candidate.dataset.state = "cue"; candidate.dataset.layout = cue.layout || "figure";
      candidate.dataset.cue = name; candidate.dataset.cueScene = this.sceneId;
      candidate.dataset.cueReturn = this.cueReturn.state; candidate.dataset.loop = "false";
      candidate.removeAttribute("loop"); candidate.src = "./world-media/" + cue.file;
      try {
        await this.loadCandidate(candidate, pending);
        if (token !== this.generation) return;
        pending.ready = true; this.error = null; this.commit(pending);
      } catch (error) {
        if (token !== this.generation) return;
        this.pending = null; this.cueReturn = null; this.fail(error.message);
      }
    }
    async loadCandidate(candidate, pending) {
      await new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => { clearTimeout(timer); candidate.removeEventListener("loadeddata", loaded); candidate.removeEventListener("error", failed); };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("视频无法解码：" + pending.state)); };
        pending.cancel = () => { cleanup(); reject(new Error("cancelled")); };
        candidate.addEventListener("loadeddata", loaded, { once: true });
        candidate.addEventListener("error", failed, { once: true });
        timer = setTimeout(() => { cleanup(); reject(new Error("视频加载超时：" + pending.state)); }, 10000);
        candidate.load();
      });
    }
    fail(message) { this.error = message; this.setAnchor(true); this.callbacks.change?.(this.snapshot); }
    /** 锚点静帧只在加载/淡出/失败时露出；正常播放时藏起来，避免和视频重影。 */
    setAnchor(on) { if (this.anchor) this.anchor.style.opacity = on ? "1" : "0"; }
    async prepare(state, options = {}) {
      const clip = this.resolveClip(state);
      if (!clip) return this.fail("缺少视频素材：" + state);
      const token = ++this.generation;
      if (this.pending?.cancel) this.pending.cancel();
      const candidate = this.slots.find(v => v !== this.current);
      const pending = { token, candidate, state, clip, ready: false, cancel: null };
      this.pending = pending;
      candidate.style.opacity = "0"; candidate.pause();
      this.setAnchor(true);
      candidate.dataset.state = state; candidate.dataset.layout = clip.layout || (state === "quiet" || state === "sleep" || state === "quietHold" ? "full" : "figure");
      delete candidate.dataset.cue; delete candidate.dataset.after; delete candidate.dataset.cueScene; delete candidate.dataset.cueReturn;
      if (clip.after) candidate.dataset.after = clip.after;
      candidate.loop = clip.loop ?? (state !== "touch");
      if (candidate.loop) candidate.setAttribute("loop", ""); else candidate.removeAttribute("loop");
      candidate.src = "./world-media/" + clip.file;
      try {
        await this.loadCandidate(candidate, pending);
        if (token !== this.generation) return;
        pending.ready = true; this.error = null;
        // Only idle -> touch needs matching cuts. Sleep/wake and manual modes
        // have no filmed transition, so use a short dissolve after decoding.
        if (options.waitBoundary) pending.waitBoundary = true;
        else if (!(state === "touch" && this.current?.dataset.state === "idle" && this.running)) this.commit(pending);
      } catch (error) {
        if (token !== this.generation) return;
        this.pending = null; this.fail(error.message);
        if (this.current) this.machine.state = this.current.dataset.state;
        this.machine.idle = 0;
      }
    }
    boundary(video) {
      if (video !== this.current) return;
      const remaining = video.duration - video.currentTime;
      const playingClip = this.current?._whaleClip;
      if (!this.pending && playingClip?.crossfadeLoop && Number.isFinite(remaining) && remaining <= (this.scene()?.crossfadeLoopSeconds || .35)) {
        void this.prepare(video.dataset.state, { waitBoundary: true });
      }
      if (!this.fading && tailFadeActive(video.dataset.state, remaining, this.config.fadeOutSeconds || 0.4)) {
        // 动作尾部提前淡出，露出下面的锚点静帧；生成视频的最后几帧通常已经糊了。
        this.fading = true;
        video.style.transition = `opacity ${this.config.fadeOutSeconds || 0.4}s ease`;
        video.style.opacity = "0";
        this.setAnchor(true);
      }
      const p = this.pending;
      if (!p?.ready) return;
      if (p.waitBoundary ? remaining < .15 || video.currentTime < .08 : remaining < .15 || video.currentTime < .08) this.commit(p);
    }
    commit(pending) {
      if (pending.token !== this.generation || this.pending !== pending) return;
      const previous = this.current;
      this.current = pending.candidate; this.pending = null; this.fading = false;
      this.current._whaleClip = pending.clip || null;
      this.current.style.transition = "opacity .18s ease";
      this.current.style.opacity = "1"; this.current.style.zIndex = "2";
      this.setAnchor(false);
      if (previous) { previous.style.opacity = "0"; previous.style.zIndex = "1"; }
      this.container.dataset.state = pending.state;
      this.sync(); this.callbacks.ready?.(this.snapshot);
    }
    rect() { return this.current?.getBoundingClientRect() || this.container.getBoundingClientRect(); }
  }
  return { Lifecycle, Player, STATES, tailFadeActive };
});
