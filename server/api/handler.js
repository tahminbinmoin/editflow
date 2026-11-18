// Editflow API — one Node handler for every /api/* route. On Vercel it runs as a single
// serverless function (api/index.js); in local dev Vite mounts it (vite.config.js).
//
// Every request is made with the user's own Supabase session, so row-level security applies
// to everything this server reads or writes. It only does the work that needs a secret:
// calling AI providers with the user's encrypted keys, and Groq transcription.
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, MEDIA_BUCKET } from '../../shared/config.js';
import { PROVIDERS, TRANSCRIBERS, extractJson, checkRouterUrl } from '../ai/providers.js';
import { encrypt, decrypt, mask } from '../lib/secrets.js';
import { planPrompt, refinePrompt, referencePrompt } from '../../shared/prompts.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length > 1_000_000) throw fail(413, 'Request too large');
  return raw ? JSON.parse(raw) : {};
}

async function authenticate(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw fail(401, 'Please sign in.');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw fail(401, 'Your session has expired. Please sign in again.');
  return { supabase, user: data.user };
}

// ---------- provider settings (rows are RLS-scoped to the user) ----------
async function rows(ctx) {
  const { data, error } = await ctx.supabase.from('provider_settings').select('provider, config, secret');
  if (error) throw fail(500, error.message);
  return Object.fromEntries((data || []).map((r) => [r.provider, r]));
}
async function upsert(ctx, provider, patch) {
  const { error } = await ctx.supabase.from('provider_settings').upsert({ user_id: ctx.user.id, provider, ...patch }, { onConflict: 'user_id,provider' });
  if (error) throw fail(500, error.message);
}
function load(all, id) {
  const def = PROVIDERS[id] || TRANSCRIBERS[id];
  if (!def) throw fail(404, 'Unknown provider');
  const r = all[id];
  const config = { ...(def.defaults ? def.defaults() : {}), ...(r?.config || {}) };
  let key = null;
  try {
    key = r?.secret ? decrypt(r.secret) : null;
  } catch {
    key = null; // EDITFLOW_SECRET changed — the user has to paste the key again
  }
  return { def, config, key };
}
const prefsOf = (all) => ({ active: 'rules', ...(all._prefs?.config || {}) });

async function listProviders(ctx) {
  const all = await rows(ctx);
  const providers = Object.values(PROVIDERS).map((p) => {
    const { config, key } = load(all, p.id);
    const { lastTest, ...cfg } = config;
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      recommended: !!p.recommended,
      billing: p.billing,
      dataUse: p.dataUse,
      fields: p.fields,
      secretLabel: p.secretLabel,
      config: cfg,
      hasKey: !!key,
      keyMasked: mask(key),
      lastTest: lastTest || null,
      ready: !!key && (p.id === 'freellmapi' || !!cfg.model),
    };
  });
  const transcribers = Object.values(TRANSCRIBERS).map((t) => {
    const { key } = load(all, t.id);
    return { id: t.id, name: t.name, billing: t.billing, dataUse: t.dataUse, secretLabel: t.secretLabel, hasKey: !!key, keyMasked: mask(key) };
  });
  return { providers, transcribers, prefs: prefsOf(all) };
}

async function activeEngine(ctx, all) {
  all = all || (await rows(ctx));
  const prefs = prefsOf(all);
  if (prefs.active === 'rules' || !PROVIDERS[prefs.active]) return { id: 'rules', name: 'Rule-based (no AI)' };
  const { def, config, key } = load(all, prefs.active);
  if (!key) return { id: 'rules', name: 'Rule-based (no AI)', fallbackReason: `${def.name} has no key saved` };
  return { id: def.id, name: def.name, def, config, key, model: config.model };
}

// ---------- AI tasks ----------
async function loadProject(ctx, projectId) {
  const { data, error } = await ctx.supabase.from('projects').select('id, name, data').eq('id', projectId).maybeSingle();
  if (error) throw fail(500, error.message);
  if (!data) throw fail(404, 'Project not found');
  return { id: data.id, name: data.name, ...data.data };
}

async function log(ctx, entry) {
  await ctx.supabase.from('ai_log').insert({ user_id: ctx.user.id, ...entry });
}

