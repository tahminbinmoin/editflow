// Reel quality check: measures a cut against what a professional short-form editor would never
// ship (dead air, fillers, mumbling, weak opening, wrong length, repeated takes, flash frames,
// long stretches with nothing changing, uncaptioned speech). Pure; used by the studio, the export
// page and the AI review pass. Everything here is MEASURED from the audio map and words, not guessed.

import { layout, timelineCaptions, normalizeTimeline } from './timeline.js';
import { wordIndex, CUT_MODES, DEFAULT_CUT } from './cleancut.js';
import { voicedWithin } from './words.js';

const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** The cut as it will play: [{ start, end, role, text }] in timeline time (kept words only). */
export function scriptOf(tlIn, transcript, assets) {
  const tl = normalizeTimeline(tlIn);
  const idx = wordIndex(transcript, assets);
  return layout(tl).clips.map((c) => {
    const words = idx.words(c.assetId).filter((w) => w.keep && (w.s + w.e) / 2 >= c.in && (w.s + w.e) / 2 <= c.out);
    return { start: c.tlStart, end: c.tlEnd, role: c.role || '', text: words.map((w) => w.t).join(' '), clipId: c.id, zoom: c.zoom || 1 };
  });
}

export function scriptText(script) {
  return script.map((l) => `[${fmt(l.start)}–${fmt(l.end)}]${l.role ? ` ${l.role}:` : ''} ${l.text || '(no speech)'}`).join('\n');
}

/**
 * @returns { score 0–100, checks: [{ id, level: 'error'|'warn'|'ok', title, detail, fix?: 'cleanUp' }], stats }
 */
