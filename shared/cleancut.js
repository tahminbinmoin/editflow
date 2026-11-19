// Clean cut: turns "which lines go in the reel" into frame-tight clips with no silence,
// no fillers, no stutters, no abandoned takes and no mumbling, and word-exact captions.
//
// Inputs are the transcript (segments with words) and each file's voice map (asset.voice,
// [[start, end], …] where there is sound; see voiceActivity in speech.js).
//  - Cuts sit on word boundaries, pulled out to the real edge of the voice (speech-to-text word
//    times are often 50–150 ms short), with a few ms of lead/tail so consonants aren't clipped.
//  - Any pause longer than the mode's `maxPause` is removed (jump cut).
//  - Voice with no words in it (mumbling, "mm", lip noise, half-words the speech-to-text skipped)
//    is cut out.
// Pure functions; the same code runs in the browser, on the server (critic pass) and in tests.

import { estimateWords, flagWords, voicedWithin, captionWord, tokens } from './words.js';
import { uid, layout, normalizeTimeline } from './timeline.js';

export const CUT_MODES = {
  natural: { label: 'Natural', desc: 'Keeps short breaths (pauses up to 0.3 s)', maxPause: 0.3, lead: 0.06, tail: 0.1 },
  tight: { label: 'Tight', desc: 'Reel pacing: pauses over 0.15 s are cut', maxPause: 0.15, lead: 0.04, tail: 0.08 },
  ultra: { label: 'Ultra-tight', desc: 'Back-to-back words, every gap cut', maxPause: 0.07, lead: 0.03, tail: 0.06 },
};
export const DEFAULT_CUT = 'tight';
const MUMBLE = 0.14; // voice this long with no word in it is cut
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const len = (parts) => parts.reduce((n, [s, e]) => n + (e - s), 0);

/** All words of one file in source order: [{ t, s, e, seg, i, flag, keep, approx }]. */
export function assetWords(transcript, assetId, voice) {
  const segs = (transcript?.segments || []).filter((s) => s.assetId === assetId).sort((a, b) => a.start - b.start);
  const list = [];
  for (const seg of segs) {
    const exact = Array.isArray(seg.words) && seg.words.length;
    const ws = exact ? seg.words : estimateWords(seg.text, seg.start, seg.end, voice);
    ws.forEach((w, i) => list.push({ ...w, seg: seg.id, i, approx: !exact || !!seg.approx }));
  }
  const flags = flagWords(list, list.some((w) => !w.approx) ? voice : null);
  list.forEach((w, k) => {
    w.flag = flags[k];
    w.keep = !!w.k || (!w.c && !flags[k]);
  });
  return list;
}

/** Words cache per file for one transcript (assetWords is not free on long recordings). */
export function wordIndex(transcript, assets = []) {
  const voiceOf = Object.fromEntries((assets || []).map((a) => [a.id, a.voice || null]));
  const cache = {};
  return {
    voice: (assetId) => voiceOf[assetId] || null,
    words: (assetId) => (cache[assetId] ||= assetWords(transcript, assetId, voiceOf[assetId])),
  };
}

/**
 * Keep-ranges for a run of words (source order). `seq` includes the dropped words too, so the
 * cut knows where the next sound starts. Returns [{ in, out, words: [kept words] }].
 */
export function cutRanges(seq, voice, mode = DEFAULT_CUT, { before = null, after = null } = {}) {
  const m = CUT_MODES[mode] || CUT_MODES[DEFAULT_CUT];
  const runs = [];
  let cur = null;
  for (let i = 0; i < seq.length; i++) {
    const w = seq[i];
    if (!w.keep) {
      cur = null;
      continue;
    }
    const prev = seq[i - 1];
    if (cur && prev?.keep) {
      const gapA = prev.e;
      const gapB = w.s;
      const voiced = voice?.length ? voicedWithin(voice, gapA + 0.02, gapB - 0.02) : [];
      const silence = gapB - gapA - len(voiced);
      const mumble = voiced.some(([s, e]) => e - s >= MUMBLE);
      if (silence > m.maxPause || mumble) cur = null;
    }
    if (!cur) runs.push((cur = { first: i, last: i }));
    else cur.last = i;
  }
  const out = [];
  for (const r of runs) {
    const a = seq[r.first];
    const b = seq[r.last];
    const prevEnd = r.first > 0 ? seq[r.first - 1].e : before ?? -Infinity;
    const nextStart = r.last < seq.length - 1 ? seq[r.last + 1].s : after ?? Infinity;
    let start = a.s;
    let end = b.e;
    if (voice?.length) {
      // pull the edges out to where the voice really starts/ends (never into a neighbour word)
      const vs = voice.find(([s, e]) => e > a.s && s < a.s + 0.12);
      if (vs && vs[0] < start && vs[0] >= a.s - 0.25) start = vs[0];
      const ve = voice.find(([s, e]) => s < b.e && e > b.e - 0.12);
      if (ve && ve[1] > end) end = Math.min(ve[1], b.e + 0.35);
    }
    const inPt = Math.max(0, prevEnd + 0.01, start - m.lead);
    const outPt = Math.min(nextStart - 0.01, end + m.tail);
    if (outPt - inPt < 0.12) continue;
    out.push({ in: r3(inPt), out: r3(outPt), words: seq.slice(r.first, r.last + 1).filter((w) => w.keep) });
  }
  // touching ranges become one
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r.in - last.out < 0.02) {
      last.out = r.out;
      last.words.push(...r.words);
    } else merged.push(r);
  }
  return merged;
}

