/* WORLD-FACE-01 · 口型与表情
 *
 * 为什么是覆盖层，不是 blend shape：
 *   角色是单一 skinned GLB（assets/lan-room/lan-v2-game.glb，info.rigVersion 15），
 *   既没有 morph target，也没有面部骨骼——`lan-model.js` 的骨骼表只有
 *   root / spine / head / skirt / 四肢。想让她「张嘴」只有两条路：改模型，或者
 *   在现有 mesh 上叠一层。改模型需要重新绑定和权重，超出「改代码」的范围；
 *   所以这里做一层**墨线覆盖**：把嘴、腮、眉画成一张 2D canvas，
 *   每帧跟着 head 骨骼的世界位置走，缩放由角色在屏幕上的高度推出来。
 *   看起来是画在她脸上的，不是贴上去的。
 *
 * 口型怎么和声音对齐（这是用户提的硬要求）：
 *   - 有真实音频时：CompanionPlayback 把语音塞进同一个 <audio>，这里把它接到
 *     AnalyserNode 上取 RMS 包络 —— 嘴型跟着真实波形走。
 *   - 没有音频时（纯文字 / 浏览器不允许 AudioContext）：用文字时间轴。
 *     中文一个字一个音节，元音决定开口度（a 最大，i/u 最小），标点算停顿。
 *   - 两者都在时取 max：包络负责「有声音」，时间轴负责「这一句还没说完」。
 *
 * 刻意不做的：不改 lan-model.js 的 pose 常数，不碰材质，不碰后期。
 * 关掉只要 `LanFace.setEnabled(false)`。
 */
