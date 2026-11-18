// Generates the sample project media into client/public/sample (run: npm run sample).
// Placeholder footage + a synthetic "speech" tone that is only present during the written
// sample transcript lines, so waveforms, pause detection and the first cut behave like real footage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { parseProbe } from '../shared/probe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'client', 'public', 'sample');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets', 'fonts', 'Poppins-Bold.ttf'), path.join(out, 'fonts', 'Poppins-Bold.ttf'));

export const LINES = [
  [0.6, 3.4, 'Okay so, um, today I want to talk about product videos.'],
  [4.6, 8.9, 'I filmed over two hundred product videos last year for small brands.'],
  [9.8, 14.2, 'And honestly, most of them failed for the same three reasons.'],
  [16.0, 20.3, 'Mistake one: you start with your logo instead of the problem.'],
  [21.1, 25.6, 'Nobody scrolls past a hook to see a logo. Show the problem first.'],
  [27.4, 31.0, 'Mistake two: you never show the product in someone’s hand.'],
  [31.8, 36.2, 'A close-up of a real person using it does more than any feature list.'],
  [38.4, 39.4, 'Um, yeah.'],
  [40.2, 44.8, 'Mistake three: your video is too long. Cut it to thirty seconds.'],
  [45.6, 50.0, 'Why do ninety percent of viewers leave in the first three seconds?'],
  [50.9, 55.0, 'Because the first three seconds didn’t give them a reason to stay.'],
  [56.5, 60.2, 'Follow for part two, where I fix a real brand’s video live.'],
];

function ff(args) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { cwd: out, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0 && !args.includes('null') && args[0] !== '-i') throw new Error(r.stderr.split('\n').slice(-5).join('\n'));
  return r.stderr;
}

function clip(name, seconds, c0, c1, label, sub, lines) {
  fs.writeFileSync(
    path.join(out, `${name}.ass`),
    `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: L,Poppins,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,40,40,40,1\nStyle: S,Poppins,34,&H99FFFFFF,&H99FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,2,40,40,80,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,9:00:00.00,L,,0,0,0,,${label}\nDialogue: 0,0:00:00.00,9:00:00.00,S,,0,0,0,,${sub}\n`,
  );
  const gate = lines?.length ? lines.map(([a, b]) => `between(t,${a},${b})`).join('+') : '0';
  const audio = lines?.length
    ? `aevalsrc='(0.22*sin(2*PI*170*t)+0.1*sin(2*PI*340*t))*(0.55+0.45*sin(2*PI*4.2*t))*(${gate})':s=48000:d=${seconds}`
    : `anoisesrc=d=${seconds}:c=pink:a=0.02`;
  ff(['-y', '-f', 'lavfi', '-i', `gradients=s=1280x720:c0=${c0}:c1=${c1}:speed=0.008:d=${seconds}:r=30`, '-f', 'lavfi', '-i', audio,
    '-filter_complex', `[0:v]subtitles=filename=${name}.ass:fontsdir=fonts,format=yuv420p[v]`, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', `${name}.mp4`]);
  fs.rmSync(path.join(out, `${name}.ass`));
  return `${name}.mp4`;
}

function peaksOf(file, perSecond = 20) {
  const rate = 4000;
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { cwd: out, maxBuffer: 1 << 28 });
  const buf = r.stdout;
  const bucket = rate / perSecond;
  const pk = [];
  for (let i = 0; i < buf.length / 2; i += bucket) {
    let m = 0;
    for (let j = i; j < Math.min(i + bucket, buf.length / 2); j++) m = Math.max(m, Math.abs(buf.readInt16LE(j * 2)));
    pk.push(Math.round((m / 32768) * 100));
  }
  return pk;
}

function silencesOf(file) {
  const log = ff(['-i', file, '-vn', '-af', 'silencedetect=noise=-35dB:d=0.6', '-f', 'null', '-']);
  const res = [];
  let s = null;
  for (const line of log.split('\n')) {
    const a = line.match(/silence_start:\s*(-?[\d.]+)/);
    const b = line.match(/silence_end:\s*([\d.]+)/);
    if (a) s = Math.max(0, Number(a[1]));
    if (b && s != null) (res.push({ start: +s.toFixed(2), end: +Number(b[1]).toFixed(2) }), (s = null));
  }
  return res;
}

function meta(file, kind, name, extra = {}) {
  const info = parseProbe(ff(['-i', file]));
  const base = file.replace(/\.[^.]+$/, '');
  if (info.hasVideo) ff(['-y', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', `${base}-thumb.jpg`]);
  if (info.hasAudio) fs.writeFileSync(path.join(out, `${base}-peaks.json`), JSON.stringify(peaksOf(file)));
  return {
    kind,
    name,
    url: `/sample/${file}`,
    thumbUrl: info.hasVideo ? `/sample/${base}-thumb.jpg` : null,
    peaksUrl: info.hasAudio ? `/sample/${base}-peaks.json` : null,
    thumb: info.hasVideo,
    hasPeaks: info.hasAudio,
    size: fs.statSync(path.join(out, file)).size,
    duration: +info.duration.toFixed(3),
    width: info.width,
    height: info.height,
    hasVideo: info.hasVideo,
    hasAudio: info.hasAudio,
    status: 'ready',
    progress: 1,
    sample: true,
    ...extra,
  };
}

const main = clip('sample-talking-head', 61.5, '0x3a2a22', '0x14110f', 'SAMPLE FOOTAGE', 'Placeholder for a talking-head clip', LINES);
const broll = clip('sample-broll', 8, '0xff5b3a', '0x5a2318', 'SAMPLE B-ROLL', 'Stand-in for a product close-up');
ff(['-y', '-f', 'lavfi', '-i',
  "aevalsrc='0.08*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.06*sin(2*PI*277.18*t)+0.05*sin(2*PI*329.63*t)+0.03*sin(2*PI*110*t)*lt(t-floor(t)\\,0.12)':s=48000:d=30",
  '-c:a', 'aac', '-b:a', '64k', 'sample-music.m4a']);

const manifest = {
  note: 'Sample project — placeholder footage, a synthetic speech tone and a written sample transcript.',
  assets: [
    meta(main, 'footage', 'sample-talking-head.mp4', { silences: silencesOf(main) }),
    meta(broll, 'broll', 'sample-broll.mp4'),
    meta('sample-music.m4a', 'music', 'sample-music.m4a (generated pad)'),
  ],
  lines: LINES,
};
fs.rmSync(path.join(out, 'fonts'), { recursive: true, force: true });
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('Sample written to client/public/sample:', fs.readdirSync(out).join(', '));
