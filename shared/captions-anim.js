// Animated captions, drawn with canvas like the motion graphics (so Bangla and emoji work,
// and preview = export). Word timings are estimated inside each caption line from word length
// (transcripts give line timing, not word timing); emphasised words come from the AI analysis
// (timeline.captions.emphasis) plus automatic picks (numbers, money, percentages).
import { clamp01, easeOut, easeOutBack, setFont, textWidth, rrect, shadow, frameGuides } from './gfx-core.js';

/** Animated styles (static styles are rendered by libass in render-graph.js). */
export const ANIMATED_CAPTION_STYLES = {
  pill: { label: 'Pill · word by word (Ali Abdaal)', desc: 'Small white pill; the spoken word turns bold and dark' },
  pop: { label: 'Pop · big bold words', desc: 'Words pop in one by one, keywords in colour' },
  editorial: { label: 'Editorial · serif keywords (Neel Nafis)', desc: 'Bold sans with italic serif keywords in colour' },
  karaoke: { label: 'Karaoke · moving highlight', desc: 'A colour box slides from word to word' },
};
export const isAnimatedStyle = (s) => !!ANIMATED_CAPTION_STYLES[s];

const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}%$£€৳]+/gu, '');
const AUTO_EMPH = /\d|[%$£€৳]/;

/**
 * Captions on the timeline → [{ start, end, words: [{ t, start, end, emph }] }]
 * @param caps    timelineCaptions(tl) output
 * @param emphasis list of words/phrases to highlight
 */