/** Short, readable caption chunks (≤ 3 words / 18 characters) with exact word timing (source time). */
export function captionsFor(range, assetId, { maxWords = 3, maxChars = 18 } = {}) {
  const ws = range.words.filter((w) => captionWord(w.t));
  const groups = [];
  let g = null;
  for (const w of ws) {
    const word = captionWord(w.t);
    const chars = g ? g.reduce((n, x) => n + captionWord(x.t).length + 1, 0) + word.length : word.length;
    if (!g || g.closed || g.length >= maxWords || chars > maxChars) groups.push((g = [w]));
    else g.push(w);
    if (/[.!?,;:]$/.test(w.t)) g.closed = true;
  }
  const items = groups.filter((x) => x.length);
  return items.map((grp, k) => {
    const start = Math.max(range.in, grp[0].s);
    const next = items[k + 1];
    const end = Math.min(range.out, next ? Math.max(start + 0.1, next[0].s) : grp[grp.length - 1].e + 0.25);
    return {
      id: uid('cap'),
      assetId,
      start: r3(start),
      end: r3(Math.max(start + 2 / 30, end)),
      text: grp.map((w) => captionWord(w.t)).join(' '),
      w: grp.map((w) => [r3(Math.max(start, w.s)), r3(Math.min(end, w.e))]),
    };
  });
}

/**
 * Clips + captions for one story clip: an ordered list of transcript lines, optionally with
 * kept words trimmed off the start of the first line / end of the last line.
 */
export function cutLines(segIds, idx, segById, { mode = DEFAULT_CUT, trimStartWords = 0, trimEndWords = 0, role = '', note = '', punchIn = true } = {}) {
  // group lines that follow each other in the same file, so the cut sees the real neighbours
  const groups = [];
  for (const id of segIds) {
    const seg = segById[id];
    if (!seg) continue;
    const words = idx.words(seg.assetId);
    const mine = words.filter((w) => w.seg === id);
    if (!mine.length) continue;
    const a = words.indexOf(mine[0]);
    const b = words.indexOf(mine[mine.length - 1]);
    const last = groups[groups.length - 1];
    if (last && last.assetId === seg.assetId && a === last.b + 1) last.b = b;
    else groups.push({ assetId: seg.assetId, a, b });
  }
  const clips = [];
  const captions = [];
  groups.forEach((g, gi) => {
    const all = idx.words(g.assetId);
    const seq = all.slice(g.a, g.b + 1).map((w) => ({ ...w }));
    const kept = seq.filter((w) => w.keep);
    if (gi === 0) kept.slice(0, trimStartWords).forEach((w) => (w.keep = false));
    if (gi === groups.length - 1 && trimEndWords > 0) kept.slice(-trimEndWords).forEach((w) => (w.keep = false));
    const before = g.a > 0 ? all[g.a - 1].e : null;
    const after = g.b < all.length - 1 ? all[g.b + 1].s : null;
    const ranges = cutRanges(seq, idx.voice(g.assetId), mode, { before, after });
    // The group remembers which words it covers, so it can be re-cut later (restored words,
    // another cut mode) without touching the rest of the edit.
    // all words of the lines (auto-cut ones included, so they can be restored), minus words the
    // story edit trimmed off on purpose
    let s0 = seq[0].s;
    let s1 = seq[seq.length - 1].e;
    if (gi === 0 && trimStartWords > 0) s0 = seq.find((w) => w.keep)?.s ?? s0;
    if (gi === groups.length - 1 && trimEndWords > 0) s1 = [...seq].reverse().find((w) => w.keep)?.e ?? s1;
    const span = [s0, s1];
    const grp = uid('grp');
    let zoomed = false;
    ranges.forEach((r, ri) => {
      // jump cuts inside one take alternate a gentle punch-in so they read as intentional
      const jump = ri > 0 && r.in - ranges[ri - 1].out < 3;
      zoomed = punchIn && jump ? !zoomed : false;
      clips.push({
        id: uid('clip'),
        assetId: g.assetId,
        in: r2(Math.floor(r.in * 100) / 100),
        out: r2(Math.ceil(r.out * 100) / 100),
        volume: 1,
        zoom: zoomed ? 1.12 : 1,
        transitionIn: 'cut',
        role,
        note: clips.length === 0 ? note : '',
        grp,
        span: [r3(span[0]), r3(span[1])],
        segs: [...new Set(r.words.map((w) => w.seg))],
      });
      captions.push(...captionsFor(r, g.assetId));
    });
  });
  return { clips, captions };
}

