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
process.env.PEXELS_BASE_URL = `http://localhost:${AI}/pexels`;
process.env.PIXABAY_BASE_URL = `http://localhost:${AI}/pixabay`;

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

test('stock sources: keys stored encrypted, test search works', async () => {
  for (const [id, key] of [['pexels', 'pexels-test'], ['pixabay', 'pixabay-test']]) {
    await call(`/settings/ai/${id}`, { method: 'PUT', body: { key } });
    const t = await call(`/settings/ai/${id}/test`, { method: 'POST' });
    assert.equal(t.data.ok, true, JSON.stringify(t.data));
  }
  const s = await call('/settings/ai');
  assert.deepEqual(s.data.stock.map((x) => [x.id, x.hasKey]), [['pexels', true], ['pixabay', true]]);
  assert.ok(!JSON.stringify(s.data).includes('pexels-test'));
  assert.deepEqual((await call('/engine')).data.stock, ['pexels', 'pixabay']);
});

test('video analysis: consent, frames reach the model, plan → ops + B-roll slots with stock picked by a second look', async () => {
  const frames = [0.5, 2.5, 4.5, 6.5].map((t) => ({ t, data: FRAME }));
  const library = [{ label: 'B1', data: FRAME }];
  const blocked = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames, library } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.provider.id, 'openai:frames');
  assert.equal(blocked.data.provider.kind, 'frames');
  await allow('openai:frames');
  const r = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames, library, options: { theme: 'editorial', brollAmount: 'lots', aiImages: true } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const chats = aiState.requests.filter((q) => q.vendor === 'openai' && q.kind === 'chat');
  const [plan, picker] = chats.slice(-2);
  assert.equal(plan.images, 5, 'cut frames + library frame');
  assert.ok(picker.images >= 2, 'stock thumbnails go to the picker');
  // look + captions + zooms
  const op = (t) => r.data.ops.filter((o) => o.type === t);
  assert.deepEqual(op('setStyle')[0].patch, { theme: 'editorial', captionColor: 'accent' });
  assert.deepEqual(op('setCaptionStyle')[0].patch, { style: 'editorial', enabled: true, emphasis: ['too hot', '90%'] });
  assert.deepEqual(op('updateClip').map((o) => [o.clipId, o.patch.zoom]), [['c1', 1.2], ['c2', 1.35]], 'one zoom per clip, clamped');
  // graphics: invalid ones reported, the rest fitted so nothing overlaps
  const g = op('addGraphic').map((o) => o.graphic);
  assert.ok(g.some((x) => x.type === 'headline' && x.layout === 'panel'));
  assert.ok(g.some((x) => x.type === 'callout' && x.x <= 0.92 && x.y >= 0.08));
  assert.ok(r.data.notes.some((n) => /sparkles/.test(n)) && r.data.notes.some((n) => /photo cards come in as B-roll/.test(n)));
  // B-roll slots
  const b = r.data.broll;
  assert.equal(b[0].assetId, 'b1', 'own library clip used first');
  assert.ok(b.every((x, i) => i === 0 || x.start >= b[i - 1].start + b[i - 1].duration - 0.05), 'slots never overlap');
  const stockSlots = b.filter((x) => !x.assetId);
  assert.ok(stockSlots.length >= 1);
  assert.ok(stockSlots.some((x) => x.pick && x.pick.provider && x.pick.thumb), 'picker chose a stock clip');
  assert.ok(stockSlots.some((x) => !x.pick && x.generate), 'no good match → an AI image prompt');
  assert.ok(stockSlots.every((x) => x.duration <= 6));
  assert.deepEqual(r.data.replaceBroll, ['old']);
  assert.deepEqual(r.data.meta.stockSources, ['pexels', 'pixabay']);
  const searches = aiState.requests.filter((q) => q.vendor === 'pexels' && q.kind === 'search');
  assert.ok(searches.some((q) => q.orientation === 'landscape'), 'split/card shots search landscape');
  const tooFew = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames: frames.slice(0, 1) } });
  assert.equal(tooFew.status, 400);
  project.lastVisuals = r.data;
});

test('B-roll: search, fetch a pick into the project folder, generate an AI image', async () => {
  const found = await call('/broll/search', { method: 'POST', body: { projectId: project.id, query: 'coffee beans', kind: 'video', layout: 'full' } });
  assert.equal(found.status, 200);
  assert.ok(found.data.candidates.some((c) => c.provider === 'pexels') && found.data.candidates.some((c) => c.provider === 'pixabay'));
  const pick = project.lastVisuals.broll.find((x) => x.pick).pick;
  const f = await call('/broll/fetch', { method: 'POST', body: { projectId: project.id, provider: pick.provider, id: pick.id, kind: pick.kind } });
  assert.equal(f.status, 200, JSON.stringify(f.data));
  const a = f.data.asset;
  assert.ok(a.path.startsWith(`${userId}/${project.id}/${a.id}/original`));
  assert.equal(a.kind, 'broll');
  assert.ok(a.stock.provider && a.stock.pageUrl && a.stock.licence);
  if (pick.kind === 'video') assert.ok(aiState.requests.some((q) => q.vendor === 'files' && /-720\.mp4$/.test(q.path)), 'downloads the 720p rendition, not 4K');
  const stored = await fetch(`http://localhost:${SB}/storage/v1/object/media/${a.path}`, { headers: { authorization: `Bearer ${token}`, apikey: 'test-key' } });
  assert.equal(stored.status, 200);
  const bad = await call('/broll/fetch', { method: 'POST', body: { projectId: project.id, provider: 'pexels', id: '../../etc', kind: 'video' } });
  assert.equal(bad.status, 400, 'ids are numeric only — no URLs from the browser');
  const gen0 = await call('/broll/generate', { method: 'POST', body: { projectId: project.id, prompt: 'A kettle on a stove', layout: 'card' } });
  assert.equal(gen0.status, 409);
  assert.equal(gen0.data.provider.id, 'openai:images');
  await allow('openai:images');
  const gen = await call('/broll/generate', { method: 'POST', body: { projectId: project.id, prompt: 'A kettle on a stove', layout: 'card' } });
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  assert.equal(gen.data.asset.mediaType, 'image');
  const imgReq = aiState.requests.filter((q) => q.kind === 'image').pop();
  assert.equal(imgReq.model, 'gpt-image-2');
  assert.equal(imgReq.size, '1536x1024', 'card shots are landscape');
});

test('Claude gets the frames in Anthropic’s image format', async () => {
  await call('/settings/ai/anthropic', { method: 'PUT', body: { config: { model: 'claude-sonnet-5-5' }, key: 'sk-ant-test' } });
  assert.equal((await call('/settings/ai/anthropic/test', { method: 'POST' })).data.ok, true);
  await call('/settings/ai-active', { method: 'PUT', body: { active: 'anthropic' } });
  const frames = [1, 3, 5].map((t) => ({ t, data: FRAME }));
  const blocked = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames } });
  assert.equal(blocked.data.provider.id, 'anthropic:frames');
  await allow('anthropic:frames');
  const r = await call('/ai/visuals', { method: 'POST', body: { projectId: project.id, frames, options: { theme: 'clean' } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.meta.routedVia, 'anthropic/claude-sonnet-5-5');
  assert.ok(aiState.requests.some((q) => q.vendor === 'anthropic' && q.images === 3), 'base64 frames');
  assert.equal(r.data.ops.find((o) => o.type === 'setCaptionStyle').patch.style, 'pill', 'clean look → pill captions');
  assert.equal(r.data.broll[0].assetId, null, 'no library sent → no own footage');
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
