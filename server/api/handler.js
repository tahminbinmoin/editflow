// Editflow API — one Node handler for every /api/* route. On Vercel it runs as a single
// serverless function (api/index.js); in local dev Vite mounts it (vite.config.js).
//
// Every request is made with the user's own Supabase session, so row-level security applies
// to everything this server reads or writes. It only does the work that needs a secret:
// calling ChatGPT (OpenAI) or Claude (Anthropic) with the user's encrypted keys, including
// video analysis from still frames and OpenAI transcription.
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, MEDIA_BUCKET } from '../../shared/config.js';
import { PROVIDERS, SUBSCRIPTION_INFO, extractJson } from '../ai/providers.js';
import { encrypt, decrypt, mask } from '../lib/secrets.js';
import { planPrompt, criticPrompt, refinePrompt, referencePrompt, visualsPrompt, pickerPrompt } from '../../shared/prompts.js';
import { cleanPlan, planToTimeline } from '../../shared/plan.js';
import { reviewCut, scriptOf, scriptText } from '../../shared/quality.js';
import { EDIT_TYPES, cleanStyle } from '../../shared/styles.js';
import { exampleFromProject, trainPrompt, trainedStyle, fineTuneRecords } from '../../shared/training.js';
import { assertAllowed, recordUsage, billingSummary, PAYMENT_PROVIDERS } from '../billing/index.js';
import { STOCK_SOURCES, searchStock, resolveStock, pickFile, download, generateImage } from '../media/stock.js';
import { wavInfo, wavSamples, speechChunks, wavSlice, mapLimit, voiceActivity } from '../../shared/speech.js';
import { alignWords, estimateWords, segmentsFromWords, tokens } from '../../shared/words.js';
import { cleanGraphic, fitGraphics, GRAPHIC_TYPES } from '../../shared/graphics.js';
import { normalizeTimeline, totalDuration, layout as tlLayout, timelineCaptions, uid, BROLL_LAYOUTS } from '../../shared/timeline.js';
import { THEMES } from '../../shared/gfx-core.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length > limit) throw fail(413, 'Request too large');
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
  const def = PROVIDERS[id] || STOCK_SOURCES[id];
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
const prefsOf = (all) => ({ active: 'rules', aiImages: true, ...(all._prefs?.config || {}) });
const serverStockKey = (id) => (id === 'pexels' ? process.env.PEXELS_API_KEY : id === 'pixabay' ? process.env.PIXABAY_API_KEY : null) || null;
/** Stock sources usable right now: [{ id, key }] (the user's own key wins over the app's). */
function stockKeys(all) {
  return Object.keys(STOCK_SOURCES)
    .map((id) => ({ id, key: load(all, id).key || serverStockKey(id) }))
    .filter((x) => x.key);
}

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
      ready: !!key && !!cfg.model,
    };
  });
  const stock = Object.values(STOCK_SOURCES).map((src) => {
    const { key } = load(all, src.id);
    return { ...src, hasKey: !!key, keyMasked: mask(key), serverKey: !!serverStockKey(src.id) };
  });
  return { providers, stock, prefs: prefsOf(all), subscriptionNote: SUBSCRIPTION_INFO, transcription: { provider: 'openai', ready: providers.find((p) => p.id === 'openai')?.hasKey || false } };
}

async function activeEngine(ctx, all) {
  all = all || (await rows(ctx));
  const prefs = prefsOf(all);
  if (prefs.active === 'rules' || !PROVIDERS[prefs.active]) return { id: 'rules', name: 'Rule-based (no AI)' };
  const { def, config, key } = load(all, prefs.active);
  if (!key) return { id: 'rules', name: 'Rule-based (no AI)', fallbackReason: `${def.name} has no key saved` };
  return { id: def.id, name: def.name, def, config, key, model: config.model, vision: !!def.vision };
}

