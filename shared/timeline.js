// Editflow edit model.
// Every change to a cut is an "op" (plain JSON). The server applies ops with this
// module, stores a snapshot in history, and the client uses the same module to
// preview what an AI proposal would change before the user applies it.
//
// Time conventions:
//   clip.in / clip.out ............ seconds in the SOURCE asset
//   caption.start / caption.end ... seconds in the SOURCE asset (captions follow their clip)
//   overlay / broll / graphic start  seconds on the TIMELINE (intentionally placed)
import { cleanGraphic, GRAPHIC_TYPES } from './graphics.js';
import { THEMES } from './gfx-core.js';
import { ANIMATED_CAPTION_STYLES } from './captions-anim.js';

export const ASPECTS = {
  '9:16': { label: 'Vertical 9:16', hint: 'TikTok, Reels, Shorts', w: 9, h: 16 },
  '1:1': { label: 'Square 1:1', hint: 'Feed posts', w: 1, h: 1 },
  '4:5': { label: 'Portrait 4:5', hint: 'Instagram & LinkedIn feed', w: 4, h: 5 },
  '16:9': { label: 'Landscape 16:9', hint: 'YouTube, websites', w: 16, h: 9 },
};

export const TRANSITIONS = {
  cut: 'Cut',
  fade: 'Fade through black',
  flash: 'Quick white flash',
};

export const OVERLAY_TEMPLATES = {
  title: { label: 'Big title', desc: 'Centered headline, great for the hook' },
  lowerThird: { label: 'Lower third', desc: 'Name or label near the bottom' },
  kicker: { label: 'Top kicker', desc: 'Small label at the top' },
  cta: { label: 'Call to action', desc: 'Bold box near the end' },
};

export const CAPTION_STYLES = {
  ...Object.fromEntries(Object.entries(ANIMATED_CAPTION_STYLES).map(([k, v]) => [k, v.label])),
  bold: 'Static · bold (white, heavy outline)',
  clean: 'Static · clean (white, soft shadow)',
  boxed: 'Static · boxed (text on dark box)',
  accent: 'Static · accent (warm yellow)',
};

export const BROLL_LAYOUTS = { full: 'Full screen', split: 'Split screen (top half)', card: 'Photo card (images)' };

export const STORY_ROLES = ['hook', 'context', 'progression', 'payoff', 'cta'];