async function runJsonTask(ctx, project, task, prompt) {
  const eng = await activeEngine(ctx);
  if (eng.id === 'rules') throw fail(400, 'No AI provider is active.', { code: 'no_provider' });
  if (!project.consent?.[eng.id]?.allowed) throw fail(409, 'Consent needed before sending this project’s transcript to an AI provider.', { code: 'consent_required', provider: { id: eng.id, name: eng.name, dataUse: eng.def.dataUse } });
  const base = { project_id: project.id, provider: eng.id, task };
  let res;
  try {
    res = await eng.def.chat(eng.config, eng.key, { ...prompt, json: true });
  } catch (e) {
    await log(ctx, { ...base, model: eng.model, ok: false, error: e.message.slice(0, 500) });
    throw fail(e.status === 400 ? 400 : 502, `${eng.name}: ${e.message}`);
  }
  let data;
  try {
    data = extractJson(res.text);
  } catch (e) {
    try {
      const retry = await eng.def.chat(eng.config, eng.key, { system: prompt.system, user: `${prompt.user}\n\nYour previous reply was not valid JSON (${e.message}). Reply again with ONLY the JSON object.`, json: true });
      data = extractJson(retry.text);
      res = { ...retry, usage: { input: (res.usage?.input || 0) + (retry.usage?.input || 0), output: (res.usage?.output || 0) + (retry.usage?.output || 0) } };
    } catch {
      await log(ctx, { ...base, model: res.model, routed_via: res.routedVia, ok: false, error: 'invalid JSON' });
      throw fail(502, `${eng.name} returned a reply Editflow could not read as an edit plan. Try again, or pick a more capable model (e.g. auto:smart).`);
    }
  }
  await log(ctx, { ...base, model: res.model || eng.model, routed_via: res.routedVia, ok: true, input_tokens: res.usage?.input ?? null, output_tokens: res.usage?.output ?? null });
  return {
    data,
    meta: { engine: 'ai', provider: eng.id, providerName: eng.name, model: res.model || eng.model, routedVia: res.routedVia, fallbackAttempts: res.fallbackAttempts || 0, usage: res.usage, at: new Date().toISOString() },
  };
}

const REFINE_TYPES = new Set(['trimClip', 'moveClip', 'deleteClip', 'addSegment', 'updateClip', 'setCaptionStyle', 'addOverlay', 'updateOverlay', 'deleteOverlay', 'addBroll', 'deleteBroll', 'updateBroll', 'setMusic', 'setAudio']);

