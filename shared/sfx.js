// Synthesised sound effects (no audio files, no licensing): pop, whoosh, swoosh, click, ding.
// Each works on any BaseAudioContext, so the preview (AudioContext, live) and the export
// (OfflineAudioContext → WAV mixed by ffmpeg) produce the same sound.

function noiseBuffer(ctx, seconds) {
  const n = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

/** Schedule one effect at context time `when` into `dest` (gain 0–1). */
export function playSfx(ctx, kind, when, dest, gain = 0.5) {
  const out = ctx.createGain();
  out.gain.value = gain;
  out.connect(dest);
  const env = (node, a, peak, d) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + a);
    g.gain.exponentialRampToValueAtTime(0.0001, when + a + d);
    node.connect(g);
    g.connect(out);
    return g;
  };
  if (kind === 'pop' || kind === 'click') {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = kind === 'click' ? 1800 : 900;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(kind === 'click' ? 900 : 220, when + 0.09);
    env(o, 0.004, kind === 'click' ? 0.6 : 0.9, kind === 'click' ? 0.05 : 0.12);
    o.start(when);
    o.stop(when + 0.2);
  } else if (kind === 'ding') {
    for (const [f, a] of [[1318.5, 0.5], [1975.5, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      env(o, 0.005, a, 0.6);
      o.start(when);
      o.stop(when + 0.7);
    }
  } else {
    // whoosh (graphics) / swoosh (B-roll): band-passed noise sweeping up then down
    const len = kind === 'swoosh' ? 0.45 : 0.35;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, len + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(kind === 'swoosh' ? 400 : 700, when);
    bp.frequency.exponentialRampToValueAtTime(kind === 'swoosh' ? 2600 : 3800, when + len * 0.55);
    bp.frequency.exponentialRampToValueAtTime(900, when + len);
    src.connect(bp);
    env(bp, len * 0.45, 0.7, len * 0.55);
    src.start(when);
    src.stop(when + len + 0.05);
  }
}

/** Render all events into a stereo buffer (export). Returns an AudioBuffer or null. */
export async function renderSfx(events, duration, gain = 0.5, OfflineCtx = globalThis.OfflineAudioContext) {
  if (!events.length || !OfflineCtx) return null;
  const rate = 48000;
  const ctx = new OfflineCtx(2, Math.ceil((duration + 0.5) * rate), rate);
  for (const e of events) if (e.t < duration) playSfx(ctx, e.kind, Math.max(0, e.t), ctx.destination, gain);
  return ctx.startRendering();
}

/** AudioBuffer → 16-bit PCM WAV bytes. */
export function bufferToWav(buf) {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
      o += 2;
    }
  return new Uint8Array(out.buffer);
}
