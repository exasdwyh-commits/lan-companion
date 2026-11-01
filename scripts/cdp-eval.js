// CDP 小工具：在运行中的 Electron 页面里执行 JS / 截图
// 用法:
//   node cdp.js <port> eval "<js表达式>"
//   node cdp.js <port> shot <输出png路径>
//   node cdp.js <port> pages
const fs = require('fs');

const [port, cmd, arg] = process.argv.slice(2);

async function pages() {
  const r = await fetch(`http://127.0.0.1:${port}/json`, { });
  return (await r.json()).filter(p => p.type === 'page');
}

function ws(url) {
  return new Promise((res, rej) => {
    const s = new WebSocket(url);
    s.onopen = () => res(s);
    s.onerror = (e) => rej(new Error('ws error'));
  });
}

let seq = 0;
function send(s, method, params) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        s.removeEventListener('message', onMsg);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
    s.addEventListener('message', onMsg);
    s.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  const list = await pages();
  if (cmd === 'pages') {
    console.log(JSON.stringify(list.map(p => ({ title: p.title, url: p.url })), null, 2));
    return;
  }
  if (!list.length) { console.error('没有页面'); process.exit(2); }
  const s = await ws(list[0].webSocketDebuggerUrl);
  if (cmd === 'eval') {
    const r = await send(s, 'Runtime.evaluate', {
      expression: arg, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) { console.error('EXC:', JSON.stringify(r.exceptionDetails)); process.exit(3); }
    // 页面常返回 JSON 字符串，试着还原成对象，日志才读得懂
    let v = r.result.value;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try { v = JSON.parse(t); } catch (e) { /* 保持原样 */ }
      }
    }
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  } else if (cmd === 'shot') {
    console.error('DBG shot enter', arg);
    await send(s,'Page.enable',{}).catch(()=>{});
    const r = await Promise.race([send(s, 'Page.captureScreenshot', { format: 'png', fromSurface: false }), new Promise(r2=>setTimeout(()=>r2({timeout:true}),8000))]);
    if (r.timeout) { console.error('captureScreenshot 超时'); process.exit(4); }
    fs.writeFileSync(arg, Buffer.from(r.data, 'base64'));
    console.log('saved', arg);
  }
  s.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
