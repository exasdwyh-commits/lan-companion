const $ = (selector) => document.querySelector(selector);
const fileInput = $('#references');
let selectedFiles = [];

function dimensions() {
  const ratio = $('#ratio').value;
  return ratio === 'landscape' ? [1024, 576] : ratio === 'square' ? [768, 768] : [576, 1024];
}

function updateMode() {
  const mode = $('#mode').value;
  const help = $('#upload-help');
  if (mode === 'text') {
    selectedFiles = [];
    fileInput.value = '';
    fileInput.multiple = true;
    help.textContent = '当前文生视频不需要图片';
    $('#upload-box').classList.add('disabled');
  } else {
    fileInput.multiple = true;
    help.textContent = mode === 'first_last' ? '上传 1 张首帧，可选第 2 张尾帧' : '最多 9 张，顺序即模型参考顺序';
    $('#upload-box').classList.remove('disabled');
  }
  renderFiles();
}

function renderFiles() {
  $('#file-list').innerHTML = selectedFiles.map((file, i) => `<span class="file-pill">${i + 1}. ${escapeHtml(file.name)}</span>`).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

fileInput.addEventListener('change', () => {
  const max = $('#mode').value === 'first_last' ? 2 : 9;
  selectedFiles = [...fileInput.files].slice(0, max);
  renderFiles();
});
$('#mode').addEventListener('change', updateMode);

async function encodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { name: file.name, mime: file.type, data: btoa(binary) };
}

$('#job-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const mode = $('#mode').value;
  if (mode === 'first_last' && selectedFiles.length < 1) return showNotice('首帧模式至少需要一张图片。');
  if (mode === 'references' && selectedFiles.length < 1) return showNotice('参考图模式至少需要一张图片。');
  const button = $('.primary');
  button.disabled = true;
  showNotice('正在提交任务…');
  try {
    const [width, height] = dimensions();
    const payload = {
      prompt: $('#prompt').value,
      settings: { mode, preset: $('#preset').value, width, height,
        seconds: Number($('#seconds').value), seed: $('#seed').value ? Number($('#seed').value) : undefined,
        int8_row_fc2: $('#int8').checked },
      inputs: mode === 'text' ? [] : await Promise.all(selectedFiles.map(encodeFile)),
    };
    const response = await fetch('/api/jobs', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '无法提交任务');
    showNotice('任务已加入本地队列。');
    $('#prompt').value = '';
    refreshJobs();
  } catch (error) { showNotice(error.message); }
  finally { button.disabled = false; }
});

function showNotice(message) { $('#notice').textContent = message; }

async function post(url) {
  const response = await fetch(url, {method: 'POST'});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
}

async function refreshJobs() {
  const [jobResponse, statusResponse] = await Promise.all([fetch('/api/jobs'), fetch('/api/status')]);
  const jobs = await jobResponse.json();
  const status = await statusResponse.json();
  const state = $('.engine-state');
  const ready = status.engine_ready && status.model_ready;
  state.classList.toggle('ready', ready);
  state.classList.toggle('error', !ready);
  $('#engine-status').textContent = ready ? `本地引擎就绪 · 队列 ${status.queue_size}` : '需要配置 h3.c 引擎与模型';
  $('#job-count').textContent = jobs.length;
  $('#empty-state').hidden = jobs.length > 0;
  $('#jobs').innerHTML = jobs.map((job) => {
    const buttons = ['queued','running'].includes(job.status)
      ? `<button data-action="cancel" data-id="${job.id}">取消</button>`
      : ['failed','cancelled'].includes(job.status) ? `<button data-action="retry" data-id="${job.id}">重试</button>` : '';
    const video = job.video_url ? `<video controls preload="metadata" src="${job.video_url}"></video>` : '';
    const log = job.log ? `<pre class="job-log">${escapeHtml(job.log)}</pre>` : '';
    const err = job.error ? `<pre class="job-log">${escapeHtml(job.error)}</pre>` : '';
    return `<article class="job"><div class="job-head"><span>${new Date(job.created_at).toLocaleString()}</span><span class="job-status ${job.status}">${job.status}</span></div><p class="job-prompt">${escapeHtml(job.prompt)}</p>${video}<div class="job-meta">${job.settings.width}×${job.settings.height} · ${job.settings.seconds}s · ${job.settings.preset} · seed ${job.settings.seed}</div>${log}${err}<div class="job-actions">${buttons}</div></article>`;
  }).join('');
}

$('#jobs').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  await post(`/api/jobs/${button.dataset.id}/${button.dataset.action}`);
  refreshJobs();
});

updateMode();
refreshJobs();
setInterval(refreshJobs, 2500);
