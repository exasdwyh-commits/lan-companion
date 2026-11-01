"use strict";
// Bounded failover with per-provider circuit breakers. Only a completed answer
// wins; cancelled curl processes cannot deliver a late answer.
class ChatRouter {
  constructor({ request, streamRequest, now = Date.now, budgetMs = 18000, attemptMs = 4500, streamAttemptMs = 45 }) {
    this.request = request; this.now = now; this.budgetMs = budgetMs; this.attemptMs = attemptMs;
    this.streamRequest = streamRequest || null;
    // 流式的单次上限比非流式宽得多：一旦开始出正文就不该截断，
    // 但完全没有正文时由 firstTokenMs 闸门提前放行到下一个源。
    this.streamAttemptMs = streamAttemptMs;
    this.failures = new Map(); this.preferred = null;
  }
  async run(providers, messages, { signal } = {}) {
    const started = this.now(), attempts = [];
    const ordered = [...providers].sort((a,b) => Number(b.id===this.preferred)-Number(a.id===this.preferred));
    for (const p of ordered) {
      if (signal?.aborted) return { ok:false, cancelled:true, attempts };
      if ((this.failures.get(p.id)||0)>this.now()) continue;
      const remaining = this.budgetMs-(this.now()-started); if (remaining<=0) break;
      const controller = new AbortController();
      const cancel = () => controller.abort(); signal?.addEventListener('abort',cancel,{once:true});
      const limit = Math.min(p.timeoutMs||this.attemptMs,remaining);
      let timer;
      const before = this.now();
      let r;
      try {
        r = await Promise.race([
          this.request(p,messages,limit,controller.signal),
          new Promise(resolve => { timer=setTimeout(()=>{controller.abort();resolve({ok:false,code:'timeout'});},limit); }),
          new Promise(resolve => controller.signal.addEventListener('abort',()=>resolve({ok:false,code:'cancelled'}),{once:true})),
        ]);
      } catch (_) { r={ok:false,code:'network'}; }
      finally { clearTimeout(timer);signal?.removeEventListener('abort',cancel); }
      attempts.push({id:p.id,code:r.code||'0',ms:this.now()-before});
      if (signal?.aborted) return {ok:false,cancelled:true,attempts};
      if (r.ok && r.text?.trim()) { this.preferred=p.id;this.failures.delete(p.id);return {...r,via:p.id,attempts,ms:this.now()-started}; }
      this.failures.set(p.id,this.now()+(String(r.code)==='429'?120000:30000));
    }
    return {ok:false,attempts,ms:this.now()-started};
  }

  /**
   * 流式版本：和 run() 同一套顺序与熔断，但用「首个正文 token」当闸门。
   *
   * 闸门默认 5s：健康源实测首字 1.9~2.7s，网关排队时能到 3.6s ——
   * 卡在 2.6s/4s 都会把本来能答的源误杀；而网关真卡住时实测有 38s 才出正文，
   * 5s 至少能把这 33s 省掉。
   *
   * 与非流式的关键区别：一旦某个源已经开始吐正文，就让它说完 ——
   * 中途失败也把已有内容当成结果交出去（truncated:true），
   * 因为用户已经听见了前半段，换源重播会重复。
   */
  async runStream(providers, messages, { signal, onDelta, firstTokenMs = 5000 } = {}) {
    const started = this.now(), attempts = [];
    if (!this.streamRequest) return { ok:false, attempts, ms:0, unsupported:true };
    const ordered = [...providers].sort((a,b) => Number(b.id===this.preferred)-Number(a.id===this.preferred));
    for (const p of ordered) {
      if (signal?.aborted) return {ok:false,cancelled:true,text:"",attempts};
      if ((this.failures.get(p.id)||0)>this.now()) continue;
      const remaining = this.budgetMs-(this.now()-started);
      if (remaining<=0) break;
      const before = this.now();
      const r = await this.streamRequest(p, messages, {
        signal,
        onDelta,
        timeoutSec: Math.min(p.timeoutMs||this.streamAttemptMs, Math.ceil(remaining/1000)+1),
        firstTokenMs: Math.max(300, Math.min(firstTokenMs, remaining)),
      });
      attempts.push({id:p.id,code:r.code||'0',ms:r.ms||(this.now()-before),first:r.firstTokenMs??null});
      if (signal?.aborted) return {ok:false,cancelled:true,text:r.text||"",attempts};
      if (r.text && r.text.trim()) {
        this.preferred=p.id; this.failures.delete(p.id);
        return {ok:true,text:r.text,via:p.id,attempts,ms:this.now()-started,
          firstTokenMs:r.firstTokenMs??null,truncated:!r.ok};
      }
      this.failures.set(p.id,this.now()+(String(r.code)==='429'?120000:30000));
    }
    return {ok:false,attempts,ms:this.now()-started};
  }
}
module.exports={ChatRouter};
