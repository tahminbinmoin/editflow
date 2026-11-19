// Story plan → editable timeline.
// The AI (or the rule-based drafter) never writes raw timestamps for clips; it refers to
// transcript segment IDs. That keeps plans grounded in the actual footage and prevents
// invented times. This module validates a plan and turns it into timeline data.

import { emptyTimeline, uid, layout, STORY_ROLES, OVERLAY_TEMPLATES } from './timeline.js';
import { cutLines, wordIndex, DEFAULT_CUT, CUT_MODES } from './cleancut.js';

const round = (n) => Math.round(n * 1000) / 1000;

export function cleanPlan(raw, segments) {
  const ids = new Set(segments.map((s) => s.id));
  const warnings = [];
  const segList = (arr, ctx) => {
    const out = (Array.isArray(arr) ? arr : [arr]).map(String).filter((id) => {
      if (ids.has(id)) return true;
      warnings.push(`Ignored unknown transcript line "${id}" in ${ctx}`);
      return false;
    });
    return out;
  };
  const str = (v, n = 400) => (v == null ? '' : String(v).slice(0, n));
  const role = (r) => (STORY_ROLES.includes(String(r).toLowerCase()) ? String(r).toLowerCase() : '');

  const plan = {
    summary: str(raw?.summary, 800),
    hookOptions: (raw?.hookOptions || []).slice(0, 4).map((h) => ({
      text: str(h.text, 200),
      segmentIds: segList(h.segmentIds || [], 'hook options'),
      why: str(h.why),
    })),
    hookTitle: str(raw?.hookTitle, 80),
    beats: (raw?.beats || []).slice(0, 8).map((b) => ({
      role: role(b.role) || 'progression',
      title: str(b.title, 120),
      segmentIds: segList(b.segmentIds || [], 'story beats'),
      why: str(b.why),
    })),
    clips: (raw?.clips || [])
      .slice(0, 60)
      .map((c) => ({
        segmentIds: segList(c.segmentIds || [], 'clip order'),
        role: role(c.role),
        note: str(c.note, 200),
        trimStartWords: Math.max(0, Math.min(12, Math.round(Number(c.trimStartWords) || 0))),
        trimEndWords: Math.max(0, Math.min(12, Math.round(Number(c.trimEndWords) || 0))),
      }))
      .filter((c) => c.segmentIds.length),
    captions: (raw?.captions || [])
      .slice(0, 200)
      .filter((c) => ids.has(String(c.segmentId)))
      .map((c) => ({ segmentId: String(c.segmentId), text: str(c.text, 200) })),
    broll: (raw?.broll || [])
      .slice(0, 12)
      .filter((b) => ids.has(String(b.segmentId)))
      .map((b) => ({ segmentId: String(b.segmentId), description: str(b.description, 200), reason: str(b.reason, 300) })),
    overlays: (raw?.overlays || [])
      .slice(0, 8)
      .filter((o) => ids.has(String(o.segmentId)) && OVERLAY_TEMPLATES[o.template])
      .map((o) => ({ segmentId: String(o.segmentId), template: o.template, text: str(o.text, 100) })),
    music: { mood: str(raw?.music?.mood, 80), tempo: str(raw?.music?.tempo, 40), notes: str(raw?.music?.notes, 300) },
    soundDesign: (raw?.soundDesign || [])
      .slice(0, 12)
      .filter((s) => ids.has(String(s.segmentId)))
      .map((s) => ({ segmentId: String(s.segmentId), description: str(s.description, 200) })),
    audio: {
      suggestions: (raw?.audio?.suggestions || []).slice(0, 6).map((s) => str(s, 200)),
      normalize: raw?.audio?.normalize !== false,
      denoise: !!raw?.audio?.denoise,
    },
    review: (raw?.review || []).slice(0, 10).map((r) => str(r, 240)),
    changes: (raw?.changes || []).slice(0, 10).map((r) => str(r, 240)),
  };
  if (!plan.clips.length) warnings.push('The plan did not include any usable clips.');
  return { plan, warnings };
}

const FILLERS = /\b(um+|uh+|erm+|ah+)\b[,.]?\s*/gi;

