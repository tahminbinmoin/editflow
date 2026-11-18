// API test: the real handler against the mock Supabase and mock OpenAI/Anthropic fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startMockSupabase } from './mock-supabase.js';
import { startMock, state as aiState } from './mock-ai.js';

const SB = 54400 + Math.floor(Math.random() * 300);
const AI = SB + 1;
const APIP = SB + 2;
process.env.SUPABASE_URL = `http://localhost:${SB}`;
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
process.env.EDITFLOW_SECRET = 'api-test-secret';
process.env.OPENAI_BASE_URL = `http://localhost:${AI}/openai/v1`;
process.env.ANTHROPIC_BASE_URL = `http://localhost:${AI}/anthropic/v1`;

let sb;
let ai;
let api;
let token;
let userId;
let project;

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
const allow = async (...keys) => {
  const [p] = await rest(`projects?id=eq.${project.id}&select=*`);
  const consent = { ...(p.data.consent || {}) };
  for (const k of keys) consent[k] = { allowed: true };
  await rest(`projects?id=eq.${project.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...p.data, consent } }) });
};
const FRAME = Buffer.alloc(3000, 7).toString('base64'); // stands in for a small JPEG

before(async () => {
  sb = startMockSupabase(SB);
  ai = startMock(AI);
  const { default: handler } = await import('../server/api/handler.js');
  api = http.createServer(handler).listen(APIP);
  const s = await fetch(`http://localhost:${SB}/auth/v1/signup`, { method: 'POST', body: JSON.stringify({ email: 'a@test.local', password: 'password1' }) }).then((r) => r.json());
  token = s.access_token;
  userId = s.user.id;
  const segments = [
    { id: 's1', assetId: 'a1', start: 0, end: 3, text: 'Hello there.' },
    { id: 's2', assetId: 'a1', start: 4, end: 7, text: 'Why does this matter?' },
  ];
  [project] = await rest('projects?select=*', {
    method: 'POST',
    body: JSON.stringify({
      name: 'T',
      data: {
        settings: {},
        assets: [{ id: 'a1', kind: 'footage', duration: 10, status: 'ready', hasVideo: true }, { id: 'b1', kind: 'broll', name: 'kettle.mp4', duration: 8, status: 'ready', hasVideo: true }],
        transcript: { segments },
        timeline: { clips: [{ id: 'c1', assetId: 'a1', in: 0, out: 3 }, { id: 'c2', assetId: 'a1', in: 4, out: 10 }], captions: { items: [{ id: 'k1', assetId: 'a1', start: 0, end: 3, text: 'Hello there.' }] }, overlays: [], broll: [{ id: 'old', start: 1, duration: 2, description: 'old idea', assetId: null }], music: {}, audio: {}, format: { aspect: '9:16' } },
        consent: {},
      },
    }),
  });
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

test('only ChatGPT and Claude are offered; keys are stored encrypted and never returned', async () => {
  const s0 = await call('/settings/ai');
  assert.deepEqual(s0.data.providers.map((p) => p.id), ['openai', 'anthropic']);
  assert.match(s0.data.subscriptionNote, /subscription/i);
  await call('/settings/ai/openai', { method: 'PUT', body: { config: { model: 'gpt-6.2-sol' }, key: 'sk-test' } });
  const s = await call('/settings/ai');
  assert.ok(!JSON.stringify(s.data).includes('sk-test'));
  const row = sb.state.tables.provider_settings.find((r) => r.provider === 'openai');
  assert.ok(row.secret.startsWith('v1.') && !row.secret.includes('sk-test'));
  const t = await call('/settings/ai/openai/test', { method: 'POST' });
  assert.equal(t.data.ok, true);
  assert.ok(t.data.models.includes('gpt-6.2-sol') && !t.data.models.includes('gpt-transcribe') && !t.data.models.some((m) => /embedding/.test(m)));
  const act = await call('/settings/ai-active', { method: 'PUT', body: { active: 'openai' } });
  assert.equal(act.data.prefs.active, 'openai');
  const eng = (await call('/engine')).data;
  assert.equal(eng.id, 'openai');
  assert.equal(eng.vision, true);
  assert.equal(eng.transcription, true);
  const bad = await call('/settings/ai/freellmapi', { method: 'PUT', body: { key: 'x' } });
  assert.equal(bad.status, 404);
});

test('AI planning needs consent, then returns a plan; refine accepts graphic ops and drops unknown ones', async () => {
  const blocked = await call('/ai/first-cut', { method: 'POST', body: { projectId: project.id } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'consent_required');
  assert.equal(blocked.data.provider.kind, 'transcript');
  await allow('openai');
  const cut = await call('/ai/first-cut', { method: 'POST', body: { projectId: project.id } });
  assert.equal(cut.status, 200);
  assert.equal(cut.data.meta.routedVia, 'openai/gpt-6.2-sol');
  assert.ok(Array.isArray(cut.data.data.clips));
  const ref = await call('/ai/refine', { method: 'POST', body: { projectId: project.id, request: 'music quieter' } });
  assert.ok(ref.data.ops.some((o) => o.type === 'setMusic'));
  assert.ok(ref.data.ops.some((o) => o.type === 'addGraphic'));
  assert.ok(!ref.data.ops.some((o) => o.type === 'bogusOp'));
  assert.ok(sb.state.tables.ai_log.filter((l) => l.user_id === userId && l.ok).length >= 2);
});

test('video analysis: separate consent for frames, images reach the model, reply becomes validated ops', async () => {
  const frames = [0.5, 2.5, 4.5, 6.5].map((t) => ({ t, data: FRAME }));
  const library = [{ label: 'B1', data: FRAME }];
  const blocked = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames, library } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.provider.id, 'openai:frames');
  assert.equal(blocked.data.provider.kind, 'frames');
  await allow('openai:frames');
  const r = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames, library } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const last = aiState.requests.filter((q) => q.vendor === 'openai' && q.kind === 'chat').pop();
  assert.equal(last.images, 5);
  assert.equal(last.json, 'json_object');
  assert.equal(r.data.meta.frames, 4);
  const types = r.data.ops.map((o) => o.type);
  assert.deepEqual(types.filter((t) => t === 'deleteBroll').length, 1, 'replaces the old suggestion-only B-roll');
  const broll = r.data.ops.filter((o) => o.type === 'addBroll').map((o) => o.broll);
  assert.equal(broll[0].assetId, 'b1', 'library label B1 maps to the asset');
  assert.ok(broll[1].duration <= 6 && broll[1].assetId === null);
  const g = r.data.ops.filter((o) => o.type === 'addGraphic').map((o) => o.graphic);
  assert.deepEqual(g.map((x) => x.type), ['keyword', 'stat', 'callout'], 'the checklist would cover the stat while it counts, so it is left out');
  assert.ok(r.data.notes.some((n) => /checklist “Steps”.*cover another graphic/.test(n)), JSON.stringify(r.data.notes));
  assert.ok(g[2].x <= 0.92 && g[2].y >= 0.08, 'callout point clamped into the frame');
  assert.ok(g.every((x) => x.start + x.duration <= 9.001), 'graphics fit inside the 9 s cut');
  assert.ok(r.data.notes.some((n) => /sparkles/.test(n)), 'unknown graphic type reported, not applied');
  const tooFew = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames: frames.slice(0, 1) } });
  assert.equal(tooFew.status, 400);
});

