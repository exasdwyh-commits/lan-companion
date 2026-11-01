/* WORLD-UX-21 · 界面收口的运行时
 *
 * CSS 负责长相，这里只做三件 CSS 做不到的事：
 *   1. 把 nav.bar 里所有按钮补成「38px 图标 + data-tip 提示」，谁后注入都一样。
 *   2. 闲置 3.6s 让控件退场（body.ui-idle），一动就回来。
 *   3. 首次进入 9s 后淡掉「拖动旋转」提示——它是入门用的，不是常驻装饰。
 *
 * 刻意不碰 3D 画面、不碰 lan-companion 的面板逻辑，全部是可逆的 class 增删。
 */
(() => {
  'use strict';

  /* ───────── 图标：24×24 线性描边，和 index.html 里原有的三个同族 ───────── */
  const ICON = {
    album: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4.5 16.5l4.2-4.1 3.4 3.2 2.7-2.4 4.7 4"/>',
    books: '<path d="M5 4.5h4v15H5z"/><path d="M9 4.5h4v15H9z"/><path d="M14.4 5.4l3.5-1 3 14.3-3.5 1z"/>',
    chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4a.5.5 0 0 1-.8-.4z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>',
    moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/>',
    sound: '<path d="M4.5 9.5h3L12 5.5v13l-4.5-4h-3z"/><path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.8a7.6 7.6 0 0 1 0 10.4"/>',
    view: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9M20 15v3.5A1.5 1.5 0 0 1 18.5 20H15"/><circle cx="12" cy="12" r="2.4"/>',
  };

  /* 按现行 DOM 里的中文/英文标签认出是哪颗按钮，换成图标。
     认不出就保持原样——宁可难看，也不要猜错功能。 */
  const BY_LABEL = {
    '相册': 'album', 'Album': 'album', 'Photos': 'album',
    '书架': 'books', '小说书架': 'books', 'Books': 'books', 'Library': 'books',
    '看澜': 'chat', 'Talk': 'chat', 'Chat': 'chat',
  };
  const BY_ID = { bNight: 'moon', bSound: 'sound', bView: 'view' };

  const tips = new WeakMap();

  function labelOf(btn) {
    return (btn.getAttribute('aria-label') || btn.getAttribute('data-tip') || btn.title || btn.textContent || '').trim();
  }

  function iconFor(btn) {
    if (btn.dataset.uiIcon && ICON[btn.dataset.uiIcon]) return btn.dataset.uiIcon;
    if (BY_ID[btn.id]) return BY_ID[btn.id];
    const label = (btn.textContent || '').trim();
    if (BY_LABEL[label]) return BY_LABEL[label];
    const al = (btn.getAttribute('aria-label') || '').trim();
    return BY_LABEL[al] || (btn.querySelector('svg') ? 'view' : null);
  }

  function dress(btn) {
    if (btn.dataset.uiDressed === '1') return;
    const name = iconFor(btn);
    if (!name) return;
    const tip = labelOf(btn);
    if (tip && !btn.dataset.tip) btn.setAttribute('data-tip', tip);
    if (tip) tips.set(btn, tip);
    if (!btn.querySelector('svg')) btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
    if (!btn.getAttribute('aria-label') && tip) btn.setAttribute('aria-label', tip);
    btn.dataset.uiDressed = '1';
    btn.type = 'button';
  }

  function dressBar() {
    const bar = document.querySelector('nav.bar');
    if (!bar) return;
    const btns = [...bar.querySelectorAll('button')];
    btns.forEach(dress);
    // 游戏/生活入口和「入夜·环境声·复位」之间加一道细分隔线
    const first = btns[0];
    if (first && btns.length > 3) first.setAttribute('data-sep', '');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '小屋控件');
  }

  /* ───────── 闲置退场 ───────── */
  // ?uiidle=0 常驻显示：截图、录屏、以及「我就想一直看得见按钮」的人
  const HOLD = new URLSearchParams(location.search).get('uiidle') === '0';
  const IDLE_MS = 3600;
  let idleTimer = 0;

  function wake() {
    if (document.body.classList.contains('ui-idle')) document.body.classList.remove('ui-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (HOLD) return;
      if (document.hidden) return;
      if (document.activeElement && document.body.contains(document.activeElement) &&
          document.activeElement.matches('input, textarea, .lc-root *')) return;
      document.body.classList.add('ui-idle');
    }, IDLE_MS);
  }

  /* ───────── 启动 ───────── */
  function start() {
    dressBar();
    // lan-companion 在 setTimeout / ready 之后才注入 相册·书架，隔一会儿再补一遍
    [300, 1200, 2600].forEach((ms) => setTimeout(dressBar, ms));
    if (window.MutationObserver) {
      const bar = document.querySelector('nav.bar');
      if (bar) new MutationObserver(dressBar).observe(bar, { childList: true });
    }

    ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin'].forEach((ev) => {
      window.addEventListener(ev, wake, { passive: true });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    wake();

    // 入门提示：9s 后淡出，用户一动就先淡掉一半
    if (!HOLD) setTimeout(() => {
      const hint = document.querySelector('.hint');
      if (hint) hint.classList.add('gone');
    }, 9000);

    window.__lanUI = {
      wake,
      dressBar,
      get idle() { return document.body.classList.contains('ui-idle'); },
      get dockIcons() {
        return [...document.querySelectorAll('nav.bar button')].map((b) => ({
          tip: b.getAttribute('data-tip') || '', svg: !!b.querySelector('svg'),
          w: Math.round(b.getBoundingClientRect().width),
          h: Math.round(b.getBoundingClientRect().height),
        }));
      },
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
