(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const dom = Object.fromEntries(["notice", "error", "content", "demo-badge", "photo-count", "album-grid", "album-description", "chapter-list", "lightbox", "photo-image", "photo-fallback", "photo-title", "photo-zh", "photo-where", "photo-date", "photo-position", "photo-status", "photo-save", "photo-variants", "photo-mobile", "photo-desktop", "photo-previous", "photo-next", "photo-close", "story-overlay", "story-image", "story-fallback", "story-title", "story-text", "story-progress", "story-choices", "story-continue", "story-status", "story-close"].map(id => [id, $(id)]));
  const preview = new URLSearchParams(location.search).get("demo") === "1";
  const host = window.malfoyHost?.gallery;
  // No image URL is synthesized: only values supplied by the host state/action may be used.
  const demo = {
    album: [
      {id:"demo-01", title:"海边的第一天", unlockAt:0, zh:"演示文案 · 海风经过窗边。", where:"演示 · 海岸", date:"演示日期"},
      {id:"demo-02", title:"午后的信", unlockAt:0, zh:"演示文案 · 把这个下午留给你。", where:"演示 · 小屋", date:"演示日期"},
      {id:"demo-03", title:"未开启的回忆", unlockAt:20, zh:"演示文案", where:"演示 · 未知", date:"演示日期"}
    ],
    chapters: [{id:"demo-chapter", title:"演示 · 潮声", unlockAt:0, reward:"演示奖励（不会保存）", flow:[
      {text:"演示剧情 · 她在海边等你。"},
      {text:"演示剧情 · 要不要一起出发？", then:"choice"},
      {branch:{A:{text:"演示分支 A · 一起走向海边。"}, B:{text:"演示分支 B · 暂时留在这里。"}}}
    ], choices:{prompt:"演示 · 你想怎么回答？", a:"一起去", b:"留在这里"}}],
    progress:{affection:0, completedChapters:[]}
  };
  let data = {album:[], chapters:[], progress:{}};
  let activePhoto = null, activePhotoVariant = "mobile", activeStory = null, previousFocus = null, busy = false;
  let relationDirty = false, stateLoading = false, disposed = false, stateRevision = 0, relationError = "";
  const text = (value, fallback="—") => value === null || value === undefined || value === "" ? fallback : String(value);
  const errorText = error => text(error?.message || error, "未知错误");
  const setNotice = message => { dom.notice.textContent = message; dom.notice.hidden = !message; };
  const setError = message => { dom.error.textContent = message; dom.error.hidden = !message; };
  const imageSource = value => {
    if (typeof value !== "string" || !value.trim()) return "";
    const path=value.trim();
    // The host supplies local paths; never fetch network/data URLs or invent assets.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path) && !/^(?:file:|app:)/i.test(path)) return "";
    return path;
  };
  const array = value => Array.isArray(value) ? value : [];
  const hasId = (value, id) => Array.isArray(value) ? value.includes(id) : !!(value && typeof value === "object" && value[id]);
  const affection = () => Number(data.progress?.affection ?? data.progress?.affinity ?? 0) || 0;
  function unlocked(item, kind) {
    if (item.unlocked === true || item.isUnlocked === true || item.locked === false) return true;
    if (item.unlocked === false || item.isUnlocked === false || item.locked === true) return false;
    const list = kind === "album" ? (data.progress?.unlockedPhotos ?? data.progress?.unlockedAlbum) : data.progress?.unlockedChapters;
    if (hasId(list, item.id)) return true;
    const threshold = Number(item.unlockAt ?? item.requiredAffection);
    return Number.isFinite(threshold) && affection() >= threshold;
  }
  function completed(chapter) { return !!(chapter.done || chapter.completed || chapter.finished || hasId(data.progress?.completedChapters ?? data.progress?.chaptersCompleted, chapter.id)); }
  function label(item, index) { return text(item.title ?? item.where?.split?.(" · ")?.[0], `记忆 ${String(index + 1).padStart(2,"0")}`); }
  function imageOf(item, variant = "mobile") { return imageSource(variant === "desktop" ? (item?.desktopImage ?? item?.desktopFile) : (item?.image ?? item?.imageUrl ?? item?.thumbnail ?? item?.file)); }
  function thresholdOf(item) { return text(item.unlockAt ?? item.requiredAffection, "?"); }
  function applyState(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.album) || !Array.isArray(value.chapters)) throw new Error("相册数据格式不正确：需要 album 和 chapters 数组。请检查应用内的数据接口。");
    data = {album:value.album, chapters:value.chapters, clips:value.clips, progress:value.progress && typeof value.progress === "object" ? value.progress : {}};
    stateRevision++;
    render();
  }
  function render() {
    const focused=document.activeElement;
    const focusKey=element => element?.dataset?.photoId ? ["photoId",element.dataset.photoId]
      : element?.dataset?.chapterId ? ["chapterId",element.dataset.chapterId] : null;
    const currentKey=focusKey(focused), returnKey=focusKey(previousFocus);
    dom.content.hidden = false;
    const open = data.album.filter(item => item && unlocked(item,"album")).length;
    dom["photo-count"].textContent = `${open} / ${data.album.length} 已解锁`;
    dom["album-description"].textContent = data.album.length ? `共 ${data.album.length} 张回忆` : "";
    dom["album-grid"].replaceChildren();
    data.album.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const available = unlocked(item,"album");
      const button = document.createElement("button");
      button.dataset.photoId=item.id;
      button.type="button"; button.className=`photo-card${available ? "" : " photo-card--locked"}`;
      if (available) {
        button.setAttribute("aria-label", `查看第 ${index + 1} 张：${label(item,index)}`);
        const src = imageOf(item);
        if (src) {
          const img = document.createElement("img"); img.src=src; img.alt=""; img.loading="lazy";
          img.addEventListener("error", () => { img.remove(); const missing=document.createElement("span"); missing.className="photo-card__missing"; missing.textContent="图片暂时无法显示"; button.prepend(missing); }, {once:true});
          button.append(img);
        } else { const missing=document.createElement("span"); missing.className="photo-card__missing"; missing.textContent="暂无图片"; button.append(missing); }
        const caption=document.createElement("span"); caption.className="photo-card__label"; caption.textContent=label(item,index); button.append(caption);
        button.addEventListener("click",()=>openPhoto(index));
      } else {
        button.disabled=true; button.setAttribute("aria-label", `第 ${index + 1} 张，好感度 ${thresholdOf(item)} 解锁`);
        const lock=document.createElement("span"); lock.className="photo-card__lock"; lock.textContent=`好感度 ${thresholdOf(item)} 解锁`; button.append(lock);
      }
      dom["album-grid"].append(button);
    });
    if (!dom["album-grid"].children.length) dom["album-grid"].append(empty());
    dom["chapter-list"].replaceChildren();
    data.chapters.forEach((chapter,index) => {
      if (!chapter || typeof chapter !== "object") return;
      const row=document.createElement("article"); row.className="chapter";
      const number=document.createElement("span"); number.className="chapter__number"; number.textContent=String(index+1).padStart(2,"0");
      const info=document.createElement("div"); info.className="chapter__info";
      const heading=document.createElement("strong"); heading.textContent=text(chapter.title,`第 ${index+1} 章`);
      const subtitle=document.createElement("small"); subtitle.textContent=unlocked(chapter,"chapter") ? "已解锁" : "尚未解锁";
      info.append(heading,subtitle);
      const action=document.createElement("div"); action.className="chapter__action";
      if (completed(chapter)) { const done=document.createElement("span"); done.className="chapter__done"; done.textContent="✓ 已看完"; action.append(done); }
      if (unlocked(chapter,"chapter")) {
        const start=document.createElement("button"); start.type="button"; start.dataset.chapterId=chapter.id; start.textContent=completed(chapter) ? "重看" : "开始"; start.setAttribute("aria-label",`${start.textContent}${heading.textContent}`); start.addEventListener("click",()=>startStory(chapter)); action.append(start);
      } else { const lock=document.createElement("span"); lock.className="chapter__locked"; lock.textContent=`好感度 ${thresholdOf(chapter)} 解锁`; action.append(lock); }
      row.append(number,info,action); dom["chapter-list"].append(row);
    });
    if (!dom["chapter-list"].children.length) dom["chapter-list"].append(empty());
    const buttons=[...dom["album-grid"].querySelectorAll("button"),...dom["chapter-list"].querySelectorAll("button")];
    const replacement=key => key && buttons.find(button => button.dataset[key[0]]===key[1]);
    if (returnKey) previousFocus=replacement(returnKey) || null;
    const focusTarget=replacement(currentKey);
    if (focusTarget && !focusTarget.disabled) focusTarget.focus({preventScroll:true});
    if (preview) setNotice("演示模式 · 以下三张相册卡片和章节均为页面内示意，不会保存进度或图片。");
    else if (!data.album.length && !data.chapters.length) setNotice("还没有可看的内容");
    else setNotice("");
  }
  function empty() { const item=document.createElement("div"); item.className="empty"; item.textContent="还没有可看的内容"; return item; }
  function overlayOpen(overlay, focus) { previousFocus=document.activeElement; overlay.hidden=false; document.body.style.overflow="hidden"; focus.focus(); }
  function overlayClose(overlay) {
    overlay.hidden=true; document.body.style.overflow="";
    const fallback=[...dom["album-grid"].querySelectorAll("button"),...dom["chapter-list"].querySelectorAll("button")].find(button=>!button.disabled);
    (previousFocus && !previousFocus.disabled ? previousFocus : fallback)?.focus?.(); previousFocus=null;
  }
  function openPhoto(index) { if (!unlocked(data.album[index],"album")) return; activePhoto=index; activePhotoVariant="mobile"; overlayOpen(dom.lightbox,dom["photo-close"]); renderPhoto(); }
  function renderPhoto() {
    const item=data.album[activePhoto]; if (!item) { closePhoto(); return; }
    dom["photo-title"].textContent=label(item,activePhoto);
    dom["photo-zh"].textContent=text(item.zh,"暂无文案");
    dom["photo-where"].textContent=text(item.where,"未记录"); dom["photo-date"].textContent=text(item.date,"未记录");
    dom["photo-position"].textContent=`${activePhoto+1} / ${data.album.length}`;
    dom["photo-status"].textContent="";
    const hasDesktop=!!imageOf(item,"desktop");
    dom["photo-variants"].hidden=!hasDesktop;
    if (!hasDesktop) activePhotoVariant="mobile";
    dom["photo-mobile"].setAttribute("aria-pressed",String(activePhotoVariant==="mobile"));
    dom["photo-desktop"].setAttribute("aria-pressed",String(activePhotoVariant==="desktop"));
    dom["photo-save"].textContent=activePhotoVariant==="desktop" ? "保存电脑壁纸" : "保存手机壁纸";
    const src=imageOf(item,activePhotoVariant); dom["photo-image"].hidden=!src; dom["photo-fallback"].hidden=!!src;
    dom["photo-image"].alt=label(item,activePhoto);
    if (src) dom["photo-image"].src=src; else dom["photo-image"].removeAttribute("src");
    dom["photo-save"].disabled=preview || !host?.savePhoto || !item.id || busy;
    dom["photo-save"].title=preview ? "演示模式不能保存" : "";
    dom["photo-previous"].disabled=nextPhotoIndex(-1)===null;
    dom["photo-next"].disabled=nextPhotoIndex(1)===null;
  }
  function nextPhotoIndex(direction) { for (let i=activePhoto+direction;i>=0 && i<data.album.length;i+=direction) if (data.album[i] && unlocked(data.album[i],"album")) return i; return null; }
  function movePhoto(direction) { const index=nextPhotoIndex(direction); if (index!==null) { activePhoto=index; renderPhoto(); } }
  function choosePhotoVariant(variant) { activePhotoVariant=variant; renderPhoto(); }
  function closePhoto() { if (!dom.lightbox.hidden) overlayClose(dom.lightbox); activePhoto=null; }
  dom["photo-image"].addEventListener("error",()=>{ dom["photo-image"].hidden=true; dom["photo-fallback"].hidden=false; });
  dom["photo-close"].addEventListener("click",closePhoto);
  dom["photo-mobile"].addEventListener("click",()=>choosePhotoVariant("mobile"));
  dom["photo-desktop"].addEventListener("click",()=>choosePhotoVariant("desktop"));
  dom["photo-previous"].addEventListener("click",()=>movePhoto(-1)); dom["photo-next"].addEventListener("click",()=>movePhoto(1));
  dom["photo-save"].addEventListener("click",async()=>{
    const id=data.album[activePhoto]?.id; if (!host?.savePhoto || !id || busy) return;
    busy=true; dom["photo-save"].disabled=true; dom["photo-status"].textContent="正在打开保存对话框…";
    try { const result=await host.savePhoto(id,activePhotoVariant); dom["photo-status"].textContent=result?.cancelled ? "已取消保存" : result?.ok ? `已保存${result.path ? `：${result.path}` : ""}` : `保存失败：${text(result?.error,"请重试")}`; }
    catch (error) { dom["photo-status"].textContent=`保存失败：${errorText(error)}`; }
    finally { busy=false; if (activePhoto!==null) dom["photo-save"].disabled=false; flushRelationRefresh(); }
  });
  function resolveScene(chapter, value) {
    if (typeof value === "string") return array(chapter.clips).concat(array(data.clips)).find(clip=>clip?.id===value) || {text:`片段 ${value} 暂无内容`};
    if (value?.clip && !value.image && !value.text) return resolveScene(chapter,value.clip);
    if (value?.clip && (value.image || value.text)) return value;
    return value && typeof value === "object" ? value : {text:"这一幕暂时没有内容"};
  }
  function stepsFor(chapter) { return array(chapter.flow?.length ? chapter.flow : chapter.scenes); }
  async function invoke(action, extra) {
    if (preview) return {};
    if (!host || typeof host.action !== "function") throw new Error("应用内剧情接口不可用。");
    stateRevision++; // Invalidate reads started before this mutation, even if the request fails.
    const result=await host.action({action,...extra});
    if (result?.ok === false) throw new Error(text(result.error || result.message,"操作未成功"));
    if (result?.state) applyState(result.state);
    return result || {};
  }
  async function refresh() { if (!preview && host?.state) { try { applyState(await host.state()); } catch (error) { dom["story-status"].textContent=`进度刷新失败：${errorText(error)}`; } } }
  function requestRelationRefresh() {
    if (disposed) return;
    relationDirty=true;
    flushRelationRefresh();
  }
  async function flushRelationRefresh() {
    if (disposed || preview || busy || stateLoading || !relationDirty || !host?.state) return;
    relationDirty=false; stateLoading=true;
    const revision=stateRevision;
    try {
      const value=await host.state();
      if (disposed) return;
      // A newer event or a story action makes this snapshot stale. Fetch once more
      // when idle instead of resetting an active story from an old response.
      if (busy || revision!==stateRevision || relationDirty) { relationDirty=true; return; }
      const photoId=activePhoto===null ? null : data.album[activePhoto]?.id;
      const photoStatus=dom["photo-status"].textContent;
      applyState(value);
      if (photoId) {
        activePhoto=data.album.findIndex(item => item?.id===photoId);
        if (activePhoto>=0 && unlocked(data.album[activePhoto],"album")) {
          renderPhoto(); dom["photo-status"].textContent=photoStatus;
        } else closePhoto();
      }
      if (relationError && dom.error.textContent===relationError) setError("");
      relationError="";
    } catch (error) {
      if (!disposed) { relationError=`关系更新失败：${errorText(error)}。下次互动时会重试。`; setError(relationError); }
    } finally {
      stateLoading=false;
      if (!disposed && relationDirty && !busy) flushRelationRefresh();
    }
  }
  async function startStory(chapter) {
    if (busy || !unlocked(chapter,"chapter")) return;
    setStoryBusy(true); const id=chapter.id;
    try {
      const result=await invoke("start",{chapterId:id});
      activeStory={chapter, index:0, override:result.scene || null, choicePending:false, done:false};
      overlayOpen(dom["story-overlay"],dom["story-close"]); renderStory();
    } catch(error) { setError(`剧情启动失败：${errorText(error)}`); }
    finally { setStoryBusy(false); }
  }
  function storyStep() { return stepsFor(activeStory.chapter)[activeStory.index]; }
  function setStoryBusy(value) {
    busy=value;
    dom["story-continue"].disabled=value || !!activeStory?.done;
    dom["story-close"].disabled=value;
    for (const button of dom["story-choices"].querySelectorAll("button")) button.disabled=value;
    if (!value) flushRelationRefresh();
  }
  function renderStory() {
    const story=activeStory; if (!story) return;
    const {chapter}=story; const step=storyStep();
    dom["story-title"].textContent=text(chapter.title,"剧情");
    dom["story-progress"].textContent=story.done ? "THE END" : `第 ${story.index+1} 幕`;
    dom["story-status"].textContent="";
    dom["story-choices"].replaceChildren(); dom["story-choices"].hidden=true;
    dom["story-continue"].hidden=false; dom["story-continue"].disabled=busy;
    if (story.done) {
      dom["story-text"].textContent=`已完成${story.reward ? ` · 奖励：${story.reward}` : " · 奖励已由应用结算"}`;
      dom["story-continue"].hidden=true; showStoryImage(""); return;
    }
    const scene=resolveScene(chapter,story.override || step);
    if (scene.branch || story.choicePending) {
      story.choicePending=true;
      dom["story-text"].textContent=text(chapter.choices?.prompt ?? scene.prompt,"请选择接下来的故事");
      dom["story-continue"].hidden=true; dom["story-choices"].hidden=false;
      for (const option of ["A","B"]) {
        const choice=document.createElement("button"); choice.type="button";
        choice.textContent=`${option}  ${text(chapter.choices?.[option.toLowerCase()] ?? scene.choices?.[option],`选择 ${option}`)}`;
        choice.disabled=busy; choice.addEventListener("click",()=>choose(option)); dom["story-choices"].append(choice);
      }
      showStoryImage(imageOf(story.lastScene)); return;
    }
    story.lastScene=scene;
    dom["story-text"].textContent=text(scene.text ?? scene.zh,"这一幕暂时没有文字");
    showStoryImage(imageOf(scene));
  }
  function showStoryImage(src) { dom["story-image"].hidden=!src; dom["story-fallback"].hidden=!!src; if (src) dom["story-image"].src=src; else dom["story-image"].removeAttribute("src"); }
  dom["story-image"].addEventListener("error",()=>{dom["story-image"].hidden=true;dom["story-fallback"].hidden=false;});
  async function continueStory() {
    if (!activeStory || busy || activeStory.done || activeStory.choicePending) return;
    const story=activeStory, steps=stepsFor(story.chapter), step=storyStep();
    if (step?.branch && !story.override) { story.choicePending=true; renderStory(); return; }
    if (step?.then==="choice") {
      setStoryBusy(true);
      try { await invoke("advance",{chapterId:story.chapter.id, step:story.index}); story.index+=1; story.override=null; story.choicePending=true; renderStory(); }
      catch (error) { dom["story-status"].textContent=`继续失败：${errorText(error)}`; }
      finally { setStoryBusy(false); }
      return;
    }
    if (story.index+1>=steps.length && !story.override?.next) { await finishStory(); return; }
    setStoryBusy(true);
    try { const result=await invoke("advance",{chapterId:story.chapter.id, step:story.index}); story.index+=1; story.override=result.scene || null; story.choicePending=false; renderStory(); }
    catch (error) { dom["story-status"].textContent=`继续失败：${errorText(error)}`; }
    finally { setStoryBusy(false); }
  }
  async function choose(option) {
    if (!activeStory || busy || !activeStory.choicePending) return;
    setStoryBusy(true); const story=activeStory;
    try {
      const result=await invoke("choose",{chapterId:story.chapter.id, step:story.index, option});
      const branch=storyStep()?.branch?.[option];
      story.override=result.scene || resolveScene(story.chapter,branch);
      // Choosing resolves this branch step; only advance moves to the next one.
      story.choicePending=false; renderStory();
    } catch (error) { dom["story-status"].textContent=`选择失败：${errorText(error)}`; }
    finally { setStoryBusy(false); }
  }
  async function finishStory() {
    if (!activeStory || busy) return;
    setStoryBusy(true); const story=activeStory;
    try {
      const result=await invoke("complete",{chapterId:story.chapter.id});
      story.done=true; story.reward=result.reward ?? story.chapter.reward;
      if (preview) { data.progress.completedChapters.push(story.chapter.id); render(); }
      renderStory(); await refresh();
    } catch (error) { dom["story-status"].textContent=`结算失败：${errorText(error)}`; }
    finally { setStoryBusy(false); }
  }
  function closeStory() { if (busy || dom["story-overlay"].hidden) return; overlayClose(dom["story-overlay"]); activeStory=null; }
  dom["story-continue"].addEventListener("click",continueStory); dom["story-close"].addEventListener("click",closeStory);
  function focusWithin(event, container) {
    const controls=Array.from(container.querySelectorAll("button:not([hidden]):not(:disabled)"));
    const visible=controls.filter(el=>el.getClientRects().length);
    if (!visible.length) return;
    if (event.shiftKey && document.activeElement===visible[0]) { event.preventDefault(); visible.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement===visible.at(-1)) { event.preventDefault(); visible[0].focus(); }
  }
  document.addEventListener("keydown",event=>{
    const overlay=!dom["story-overlay"].hidden ? dom["story-overlay"] : !dom.lightbox.hidden ? dom.lightbox : null;
    if (!overlay) return;
    if (event.key==="Escape") { event.preventDefault(); overlay===dom.lightbox ? closePhoto() : closeStory(); }
    else if (event.key==="Tab") focusWithin(event,overlay);
    else if (overlay===dom.lightbox && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key==="ArrowLeft") {event.preventDefault();movePhoto(-1);}
      if (event.key==="ArrowRight") {event.preventDefault();movePhoto(1);}
    }
  });
  async function init() {
    if (preview) { dom["demo-badge"].hidden=false; setNotice("演示模式 · 以下三张相册卡片和章节均为页面内示意，不会保存进度或图片。"); applyState(demo); return; }
    if (!host || typeof host.state !== "function") { dom["photo-count"].textContent="— / — 已解锁"; setNotice("请在应用内打开。独立预览可在地址后添加 ?demo=1（仅演示内容）。"); return; }
    setNotice("正在加载相册与剧情…");
    // The current preload owns its IPC listener for the lifetime of this frame.
    // Also support an unsubscribe callback when the host offers one.
    const unsubscribe=window.malfoyHost.onAffection?.(requestRelationRefresh);
    window.addEventListener?.("pagehide",()=>{
      disposed=true; relationDirty=false;
      if (typeof unsubscribe==="function") unsubscribe();
    },{once:true});
    stateLoading=true;
    try { const value=await host.state(); if (disposed) return; applyState(value); }
    catch (error) { dom.content.hidden=true; setNotice(""); setError(`加载失败：${errorText(error)}。请在应用内重试打开此页面。`); return; }
    finally { stateLoading=false; flushRelationRefresh(); }
    // 从「剧情」入口打开时直接定位到章节区。等图片布局稳定再滚，否则滚动位置会被图片撑开挤走。
    if (new URLSearchParams(location.search).get("tab") === "chapters") {
      const target = document.querySelector(".chapters");
      setTimeout(() => target?.scrollIntoView({ block: "start" }), 350);
    }
  }
  init();
})();