/** Split a caption into short, balanced chunks (short-form captions read best at 2–5 words). */
export function chunkCaption(text, start, end, maxWords = 5) {
  const clean = String(text).replace(FILLERS, '').replace(/\s{2,}/g, ' ').replace(/^[,\s]+/, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const n = Math.ceil(words.length / maxWords);
  const per = Math.ceil(words.length / n);
  const groups = [];
  for (let i = 0; i < words.length; i += per) groups.push(words.slice(i, i + per).join(' '));
  const totalChars = groups.reduce((sum, g) => sum + g.length, 0) || 1;
  let t = start;
  return groups.map((g) => {
    const d = ((end - start) * g.length) / totalChars;
    const item = { start: round(t), end: round(t + d), text: g };
    t += d;
    return item;
  });
}

/**
 * Build a timeline from a cleaned plan. Keeps the music file and look from `previous` if present.
 * The lines the plan chose are cut by the clean-cut engine (cleancut.js): no silence, no fillers,
 * stutters, retakes or mumbling, cuts on the real edges of the voice, captions word by word.
 * Pass `transcript` + `assets` (with voice maps) for the exact cut; with only `segments` the
 * word timing is estimated.
 */
export function planToTimeline(plan, segments, { aspect = '9:16', previous = null, transcript = null, assets = [], mode = DEFAULT_CUT, punchIn = true } = {}) {
  const seg = Object.fromEntries(segments.map((s) => [s.id, s]));
  const tl = emptyTimeline(aspect);
  if (previous) {
    tl.music.assetId = previous.music?.assetId || null;
    tl.music.volume = previous.music?.volume ?? tl.music.volume;
    tl.captions.style = previous.captions?.style || tl.captions.style;
    if (previous.style) tl.style = { ...tl.style, ...previous.style };
    if (previous.sfx) tl.sfx = { ...tl.sfx, ...previous.sfx };
  }
  tl.cut = { mode: CUT_MODES[mode] ? mode : DEFAULT_CUT, punchIn };
  const idx = wordIndex(transcript || { segments }, assets);
  const segToClip = {};
  for (const c of plan.clips) {
    const out = cutLines(c.segmentIds, idx, seg, { mode: tl.cut.mode, trimStartWords: c.trimStartWords, trimEndWords: c.trimEndWords, role: c.role, note: c.note, punchIn });
    for (const clip of out.clips) {
      for (const sid of clip.segs) segToClip[sid] ||= clip.id;
      delete clip.segs;
      tl.clips.push(clip);
    }
    tl.captions.items.push(...out.captions);
  }
  tl.captions.items.sort((a, b) => a.start - b.start);

  const { clips } = layout(tl);
  const tlTimeOf = (segmentId) => {
    const s = seg[segmentId];
    const c = clips.find((x) => x.id === segToClip[segmentId]);
    if (!s || !c) return null;
    return { start: round(c.tlStart + Math.max(0, s.start - c.in)), dur: s.end - s.start };
  };

  if (plan.hookTitle) tl.overlays.push({ id: uid('txt'), template: 'title', text: plan.hookTitle, sub: '', start: 0, duration: 2.2 });
  for (const o of plan.overlays) {
    const t = tlTimeOf(o.segmentId);
    if (t) tl.overlays.push({ id: uid('txt'), template: o.template, text: o.text, sub: '', start: t.start, duration: round(Math.min(3, Math.max(1.2, t.dur))) });
  }
  for (const b of plan.broll) {
    const t = tlTimeOf(b.segmentId);
    if (t) tl.broll.push({ id: uid('broll'), start: round(t.start + 0.3), duration: round(Math.min(2.5, Math.max(1, t.dur - 0.4))), description: b.description, reason: b.reason, assetId: null, srcIn: 0 });
  }
  tl.sound = plan.soundDesign
    .map((s) => {
      const t = tlTimeOf(s.segmentId);
      return t ? { id: uid('sfx'), at: t.start, description: s.description } : null;
    })
    .filter(Boolean);
  tl.music.mood = plan.music.mood;
  tl.music.notes = [plan.music.tempo, plan.music.notes].filter(Boolean).join(' · ');
  tl.audio.normalize = plan.audio.normalize;
  tl.audio.denoise = plan.audio.denoise;
  return tl;
}
