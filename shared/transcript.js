// Transcript parsing and segment bookkeeping (pure; used in the browser and in tests).

const ts = (s) => {
  const m = String(s).trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/** Parse SRT / WebVTT, or spread plain text over the clip duration (estimated timing). */
export function parseTranscriptFile(text, duration) {
  const src = String(text).replace(/\r/g, '').trim();
  const cueRe = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
  if (cueRe.test(src)) {
    const out = [];
    for (const block of src.split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => cueRe.test(l));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->');
      const words = lines
        .slice(i + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (words) out.push({ start: ts(a), end: ts(b.split(/\s/).filter(Boolean)[0]), text: words });
    }
    return { timing: 'exact', segments: mergeShort(out.filter((s) => s.end > s.start)) };
  }
  // Plain text: one segment per sentence, timing spread by word count (clearly marked as estimated).
  const sentences = src.match(/[^.!?\n]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [];
  const total = sentences.reduce((n, s) => n + s.split(/\s+/).length, 0) || 1;
  const span = duration || total / 2.6;
  let t = 0;
  return {
    timing: 'estimated',
    segments: sentences.map((s) => {
      const d = (span * s.split(/\s+/).length) / total;
      const seg = { start: +t.toFixed(2), end: +(t + d).toFixed(2), text: s };
      t += d;
      return seg;
    }),
  };
}

/** Subtitle cues are often 1–2 s fragments; merge into sentence-ish segments for story editing. */
function mergeShort(cues) {
  const out = [];
  for (const c of cues) {
    const last = out[out.length - 1];
    const endsSentence = last && /[.!?]["')\]]?$/.test(last.text);
    if (last && !endsSentence && c.start - last.end < 0.4 && last.end - last.start < 8) {
      last.end = c.end;
      last.text = `${last.text} ${c.text}`;
    } else out.push({ ...c });
  }
  return out;
}

/** Replace one asset's segments and keep IDs unique across the project (s1, s2, …). */
export function setAssetSegments(transcript, assetId, segments, source) {
  const others = transcript.segments.filter((s) => s.assetId !== assetId);
  let next = Math.max(0, ...transcript.segments.map((s) => Number(String(s.id).slice(1)) || 0)) + 1;
  const fresh = segments
    .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => {
      const seg = { id: `s${next++}`, assetId, start: +(+s.start).toFixed(2), end: +(+s.end).toFixed(2), text: String(s.text).trim().slice(0, 600) };
      const words = cleanWords(s.words);
      if (words.length) {
        seg.words = words;
        if (s.approx || words.some((w) => w.a)) seg.approx = true;
      }
      return seg;
    });
  transcript.segments = [...others, ...fresh];
  transcript.source = source;
  return fresh.length;
}

/** Validated word list: [{ t, s, e, a?, k?, c? }] in time order (max 200 per line). */
export function cleanWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .filter((w) => w && typeof w.t === 'string' && w.t.trim() && Number.isFinite(+w.s) && Number.isFinite(+w.e) && +w.e >= +w.s)
    .slice(0, 200)
    .map((w) => {
      const o = { t: w.t.trim().slice(0, 60), s: Math.round(+w.s * 1000) / 1000, e: Math.round(+w.e * 1000) / 1000 };
      if (w.a) o.a = 1;
      if (w.k) o.k = 1;
      if (w.c) o.c = 1;
      return o;
    });
}
