"use strict";
// 流式（SSE）聊天请求。
//
// 为什么不用 Node 的 fetch：主进程里所有模型请求都走 curl 子进程
// （见 main.js 的 llmOnce）——代理、超时、TLS 都是现成且验证过的行为，
// 换成 fetch 会引入一套新的证书/代理问题。流式只需要换一种读 stdout 的方式。
//
// 两个实测出来的坑（2026-10-31，本机 magpie 网关）：
//   1) 网关会先发 `: keepalive` 注释行。它不是 JSON，硬解析会抛异常中断整条流。
//   2) 部分模型（qoder/qfmodel）先吐 reasoning_content（思考过程），
//      11.5 秒后才出第一个正文 token。思考内容**绝不能**被念出来，
//      所以只认 delta.content，且首字超时按「正文」算。

const { spawn } = require("child_process");

const CODE_LINE = /^\d{3}$/;

/** 从一条 SSE data 行里取出正文增量。返回 null 表示这条不是正文。 */
function deltaOf(raw) {
  const text = String(raw || "").trim();
  if (!text || text === "[DONE]") return null;
  let json;
  try { json = JSON.parse(text); } catch (_) {
    // 半行/损坏的 JSON 不该弄死整条流，跳过这一条即可
    return null;
  }
  const choice = (json.choices && json.choices[0]) || null;
  if (!choice) return null;
  // 非流式兜底：有的网关忽略 stream:true，直接返回完整 message
  if (choice.message && typeof choice.message.content === "string") return choice.message.content;
  const delta = choice.delta || {};
  // reasoning_content 是模型的思考过程，不属于要念出来的正文
  return typeof delta.content === "string" && delta.content ? delta.content : null;
}

/**
 * 发起一次流式请求。
 * @param {object} p
 * @param {string} p.url        OpenAI 兼容端点
 * @param {string} p.key        Bearer
 * @param {string} p.body       JSON 字符串
 * @param {string} [p.proxy]
 * @param {number} [p.timeoutSec]      总时长上限
 * @param {number} [p.firstTokenMs]    首个**正文** token 的闸门；超时就掐掉，交给下一个源
 * @param {AbortSignal} [p.signal]
 * @param {(delta:string, full:string)=>void} [p.onDelta]
 * @returns {Promise<{ok:boolean,text:string,code:string,firstTokenMs:number|null,ms:number}>}
 */
function streamOnce(p) {
  return new Promise((resolve) => {
    const started = Date.now();
    if (p.signal && p.signal.aborted) {
      return resolve({ ok: false, text: "", code: "cancelled", firstTokenMs: null, ms: 0 });
    }
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(p.url);
    const args = ["-sS", "-N", "-m", String(p.timeoutSec || 30), "-w", "\n%{http_code}", p.url];
    if (isLocal) args.push("--noproxy", "*");
    else if (p.proxy) args.push("-x", p.proxy);
    args.push("-H", "Content-Type: application/json", "-H", "Authorization: Bearer " + (p.key || ""), "-d", p.body);

    let text = "";
    let code = "";
    let finished = false;
    let pending = "";       // 跨 chunk 的半行
    let sawData = false;    // 见过 SSE data 行就不要走「整体 JSON」兜底
    let rawBody = "";       // 非 SSE 兜底用
    let firstAt = null;
    let gate = null;

    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => { if (stderr.length < 4000) stderr += b.toString(); });

    function done(result) {
      if (finished) return;
      finished = true;
      if (gate) clearTimeout(gate);
      try { child.kill("SIGTERM"); } catch (_) {}
      if (p.signal) p.signal.removeEventListener("abort", onAbort);
      resolve({
        firstTokenMs: firstAt === null ? null : firstAt - started,
        ms: Date.now() - started,
        ...result,
      });
    }

    function onAbort() { done({ ok: text.trim().length > 0, text, code: "cancelled" }); }
    if (p.signal) p.signal.addEventListener("abort", onAbort, { once: true });

    if (p.firstTokenMs > 0) {
      gate = setTimeout(() => {
        // 只掐「还没出正文」的情况。已出正文就让它说完，宁可慢一点也不截断回答。
        if (firstAt === null) done({ ok: false, text, code: "first-token-timeout" });
      }, p.firstTokenMs);
    }

    function handleLine(line) {
      const s = line.replace(/\r$/, "");
      if (!s) return;
      if (CODE_LINE.test(s)) { code = s; return; }
      if (s.startsWith(":")) return;               // keepalive 注释
      if (!s.startsWith("data:")) { rawBody += s; return; }
      sawData = true;
      const piece = deltaOf(s.slice(5));
      if (piece === null) return;
      if (firstAt === null) {
        firstAt = Date.now();
        if (gate) { clearTimeout(gate); gate = null; }
      }
      text += piece;
      if (p.onDelta) {
        try { p.onDelta(piece, text); } catch (_) {}
      }
    }

    child.stdout.on("data", (buf) => {
      pending += buf.toString("utf8");
      let idx;
      while ((idx = pending.indexOf("\n")) >= 0) {
        handleLine(pending.slice(0, idx));
        pending = pending.slice(idx + 1);
      }
    });

    child.on("error", () => done({ ok: false, text, code: "spawn" }));

    child.on("close", () => {
      if (pending) handleLine(pending);
      // 没走过 SSE：可能是网关忽略了 stream:true，直接回了一整段 JSON
      if (!sawData && !text.trim() && rawBody.trim().startsWith("{")) {
        try {
          const json = JSON.parse(rawBody);
          const msg = (json.choices && json.choices[0] && json.choices[0].message) || {};
          if (typeof msg.content === "string" && msg.content) {
            text = msg.content;
            firstAt = Date.now();
            if (p.onDelta) { try { p.onDelta(text, text); } catch (_) {} }
          }
        } catch (_) {}
      }
      if (!code && stderr && /^\s*curl: \((\d+)\)/.test(stderr)) {
        const m = stderr.match(/^\s*curl: \((\d+)\)/);
        code = m ? m[1] : "";
      }
      done({ ok: text.trim().length > 0, text, code: code || "0" });
    });
  });
}

module.exports = { streamOnce, deltaOf };