(() => {
  'use strict';

  const T = window.THREE;
  const IS_CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

  /* ───────── 可调参数：屏幕投影出来的比例，按角色在画面里的高度归一 ─────────
     默认值来自 960×540、默认机位下量出来的尺寸；改这两个数就能整体放大/缩小。 */
  // 全部是「世界米」，运行时乘上每米像素数。默认值按 1.3m 高的 chibi 量的：
  // head 骨骼在颈根，嘴在它上方 6cm，眼在 20cm，眉在 25cm。
  // 动画里的嘴本来就要夸张：按真人比例画在 chibi 脸上小到看不见。
  // 实测（900×560、cam 0.55,0.95,0.35 / 目标 0.05,0.62,-0.5，376 px/m）：
  // lan-head 骨骼落在她眼睛高度，不是在颈根；所以嘴在骨骼**下方** 1.2cm，
  // 眼线只比骨骼高 11cm。fx 用 ?face=1 的标尺对过真脸，改这里请重新对一次。
  const TUNE = {
    mouthW: 0.074,  // 嘴宽 ≈ 脸宽的 0.33
    mouthUp: -0.008, // 负号：嘴在骨骼下方
    eyeUp: 0.092,
    browUp: 0.150,
    cheekUp: 0.022,
    cheekDx: 0.055, // 腮红横向偏移（单侧）
  };

  /* ───────── 时间轴：文字 → 音节 → 开口度 ───────── */
  const VOWEL_OPEN = {
    'a': 1.00, 'o': 0.92, 'e': 0.76, 'i': 0.44, 'u': 0.50, 'v': 0.44, 'y': 0.46,
    'n': 0.30, 'm': 0.24, 'r': 0.34,
  };
  const CJK_VOWEL = [
    ['a', 'aāáǎà'], ['o', 'oōóǒò'], ['e', 'eēéěè'], ['i', 'iīíǐì'],
    ['u', 'uūúǔù'], ['v', 'üǖǘǚǜ'], ['e', 'ea'],
  ];

  /* 中日韩字符没法在纯前端拿到拼音，用「字符码位取模」做一张稳定的表：
     同一个字永远是同一个口型，读起来不会乱跳，也足够像说话。 */
  function cjkOpen(ch) {
    const code = ch.codePointAt(0);
    const vowels = 'aoeiuv';
    return VOWEL_OPEN[vowels[code % 6]] * (0.86 + ((code >> 3) % 5) * 0.035);
  }

  const PAUSE = { '，': 1.6, ',': 1.4, '、': 1.2, '。': 2.6, '.': 2.4, '！': 2.4, '!': 2.2,
    '？': 2.4, '?': 2.2, '；': 1.6, ';': 1.4, '：': 1.4, ':': 1.2, '…': 2.4, '~': 1.0, '—': 1.8 };

  function buildTimeline(text) {
    const t0 = String(text || '').replace(/\s+/g, ' ').trim();
    const segs = [];
    let t = 0;
    const SYL = 0.185;               // 单音节时长（秒），接近中文语音的自然速度
    for (let i = 0; i < t0.length; i++) {
      const ch = t0[i];
      if (PAUSE[ch] !== undefined) {
        const d = SYL * PAUSE[ch];
        segs.push({ t, d, open: 0, wide: 0 });
        t += d;
        continue;
      }
      if (IS_CJK.test(ch)) {
        const d = SYL * (0.94 + ((ch.codePointAt(0) >> 5) % 4) * 0.05);
        segs.push({ t, d, open: cjkOpen(ch), wide: 0.15 });
        t += d;
        continue;
      }
      if (/[a-zA-Z]/.test(ch)) {
        // 连续的拉丁字母当成一个词，元音决定开口
        let word = ch;
        while (i + 1 < t0.length && /[a-zA-Z']/.test(t0[i + 1])) word += t0[++i];
        const vowels = word.toLowerCase().replace(/[^aeiouy]/g, '');
        const open = vowels ? Math.max(...[...vowels].map((v) => VOWEL_OPEN[v] || 0.5)) : 0.32;
        const d = SYL * (0.7 + word.length * 0.26);
        segs.push({ t, d, open, wide: 0.45 });
        t += d;
        continue;
      }
      if (ch === ' ') t += SYL * 0.35;
    }
    return { segs, total: t };
  }

  const EMOTION = {
    neutral: { curve: 0.12, brow: 0, blush: 0.06, eyeSmile: 0.05, open: 0 },
    happy: { curve: 0.85, brow: -0.25, blush: 0.30, eyeSmile: 0.75, open: 0.04 },
    shy: { curve: 0.45, brow: 0.35, blush: 0.72, eyeSmile: 0.30, open: 0.02 },
    sad: { curve: -0.62, brow: 0.55, blush: 0.10, eyeSmile: -0.25, open: 0.03 },
    surprise: { curve: -0.10, brow: -0.75, blush: 0.16, eyeSmile: 0.10, open: 0.34 },
    think: { curve: 0.05, brow: 0.28, blush: 0.08, eyeSmile: 0.02, open: 0.05 },
    sleepy: { curve: 0.18, brow: 0.20, blush: 0.14, eyeSmile: -0.45, open: 0.02 },
    excited: { curve: 0.95, brow: -0.45, blush: 0.42, eyeSmile: 0.85, open: 0.08 },
  };

  function emotionOf(text) {
    const s = String(text || '');
    if (/[！!]{1,}|好耶|太好了|开心|喜欢|嘿嘿|嘻|棒/.test(s)) return 'happy';
    if (/害羞|脸红|不要啦|唔|那个…|哎呀/.test(s)) return 'shy';
    if (/对不起|抱歉|难过|呜|唉|想你|孤单/.test(s)) return 'sad';
    if (/诶|欸|真的吗|竟然|居然|！？|什么/.test(s)) return 'surprise';
    if (/[？?]/.test(s)) return 'think';
    return 'neutral';
  }

  /* ───────── 主体 ───────── */
  function create() {
    const canvas = document.createElement('canvas');
    canvas.id = 'lanFace';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');

    let dpr = 1, W = 0, H = 0;
    let enabled = true;
    let anchor = null;          // {x, y, h} 屏幕坐标 + 角色屏幕高度
    let faceSign = 0;           // head 骨骼朝相机的那根轴（±1），启动时自己认
    let headBone = null, charRoot = null, probeAt = 0;
    const CALIB = new URLSearchParams(location.search).get('face') === '1';
    let forceOpen = -1;          // >=0 时口型固定成这个值（标定用）
    let why = 'init';            // 上一次量锚点的结果，给 ?face=1 和工装看
    const diag = { ticks: 0, noTarget: 0, resolved: 0, pass: 0, resolve: null };

    const state = {
      emotion: 'neutral', emoSince: 0, emoTarget: EMOTION.neutral,
      frame: { ...EMOTION.neutral },
      speaking: false, segs: [], total: 0, startedAt: 0, audioDur: 0,
      mouth: 0, mouthRaw: 0, energy: 0, lastSay: '',
      visible: false, blink: 0, blinkAt: 0, sparkleAt: 0,
    };

    /* 音频包络：有真声音就以它为准 */
    const audioCtx = { ctx: null, analyser: null, data: null, src: null, ok: false };
    function attachAudio(el, opts) {
      if (!el || audioCtx.src || !enabled) return;
      const resume = !!(opts && opts.resume);
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        audioCtx.ctx = new AC();
        audioCtx.src = audioCtx.ctx.createMediaElementSource(el);
        audioCtx.analyser = audioCtx.ctx.createAnalyser();
        audioCtx.analyser.fftSize = 512;
        audioCtx.analyser.smoothingTimeConstant = 0.55;
        audioCtx.src.connect(audioCtx.analyser);
        audioCtx.analyser.connect(audioCtx.ctx.destination);
        audioCtx.data = new Uint8Array(audioCtx.analyser.fftSize);
        audioCtx.el = el;
        audioCtx.ok = true;
        // 一定要确认上下文真的跑起来了：suspended 状态下元素接进来是没有声音的，
        // 那样「加了口型」的代价是「她不再说话」。所以跑不起来就退回直连。
        if (resume && audioCtx.ctx.state !== 'running') {
          audioCtx.ctx.resume().then(() => {
            if (audioCtx.ctx.state !== 'running') unroute();
          }).catch(unroute);
        }
      } catch (_) { audioCtx.ok = false; }
    }

    function unroute() {
      try { audioCtx.src.disconnect(); } catch (_) {}
      try { audioCtx.analyser.disconnect(); audioCtx.src.connect(audioCtx.ctx.destination); } catch (_) {}
      audioCtx.ok = false;
    }
    function energy() {
      if (!audioCtx.ok || audioCtx.ctx.state !== 'running') return 0;
      try {
        audioCtx.analyser.getByteTimeDomainData(audioCtx.data);
        let sum = 0;
        for (let i = 0; i < audioCtx.data.length; i++) { const v = (audioCtx.data[i] - 128) / 128; sum += v * v; }
        return Math.min(1, Math.sqrt(sum / audioCtx.data.length) * 6.5);
      } catch (_) { return 0; }
    }

    /* ───────── 找锚点 ─────────
       两条线索都试：MOLI_DEBUG.lanModel.root（GLB）和 MOLI_DEBUG.moli（程序化角色）。
       谁能遍历出 head 骨骼就用谁——不依赖某个字段叫 root，也不依赖层级深度。 */
    function findHead(root) {
      if (!root || !root.traverse) return null;
      let head = null, best = 1e9;
      root.traverse((o) => {
        if (!o.name || !/head|face|skull/i.test(o.name)) return;
        let d = 0, p = o;
        while ((p = p.parent)) d++;
        if (d < best) { best = d; head = o; }
      });
      return head;
    }

    function resolveTarget() {
      const dbg = window.MOLI_DEBUG || {};
      const cands = [];
      const push = (o) => { if (o && o.isObject3D && cands.indexOf(o) < 0) cands.push(o); };
      try { push(dbg.lanModel && dbg.lanModel.root); } catch (_) {}
      try { push(dbg.moli && dbg.moli.root); } catch (_) {}
      try { push(dbg.moli); } catch (_) {}
      try { push(dbg.moli && dbg.moli.head); } catch (_) {}
      for (const c of cands) {
        const h = findHead(c);
        if (!h) continue;
        headBone = h;
        // 量身高要整只角色：从骨骼一路往上，直到父级是 Scene 为止
        let top = h;
        while (top.parent && top.parent.type !== 'Scene') top = top.parent;
        charRoot = top;
        return true;
      }
      return false;
    }

    const v3 = () => new T.Vector3();
    const camPos = v3(), headPos = v3(), fwd = v3(), toCam = v3(), right = v3(), edge = v3();
    let ppm = 0;          // 每米多少像素（跟着机位和窗口自己变）
    let charScale = 1;    // 角色整体缩放

    function project(p) {
      const cam = window.MOLI_DEBUG && window.MOLI_DEBUG.camera;
      if (!cam) return null;
      const v = p.clone().project(cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, z: v.z };
    }

    function measure(now) {
      diag.ticks++;
      if (!headBone || !headBone.parent) {
        diag.noTarget++;
        const ok = resolveTarget();
        diag.resolve = ok;
        if (!ok) { why = 'no-target'; anchor = null; state.visible = false; return; }
        diag.resolved++;
        return;
      }
      diag.pass++;
      if (now - probeAt < 0.08) return;   // 秒，不是毫秒：12 帧/秒足够跟住脑袋
      probeAt = now;

      const cam = window.MOLI_DEBUG && window.MOLI_DEBUG.camera;
      if (!cam) { why = 'no-camera'; anchor = null; state.visible = false; return; }

      headBone.getWorldPosition(headPos);
      const hp = project(headPos);
      if (!hp) { why = 'no-camera'; anchor = null; state.visible = false; return; }

      // 比例尺：从锚点沿镜头右向量走一米，投影差就是每米像素数。
      // 不依赖包围盒（蒙皮网格的 box 在 r128 里是静止姿势的，不可靠）。
      cam.matrixWorld.extractBasis(right, v3(), v3());
      edge.copy(headPos).addScaledVector(right.normalize(), 1);
      const ep = project(edge);
      if (!ep) { why = 'no-scale'; anchor = null; state.visible = false; return; }
      ppm = Math.hypot(ep.x - hp.x, ep.y - hp.y);
      if (!(ppm > 4)) { why = 'ppm=' + Math.round(ppm); anchor = null; state.visible = false; return; }
      charScale = headBone.matrixWorld.getMaxScaleOnAxis() || 1;

      // 背对镜头就别画了：认一次「哪根轴是脸」，之后每帧比一下
      cam.getWorldPosition(camPos);
      toCam.copy(camPos).sub(headPos).normalize();
      const hq = headBone.getWorldQuaternion(new T.Quaternion());
      fwd.set(0, 0, 1).applyQuaternion(hq).normalize();
      const along = fwd.dot(toCam);
      if (faceSign === 0) faceSign = along >= 0 ? 1 : -1;
      const facing = along * faceSign;
      const fade = Math.max(0, Math.min(1, (facing + 0.15) / 0.55));

      why = 'ok:' + Math.round(ppm);
      anchor = { x: hp.x, y: hp.y, hpx: ppm * charScale, fade };
      state.visible = fade > 0.02;
    }

    /* ───────── 说话 ───────── */
    function say(text, opts) {
      if (!enabled) return null;
      const o = opts || {};
      const { segs, total } = buildTimeline(text);
      state.segs = segs;
      state.total = total;
      state.startedAt = performance.now() / 1000;
      state.speaking = segs.length > 0;
      state.lastSay = String(text || '');
      state.durOverride = o.durationMs ? o.durationMs / 1000 : 0;
      emote(o.emotion || emotionOf(text), o.emotionMs || Math.max(1800, total * 1000 + 1400));
      if (!resolveTarget()) resolveTarget();
      return { syllables: segs.length, seconds: +total.toFixed(2) };
    }

    function stop() {
      state.speaking = false;
      state.segs = [];
      state.total = 0;
    }

    function emote(name, ms) {
      const target = EMOTION[name] || EMOTION.neutral;
      state.emotion = EMOTION[name] ? name : 'neutral';
      state.emoStart = performance.now();
      state.emoMs = ms || 2000;
      state.emoFrom = { ...state.frame };
      state.emoTo = target;
    }

    /* 当前音节的目标开口度 */
    function realDuration() {
      const el = audioCtx.el;
      const d = el && Number.isFinite(el.duration) ? el.duration : 0;
      return d > 0.2 ? d : 0;
    }

    function timelineOpen(nowSec) {
      if (!state.speaking) return 0;
      const dur = state.durOverride || realDuration();
      const scale = dur ? dur / state.total : 1;
      const t = (nowSec - state.startedAt) / (scale || 1);
      if (t >= state.total) { stop(); return 0; }
      let seg = null;
      for (const s of state.segs) { if (t >= s.t && t < s.t + s.d) { seg = s; break; } }
      if (!seg || seg.open <= 0) return 0;
      const local = (t - seg.t) / seg.d;
      // 起音快、落音慢，像真的在收口型
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, local)), 0.55);
      return seg.open * env;
    }

    /* ───────── 画 ───────── */
    function drawFace(now, dt) {
      const f = state.frame;
      if (!anchor || anchor.fade <= 0.02) { ctx.clearRect(0, 0, W, H); return; }
      const ppmS = anchor.hpx;                 // 像素 / 米
      const px = (m) => m * ppmS;
      const cx = anchor.x;
      const mouthY = anchor.y - px(TUNE.mouthUp);
      const mw = px(TUNE.mouthW);
      const open = forceOpen >= 0 ? forceOpen : Math.max(0, Math.min(1, state.mouth));
      const curve = f.curve;

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = anchor.fade;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      /* 腮红：两团柔光，害羞/开心时浓 */
      if (f.blush > 0.02) {
        const r = mw * 0.42;
        for (const s of [-1, 1]) {
          const g = ctx.createRadialGradient(
            cx + s * px(TUNE.cheekDx), anchor.y - px(TUNE.cheekUp), 0,
            cx + s * px(TUNE.cheekDx), anchor.y - px(TUNE.cheekUp), r);
          g.addColorStop(0, `rgba(240, 138, 148, ${0.34 * f.blush})`);
          g.addColorStop(0.55, `rgba(238, 130, 145, ${0.18 * f.blush})`);
          g.addColorStop(1, 'rgba(238, 130, 145, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(cx + s * px(TUNE.cheekDx), anchor.y - px(TUNE.cheekUp), r, r * 0.72, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      /* 眉：一根短弧，靠倾角表达情绪 */
      if (Math.abs(f.brow) > 0.06) {
        ctx.strokeStyle = `rgba(78, 62, 84, ${0.30 * Math.min(1, Math.abs(f.brow) + 0.35)})`;
        ctx.lineWidth = Math.max(1, mw * 0.055);
        for (const s of [-1, 1]) {
          const bx = cx + s * mw * 0.40;
          const by = anchor.y - px(TUNE.browUp);
          const tilt = f.brow * px(0.014) * s;
          ctx.beginPath();
          ctx.moveTo(bx - mw * 0.17, by + tilt);
          ctx.quadraticCurveTo(bx, by - px(0.012), bx + mw * 0.17, by - tilt);
          ctx.stroke();
        }
      }

      /* 嘴：闭口时是一条线，开口时是带舌/阴影的椭圆。multiply 让它像墨渗进皮肤 */
      ctx.globalCompositeOperation = 'multiply';
      const wOpen = 0.62 + 0.38 * (1 - open);          // 张嘴时嘴变窄
      const halfW = mw * 0.5 * wOpen;
      const halfH = Math.max(mw * 0.06, mw * 0.42 * open);
      const ink = `rgba(96, 60, 74, ${0.42 + 0.30 * open})`;

      if (open < 0.06) {
        // 闭口线：curve>0 收成微笑，<0 撇下来
        const w = halfW * 0.66;
        ctx.strokeStyle = `rgba(112, 70, 84, ${0.30 + 0.20 * Math.abs(curve)})`;
        ctx.lineWidth = Math.max(1, mw * 0.05);
        ctx.beginPath();
        ctx.moveTo(cx - w, mouthY);
        ctx.quadraticCurveTo(cx, mouthY + curve * mw * 0.34, cx + w, mouthY);
        ctx.stroke();
      } else {
        const hh = halfH * (0.55 + 0.45 * Math.max(0, curve + 0.4));
        // 口腔
        const g = ctx.createLinearGradient(cx, mouthY - hh, cx, mouthY + hh);
        g.addColorStop(0, 'rgba(104, 62, 78, .78)');
        g.addColorStop(0.55, 'rgba(126, 68, 82, .70)');
        g.addColorStop(1, 'rgba(168, 96, 104, .52)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + hh * 0.10, halfW, hh, 0, 0, Math.PI * 2);
        ctx.fill();
        // 上唇投影
        ctx.fillStyle = 'rgba(74, 44, 58, .30)';
        ctx.beginPath();
        ctx.ellipse(cx, mouthY - hh * 0.42, halfW * 0.92, hh * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        // 舌
        if (open > 0.4) {
          ctx.fillStyle = `rgba(206, 132, 138, ${0.34 * open})`;
          ctx.beginPath();
          ctx.ellipse(cx, mouthY + hh * 0.52, halfW * 0.62, hh * 0.34, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // 轮廓
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, mw * 0.04);
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + hh * 0.10, halfW, hh, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';

      /* 笑眼：只在 eyeSmile 明显时出现，很淡，避免和她自己的眼睛打架 */
      if (Math.abs(f.eyeSmile) > 0.15) {
        const up = f.eyeSmile > 0;
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = `rgba(90, 66, 92, ${0.20 * Math.min(1, Math.abs(f.eyeSmile))})`;
        ctx.lineWidth = Math.max(1, mw * 0.05);
        for (const s of [-1, 1]) {
          const ex = cx + s * mw * 0.46, ey = anchor.y - px(TUNE.eyeUp) + (up ? mw * 0.08 : 0);
          ctx.beginPath();
          ctx.moveTo(ex - mw * 0.16, ey + (up ? mw * 0.06 : 0));
          ctx.quadraticCurveTo(ex, ey - (up ? mw * 0.10 : -mw * 0.10), ex + mw * 0.16, ey + (up ? mw * 0.06 : 0));
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      /* 标定层：只有 ?face=1 才画。对着真脸看这几条线落在哪儿，再改 TUNE。 */
      if (CALIB) {
        ctx.restore(); ctx.save();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,190,255,.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 40, anchor.y); ctx.lineTo(cx + 40, anchor.y);
        ctx.moveTo(cx, anchor.y - 40); ctx.lineTo(cx, anchor.y + 12);
        ctx.stroke();
        const lines = [
          ['mouth', anchor.y - px(TUNE.mouthUp), '#ff2d55'],
          ['eye', anchor.y - px(TUNE.eyeUp), '#00c853'],
          ['brow', anchor.y - px(TUNE.browUp), '#2962ff'],
          ['cheek', anchor.y - px(TUNE.cheekUp), '#ff9100'],
        ];
        ctx.font = '11px monospace';
        for (const [label, y, col] of lines) {
          ctx.strokeStyle = col; ctx.beginPath();
          ctx.moveTo(cx - 70, y); ctx.lineTo(cx + 70, y); ctx.stroke();
          ctx.fillStyle = col; ctx.fillText(label + ' ' + Math.round(y), cx + 74, y + 4);
        }
        // 0.05m 的刻度尺，横向
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        for (let i = 0; i <= 4; i++) {
          const x = cx - px(0.1) + px(0.05) * i;
          ctx.beginPath(); ctx.moveTo(x, anchor.y + 16); ctx.lineTo(x, anchor.y + 26); ctx.stroke();
        }
      }
      ctx.restore();
    }

    /* ───────── 主循环 ───────── */
    let last = 0, acc = 0;
    function tick(ts) {
      state.frames = (state.frames || 0) + 1;
      // dt 给动画用（限幅，防止切标签页回来炸掉）；dtReal 给口型收放用。
      // 软件渲染的机器上一帧可能 700ms，用限幅值会让嘴黏住不动。
      const dtReal = Math.min(0.5, last ? (ts - last) / 1000 : 0.016);
      const dt = Math.min(0.05, dtReal);
      last = ts;
      if (!enabled) { if (W) { ctx.clearRect(0, 0, W, H); } requestAnimationFrame(tick); return; }

      // 尺寸跟着窗口和 dpr 走
      const wantDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (W !== window.innerWidth || H !== window.innerHeight || dpr !== wantDpr) {
        dpr = wantDpr; W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const now = ts / 1000;
      measure(now);

      const env = energy();
      state.energy = env;
      const tOpen = timelineOpen(now);
      state.tOpen = tOpen; state.lastNow = now;
      // 包络和时间轴取大：有声音时嘴跟着波形，没声音时跟着字
      const raw = Math.max(tOpen * 0.92, env);
      // 20ms 上升 / 90ms 回落：嘴型不能黏在上一帧
      const k = raw > state.mouthRaw ? 1 - Math.pow(0.001, dtReal / 0.02) : 1 - Math.pow(0.001, dtReal / 0.09);
      state.mouthRaw += (raw - state.mouthRaw) * k;
      state.mouth = state.mouthRaw;

      // 情绪在做插值，讲话时也保持
      const since = performance.now() - (state.emoStart || 0);
      const k2 = Math.min(1, since / 420);

      const target = state.emoTo || EMOTION.neutral;
      const from = state.emoFrom || state.frame;
      for (const key of ['curve', 'brow', 'blush', 'eyeSmile', 'open']) {
        state.frame[key] = (from[key] ?? 0) + ((target[key] ?? 0) - (from[key] ?? 0)) * (k2 * k2 * (3 - 2 * k2));
      }
      // 说话时嘴角有微动，静止时几乎不动
      const breath = Math.sin(now * 1.15) * 0.012 + (state.mouth > 0.1 ? Math.sin(now * 6.7) * 0.03 : 0);
      state.frame.curve += breath;

      try { drawFace(now, dt); } catch (e) { state.err = String(e && e.message || e); }
      acc += dt;
      requestAnimationFrame(tick);
    }

    resolveTarget();
    requestAnimationFrame(tick);

    return {
      say, stop, emote, attachAudio,
      setForceOpen(v) { forceOpen = typeof v === 'number' ? v : -1; return forceOpen; },
      get energy() { return state.energy; },
      get mouth() { return state.mouth; },
      get speaking() { return state.speaking; },
      get emotion() { return state.emotion; },
      get frame() { return { ...state.frame }; },
      get anchor() { return anchor ? { ...anchor } : null; },
      get debug() {
        return {
          visible: state.visible, mouth: +state.mouth.toFixed(3), energy: +state.energy.toFixed(3),
          emotion: state.emotion, speaking: state.speaking,
          anchor: anchor ? { x: Math.round(anchor.x), y: Math.round(anchor.y), ppm: Math.round(anchor.hpx), fade: +anchor.fade.toFixed(2) } : null,
          why, frames: state.frames || 0, err: state.err || null, diag: { ...diag },
          tOpen: +(state.tOpen || 0).toFixed(3), now: +(state.lastNow || 0).toFixed(2),
          started: +(state.startedAt || 0).toFixed(2), total: +(state.total || 0).toFixed(2),
          segs: state.segs.length,
          head: headBone ? String(headBone.name || headBone.type) : null,
          root: charRoot ? String(charRoot.name || charRoot.type) : null,
          setEnabled,
        };
      },
      setEnabled(on) {
        enabled = !!on;
        canvas.style.display = enabled ? '' : 'none';
        if (!enabled) ctx.clearRect(0, 0, W, H);
      },
      get enabled() { return enabled; },
      TUNE, measure: () => { probeAt = 0; measure(performance.now() / 1000); },
    };
  }

  function setEnabled(on) {
    const api = window.LanFace;
    if (api && api.setEnabled) api.setEnabled(on);
  }

  window.LanFace = create();
  window.__lanFace = window.LanFace;
  window.LanFace.setEnabled = setEnabled;
  window.LanFace.TUNE = window.LanFace.TUNE;
})();
