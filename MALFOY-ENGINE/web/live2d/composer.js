"use strict";
(() => {
  const host = window.malfoyHost;
  const $ = id => document.getElementById(id);

  // 麦克风错误 → 人话。这些码来自 voice-capture.js 的 classifyMicError。
  const MIC_ERRORS = {
    denied: "麦克风没开权限。系统设置 → 隐私与安全性 → 麦克风，把深蓝勾上。",
    "no-device": "没找到麦克风。",
    busy: "麦克风被别的程序占着，关掉那边再试。",
    unsupported: "这个环境拿不到麦克风，先打字吧。",
    unknown: "麦克风打不开。",
  };

  // 一次问答里最多续听几段。给 2 是折中：真的在长句里停顿的人能接上，
  // 又不会因为一个被误判的结尾让她一直等在那儿。
  const MAX_CONTINUE = 2;
  // 停播有 90ms 淡出，开麦前要等这段尾巴过去，否则录进去的是她自己的尾音。
  // 有 AEC 就不必等 —— 每轮省 110ms，是实打实的首音提前。
  const SETTLE_WITH_AEC = 40;
  const SETTLE_NO_AEC = 150;

  // ── 唤醒与连续对话 ────────────────────────────────────────────────
  //
  // 用户要的不是「点一下说一句」，是「喊一声就能聊」。所以采集从「按钮触发的
  // 一次录音」变成「常驻的一个循环」，分两个状态：
  //   standby —— 一直听着，但只在听到名字时才动（其余声音一律丢弃）
  //   active  —— 已经叫起来了，之后每说一句就答一句，不用再喊名字
  //
  // 待机时每个语音段都要跑一次本地转写（约 0.9s）。这是唤醒方案的固定成本，
  // 但转写在本机、不进模型，所以除了电以外没有别的代价。
  const WAKE = {
    enabled: true,
    words: ["小艾同学", "深蓝", "小艾"],
    // 对话态她在等多久。原来写 45 秒，理由是「说完一句想一下」也别断。
    // 真机上这个数是反的：用户一转身跟别人说话，她照样接；而且**每接一句就把
    // 计时重置**，于是她能一路接下去、永远不回待机 —— 用户的原话是「她会插话」。
    // 8 秒只够「她答完你紧接一句」，超了就当她没被叫，回待机重新等名字。
    // 这条比 45 秒更符合「叫名字才算在跟她说话」这个产品语义。
    activeIdleMs: 8000,
    // 待机时一轮最多听多久。到点就重开一轮，成本只是重建一次采集。
    standbyListenMs: 40000,
    ack: true,        // 被叫到时先应一声，不然用户不知道她听没听见
    ackText: "嗯？",
    // 待机时的端点参数要比对话态更急：喊名字是一声短促的「小艾同学」，
    // 按对话态的 450ms 尾静音 + 600ms 最短语音来判，唤醒要平白多等 0.3 秒，
    // 而喊完名字通常就是停住等你应 —— 这时候「抢跑」比「等全」更对。
    standbyEndpoint: { endSilenceMs: 320, minUtteranceMs: 420 },
  };

  let pending = false, listening = false, expanded = false;
  let capture = null;
  // 开麦前要等她淡出（最多 150ms），这段时间 capture 还是 null，
  // 连点两次会开出两路采集。用一个显式的入口锁挡住。
  let starting = false;
  // 上一轮问到的 AEC 真实状态。null = 还没问过，按「没有」保守处理。
  let aecKnown = null;

  // wakeMode: off（手动模式）| standby（待机等名字）| active（对话中）
  let wakeMode = "off";
  // 每次启停唤醒都领一个号。旧循环发现号变了就退出 ——
  // 否则点了「关掉唤醒」之后，那个还卡在 listenOne 里的旧循环会接着跑一轮。
  let wakeToken = 0;
  const matcher = (() => {
    const api = window.WakeWord;
    return api ? api.createWakeWordMatcher({ words: WAKE.words }) : null;
  })();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const Tail = () => window.UtteranceTail || { looksDangling: () => false, mergeTail: (a, b) => a + b };

  function status(text) { $("status").textContent = text; }
  function controls() {
    // 听的时候不能发文字：否则草稿和刚说的话会同时挤进一轮对话。
    $("send").disabled = pending || listening;
    // 正在听的时候麦克风必须还能点：那一下是「我不说了」。
    $("mic").disabled = pending;
    const waking = wakeMode === "standby";
    $("mic").classList.toggle("listening", listening || wakeMode === "active");
    $("mic").classList.toggle("waking", waking);
    $("orb").classList.toggle("busy", pending || listening || wakeMode === "active");
    document.body.classList.toggle("listening", listening || wakeMode !== "off");
    document.body.classList.toggle("waking", waking);
  }
  function append(role, text) {
    $("messages").querySelector(".empty")?.remove();
    const line = document.createElement("p"); line.className = "line " + role;
    line.textContent = text; $("messages").appendChild(line);
    while ($("messages").children.length > 40) $("messages").firstElementChild.remove();
    $("messages").scrollTop = $("messages").scrollHeight;
    return line;
  }
  // 流式回复先挂一个占位段落，边收边改文字；最终结果到了由 ask() 覆盖。
  function appendLive() {
    const line = append("assistant", "…");
    line.classList.add("live");
    return line;
  }
  function setMode(mode) {
    $("mode").textContent = mode === "desktop" ? "你的桌面 · 活泼音色" : "她的世界 · 清冷音色";
  }
  async function toggle(value) {
    if (!host?.composerToggle) return status("请从深蓝应用打开此对话。");
    await host.composerToggle(value);
  }

  /**
   * 开一次麦，听到一句话（或被取消/超时）就返回。
   * 只解析一次，取消后不会再回来 —— 调用方拿到结果就该接着做事。
   */
  function listenOne({ continuation = false, timeoutMs, quiet = false, endpointOptions } = {}) {
    return new Promise((resolve) => {
      let done = false;
      let cap = null;
      const settle = (value) => {
        if (done) return;
        done = true;
        if (capture === cap) capture = null;
        resolve(value || { reason: "unknown" });
      };
      const options = {
        onState(state) { listening = state !== "idle"; controls(); },
        onDiscard() {
          // 注意：discard 不等于这一轮结束 —— 采集还在继续听（用户只是咳了一声）。
          // 这里一旦 resolve，capture 就被置空，那路录音就再没人能停了。
          if (quiet) return; // 待机时听到一声咳嗽不该刷状态栏
          status(continuation ? "没接上，就按刚才那句发。" : "这句太短了，不算数 —— 接着说。");
        },
        onUtterance({ blob, mime }) { settle({ blob, mime }); },
        onError({ code }) { settle({ reason: "error", code }); },
        onEnd({ reason }) { settle({ reason }); },
      };
      // 续听不能等太久：用户其实是说完了的话，最多再等 3 秒就该放过他。
      if (continuation) options.silenceTimeoutMs = 3000;
      if (timeoutMs) options.silenceTimeoutMs = timeoutMs;
      if (endpointOptions) options.endpointOptions = endpointOptions;
      cap = window.VoiceCapture.createVoiceCapture(options);
      capture = cap;
      cap.start().then((started) => {
        if (!started || !started.ok) {
          // 授权还没回来就被取消：这不是出错，是用户改主意了，别说「麦克风打不开」。
          const why = started && started.err;
          return settle(why === "cancelled" ? { reason: "cancelled" } : { reason: "start-failed", code: why });
        }
        // 记下麦克风真实有没有回声消除：下一轮决定要不要在开麦前等她静音。
        aecKnown = (started.capabilities || {}).echoCancellation === true;
      }).catch(() => settle({ reason: "start-failed" }));
    });
  }

  async function transcribeOnce(blob, mime) {
    if (!host?.transcribe) return { ok: false, err: "请从深蓝应用打开此对话。" };
    try {
      const audio = new Uint8Array(await blob.arrayBuffer());
      const result = await host.transcribe(audio, mime);
      if (result && result.ok && result.text) return { ok: true, text: result.text };
      return { ok: false, err: (result && result.err) || "没听清，再说一次。" };
    } catch (_) {
      return { ok: false, err: "转写失败，检查语音服务还在不在。" };
    }
  }

  function reportEnd(result) {
    const { reason, code } = result;
    if (reason === "cancelled") return status("好，先不说。");
    if (reason === "silence-timeout") return status("没听到你说话。点麦克风再来一次。");
    if (reason === "max") return status("这段太长了，分开说吧。");
    if (reason === "error" || reason === "start-failed") return status(MIC_ERRORS[code] || MIC_ERRORS.unknown);
    status("这次没听到，再来一次。");
  }

  /**
   * 一直听到「一句完整的话」为止。
   *
   * 关键改动：转写回来的文本如果停在连接词/逗号上（「因为」「然后」「我想想，」），
   * 说明用户只是停了一下，还没说完 —— 那就再开一次麦接着听，把两段拼起来。
   * 判据在 lib/utterance-tail.js，纯规则、不调模型。
   * 参考项目 AIri 是让聊天模型判 complete/incomplete，但它有流式 ASR 垫着，
   * 我们整段转写 0.8s，再多一次模型往返会把人等走。
   *
   * @returns {Promise<string>} 转写文本；取消或没听清时返回空串
   */
  async function collectUtterance() {
    const first = await listenOne();
    if (!first.blob) { reportEnd(first); return ""; }

    pending = true; controls();
    status("正在转成文字…");
    const r = await transcribeOnce(first.blob, first.mime);
    pending = false; controls();
    if (!r.ok) { status(r.err); return ""; }

    let text = r.text;
    for (let round = 0; round < MAX_CONTINUE && Tail().looksDangling(text); round++) {
      status("你还没说完吧？我听着…");
      const next = await listenOne({ continuation: true });
      if (!next.blob) {
        // 主动取消 = 「我不说了」，连前半句一起作废；等不到人 = 就按前半句发。
        if (next.reason === "cancelled") { status("好，先不说。"); return ""; }
        break;
      }
      const more = await transcribeOnce(next.blob, next.mime);
      if (!more.ok || !more.text) break;
      text = Tail().mergeTail(text, more.text);
    }
    return text;
  }

  // 一条消息真正发出去。文字输入和语音转写都走这里，两边的行为才不会分叉。
  // 返回主进程那轮的 reply，调用方要拿它算「她还要说多久」（见 speechTailMs）。
  async function ask(text, options = {}) {
    if (!text || pending || listening) return null;
    if (!host?.chat) { status("请从深蓝应用打开此对话。"); return null; }
    pending = true; controls(); $("draft").value = ""; append("user", text);
    status("正在想怎么回答你…");
    // 流式：她的话会一个字一个字长出来。先挂占位行，别让窗口空着。
    let live = null;
    const stopStream = host.onChatStream?.(({ text: sofar }) => {
      if (typeof sofar !== "string") return;
      if (!live) live = appendLive();
      live.textContent = sofar;
      $("messages").scrollTop = $("messages").scrollHeight;
      if (pending) status("她正在说…");
    });
    let reply = null;
    try {
      // The stage is the only audio owner. The returned IPC result is text only
      // here, so receiving character:say cannot play the same sentence twice.
      // voice:true 让主进程在提示词里补一句「这是转写，按意思理解」——
      // 比事后再跑一次「清洗转写」的模型便宜得多。
      reply = await host.chat(text, undefined, { voice: !!options.voice });
      if (reply.superseded) {
        if (live) live.remove();
        status("这条回答已被新对话接替。");
      } else {
        const final = reply.text || "……信号断了。";
        if (live) { live.classList.remove("live"); live.textContent = final; }
        else append("assistant", final);
        $("messages").scrollTop = $("messages").scrollHeight;
        status(["none", "timeout"].includes(reply.via) ? "暂时连不上模型，稍后再试。" : reply.voicePending ? "文字已到，语音准备中…" : reply.voice || reply.chunks ? "她正在回答你。" : "已收到文字回复。");
      }
    } catch (_) {
      if (live) { live.classList.remove("live"); live.textContent = "……信号断了，稍后再试。"; }
      else append("assistant", "……信号断了，稍后再试。");
      status("连接中断；可以重新发送。");
    } finally {
      stopStream?.();
      pending = false; controls(); if (expanded) $("draft").focus();
    }
    return reply;
  }

  function stopListening() {
    capture?.cancel();
  }

  // ── 常驻唤醒 + 连续对话 ───────────────────────────────────────────
  //
  // 两个循环共用一条规矩：**只在「轮次结束」时判断要不要继续**，中途不并发开麦。
  // 同时开两路采集会让 macOS 的指示灯和端点判定都乱掉，而且录出来的是两份重叠音频。

  function setWake(state) {
    if (wakeMode === state) return;
    wakeMode = state;
    controls();
  }

  function wakeHint() {
    if (wakeMode === "active") return "我在听，直接说就好。";
    if (wakeMode === "standby") return `叫我「${WAKE.words[0]}」，我就在。`;
    return "语音已关。点麦克风重新打开。";
  }

  /**
   * 她说完之后还要多久才能重新开麦。
   *
   * 这里的估算只能靠字数：主进程把音频推给舞台之后就不再知道它播到哪了，
   * 而没有这个等待，麦克风会在她说话时录到她自己 —— 在对话态里那等于自问自答，
   * 一句「我在听」能引出十句来。宁长勿短。
   */
  function speechTailMs(text) {
    const chars = String(text || "").length;
    return Math.min(9000, chars * 210) + 1200;
  }

  /** 叫到名字时她应一声。既是回应，也是「麦克风真的听到你了」的反馈。 */
  async function ack() {
    if (!WAKE.ack) return;
    try { await host?.wakeAck?.(WAKE.ackText); } catch (_) {}
    // 这里等的是「她真的开口了」。合成两个字的固定开销约 0.9s，而麦克风在她
    // 出声期间录到的就是她自己的声音 —— 对话态里那会被当成用户的一句话。
    // 有 AEC 时回声会被消掉，只需要等她开口，不用等整句。
    await sleep(aecKnown === true ? 1000 : 1300);
  }

  /**
   * 已唤醒状态下的主循环：说一句答一句，直到用户说收尾语或者静默超时。
   * @returns {Promise<void>} 退出时 wakeMode 已经回到 standby
   */
  async function conversationLoop(token) {
    let lastAt = Date.now();
    while (wakeMode === "active" && token === wakeToken) {
      const seg = await listenOne({ timeoutMs: WAKE.activeIdleMs, quiet: true });
      if (token !== wakeToken) return;
      if (!seg || !seg.blob) {
        if (seg && (seg.reason === "error" || seg.reason === "start-failed")) {
          // 麦克风没了（被拔掉/权限被收回）就退回手动模式，别假装还在听。
          // 权限被拒的话必须把窗口弹出来 —— 否则用户喊了半天没反应，
          // 而唯一能解释原因的文案写在一个看不见的窗口里。
          if (seg.code === "denied" || seg.code === "no-device") {
            try { host?.composerToggle?.(true); } catch (_) {}
          }
          status(MIC_ERRORS[seg.code] || MIC_ERRORS.unknown);
          stopWake();
          return;
        }
        // 静默超时：这一轮听空了，按「不想说了」处理。
        if (Date.now() - lastAt >= WAKE.activeIdleMs) break;
        continue;
      }
      const r = await transcribeOnce(seg.blob, seg.mime);
      if (token !== wakeToken) return;
      if (!r.ok) continue;
      if (matcher && matcher.matchExit(r.text)) {
        status("好，我先安静。");
        break;
      }
      // 对话态里不喊名字也能说；喊了就把名字剥掉。
      const hit = matcher ? matcher.strip(r.text) : { hit: false, text: r.text };
      const text = hit.hit ? hit.text : r.text;
      if (!text) { if (hit.hit) await ack(); continue; }
      lastAt = Date.now();
      // 等多久取决于**她说多长**，不是用户问得多长。按用户那句话估，她一回长，
      // 麦克风就在她还在说话时开了 —— 录进来的全是她自己，等于自问自答。
      const reply = await ask(text, { voice: true });
      lastAt = Date.now();
      await sleep(speechTailMs(reply && reply.text));
    }
    if (token === wakeToken) {
      setWake("standby");
      status(wakeHint());
    }
  }

  /** 待机循环：一直听着，只有在听到名字时才进入对话。 */
  async function wakeLoop(token) {
    while (wakeMode === "standby" && token === wakeToken) {
      const seg = await listenOne({
        timeoutMs: WAKE.standbyListenMs, quiet: true,
        endpointOptions: WAKE.standbyEndpoint,
      });
      if (token !== wakeToken) return;
      if (!seg || !seg.blob) {
        if (seg && (seg.reason === "error" || seg.reason === "start-failed")) {
          // 权限被拒要让人看见原因，不能只是安静地不再听了。
          if (seg.code === "denied" || seg.code === "no-device") {
            try { host?.composerToggle?.(true); } catch (_) {}
          }
          status(MIC_ERRORS[seg.code] || MIC_ERRORS.unknown);
          stopWake();
          return;
        }
        // 没听到 / 太短 / 只是环境声：继续等，不刷状态栏。
        continue;
      }
      if (pending) continue;   // 手动打字提问期间不开新的一轮
      const r = await transcribeOnce(seg.blob, seg.mime);
      if (token !== wakeToken) return;
      if (!r.ok) continue;
      const hit = matcher ? matcher.strip(r.text) : { hit: false, text: "" };
      if (!hit.hit) continue;   // 不是在叫她，这句话就当没听见
      setWake("active");
      status("我在。");
      if (hit.text) {
        // 名字后面直接带了话（「小艾同学，今天吃什么」）—— 不寒暄，直接答，省 1.3 秒。
        const reply = await ask(hit.text, { voice: true });
        await sleep(speechTailMs(reply && reply.text));
      } else {
        await ack();
      }
      await conversationLoop(token);
    }
  }

  function startWake() {
    if (!matcher) return status("唤醒模块没加载。");
    if (!WAKE.enabled) return;
    if (wakeMode === "standby" || wakeMode === "active") return;
    const token = ++wakeToken;
    setWake("standby");
    status(wakeHint());
    wakeLoop(token).catch(() => stopWake());
  }

  function stopWake(silent) {
    wakeToken += 1;
    if (wakeMode !== "off") { setWake("off"); if (!silent) status(wakeHint()); }
    // 采集中就把它收掉；没有采集时 cancel 是空操作。
    try { capture?.cancel(); } catch (_) {}
  }

  /** 手动按麦克风：先停掉唤醒循环，避免两路采集抢同一个麦克风。 */
  async function startListening() {
    if (starting) return;
    if (!window.VoiceCapture) return status("语音模块没加载，先打字吧。");
    starting = true;
    // 记住进来之前唤醒是不是开着：开着的话说完一句要接着待机（用户只是想跳过叫名字），
    // 关着的话说明用户在菜单里主动关了语音 —— 不能因为说了句话就替他打开。
    const wasWaking = wakeMode !== "off";
    stopWake(true);
    // V1 用「她说话时我不采集」代替回声消除：先让她安静，再开麦。
    // 这不是打断逻辑（那要等 AEC 实测确认），只是避免录进她自己的声音。
    host?.stopVoice?.();
    await sleep(aecKnown === true ? SETTLE_WITH_AEC : SETTLE_NO_AEC);
    status("我在听，说完自动发。");
    host?.voiceActivity?.("listening");
    let text = "";
    try {
      text = await collectUtterance();
    } finally {
      starting = false;
      host?.voiceActivity?.("idle");
      listening = false; controls();
    }
    if (text) await ask(text, { voice: true });
    // 手动说完一句之后回到待机，用户不用再点一次。
    if (wasWaking) startWake();
  }

  $("open").onclick = () => toggle(true);
  $("collapse").onclick = () => toggle(false);
  $("stop-voice").onclick = () => host?.stopVoice?.();
  $("form").onsubmit = async event => {
    event.preventDefault();
    await ask($("draft").value.trim());
  };
  $("draft").onkeydown = event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("form").requestSubmit(); }
  };
  $("mic").onclick = async () => {
    // 按钮语义按状态分三档，用户不用记规则：
    //   唤醒关着  → 点一下 = 开始常驻监听（等价于「打开语音」）
    //   待机等名字 → 点一下 = 立刻说一句，不用喊名字（说完自动回到待机）
    //   正在采这一句 → 点一下 = 我不说了
    // 想彻底关掉常驻监听走菜单（麦克风常亮是隐私问题，不该藏在二连击里）。
    if (capture) return stopListening();
    if (pending) return;
    if (wakeMode === "off") {
      if (matcher) return startWake();
      return startListening();
    }
    await startListening();
  };
  window.addEventListener("keydown", event => {
    // 收窗口先放麦克风，否则她会一直听着一个已经看不见的输入框。
    // 这里只取消当前这一句，不动唤醒状态：收起对话窗之后她还在桌面上，
    // 用户随时能再喊一声 —— 那正是这个功能存在的理由。
    if (event.key === "Escape") { capture?.cancel(); toggle(false); }
  });
  host?.onComposerState?.(state => {
    expanded = !!state.expanded; document.body.classList.toggle("expanded", expanded); setMode(state.mode);
    if (expanded) { $("messages").scrollTop = $("messages").scrollHeight; $("draft").focus(); }
  });
  host?.onCharacterMode?.(state => setMode(state.mode));
  // 菜单里的总开关。关掉必须真的停采集 —— 只「不再触发」的话麦克风还在亮着，
  // 那是骗人。打开时如果窗口刚被重建，这里也是唯一的唤醒入口。
  host?.onWakeSet?.(({ enabled }) => { if (enabled) startWake(); else stopWake(); });
  host?.onComposerVoice?.(state => { if (!pending && wakeMode === "off") status(state.ready ? '她正在回答你。' : '文字已到；语音暂时不可用。'); });
  host?.onCharacterSession?.(state => {
    if (pending || $("messages").querySelector(".line")) return;
    for (const turn of state.turns || []) append(turn.role, turn.content);
    setMode(state.mode);
  });
  controls();

  // 页面一加载就进待机。用户不必先点任何按钮 —— 这正是「喊一声就能聊」的前提。
  // 主进程启动时会静默预创建这个窗口，所以监听从开机就在跑。
  // 先问一次总开关：用户在菜单里关掉唤醒之后，重新打开对话窗不该又自动开麦。
  (async () => {
    let enabled = true;
    try { const r = await host?.wakeEnabled?.(); if (r && r.enabled === false) enabled = false; } catch (_) {}
    if (enabled) startWake(); else status(wakeHint());
  })();
})();
