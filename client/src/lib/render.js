// In-browser export with ffmpeg.wasm. The same command builder (shared/render-graph.js)
// that the tests run with native ffmpeg produces the filter graph here.
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { buildRenderPlan } from '@shared/render-graph.js';
import { parseProbe } from '@shared/probe.js';
import { assetBlob } from './media.js';

let ffPromise = null;
let sink = null; // current log collector

export function loadFFmpeg(onStatus) {
  if (!ffPromise) {
    ffPromise = (async () => {
      onStatus?.('Loading the video engine (about 30 MB, first time only)…');
      const ff = new FFmpeg();
      ff.on('log', ({ message }) => sink?.(message));
      await ff.load({
        coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
      });
      await ff.createDir('/fonts');
      await ff.writeFile('/fonts/Poppins-Bold.ttf', await fetchFile('/fonts/Poppins-Bold.ttf'));
      return ff;
    })();
    ffPromise.catch(() => (ffPromise = null));
  }
  return ffPromise;
}

async function collect(ff, args) {
  const lines = [];
  sink = (m) => lines.push(m);
  try {
    const code = await ff.exec(args);
    return { code, log: lines.join('\n') };
  } finally {
    sink = null;
  }
}

const hms = (s) => {
  const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};

/**
 * Render the project's timeline to an MP4 Blob, clip by clip (see buildRenderPlan).
 * @param urls { [assetId]: { file } } resolved media URLs
 */
export async function renderVideo(project, urls, { aspect, quality }, onProgress) {
  const ff = await loadFFmpeg((s) => onProgress?.({ step: s, progress: 0 }));
  const inputPath = (a) => `/in/${a.id}`;
  const opts = { aspect, quality, outName: '/out.mp4', inputPath, fontsDir: '/fonts', workDir: '/' };
  const { usedAssetIds } = buildRenderPlan(project, opts); // first pass: which files are needed
  // Inputs are mounted read-only (WORKERFS): ffmpeg reads straight from the File/Blob, so large
  // local videos never have to fit in the engine's memory.
  const blobs = [];
  for (const [i, id] of usedAssetIds.entries()) {
    const a = project.assets.find((x) => x.id === id);
    onProgress?.({ step: `Opening ${a.name} (${i + 1}/${usedAssetIds.length})…`, progress: 0 });
    blobs.push({ name: id, data: await assetBlob(a, urls) });
  }
  await ff.unmount('/in').catch(() => {}); // left over from an interrupted render
  await ff.createDir('/in').catch(() => {});
  await ff.mount(FFFSType.WORKERFS, { blobs }, '/in');
  const media = {};
  for (const id of usedAssetIds) {
    const a = project.assets.find((x) => x.id === id);
    const { log } = await collect(ff, ['-hide_banner', '-i', inputPath(a)]);
    try {
      const info = parseProbe(log);
      media[id] = { hasVideo: info.hasVideo, hasAudio: info.hasAudio };
    } catch {
      await ff.unmount('/in').catch(() => {});
      throw new Error(`${a.name} could not be read by the video engine.`);
    }
  }
  const plan = buildRenderPlan(project, { ...opts, media });
  await ff.writeFile(plan.assName, plan.ass);
  await ff.writeFile(plan.listName, plan.list);

  const started = performance.now();
  const total = plan.duration * 2; // segment pass + final pass
  let done = 0;
  const run = async (args, span, label) => {
    const lines = [];
    sink = (m) => {
      lines.push(m);
      if (lines.length > 400) lines.splice(0, 200);
      const t = hms(m);
      if (t != null) {
        const p = Math.min(0.99, (done + Math.min(t, span)) / total);
        const elapsed = (performance.now() - started) / 1000;
        onProgress?.({ step: label, progress: p, eta: p > 0.05 ? Math.round((elapsed / p) * (1 - p)) : null });
      }
    };
    let code;
    try {
      code = await ff.exec(['-hide_banner', ...args]);
    } finally {
      sink = null;
    }
    if (code !== 0) {
      const errs = lines.filter((l) => /error|invalid|cannot|failed|out of memory/i.test(l) && !/Conversion failed/.test(l));
      console.error('[editflow] ffmpeg log tail:\n' + lines.slice(-40).join('\n'));
      throw new Error(`Rendering failed: ${(errs.length ? errs.slice(-2) : lines.slice(-3)).join(' | ')}`);
    }
    done += span;
  };
  try {
    for (const [i, sg] of plan.segments.entries()) await run(sg.args, sg.duration, `Preparing clip ${i + 1} of ${plan.segments.length}`);
    await run(plan.final, plan.duration, 'Rendering');
    const data = await ff.readFile('/out.mp4');
    return { blob: new Blob([data], { type: 'video/mp4' }), duration: plan.duration, W: plan.W, H: plan.H, seconds: Math.round((performance.now() - started) / 1000) };
  } finally {
    for (const f of [...plan.segments.map((sg) => sg.out), '/out.mp4', plan.listName, plan.assName]) await ff.deleteFile(f).catch(() => {});
    await ff.unmount('/in').catch(() => {});
  }
}
