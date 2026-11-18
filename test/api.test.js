// API test: the real handler against the mock Supabase and mock FreeLLMAPI fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startMockSupabase } from './mock-supabase.js';
import { startMock } from './mock-freellmapi.js';

const SB = 54400 + Math.floor(Math.random() * 300);
const AI = SB + 1;
const APIP = SB + 2;
process.env.SUPABASE_URL = `http://localhost:${SB}`;
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
process.env.EDITFLOW_SECRET = 'api-test-secret';

let sb;
let ai;
let api;
let token;
let userId;

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(`http://localhost:${APIP}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const rest = (path, init = {}) =>
  fetch(`http://localhost:${SB}/rest/v1/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, apikey: 'test-key', 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } }).then((r) => r.json());

before(async () => {
  sb = startMockSupabase(SB);
  ai = startMock(AI);
  const { default: handler } = await import('../server/api/handler.js');
  api = http.createServer(handler).listen(APIP);
  const s = await fetch(`http://localhost:${SB}/auth/v1/signup`, { method: 'POST', body: JSON.stringify({ email: 'a@test.local', password: 'password1' }) }).then((r) => r.json());
  token = s.access_token;
  userId = s.user.id;
});
after(() => {
  sb.close();
  ai.close();
  api.close();
});

test('rejects requests without a session', async () => {
  const r = await call('/engine', { auth: false });
  assert.equal(r.status, 401);
});

test('provider keys are stored encrypted and never returned', async () => {
  await call('/settings/ai/freellmapi', { method: 'PUT', body: { config: { baseUrl: `http://localhost:${AI}/v1`, model: 'auto:smart' }, key: 'freellmapi-test' } });
  const s = await call('/settings/ai');
  assert.ok(!JSON.stringify(s.data).includes('freellmapi-test'));
  const row = sb.state.tables.provider_settings.find((r) => r.provider === 'freellmapi');
  assert.ok(row.secret.startsWith('v1.') && !row.secret.includes('freellmapi-test'));
  const t = await call('/settings/ai/freellmapi/test', { method: 'POST' });
  assert.equal(t.data.ok, true);
  const act = await call('/settings/ai-active', { method: 'PUT', body: { active: 'freellmapi' } });
  assert.equal(act.data.prefs.active, 'freellmapi');
  assert.equal((await call('/engine')).data.id, 'freellmapi');
});

test('AI planning needs consent, then returns a plan with the routed model', async () => {
  const segments = [
    { id: 's1', assetId: 'a1', start: 0, end: 3, text: 'Hello there.' },
    { id: 's2', assetId: 'a1', start: 4, end: 7, text: 'Why does this matter?' },
  ];
  const [p] = await rest('projects?select=*', { method: 'POST', body: JSON.stringify({ name: 'T', data: { settings: {}, assets: [{ id: 'a1', duration: 10 }], transcript: { segments }, timeline: { clips: [{ id: 'c1', assetId: 'a1', in: 0, out: 3 }], captions: { items: [] }, overlays: [], broll: [], music: {}, audio: {}, format: { aspect: '9:16' } }, consent: {} } }) });
  const blocked = await call('/ai/first-cut', { method: 'POST', body: { projectId: p.id } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'consent_required');
  await rest(`projects?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...p.data, consent: { freellmapi: { allowed: true } } } }) });
  const cut = await call('/ai/first-cut', { method: 'POST', body: { projectId: p.id } });
  assert.equal(cut.status, 200);
  assert.equal(cut.data.meta.routedVia, 'mockprovider/mock-model-a');
  assert.ok(Array.isArray(cut.data.data.clips));
  const ref = await call('/ai/refine', { method: 'POST', body: { projectId: p.id, request: 'music quieter' } });
  assert.ok(ref.data.ops.some((o) => o.type === 'setMusic'));
  assert.ok(!ref.data.ops.some((o) => o.type === 'bogusOp'));
  assert.ok(sb.state.tables.ai_log.filter((l) => l.user_id === userId && l.ok).length >= 2);
});

test('another user cannot use someone else’s project', async () => {
  const other = await fetch(`http://localhost:${SB}/auth/v1/signup`, { method: 'POST', body: JSON.stringify({ email: 'b@test.local', password: 'password1' }) }).then((r) => r.json());
  const mine = sb.state.tables.projects.find((r) => r.user_id === userId);
  const res = await fetch(`http://localhost:${APIP}/api/ai/first-cut`, { method: 'POST', headers: { authorization: `Bearer ${other.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: mine.id }) });
  assert.equal(res.status, 404);
});

test('Groq transcription refuses audio outside the user’s project folder', async () => {
  const p = sb.state.tables.projects.find((r) => r.user_id === userId);
  await rest(`projects?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...p.data, consent: { groq: { allowed: true } } } }) });
  await call('/settings/ai/groq', { method: 'PUT', body: { key: 'gsk_test' } });
  const r = await call('/transcribe/groq', { method: 'POST', body: { projectId: p.id, assetId: 'a1', path: `someone-else/${p.id}/a1/speech.wav` } });
  assert.equal(r.status, 403);
});
