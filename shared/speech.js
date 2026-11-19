// Speech chunking for transcription. Current OpenAI transcription models return text without
// timestamps, so Editflow finds the spoken stretches itself (energy-based, split at pauses),
// transcribes each stretch separately, and uses the stretch's start/end as the line timing.
// Pure functions on 16-bit PCM WAV bytes; used by the API (and tests).

/** Parse a PCM WAV header. Returns { rate, channels, bits, offset, length } or throws. */
export function wavInfo(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let o = 12;
  let fmt = null;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), channels: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error('Expected 16-bit PCM WAV audio');
      return { rate: fmt.rate, channels: fmt.channels, bits: 16, offset: o + 8, length: Math.min(size, bytes.length - o - 8) };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('WAV file has no audio data');
}

/** Mono Int16 samples (first channel) from WAV bytes. */
export function wavSamples(bytes, info = wavInfo(bytes)) {
  const n = Math.floor(info.length / 2 / info.channels);
  const dv = new DataView(bytes.buffer, bytes.byteOffset + info.offset, info.length);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2 * info.channels, true);
  return out;
}

/**
 * Find spoken stretches: [{ start, end }] in seconds.
 *  - 20 ms frames, loudness in dBFS; threshold adapts to the recording's noise floor
 *  - pauses shorter than `minGap` stay inside a stretch
 *  - stretches longer than `maxLen` are split at their quietest moment
 */
export function speechChunks(samples, rate, { maxLen = 14, minGap = 0.35, pad = 0.12, minLen = 0.3 } = {}) {
  const hop = Math.max(1, Math.round(rate * 0.02));
  const frames = Math.floor(samples.length / hop);
  if (!frames) return [];
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, e = i + hop; i < e; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / hop) / 32768;
    db[f] = rms > 0 ? 20 * Math.log10(rms) : -100;
  }
  const sorted = Float32Array.from(db).sort();
  const floor = sorted[Math.floor(frames * 0.15)];
  const peak = sorted[Math.floor(frames * 0.98)];
  const thr = Math.max(-55, Math.min(floor + 10, peak - 12));
  const fdur = hop / rate;
  const runs = [];
  let s = -1;
  let lastOn = -1;
  for (let f = 0; f < frames; f++) {
    if (db[f] > thr) {
      if (s < 0) s = f;
      else if ((f - lastOn) * fdur > minGap) {
        runs.push([s, lastOn + 1]);
        s = f;
      }
      lastOn = f;
    }
  }
  if (s >= 0) runs.push([s, lastOn + 1]);
  const maxF = Math.round(maxLen / fdur);
  const out = [];
  for (let [a, b] of runs) {
    while (b - a > maxF) {
      // split at the quietest frame in the last 40% of the allowed length
      let cut = a + maxF;
      let best = Infinity;
      for (let f = a + Math.round(maxF * 0.6); f < a + maxF; f++) if (db[f] < best) ((best = db[f]), (cut = f));
      out.push([a, cut]);
      a = cut;
    }
    out.push([a, b]);
  }
  const total = samples.length / rate;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const res = [];
  for (const [a, b] of out) {
    const prev = res[res.length - 1];
    const c = { start: Math.max(0, a * fdur - pad, prev ? prev.end : 0), end: Math.min(total, b * fdur + pad) };
    if (c.end - c.start >= minLen) res.push(c);
  }
  return res.map((c) => ({ start: r3(c.start), end: r3(c.end) }));
}

/** A standalone mono 16-bit WAV of samples[start..end] (seconds). */
export function wavSlice(samples, rate, start, end) {
  const a = Math.max(0, Math.floor(start * rate));
  const b = Math.min(samples.length, Math.ceil(end * rate));
  const n = Math.max(0, b - a);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, samples[a + i], true);
  return new Uint8Array(buf);
}

/** Run `fn` over items with at most `limit` in flight; results keep their order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Voice activity map: where someone is actually making sound, at 10 ms resolution.
 * Used to put every cut on the exact edge of speech and to remove ALL silence.
 *  - adaptive to the recording: threshold sits between its noise floor and speech level
 *  - hysteresis (on above `high`, off below `low`) so word tails aren't chopped
 *  - gaps under `bridge` are joined, blips under `minBlip` are dropped
 * @param samples Int16Array (scale 32768) or Float32Array (scale 1)
 * @returns [[start, end], ...] seconds, rounded to 10 ms
 */
export function voiceActivity(samples, rate, { scale = samples instanceof Float32Array ? 1 : 32768, bridge = 0.05, minBlip = 0.06 } = {}) {
  const hop = Math.max(1, Math.round(rate * 0.01));
  const frames = Math.floor(samples.length / hop);
  if (!frames) return [];
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, e = i + hop; i < e; i++) {
      const v = samples[i] / scale;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / hop);
    db[f] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  }
  const sorted = Float32Array.from(db).sort();
  const floor = sorted[Math.floor(frames * 0.1)];
  const peak = sorted[Math.floor(frames * 0.97)];
  const range = Math.max(0, peak - floor);
  if (range < 6) return peak > -50 ? [[0, r2(samples.length / rate)]] : []; // constant level: all voice or all silence
  const high = floor + Math.max(9, range * 0.38);
  const low = floor + Math.max(6, range * 0.22);
  const out = [];
  let on = -1;
  for (let f = 0; f < frames; f++) {
    if (on < 0 && db[f] > high) {
      // walk back to where it rose above `low` (catches soft onsets like "f", "s", "h")
      let a = f;
      while (a > 0 && db[a - 1] > low && f - a < 15) a--;
      on = a;
    } else if (on >= 0 && db[f] < low) {
      out.push([on, f]);
      on = -1;
    }
  }
  if (on >= 0) out.push([on, frames]);
  const fd = hop / rate;
  const merged = [];
  for (const [a, b] of out) {
    const last = merged[merged.length - 1];
    if (last && (a - last[1]) * fd < bridge) last[1] = b;
    else merged.push([a, b]);
  }
  return merged.filter(([a, b]) => (b - a) * fd >= minBlip).map(([a, b]) => [r2(a * fd), r2(b * fd)]);
}
const r2 = (n) => Math.round(n * 100) / 100;
