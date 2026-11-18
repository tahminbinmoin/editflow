import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTimeline, applyOp, applyOps, layout, timelineCaptions, diffSummary, normalizeTimeline } from '../shared/timeline.js';
import { cleanPlan, planToTimeline, chunkCaption } from '../shared/plan.js';
import { parseTranscriptFile } from '../shared/transcript.js';
import { extractJson } from '../server/ai/providers.js';
import { rulePlan, ruleRefine } from '../shared/rules.js';
import { buildAss, dimensions, buildRenderPlan } from '../shared/render-graph.js';
import { parseProbe } from '../shared/probe.js';
import { encrypt, decrypt } from '../server/lib/secrets.js';
import { cleanGraphic, drawGraphics, graphicWindows, parseStat, formatStat, GRAPHIC_TYPES, frameGuides } from '../shared/graphics.js';
import { speechChunks } from '../shared/speech.js';

const assets = [{ id: 'a1', duration: 60 }];
const segs = [
  { id: 's1', assetId: 'a1', start: 1, end: 4, text: 'Okay so, um, today I want to talk about pricing.' },
  { id: 's2', assetId: 'a1', start: 5, end: 9, text: 'Why do 90% of founders undercharge?' },
  { id: 's3', assetId: 'a1', start: 10, end: 14, text: 'Because nobody tells you what your time is worth.' },
  { id: 's4', assetId: 'a1', start: 15, end: 18, text: 'Follow for part two.' },
];

function base() {
  let tl = emptyTimeline('9:16');
  tl = applyOp(tl, { type: 'addClip', clipId: 'c1', assetId: 'a1', in: 0, out: 5 }, { assets });
  tl = applyOp(tl, { type: 'addClip', clipId: 'c2', assetId: 'a1', in: 10, out: 14 }, { assets });
  return tl;
}

test('trim, move, split and delete clips', () => {
  let tl = base();
  assert.equal(layout(tl).duration, 9);
  tl = applyOp(tl, { type: 'trimClip', clipId: 'c1', in: 1 }, { assets });
  assert.equal(layout(tl).duration, 8);
  tl = applyOp(tl, { type: 'moveClip', clipId: 'c2', toIndex: 0 });
  assert.deepEqual(tl.clips.map((c) => c.id), ['c2', 'c1']);
  tl = applyOp(tl, { type: 'splitClip', at: 2, newId: 'c3' });
  assert.deepEqual(tl.clips.map((c) => [c.id, c.in, c.out]), [['c2', 10, 12], ['c3', 12, 14], ['c1', 1, 5]]);
  tl = applyOp(tl, { type: 'deleteClip', clipId: 'c3' });
  assert.equal(tl.clips.length, 2);
});

test('clips are clamped to the source duration and invalid ops are reported, not thrown', () => {
  const res = applyOps(base(), [{ type: 'trimClip', clipId: 'c2', out: 999 }, { type: 'nope' }, { type: 'deleteClip', clipId: 'missing' }], { assets });
  assert.equal(res.timeline.clips[1].out, 60);
  assert.equal(res.applied.length, 1);
  assert.equal(res.errors.length, 2);
});

test('captions follow their clip through reordering', () => {
  let tl = base();
  tl = applyOp(tl, { type: 'addCaption', captionId: 'k1', assetId: 'a1', start: 11, end: 12, text: 'hello' });
  assert.deepEqual(timelineCaptions(tl).map((c) => [c.start, c.end]), [[6, 7]]);
  tl = applyOp(tl, { type: 'moveClip', clipId: 'c2', toIndex: 0 });
  assert.deepEqual(timelineCaptions(tl).map((c) => [c.start, c.end]), [[1, 2]]);
  assert.ok(diffSummary(base(), tl).length > 0);
});