/** Kept words of a line, as text (what will actually be heard). */
export function spokenText(segId, idx, segById) {
  const seg = segById[segId];
  if (!seg) return '';
  return idx
    .words(seg.assetId)
    .filter((w) => w.seg === segId && w.keep)
    .map((w) => w.t)
    .join(' ');
}

/** Transcript line with auto-removed words in ⟨angle brackets⟩ (for the AI and the transcript view). */
export function markedText(segId, idx, segById) {
  const seg = segById[segId];
  if (!seg) return '';
  return idx
    .words(seg.assetId)
    .filter((w) => w.seg === segId)
    .map((w) => (w.keep ? w.t : `⟨${w.t}⟩`))
    .join(' ')
    .replace(/⟩ ⟨/g, ' ');
}

/** Where an old timeline time lands after clips were re-cut (for graphics, B-roll, text). */
function remapper(oldTl, newTl, children) {
  const oldClips = layout(oldTl).clips;
  const newClips = layout(newTl).clips;
  const byId = Object.fromEntries(newClips.map((c) => [c.id, c]));
  return (t) => {
    const c = oldClips.find((k) => t >= k.tlStart - 1e-6 && t < k.tlEnd) || oldClips[oldClips.length - 1];
    if (!c) return t;
    const src = c.in + (t - c.tlStart);
    const kids = (children[c.id] || []).map((id) => byId[id]).filter(Boolean);
    if (!kids.length) {
      // the whole clip was cut: land on whatever now follows it
      const after = oldClips.slice(oldClips.indexOf(c) + 1).flatMap((k) => (children[k.id] || []).map((id) => byId[id]).filter(Boolean));
      return after.length ? after[0].tlStart : r2(Math.max(0, (newClips[newClips.length - 1]?.tlEnd || 0.1) - 0.1));
    }
    const hit = kids.find((k) => src >= k.in - 1e-6 && src < k.out);
    if (hit) return r2(hit.tlStart + (src - hit.in));
    const next = kids.find((k) => k.in > src);
    return r2(next ? next.tlStart : kids[kids.length - 1].tlEnd - 0.1);
  };
}

/**
 * Re-cut an existing timeline: clips lose their silences, fillers, stutters, retakes and mumbles;
 * captions are rebuilt word by word; text, graphics, B-roll and sound notes move with the words
 * they were on. Clips made by a cut remember their group (grp + span of words), so a group is
 * re-derived from its words — restored words come back, newly cut ones go. Hand-added clips are
 * cleaned inside their own in/out. Clips with no words (silent shots) are left alone.
 * @param only  re-cut just the groups touching these [assetId, time] points (word restores)
 */