const CONSENT_TEXT = {
  frames: 'still frames from your cut',
  audio: 'the audio track',
};
function requireConsent(project, providerId, name, dataUse, kind) {
  const key = kind ? `${providerId}:${kind}` : providerId;
  if (!project.consent?.[key]?.allowed)
    throw fail(409, `Consent needed before sending ${kind ? CONSENT_TEXT[kind] : 'this project’s transcript'} to ${name}.`, { code: 'consent_required', provider: { id: key, name, dataUse, kind: kind || 'transcript' } });
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

async function runJsonTask(ctx, project, task, prompt, { images = [] } = {}) {
  const eng = await activeEngine(ctx);
  if (eng.id === 'rules') throw fail(400, 'No AI provider is active. Connect ChatGPT or Claude in AI settings.', { code: 'no_provider' });
  // project = null: admin training on the admin's own examples (no creator project involved)
  if (project) requireConsent(project, eng.id, eng.name, eng.def.dataUse, images.length ? 'frames' : null);
  await assertAllowed(ctx, 'ai_task');
  const base = { project_id: project?.id ?? null, provider: eng.id, task };
  let res;
  try {
    res = await eng.def.chat(eng.config, eng.key, { ...prompt, json: true, images });
  } catch (e) {
    await log(ctx, { ...base, model: eng.model, ok: false, error: e.message.slice(0, 500) });
    throw fail(e.status === 400 ? 400 : 502, `${eng.name}: ${e.message}`);
  }
  let data;
  try {
    data = extractJson(res.text);
  } catch (e) {
    try {
      const retry = await eng.def.chat(eng.config, eng.key, { system: prompt.system, user: `${prompt.user}\n\nYour previous reply was not valid JSON (${e.message}). Reply again with ONLY the JSON object.`, json: true, images });
      data = extractJson(retry.text);
      res = { ...retry, usage: { input: (res.usage?.input || 0) + (retry.usage?.input || 0), output: (res.usage?.output || 0) + (retry.usage?.output || 0) } };
    } catch {
      await log(ctx, { ...base, model: res.model, routed_via: res.routedVia, ok: false, error: 'invalid JSON' });
      throw fail(502, `${eng.name} returned a reply Editflow could not read as an edit plan. Try again, or pick a more capable model in AI settings.`);
    }
  }
  await log(ctx, { ...base, model: res.model || eng.model, routed_via: res.routedVia, ok: true, input_tokens: res.usage?.input ?? null, output_tokens: res.usage?.output ?? null });
  await recordUsage(ctx, 'ai_task', 1, project?.id ?? null);
  return {
    data,
    meta: { engine: 'ai', provider: eng.id, providerName: eng.name, model: res.model || eng.model, routedVia: res.routedVia, fallbackAttempts: res.fallbackAttempts || 0, usage: res.usage, at: new Date().toISOString() },
  };
}

async function requireAdmin(ctx) {
  const { data, error } = await ctx.supabase.rpc('is_admin');
  if (error || data !== true) throw fail(403, 'This area is for Editflow admins. Sign in with an admin account.');
}

/** The published house style for a type of reel (trained in the admin studio), or null. */
async function styleFor(ctx, key) {
  if (!key) return null;
  const { data } = await ctx.supabase.from('edit_styles').select('key, label, description, rules, examples, pacing, version').eq('key', key).eq('published', true).order('version', { ascending: false }).limit(1);
  const row = data?.[0];
  return row ? { ...cleanStyle({ ...row, desc: row.description }), version: row.version } : null;
}

async function typeInfo(ctx, key) {
  if (EDIT_TYPES[key]) return { key, ...EDIT_TYPES[key] };
  const { data } = await ctx.supabase.from('edit_styles').select('key, label, description').eq('key', key).order('version', { ascending: false }).limit(1);
  if (!data?.[0]) throw fail(404, 'Unknown type of reel.');
  return { key, label: data[0].label, desc: data[0].description };
}

const stripSource = (ex) => ({ ...ex, data: ex.data ? { ...ex.data, source: undefined } : ex.data });

const REFINE_TYPES = new Set(['trimClip', 'moveClip', 'deleteClip', 'addSegment', 'updateClip', 'setCaptionStyle', 'addOverlay', 'updateOverlay', 'deleteOverlay', 'addBroll', 'deleteBroll', 'updateBroll', 'addGraphic', 'updateGraphic', 'deleteGraphic', 'setMusic', 'setAudio']);

const MAX_FRAMES = 24;
const keyOf = (all, source) => load(all, source).key || serverStockKey(source);
const MAX_LIBRARY = 12;
const b64ok = (d) => typeof d === 'string' && d.length > 100 && d.length < 400_000 && /^[A-Za-z0-9+/=]+$/.test(d.slice(0, 200));

const CAPTION_FOR_THEME = { editorial: 'editorial', clean: 'pill', bold: 'pop' };
const COLOR_FOR_THEME = { editorial: 'accent', clean: 'accent', bold: 'yellow' };
function cleanVisualOptions(o = {}, p) {
  const theme = THEMES[o.theme] ? o.theme : normalizeTimeline(p.timeline).style.theme;
  return { theme, brollAmount: o.brollAmount === 'some' ? 'some' : 'lots', aiImages: o.aiImages !== false, aspect: normalizeTimeline(p.timeline).format.aspect, captions: o.captions === 'keep' ? 'keep' : 'theme' };
}
const orientationFor = (layout, aspect) => (layout === 'split' || layout === 'card' ? 'landscape' : aspect === '16:9' ? 'landscape' : aspect === '1:1' ? 'square' : 'portrait');

/**
 * Turn the model's visual plan into timeline ops (graphics, zooms, captions, look) and B-roll
 * slots (footage still to be found). Everything is validated and clamped to the cut.
 */
export function planVisuals(data, project, opts) {
  const tl = normalizeTimeline(project.timeline);
  const D = totalDuration(tl);
  const { clips } = tlLayout(tl);
  const caps = timelineCaptions(tl);
  const library = project.assets.filter((a) => a.kind === 'broll' && a.status === 'ready' && a.hasVideo !== false);
  const libById = Object.fromEntries(library.map((a, i) => [`B${i + 1}`, a]));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const ops = [];
  const notes = [];
  // look + captions
  ops.push({ type: 'setStyle', patch: { theme: opts.theme, captionColor: COLOR_FOR_THEME[opts.theme] } });
  const emphasis = (Array.isArray(data.captionEmphasis) ? data.captionEmphasis : []).map((w) => String(w).slice(0, 40)).filter(Boolean).slice(0, 60);
  ops.push({ type: 'setCaptionStyle', patch: { ...(opts.captions === 'keep' ? {} : { style: CAPTION_FOR_THEME[opts.theme], enabled: true }), emphasis } });
  // B-roll slots, non-overlapping
  const slots = [];
  const raw = (Array.isArray(data.broll) ? data.broll : []).map((b) => ({ ...b, start: num(b.start, 0) })).sort((x, y) => x.start - y.start).slice(0, 16);
  for (const b of raw) {
    const start = Math.max(0, Math.min(D - 0.6, b.start));
    const prev = slots[slots.length - 1];
    if (prev && start < prev.start + prev.duration - 0.05) continue;
    const lib = libById[String(b.footage || b.assetId || '').trim().toUpperCase()];
    const layout = BROLL_LAYOUTS[b.layout] ? b.layout : 'full';
    const duration = +Math.max(0.8, Math.min(6, num(b.duration, 2.5), D - start)).toFixed(2);
    const line = caps.filter((c) => c.end > start && c.start < start + duration).map((c) => c.text).join(' ');
    slots.push({
      start: +start.toFixed(2),
      duration,
      description: String(b.description || 'Cutaway shot').slice(0, 200),
      reason: String(b.reason || '').slice(0, 300),
      layout: lib?.mediaType !== 'image' && layout === 'card' && lib ? 'split' : layout,
      caption: String(b.caption || '').slice(0, 40),
      kind: b.kind === 'photo' || layout === 'card' ? 'photo' : 'video',
      queries: (Array.isArray(b.queries) ? b.queries : [b.query]).map((q) => String(q || '').trim().slice(0, 60)).filter(Boolean).slice(0, 3),
      imagePrompt: String(b.imagePrompt || '').slice(0, 800),
      assetId: lib ? lib.id : null,
      srcIn: lib ? Math.max(0, Math.min(Math.max(0, (lib.duration || 0) - duration), num(b.srcIn, 0))) : 0,
      line: line.slice(0, 200),
    });
  }
  // graphics
  const incoming = [];
  for (const g of (Array.isArray(data.graphics) ? data.graphics : []).slice(0, 16)) {
    try {
      if (g?.type === 'photo') throw new Error('photo cards come in as B-roll');
      const clean = cleanGraphic({ ...g, start: Math.max(0, Math.min(D - 0.6, num(g.start, 0))) });
      clean.duration = Math.min(clean.duration, Math.max(0.6, D - clean.start));
      if (clean.type === 'progress') ((clean.start = 0), (clean.duration = D));
      delete clean.id;
      incoming.push(clean);
    } catch (e) {
      notes.push(`Skipped a graphic: ${e.message}`);
    }
  }
  const { kept, dropped } = fitGraphics(tl.graphics, incoming);
  for (const g of kept) ops.push({ type: 'addGraphic', graphic: g });
  for (const g of dropped) notes.push(`Left out the ${GRAPHIC_TYPES[g.type].label.toLowerCase()} “${(g.text || g.items[0] || '').replace(/\*/g, '')}” at ${g.start.toFixed(1)}s: it would cover another graphic.`);
  // B-roll vs graphics: a full-screen card would hide the shot, and a top panel and a split
  // screen both want the top of the frame — the graphic wins, the shot is left out.
  const overlaps = (a, b) => a.start < b.start + b.duration && b.start < a.start + a.duration;
  const blocking = [...tl.graphics, ...kept];
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    const hit = blocking.find((g) => overlaps(g, s) && (g.layout === 'full' || (g.layout === 'panel' && s.layout === 'split')));
    if (hit) {
      notes.push(`Left out the B-roll “${s.description}” at ${s.start.toFixed(1)}s: the ${GRAPHIC_TYPES[hit.type].label.toLowerCase()} uses that part of the frame.`);
      slots.splice(i, 1);
    }
  }
  // punch-in zooms, at most one per clip
  const zoomed = new Set();
  for (const z of (Array.isArray(data.zooms) ? data.zooms : []).slice(0, 12)) {
    const at = num(z.at, -1);
    const c = clips.find((k) => at >= k.tlStart && at < k.tlEnd);
    if (!c || zoomed.has(c.id)) continue;
    zoomed.add(c.id);
    ops.push({ type: 'updateClip', clipId: c.id, patch: { zoom: Math.max(1.05, Math.min(1.35, num(z.zoom, 1.18))) } });
  }
  return { ops, slots, notes };
}

