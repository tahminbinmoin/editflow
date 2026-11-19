// Training studio logic (pure). "Training" here means teaching the story editor from finished,
// professional edits — it does not change the weights of ChatGPT or Claude:
//   1. An admin edits a reel by hand in Editflow (the gold standard) and adds it as an example.
//      exampleFromProject() records what the raw footage said, which lines a pro kept and in what
//      order, the hook, the pacing — and, if the AI cut it first, what the editor changed.
//   2. "Train" asks the AI to distil all examples of one type of reel into a house style: concrete
//      rules + the best worked examples (trainPrompt). An admin reviews and publishes it.
//   3. The published house style is added to every story-edit prompt for that type of reel.
//   4. fineTuneRecords() exports the same examples as chat-format JSONL, ready for a real
//      fine-tuning job later (OpenAI fine-tuning) if the team wants one.

import { layout, normalizeTimeline } from './timeline.js';
import { wordIndex, markedText, spokenText } from './cleancut.js';
import { cleanStyle } from './styles.js';

const r1 = (n) => Math.round(n * 10) / 10;

/** Which transcript lines a timeline uses, in play order (each line once). */
export function linesInCut(tlIn, transcript, assets) {
  const tl = normalizeTimeline(tlIn);
  const idx = wordIndex(transcript, assets);
  const order = [];
  for (const c of layout(tl).clips) {
    const ids = [...new Set(idx.words(c.assetId).filter((w) => w.keep && (w.s + w.e) / 2 >= c.in && (w.s + w.e) / 2 <= c.out).map((w) => w.seg))];
    for (const id of ids) if (order[order.length - 1]?.id !== id) order.push({ id, role: c.role || '' });
  }
  const seen = new Set();
  return order.filter((o) => (seen.has(o.id) ? false : seen.add(o.id)));
}

/** A training example from a finished project (and the AI's first cut, if there was one). */
export function exampleFromProject(project, { aiTimeline = null } = {}) {
  const tl = normalizeTimeline(project.timeline);
  const { clips, duration } = layout(tl);
  if (!clips.length) throw new Error('This project has no cut yet. Edit it first, then add it as an example.');
  if (!project.transcript?.segments?.length) throw new Error('This project has no transcript.');
  const idx = wordIndex(project.transcript, project.assets);
  const segById = Object.fromEntries(project.transcript.segments.map((s) => [s.id, s]));
  const kept = linesInCut(tl, project.transcript, project.assets);
  const keptPos = Object.fromEntries(kept.map((k, i) => [k.id, i]));
  const segs = [...project.transcript.segments].sort((a, b) => (a.assetId === b.assetId ? a.start - b.start : 0)).slice(0, 400);
  const data = {
    duration: r1(duration),
    targetLength: project.settings?.targetLength || null,
    cutMode: tl.cut?.mode || null,
    lines: segs.map((s) => ({ id: s.id, text: markedText(s.id, idx, segById).slice(0, 600), kept: s.id in keptPos, order: keptPos[s.id] ?? null, role: kept[keptPos[s.id]]?.role || '' })),
    hook: kept[0] ? { id: kept[0].id, text: spokenText(kept[0].id, idx, segById) } : null,
    clips: clips.length,
    cutsPerMinute: r1((clips.length / Math.max(1, duration)) * 60),
    avgClip: r1(duration / clips.length),
    captions: { enabled: tl.captions.enabled, style: tl.captions.style },
    graphics: (tl.graphics || []).map((g) => g.type),
    broll: tl.broll.length,
    punchIns: clips.filter((c) => (c.zoom || 1) > 1.01).length,
    // the source, so the example can become a fine-tuning record later
    source: {
      settings: project.settings,
      transcript: { segments: segs },
      assets: (project.assets || []).filter((a) => segs.some((s) => s.assetId === a.id)).map((a) => ({ id: a.id, kind: a.kind, duration: a.duration, voice: a.voice || null })),
    },
  };
  if (aiTimeline) {
    const ai = linesInCut(aiTimeline, project.transcript, project.assets).map((k) => k.id);
    const pro = kept.map((k) => k.id);
    data.aiDiff = {
      aiKept: ai,
      editorKept: pro,
      added: pro.filter((id) => !ai.includes(id)),
      removed: ai.filter((id) => !pro.includes(id)),
      hookChanged: ai[0] !== pro[0],
      reordered: pro.filter((id) => ai.includes(id)).join() !== ai.filter((id) => pro.includes(id)).join(),
    };
  }
  return data;
}

