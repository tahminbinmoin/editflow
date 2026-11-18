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

test('sample project renders to a vertical MP4 of the right length and loudness', { timeout: 180_000 }, () => {
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
  const rp = buildRenderPlan({ timeline, assets: data.assets }, { aspect: '9:16', quality: 'draft', outName: 'out.mp4', inputPath: (a) => path.join(root, a.url), fontsDir: 'fonts' });
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
  fs.rmSync(dir, { recursive: true, force: true });
});
