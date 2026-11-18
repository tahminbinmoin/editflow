// Export renderer: turns the timeline data into ONE ffmpeg command (filter graph + ASS
// subtitle file for captions and text templates). Pure functions, no I/O: the browser runs
// the command with ffmpeg.wasm, and tests run it with native ffmpeg.
import { layout, timelineCaptions, normalizeTimeline, ASPECTS } from './timeline.js';

export const QUALITIES = {
  draft: { label: 'Draft (540p, fast)', short: 540, crf: 28 },
  standard: { label: 'Standard (720p)', short: 720, crf: 23 },
  high: { label: 'High (1080p)', short: 1080, crf: 20 },
};

export function dimensions(aspect, quality) {
  const a = ASPECTS[aspect] || ASPECTS['9:16'];
  const s = QUALITIES[quality]?.short || 720;
  const even = (n) => Math.round(n / 2) * 2;
  return a.w <= a.h ? { W: s, H: even((s * a.h) / a.w) } : { W: even((s * a.w) / a.h), H: s };
}

const f3 = (n) => Number(n).toFixed(3);
const assTime = (s) => {
  const t = Math.max(0, s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = (t % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sec}`;
};
const assText = (s) => String(s).replace(/\\/g, '/').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');

/** Build the ASS subtitle file holding captions and text overlays. */
export function buildAss(tl, W, H) {
  const base = Math.min(W, H);
  const px = (k) => Math.round(base * k);
  const capCenter = tl.captions.position === 'center';
  const capAlign = capCenter ? 5 : 2;
  const capMarginV = capCenter ? 0 : Math.round(H * 0.17);
  // Colours are &HAABBGGRR
  const ACCENT = '&H003A5BFF';
  const capStyles = {
    bold: `Style: Cap,Poppins,${px(0.075)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${px(0.009)},0,${capAlign},${px(0.08)},${px(0.08)},${capMarginV},1`,
    clean: `Style: Cap,Poppins,${px(0.065)},&H00FFFFFF,&H00FFFFFF,&H50000000,&H96000000,-1,0,0,0,100,100,0,0,1,${px(0.003)},${px(0.006)},${capAlign},${px(0.08)},${px(0.08)},${capMarginV},1`,
    boxed: `Style: Cap,Poppins,${px(0.06)},&H00FFFFFF,&H00FFFFFF,&H40141414,&H00000000,-1,0,0,0,100,100,0,0,3,${px(0.018)},0,${capAlign},${px(0.08)},${px(0.08)},${capMarginV},1`,
    accent: `Style: Cap,Poppins,${px(0.075)},&H0055D7FF,&H0055D7FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${px(0.009)},0,${capAlign},${px(0.08)},${px(0.08)},${capMarginV},1`,
  };
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${capStyles[tl.captions.style] || capStyles.bold}
Style: title,Poppins,${px(0.11)},&H00FFFFFF,&H00FFFFFF,${ACCENT},&H00000000,-1,0,0,0,100,100,0,0,3,${px(0.025)},0,5,${px(0.07)},${px(0.07)},0,1
Style: lowerThird,Poppins,${px(0.05)},&H00FFFFFF,&H00FFFFFF,&H30141414,&H00000000,-1,0,0,0,100,100,0,0,3,${px(0.016)},0,1,${Math.round(W * 0.06)},${px(0.06)},${Math.round(H * 0.3)},1
Style: kicker,Poppins,${px(0.045)},&H00FFFFFF,&H00FFFFFF,${ACCENT},&H00000000,-1,0,0,0,100,100,0,0,3,${px(0.014)},0,8,${px(0.06)},${px(0.06)},${Math.round(H * 0.07)},1
Style: cta,Poppins,${px(0.07)},&H00FFFFFF,&H00FFFFFF,${ACCENT},&H00000000,-1,0,0,0,100,100,0,0,3,${px(0.022)},0,2,${px(0.07)},${px(0.07)},${Math.round(H * 0.33)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  if (tl.captions.enabled) {
    for (const c of timelineCaptions(tl)) lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${assText(c.text)}`);
  }
  for (const o of tl.overlays) {
    const text = o.sub ? `${assText(o.text)}\\N{\\fs${px(0.034)}\\b0}${assText(o.sub)}` : assText(o.text);
    lines.push(`Dialogue: 1,${assTime(o.start)},${assTime(o.start + o.duration)},${o.template},,0,0,0,,{\\fad(160,160)}${text}`);
  }
  return head + lines.join('\n') + '\n';
}

/**
 * Plan the export as a sequence of ffmpeg commands with flat memory use:
 *   1. one short command per clip → an intermediate segment (trim, reframe, fades, clip volume)
 *   2. one final command → join segments in order (concat demuxer), add B-roll cutaways,
 *      captions/titles, voice clean-up, loudness and music.
 * ffmpeg.wasm can't buffer a whole video in memory, so rendering clips one at a time matters.
 *
 * @param project { timeline, assets }
 * @param opts    { aspect, quality, outName, inputPath(asset), media: {[assetId]: {hasVideo, hasAudio}}, fontsDir, workDir }
 */
