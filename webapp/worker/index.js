import { AppError, EVENTS, callModel, dayKey, reserve, validate } from './service.js';
const ASSETS = __ASSETS__;
const PROMPTS = __PROMPTS__;
const security = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
const json = (data, status = 200) => Response.json(data, { status, headers: security });
async function bodyJSON(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new AppError('仅接收 JSON 请求。', 415);
  if (Number(request.headers.get('content-length')) > 2300000) throw new AppError('上传内容过大。', 413);
  const reader = request.body?.getReader(); if (!reader) throw new AppError('缺少请求内容。');
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2300000) { await reader.cancel(); throw new AppError('上传内容过大。', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AppError('JSON 格式错误。'); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/config') return json({ sponsored: Boolean(env.DEEPSEEK_API_KEY && env.DB), daily_budget_yuan: 5, feedback: Boolean(env.DB), provider: 'DeepSeek Flash' });
      if (request.method === 'GET' && ASSETS[url.pathname]) { const a = ASSETS[url.pathname]; return new Response(a.body, { headers: { ...security, 'Content-Type': a.type } }); }
      if (request.method !== 'POST' || !url.pathname.startsWith('/api/')) return json({ error: '未找到此资源。' }, 404);
      if (request.headers.get('origin') !== url.origin) throw new AppError('请求来源不正确。', 403);
      const body = await bodyJSON(request);
      if (url.pathname === '/api/model') {
        validate(body, PROMPTS);
        if (body.mode === 'sponsored') { if (!env.DEEPSEEK_API_KEY || !env.DB) throw new AppError('内测尚未开启，可使用自己的 API Key。', 503); await reserve(env.DB); }
        return json(await callModel(body, PROMPTS, env.DEEPSEEK_API_KEY));
      }
      if (url.pathname === '/api/event') {
        if (body.consent !== true || !EVENTS.includes(body.event) || Object.keys(body).some(x => !['event', 'consent'].includes(x))) throw new AppError('统计请求缺少授权或包含额外数据。');
        if (!env.DB) throw new AppError('统计服务尚未开启。', 503);
        await env.DB.prepare('INSERT INTO analytics(day,event,count) VALUES (?,?,1) ON CONFLICT(day,event) DO UPDATE SET count=MIN(count+1,10000)').bind(dayKey(), body.event).run();
        return json({ saved: true });
      }
      if (url.pathname === '/api/feedback') {
        if (body.consent !== true || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 || typeof body.text !== 'string' || body.text.length > 1000 || Object.keys(body).some(x => !['consent', 'rating', 'text'].includes(x))) throw new AppError('请授权并提交有效评分，文字最多 1000 字。');
        if (/\b(?:sk-|ghp_|gho_)[a-zA-Z0-9_-]{8,}/.test(body.text)) throw new AppError('反馈疑似包含密钥，请移除后再提交。');
        if (!env.DB) throw new AppError('反馈服务尚未开启。', 503);
        const result = await env.DB.prepare('INSERT INTO feedback(day,rating,text) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM feedback WHERE day=?)<100').bind(dayKey(), body.rating, body.text, dayKey()).run();
        if (!result.meta.changes) throw new AppError('今日反馈已达上限，请稍后再试。', 429);
        return json({ saved: true });
      }
      return json({ error: '未找到此接口。' }, 404);
    } catch (error) { return json({ error: error instanceof AppError ? error.message : '服务暂时不可用，请稍后重试。' }, error instanceof AppError ? error.status : 500); }
  }
};
