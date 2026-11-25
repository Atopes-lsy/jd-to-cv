export const PROVIDERS = { deepseek: 'https://api.deepseek.com/chat/completions', openai: 'https://api.openai.com/v1/chat/completions' };
export const MAX_DAILY_UNITS = 20; // 20 * CNY 0.25 reservations = CNY 5.
export const RESERVATION_YUAN = 0.25;
export const EVENTS = ['extract_success', 'profile_extract_success', 'resume_success', 'print_opened', 'source_exported'];
export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function dayKey(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
export function validate(body, prompts) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('请求格式错误。');
  const operation = body.operation;
  if (!['test', 'extract', 'profile', 'resume'].includes(operation)) throw new AppError('不支持的操作。');
  if (!['sponsored', 'byok'].includes(body.mode)) throw new AppError('请选择使用方式。');
  for (const field of ['text', 'profile', 'image']) if (body[field] !== undefined && typeof body[field] !== 'string') throw new AppError('输入字段格式错误。');
  const text = body.text || '', profile = body.profile || '', image = body.image || '';
  if (new TextEncoder().encode(text + profile + JSON.stringify(prompts)).length > 50000) throw new AppError('文字资料过长，请精简后重试。');
  if (['extract', 'profile'].includes(operation) && !text.trim() && !image) throw new AppError('请提供截图或文字。');
  if (operation === 'resume' && (!text.trim() || !profile.trim())) throw new AppError('请先提供岗位和个人资料。');
  if (image && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 2000000)) throw new AppError('图片格式或大小不符合要求。');
  if (!['extract', 'profile'].includes(operation) && image) throw new AppError('此操作不接收图片。');
  if (body.mode === 'byok') {
    if (!PROVIDERS[body.provider]) throw new AppError('不支持的服务商。');
    if (typeof body.key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(body.key)) throw new AppError('API Key 格式不正确。');
    if (typeof body.model !== 'string' || !/^[\w.\-:/]{1,100}$/.test(body.model)) throw new AppError('模型名称格式不正确。');
  }
  return { operation, text, profile, image };
}
export function validateResult(result, operation) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new AppError('模型返回格式不正确，请重试。', 502);
  const strings = keys => keys.forEach(k => { if (typeof result[k] !== 'string') throw new AppError('模型缺少必需字段，请重试。', 502); });
  const array = (v, max = 40) => Array.isArray(v) && v.length <= max;
  const strArray = v => array(v) && v.every(x => typeof x === 'string');
  if (operation === 'profile') {
    strings(['profile_text']);
    if (!result.profile_text.trim() || !strArray(result.notes)) throw new AppError('个人资料识别结果不完整，请换用清晰图片。', 502);
  } else if (operation === 'extract') {
    strings(['company', 'title', 'location', 'direction', 'raw_text']);
    if (!result.raw_text.trim() || !strArray(result.tags) || !array(result.requirements) || !result.requirements.every(x => x && typeof x.text === 'string' && typeof x.source_quote === 'string' && ['hard', 'preferred', 'responsibility'].includes(x.type))) throw new AppError('岗位识别结果不完整，请改用清晰截图或粘贴文字。', 502);
  } else {
    strings(['name', 'headline', 'contact']);
    if (!strArray(result.education) || !strArray(result.skills) || !strArray(result.notes) || !array(result.projects, 3) || !result.projects.every(x => x && ['name', 'role', 'period', 'evidence'].every(k => typeof x[k] === 'string') && strArray(x.bullets) && x.bullets.length <= 4)) throw new AppError('简历结构不完整，请精简资料后重试。', 502);
  }
  return result;
}
export async function callModel(body, prompts, sponsoredKey, transport = fetch) {
  const { operation, text, profile, image } = validate(body, prompts);
  const provider = body.mode === 'sponsored' ? 'deepseek' : body.provider;
  const key = body.mode === 'sponsored' ? sponsoredKey : body.key;
  if (!key) throw new AppError('平台内测尚未开启，可使用自己的 Key。', 503);
  const model = body.mode === 'sponsored' ? 'deepseek-flash' : body.model;
  let content = operation === 'test' ? '只回复 OK。' : ['extract', 'profile'].includes(operation) ? text || '准确转写图片中的资料。' : JSON.stringify({ jd: text, personal_evidence: profile });
  if (image) content = [{ type: 'text', text: content }, { type: 'image_url', image_url: { url: image, detail: 'high' } }];
  const payload = { model, messages: [{ role: 'system', content: operation === 'test' ? '连接测试。' : prompts[operation] }, { role: 'user', content }], max_tokens: operation === 'test' ? 8 : 4096 };
  if (provider === 'deepseek') payload.thinking = { type: 'disabled' };
  if (operation !== 'test') payload.response_format = { type: 'json_object' };
  let response;
  try { response = await transport(PROVIDERS[provider], { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(90000) }); }
  catch { throw new AppError('模型服务连接超时或不可达，请稍后重试。', 502); }
  if (!response.ok) {
    const messages = { 401: 'API Key 无效或已失效。', 402: '模型账户余额不足。', 403: '模型服务拒绝访问，请检查账户权限。', 429: '模型服务限流，请稍后重试。' };
    throw new AppError(messages[response.status] || '模型服务返回错误，请检查模型名称或视觉支持。', 502);
  }
  let data;
  try { const bytes = await response.text(); if (new TextEncoder().encode(bytes).length > 400000) throw new Error(); data = JSON.parse(bytes); }
  catch { throw new AppError('模型返回数据无法解析。', 502); }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') throw new AppError('模型输出被截断，请精简资料后重试。', 502);
  if (operation === 'test') { if (!choice?.message?.content) throw new AppError('模型没有返回内容。', 502); return { result: { connected: true } }; }
  let result;
  try { result = JSON.parse(choice.message.content); } catch { throw new AppError('模型未返回有效 JSON，请重试。', 502); }
  return { result: validateResult(result, operation) };
}
export async function reserve(db, day = dayKey()) {
  await db.prepare('INSERT INTO daily_budget(day,units) VALUES (?,0) ON CONFLICT(day) DO NOTHING').bind(day).run();
  const row = await db.prepare('UPDATE daily_budget SET units=units+1 WHERE day=? AND units<? RETURNING units').bind(day, MAX_DAILY_UNITS).first();
  if (!row) throw new AppError('今天的内测额度已用完，可明天再试或使用自己的 API Key。', 429);
  return row.units;
}