export function uid(prefix = 'id') {
  const r = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}_${t}${r}`;
}

const round = (n) => Math.round(n * 1000) / 1000;
const clone = (o) => JSON.parse(JSON.stringify(o));

export function emptyTimeline(aspect = '9:16') {
  return {
    version: 1,
    format: { aspect },
    clips: [],
    captions: { enabled: true, style: 'pill', position: 'lower', items: [], emphasis: [] },
    overlays: [],
    graphics: [],
    broll: [],
    music: { assetId: null, mood: '', volume: 0.22, duck: true, notes: '' },
    audio: { normalize: true, denoise: false, voiceVolume: 1 },
    sound: [],
    style: { theme: 'editorial', captionColor: 'yellow' },
    sfx: { enabled: true, volume: 0.5 },
  };
}

export function normalizeTimeline(tl) {
  const base = emptyTimeline(tl?.format?.aspect);
  const t = { ...base, ...(tl || {}) };
  t.format = { ...base.format, ...(tl?.format || {}) };
  t.captions = { ...base.captions, ...(tl?.captions || {}) };
  t.captions.items = Array.isArray(t.captions.items) ? t.captions.items : [];
  t.music = { ...base.music, ...(tl?.music || {}) };
  t.audio = { ...base.audio, ...(tl?.audio || {}) };
  t.style = { ...base.style, ...(tl?.style || {}) };
  t.sfx = { ...base.sfx, ...(tl?.sfx || {}) };
  t.captions.emphasis = Array.isArray(t.captions.emphasis) ? t.captions.emphasis : [];
  // Older projects: keep their static caption style unless they choose an animated one.
  if (tl?.captions && !tl.captions.style) t.captions.style = 'bold';
  for (const k of ['clips', 'overlays', 'graphics', 'broll', 'sound']) t[k] = Array.isArray(t[k]) ? t[k] : [];
  return t;
}

export const clipDuration = (c) => Math.max(0, c.out - c.in);

/** Clips with timeline positions. */
export function layout(tl) {
  let t = 0;
  const clips = tl.clips.map((c) => {
    const d = clipDuration(c);
    const item = { ...c, tlStart: round(t), tlEnd: round(t + d), duration: round(d) };
    t += d;
    return item;
  });
  return { clips, duration: round(t) };
}

export function totalDuration(tl) {
  return layout(tl).duration;
}

/** Map a timeline time to { clip, index, sourceTime }. */
export function locate(tl, time) {
  const { clips } = layout(tl);
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (time >= c.tlStart && time < c.tlEnd) return { clip: c, index: i, sourceTime: c.in + (time - c.tlStart) };
  }
  const last = clips[clips.length - 1];
  if (last && Math.abs(time - last.tlEnd) < 1e-6) return { clip: last, index: clips.length - 1, sourceTime: last.out };
  return null;
}

/** Captions placed on the timeline (source-time captions mapped through clips). */
export function timelineCaptions(tl) {
  const out = [];
  const { clips } = layout(tl);
  for (const c of clips) {
    for (const cap of tl.captions.items) {
      if (cap.assetId !== c.assetId) continue;
      const s = Math.max(cap.start, c.in);
      const e = Math.min(cap.end, c.out);
      if (e - s < 0.15) continue;
      out.push({
        id: cap.id,
        clipId: c.id,
        start: round(c.tlStart + (s - c.in)),
        end: round(c.tlStart + (e - c.in)),
        text: cap.text,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function findIndex(list, id, what) {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`${what} "${id}" was not found`);
  return i;
}

function clampClip(c, ctx) {
  const asset = ctx?.assets?.find((a) => a.id === c.assetId);
  const max = asset?.duration ?? Infinity;
  c.in = round(Math.max(0, Math.min(c.in, max)));
  c.out = round(Math.max(c.in + 0.1, Math.min(c.out, max)));
  if (c.out - c.in < 0.1) throw new Error('A clip must be at least 0.1 seconds long');
  return c;
}

const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)));

/** Apply one op and return a NEW timeline. Throws a readable Error if the op is invalid. */
export function applyOp(tlIn, op, ctx = {}) {
  const tl = clone(normalizeTimeline(tlIn));
  switch (op?.type) {
    case 'trimClip': {
      const i = findIndex(tl.clips, op.clipId, 'Clip');
      const c = tl.clips[i];
      if (typeof op.in === 'number') c.in = op.in;
      if (typeof op.out === 'number') c.out = op.out;
      clampClip(c, ctx);
      break;
    }
    case 'moveClip': {
      const i = findIndex(tl.clips, op.clipId, 'Clip');
      const [c] = tl.clips.splice(i, 1);
      const to = Math.max(0, Math.min(tl.clips.length, Math.round(op.toIndex)));
      tl.clips.splice(to, 0, c);
      break;
    }
    case 'splitClip': {
      const loc = locate(tl, op.at);
      if (!loc) throw new Error('Move the playhead over a clip to split it');
      const c = tl.clips[loc.index];
      const at = round(loc.sourceTime);
      if (at - c.in < 0.1 || c.out - at < 0.1) throw new Error('Too close to the clip edge to split');
      const second = { ...clone(c), id: op.newId || uid('clip'), in: at, transitionIn: 'cut' };
      c.out = at;
      tl.clips.splice(loc.index + 1, 0, second);
      break;
    }
    case 'deleteClip': {
      const i = findIndex(tl.clips, op.clipId, 'Clip');
      tl.clips.splice(i, 1);
      break;
    }
    case 'addClip': {
      if (!op.assetId) throw new Error('addClip needs an assetId');
      const c = clampClip(
        {
          id: op.clipId || uid('clip'),
          assetId: op.assetId,
          in: Number(op.in) || 0,
          out: Number(op.out) || (Number(op.in) || 0) + 3,
          volume: 1,
          zoom: 1,
          transitionIn: 'cut',
          role: op.role || '',
          note: op.note || '',
        },
        ctx,
      );
      const idx = typeof op.index === 'number' ? Math.max(0, Math.min(tl.clips.length, op.index)) : tl.clips.length;
      tl.clips.splice(idx, 0, c);
      break;
    }
    case 'updateClip': {
      const i = findIndex(tl.clips, op.clipId, 'Clip');
      const patch = pick(op.patch, ['volume', 'transitionIn', 'role', 'note', 'zoom']);
      if ('volume' in patch) patch.volume = Math.max(0, Math.min(2, Number(patch.volume)));
      if ('zoom' in patch) patch.zoom = Math.round(Math.max(1, Math.min(1.6, Number(patch.zoom) || 1)) * 100) / 100;
      if ('transitionIn' in patch && !TRANSITIONS[patch.transitionIn]) throw new Error('Unknown transition');
      Object.assign(tl.clips[i], patch);
      break;
    }
    case 'addCaption': {
      tl.captions.items.push({
        id: op.captionId || uid('cap'),
        assetId: op.assetId,
        start: round(op.start),
        end: round(Math.max(op.start + 0.2, op.end)),
        text: String(op.text || '').slice(0, 200),
      });
      tl.captions.items.sort((a, b) => a.start - b.start);
      break;
    }
    case 'updateCaption': {
      const i = findIndex(tl.captions.items, op.captionId, 'Caption');
      const patch = pick(op.patch, ['text', 'start', 'end']);
      if ('text' in patch) patch.text = String(patch.text).slice(0, 200);
      Object.assign(tl.captions.items[i], patch);
      break;
    }
    case 'deleteCaption': {
      const i = findIndex(tl.captions.items, op.captionId, 'Caption');
      tl.captions.items.splice(i, 1);
      break;
    }
    case 'setCaptionStyle': {
      const patch = pick(op.patch, ['enabled', 'style', 'position', 'emphasis']);
      if (patch.style && !CAPTION_STYLES[patch.style]) throw new Error('Unknown caption style');
      if ('emphasis' in patch) patch.emphasis = (Array.isArray(patch.emphasis) ? patch.emphasis : []).map((w) => String(w).slice(0, 40)).filter(Boolean).slice(0, 60);
      Object.assign(tl.captions, patch);
      break;
    }
    case 'addOverlay': {
      const o = op.overlay || {};
      if (!OVERLAY_TEMPLATES[o.template]) throw new Error('Unknown text template');
      tl.overlays.push({
        id: o.id || uid('txt'),
        template: o.template,
        text: String(o.text || 'Your text').slice(0, 120),
        sub: String(o.sub || '').slice(0, 120),
        start: round(Math.max(0, Number(o.start) || 0)),
        duration: round(Math.max(0.5, Number(o.duration) || 2.5)),
      });
      break;
    }
    case 'updateOverlay': {
      const i = findIndex(tl.overlays, op.overlayId, 'Text overlay');
      const patch = pick(op.patch, ['template', 'text', 'sub', 'start', 'duration']);
      if (patch.template && !OVERLAY_TEMPLATES[patch.template]) throw new Error('Unknown text template');
      Object.assign(tl.overlays[i], patch);
      break;
    }
    case 'deleteOverlay': {
      tl.overlays.splice(findIndex(tl.overlays, op.overlayId, 'Text overlay'), 1);
      break;
    }
    case 'addGraphic': {
      const g = cleanGraphic(op.graphic || {});
      g.id = op.graphic?.id || uid('gfx');
      tl.graphics.push(g);
      tl.graphics.sort((a, b) => a.start - b.start);
      break;
    }
    case 'updateGraphic': {
      const i = findIndex(tl.graphics, op.graphicId, 'Motion graphic');
      const patch = pick(op.patch, ['type', 'start', 'duration', 'text', 'sub', 'body', 'items', 'values', 'labels', 'x', 'y', 'color', 'position', 'layout', 'variant', 'assetId', 'sfx']);
      tl.graphics[i] = { ...cleanGraphic(patch, tl.graphics[i]), id: tl.graphics[i].id };
      tl.graphics.sort((a, b) => a.start - b.start);
      break;
    }
    case 'deleteGraphic': {
      tl.graphics.splice(findIndex(tl.graphics, op.graphicId, 'Motion graphic'), 1);
      break;
    }
    case 'addBroll': {
      const b = op.broll || {};
      tl.broll.push({
        id: b.id || uid('broll'),
        start: round(Math.max(0, Number(b.start) || 0)),
        duration: round(Math.max(0.5, Number(b.duration) || 2)),
        description: String(b.description || 'Cutaway shot').slice(0, 200),
        reason: String(b.reason || '').slice(0, 300),
        assetId: b.assetId || null,
        srcIn: Number(b.srcIn) || 0,
        layout: BROLL_LAYOUTS[b.layout] ? b.layout : 'full',
        caption: String(b.caption || '').slice(0, 80),
        query: String(b.query || '').slice(0, 120),
      });
      tl.broll.sort((a, b2) => a.start - b2.start);
      break;
    }
    case 'updateBroll': {
      const i = findIndex(tl.broll, op.brollId, 'B-roll');
      const patch = pick(op.patch, ['start', 'duration', 'description', 'reason', 'assetId', 'srcIn', 'layout', 'caption', 'query']);
      if ('layout' in patch && !BROLL_LAYOUTS[patch.layout]) throw new Error('Unknown B-roll layout');
      Object.assign(tl.broll[i], patch);
      tl.broll.sort((a, b2) => a.start - b2.start);
      break;
    }
    case 'deleteBroll': {
      tl.broll.splice(findIndex(tl.broll, op.brollId, 'B-roll'), 1);
      break;
    }
    case 'setMusic': {
      const patch = pick(op.patch, ['assetId', 'mood', 'volume', 'duck', 'notes']);
      if ('volume' in patch) patch.volume = Math.max(0, Math.min(1, Number(patch.volume)));
      Object.assign(tl.music, patch);
      break;
    }
    case 'setAudio': {
      const patch = pick(op.patch, ['normalize', 'denoise', 'voiceVolume']);
      if ('voiceVolume' in patch) patch.voiceVolume = Math.max(0, Math.min(2, Number(patch.voiceVolume)));
      Object.assign(tl.audio, patch);
      break;
    }
    case 'setStyle': {
      const patch = pick(op.patch, ['theme', 'captionColor']);
      if (patch.theme && !THEMES[patch.theme]) throw new Error('Unknown look');
      Object.assign(tl.style, patch);
      break;
    }
    case 'setSfx': {
      const patch = pick(op.patch, ['enabled', 'volume']);
      if ('volume' in patch) patch.volume = Math.max(0, Math.min(1, Number(patch.volume)));
      if ('enabled' in patch) patch.enabled = !!patch.enabled;
      Object.assign(tl.sfx, patch);
      break;
    }
    case 'setFormat': {
      const patch = pick(op.patch, ['aspect']);
      if (patch.aspect && !ASPECTS[patch.aspect]) throw new Error('Unsupported aspect ratio');
      Object.assign(tl.format, patch);
      break;
    }
    case 'setSound': {
      tl.sound = (op.items || []).slice(0, 30).map((s) => ({
        id: s.id || uid('sfx'),
        at: round(Number(s.at) || 0),
        description: String(s.description || '').slice(0, 200),
      }));
      break;
    }
    case 'replaceTimeline': {
      const next = normalizeTimeline(op.timeline);
      next.clips.forEach((c) => clampClip(c, ctx));
      return next;
    }
    default:
      throw new Error(`Unknown edit action "${op?.type}"`);
  }
  return tl;
}

/** Apply a list of ops; invalid ops are skipped and reported instead of breaking the whole change. */
export function applyOps(tl, ops, ctx = {}) {
  let cur = normalizeTimeline(tl);
  const applied = [];
  const errors = [];
  for (const op of ops || []) {
    try {
      cur = applyOp(cur, op, ctx);
      applied.push(op);
    } catch (e) {
      errors.push({ op, error: e.message });
    }
  }
  return { timeline: cur, applied, errors };
}

const fmt = (s) => {
  if (typeof s !== 'number' || Number.isNaN(s)) return '?';
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${r}`;
};
export const formatTime = fmt;