test('plans referencing unknown transcript lines are cleaned, and become a timeline', () => {
  const { plan, warnings } = cleanPlan({ clips: [{ segmentIds: ['s2'], role: 'hook' }, { segmentIds: ['s99'] }, { segmentIds: ['s3', 's4'], role: 'payoff' }], broll: [{ segmentId: 's3', description: 'x', reason: 'y' }] }, segs);
  assert.equal(plan.clips.length, 2);
  assert.ok(warnings.some((w) => w.includes('s99')));
  const tl = planToTimeline(plan, segs, { aspect: '1:1' });
  assert.equal(tl.clips[0].role, 'hook');
  // s3 ends at 14 and s4 starts at 15: the 1 s pause is cut, so that plan clip becomes two timeline clips.
  assert.equal(tl.clips.length, 3);
  assert.equal(tl.broll.length, 1);
  assert.equal(tl.format.aspect, '1:1');
});

test('captions are chunked into short balanced lines without filler words', () => {
  const c = chunkCaption('Okay so, um, today I want to talk about product videos.', 0, 3);
  assert.equal(c.length, 2);
  assert.ok(!c.some((x) => /\bum\b/.test(x.text)));
  assert.equal(c[c.length - 1].end, 3);
});

test('SRT parsing and plain text with estimated timing', () => {
  const srt = parseTranscriptFile('1\n00:00:01,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line.', 10);
  assert.equal(srt.timing, 'exact');
  assert.deepEqual(srt.segments.map((s) => [s.start, s.end]), [[1, 2.5], [3, 4]]);
  const txt = parseTranscriptFile('One sentence. Another one here!', 10);
  assert.equal(txt.timing, 'estimated');
  assert.equal(txt.segments.length, 2);
});

test('JSON extraction handles fenced and chatty replies', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"b":[1,2]} suffix'), { b: [1, 2] });
  assert.throws(() => extractJson('no json'));
});

test('rule-based planner picks a question as the hook and ends on the CTA', () => {
  const project = { transcript: { segments: segs }, settings: { targetLength: 30 }, timeline: emptyTimeline() };
  const raw = rulePlan(project);
  assert.deepEqual(raw.clips[0].segmentIds, ['s2']);
  assert.deepEqual(raw.clips.at(-1).segmentIds, ['s4']);
  const r = ruleRefine({ ...project, timeline: { ...emptyTimeline(), music: { volume: 0.3 } } }, 'make the music less intense');
  assert.equal(r.ops[0].type, 'setMusic');
});

test('render helpers: sizes and ASS captions', () => {
  assert.deepEqual(dimensions('9:16', 'high'), { W: 1080, H: 1920 });
  assert.deepEqual(dimensions('16:9', 'standard'), { W: 1280, H: 720 });
  let tl = base();
  tl = applyOp(tl, { type: 'addCaption', assetId: 'a1', start: 1, end: 2, text: 'Hi {there}' });
  tl = applyOp(tl, { type: 'addOverlay', overlay: { template: 'title', text: 'Big', start: 0, duration: 2 } });
  assert.doesNotMatch(buildAss(tl, 1080, 1920), /,Cap,,/, 'animated caption styles are drawn on the canvas layer, not by libass');
  tl = applyOp(tl, { type: 'setCaptionStyle', patch: { style: 'bold' } });
  const ass = buildAss(tl, 1080, 1920);
  assert.match(ass, /Dialogue: 0,0:00:01.00,0:00:02.00,Cap,,0,0,0,,Hi there/);
  assert.match(ass, /,title,,0,0,0,,\{\\fad\(160,160\)\}Big/);
});