export function cleanTimeline(tlIn, transcript, assets, { mode, punchIn, only = null } = {}) {
  const tl = normalizeTimeline(tlIn);
  mode = CUT_MODES[mode] ? mode : CUT_MODES[tl.cut?.mode] ? tl.cut.mode : DEFAULT_CUT;
  punchIn = punchIn ?? tl.cut?.punchIn ?? true;
  const idx = wordIndex(transcript, assets);
  // timeline clips → units (runs of clips of one group)
  const units = [];
  for (const c of tl.clips) {
    const last = units[units.length - 1];
    if (c.grp && last?.grp === c.grp && last.assetId === c.assetId) last.clips.push(c);
    else units.push({ grp: c.grp || null, assetId: c.assetId, clips: [c], span: c.grp && Array.isArray(c.span) ? c.span : [c.in, c.out] });
  }
  // a group split up by other clips can't be re-derived as one piece: treat its parts as hand-made
  const seen = {};
  for (const u of units) if (u.grp) seen[u.grp] = (seen[u.grp] || 0) + 1;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.grp && seen[u.grp] > 1) units.splice(i, 1, ...u.clips.map((c) => ({ grp: null, assetId: c.assetId, clips: [c], span: [c.in, c.out] })));
  }
  const touches = (u) => !only || only.some(([aid, t]) => aid === u.assetId && t >= Math.min(u.span[0], ...u.clips.map((c) => c.in)) - 0.05 && t <= Math.max(u.span[1], ...u.clips.map((c) => c.out)) + 0.05);
  const next = { ...tl, cut: { mode, punchIn }, clips: [], captions: { ...tl.captions, items: [] } };
  const redoneSpans = [];
  const children = {};
  let removed = 0;
  for (const u of units) {
    const all = idx.words(u.assetId);
    const inside = all.filter((w) => (w.s + w.e) / 2 >= u.span[0] - 0.001 && (w.s + w.e) / 2 <= u.span[1] + 0.001);
    if (!inside.length || !touches(u)) {
      for (const c of u.clips) {
        next.clips.push(c);
        children[c.id] = [c.id];
      }
      continue;
    }
    const a = all.indexOf(inside[0]);
    const b = all.indexOf(inside[inside.length - 1]);
    const handMade = !u.grp;
    const lo = handMade ? u.span[0] : -Infinity;
    const hi = handMade ? u.span[1] : Infinity;
    const ranges = cutRanges(
      inside.map((w) => ({ ...w })),
      idx.voice(u.assetId),
      mode,
      { before: Math.max(handMade ? lo - 0.01 : -Infinity, a > 0 ? all[a - 1].e : -Infinity), after: Math.min(handMade ? hi + 0.01 : Infinity, b < all.length - 1 ? all[b + 1].s : Infinity) },
    );
    const first = u.clips[0];
    const grp = u.grp || uid('grp');
    const baseZoom = first.zoom || 1;
    const alt = baseZoom > 1.05 ? 1 : 1.12;
    const ids = [];
    ranges.forEach((r, ri) => {
      const id = ri < u.clips.length ? u.clips[ri].id : uid('clip');
      const zoom = punchIn && ri % 2 === 1 ? alt : baseZoom;
      next.clips.push({ ...first, id, in: r2(Math.max(lo, Math.floor(r.in * 100) / 100)), out: r2(Math.min(hi, Math.ceil(r.out * 100) / 100)), zoom, note: ri === 0 ? first.note : '', transitionIn: ri === 0 ? first.transitionIn : 'cut', grp, span: [r3(u.span[0]), r3(u.span[1])] });
      ids.push(id);
      next.captions.items.push(...captionsFor(r, u.assetId));
    });
    for (const c of u.clips) children[c.id] = ids;
    redoneSpans.push([u.assetId, Math.min(u.span[0], ...u.clips.map((c) => c.in)) - 0.05, Math.max(u.span[1], ...u.clips.map((c) => c.out)) + 0.05]);
    removed += u.clips.reduce((n, c) => n + (c.out - c.in), 0) - ranges.reduce((n, r) => n + (r.out - r.in), 0);
  }
  // captions of untouched parts stay as they were (the creator may have edited them)
  for (const cap of tl.captions.items) {
    const redone = redoneSpans.some(([aid, s, e]) => cap.assetId === aid && cap.end > s && cap.start < e);
    if (!redone) next.captions.items.push(cap);
  }
  next.captions.items.sort((x, y) => x.start - y.start);
  const map = remapper(tl, next, children);
  next.overlays = tl.overlays.map((o) => ({ ...o, start: map(o.start) }));
  next.graphics = (tl.graphics || []).map((g) => ({ ...g, start: map(g.start) }));
  next.broll = tl.broll.map((b) => ({ ...b, start: map(b.start) }));
  next.sound = (tl.sound || []).map((s) => ({ ...s, at: map(s.at) }));
  return { timeline: next, removedSeconds: r2(removed) };
}

/** Rough word count of a line (used by prompts). */
export const wordCount = (text) => tokens(text).length;