/** Compact text of an example for prompts: the raw lines and the editor's cut. */
export function exampleText(ex, { maxLines = 60 } = {}) {
  const d = ex.data || ex;
  const raw = d.lines.slice(0, maxLines).map((l) => `${l.id}: ${l.text}`).join('\n');
  const cut = d.lines
    .filter((l) => l.kept)
    .sort((a, b) => a.order - b.order)
    .map((l) => `${l.id}${l.role ? ` (${l.role})` : ''}`)
    .join(' → ');
  const diff = d.aiDiff
    ? `\nWhat the editor changed from the AI's cut: added ${d.aiDiff.added.join(', ') || 'nothing'}; removed ${d.aiDiff.removed.join(', ') || 'nothing'}${d.aiDiff.hookChanged ? '; chose a different hook' : ''}${d.aiDiff.reordered ? '; reordered lines' : ''}.`
    : '';
  return { raw, cut: `${cut}  [${d.duration}s, ${d.clips} clips, ${d.cutsPerMinute} cuts/min, ${d.punchIns} punch-ins, captions ${d.captions?.style}]${diff}` };
}

/** Distil a house style from the examples of one type of reel. */
export function trainPrompt(type, examples, current = null) {
  const system = `You are the head editor at a short-form video studio, writing the house style guide that a junior AI editor will follow when it cuts "${type.label}" reels. You learn ONLY from the professional examples given: what they keep, cut, open with and end on. Write rules that are specific and actionable (e.g. "Open on the result, never on the setup"; "Cut any line that restates the hook"), not generic advice. Return ONLY a JSON object.`;
  const blocks = examples
    .map((ex, i) => {
      const t = exampleText(ex);
      return `EXAMPLE ${i + 1}: ${ex.title || 'untitled'}${ex.rating ? ` (quality ${ex.rating}/5)` : ''}${ex.notes ? `\nEditor's notes: ${ex.notes}` : ''}\nRAW LINES (⟨…⟩ = fillers/retakes removed automatically):\n${t.raw}\nTHE PROFESSIONAL CUT (line ids in play order): ${t.cut}`;
    })
    .join('\n\n');
  const user = `TYPE OF REEL: ${type.label}${type.desc ? ` — ${type.desc}` : ''}
${current?.rules?.length ? `\nCURRENT HOUSE STYLE (improve it; keep what the examples still support):\n${current.rules.map((r) => `- ${r}`).join('\n')}\n` : ''}
${blocks}

Return JSON:
{
  "rules": ["10-20 specific rules the examples show: hook choice, what gets cut, line order, length, pacing, endings, captions/graphics density"],
  "examples": [{"title": "...", "raw": "a SHORT excerpt of raw lines (ids + text)", "cut": "the cut as line ids in order", "why": "the lesson this example teaches"}],
  "pacing": {"targetLength": seconds, "cutMode": "natural|tight|ultra"},
  "summary": "2 sentences: what defines this house style"
}
Use at most 3 examples (the most instructive), each under 1200 characters.`;
  return { system, user };
}

/** Clean the AI's trained style for saving. */
export function trainedStyle(raw, type) {
  const s = cleanStyle({ ...raw, key: type.key, label: type.label, desc: type.desc });
  return { ...s, summary: String(raw?.summary || '').slice(0, 400) };
}

/** OpenAI chat fine-tuning records (JSONL lines) from examples. `planPromptFn` = prompts.planPrompt. */
export function fineTuneRecords(examples, planPromptFn) {
  return examples
    .filter((ex) => ex.data?.source?.transcript?.segments?.length)
    .map((ex) => {
      const src = ex.data.source;
      const project = { settings: src.settings || {}, assets: src.assets || [], transcript: src.transcript };
      const { system, user } = planPromptFn(project, null);
      const kept = ex.data.lines.filter((l) => l.kept).sort((a, b) => a.order - b.order);
      const answer = {
        summary: ex.notes || ex.title || '',
        hookOptions: ex.data.hook ? [{ text: ex.data.hook.text, segmentIds: [ex.data.hook.id], why: 'chosen by a professional editor' }] : [],
        hookTitle: '',
        beats: [],
        clips: kept.map((l) => ({ segmentIds: [l.id], role: l.role || 'progression', note: '', trimStartWords: 0, trimEndWords: 0 })),
        broll: [],
        overlays: [],
        music: { mood: '', tempo: '', notes: '' },
        soundDesign: [],
        audio: { suggestions: [], normalize: true, denoise: false },
        review: [],
        changes: [],
      };
      return JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(answer) }] });
    });
}