/** Human-readable description of an op (used in change previews and history). */
export function describeOp(op, tl) {
  const clipName = (id) => {
    const i = tl?.clips?.findIndex((c) => c.id === id);
    return i >= 0 ? `clip ${i + 1}` : 'a clip';
  };
  switch (op.type) {
    case 'trimClip':
      return `Trim ${clipName(op.clipId)}${typeof op.in === 'number' ? ` start → ${fmt(op.in)}` : ''}${typeof op.out === 'number' ? ` end → ${fmt(op.out)}` : ''}`;
    case 'moveClip':
      return `Move ${clipName(op.clipId)} to position ${op.toIndex + 1}`;
    case 'splitClip':
      return `Split at ${fmt(op.at)}`;
    case 'deleteClip':
      return `Remove ${clipName(op.clipId)}`;
    case 'addClip':
      return `Add a clip (${fmt(op.in)}–${fmt(op.out)})`;
    case 'updateClip':
      return op.patch && Object.keys(op.patch).length === 1 && 'zoom' in op.patch
        ? `${op.patch.zoom > 1 ? `Punch in ${Math.round((op.patch.zoom - 1) * 100)}% on` : 'Reset zoom on'} ${clipName(op.clipId)}`
        : `Change ${clipName(op.clipId)}: ${Object.entries(op.patch || {}).map(([k, v]) => `${k} = ${v}`).join(', ')}`;
    case 'addCaption':
      return `Add caption "${op.text}"`;
    case 'updateCaption':
      return op.patch?.text ? `Edit caption → "${op.patch.text}"` : 'Retime a caption';
    case 'deleteCaption':
      return 'Remove a caption';
    case 'setCaptionStyle':
      return `Caption style: ${Object.entries(op.patch || {}).map(([k, v]) => `${k} = ${v}`).join(', ')}`;
    case 'addOverlay':
      return `Add ${OVERLAY_TEMPLATES[op.overlay?.template]?.label || 'text'} "${op.overlay?.text}" at ${fmt(op.overlay?.start)}`;
    case 'updateOverlay':
      return 'Edit a text overlay';
    case 'deleteOverlay':
      return 'Remove a text overlay';
    case 'addGraphic':
      return `Add ${GRAPHIC_TYPES[op.graphic?.type]?.label.toLowerCase() || 'motion graphic'}${op.graphic?.text ? ` "${String(op.graphic.text).replace(/\*/g, '')}"` : ''} at ${fmt(op.graphic?.start)}`;
    case 'updateGraphic':
      return 'Edit a motion graphic';
    case 'deleteGraphic':
      return 'Remove a motion graphic';
    case 'addBroll':
      return `${op.broll?.assetId ? 'Add' : 'Suggest'} B-roll at ${fmt(op.broll?.start)}: ${op.broll?.description}`;
    case 'updateBroll':
      return 'Edit a B-roll shot';
    case 'deleteBroll':
      return 'Remove a B-roll shot';
    case 'setMusic':
      return `Music: ${Object.entries(op.patch || {}).map(([k, v]) => `${k} = ${v}`).join(', ')}`;
    case 'setAudio':
      return `Voice audio: ${Object.entries(op.patch || {}).map(([k, v]) => `${k} = ${v}`).join(', ')}`;
    case 'setFormat':
      return `Format → ${op.patch?.aspect}`;
    case 'setStyle':
      return op.patch?.theme ? `Look → ${THEMES[op.patch.theme]?.label || op.patch.theme}` : 'Change caption colour';
    case 'setSfx':
      return op.patch && 'enabled' in op.patch ? `Sound effects ${op.patch.enabled ? 'on' : 'off'}` : 'Sound effects volume';
    case 'setSound':
      return `Update ${op.items?.length || 0} sound design notes`;
    case 'replaceTimeline':
      return op.label || 'Replace the whole cut';
    default:
      return op.type;
  }
}