// ---------- routes ----------
const routes = [
  ['GET', /^\/engine$/, async (ctx) => {
    const e = await activeEngine(ctx);
    return { id: e.id, name: e.name, model: e.model || null, fallbackReason: e.fallbackReason || null };
  }],
  ['GET', /^\/settings\/ai$/, async (ctx) => {
    const { data } = await ctx.supabase
      .from('ai_log')
      .select('provider, ok, input_tokens, output_tokens, created_at')
      .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
      .limit(5000);
    const usage = {};
    for (const r of data || []) {
      const u = (usage[r.provider] ||= { provider: r.provider, requests: 0, ok: 0, input_tokens: 0, output_tokens: 0 });
      u.requests++;
      u.ok += r.ok ? 1 : 0;
      u.input_tokens += r.input_tokens || 0;
      u.output_tokens += r.output_tokens || 0;
    }
    return { ...(await listProviders(ctx)), usage: Object.values(usage) };
  }],
  ['PUT', /^\/settings\/ai-active$/, async (ctx, body) => {
    const all = await rows(ctx);
    if (body.active !== 'rules') {
      const def = PROVIDERS[body.active];
      if (!def) throw fail(400, 'Unknown provider');
      const { config, key } = load(all, def.id);
      if (!key || (def.id !== 'freellmapi' && !config.model)) throw fail(400, `Finish setting up ${def.name} first (key${def.id === 'freellmapi' ? '' : ' and model'}).`);
    }
    await upsert(ctx, '_prefs', { config: { ...prefsOf(all), active: body.active } });
    return listProviders(ctx);
  }],
  ['PUT', /^\/settings\/ai\/([a-z0-9_-]+)$/, async (ctx, body, [id]) => {
    const all = await rows(ctx);
    const { def, config: cur } = load(all, id);
    const allowed = new Set([...(def.fields || []).map((f) => f.key), 'model']);
    const clean = { ...cur };
    for (const [k, v] of Object.entries(body.config || {})) if (allowed.has(k)) clean[k] = String(v).trim().slice(0, 300);
    if (clean.baseUrl) clean.baseUrl = checkRouterUrl(clean.baseUrl);
    const patch = { config: clean };
    if (body.key) patch.secret = encrypt(String(body.key).trim().slice(0, 500));
    else if (all[id]?.secret) patch.secret = all[id].secret;
    await upsert(ctx, id, patch);
    return listProviders(ctx);
  }],
  ['DELETE', /^\/settings\/ai\/([a-z0-9_-]+)\/key$/, async (ctx, _b, [id]) => {
    const all = await rows(ctx);
    if (all[id]) await upsert(ctx, id, { config: all[id].config, secret: null });
    if (prefsOf(all).active === id) await upsert(ctx, '_prefs', { config: { ...prefsOf(all), active: 'rules' } });
    return listProviders(ctx);
  }],
  ['POST', /^\/settings\/ai\/([a-z0-9_-]+)\/test$/, async (ctx, _b, [id]) => {
    const all = await rows(ctx);
    const { def, config, key } = load(all, id);
    if (!key) throw fail(400, 'Add a key first.');
    let result;
    try {
      result = await def.test(config, key);
    } catch (e) {
      result = { ok: false, message: e.message, models: [] };
    }
    const lastTest = { ok: result.ok, message: result.message, at: new Date().toISOString() };
    await upsert(ctx, id, { config: { ...config, lastTest }, secret: all[id].secret });
    return { ...result, lastTest };
  }],
  ['POST', /^\/ai\/first-cut$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    if (!p.transcript?.segments?.length) throw fail(400, 'Add a transcript first.');
    return runJsonTask(ctx, p, 'first-cut', planPrompt(p));
  }],
  ['POST', /^\/ai\/refine$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    const request = String(body.request || '').trim().slice(0, 600);
    if (!request) throw fail(400, 'Describe the change you want.');
    const { data, meta } = await runJsonTask(ctx, p, 'refine', refinePrompt(p, request));
    const segs = Object.fromEntries((p.transcript?.segments || []).map((s) => [s.id, s]));
    const ops = (Array.isArray(data.ops) ? data.ops : [])
      .filter((o) => o && REFINE_TYPES.has(o.type))
      .slice(0, 40)
      .map((o) => {
        if (o.type !== 'addSegment') return o;
        const s = segs[o.segmentId];
        return s ? { type: 'addClip', assetId: s.assetId, in: Math.max(0, s.start - 0.08), out: s.end + 0.12, index: o.index } : { type: 'invalid' };
      });
    return { summary: String(data.summary || 'Proposed changes').slice(0, 600), ops, notes: Array.isArray(data.notes) ? data.notes.map(String).slice(0, 8) : [], meta };
  }],
  ['POST', /^\/ai\/reference$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    const { data, meta } = await runJsonTask(ctx, p, 'reference', referencePrompt(p));
    return { ...data, engine: 'ai', meta };
  }],
  ['POST', /^\/transcribe\/groq$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    if (!p.consent?.groq?.allowed) throw fail(409, 'Consent needed before uploading audio to Groq.', { code: 'consent_required', provider: { id: 'groq', name: 'Groq Whisper', dataUse: TRANSCRIBERS.groq.dataUse } });
    const all = await rows(ctx);
    const { key } = load(all, 'groq');
    if (!key) throw fail(400, 'Add your Groq API key in AI settings → Transcription first.');
    const path = String(body.path || '');
    if (!path.startsWith(`${ctx.user.id}/${p.id}/`)) throw fail(403, 'That audio file does not belong to this project.');
    const { data: blob, error } = await ctx.supabase.storage.from(MEDIA_BUCKET).download(path);
    if (error || !blob) throw fail(404, 'Could not read the uploaded audio.');
    if (blob.size > 25 * 1024 * 1024) throw fail(400, `The audio is ${(blob.size / 1048576).toFixed(1)} MB; Groq's free plan accepts up to 25 MB. Use a shorter clip or import a caption file.`);
    try {
      const out = await TRANSCRIBERS.groq.transcribe(key, blob, { type: 'audio/wav', filename: 'audio.wav' });
      await log(ctx, { project_id: p.id, provider: 'groq', task: 'transcribe', model: 'whisper-large-v3-turbo', ok: true });
      return out;
    } catch (e) {
      await log(ctx, { project_id: p.id, provider: 'groq', task: 'transcribe', ok: false, error: e.message.slice(0, 500) });
      throw fail(502, `Groq: ${e.message}`);
    } finally {
      await ctx.supabase.storage.from(MEDIA_BUCKET).remove([path]);
    }
  }],
];

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
    if (path === '/health') return send(res, 200, { ok: true, secretConfigured: !!process.env.EDITFLOW_SECRET, supabaseUrl: SUPABASE_URL });
    const route = routes.find(([m, re]) => m === req.method && re.test(path));
    if (!route) return send(res, 404, { error: 'Not found' });
    const ctx = await authenticate(req);
    const body = req.method === 'GET' ? {} : await readBody(req);
    const out = await route[2](ctx, body, path.match(route[1]).slice(1));
    send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    send(res, status, { error: e.message || 'Something went wrong', code: e.code, provider: e.provider });
  }
}
