const $ = (id) => document.getElementById(id);
const state = { image: null, profileImage: null, current: null, requirements: [], busy: false, demo: false, config: null, meta: {}, sourceText: '', resumeBinding: null };
const storage = new Promise((resolve, reject) => {
  const request = indexedDB.open('jd-to-cv', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('records');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('浏览器未允许本地存储，请使用普通浏览窗口。'));
});
async function read(key) {
  const db = await storage;
  return new Promise((resolve, reject) => {
    const r = db.transaction('records').objectStore('records').get(key);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function write(key, value) {
  const db = await storage;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(new Error('本地保存失败，存储空间可能不足。请先导出备份。'));
  });
}
async function mutate(key, update) {
  const db = await storage;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records'), request = store.get(key); let value, failure;
    request.onsuccess = () => { try { value = update(request.result); if (new TextEncoder().encode(JSON.stringify(value)).length > 20 * 1024 * 1024) throw new Error('岗位库已接近 20 MB 上限。请先导出备份，再移除不需要的岗位。'); store.put(value, key); } catch (e) { failure = e; tx.abort(); } };
    tx.oncomplete = () => resolve(value); tx.onabort = tx.onerror = () => reject(failure || new Error('本地保存失败，请导出备份后重试。'));
  });
}
function clearResume() { state.resumeBinding = null; $('resume-paper').replaceChildren(); $('resume-paper').hidden = true; $('resume-empty').hidden = false; $('resume-notes').hidden = true; $('print').disabled = true; $('export-html').disabled = true; }
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; }
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); }
function guard(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(e => notice(e.message || '操作失败，请重试。', true)); }
function page(id) {
  document.querySelectorAll('.page').forEach(x => x.hidden = x.id !== id);
  document.querySelectorAll('.nav').forEach(x => x.classList.toggle('active', x.dataset.page === id));
  if (id === 'library') guard(renderLibrary)();
  window.scrollTo({ top: 0 });
}
function busy(value, message) {
  state.busy = value;
  ['extract', 'generate', 'archive', 'example', 'new-job', 'test-api', 'settings-open', 'remove-image', 'image-file', 'jd-text', 'company', 'job-title', 'tags', 'save-profile', 'profile-file', 'profile-recognize', 'profile-remove-image'].forEach(id => $(id).disabled = value);
  $('profile-recognize').disabled = value || !state.profileImage;
  if (message) notice(message);
}
async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(110000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。');
  return data;
}
function credentials() {
  if ($('mode').value === 'sponsored') return { mode: 'sponsored' };
  const key = $('api-key').value.trim(), model = $('model').value.trim();
  if (!key || !model) { $('settings').showModal(); throw new Error('请先填写 API Key 和模型名称。'); }
  return { mode: 'byok', provider: $('provider').value, key, model };
}
async function event(name) {
  if (!$('analytics').checked) return;
  try { await api('/api/event', { event: name, consent: true }); } catch { /* Never block product usage for telemetry. */ }
}
function renderRequirements() {
  $('requirements').replaceChildren();
  if (!state.requirements.length) { const p = document.createElement('p'); p.className = 'empty-hint'; p.textContent = '核对上方原文后，可收藏岗位或生成简历。'; $('requirements').append(p); }
  for (const item of state.requirements) {
    const row = document.createElement('div'); row.className = 'requirement';
    const badge = document.createElement('span'); badge.textContent = ({ hard: '必要', preferred: '加分', responsibility: '职责' })[item.type] || '要求';
    const text = document.createElement('div'); text.textContent = item.text; row.append(badge, text); $('requirements').append(row);
  }
}
function applyJob(record) {
  clearResume();
  state.demo = false; state.image = record.image || null; state.requirements = record.requirements || [];
  state.meta = { location: record.location || '', direction: record.direction || '' }; state.sourceText = record.original_text || record.raw_text || '';
  $('jd-text').value = record.raw_text || ''; $('company').value = record.company || ''; $('job-title').value = record.title || ''; $('tags').value = (record.tags || []).join(', ');
  showImage(); renderRequirements();
}
function showImage() {
  $('image-preview').hidden = !state.image; $('dropzone').hidden = !!state.image;
  $('screenshot').src = state.image?.data || ''; $('screenshot').style.maxWidth = '100%'; $('screenshot').style.maxHeight = '260px'; $('screenshot').style.objectFit = 'contain';
}
async function decodeImage(file) {
  if (state.busy) throw new Error('正在处理，请稍后再替换截图。');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024 || !file.size) throw new Error('请选择不超过 8 MB 的 PNG、JPG 或 WebP 图片。');
  const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('图片读取失败')); r.readAsDataURL(file); });
  const image = new Image(); image.src = data; await image.decode();
  if (image.naturalWidth * image.naturalHeight > 40_000_000 || !image.naturalWidth) throw new Error('图片尺寸过大，请分成多张截图。');
  const scale = Math.min(1, 2500 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = { name: file.name, data, requestData: canvas.toDataURL('image/jpeg', .86) };
  if (result.requestData.length > 2_000_000) throw new Error('截图内容过大，请裁剪后重试。');
  return result;
}
async function loadImage(file) {
  state.image = await decodeImage(file);
  state.current = null; state.demo = false; state.requirements = []; state.meta = {}; state.sourceText = ''; $('jd-text').value = ''; $('company').value = ''; $('job-title').value = ''; $('tags').value = '';
  clearResume();
  showImage(); notice('截图已就绪。点击“识别岗位要求”后才会发送给模型。');
}
async function archive(silent = false) {
  if (state.demo) throw new Error('这是虚构示例，请放入真实岗位后收藏。');
  const raw_text = $('jd-text').value.trim();
  if (!raw_text) throw new Error('请先识别截图或粘贴岗位文字。');
  const record = { raw_text, original_text: state.sourceText || raw_text, ...state.meta, company: $('company').value.trim(), title: $('job-title').value.trim(), tags: $('tags').value.split(/[,，]/).map(x => x.trim()).filter(Boolean), requirements: state.requirements, image: state.image };
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(record)));
  const fingerprint = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
  const selectedId = state.current; let job;
  const jobs = await mutate('jobs', stored => { const all = stored || []; job = selectedId ? all.find(x => x.id === selectedId) : all.find(x => x.versions.at(-1).fingerprint === fingerprint); if (!job) { if (all.length >= 100) throw new Error('已收藏 100 个岗位，请先导出备份。'); job = { id: crypto.randomUUID(), versions: [] }; all.unshift(job); } if (job.versions.at(-1)?.fingerprint !== fingerprint) { if (job.versions.length >= 100) throw new Error('该岗位已达到 100 个版本。请导出历史后使用“新岗位”继续保存。'); job.versions.push({ ...record, fingerprint, captured_at: new Date().toISOString() }); } return all; });
  state.current = job.id; $('job-count').textContent = jobs.length;
  if (!silent) notice('已收藏到当前设备的岗位知识库。');
  return job;
}
function renderResume(resume) {
  const items = arr => arr.map(x => `<li>${escape(x)}</li>`).join('');
  $('resume-paper').innerHTML = `<h1>${escape(resume.name)}</h1><p><strong>${escape(resume.headline)}</strong></p><p>${escape(resume.contact)}</p>` +
    (resume.education.length ? `<h2>教育背景</h2>${resume.education.map(x => `<p>${escape(x)}</p>`).join('')}` : '') +
    (resume.skills.length ? `<h2>专业技能</h2><ul>${items(resume.skills)}</ul>` : '') +
    (resume.projects.length ? `<h2>项目经历</h2>${resume.projects.map(x => `<h3>${escape(x.name)}</h3><p>${escape(x.role)} ${escape(x.period)}</p><ul>${items(x.bullets)}</ul>`).join('')}` : '');
  $('resume-empty').hidden = true; $('resume-paper').hidden = false; $('print').disabled = false; $('export-html').disabled = false;
  $('resume-notes').innerHTML = '<strong>需要你核实</strong>' + resume.notes.map(x => `<p>${escape(x)}</p>`).join('');
  $('resume-notes').hidden = !resume.notes.length;
}
function cleanHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['H1', 'H2', 'H3', 'P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'BR', 'DIV', 'SPAN']);
  function walk(node) { if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent).replaceAll('\n', '<br>'); if (node.nodeType !== Node.ELEMENT_NODE) return ''; if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'IMG'].includes(node.tagName)) return ''; const children = [...node.childNodes].map(walk).join(''); return allowed.has(node.tagName) ? `<${node.tagName.toLowerCase()}>${children}</${node.tagName.toLowerCase()}>` : children; }
  return [...doc.body.childNodes].map(walk).join('');
}
function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function saveResume(newVersion = false, draft = null) {
  if (!state.resumeBinding || state.demo) return;
  const binding = { ...state.resumeBinding }, html = cleanHTML($('resume-paper').innerHTML);
  await mutate('jobs', jobs => { const version = jobs?.find(x => x.id === binding.jobId)?.versions.find(v => v.fingerprint === binding.fingerprint); if (!version) throw new Error('对应岗位版本不存在，简历未写入其他岗位，请先保存文字稿。'); version.resume_html = html; version.resumes ||= []; if (newVersion || !version.resumes.length) version.resumes.push({ created_at: new Date().toISOString(), html, draft }); else version.resumes.at(-1).html = html; return jobs; });
}
async function renderLibrary() {
  const jobs = (await read('jobs')) || []; const terms = $('search').value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  $('job-count').textContent = jobs.length; $('job-list').replaceChildren();
  const found = jobs.filter(x => terms.every(term => JSON.stringify(x.versions.at(-1)).toLocaleLowerCase().includes(term)));
  if (!found.length) { const p = document.createElement('p'); p.className = 'card empty-hint'; p.textContent = jobs.length ? '没有匹配岗位，试试其他关键词。' : '还没有收藏岗位。放入第一份 JD，开始积累。'; $('job-list').append(p); }
  for (const job of found) {
    const v = job.versions.at(-1), card = document.createElement('article'); card.className = 'card job-card';
    const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = v.title || '未命名岗位';
    const meta = document.createElement('p'); meta.textContent = `${v.company || '公司未填写'} · ${v.tags.join(' / ') || '暂无标签'}`;
    const date = document.createElement('p'); date.className = 'job-meta'; date.textContent = `${new Date(v.captured_at).toLocaleDateString()} · ${job.versions.length} 个版本`;
    info.append(title, meta, date); const actions = document.createElement('div'); actions.className = 'action-row';
    const open = document.createElement('button'); open.className = 'secondary'; open.textContent = '继续定制'; open.onclick = guard(async () => { if (state.busy) throw new Error('请等待当前任务完成。'); state.current = job.id; applyJob(v); if (v.resume_html) { state.resumeBinding = { jobId: job.id, fingerprint: v.fingerprint }; $('resume-paper').innerHTML = cleanHTML(v.resume_html); $('resume-paper').hidden = false; $('resume-empty').hidden = true; $('print').disabled = false; $('export-html').disabled = false; } $('resume-notes').hidden = true; page('workspace'); });
    const history = document.createElement('button'); history.className = 'quiet'; history.textContent = '导出历史'; history.onclick = () => download(`岗位-${job.id}.json`, JSON.stringify({ format: 'jd-to-cv-v1', jobs: [job] }));
    const remove = document.createElement('button'); remove.className = 'quiet'; remove.textContent = '移除'; remove.onclick = guard(async () => { if (state.busy) throw new Error('请等待当前任务完成。'); if (!window.confirm('移除此岗位及所有历史简历？这只影响当前浏览器，请先导出备份。')) return; await mutate('jobs', all => (all || []).filter(x => x.id !== job.id)); if (state.current === job.id) { state.current = null; clearResume(); } await renderLibrary(); notice('岗位已从当前浏览器移除。'); });
    actions.append(open, history, remove); card.append(info, actions); $('job-list').append(card);
  }
}

