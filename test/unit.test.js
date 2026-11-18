import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTimeline, applyOp, applyOps, layout, timelineCaptions, diffSummary } from '../shared/timeline.js';
import { cleanPlan, planToTimeline, chunkCaption } from '../shared/plan.js';
import { parseTranscriptFile } from '../shared/transcript.js';
import { extractJson } from '../server/ai/providers.js';
import { rulePlan, ruleRefine } from '../shared/rules.js';
import { buildAss, dimensions, buildRenderPlan } from '../shared/render-graph.js';
import { parseProbe } from '../shared/probe.js';
import { encrypt, decrypt } from '../server/lib/secrets.js';
import { checkRouterUrl } from '../server/ai/providers.js';

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

test('hosted app refuses private router URLs', () => {
  const prev = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    assert.throws(() => checkRouterUrl('http://localhost:3001/v1'), /cannot reach a router on your own computer/);
    assert.throws(() => checkRouterUrl('http://192.168.1.5:3001/v1'));
    assert.equal(checkRouterUrl('https://router.example.com/v1/'), 'https://router.example.com/v1');
  } finally {
    if (prev === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prev;
  }
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