test('Claude gets the frames in Anthropic’s image format', async () => {
  await call('/settings/ai/anthropic', { method: 'PUT', body: { config: { model: 'claude-sonnet-5-5' }, key: 'sk-ant-test' } });
  assert.equal((await call('/settings/ai/anthropic/test', { method: 'POST' })).data.ok, true);
  await call('/settings/ai-active', { method: 'PUT', body: { active: 'anthropic' } });
  const blocked = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames: [1, 3, 5].map((t) => ({ t, data: FRAME })) } });
  assert.equal(blocked.data.provider.id, 'anthropic:frames');
  await allow('anthropic:frames');
  const r = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames: [1, 3, 5].map((t) => ({ t, data: FRAME })) } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.meta.routedVia, 'anthropic/claude-sonnet-5-5');
  assert.equal(aiState.requests.filter((q) => q.vendor === 'anthropic').pop().images, 3);
  assert.equal(r.data.ops.find((o) => o.type === 'addBroll').broll.assetId, null, 'no library sent → no footage attached');
});

test('another user cannot use someone else’s project', async () => {
  const other = await fetch(`http://localhost:${SB}/auth/v1/signup`, { method: 'POST', body: JSON.stringify({ email: 'b@test.local', password: 'password1' }) }).then((r) => r.json());
  const res = await fetch(`http://localhost:${APIP}/api/ai/first-cut`, { method: 'POST', headers: { authorization: `Bearer ${other.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id }) });
  assert.equal(res.status, 404);
});

test('OpenAI transcription: consent, own folder only, split at pauses into timed lines', async () => {
  const path = `${userId}/${project.id}/a1/speech.wav`;
  const blocked = await call('/transcribe/openai', { method: 'POST', body: { projectId: project.id, path } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.provider.id, 'openai:audio');
  await allow('openai:audio');
  const foreign = await call('/transcribe/openai', { method: 'POST', body: { projectId: project.id, path: `someone-else/${project.id}/a1/speech.wav` } });
  assert.equal(foreign.status, 403);
  // 6 s of 16 kHz audio: tone 0.5–2.0 s and 3.0–5.5 s, near-silence elsewhere
  const { wavSlice } = await import('../shared/speech.js');
  const rate = 16000;
  const samples = new Int16Array(rate * 6);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const on = (t > 0.5 && t < 2) || (t > 3 && t < 5.5);
    samples[i] = Math.round(on ? 9000 * Math.sin(t * 2 * Math.PI * 220) : (i % 7) - 3);
  }
  const wav = wavSlice(samples, rate, 0, 6);
  const up = await fetch(`http://localhost:${SB}/storage/v1/object/media/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, apikey: 'test-key', 'content-type': 'audio/wav' }, body: wav });
  assert.equal(up.status, 200);
  const r = await call('/transcribe/openai', { method: 'POST', body: { projectId: project.id, path } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.segments.length, 2);
  assert.ok(Math.abs(r.data.segments[0].start - 0.5) < 0.2 && Math.abs(r.data.segments[0].end - 2) < 0.2, JSON.stringify(r.data.segments));
  assert.ok(Math.abs(r.data.segments[1].start - 3) < 0.2 && Math.abs(r.data.segments[1].end - 5.5) < 0.2, JSON.stringify(r.data.segments));
  assert.match(r.data.segments[0].text, /^Mock line/);
  assert.ok(aiState.requests.filter((q) => q.kind === 'transcribe').every((q) => q.model === 'gpt-transcribe'));
  const gone = await fetch(`http://localhost:${SB}/storage/v1/object/media/${path}`, { headers: { authorization: `Bearer ${token}`, apikey: 'test-key' } });
  assert.equal(gone.status, 404, 'audio is deleted after transcription');
});