test('render plan: one segment per clip, then a final join with overlays and music', () => {
  let tl = base();
  tl = applyOp(tl, { type: 'setMusic', patch: { assetId: 'm1' } });
  const project = { timeline: tl, assets: [{ id: 'a1', duration: 60, name: 'a' }, { id: 'm1', duration: 30, name: 'm' }] };
  const plan = buildRenderPlan(project, { aspect: '1:1', quality: 'draft', outName: 'out.mp4', inputPath: (a) => `${a.id}.mp4`, media: { a1: { hasVideo: true, hasAudio: true }, m1: { hasVideo: false, hasAudio: true } } });
  assert.equal(plan.segments.length, 2);
  assert.deepEqual(plan.segments[0].args.slice(1, 7), ['-ss', '0.000', '-t', '5.000', '-i', 'a1.mp4']);
  assert.match(plan.list, /file 'seg_000.mkv'\nfile 'seg_001.mkv'/);
  assert.ok(plan.final.includes('concat'));
  assert.match(plan.final.join(' '), /sidechaincompress/);
  assert.deepEqual(plan.usedAssetIds, ['a1', 'm1']);
});

test('probe parser reads ffmpeg stream info', () => {
  const info = parseProbe('  Duration: 00:01:02.50, start: 0\n  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps\n  Stream #0:1: Audio: aac, 48000 Hz');
  assert.equal(info.duration, 62.5);
  assert.equal(info.width, 1920);
  assert.ok(info.hasAudio);
});

test('API keys are encrypted and decrypt only with the same secret', () => {
  const c = encrypt('sk-test-123');
  assert.ok(!c.includes('sk-test'));
  assert.equal(decrypt(c), 'sk-test-123');
  assert.equal(decrypt('garbage'), null);
});

test('local folder: file kinds and caption sidecars', async () => {
  const { kindOf, findSidecar } = await import('../client/src/lib/localFolder.js');
  assert.equal(kindOf('Shoot.MP4'), 'video');
  assert.equal(kindOf('take.mov'), 'video');
  assert.equal(kindOf('bed.mp3'), 'audio');
  assert.equal(kindOf('talk.srt'), 'subtitle');
  assert.equal(kindOf('notes.txt'), null);
  const listing = [
    { relPath: 'Shoots/interview.mp4', kind: 'video' },
    { relPath: 'Shoots/Interview.SRT', kind: 'subtitle' },
    { relPath: 'other.vtt', kind: 'subtitle' },
  ];
  assert.equal(findSidecar(listing, 'Shoots/interview.mp4')?.relPath, 'Shoots/Interview.SRT');
  assert.equal(findSidecar(listing, 'interview.mp4'), null);
  assert.equal(findSidecar([], 'a.mp4'), null);
});