/** Short summary of what differs between two timelines (for the change preview). */
export function diffSummary(before, after) {
  const a = layout(normalizeTimeline(before));
  const b = layout(normalizeTimeline(after));
  const lines = [];
  if (a.clips.length !== b.clips.length) lines.push(`Clips: ${a.clips.length} → ${b.clips.length}`);
  if (Math.abs(a.duration - b.duration) > 0.05) lines.push(`Length: ${fmt(a.duration)} → ${fmt(b.duration)}`);
  const orderA = a.clips.map((c) => c.id).join(',');
  const orderB = b.clips.map((c) => c.id).join(',');
  if (orderA !== orderB && a.clips.length === b.clips.length) lines.push('Clip order changed');
  const na = normalizeTimeline(before);
  const nb = normalizeTimeline(after);
  if (na.overlays.length !== nb.overlays.length) lines.push(`Text overlays: ${na.overlays.length} → ${nb.overlays.length}`);
  if (na.graphics.length !== nb.graphics.length) lines.push(`Motion graphics: ${na.graphics.length} → ${nb.graphics.length}`);
  if (na.broll.length !== nb.broll.length) lines.push(`B-roll shots: ${na.broll.length} → ${nb.broll.length}`);
  else if (na.broll.filter((b) => b.assetId).length !== nb.broll.filter((b) => b.assetId).length) lines.push(`B-roll with footage: ${na.broll.filter((b) => b.assetId).length} → ${nb.broll.filter((b) => b.assetId).length}`);
  if (JSON.stringify(na.music) !== JSON.stringify(nb.music)) lines.push('Music settings changed');
  if (JSON.stringify(na.audio) !== JSON.stringify(nb.audio)) lines.push('Voice audio settings changed');
  if (JSON.stringify(na.captions) !== JSON.stringify(nb.captions)) lines.push('Captions changed');
  const zoomed = (t) => t.clips.filter((c) => (c.zoom || 1) > 1).length;
  if (zoomed(na) !== zoomed(nb)) lines.push(`Punch-in zooms: ${zoomed(na)} → ${zoomed(nb)}`);
  if (JSON.stringify(na.style) !== JSON.stringify(nb.style)) lines.push('Look changed');
  return lines;
}
