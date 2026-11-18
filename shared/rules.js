// Rule-based drafting — works with no AI provider at all.
// It uses simple, transparent heuristics on the transcript (question/number/"you" scoring,
// filler removal, keyword cues). The UI labels results "Rule-based draft — no AI used"
// so nobody mistakes this for model analysis.

import { layout, formatTime, uid } from './timeline.js';

const FILLER = /^(um+|uh+|erm+|like|you know|so+|okay|ok|right|yeah|i mean)[\s,.!?]*$/i;
const CTA = /\b(follow|subscribe|link in|comment|check out|sign up|download|try it|book a|dm me|save this|share this)\b/i;
const HOOKY = [
  [/\?/, 3, 'asks a question'],
  [/\b\d+(\.\d+)?\s?(%|x|k|m|percent|times|seconds|minutes|hours|days|dollars|\$)?/i, 2, 'has a concrete number'],
  [/\b(you|your)\b/i, 1.5, 'speaks to the viewer'],
  [/\b(secret|mistake|nobody|never|stop|why|how|truth|wrong|biggest|best|worst|actually|here's)\b/i, 2, 'uses a curiosity word'],
];

function scoreHook(s) {
  let score = 0;
  const why = [];
  for (const [re, w, label] of HOOKY) if (re.test(s.text)) (score += w), why.push(label);
  const words = s.text.split(/\s+/).length;
  if (words >= 5 && words <= 22) (score += 1), why.push('is short enough to land fast');
  if (words > 35) score -= 2;
  return { score, why };
}

const BROLL_CUES = [
  [/\b(product|device|app|tool|bottle|package|box)\b/i, 'Close-up of the product in hand', 'Shows the thing being talked about instead of telling.'],
  [/\b(screen|dashboard|website|click|type|software|settings)\b/i, 'Screen recording of the steps', 'Viewers follow along visually; reduces talking-head fatigue.'],
  [/\b(\d+%|percent|numbers?|data|growth|revenue|results?)\b/i, 'Simple on-screen stat or chart', 'Makes the number memorable and scannable on mute.'],
  [/\b(customer|client|people|team|students?)\b/i, 'People using it / reacting (with permission)', 'Social proof and human context.'],
  [/\b(before|after|transform|changed)\b/i, 'Before/after split shot', 'Visualises the payoff.'],
  [/\b(morning|kitchen|office|studio|street|city|outside)\b/i, 'Establishing shot of the location', 'Gives the story a sense of place.'],
];

const MOODS = [
  [/\b(educat|teach|learn|tips?|how to|tutorial)\b/i, 'Light, focused lo-fi', '85–100 BPM'],
  [/\b(sell|launch|product|sale|promo|ad)\b/i, 'Upbeat, confident pop-electronic', '110–125 BPM'],
  [/\b(story|personal|journey|emotional|inspir)\b/i, 'Warm, building cinematic', '70–90 BPM'],
  [/\b(podcast|interview|conversation)\b/i, 'Subtle, minimal bed', '90–100 BPM'],
];

export function rulePlan(project) {
  const segs = project.transcript.segments.filter((s) => s.text && !FILLER.test(s.text.trim()) && s.end - s.start >= 0.6);
  if (!segs.length) throw new Error('The transcript has no usable lines yet.');
  const target = Number(project.settings.targetLength) || 45;
  const brief = `${project.settings.goal || ''} ${project.settings.notes || ''} ${project.settings.audience || ''}`;

  const scored = segs.map((s) => ({ s, ...scoreHook(s) }));
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const hook = ranked[0];
  const cta = [...segs].reverse().find((s) => CTA.test(s.text));

  // Keep chronological order for the body, drop weakest lines until the cut fits the target.
  let body = segs.filter((s) => s.id !== hook.s.id && s.id !== cta?.id);
  const dur = (arr) => arr.reduce((n, s) => n + (s.end - s.start), 0);
  const fixed = hook.s.end - hook.s.start + (cta ? cta.end - cta.start : 0);
  const byWeak = [...body].sort((a, b) => scoreHook(a).score - scoreHook(b).score || b.end - b.start - (a.end - a.start));
  const dropped = [];
  while (body.length > 2 && fixed + dur(body) > target * 1.1) {
    const w = byWeak.shift();
    body = body.filter((s) => s.id !== w.id);
    dropped.push(w);
  }

  const n = body.length;
  const roleFor = (i) => (i < Math.max(1, Math.round(n * 0.25)) ? 'context' : i >= n - Math.max(1, Math.round(n * 0.2)) ? 'payoff' : 'progression');
  const clips = [
    { segmentIds: [hook.s.id], role: 'hook', note: `Opens on the strongest line (${hook.why.join(', ') || 'best available'})`, trimStart: 0, trimEnd: 0 },
    ...body.map((s, i) => ({ segmentIds: [s.id], role: roleFor(i), note: '', trimStart: 0, trimEnd: 0 })),
    ...(cta ? [{ segmentIds: [cta.id], role: 'cta', note: 'Ends on the call to action', trimStart: 0, trimEnd: 0 }] : []),
  ];

  const broll = [];
  for (const s of [hook.s, ...body]) {
    const cue = BROLL_CUES.find(([re]) => re.test(s.text));
    if (cue && broll.length < 5 && !broll.some((b) => b.description === cue[1])) broll.push({ segmentId: s.id, description: cue[1], reason: cue[2] });
  }
  const mood = MOODS.find(([re]) => re.test(brief)) || [null, 'Neutral, modern background bed', '95–110 BPM'];
  const firstWords = hook.s.text.split(/\s+/).slice(0, 6).join(' ').replace(/[,.;:]$/, '');

  const beats = [
    { role: 'hook', title: 'Hook', segmentIds: [hook.s.id], why: 'Highest hook score in the transcript.' },
    { role: 'context', title: 'Set up', segmentIds: body.filter((_, i) => roleFor(i) === 'context').map((s) => s.id), why: 'Earliest remaining lines, kept in order.' },
    { role: 'progression', title: 'Main points', segmentIds: body.filter((_, i) => roleFor(i) === 'progression').map((s) => s.id), why: 'Middle of the talk, in order.' },
    { role: 'payoff', title: 'Payoff', segmentIds: body.filter((_, i) => roleFor(i) === 'payoff').map((s) => s.id), why: 'Closing lines before the CTA.' },
    ...(cta ? [{ role: 'cta', title: 'Call to action', segmentIds: [cta.id], why: 'Contains a call-to-action phrase.' }] : []),
  ].filter((b) => b.segmentIds.length);

  return {
    summary: `Rule-based draft: opens on "${firstWords}…", keeps the remaining lines in their original order${dropped.length ? `, drops ${dropped.length} lower-scoring line${dropped.length > 1 ? 's' : ''} to approach the ${target}s target` : ''}${cta ? ', and ends on the call to action' : ''}. Gaps longer than about half a second between lines are cut.`,
    hookOptions: ranked.slice(0, 3).map((r) => ({ text: r.s.text, segmentIds: [r.s.id], why: r.why.join(', ') || 'best available' })),
    hookTitle: '',
    beats,
    clips,
    captions: [],
    broll,
    overlays: cta ? [{ segmentId: cta.id, template: 'cta', text: 'Follow for more' }] : [],
    music: { mood: mood[1], tempo: mood[2], notes: 'Keep the bed under the voice; lift slightly at the payoff.' },
    soundDesign: [{ segmentId: hook.s.id, description: 'Soft riser or whoosh into the first line' }],
    audio: { suggestions: ['Loudness normalised to about -14 LUFS for social platforms', 'Turn on noise reduction if you hear hum or room hiss'], normalize: true, denoise: false },
    review: [
      'Check the hook still makes sense out of order.',
      'Watch the cut points between lines for awkward jump cuts — add B-roll over them if needed.',
      'Captions come from the transcript: check names and numbers.',
      dropped.length ? `Removed lines: ${dropped.map((d) => d.id).join(', ')} — restore any you want from the Transcript tab.` : 'No lines were removed.',
    ],
    changes: [`Moved ${hook.s.id} to the opening`, `${dropped.length} line(s) removed`, 'Silences between lines removed', 'Captions generated from the transcript'],
  };
}

/** A small, documented set of plain-language requests that work without AI. */
export function ruleRefine(project, request) {
  const tl = project.timeline;
  const r = request.toLowerCase();
  const { clips } = layout(tl);
  const ops = [];
  const notes = [];
  let summary = '';

  const firstN = r.match(/first\s+(\d+|three|two|five)\s+seconds?/);
  const words = { two: 2, three: 3, five: 5 };
  if (/(faster|tighter|snappier|quicker|speed up|shorter)/.test(r)) {
    const limit = firstN ? Number(words[firstN[1]] || firstN[1]) : Infinity;
    for (const c of clips) {
      if (c.tlStart >= limit) break;
      const shave = Math.min(0.25, c.duration * 0.08);
      if (c.duration > 1) ops.push({ type: 'trimClip', clipId: c.id, in: +(c.in + shave * 0.4).toFixed(3), out: +(c.out - shave * 0.6).toFixed(3) });
    }
    summary = `Shaves the start and end of ${ops.length} clip${ops.length === 1 ? '' : 's'}${limit !== Infinity ? ` in the first ${limit} seconds` : ''} to tighten pacing.`;
  } else if (/music/.test(r) && /(less|softer|quieter|lower|calmer|down)/.test(r)) {
    ops.push({ type: 'setMusic', patch: { volume: +Math.max(0.05, tl.music.volume * 0.6).toFixed(2) } });
    summary = 'Lowers the music volume by about 40%.';
  } else if (/music/.test(r) && /(more|louder|higher|up|intense)/.test(r)) {
    ops.push({ type: 'setMusic', patch: { volume: +Math.min(0.6, tl.music.volume * 1.5).toFixed(2) } });
    summary = 'Raises the music volume by about 50%.';
  } else if (/caption/.test(r) && /(remove|off|hide|no )/.test(r)) {
    ops.push({ type: 'setCaptionStyle', patch: { enabled: false } });
    summary = 'Turns captions off.';
  } else if (/caption/.test(r) && /(center|middle)/.test(r)) {
    ops.push({ type: 'setCaptionStyle', patch: { position: 'center', enabled: true } });
    summary = 'Moves captions to the center.';
  } else if (/caption/.test(r) && /(box|readable|bigger|bold)/.test(r)) {
    ops.push({ type: 'setCaptionStyle', patch: { style: /box/.test(r) ? 'boxed' : 'bold', enabled: true } });
    summary = 'Switches to a more readable caption style.';
  } else if (/(noise|hiss|hum|clean.*audio|denoise)/.test(r)) {
    ops.push({ type: 'setAudio', patch: { denoise: true, normalize: true } });
    summary = 'Turns on noise reduction and loudness normalisation.';
  } else if (/(fade|transition)/.test(r)) {
    clips.slice(1).forEach((c) => ops.push({ type: 'updateClip', clipId: c.id, patch: { transitionIn: 'fade' } }));
    summary = 'Adds a short fade between clips.';
  } else if (/close.?up|zoom|framing|shot/.test(r)) {
    notes.push('Detecting close-ups needs visual analysis, which the rule-based mode does not have. Connect ChatGPT or Claude in Settings and use “Analyse video”, or add B-roll shots manually.');
    summary = 'Nothing changed.';
  } else {
    notes.push(
      'Rule-based mode understands: “make it faster/tighter” (optionally “first 3 seconds”), “music quieter/louder”, “captions off / centered / boxed”, “clean up the audio”, “add fades”. Connect ChatGPT or Claude in Settings for anything else.',
    );
    summary = 'Nothing changed.';
  }
  return { summary, ops, notes };
}