/** A CanvasRenderingContext2D stand-in that records calls (enough for the drawing code). */
function fakeCtx() {
  const calls = [];
  const state = { font: '10px x' };
  return new Proxy(state, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k === 'measureText') return (txt) => ({ width: String(txt).length * (parseFloat(t.font) || 10) * 0.55 });
      if (k in t) return t[k];
      return (...args) => calls.push([k, ...args]);
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

test('motion graphics: ops validate and clamp, unknown types are refused', () => {
  const { timeline: tl, errors } = applyOps(emptyTimeline(), [
    { type: 'addGraphic', graphic: { type: 'list', text: 'Steps', items: ['a', 'b', 'c', 'd', 'e'], start: 2, x: 9, color: 'mauve' } },
    { type: 'addGraphic', graphic: { type: 'nope' } },
  ]);
  assert.equal(errors.length, 1);
  const g = tl.graphics[0];
  assert.equal(g.items.length, 4);
  assert.equal(g.x, 0.92);
  assert.equal(g.color, 'accent');
  assert.equal(g.duration, GRAPHIC_TYPES.list.duration);
  assert.equal(g.position, 'top');
  const up = applyOps(tl, [{ type: 'updateGraphic', graphicId: g.id, patch: { type: 'stat', text: '$1,200', id: 'hijack' } }]).timeline.graphics[0];
  assert.equal(up.id, g.id);
  assert.equal(up.type, 'stat');
  assert.equal(applyOps(tl, [{ type: 'deleteGraphic', graphicId: g.id }]).timeline.graphics.length, 0);
  assert.throws(() => cleanGraphic({ type: 'x' }), /Unknown motion graphic/);
});

test('motion graphics: stat counting, time windows and drawing every type', () => {
  const st = parseStat('$1,200+');
  assert.deepEqual([st.prefix, st.value, st.suffix], ['$', 1200, '+']);
  assert.equal(formatStat(st, 600), '$600+');
  assert.equal(formatStat(parseStat('2.5x'), 1.5), '1.5x');
  assert.equal(formatStat(parseStat('73%'), 73), '73%');
  assert.equal(parseStat('no number'), null);
  assert.deepEqual(graphicWindows([{ start: 1, duration: 2 }, { start: 3.2, duration: 1 }, { start: 8, duration: 5 }], 10), [{ start: 1, end: 4.2 }, { start: 8, end: 10 }]);
  const guides = frameGuides(540, 960);
  assert.ok(guides.anchors.bottom < 960 * 0.83 - 540 * 0.15, 'bottom graphics stay above the captions');
  for (const type of Object.keys(GRAPHIC_TYPES)) {
    const g = cleanGraphic({ type, text: type === 'stat' ? '90%' : 'Hello world', sub: 'sub', items: ['one', 'two'], start: 1, duration: 3 });
    for (const t of [0.5, 1.0, 1.1, 1.5, 2.5, 3.9, 4.1]) {
      const ctx = fakeCtx();
      const n = drawGraphics(ctx, [g], t, 1080, 1920);
      assert.equal(n, t >= 1 && t < 4 ? 1 : 0, `${type} at ${t}`);
      if (n && t > 1.4) assert.ok(ctx.calls.length > 3, `${type} draws something at ${t}`);
      for (const [, ...args] of ctx.calls) for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${type} at ${t}: non-finite argument`);
    }
  }
});

test('speech chunking: finds spoken stretches and splits long ones at pauses', () => {
  const rate = 16000;
  const s = new Int16Array(rate * 30);
  const on = (t) => (t > 1 && t < 3) || (t > 3.2 && t < 4) || (t > 6 && t < 26);
  for (let i = 0; i < s.length; i++) {
    const t = i / rate;
    const dip = t > 15.5 && t < 15.7; // a breath inside the long run
    s[i] = on(t) && !dip ? Math.round(8000 * Math.sin(t * 2 * Math.PI * 180)) : (i % 5) - 2;
  }
  const c = speechChunks(s, rate);
  assert.ok(Math.abs(c[0].start - 1) < 0.2 && Math.abs(c[0].end - 4) < 0.2, 'short pause stays inside a line');
  assert.ok(c.slice(1).every((x) => x.end - x.start <= 14.3), 'long speech is split');
  assert.ok(c.some((x) => Math.abs(x.end - 15.6) < 0.4 || Math.abs(x.start - 15.6) < 0.4), 'split lands on the breath');
  for (let i = 1; i < c.length; i++) assert.ok(c[i].start >= c[i - 1].end, 'no overlaps');
  assert.deepEqual(speechChunks(new Int16Array(rate), rate), []);
});

test('motion graphics: new graphics are fitted around each other and existing ones', async () => {
  const { fitGraphics } = await import('../shared/graphics.js');
  const mk = (type, start, duration, position) => cleanGraphic({ type, start, duration, position });
  const existing = [mk('keyword', 0, 2, 'center')];
  const { kept, dropped } = fitGraphics(existing, [
    mk('stat', 1, 2, 'center'), // clashes with an existing graphic → dropped
    mk('chapter', 1, 2, 'top'), // different area → kept
    mk('stat', 3, 3, 'center'),
    mk('list', 4.5, 3, 'top'), // list covers top+center → shortens the stat at 3 s to 1.4 s
    mk('keyword', 5, 1, 'center'), // still clashes with the list → dropped
    mk('progress', 0, 9, 'top'), // the progress bar never clashes
  ]);
  assert.deepEqual(dropped.map((g) => `${g.type}@${g.start}`), ['stat@1', 'keyword@5']);
  assert.deepEqual(kept.map((g) => `${g.type}@${g.start}/${g.duration}`).sort(), ['chapter@1/2', 'list@4.5/3', 'progress@0/9', 'stat@3/1.4']);
});

test('every graphic type and layout draws without errors through its whole animation', () => {
  for (const [type, def] of Object.entries(GRAPHIC_TYPES))
    for (const layout of def.layouts) {
      const g = cleanGraphic({ id: 'g', type, layout, text: type === 'stat' ? '90%' : 'Hello *world* here', sub: 'sub', body: 'a body', items: ['🧠 One', 'Two: a, b', 'Three'], values: [100, 20], labels: ['then', 'now', '$'], start: 1, duration: 3 });
      for (const t of [0.5, 1.0, 1.05, 1.3, 1.7, 2.5, 3.9, 4.1]) {
        const ctx = fakeCtx();
        const n = drawGraphics(ctx, [g], t, 1080, 1920);
        assert.equal(n, t >= 1 && t < 4 ? 1 : 0, `${type}/${layout} at ${t}`);
        for (const [, ...args] of ctx.calls) for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${type}/${layout} at ${t}: non-finite argument`);
      }
    }
});