/** Stock candidates for one slot: both sources, both queries, deduplicated, best first. */
async function findCandidates(keys, slot, orientation, perSlot = 4) {
  const seen = new Set();
  const lists = [];
  const errors = [];
  for (const q of slot.queries.slice(0, 2))
    for (const { id, key } of keys)
      lists.push(
        searchStock(id, key, q, { kind: slot.kind, orientation, perPage: 4 }).catch((e) => {
          errors.push(e.message);
          return [];
        }),
      );
  const results = await Promise.all(lists);
  const out = [];
  for (let i = 0; out.length < perSlot && i < 6; i++)
    for (const list of results) {
      const c = list[i];
      if (!c || seen.has(`${c.provider}:${c.id}`)) continue;
      if (c.kind === 'video' && c.duration && c.duration < Math.min(slot.duration, 3)) continue;
      seen.add(`${c.provider}:${c.id}`);
      out.push(c);
      if (out.length >= perSlot) break;
    }
  return { candidates: out, errors };
}
const publicCandidate = (c) => c && { provider: c.provider, id: c.id, kind: c.kind, thumb: c.thumb, duration: c.duration || 0, width: c.width, height: c.height, author: c.author, authorUrl: c.authorUrl, pageUrl: c.pageUrl };

/** Save downloaded B-roll into the user's project folder in Storage and describe it as an asset. */
async function storeAsset(ctx, project, { buf, ext, contentType, thumb, fields }) {
  const id = uid('ast');
  const base = `${ctx.user.id}/${project.id}/${id}`;
  const store = ctx.supabase.storage.from(MEDIA_BUCKET);
  const { error } = await store.upload(`${base}/original${ext}`, buf, { contentType, upsert: true });
  if (error) throw fail(500, `Could not save the B-roll: ${error.message}`);
  let thumbPath = null;
  if (thumb) {
    const r = await store.upload(`${base}/thumb.jpg`, thumb, { contentType: 'image/jpeg', upsert: true });
    if (!r.error) thumbPath = `${base}/thumb.jpg`;
  }
  return { id, kind: 'broll', status: 'ready', size: buf.length, hasVideo: true, hasAudio: false, path: `${base}/original${ext}`, thumbPath, thumb: !!thumbPath, createdAt: new Date().toISOString(), ...fields };
}

