// Shared drawing toolkit for motion graphics and animated captions (Canvas 2D).
// Everything here is pure: no DOM, only the standard CanvasRenderingContext2D API, so the
// preview (Player.jsx) and the export (graphicsFrames.js) draw exactly the same pixels.

/** Font families the client registers (client/src/lib/graphicsFrames.js). */
export const FONTS = {
  sans: 'EditflowGraphics', // Poppins Bold: punchy titles and pop captions
  clean: 'EFInter', // Inter 400/700/800: UI-like cards (Ali Abdaal style)
  serif: 'EFSerif', // Instrument Serif regular + italic: editorial panels (Neel Nafis style)
  hand: 'EFHand', // Caveat Bold: handwritten notes
  bangla: 'EFBangla', // Hind Siliguri: Bangla glyphs for every stack
};

export const FONT_FILES = [
  { family: FONTS.sans, url: '/fonts/Poppins-Bold.ttf', weight: '700' },
  { family: FONTS.clean, url: '/fonts/inter-latin-400-normal.woff2', weight: '400' },
  { family: FONTS.clean, url: '/fonts/inter-latin-700-normal.woff2', weight: '700' },
  { family: FONTS.clean, url: '/fonts/inter-latin-800-normal.woff2', weight: '800' },
  { family: FONTS.serif, url: '/fonts/instrument-serif-latin-400-normal.woff2', weight: '400' },
  { family: FONTS.serif, url: '/fonts/instrument-serif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  { family: FONTS.hand, url: '/fonts/caveat-latin-700-normal.woff2', weight: '700' },
  { family: FONTS.bangla, url: '/fonts/hind-siliguri-bengali-600-normal.woff2', weight: '600' },
  { family: FONTS.bangla, url: '/fonts/hind-siliguri-bengali-700-normal.woff2', weight: '700' },
];

/**
 * Looks, taken from the reference channels:
 *  editorial — cream panels, serif headlines with an italic coloured keyword (Neel Nafis)
 *  clean     — white cards, clean sans, underlined keywords, handwritten notes (Ali Abdaal)
 *  bold      — loud promo: Poppins, yellow and black (Bangladeshi promo reels)
 */
export const THEMES = {
  editorial: { label: 'Editorial', desc: 'Cream panels, serif headlines, italic coloured keywords', paper: '#EEEAE2', card: '#FFFFFF', ink: '#191613', muted: '#6F675D', head: 'serif', body: 'clean', accent: '#E0522F', emphasis: 'italic' },
  clean: { label: 'Clean', desc: 'White cards, clean type, underlined keywords, handwritten notes', paper: '#FAF7F2', card: '#FFFFFF', ink: '#1E1A16', muted: '#7A7268', head: 'clean', body: 'clean', accent: '#F06A2B', emphasis: 'underline' },
  bold: { label: 'Bold promo', desc: 'Heavy type, yellow and black, big energy', paper: '#FFD43B', card: '#FFFFFF', ink: '#111111', muted: '#3A3A3A', head: 'sans', body: 'sans', accent: '#E8262D', emphasis: 'marker' },
};
export const themeOf = (tl) => THEMES[tl?.style?.theme] || THEMES.editorial;

export const clamp01 = (p) => (p < 0 ? 0 : p > 1 ? 1 : p);
export const easeOut = (p) => 1 - Math.pow(1 - clamp01(p), 3);
export const easeIn = (p) => Math.pow(clamp01(p), 3);
export const easeInOut = (p) => {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutBack = (p, s = 1.70158) => {
  const x = clamp01(p) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};
/** Damped spring 0→1 (bouncy pop-ins). */
export const spring = (p, bounces = 2.2) => {
  const x = clamp01(p);
  return x >= 1 ? 1 : 1 - Math.cos(x * Math.PI * bounces) * Math.exp(-6 * x);
};
export const lerp = (a, b, p) => a + (b - a) * p;
/** Deterministic pseudo-random in [0,1) from a string + index (stable charts, wobbles). */
export function rand(seed, i = 0) {
  let h = 2166136261 ^ i;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function setFont(ctx, size, { family = 'sans', weight, italic = false } = {}) {
  const fam = FONTS[family] || family;
  const w = weight || (family === 'serif' ? 400 : family === 'clean' ? 700 : 700);
  ctx.font = `${italic ? 'italic ' : ''}${w} ${Math.max(6, Math.round(size))}px ${fam}, ${FONTS.bangla}, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Helvetica Neue", Arial, sans-serif`;
}
export function textWidth(ctx, s, size, f) {
  setFont(ctx, size, f);
  return ctx.measureText(String(s)).width;
}
/** Largest size ≤ `size` (≥ min×size) at which `s` fits `maxW`. */
export function fitSize(ctx, s, size, maxW, f, min = 0.45) {
  const w = textWidth(ctx, s, size, f);
  return w <= maxW ? size : Math.max(size * min, (size * maxW) / w);
}
export function ellipsize(ctx, s, size, maxW, f) {
  if (textWidth(ctx, s, size, f) <= maxW) return s;
  let t = String(s);
  while (t.length > 1 && textWidth(ctx, `${t}…`, size, f) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
export function drawText(ctx, s, x, y, size, color, align = 'left', f) {
  setFont(ctx, size, f);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(s), x, y);
}
export function rrect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
export function shadow(ctx, base, on = true, strength = 1) {
  ctx.shadowColor = on ? `rgba(0,0,0,${0.32 * strength})` : 'transparent';
  ctx.shadowBlur = on ? base * 0.03 * strength : 0;
  ctx.shadowOffsetY = on ? base * 0.008 * strength : 0;
}

/** "So where did the *buyers go?*" → [{ t: 'So where did the ', em: false }, { t: 'buyers go?', em: true }] */
export function richRuns(s) {
  const out = [];
  String(s || '')
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .forEach((part) => out.push(part.startsWith('*') && part.endsWith('*') && part.length > 2 ? { t: part.slice(1, -1), em: true } : { t: part, em: false }));
  return out;
}
export const plainText = (s) => String(s || '').replace(/\*/g, '');

/**
 * Word-wrap rich text into lines of positioned words.
 * fonts: { normal: fontSpec, em: fontSpec } (each { family, weight, italic })
 * Returns { lines: [{ words: [{ t, em, x, w }], width }], lineH }
 */
export function layoutRich(ctx, s, size, maxW, fonts, lineGap = 1.12) {
  const words = [];
  for (const run of richRuns(s)) for (const w of run.t.split(/(\s+)/)) if (w && !/^\s+$/.test(w)) words.push({ t: w, em: run.em });
  const space = textWidth(ctx, ' ', size, fonts.normal);
  const lines = [];
  let cur = { words: [], width: 0 };
  for (const w of words) {
    const ww = textWidth(ctx, w.t, size, w.em ? fonts.em : fonts.normal);
    const add = (cur.words.length ? space : 0) + ww;
    if (cur.words.length && cur.width + add > maxW) {
      lines.push(cur);
      cur = { words: [], width: 0 };
    }
    cur.words.push({ ...w, x: cur.width + (cur.words.length ? space : 0), w: ww });
    cur.width += cur.words.length > 1 ? add : ww;
  }
  if (cur.words.length) lines.push(cur);
  return { lines, lineH: size * lineGap };
}
/** Shrink rich text until it fits in maxW × maxH. */
export function fitRich(ctx, s, size, maxW, maxH, fonts, lineGap) {
  let sz = size;
  let lay = layoutRich(ctx, s, sz, maxW, fonts, lineGap);
  while (sz > size * 0.4 && (lay.lines.length * lay.lineH > maxH || lay.lines.some((l) => l.width > maxW * 1.001))) {
    sz *= 0.92;
    lay = layoutRich(ctx, s, sz, maxW, fonts, lineGap);
  }
  return { size: sz, ...lay };
}

/** Frame geometry shared by all graphics. */
export function frameGuides(W, H) {
  const base = Math.min(W, H);
  const captionTop = H * 0.83 - base * 0.19;
  const portrait = H >= W;
  return {
    base,
    marginX: W * 0.065,
    portrait,
    panelH: Math.round(H * (portrait ? 0.36 : 0.42)),
    anchors: { top: H * 0.13, center: H * 0.4, bottom: Math.min(H * 0.7, captionTop - base * 0.03) },
  };
}