test('animated captions: word timing, emphasis, and the layer', async () => {
  const { captionWords, drawCaptions } = await import('../shared/captions-anim.js');
  const [c] = captionWords([{ start: 2, end: 4, text: 'Ninety percent brew it too hot' }], ['too hot']);
  assert.equal(c.words.length, 6);
  assert.equal(c.words[0].start, 2);
  assert.ok(Math.abs(c.words[5].end - 4) < 1e-9);
  assert.ok(c.words.every((w, i) => i === 0 || w.start >= c.words[i - 1].start));
  assert.deepEqual(c.words.map((w) => w.emph), [false, false, false, false, true, true]);
  assert.ok(captionWords([{ start: 0, end: 1, text: 'saved $1,200 today' }])[0].words[1].emph, 'money is emphasised automatically');
  for (const style of ['pill', 'pop', 'editorial', 'karaoke']) {
    const ctx = fakeCtx();
    assert.equal(drawCaptions(ctx, [c], 3, 1080, 1920, { style }), true, style);
    assert.equal(drawCaptions(fakeCtx(), [c], 5, 1080, 1920, { style }), false);
  }
  const { drawLayer, layerItems, videoShiftAt, shiftWindows, sfxEvents } = await import('../shared/layer.js');
  const tl = normalizeTimeline({
    clips: [{ id: 'c', assetId: 'a', in: 0, out: 10 }],
    captions: { enabled: true, style: 'pop', items: [{ id: 'k', assetId: 'a', start: 0, end: 2, text: 'hello there' }] },
    graphics: [cleanGraphic({ id: 'p', type: 'headline', layout: 'panel', start: 3, duration: 2, text: 'x' }), cleanGraphic({ id: 's', type: 'stat', start: 6, duration: 2, text: '9%' })],
    broll: [{ id: 'b', start: 8, duration: 1.5, assetId: 'img', layout: 'split' }, { id: 'c2', start: 0.5, duration: 1, assetId: 'img', layout: 'card' }],
  });
  assert.equal(layerItems(tl).length, 4, '2 graphics + 1 photo card + 1 caption line');
  assert.ok(drawLayer(fakeCtx(), tl, 1, 1080, 1920, {}) >= 2, 'card + caption at 1s');
  assert.deepEqual(shiftWindows(tl, 1080, 1920).map((w) => [w.start, w.px]), [[3, 691], [8, 960]]);
  assert.equal(videoShiftAt(tl, 2.9, 1080, 1920), 0);
  assert.equal(Math.round(videoShiftAt(tl, 4, 1080, 1920)), 691, 'fully down mid-panel');
  assert.ok(videoShiftAt(tl, 3.1, 1080, 1920) > 0 && videoShiftAt(tl, 3.1, 1080, 1920) < 691, 'eases in');
  const ev = sfxEvents(tl);
  assert.deepEqual(ev.map((e) => e.kind), ['pop', 'whoosh', 'pop', 'ding', 'swoosh']);
  assert.deepEqual(sfxEvents({ ...tl, sfx: { enabled: false } }), []);
});

