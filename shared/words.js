// Word-level transcript tools (pure; browser, server and tests).
//
// A transcript segment can carry `words: [{ t, s, e, k?, c? }]`:
//   t  the word as said (with punctuation), s/e SOURCE seconds,
//   k  1 = the creator restored it (never auto-cut), c 1 = the creator cut it by hand.
// Disfluency flags are NOT stored: they are recomputed from the words every time (so a better
// detector improves old projects too). Flags: filler | stutter | retake | noise.

export const FILLER_WORDS = new Set(['um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'err', 'ah', 'ahh', 'eh', 'hmm', 'hm', 'mm', 'mmm', 'mhm', 'uhmm', 'emm', 'em']);
const FILLER_SHAPE = /^(u+h+m*|u+m+|e+r+m*|a+h+|h+m+|m+h*m+|e+m+)$/;
/** Words that are fillers only when set off by punctuation ("So, …", "…, like, …"). */
const SOFT_FILLERS = new Set(['like', 'so', 'basically', 'actually', 'literally', 'well', 'okay', 'ok', 'right', 'anyway', 'anyways']);
/** Doubled words that are usually deliberate. */
const REPEAT_OK = new Set(['very', 'really', 'so', 'no', 'yes', 'bye', 'ha', 'haha', 'go', 'more', 'many', 'much', 'had', 'that', 'is']);

const r3 = (n) => Math.round(n * 1000) / 1000;
/** Lower-case, letters/marks/digits only (keeps Bangla vowel signs). */
export const norm = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}']+/gu, '').replace(/^'+|'+$/g, '');
const endsSentence = (raw) => /[.!?]["')\]]?$/.test(String(raw)) && !/(\.\.\.|…)$/.test(String(raw));
const trailsOff = (raw) => /(\.\.\.|…|-|—|–)$/.test(String(raw));

export const tokens = (text) => String(text || '').trim().split(/\s+/).filter(Boolean);

/** Voiced parts of [a, b] from a voice map ([[s, e], …], sorted). */
export function voicedWithin(voice, a, b) {
  if (!voice?.length) return [];
  const out = [];
  for (const [s, e] of voice) {
    if (e <= a) continue;
    if (s >= b) break;
    out.push([Math.max(a, s), Math.min(b, e)]);
  }
  return out;
}
const total = (parts) => parts.reduce((n, [s, e]) => n + (e - s), 0);

/**
 * Word timing when the speech-to-text gave none: spread the words over the parts of the line
 * where there is actually voice (proportional to word length). Marked approximate by the caller.
 */
export function estimateWords(text, start, end, voice) {
  const raw = tokens(text);
  if (!raw.length || !(end > start)) return [];
  let parts = voicedWithin(voice, start, end);
  if (total(parts) < (end - start) * 0.3) parts = [[start, end]];
  const span = total(parts);
  const weight = raw.map((w) => Math.max(2, norm(w).length) + 1);
  const sum = weight.reduce((a, b) => a + b, 0);
  // cumulative voiced time → absolute time
  const at = (x) => {
    let left = x;
    for (const [s, e] of parts) {
      if (left <= e - s + 1e-9) return s + left;
      left -= e - s;
    }
    return parts[parts.length - 1][1];
  };
  let acc = 0;
  return raw.map((t, i) => {
    const s = at((acc / sum) * span);
    acc += weight[i];
    const e = at((acc / sum) * span - (i < raw.length - 1 ? 0.0 : 0));
    return { t, s: r3(s), e: r3(Math.max(s + 0.05, e)) };
  });
}

/**
 * Put the text of a better transcription (`textWords`, strings) onto the word timing of another
 * pass (`timed`, [{ t, s, e }]): edit-distance alignment on normalised words. Words only in the
 * text get the time between their aligned neighbours.
 */
export function alignWords(textWords, timed) {
  const A = textWords.map(norm);
  const B = timed.map((w) => norm(w.t));
  const n = A.length;
  const m = B.length;
  if (!n) return [];
  if (!m) return null;
  const D = Array.from({ length: n + 1 }, (_, i) => new Int32Array(m + 1).map((_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1);
  const map = new Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (D[i][j] === D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)) {
      map[i - 1] = j - 1;
      i--;
      j--;
    } else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  const out = textWords.map((t, i) => (map[i] >= 0 ? { t, s: timed[map[i]].s, e: timed[map[i]].e } : { t, s: null, e: null }));
  // fill unaligned words between their neighbours
  for (let i = 0; i < n; i++) {
    if (out[i].s != null) continue;
    let j = i;
    while (j < n && out[j].s == null) j++;
    const lo = i > 0 ? out[i - 1].e : timed[0].s;
    const hi = j < n ? out[j].s : timed[m - 1].e;
    const step = Math.max(0, hi - lo) / (j - i);
    for (let k = i; k < j; k++) {
      out[k].s = r3(lo + step * (k - i));
      out[k].e = r3(lo + step * (k - i + 1));
    }
    i = j - 1;
  }
  return out;
}

/** Longest common subsequence length of two token lists (small lists only). */
function lcs(a, b) {
  const D = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) D[i][j] = a[i - 1] === b[j - 1] ? D[i - 1][j - 1] + 1 : Math.max(D[i - 1][j], D[i][j - 1]);
  return D[a.length][b.length];
}

/**
 * Flag what a professional editor would cut, for one file's words in source order.
 * Returns an array of flags (null = keep) the same length as `words`.
 *  - filler   um, uh, erm, hmm …; "like", "so", "basically" … when set off by commas;
 *             "you know," / "I mean,"
 *  - stutter  "th- the", "I I think" (doubled short words), cut-off fragments
 *  - retake   a sentence the speaker abandoned and said again (keeps the LAST take)
 *  - noise    words the speech-to-text "heard" where the audio has no voice
 */
export function flagWords(words, voice = null) {
  const n = words.length;
  const flag = new Array(n).fill(null);
  const N = words.map((w) => norm(w.t));
  for (let i = 0; i < n; i++) {
    const raw = String(words[i].t);
    if (!N[i]) {
      flag[i] = 'noise';
      continue;
    }
    if (FILLER_WORDS.has(N[i]) || FILLER_SHAPE.test(N[i])) flag[i] = 'filler';
    else if (SOFT_FILLERS.has(N[i]) && /,$/.test(raw) && (i === 0 || /[,.!?]$/.test(String(words[i - 1].t)))) flag[i] = 'filler';
    else if (i + 1 < n && ((N[i] === 'you' && N[i + 1] === 'know') || (N[i] === 'i' && N[i + 1] === 'mean')) && /,$/.test(String(words[i + 1].t)) && (i === 0 || /[,.!?]$/.test(String(words[i - 1].t)) || N[i] === 'you')) {
      flag[i] = flag[i + 1] = 'filler';
      i++;
    } else if (/[-—–]$/.test(raw) && N[i].length <= 4 && i + 1 < n && N[i + 1].startsWith(N[i].slice(0, 2))) flag[i] = 'stutter';
    else if (i + 1 < n && N[i] === N[i + 1] && !REPEAT_OK.has(N[i]) && N[i].length <= 8 && (words[i + 1].s ?? 0) - (words[i].e ?? 0) < 0.8) flag[i] = 'stutter';
  }
  // Noise: words in places with no voice at all (speech-to-text hallucinations in silence).
  if (voice?.length) {
    for (let i = 0; i < n; i++) {
      const w = words[i];
      if (flag[i] || !(w.e > w.s)) continue;
      const v = total(voicedWithin(voice, w.s - 0.03, w.e + 0.03));
      if (v < Math.min(0.06, (w.e - w.s) * 0.25)) flag[i] = 'noise';
    }
  }
  // Retakes: a run that starts the same way (3+ words) as a run shortly after it.
  const live = [];
  for (let i = 0; i < n; i++) if (!flag[i]) live.push(i);
  const L = live.map((i) => N[i]);
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 2; b < Math.min(live.length, a + 32); b++) {
      let len = 0;
      while (b + len < live.length && a + len < b && L[a + len] === L[b + len]) len++;
      if (len < 2 || (len < 3 && b - a > 4)) continue;
      const first = L.slice(a, b);
      const second = L.slice(b, b + first.length + 2);
      const wa = words[live[a]];
      const wb = words[live[b]];
      if ((wb.s ?? 0) - (wa.s ?? 0) > 25) break;
      const lastOfFirst = words[live[b - 1]];
      const pause = (wb.s ?? 0) - (lastOfFirst.e ?? 0);
      const wholeRepeat = len >= first.length; // the line was said again word for word
      const aborted = (!endsSentence(lastOfFirst.t) || trailsOff(lastOfFirst.t)) && pause >= 0.25 && lcs(first, second) / first.length >= 0.6;
      if (wholeRepeat || aborted) {
        for (let k = a; k < b; k++) flag[live[k]] = 'retake';
        a = b - 1;
        break;
      }
    }
  }
  return flag;
}

/** Split one file's timed words into sentence-like transcript lines. */
export function segmentsFromWords(words, { maxLen = 12, maxWords = 32, pause = 0.6 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].s, end: cur[cur.length - 1].e, text: cur.map((w) => w.t).join(' '), words: cur });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev && (w.s - prev.e >= pause || w.e - cur[0].s > maxLen || cur.length >= maxWords)) flush();
    cur.push({ ...w });
    if (endsSentence(w.t) && (!words[i + 1] || words[i + 1].s - w.e > 0.05 || cur.length >= 4)) flush();
  });
  flush();
  return out;
}

/** Strip punctuation at the edges for caption display ("coffee," → "coffee"; keeps "?" and "!"). */
export const captionWord = (t) => String(t).replace(/^["'“‘(\[]+/, '').replace(/[,.;:"'”’)\]]+$/, '').replace(/[-—–]+$/, '');
