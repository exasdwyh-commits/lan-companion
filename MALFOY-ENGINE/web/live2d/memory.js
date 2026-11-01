/* A standalone renderer: only the four documented host memory methods are used. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const listNode = $("memories");
  const stateNode = $("state");
  const countNode = $("count");
  const searchNode = $("search");
  const confirmNode = $("clear-confirm");
  const clearButton = $("clear-all");
  const noticeNode = $("notice");
  const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  const host = window.malfoyHost?.memory;
  const available = host && ["list", "correct", "forget", "clearAll"].every((name) => typeof host[name] === "function");
  const demo = !available && isDemo;
  const demoItems = [
    { key: "favorite", text: "你喜欢在下雨的晚上听海浪声。", time: "2026-10-28", demo: true },
    { key: "promise", text: "我们约好下次一起读完那本书。", time: "2026-10-29", demo: true },
    { key: "name", text: "你叫她澜。", time: "2026-10-30", demo: true },
  ];
  let items = [];
  let busy = false;
  let requestId = 0;
  let searchTimer;
  let toastTimer;
  let editingKey = null;
  let forgettingKey = null;

  function notify(message, error = false) {
    clearTimeout(toastTimer);
    noticeNode.textContent = message;
    noticeNode.classList.toggle("error", error);
    noticeNode.classList.add("visible");
    toastTimer = setTimeout(() => {
      noticeNode.classList.remove("visible");
      noticeNode.textContent = "";
    }, 3500);
  }

  function failure(error, fallback) {
    return error instanceof Error && error.message ? `${fallback}：${error.message}` : fallback;
  }

  function assertSuccess(value) {
    if (value === false || (value && typeof value === "object" && value.ok === false)) {
      throw new Error(value?.error || value?.message || "操作未完成");
    }
  }

  function setBusy(value) {
    busy = value;
    searchNode.disabled = value;
    confirmNode.disabled = value;
    updateClearButton();
    listNode.querySelectorAll("button, textarea").forEach((control) => { control.disabled = value; });
  }

  function updateClearButton() {
    clearButton.disabled = !available && !demo || busy || confirmNode.value !== "清空";
  }

  function normalizedRows(result) {
    const rows = Array.isArray(result) ? result : result?.items;
    if (!Array.isArray(rows)) throw new Error("记忆列表格式不正确");
    return rows.map((row) => {
      if (!row || (typeof row.key !== "string" && typeof row.key !== "number") || !String(row.key).trim() || typeof row.text !== "string") {
        throw new Error("记忆条目格式不正确");
      }
      return row;
    });
  }

  function timeLabel(raw) {
    if (raw === undefined || raw === null || raw === "") return "";
    if (typeof raw === "number") {
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN");
    }
    return String(raw);
  }

  function button(label, className, action) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    el.addEventListener("click", action);
    return el;
  }

  function render() {
    listNode.replaceChildren();
    const query = searchNode.value.trim();
    countNode.textContent = `${items.length} 条${query ? "搜索结果" : "记忆"}${demo ? " · 演示" : ""}`;
    stateNode.hidden = items.length > 0;
    listNode.hidden = !items.length;
    if (!items.length) {
      stateNode.textContent = query ? "没有找到相关记忆" : "她还没有记住什么";
      return;
    }
    for (const row of items) {
      const li = document.createElement("li");
      li.className = "memory-card";
      li.dataset.key = String(row.key);
      const content = document.createElement("div");
      content.className = "memory-content";
      const text = document.createElement("p");
      text.className = "memory-text";
      // 属性名不能丢：只显示“雨天”看不出这是“喜欢”，也无法判断该改哪一条。
      text.textContent = row.key ? `${row.key}：${row.text}` : row.text;
      content.append(text);
      const meta = document.createElement("div");
      meta.className = "memory-meta";
      const timestamp = timeLabel(row.time ?? row.createdAt ?? row.t);
      if (timestamp) {
        const date = document.createElement("span");
        date.textContent = timestamp;
        meta.append(date);
      }
      if (demo) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "演示";
        meta.append(badge);
      }
      if (meta.childElementCount) content.append(meta);
      li.append(content);
      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.append(
        button("改", "quiet", () => editRow(row, li)),
        button("忘掉", "quiet forget", () => confirmForget(row, li)),
      );
      li.append(actions);
      listNode.append(li);
    }
  }

  async function refresh() {
    if (!available && !demo) return;
    const id = ++requestId;
    const query = searchNode.value.trim();
    editingKey = null;
    forgettingKey = null;
    stateNode.hidden = false;
    stateNode.textContent = "正在读取记忆…";
    listNode.hidden = true;
    try {
      const result = demo
        ? demoItems.filter((row) => row.text.includes(query))
        : await host.list({ query, limit: 200 });
      if (id !== requestId) return;
      items = normalizedRows(result);
      render();
      return true;
    } catch (error) {
      if (id !== requestId) return;
      items = [];
      listNode.replaceChildren();
      listNode.hidden = true;
      countNode.textContent = "读取失败";
      stateNode.hidden = false;
      stateNode.textContent = failure(error, "无法读取记忆，请稍后重试或修改搜索词重试");
      notify("读取记忆失败", true);
      return false;
    }
  }

  function editRow(row, originalLi) {
    if (busy) return;
    const hadActiveRow = editingKey !== null || forgettingKey !== null;
    if (hadActiveRow) render();
    const li = hadActiveRow ? [...listNode.children].find((node) => node.dataset.key === String(row.key)) : originalLi;
    if (!li) return;
    editingKey = row.key;
    const content = li.querySelector(".memory-content");
    const actions = li.querySelector(".row-actions");
    const field = document.createElement("textarea");
    field.className = "edit-field";
    field.setAttribute("aria-label", "纠正记忆内容");
    field.rows = 2;
    field.value = row.text;
    content.querySelector(".memory-text").replaceWith(field);
    actions.replaceChildren();
    const save = async () => {
      const text = field.value.trim();
      if (!text) { notify("记忆内容不能为空", true); field.focus(); return; }
      if (text === row.text) { editingKey = null; render(); return; }
      setBusy(true);
      try {
        if (demo) row.text = text;
        else assertSuccess(await host.correct({ key: row.key, text }));
        editingKey = null;
        if (await refresh()) notify(demo ? "演示记忆已修改（不会保存）" : "记忆已纠正");
      } catch (error) {
        notify(failure(error, "纠正失败，请重试"), true);
        field.focus();
      } finally { setBusy(false); }
    };
    actions.append(
      button("保存", "primary", save),
      button("取消", "quiet", () => { editingKey = null; render(); listNode.querySelector(`[data-key="${CSS.escape(String(row.key))}"] .quiet`)?.focus(); }),
    );
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); editingKey = null; render(); listNode.querySelector(`[data-key="${CSS.escape(String(row.key))}"] .quiet`)?.focus(); }
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); save(); }
    });
    field.focus();
    field.select();
  }

  function confirmForget(row, originalLi) {
    if (busy) return;
    const hadActiveRow = editingKey !== null || forgettingKey !== null;
    if (hadActiveRow) render();
    const li = hadActiveRow ? [...listNode.children].find((node) => node.dataset.key === String(row.key)) : originalLi;
    if (!li) return;
    forgettingKey = row.key;
    const actions = li.querySelector(".row-actions");
    const prompt = document.createElement("span");
    prompt.className = "confirm-prompt";
    prompt.textContent = "确定忘掉这条？";
    const yes = button("确认忘掉", "danger", async () => {
      setBusy(true);
      try {
        if (demo) demoItems.splice(demoItems.indexOf(row), 1);
        else assertSuccess(await host.forget(row.key));
        forgettingKey = null;
        if (await refresh()) notify(demo ? "演示记忆已移除（不会保存）" : "已忘掉这条记忆");
      } catch (error) {
        notify(failure(error, "删除失败，请重试"), true);
        yes.focus();
      } finally { setBusy(false); }
    });
    actions.replaceChildren(prompt, yes, button("取消", "quiet", () => {
      forgettingKey = null;
      render();
      listNode.querySelector(".forget")?.focus();
    }));
    yes.focus();
  }

  searchNode.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 220);
  });
  confirmNode.addEventListener("input", updateClearButton);
  clearButton.addEventListener("click", async () => {
    if (busy || confirmNode.value !== "清空" || !available && !demo) return;
    setBusy(true);
    try {
      if (demo) demoItems.length = 0;
      else assertSuccess(await host.clearAll({ confirm: true }));
      confirmNode.value = "";
      searchNode.value = "";
      if (await refresh()) notify(demo ? "演示记忆已清空（不会保存）" : "全部记忆已清空");
    } catch (error) {
      notify(failure(error, "清空失败，请重试"), true);
    } finally { setBusy(false); }
  });

  if (!available && !demo) {
    countNode.textContent = "不可用";
    stateNode.textContent = "请在应用内打开";
    searchNode.disabled = true;
    confirmNode.disabled = true;
  } else {
    refresh();
  }
})();
