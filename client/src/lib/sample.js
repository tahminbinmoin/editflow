// Creates the sample project from the static files in client/public/sample (see scripts/make-sample.mjs).
import { newProjectData } from '@shared/project.js';
import { uid } from '@shared/timeline.js';
import { cleanPlan, planToTimeline } from '@shared/plan.js';
import { rulePlan } from '@shared/rules.js';
import { createProject } from './store.js';

export async function createSampleProject() {
  const manifest = await (await fetch('/sample/manifest.json')).json();
  const data = newProjectData({
    platform: 'TikTok / Reels / Shorts',
    aspect: '9:16',
    targetLength: 35,
    audience: 'Small-brand owners who film their own product videos',
    goal: 'Teach three quick fixes and get follows for part two',
    tone: 'Direct, friendly, practical',
    notes: 'Sample project — placeholder footage and a written sample transcript.',
  });
  data.assets = manifest.assets.map((a) => ({ ...a, id: uid('ast') }));
  const footage = data.assets.find((a) => a.kind === 'footage');
  const broll = data.assets.find((a) => a.kind === 'broll');
  const music = data.assets.find((a) => a.kind === 'music');
  data.transcript = {
    source: 'sample',
    language: 'en',
    segments: manifest.lines.map(([start, end, text], i) => ({ id: `s${i + 1}`, assetId: footage.id, start, end, text })),
  };
  const { plan, warnings } = cleanPlan(rulePlan(data), data.transcript.segments);
  const tl = planToTimeline(plan, data.transcript.segments, { aspect: '9:16' });
  tl.music.assetId = music.id;
  if (tl.broll[0]) tl.broll[0].assetId = broll.id;
  data.plan = { ...plan, warnings, meta: { engine: 'rules', providerName: 'Rule-based (no AI)', at: new Date().toISOString() } };
  data.timeline = tl;
  return createProject('Sample · 3 product-video mistakes', null, { data, isSample: true });
}