export function reviewCut(project, tlIn = project.timeline) {
  const tl = normalizeTimeline(tlIn);
  const { clips, duration } = layout(tl);
  const checks = [];
  const add = (id, level, title, detail = '', fix) => checks.push({ id, level, title, detail, fix });
  if (!clips.length) return { score: 0, checks: [{ id: 'empty', level: 'error', title: 'No cut yet', detail: 'Make a first cut.' }], stats: {} };
  const mode = CUT_MODES[tl.cut?.mode] || CUT_MODES[DEFAULT_CUT];
  const idx = wordIndex(project.transcript, project.assets);
  const hasVoice = clips.some((c) => idx.voice(c.assetId)?.length);

  // 1. Dead air: silence inside clips longer than the cut allows (and at clip edges)
  let deadAir = 0;
  let deadSpots = 0;
  let mumble = 0;
  let leftovers = { filler: 0, stutter: 0, retake: 0, noise: 0 };
  for (const c of clips) {
    const voice = idx.voice(c.assetId);
    const words = idx.words(c.assetId).filter((w) => (w.s + w.e) / 2 >= c.in && (w.s + w.e) / 2 <= c.out);
    for (const w of words) if (!w.keep && w.flag) leftovers[w.flag]++;
    if (!voice?.length) continue;
    const parts = voicedWithin(voice, c.in, c.out);
    let prev = c.in;
    parts.forEach(([s, e], i) => {
      const gap = s - prev;
      const allowed = i === 0 ? mode.lead + 0.1 : mode.maxPause + 0.05;
      if (gap > allowed) {
        deadAir += gap - allowed;
        deadSpots++;
      }
      prev = e;
      // voice with no word in it = mumbling / noise the speech-to-text skipped
      if (e - s >= 0.2 && !words.some((w) => w.keep && w.e > s - 0.05 && w.s < e + 0.05)) mumble += e - s;
    });
    const tailGap = c.out - prev;
    if (tailGap > mode.tail + 0.12) {
      deadAir += tailGap - mode.tail - 0.12;
      deadSpots++;
    }
  }
  if (!hasVoice) add('voice', 'warn', 'Silence not measured', 'This footage has no voice map yet. Run “Re-clean the whole cut” to measure it.', 'cleanUp');
  else if (deadSpots) add('silence', 'error', `${deadSpots} silent gap${deadSpots > 1 ? 's' : ''} (${r1(deadAir)} s of dead air)`, 'Reels lose viewers in pauses. The clean cut removes them.', 'cleanUp');
  else add('silence', 'ok', 'No dead air');
  if (mumble >= 0.3) add('mumble', 'error', `${r1(mumble)} s of mumbling or noise without words`, 'Sound in the cut that isn’t a recognised word.', 'cleanUp');
  const left = Object.entries(leftovers).filter(([, n]) => n);
  if (left.length) add('fillers', 'error', `Still in the cut: ${left.map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}`, 'Fillers, stutters and abandoned takes inside clips.', 'cleanUp');
  else add('fillers', 'ok', 'No fillers, stutters or retakes');

  // 2. The opening: speech within the first 0.3 s, hook role, no throat-clearing opener
  const script = scriptOf(tl, project.transcript, project.assets);
  const first = script[0];
  const firstWords = (first?.text || '').toLowerCase();
  if (!first?.text) add('hook', 'error', 'The reel doesn’t open on speech', 'The first clip has no words. Open on the hook line.');
  else if (/^(hi|hey|hello|so|okay|ok|alright|welcome|today|in this video|what'?s up|good morning)\b/.test(firstWords)) add('hook', 'warn', `Weak opening: “${first.text.split(' ').slice(0, 5).join(' ')}…”`, 'Greetings and “so / today” openers lose viewers. Open on the boldest line.');
  else add('hook', 'ok', 'Opens straight on the hook');

  // 3. Length vs the target
  const target = Number(project.settings?.targetLength) || 45;
  if (duration > target * 1.25) add('length', 'warn', `${r1(duration)} s long (target ${target} s)`, 'Cut the weakest lines to tighten the story.');
  else if (duration < target * 0.5 && duration < 12) add('length', 'warn', `Only ${r1(duration)} s long (target ${target} s)`);
  else add('length', 'ok', `${r1(duration)} s (target ${target} s)`);

  // 4. The same words used twice
  let dup = 0;
  for (let i = 0; i < clips.length; i++)
    for (let j = i + 1; j < clips.length; j++) {
      const a = clips[i];
      const b = clips[j];
      if (a.assetId === b.assetId && Math.min(a.out, b.out) - Math.max(a.in, b.in) > 0.3) dup++;
    }
  if (dup) add('duplicate', 'error', `${dup} part${dup > 1 ? 's' : ''} of the footage used twice`, 'Viewers notice repeated lines.');

  // 5. Flash frames
  const tiny = clips.filter((c) => c.duration < 0.2).length;
  if (tiny) add('flash', 'warn', `${tiny} clip${tiny > 1 ? 's' : ''} shorter than 6 frames`, 'Very short clips read as glitches.');

  // 6. Nothing changes on screen for a long stretch (pattern interrupts keep attention)
  const events = new Set([0, duration]);
  for (const c of clips) if (c.tlStart > 0 && (c.zoom || 1) !== 1) events.add(c.tlStart);
  clips.forEach((c, i) => i && clips[i - 1].assetId !== c.assetId && events.add(c.tlStart));
  clips.forEach((c, i) => i && Math.abs(c.in - clips[i - 1].out) > 0.5 && events.add(c.tlStart));
  for (const g of tl.graphics || []) events.add(g.start);
  for (const b of tl.broll) events.add(b.start);
  const times = [...events].sort((a, b) => a - b);
  let longest = 0;
  let at = 0;
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > longest) ((longest = times[i] - times[i - 1]), (at = times[i - 1]));
  if (longest > 6) add('static', 'warn', `${r1(longest)} s with no visual change (from ${fmt(at)})`, 'Add B-roll, a motion graphic or a punch-in (Analyse video does this).');
  else add('static', 'ok', 'Something changes at least every 6 s');

  // 7. Captions cover the speech
  const caps = timelineCaptions(tl);
  const spoken = script.filter((l) => l.text).reduce((n, l) => n + (l.end - l.start), 0);
  const covered = caps.reduce((n, c) => n + (c.end - c.start), 0);
  if (!tl.captions.enabled) add('captions', 'warn', 'Captions are off', 'Most reels are watched on mute.');
  else if (spoken > 1 && covered < spoken * 0.6) add('captions', 'warn', 'Some speech has no captions', 'Re-clean the cut to rebuild captions word by word.', 'cleanUp');
  else add('captions', 'ok', 'Captions cover the speech');

  // 8. Ends on a finished sentence
  const last = [...script].reverse().find((l) => l.text);
  if (last && !/[.!?]["')]?$/.test(last.text.trim())) add('ending', 'warn', 'Ends mid-sentence', `Last words: “…${last.text.split(' ').slice(-5).join(' ')}”`);

  const penalty = checks.reduce((n, c) => n + (c.level === 'error' ? 18 : c.level === 'warn' ? 7 : 0), 0);
  return {
    score: Math.max(0, 100 - penalty),
    checks: checks.sort((a, b) => ({ error: 0, warn: 1, ok: 2 })[a.level] - { error: 0, warn: 1, ok: 2 }[b.level]),
    stats: { duration: r1(duration), deadAir: r1(deadAir), mumble: r1(mumble), clips: clips.length, longestStatic: r1(longest) },
  };
}