// ---------- routes ----------
const routes = [
  ['GET', /^\/engine$/, async (ctx) => {
    const all = await rows(ctx);
    const e = await activeEngine(ctx, all);
    const openaiKey = !!load(all, 'openai').key;
    return { id: e.id, name: e.name, model: e.model || null, vision: !!e.vision, dataUse: e.def?.dataUse || null, fallbackReason: e.fallbackReason || null, transcription: openaiKey, images: openaiKey, aiImages: prefsOf(all).aiImages, stock: stockKeys(all).map((k) => k.id) };
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
      if (!key || !config.model) throw fail(400, `Finish setting up ${def.name} first (API key and model).`);
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
      result = STOCK_SOURCES[id]
        ? await searchStock(id, key, 'coffee', { kind: 'video', perPage: 3 }).then((r) => ({ ok: true, models: [], message: `Key accepted. A test search found ${r.length} clips.` }))
        : await def.test(config, key);
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
    const style = await styleFor(ctx, p.settings?.editType);
    // Pass 1: the story editor plans the reel.
    const first = await runJsonTask(ctx, p, 'first-cut', planPrompt(p, style));
    // Pass 2: a senior editor watches the draft as it will play (after the clean cut, with the
    // measured checks) and fixes it. If the review fails, the first plan is kept.
    let data = first.data;
    let review = null;
    let usage = first.meta.usage || {};
    if (body.review !== false) {
      try {
        const { plan } = cleanPlan(first.data, p.transcript.segments);
        if (plan.clips.length) {
          const draft = planToTimeline(plan, p.transcript.segments, { transcript: p.transcript, assets: p.assets, mode: p.settings?.cutMode });
          const qa = reviewCut(p, draft);
          const second = await runJsonTask(ctx, p, 'first-cut-review', criticPrompt(p, plan, scriptText(scriptOf(draft, p.transcript, p.assets)), qa, style));
          const improved = second.data?.plan;
          if (improved && cleanPlan(improved, p.transcript.segments).plan.clips.length) data = improved;
          review = { scores: second.data?.scores || null, issues: Array.isArray(second.data?.issues) ? second.data.issues.map(String).slice(0, 8) : [], revised: data === improved };
          usage = { input: (usage.input || 0) + (second.meta.usage?.input || 0), output: (usage.output || 0) + (second.meta.usage?.output || 0) };
        }
      } catch (e) {
        if (e.status === 402) throw e;
        review = { error: e.message.slice(0, 200) };
      }
    }
    return { data: { ...data, editorReview: review }, meta: { ...first.meta, usage, passes: review && !review.error ? 2 : 1, style: style ? { key: style.key, version: style.version } : null } };
  }],
  ['GET', /^\/styles$/, async (ctx) => {
    const { data } = await ctx.supabase.from('edit_styles').select('key, label, description, version, pacing, published').eq('published', true).order('version', { ascending: false }).limit(500);
    const out = Object.fromEntries(Object.entries(EDIT_TYPES).map(([key, t]) => [key, { key, label: t.label, desc: t.desc, trained: false, version: null, pacing: null }]));
    for (const r of data || []) if (!out[r.key]?.trained) out[r.key] = { key: r.key, label: r.label, desc: r.description || out[r.key]?.desc || '', trained: true, version: r.version, pacing: r.pacing || null };
    return { types: Object.values(out) };
  }],
  ['GET', /^\/billing$/, async (ctx) => billingSummary(ctx)],
  ['POST', /^\/billing\/checkout$/, async () => {
    if (!Object.keys(PAYMENT_PROVIDERS).length) throw fail(501, 'Payments aren’t enabled yet. Editflow is free during the beta.', { code: 'billing_disabled' });
    throw fail(501, 'Checkout is not implemented for this provider yet.');
  }],

  // ----- admin: training studio -----
  ['GET', /^\/admin\/me$/, async (ctx) => {
    await requireAdmin(ctx);
    const { data: stats } = await ctx.supabase.rpc('admin_stats');
    return { admin: true, email: ctx.user.email, stats: stats || null };
  }],
  ['POST', /^\/admin\/invites$/, async (ctx) => {
    await requireAdmin(ctx);
    const { data, error } = await ctx.supabase.rpc('create_admin_invite');
    if (error) throw fail(400, error.message);
    return { code: data, expiresInDays: 7 };
  }],
  ['GET', /^\/admin\/styles$/, async (ctx) => {
    await requireAdmin(ctx);
    const [{ data: rows }, { data: exs }] = await Promise.all([
      ctx.supabase.from('edit_styles').select('*').order('version', { ascending: false }).limit(1000),
      ctx.supabase.from('training_examples').select('id, edit_type').limit(5000),
    ]);
    const keys = new Set([...Object.keys(EDIT_TYPES), ...(rows || []).map((r) => r.key)]);
    return {
      types: [...keys].map((key) => {
        const versions = (rows || []).filter((r) => r.key === key);
        const builtIn = EDIT_TYPES[key];
        return {
          key,
          label: versions[0]?.label || builtIn?.label || key,
          desc: versions[0]?.description || builtIn?.desc || '',
          builtIn: !!builtIn,
          examples: (exs || []).filter((e) => e.edit_type === key).length,
          published: versions.find((v) => v.published) || null,
          versions,
        };
      }),
    };
  }],
  ['POST', /^\/admin\/styles$/, async (ctx, body) => {
    await requireAdmin(ctx);
    const st = cleanStyle(body);
    if (!st.key || !st.label) throw fail(400, 'A type of reel needs a key and a name.');
    const { data: prev } = await ctx.supabase.from('edit_styles').select('version').eq('key', st.key).order('version', { ascending: false }).limit(1);
    const row = { key: st.key, label: st.label, description: st.desc, rules: st.rules, examples: st.examples, pacing: st.pacing, published: !!body.published, version: (prev?.[0]?.version || 0) + 1, trained_from: Number(body.trainedFrom) || 0 };
    const { data, error } = await ctx.supabase.from('edit_styles').insert(row).select().single();
    if (error) throw fail(400, error.message);
    return data;
  }],
  ['POST', /^\/admin\/styles\/([0-9a-f-]{36})\/publish$/, async (ctx, body, [id]) => {
    await requireAdmin(ctx);
    const { data, error } = await ctx.supabase.from('edit_styles').update({ published: !!body.published }).eq('id', id).select().single();
    if (error) throw fail(400, error.message);
    return data;
  }],
  ['GET', /^\/admin\/examples\/([a-z0-9-]{1,40})$/, async (ctx, _b, [key]) => {
    await requireAdmin(ctx);
    const { data, error } = await ctx.supabase.from('training_examples').select('*').eq('edit_type', key).order('created_at', { ascending: false }).limit(200);
    if (error) throw fail(400, error.message);
    return { examples: (data || []).map(stripSource) };
  }],
  ['POST', /^\/admin\/examples$/, async (ctx, body) => {
    await requireAdmin(ctx);
    const key = String(body.editType || '');
    await typeInfo(ctx, key);
    const p = await loadProject(ctx, body.projectId);
    const { data: hist } = await ctx.supabase.from('project_history').select('timeline, source, created_at').eq('project_id', p.id).eq('source', 'ai').order('created_at', { ascending: true }).limit(1);
    let data;
    try {
      data = exampleFromProject(p, { aiTimeline: hist?.[0]?.timeline || null });
    } catch (e) {
      throw fail(400, e.message);
    }
    const row = { edit_type: key, title: String(body.title || p.name || '').slice(0, 120), notes: String(body.notes || '').slice(0, 2000), rating: Math.max(1, Math.min(5, Math.round(Number(body.rating) || 5))), data, source_project_id: p.id };
    const { data: saved, error } = await ctx.supabase.from('training_examples').insert(row).select().single();
    if (error) throw fail(400, error.message);
    return stripSource(saved);
  }],
  ['DELETE', /^\/admin\/examples\/([0-9a-f-]{36})$/, async (ctx, _b, [id]) => {
    await requireAdmin(ctx);
    const { error } = await ctx.supabase.from('training_examples').delete().eq('id', id);
    if (error) throw fail(400, error.message);
    return { ok: true };
  }],
  ['POST', /^\/admin\/train$/, async (ctx, body) => {
    await requireAdmin(ctx);
    const type = await typeInfo(ctx, String(body.key || ''));
    const { data: exs } = await ctx.supabase.from('training_examples').select('*').eq('edit_type', type.key).order('rating', { ascending: false }).limit(12);
    if (!exs?.length) throw fail(400, `Add at least one finished ${type.label} edit as an example first (3 or more works best).`);
    const current = await styleFor(ctx, type.key);
    const { data, meta } = await runJsonTask(ctx, null, 'train-style', trainPrompt(type, exs, current));
    const st = trainedStyle(data, type);
    if (!st.rules.length) throw fail(502, 'The AI did not return any rules. Try again or pick a more capable model.');
    const { data: prev } = await ctx.supabase.from('edit_styles').select('version').eq('key', type.key).order('version', { ascending: false }).limit(1);
    const row = { key: type.key, label: type.label, description: type.desc || '', rules: st.rules, examples: st.examples, pacing: st.pacing, published: false, version: (prev?.[0]?.version || 0) + 1, trained_from: exs.length };
    const { data: saved, error } = await ctx.supabase.from('edit_styles').insert(row).select().single();
    if (error) throw fail(400, error.message);
    return { style: saved, summary: st.summary, meta };
  }],
  ['GET', /^\/admin\/dataset\/([a-z0-9-]{1,40})$/, async (ctx, _b, [key]) => {
    await requireAdmin(ctx);
    const { data: exs } = await ctx.supabase.from('training_examples').select('*').eq('edit_type', key).limit(1000);
    const lines = fineTuneRecords(exs || [], planPrompt);
    return { filename: `editflow-${key}-finetune.jsonl`, count: lines.length, jsonl: lines.join('\n') };
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
  ['POST', /^\/ai\/visuals$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    if (!normalizeTimeline(p.timeline).clips.length) throw fail(400, 'Make a first cut before analysing the video.');
    const frames = (Array.isArray(body.frames) ? body.frames : []).filter((f) => b64ok(f?.data) && Number.isFinite(Number(f.t))).slice(0, MAX_FRAMES);
    if (frames.length < 2) throw fail(400, 'Could not read frames from the video. Check that the footage plays in the preview.');
    const library = (Array.isArray(body.library) ? body.library : []).filter((f) => b64ok(f?.data) && f.label).slice(0, MAX_LIBRARY);
    const all = await rows(ctx);
    const opts = cleanVisualOptions(body.options, p);
    const keys = stockKeys(all);
    const aiImages = opts.aiImages && !!load(all, 'openai').key;
    const prompt = visualsPrompt(p, frames.map((f) => Number(f.t)), library.map((f) => f.label), { ...opts, stock: keys.length > 0, aiImages });
    const images = [
      ...frames.map((f) => ({ label: `CUT FRAME at ${Number(f.t).toFixed(1)}s on the timeline:`, data: f.data })),
      ...library.map((f) => ({ label: `B-ROLL LIBRARY ${f.label}:`, data: f.data })),
    ];
    const { data, meta } = await runJsonTask(ctx, p, 'visuals', prompt, { images });
    const { ops, slots, notes } = planVisuals(data, p, opts);
    // Find footage for every slot the creator's own clips don't cover.
    const need = slots.filter((s) => !s.assetId && s.queries.length).slice(0, 10);
    let searched = 0;
    if (keys.length) {
      const errs = new Set();
      await mapLimit(need, 4, async (s) => {
        const { candidates, errors } = await findCandidates(keys, s, orientationFor(s.layout, opts.aspect));
        s.candidates = candidates;
        searched++;
        errors.forEach((e) => errs.add(e));
      });
      if (errs.size) notes.push(`Stock search: ${[...errs][0]}`);
    } else if (need.length) notes.push('Connect Pexels or Pixabay in AI settings (free keys) so Editflow can find stock footage automatically.');
    // Second look: the model compares the candidate thumbnails and picks per slot.
    const withCands = need.filter((s) => s.candidates?.length);
    let pickerMeta = null;
    if (withCands.length) {
      const thumbs = withCands.flatMap((s, i) => s.candidates.map((c, j) => ({ label: `S${i + 1} C${j + 1}:`, url: c.thumb })));
      try {
        const res = await runJsonTask(ctx, p, 'broll-pick', pickerPrompt(p, withCands), { images: thumbs });
        pickerMeta = res.meta;
        for (const pk of Array.isArray(res.data.picks) ? res.data.picks : []) {
          const s = withCands[Number(String(pk.slot || '').replace(/\D/g, '')) - 1];
          const c = s?.candidates[Number(String(pk.choice || '').replace(/\D/g, '')) - 1];
          if (s && c) ((s.pick = c), (s.pickWhy = String(pk.why || '').slice(0, 200)));
        }
      } catch (e) {
        // fall back to the first result of each search
        for (const s of withCands) s.pick = s.candidates[0];
        notes.push(`Picked the top stock result for each shot (the second look failed: ${e.message.slice(0, 120)}).`);
      }
    }
    const out = slots.map((s) => ({
      start: s.start,
      duration: s.duration,
      description: s.description,
      reason: s.pickWhy ? `${s.reason} · ${s.pickWhy}`.slice(0, 300) : s.reason,
      layout: s.layout,
      caption: s.caption,
      query: s.queries[0] || '',
      kind: s.kind,
      assetId: s.assetId,
      srcIn: s.srcIn,
      pick: publicCandidate(s.pick),
      generate: !s.assetId && !s.pick && aiImages && (s.imagePrompt || s.description) ? (s.imagePrompt || `Realistic photo: ${s.description}`).slice(0, 800) : null,
    }));
    const emptyIds = normalizeTimeline(p.timeline).broll.filter((b) => !b.assetId).map((b) => b.id);
    return {
      summary: String(data.summary || 'Visual suggestions').slice(0, 600),
      scenes: (Array.isArray(data.scenes) ? data.scenes : []).slice(0, 30).map((sc) => ({ start: Number(sc.start) || 0, end: Number(sc.end) || 0, what: String(sc.what || '').slice(0, 200) })),
      ops,
      broll: out,
      replaceBroll: out.length ? emptyIds : [],
      notes: [...(Array.isArray(data.notes) ? data.notes.map(String).slice(0, 6) : []), ...notes],
      meta: { ...meta, frames: frames.length, library: library.length, stockSearched: searched, stockSources: keys.map((k) => k.id), aiImages, picker: pickerMeta && { model: pickerMeta.model, usage: pickerMeta.usage } },
    };
  }],
  ['POST', /^\/broll\/search$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    const keys = stockKeys(await rows(ctx));
    if (!keys.length) throw fail(400, 'Connect Pexels or Pixabay in AI settings to search stock footage.', { code: 'no_stock' });
    const q = String(body.query || '').trim().slice(0, 100);
    if (!q) throw fail(400, 'Type what you want to see.');
    const kind = body.kind === 'photo' ? 'photo' : 'video';
    const orientation = orientationFor(body.layout, normalizeTimeline(p.timeline).format.aspect);
    const lists = await Promise.all(keys.map(({ id, key }) => searchStock(id, key, q, { kind, orientation, perPage: 12 }).catch((e) => ({ error: e.message }))));
    const candidates = [];
    for (let i = 0; i < 12; i++) for (const l of lists) if (Array.isArray(l) && l[i]) candidates.push(publicCandidate(l[i]));
    const errors = lists.filter((l) => l.error).map((l) => l.error);
    if (!candidates.length && errors.length) throw fail(502, errors[0]);
    return { candidates, sources: keys.map((k) => STOCK_SOURCES[k.id]) };
  }],
  ['POST', /^\/broll\/fetch$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    const all = await rows(ctx);
    const source = String(body.provider || '');
    const key = (keyOf(all, source));
    if (!STOCK_SOURCES[source] || !key) throw fail(400, 'That stock source is not connected.');
    const kind = body.kind === 'photo' ? 'photo' : 'video';
    const c = await resolveStock(source, key, body.id, kind);
    const file = pickFile(c.files, { minShort: kind === 'photo' ? 900 : 720, maxShort: kind === 'photo' ? 2000 : 1080 });
    if (!file) throw fail(404, 'No downloadable file for that clip.');
    const { buf } = await download(file.url, kind === 'photo' ? 20 * 1048576 : 45 * 1048576);
    const thumb = kind === 'photo' ? null : c.thumb ? await download(c.thumb, 3 * 1048576).then((r) => r.buf).catch(() => null) : null;
    const asset = await storeAsset(ctx, p, {
      buf,
      ext: kind === 'photo' ? '.jpg' : '.mp4',
      contentType: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
      thumb: kind === 'photo' ? buf.length < 3 * 1048576 ? buf : null : thumb,
      fields: {
        name: `${STOCK_SOURCES[source].name} ${kind} ${c.id}${c.author ? ` · ${c.author}` : ''}`.slice(0, 160),
        mediaType: kind === 'photo' ? 'image' : 'video',
        mime: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
        duration: kind === 'photo' ? 0 : c.duration || 0,
        width: file.width,
        height: file.height,
        stock: { provider: source, id: c.id, pageUrl: c.pageUrl, author: c.author, authorUrl: c.authorUrl, licence: STOCK_SOURCES[source].licence },
      },
    });
    await log(ctx, { project_id: p.id, provider: source, task: 'broll-fetch', ok: true });
    return { asset };
  }],
  ['POST', /^\/broll\/generate$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    const def = PROVIDERS.openai;
    requireConsent(p, 'openai', def.name, def.dataUse, 'images');
    const all = await rows(ctx);
    const { config, key } = load(all, 'openai');
    if (!key) throw fail(400, 'Add your OpenAI API key in AI settings to generate images.');
    const prompt = String(body.prompt || '').trim().slice(0, 800);
    if (!prompt) throw fail(400, 'Describe the image.');
    const orientation = orientationFor(body.layout, normalizeTimeline(p.timeline).format.aspect);
    try {
      const img = await generateImage(config, key, `${prompt}\n\nPhotographic, natural light, no text, no logos, no watermarks.`, orientation);
      const asset = await storeAsset(ctx, p, {
        buf: img.buf,
        ext: '.jpg',
        contentType: 'image/jpeg',
        thumb: img.buf,
        fields: { name: `AI image · ${prompt.slice(0, 60)}`, mediaType: 'image', mime: 'image/jpeg', duration: 0, width: img.width, height: img.height, generated: { provider: 'openai', model: img.model, prompt } },
      });
      await log(ctx, { project_id: p.id, provider: 'openai', task: 'broll-image', model: img.model, ok: true });
      return { asset };
    } catch (e) {
      await log(ctx, { project_id: p.id, provider: 'openai', task: 'broll-image', model: config.imageModel, ok: false, error: e.message.slice(0, 500) });
      throw e;
    }
  }],
  ['PUT', /^\/settings\/prefs$/, async (ctx, body) => {
    const all = await rows(ctx);
    const next = { ...prefsOf(all) };
    if ('aiImages' in body) next.aiImages = !!body.aiImages;
    await upsert(ctx, '_prefs', { config: next });
    return listProviders(ctx);
  }],
  ['POST', /^\/transcribe\/openai$/, async (ctx, body) => {
    const p = await loadProject(ctx, body.projectId);
    const def = PROVIDERS.openai;
    requireConsent(p, 'openai', def.name, def.dataUse, 'audio');
    const all = await rows(ctx);
    const { config, key } = load(all, 'openai');
    if (!key) throw fail(400, 'Add your OpenAI API key in AI settings to transcribe.');
    const path = String(body.path || '');
    if (!path.startsWith(`${ctx.user.id}/${p.id}/`)) throw fail(403, 'That audio file does not belong to this project.');
    const started = Date.now();
    await assertAllowed(ctx, 'transcribe_minutes', 1);
    try {
      const { data: blob, error } = await ctx.supabase.storage.from(MEDIA_BUCKET).download(path);
      if (error || !blob) throw fail(404, 'Could not read the uploaded audio.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const info = wavInfo(bytes);
      const samples = wavSamples(bytes, info);
      const chunks = speechChunks(samples, info.rate);
      if (!chunks.length) return { segments: [], chunks: 0 };
      if (chunks.length > 220) throw fail(400, 'This clip is too long to transcribe in one go (about 25 minutes max). Trim it or import a caption file.');
      const language = /^[a-z]{2}$/.test(body.language || '') ? body.language : '';
      const voice = voiceActivity(samples, info.rate);
      const timing = { on: (config.timingModel || 'whisper-1') !== 'off', exact: 0, approx: 0 };
      const sameModel = (config.timingModel || 'whisper-1') === (config.transcribeModel || 'gpt-transcribe');
      const perChunk = await mapLimit(chunks, 6, async (c) => {
        const wav = new Blob([wavSlice(samples, info.rate, c.start, c.end)], { type: 'audio/wav' });
        const opts = { language, prompt: FILLER_PROMPT };
        const [timed, text] = await Promise.all([
          timing.on
            ? def.transcribeWords(config, key, wav, opts).catch((e) => {
                // no word timing on this account/model: fall back to timing from the audio
                if (e.status === 404 || e.status === 400 || /model/i.test(e.message)) timing.on = false;
                else throw e;
                return null;
              })
            : null,
          sameModel && timing.on ? null : def.transcribe(config, key, wav, opts),
        ]);
        const said = text ?? timed?.text ?? '';
        const words = timed?.words?.length && tokens(said).length ? alignWords(tokens(said), timed.words) : null;
        if (words) {
          timing.exact++;
          return words.map((w) => ({ t: w.t, s: r3(c.start + Math.max(0, w.s)), e: r3(c.start + Math.max(w.s, w.e)) }));
        }
        if (!tokens(said).length) return [];
        timing.approx++;
        return estimateWords(said, c.start, c.end, voice).map((w) => ({ ...w, a: 1 }));
      });
      const all = perChunk.flat().filter((w) => w.t && !/^\W*$/.test(w.t)).sort((x, y) => x.s - y.s);
      const segments = segmentsFromWords(all).map((s) => ({ ...s, approx: s.words.some((w) => w.a) || undefined }));
      await log(ctx, { project_id: p.id, provider: 'openai', task: 'transcribe', model: config.transcribeModel, ok: true });
      await recordUsage(ctx, 'transcribe_minutes', Math.round((samples.length / info.rate / 60) * 10) / 10, p.id);
      return { segments, voice, timing: timing.exact && !timing.approx ? 'exact' : timing.exact ? 'mixed' : 'estimated', chunks: chunks.length, seconds: Math.round((Date.now() - started) / 1000) };
    } catch (e) {
      await log(ctx, { project_id: p.id, provider: 'openai', task: 'transcribe', model: config.transcribeModel, ok: false, error: e.message.slice(0, 500) });
      throw e.status && e.status < 500 && !String(e.message).match(/^\d{3} /) ? e : fail(502, `OpenAI transcription: ${e.message}`);
    } finally {
      await ctx.supabase.storage.from(MEDIA_BUCKET).remove([path]);
    }
  }],
];

// Nudges speech-to-text to write down "um", "uh" and false starts instead of silently dropping
// them, so the clean cut can find and remove them.
const FILLER_PROMPT = 'Umm, so, uh, I was- I was like, hmm, you know, thinking about it. Okay so, um, here is the thing.';
const r3 = (n) => Math.round(n * 1000) / 1000;

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
    if (path === '/health') return send(res, 200, { ok: true, secretConfigured: !!process.env.EDITFLOW_SECRET, supabaseUrl: SUPABASE_URL });
    // Payment provider webhooks arrive without a user session (see server/billing/index.js).
    if (path === '/billing/webhook') return send(res, 501, { error: 'Payments are not enabled yet.', code: 'billing_disabled' });
    const route = routes.find(([m, re]) => m === req.method && re.test(path));
    if (!route) return send(res, 404, { error: 'Not found' });
    const ctx = await authenticate(req);
    const body = req.method === 'GET' ? {} : await readBody(req, path === '/ai/visuals' ? 4_400_000 : 1_000_000);
    const out = await route[2](ctx, body, path.match(route[1]).slice(1));
    send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    send(res, status, { error: e.message || 'Something went wrong', code: e.code, provider: e.provider });
  }
}