document.querySelectorAll('.file-button').forEach(label => label.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); label.querySelector('input').click(); } }));
document.querySelectorAll('[data-page]').forEach(x => x.onclick = () => page(x.dataset.page));
document.querySelectorAll('[data-goto]').forEach(x => x.onclick = () => page(x.dataset.goto));
$('settings-open').onclick = () => $('settings').showModal(); $('settings-close').onclick = () => $('settings').close();
$('mode').onchange = () => { $('byok-fields').hidden = $('mode').value !== 'byok'; $('sponsored-note').hidden = $('mode').value !== 'sponsored'; };
$('provider').onchange = () => { $('api-key').value = ''; $('model').value = $('provider').value === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini'; };
$('settings-form').onsubmit = e => { e.preventDefault(); if ($('mode').value === 'byok' && (!$('api-key').value.trim() || !$('model').value.trim())) { $('connection-status').textContent = '请填写 Key 和模型名称。'; return; } $('settings').close(); $('provider-status').textContent = $('mode').value === 'sponsored' ? '使用内测额度' : '使用自己的 API Key'; };
$('test-api').onclick = guard(async () => { $('test-api').disabled = true; $('connection-status').textContent = '正在测试，可能产生少量模型费用……'; try { await api('/api/model', { ...credentials(), operation: 'test' }); $('connection-status').textContent = '连接成功。截图识别还需要所选模型支持视觉输入。'; } catch (e) { $('connection-status').textContent = e.message; } finally { $('test-api').disabled = false; } });
$('image-file').onchange = guard(async e => { if (e.target.files[0]) await loadImage(e.target.files[0]); e.target.value = ''; });
for (const kind of ['dragenter', 'dragover']) $('dropzone').addEventListener(kind, e => { e.preventDefault(); $('dropzone').classList.add('drag-over'); });
for (const kind of ['dragleave', 'drop']) $('dropzone').addEventListener(kind, e => { e.preventDefault(); $('dropzone').classList.remove('drag-over'); });
$('dropzone').addEventListener('drop', guard(async e => { if (e.dataTransfer.files.length !== 1) throw new Error('请一次放入一张岗位截图。'); await loadImage(e.dataTransfer.files[0]); }));
$('dropzone').onkeydown = e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); $('image-file').click(); } };
$('remove-image').onclick = () => { state.image = null; state.current = null; clearResume(); showImage(); };
$('jd-text').oninput = () => { state.demo = false; state.requirements = []; renderRequirements(); clearResume(); };
for (const id of ['company', 'job-title', 'tags']) $(id).addEventListener('input', clearResume);
$('archive').onclick = guard(async () => { busy(true); try { await archive(); } finally { busy(false); } });
$('new-job').onclick = () => { state.current = null; state.meta = {}; state.sourceText = ''; state.image = null; state.requirements = []; state.demo = false; for (const id of ['jd-text', 'company', 'job-title', 'tags']) $(id).value = ''; showImage(); renderRequirements(); $('resume-paper').hidden = true; $('resume-empty').hidden = false; $('resume-notes').hidden = true; $('print').disabled = true; $('export-html').disabled = true; notice('可以放入新岗位了，已有岗位仍保存在知识库。'); };
$('extract').onclick = guard(async () => {
  const text = $('jd-text').value.trim(); if (!text && !state.image) throw new Error('先放入一张截图，或粘贴岗位文字。');
  const creds = credentials(); busy(true, '正在识别岗位，请稍候……');
  try { const { result } = await api('/api/model', { ...creds, operation: 'extract', text, image: state.image?.requestData || '' });
    state.demo = false; const image = state.image; const original_text = state.sourceText || text; applyJob({ ...result, image, original_text }); await archive(true); notice('已识别并收藏到本机。请核对岗位原文和要求，再生成简历。'); await event('extract_success');
  } finally { busy(false); }
});
$('generate').onclick = guard(async () => {
  const profile = (await read('profile')) || ''; if (!profile.trim()) { page('profile'); throw new Error('请先填写并保存个人资料。'); }
  if (!$('jd-text').value.trim()) throw new Error('请先提供岗位文字或识别截图。');
  const creds = credentials(); busy(true, '正在从你的资料中选择相关经历……');
  try { const job = await archive(true); const binding = { jobId: job.id, fingerprint: job.versions.at(-1).fingerprint }; const { result } = await api('/api/model', { ...creds, operation: 'resume', text: $('jd-text').value, profile }); renderResume(result); state.resumeBinding = binding; await saveResume(true, result); notice('简历已生成。请核实事实、贡献和日期，可直接点击正文修改。'); await event('resume_success'); }
  finally { busy(false); }
});
async function loadProfileImage(file) { state.profileImage = await decodeImage(file); $('profile-screenshot').src = state.profileImage.data; $('profile-image-preview').hidden = false; $('profile-recognize').disabled = false; $('profile-image-notes').hidden = true; notice('资料图片已就绪。点击“识别资料图片”后才会发送，识别后请核对并保存文字。'); }
$('profile-file').onchange = guard(async e => { const f = e.target.files[0]; if (!f) return; try { if (f.type.startsWith('image/')) { await loadProfileImage(f); return; } if (!/\.(txt|md)$/i.test(f.name) || f.size > 60000) throw new Error('请提供图片或不超过 60 KB 的 TXT / Markdown。'); $('profile-text').value = await f.text(); } finally { e.target.value = ''; } });
for (const kind of ['dragenter', 'dragover']) $('profile-dropzone').addEventListener(kind, e => { e.preventDefault(); $('profile-dropzone').classList.add('drag-over'); });
for (const kind of ['dragleave', 'drop']) $('profile-dropzone').addEventListener(kind, e => { e.preventDefault(); $('profile-dropzone').classList.remove('drag-over'); });
$('profile-dropzone').addEventListener('drop', guard(async e => { if (e.dataTransfer.files.length !== 1) throw new Error('请一次放入一张资料图片。'); await loadProfileImage(e.dataTransfer.files[0]); }));
$('profile-dropzone').onkeydown = e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); $('profile-file').click(); } };
$('profile-remove-image').onclick = () => { state.profileImage = null; $('profile-screenshot').src = ''; $('profile-image-preview').hidden = true; $('profile-recognize').disabled = true; $('profile-image-notes').hidden = true; };
$('profile-recognize').onclick = guard(async () => {
  if (!state.profileImage) throw new Error('请先选择个人资料图片。');
  const creds = credentials(); busy(true, '正在读取资料图片，请稍候……');
  try { const { result } = await api('/api/model', { ...creds, operation: 'profile', image: state.profileImage.requestData, text: '转写个人资料，保留疑点。' }); $('profile-text').value = [$('profile-text').value.trim(), result.profile_text].filter(Boolean).join('\n\n'); $('profile-image-notes').textContent = result.notes.join('；'); $('profile-image-notes').hidden = !result.notes.length; notice('资料已追加到下方文字，请核对后点击“保存到本机”。'); await event('profile_extract_success'); }
  finally { busy(false); }
});
$('save-profile').onclick = guard(async () => { const text = $('profile-text').value.trim(); if (new TextEncoder().encode(text).length > 35000) throw new Error('资料较长，请压缩到约一万中文字符以内。'); await write('profile', text); $('profile-status').textContent = text ? `已保存个人资料 · ${text.length} 字` : '还没有个人资料'; notice('个人资料已保存到当前浏览器。'); });
$('search').oninput = guard(renderLibrary);
$('backup').onclick = guard(async () => { download('jd-to-cv-备份.json', JSON.stringify({ format: 'jd-to-cv-v1', profile: (await read('profile')) || '', jobs: (await read('jobs')) || [] })); });
$('restore').onchange = guard(async e => {
  const f = e.target.files[0]; if (!f) return; if (f.size > 30 * 1024 * 1024) throw new Error('备份超过 30 MB，请拆分导入。');
  const data = JSON.parse(await f.text());
  if (data.format !== 'jd-to-cv-v1' || !Array.isArray(data.jobs) || data.jobs.length > 100) throw new Error('不是有效的知识库备份。');
  const jobs = (await read('jobs')) || []; if (jobs.length + data.jobs.length > 100) throw new Error('导入后超过 100 个岗位上限。');
  const incoming = [];
  for (const job of data.jobs) {
    if (!Array.isArray(job.versions) || !job.versions.length || job.versions.length > 2000) throw new Error('备份版本格式不正确，单岗位最多导入 2000 个历史版本。');
    const versions = job.versions.map(v => {
      if (typeof v.raw_text !== 'string' || !Array.isArray(v.tags) || !v.tags.every(t => typeof t === 'string') || typeof v.company !== 'string' || typeof v.title !== 'string' || !Number.isFinite(Date.parse(v.captured_at))) throw new Error('备份岗位字段不正确。');
      let image = null;
      if (v.image) { if (typeof v.image.data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.image.data) || v.image.data.length > 12_000_000) throw new Error('备份图片格式不正确。'); image = { name: String(v.image.name || '截图'), data: v.image.data, requestData: typeof v.image.requestData === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.image.requestData) ? v.image.requestData : v.image.data }; }
      return { raw_text: v.raw_text, original_text: typeof v.original_text === 'string' ? v.original_text : v.raw_text, location: typeof v.location === 'string' ? v.location : '', direction: typeof v.direction === 'string' ? v.direction : '', company: v.company, title: v.title, tags: v.tags, requirements: Array.isArray(v.requirements) ? v.requirements.filter(x => x && typeof x.text === 'string').map(x => ({ text: x.text, type: String(x.type || ''), source_quote: typeof x.source_quote === 'string' ? x.source_quote : '' })) : [], captured_at: v.captured_at, image, fingerprint: String(v.fingerprint || ''), resume_html: cleanHTML(v.resume_html || ''), resumes: Array.isArray(v.resumes) ? v.resumes.filter(r => r && typeof r.html === 'string').map(r => ({ created_at: String(r.created_at || ''), html: cleanHTML(r.html), draft: r.draft && typeof r.draft === 'object' ? r.draft : null })) : [] };
    }); incoming.push({ id: crypto.randomUUID(), versions });
  }
  await mutate('jobs', existing => { const all = existing || []; if (all.length + incoming.length > 100) throw new Error('导入后超过 100 个岗位上限。'); return [...incoming, ...all]; });
  if (typeof data.profile === 'string' && !(await read('profile'))) { await write('profile', data.profile.slice(0, 35000)); $('profile-text').value = data.profile.slice(0, 35000); $('profile-status').textContent = '已导入个人资料'; }
  await renderLibrary(); notice('备份已导入为独立岗位，原有记录未覆盖。'); e.target.value = '';
});
$('resume-paper').addEventListener('paste', e => { e.preventDefault(); const text = e.clipboardData.getData('text/plain'); const selection = window.getSelection(); if (!selection.rangeCount) return; const range = selection.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); });
$('resume-paper').addEventListener('blur', guard(() => saveResume()));
$('print').onclick = guard(async () => { await saveResume(); document.getElementById('print-resume')?.remove(); const sheet = document.createElement('article'); sheet.id = 'print-resume'; sheet.hidden = true; sheet.innerHTML = cleanHTML($('resume-paper').innerHTML); document.body.append(sheet); sheet.hidden = false; window.print(); sheet.hidden = true; await event('print_opened'); });
$('export-html').onclick = guard(async () => { await saveResume(); const css = await (await fetch('/style.css')).text(); const content = cleanHTML($('resume-paper').innerHTML); download('简历-可编辑稿.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>简历</title><style>${css}\nbody{background:white;max-width:210mm;margin:0 auto;padding:13mm}#resume-paper{border:0;padding:0}</style><article id="resume-paper" contenteditable="true">${content}</article></html>`, 'text/html'); await event('source_exported'); });
$('analytics').onchange = guard(async () => { await write('analytics', $('analytics').checked); notice($('analytics').checked ? '已开启匿名汇总统计，不附带个人资料。' : '已关闭匿名使用统计。'); });
$('send-feedback').onclick = guard(async () => { if (!$('feedback-consent').checked) throw new Error('提交前请勾选本次反馈授权。'); await api('/api/feedback', { consent: true, rating: Number($('rating').value), text: $('feedback-text').value.trim() }); $('feedback-text').value = ''; $('feedback-consent').checked = false; notice(state.config?.desktop ? '反馈已保存到本机。' : '反馈已提交，谢谢你帮助改进工具。'); });
$('example').onclick = () => {
  state.current = null; state.demo = true; state.image = null; showImage(); $('jd-text').value = '【虚构示例】前端开发实习：熟悉 React、JavaScript，了解 TypeScript 优先；参与业务页面开发。'; $('company').value = '示例公司（虚构）'; $('job-title').value = '前端开发实习'; $('tags').value = 'React, JavaScript, TypeScript'; state.requirements = [{ type: 'hard', text: '熟悉 React、JavaScript' }, { type: 'preferred', text: '了解 TypeScript' }]; renderRequirements();
  renderResume({ name: '示例同学', headline: '前端开发实习', contact: '联系方式由本人填写', education: ['示例大学 · 计算机相关专业 · 本科在读'], skills: ['React、JavaScript、TypeScript；组件开发与接口联调'], projects: [{ name: '校园活动平台（虚构示例）', role: '参与前端开发', period: '项目日期由本人填写', bullets: ['拆分活动列表、详情与报名表单组件，处理加载、空数据和请求错误状态。', '对照接口字段完成报名流程联调，保留问题记录和修复验证。'] }], notes: ['这是虚构示例，未调用模型、未保存到知识库。请替换为你的真实资料和岗位。'] }); notice('正在查看虚构示例。你可以体验正文编辑与打印；真实生成请先完善个人资料。');
};

guard(async () => {
  $('profile-text').placeholder = $('profile-text').placeholder.replaceAll('\\n', '\n');
  $('profile-text').value = (await read('profile')) || ''; $('profile-status').textContent = $('profile-text').value ? `已保存个人资料 · ${$('profile-text').value.length} 字` : '还没有个人资料'; $('analytics').checked = (await read('analytics')) === true;
  $('job-count').textContent = ((await read('jobs')) || []).length;
  try { state.config = await (await fetch('/api/config')).json(); $('provider-status').textContent = state.config.sponsored ? '内测额度可用' : '内测待开启 · 可使用自己的 Key'; if (state.config.desktop) { $('send-feedback').textContent = '保存反馈到本机'; $('feedback-consent').parentElement.lastChild.textContent = '我同意将本次评分与反馈保存到本机。'; const p = document.createElement('p'); p.className = 'caption'; p.textContent = '本地桌面模式：统计与反馈只存放在本机，不会发送给项目维护者。'; $('feedback').querySelector('article').prepend(p); } if (state.config.test_fixture) { document.querySelector('header .pill').textContent = '合成测试预览'; notice('当前预览使用合成模型，不会调用真实 API 或产生模型费用。'); } }
  catch { $('provider-status').textContent = '服务暂不可用，请稍后重试'; }
})();