test('timeline: look, sound effects, clip zoom and B-roll layouts are validated ops', () => {
  const tl0 = applyOps(emptyTimeline(), [{ type: 'addClip', assetId: 'a', in: 0, out: 3, clipId: 'c1' }]).timeline;
  const { timeline: tl, errors } = applyOps(tl0, [
    { type: 'setStyle', patch: { theme: 'clean', captionColor: 'pink' } },
    { type: 'setSfx', patch: { volume: 3, enabled: 0 } },
    { type: 'updateClip', clipId: 'c1', patch: { zoom: 9 } },
    { type: 'addBroll', broll: { start: 1, duration: 2, layout: 'split', query: 'x' } },
    { type: 'addBroll', broll: { start: 2, duration: 1, layout: 'diagonal' } },
    { type: 'setStyle', patch: { theme: 'neon' } },
  ]);
  assert.deepEqual(errors.map((e) => e.error), ['Unknown look']);
  assert.deepEqual(tl.style, { theme: 'clean', captionColor: 'pink' });
  assert.deepEqual(tl.sfx, { enabled: false, volume: 1 });
  assert.equal(tl.clips[0].zoom, 1.6);
  assert.deepEqual(tl.broll.map((b) => b.layout), ['split', 'full']);
  assert.equal(normalizeTimeline({ captions: { items: [] } }).captions.style, 'bold', 'older projects keep a static style');
  assert.equal(emptyTimeline().captions.style, 'pill', 'new projects get animated captions');
});

test('stock: the right rendition is downloaded', async () => {
  const { pickFile } = await import('../server/media/stock.js');
  const files = [{ width: 540, height: 960 }, { width: 720, height: 1280 }, { width: 1080, height: 1920 }, { width: 2160, height: 3840 }];
  assert.deepEqual(pickFile(files), { width: 720, height: 1280 });
  assert.deepEqual(pickFile([{ width: 540, height: 960 }, { width: 2160, height: 3840 }]), { width: 2160, height: 3840 });
  assert.deepEqual(pickFile([{ width: 360, height: 640 }, { width: 540, height: 960 }]), { width: 540, height: 960 });
});

test('motion graphics: every editable field can be changed after adding (layout, body, values, labels, variant, photo, sound)', () => {
  const { timeline: tl } = applyOps(emptyTimeline(), [{ type: 'addGraphic', graphic: { id: 'g1', type: 'headline', text: 'x', start: 0 } }]);
  assert.equal(tl.graphics[0].layout, 'panel');
  let t2 = tl;
  for (const layout of ['full', 'overlay', 'panel']) {
    t2 = applyOps(t2, [{ type: 'updateGraphic', graphicId: 'g1', patch: { layout } }]).timeline;
    assert.equal(t2.graphics[0].layout, layout);
  }
  const bad = applyOps(t2, [{ type: 'updateGraphic', graphicId: 'g1', patch: { layout: 'sideways' } }]).timeline;
  assert.equal(bad.graphics[0].layout, 'panel', 'unknown layouts fall back to the type default');
  const c = applyOps(tl, [
    { type: 'updateGraphic', graphicId: 'g1', patch: { type: 'chart', values: [10, 5], labels: ['a', 'b', '$'], layout: 'full' } },
    { type: 'updateGraphic', graphicId: 'g1', patch: { body: 'b', variant: 'speech', assetId: 'img', sfx: 'none' } },
  ]).timeline.graphics[0];
  assert.deepEqual([c.type, c.layout, c.values, c.labels, c.body, c.variant, c.assetId, c.sfx], ['chart', 'full', [10, 5], ['a', 'b', '$'], 'b', 'speech', 'img', 'none']);
});