export function buildRenderPlan(project, { aspect, quality, outName, inputPath, media = {}, fontsDir = 'fonts', workDir = '' }) {
  const tl = normalizeTimeline({ ...project.timeline, format: { ...project.timeline.format, aspect } });
  const { clips, duration } = layout(tl);
  if (!clips.length) throw new Error('The timeline is empty — add at least one clip before exporting.');
  const { W, H } = dimensions(aspect, quality);
  const assets = Object.fromEntries(project.assets.map((a) => [a.id, { ...a, ...(media[a.id] || {}) }]));
  const used = [];
  const use = (a) => (used.includes(a.id) ? null : used.push(a.id));
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const AF = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const voiceVol = tl.audio.voiceVolume ?? 1;
  const segName = (i) => `${workDir}seg_${String(i).padStart(3, '0')}.mkv`;

  // ---- step 1: one segment per clip (H.264 ultrafast + PCM audio, so joins are sample-exact)
  const segments = clips.map((c, i) => {
    const a = assets[c.assetId];
    if (!a) throw new Error(`Clip ${i + 1} refers to a missing file.`);
    use(a);
    const d = c.duration;
    const fx = [];
    const next = clips[i + 1];
    if (c.transitionIn === 'fade' && i > 0) fx.push('fade=t=in:st=0:d=0.2');
    if (c.transitionIn === 'flash' && i > 0) fx.push('fade=t=in:st=0:d=0.15:color=white');
    if (next?.transitionIn === 'fade') fx.push(`fade=t=out:st=${f3(Math.max(0, d - 0.2))}:d=0.2`);
    const inputs = ['-ss', f3(c.in), '-t', f3(d), '-i', inputPath(a)];
    const graph = [];
    if (a.hasVideo) graph.push(`[0:v]trim=duration=${f3(d)},setpts=PTS-STARTPTS,${fit},fps=30,format=yuv420p,setsar=1${fx.length ? ',' + fx.join(',') : ''}[v]`);
    else graph.push(`color=c=0x141210:s=${W}x${H}:r=30:d=${f3(d)},format=yuv420p,setsar=1[v]`);
    const vol = (c.volume ?? 1) * voiceVol;
    if (a.hasAudio) graph.push(`[0:a]atrim=duration=${f3(d)},asetpts=PTS-STARTPTS,${AF},volume=${vol.toFixed(3)},afade=t=in:st=0:d=0.02,afade=t=out:st=${f3(Math.max(0, d - 0.03))}:d=0.03,apad=whole_dur=${f3(d)}[a]`);
    else graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f3(d)}[a]`);
    return {
      out: segName(i),
      duration: d,
      args: ['-y', ...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]', '-t', f3(d), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', segName(i)],
    };
  });
  const listName = `${workDir}segments.txt`;
  const list = segments.map((sg) => `file '${sg.out.split('/').pop()}'`).join('\n') + '\n';

  // ---- step 2: join + overlays + audio
  const inputs = [['-f', 'concat', '-safe', '0', '-i', listName]];
  const graph = [];
  let vLabel = '0:v';
  tl.broll
    .filter((b) => b.assetId && assets[b.assetId]?.hasVideo && b.start < duration)
    .forEach((b, k) => {
      const d = Math.min(b.duration, duration - b.start);
      const a = assets[b.assetId];
      use(a);
      const idx = inputs.length;
      inputs.push(['-ss', f3(b.srcIn || 0), '-t', f3(d), '-i', inputPath(a)]);
      graph.push(`[${idx}:v]trim=duration=${f3(d)},setpts=PTS-STARTPTS+${f3(b.start)}/TB,${fit},fps=30,format=yuv420p,setsar=1[br${k}]`);
      graph.push(`[${vLabel}][br${k}]overlay=eof_action=pass:enable='between(t,${f3(b.start)},${f3(b.start + d)})'[vb${k}]`);
      vLabel = `vb${k}`;
    });
  graph.push(`[${vLabel}]subtitles=filename=${workDir}overlays.ass:fontsdir=${fontsDir}[vout]`);

  const voice = ['highpass=f=70'];
  if (tl.audio.denoise) voice.push('afftdn=nf=-25');
  if (tl.audio.normalize) voice.push('loudnorm=I=-14:TP=-1.5:LRA=11');
  voice.push('aresample=48000', AF);
  graph.push(`[0:a]${voice.join(',')}[voice]`);

  const music = tl.music.assetId && assets[tl.music.assetId]?.hasAudio ? assets[tl.music.assetId] : null;
  if (music) {
    use(music);
    const m = inputs.length;
    inputs.push(['-stream_loop', '-1', '-i', inputPath(music)]);
    const fadeOut = Math.max(0, duration - 1.5);
    graph.push(`[${m}:a]atrim=0:${f3(duration)},asetpts=PTS-STARTPTS,${AF},volume=${(tl.music.volume ?? 0.22).toFixed(3)},afade=t=in:st=0:d=0.6,afade=t=out:st=${f3(fadeOut)}:d=1.5[mus]`);
    if (tl.music.duck) {
      graph.push('[voice]asplit=2[vmain][vsc]');
      graph.push('[mus][vsc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[musd]');
      graph.push('[vmain][musd]amix=inputs=2:duration=first:normalize=0[aout]');
    } else graph.push('[voice][mus]amix=inputs=2:duration=first:normalize=0[aout]');
  } else graph.push('[voice]anull[aout]');

  const q = QUALITIES[quality] || QUALITIES.standard;
  const final = [
    '-y', ...inputs.flat(),
    '-filter_complex', graph.join(';\n'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q.crf), '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', f3(duration), outName,
  ];
  return { segments, list, listName, final, ass: buildAss(tl, W, H), assName: `${workDir}overlays.ass`, duration, W, H, usedAssetIds: used };
}
