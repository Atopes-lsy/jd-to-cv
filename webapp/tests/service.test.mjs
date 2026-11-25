import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AppError, callModel, dayKey, reserve, validate } from '../worker/service.js';
import worker from '../dist/server/index.js';
const prompts = JSON.parse(readFileSync(new URL('../prompts.json', import.meta.url)));
const jd = { company: '虚构甲', title: '前端实习', location: '', direction: '前端', raw_text: '熟悉 React', tags: ['React'], requirements: [{ text: '熟悉 React', type: 'hard', source_quote: '熟悉 React' }] };
const own = { mode: 'byok', provider: 'deepseek', model: 'deepseek-flash', key: 'synthetic-test-key', operation: 'extract', text: 'React' };
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_pilot.sql', import.meta.url), 'utf8'));
  const adapter = { prepare(sql) { return { bind(...args) { return { async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; }, async first() { return sqlite.prepare(sql).get(...args) || null; } }; } }; } };
  return { sqlite, adapter };
}
function request(path, body, origin = 'https://test.invalid') { return new Request('https://test.invalid' + path, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }); }
test('Beijing budget day changes at local midnight', () => {
  assert.equal(dayKey(Date.parse('2026-11-25T15:59:59Z')), '2026-11-25');
  assert.equal(dayKey(Date.parse('2026-11-25T16:00:00Z')), '2026-11-26');
});
test('atomic budget reservations stop at 20 attempts', async () => {
  const { sqlite, adapter } = database();
  const results = await Promise.allSettled(Array.from({ length: 80 }, () => reserve(adapter, '2026-11-25')));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 20);
  assert.equal(sqlite.prepare('SELECT units FROM daily_budget').get().units, 20);
  assert.equal(await reserve(adapter, '2026-11-26'), 1); sqlite.close();
});
test('invalid inputs are rejected before any provider call', () => {
  for (const body of [null, [], { ...own, provider: 'http://127.0.0.1' }, { ...own, text: 123 }, { ...own, key: 'key\ninvalid' }, { ...own, text: '中'.repeat(18000) }, { ...own, image: 'https://internal.invalid' }, { ...own, operation: 'arbitrary' }]) assert.throws(() => validate(body, prompts), AppError);
});
test('provider receives bounded JSON request and no redirects; user metadata not echoed', async () => {
  const result = await callModel(own, prompts, '', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); assert.equal(body.max_tokens, 4096); assert.equal(body.thinking.type, 'disabled');
    assert.equal(body.response_format.type, 'json_object');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(jd) } }] });
  });
  assert.equal(result.result.raw_text, jd.raw_text); assert.ok(!JSON.stringify(result).includes(own.key));
});
test('provider error bodies and credential echoes are never returned', async () => {
  await assert.rejects(callModel(own, prompts, '', async () => new Response(own.key, { status: 401 })), e => !e.message.includes(own.key) && e.status === 502);
  await assert.rejects(callModel(own, prompts, '', async () => { throw new Error(own.key); }), e => !e.message.includes(own.key));
});
test('truncated, malformed and invalid-schema outputs fail closed', async () => {
  for (const choice of [{ finish_reason: 'length', message: { content: '{}' } }, { message: { content: 'not JSON' } }, { message: { content: '{}' } }]) await assert.rejects(callModel(own, prompts, '', async () => Response.json({ choices: [choice] })), AppError);
});
test('sponsored mode cannot change provider or model', async () => {
  await callModel({ ...own, mode: 'sponsored', provider: 'openai', model: 'expensive-model' }, prompts, 'operator-fixture', async (url, options) => { assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(JSON.parse(options.body).model, 'deepseek-flash'); return Response.json({ choices: [{ message: { content: JSON.stringify(jd) } }] }); });
});
test('profile images use the bounded vision route and preserve uncertainty notes', async () => {
  const result = await callModel({ ...own, operation: 'profile', image: 'data:image/jpeg;base64,YQ==' }, prompts, '', async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages[1].content[1].type, 'image_url');
    assert.match(body.messages[0].content, /不猜测/);
    assert.equal(body.max_tokens, 4096);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ profile_text: '测试同学，日期待核对', notes: ['日期不清晰'] }) } }] });
  });
  assert.equal(result.result.notes[0], '日期不清晰');
  await assert.rejects(callModel({ ...own, operation: 'profile' }, prompts, '', async () => Response.json({ choices: [{ message: { content: '{"profile_text":"invented"}' } }] })), AppError);
});
test('Worker serves actual UI without login and does not expose secret', async () => {
  const result = await worker.fetch(new Request('https://test.invalid/'), {}); assert.equal(result.status, 200); assert.match(await result.text(), /岗位知识库/);
  const config = await worker.fetch(new Request('https://test.invalid/api/config'), { DEEPSEEK_API_KEY: 'operator-fixture', DB: {} }); assert.ok(!(await config.text()).includes('operator-fixture'));
});
test('CSRF, unknown routes and content types are rejected', async () => {
  assert.equal((await worker.fetch(request('/api/model', own, 'https://evil.invalid'), {})).status, 403);
  assert.equal((await worker.fetch(new Request('https://test.invalid/../private-file'), {})).status, 404);
  assert.equal((await worker.fetch(new Request('https://test.invalid/api/model', { method: 'POST', headers: { origin: 'https://test.invalid' }, body: 'test' }), {})).status, 415);
});
test('telemetry requires affirmative consent and excludes additional personal fields', async () => {
  const { sqlite, adapter } = database();
  for (const data of [{ event: 'resume_success' }, { event: 'resume_success', consent: false }, { event: 'resume_success', consent: true, profile: 'private' }]) assert.equal((await worker.fetch(request('/api/event', data), { DB: adapter })).status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM analytics').get().n, 0);
  assert.equal((await worker.fetch(request('/api/event', { event: 'resume_success', consent: true }), { DB: adapter })).status, 200);
  const row = sqlite.prepare('SELECT * FROM analytics').get(); assert.deepEqual(Object.keys(row).sort(), ['count', 'day', 'event']); sqlite.close();
});
test('feedback requires consent, limits length and stores no identity', async () => {
  const { sqlite, adapter } = database();
  assert.equal((await worker.fetch(request('/api/feedback', { consent: false, rating: 5, text: '' }), { DB: adapter })).status, 400);
  assert.equal((await worker.fetch(request('/api/feedback', { consent: true, rating: 5, text: '改进导出体验' }), { DB: adapter })).status, 200);
  const row = sqlite.prepare('SELECT * FROM feedback').get(); assert.deepEqual(Object.keys(row).sort(), ['day', 'id', 'rating', 'text']); sqlite.close();
});
test('missing platform key does not consume budget', async () => {
  const { sqlite, adapter } = database(); assert.equal((await worker.fetch(request('/api/model', { mode: 'sponsored', operation: 'test' }), { DB: adapter })).status, 503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM daily_budget').get().n, 0); sqlite.close();
});