export function captionWords(caps, emphasis = []) {
  const phrases = (emphasis || []).map((p) => String(p).toLowerCase().split(/\s+/).map(norm).filter(Boolean)).filter((p) => p.length);
  return (caps || []).map((c) => {
    const raw = String(c.text).split(/\s+/).filter(Boolean);
    const weights = raw.map((w) => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const dur = Math.max(0.2, c.end - c.start);
    let acc = 0;
    const keys = raw.map(norm);
    const emph = raw.map((w) => AUTO_EMPH.test(w));
    for (const ph of phrases)
      for (let i = 0; i + ph.length <= keys.length; i++) if (ph.every((p, j) => keys[i + j] === p)) for (let j = 0; j < ph.length; j++) emph[i + j] = true;
    const exact = Array.isArray(c.w) && c.w.length === raw.length;
    const words = raw.map((t, i) => {
      if (exact) return { t, start: c.w[i][0], end: c.w[i][1], emph: emph[i] };
      const s = c.start + (acc / total) * dur;
      acc += weights[i];
      return { t, start: s, end: c.start + (acc / total) * dur, emph: emph[i] };
    });
    return { start: c.start, end: c.end, text: c.text, words };
  });
}

/** Split words into at most 2 lines that fit maxW. */
function wrap(ctx, words, size, maxW, fontOf) {
  const space = textWidth(ctx, ' ', size, fontOf({}));
  const lines = [[]];
  let w = 0;
  for (const word of words) {
    const ww = textWidth(ctx, word.t, size * (word.emph ? (fontOf(word).family === 'serif' ? 1.25 : 1.08) : 1), fontOf(word));
    if (lines[lines.length - 1].length && w + space + ww > maxW && lines.length < 2) {
      lines.push([]);
      w = 0;
    }
    lines[lines.length - 1].push({ ...word, w: ww });
    w += (lines[lines.length - 1].length > 1 ? space : 0) + ww;
  }
  return { lines: lines.map((l) => ({ words: l, width: l.reduce((a, x) => a + x.w, 0) + space * (l.length - 1) })), space };
}

/**
 * Draw the caption line active at `time`.
 * opts: { style, position: 'lower'|'center', accent: hex }
 */
export function drawCaptions(ctx, items, time, W, H, { style = 'pill', position = 'lower', accent = '#FFD43B' } = {}) {
  const c = items.find((x) => time >= x.start && time < x.end);
  if (!c) return false;
  const { base } = frameGuides(W, H);
  const cy = position === 'center' ? H * 0.5 : H * 0.74;
  const lt = time - c.start;
  const spoken = (w) => time >= w.start;
  const active = (w) => time >= w.start && time < w.end;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  if (style === 'pill') {
    const size = base * 0.05;
    const font = (w) => ({ family: 'clean', weight: w.t && spoken(w) ? 800 : 700 });
    const { lines, space } = wrap(ctx, c.words, size, W * 0.78, () => ({ family: 'clean', weight: 800 }));
    const lh = size * 1.35;
    const padX = size * 0.6;
    const bw = Math.max(...lines.map((l) => l.width)) + padX * 2;
    const bh = lines.length * lh + size * 0.55;
    const pop = easeOutBack(lt / 0.18, 2);
    ctx.translate(W / 2, cy);
    ctx.scale(0.9 + 0.1 * pop, 0.9 + 0.1 * pop);
    ctx.globalAlpha = clamp01(lt / 0.08) * clamp01((c.end - time) / 0.06 + 0.2);
    shadow(ctx, base, true, 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    rrect(ctx, -bw / 2, -bh / 2, bw, bh, size * 0.45);
    ctx.fill();
    shadow(ctx, base, false);
    lines.forEach((line, li) => {
      let x = -line.width / 2;
      const y = -bh / 2 + size * 0.275 + lh * (li + 0.5);
      for (const w of line.words) {
        setFont(ctx, size, font(w));
        ctx.fillStyle = active(w) ? '#111' : spoken(w) ? '#2B2620' : '#A39B90';
        if (w.emph && spoken(w)) ctx.fillStyle = accent === '#FFFFFF' ? '#111' : accent;
        ctx.fillText(w.t, x, y);
        x += w.w + space;
      }
    });
  } else if (style === 'pop') {
    const size = base * 0.078;
    const font = () => ({ family: 'sans' });
    // Only the words said so far are laid out, so the line grows from the centre.
    const shownWords = c.words.filter(spoken);
    const { lines, space } = wrap(ctx, shownWords.map((w) => ({ ...w, t: w.t.toUpperCase() })), size, W * 0.84, font);
    const lh = size * 1.12;
    let idx = 0;
    lines.forEach((line, li) => {
      let x = W / 2 - line.width / 2;
      const y = cy - ((lines.length - 1) * lh) / 2 + li * lh;
      for (const w of line.words) {
        const orig = shownWords[idx++];
        {
          const p = easeOutBack((time - orig.start) / 0.16, 2.6);
          const s = (w.emph ? 1.08 : 1) * size;
          ctx.save();
          ctx.translate(x + w.w / 2, y);
          ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p);
          ctx.rotate(w.emph ? -0.04 : 0);
          setFont(ctx, s, font());
          ctx.textAlign = 'center';
          ctx.lineJoin = 'round';
          ctx.lineWidth = s * 0.16;
          ctx.strokeStyle = '#000';
          ctx.strokeText(w.t, 0, 0);
          ctx.fillStyle = w.emph ? accent : '#FFFFFF';
          ctx.fillText(w.t, 0, 0);
          ctx.restore();
        }
        x += w.w + space;
      }
    });
  } else if (style === 'editorial') {
    const size = base * 0.058;
    const font = (w) => (w.emph ? { family: 'serif', italic: true, weight: 400 } : { family: 'clean', weight: 800 });
    const { lines, space } = wrap(ctx, c.words, size, W * 0.84, font);
    const lh = size * 1.18;
    const fade = easeOut(lt / 0.2);
    ctx.globalAlpha = fade;
    shadow(ctx, base, true, 0.9);
    lines.forEach((line, li) => {
      let x = W / 2 - line.width / 2;
      const y = cy - ((lines.length - 1) * lh) / 2 + li * lh + (1 - fade) * size * 0.3;
      for (const w of line.words) {
        const s = size * (w.emph ? 1.25 : 1);
        setFont(ctx, s, font(w));
        ctx.globalAlpha = fade * (spoken(w) ? 1 : 0.55);
        ctx.fillStyle = w.emph ? accent : '#FFFFFF';
        ctx.fillText(w.t, x, y);
        x += w.w + space;
      }
    });
  } else {
    // karaoke
    const size = base * 0.064;
    const font = () => ({ family: 'sans' });
    const { lines, space } = wrap(ctx, c.words, size, W * 0.84, font);
    const lh = size * 1.3;
    ctx.globalAlpha = clamp01(lt / 0.1);
    let idx = 0;
    lines.forEach((line, li) => {
      let x = W / 2 - line.width / 2;
      const y = cy - ((lines.length - 1) * lh) / 2 + li * lh;
      for (const w of line.words) {
        const orig = c.words[idx++];
        if (active(orig)) {
          const p = easeOut((time - orig.start) / 0.12);
          ctx.fillStyle = accent;
          rrect(ctx, x - size * 0.16, y - size * 0.62, (w.w + size * 0.32) * (0.7 + 0.3 * p), size * 1.24, size * 0.18);
          ctx.fill();
        }
        setFont(ctx, size, font());
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.12;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        if (!active(orig)) ctx.strokeText(w.t, x, y);
        ctx.fillStyle = active(orig) ? '#111' : '#FFFFFF';
        ctx.fillText(w.t, x, y);
        x += w.w + space;
      }
    });
  }
  ctx.restore();
  return true;
}
