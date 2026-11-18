// Runs the export plan for the sample project with native ffmpeg (the browser runs the same
// commands with ffmpeg.wasm) and checks the output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { buildRenderPlan } from '../shared/render-graph.js';
import { newProjectData } from '../shared/project.js';
import { cleanPlan, planToTimeline } from '../shared/plan.js';
import { rulePlan } from '../shared/rules.js';
import { parseProbe } from '../shared/probe.js';

const root = path.resolve('client/public');

test('sample project renders to a vertical MP4 of the right length and loudness, with motion graphics', { timeout: 180_000 }, () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'sample', 'manifest.json'), 'utf8'));
  const data = newProjectData({ aspect: '9:16', targetLength: 35 });
  data.assets = m.assets.map((a, i) => ({ ...a, id: `a${i}` }));
  data.transcript = { segments: m.lines.map(([s, e, t], i) => ({ id: `s${i + 1}`, assetId: 'a0', start: s, end: e, text: t })) };
  const { plan } = cleanPlan(rulePlan(data), data.transcript.segments);
  const timeline = planToTimeline(plan, data.transcript.segments, { aspect: '9:16' });
  timeline.music.assetId = 'a2';
  timeline.broll[0].assetId = 'a1';

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editflow-render-'));
  fs.mkdirSync(path.join(dir, 'fonts'));
  fs.copyFileSync('assets/fonts/Poppins-Bold.ttf', path.join(dir, 'fonts', 'Poppins-Bold.ttf'));
  // Motion graphics arrive as PNG frames + an ffconcat list (the browser draws them with canvas).
  // Here: a solid magenta square held for 0.5 s, then a cyan one, shown from 1.0 s to 2.0 s.
  for (const [n, c] of [['g0_00000.png', 'magenta'], ['g0_00001.png', 'cyan']]) {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', `color=c=${c}:s=200x200,format=rgba,pad=540:960:100:100:color=black@0`, '-frames:v', '1', n], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr.slice(-400));
  }
  fs.writeFileSync(path.join(dir, 'graphics_0.txt'), "ffconcat version 1.0\nfile 'g0_00000.png'\nduration 0.5\nfile 'g0_00001.png'\nduration 0.5\nfile 'g0_00001.png'\n");
  const rp = buildRenderPlan({ timeline, assets: data.assets }, { aspect: '9:16', quality: 'draft', outName: 'out.mp4', inputPath: (a) => path.join(root, a.url), fontsDir: 'fonts', graphics: [{ listName: 'graphics_0.txt', start: 1, end: 2 }] });
  fs.writeFileSync(path.join(dir, rp.assName), rp.ass);
  fs.writeFileSync(path.join(dir, rp.listName), rp.list);
  for (const sg of [...rp.segments.map((s) => s.args), rp.final]) {
    const r = spawnSync(ffmpeg, ['-hide_banner', ...sg], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr.slice(-600));
  }
  const info = parseProbe(spawnSync(ffmpeg, ['-hide_banner', '-i', path.join(dir, 'out.mp4')], { encoding: 'utf8' }).stderr);
  assert.equal(info.width, 540);
  assert.equal(info.height, 960);
  assert.ok(Math.abs(info.duration - rp.duration) < 0.1, `duration ${info.duration} vs ${rp.duration}`);
  const loud = spawnSync(ffmpeg, ['-hide_banner', '-i', path.join(dir, 'out.mp4'), '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const lufs = Number(loud.match(/I:\s*(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]);
  assert.ok(lufs > -15.5 && lufs < -12.5, `loudness ${lufs}`);
  const px = (t) => [...spawnSync(ffmpeg, ['-hide_banner', '-ss', String(t), '-i', path.join(dir, 'out.mp4'), '-frames:v', '1', '-vf', 'crop=2:2:200:200', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e6 }).stdout];
  const [r1, g1, b1] = px(1.25);
  assert.ok(r1 > 200 && g1 < 80 && b1 > 200, `magenta graphic at 1.25s, got ${r1},${g1},${b1}`);
  const [r2, g2, b2] = px(1.75);
  assert.ok(r2 < 80 && g2 > 200 && b2 > 200, `cyan graphic at 1.75s, got ${r2},${g2},${b2}`);
  const [r3, g3, b3] = px(2.6);
  assert.ok(!(g3 > 200 && b3 > 200 && r3 < 80), 'graphic gone after its window');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('export: punch-in zoom, top-panel push-down, split-screen image B-roll with pan, sound effects', { timeout: 180_000 }, () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'sample', 'manifest.json'), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editflow-render2-'));
  fs.mkdirSync(path.join(dir, 'fonts'));
  fs.copyFileSync('assets/fonts/Poppins-Bold.ttf', path.join(dir, 'fonts', 'Poppins-Bold.ttf'));
  const run = (args) => {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-y', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr.slice(-800));
  };
  run(['-f', 'lavfi', '-i', 'color=c=0x00ff00:s=800x600', '-frames:v', '1', 'still.png']); // pure green "photo"
  run(['-f', 'lavfi', '-i', 'sine=f=880:d=0.2', '-af', 'apad=whole_dur=6', '-ar', '48000', '-ac', '2', 'sfx.wav']);
  const footage = { ...m.assets[0], id: 'a0' };
  const still = { id: 'img', kind: 'broll', mediaType: 'image', name: 'still.png', duration: 0 };
  const timeline = {
    format: { aspect: '9:16' },
    clips: [
      { id: 'c1', assetId: 'a0', in: 0, out: 3, volume: 1, zoom: 1, transitionIn: 'cut' },
      { id: 'c2', assetId: 'a0', in: 3, out: 6, volume: 1, zoom: 1.3, transitionIn: 'cut' },
    ],
    captions: { enabled: false, style: 'pill', items: [] },
    overlays: [],
    graphics: [{ id: 'g1', type: 'headline', layout: 'panel', start: 0.5, duration: 1.5, text: 'x' }],
    broll: [{ id: 'b1', start: 3.5, duration: 2, assetId: 'img', layout: 'split', srcIn: 0 }],
    music: {},
    audio: { normalize: false },
  };
  const inputPath = (a) => (a.id === 'img' ? path.join(dir, 'still.png') : path.join(root, a.url));
  const media = { a0: { hasVideo: true, hasAudio: true }, img: { hasVideo: true, hasAudio: false } };
  const rp = buildRenderPlan({ timeline, assets: [footage, still] }, { aspect: '9:16', quality: 'draft', outName: 'out.mp4', inputPath, media, fontsDir: 'fonts', sfxPath: 'sfx.wav' });
  assert.ok(rp.segments[1].args.join(' ').includes('scale=702:1248'), 'clip 2 is zoomed 1.3x');
  assert.ok(rp.final.join(' ').includes("overlay=x=0:y='346*min("), 'the panel pushes the speaker down by the panel height');
  fs.writeFileSync(path.join(dir, rp.assName), rp.ass);
  fs.writeFileSync(path.join(dir, rp.listName), rp.list);
  for (const sg of [...rp.segments.map((s) => s.args), rp.final]) run(sg);
  const px = (t, x, y) => [...spawnSync(ffmpeg, ['-hide_banner', '-ss', String(t), '-i', path.join(dir, 'out.mp4'), '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e6 }).stdout];
  const [r1, g1, b1] = px(4.6, 270, 200); // top half during the split: the green still
  assert.ok(g1 > 180 && r1 < 90 && b1 < 90, `split B-roll in the top half, got ${r1},${g1},${b1}`);
  const [r2, g2, b2] = px(4.6, 270, 760); // bottom half: the speaker footage, not green
  assert.ok(!(g2 > 180 && r2 < 90 && b2 < 90), 'speaker stays in the bottom half');
  const vol = spawnSync(ffmpeg, ['-hide_banner', '-i', path.join(dir, 'out.mp4'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  assert.match(vol, /max_volume/);
  fs.rmSync(dir, { recursive: true, force: true });
});
