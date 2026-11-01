// 离屏渲染实拍：把 world.html 的某一态渲染成 PNG，用于留证
// 用法: node scripts/render-preview.js <mode> <chat0|1> <输出png> [closeup|heart]
//   mode  : world | desktop
//   chat  : 1 = 显示输入框
//   第4参: closeup / heart 时额外把透明视频层打开（验证视频接入）
//
// 为什么不直接 screencapture 整个桌面：当前会话锁屏（CGSSessionScreenIsLocked=true），
// 屏幕整截只能拍到锁屏。这里让 Electron 自己渲染一帧，绕开锁屏。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const [, , mode = 'world', chat = '1', out = '/tmp/preview.png', extra] = process.argv;
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'dist/DeepWhale.app/Contents/Resources/app/web/live2d/world.html');

app.commandLine.appendSwitch('disable-gpu-compositing');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1512, height: 859, show: true, frame: false, transparent: true,
    hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  await win.loadFile(PAGE, { query: { mode, chat } });
  await new Promise((r) => setTimeout(r, 1800));

  if (extra === 'closeup') {
    await win.webContents.executeJavaScript(
      "Character.showVideo('closeup','40vh'); document.getElementById('ch').style.visibility='hidden'; 1", true);
  } else if (extra === 'heart') {
    await win.webContents.executeJavaScript(
      "Character.showVideo('heart','40vh'); document.getElementById('ch').style.visibility='hidden'; 1", true);
  }
  await new Promise((r) => setTimeout(r, 1400));

  const img = await win.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out, img.getSize());
  app.quit();
});
