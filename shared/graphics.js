// Motion graphics, drawn with the Canvas 2D API (see shared/gfx-core.js). The SAME code
// runs in the preview (Player.jsx, every frame) and in the export (graphicsFrames.js →
// PNG frames → ffmpeg overlay), so what you preview is what renders.
//
// Styles are modelled on the creator's references:
//  - Neel Nafis shorts: cream editorial panel on the top third (serif headline, italic coloured
//    keyword, stat + line chart, pictogram row, dictionary definition) with the speaker below
//  - Ali Abdaal: icon headers with handwritten notes, full-screen serif statement cards with a
//    marker highlight, thought bubbles, tier-list columns, polaroid photo cards, follow CTA
//  - Bangladeshi promo reels: bold keyword pops, stat counters, checklists
import { FONTS, THEMES, clamp01, easeOut, easeIn, easeOutBack, spring, lerp, rand, setFont, textWidth, fitSize, ellipsize, drawText, rrect, shadow, fitRich, plainText, frameGuides } from './gfx-core.js';

export { frameGuides } from './gfx-core.js';
/** Kept for compatibility: the Poppins family name. */
export const GRAPHIC_FONT = FONTS.sans;

// fields: which inputs the editor shows. layouts: allowed values of `layout` (first = default).
export const GRAPHIC_TYPES = {
  headline: { label: 'Headline panel', desc: 'Serif statement with an italic coloured keyword (*word*)', duration: 3.2, fields: ['text', 'sub'], layouts: ['panel', 'full', 'overlay'], position: 'top', group: 'Editorial', textLabel: 'Headline (wrap the keyword in *stars*)', subLabel: 'Small line under it' },
  chart: { label: 'Stat + chart', desc: 'Headline, before/after numbers and a line chart that draws itself', duration: 4, fields: ['text', 'values', 'labels', 'sub'], layouts: ['panel', 'full'], position: 'top', group: 'Editorial', textLabel: 'Headline (e.g. Down *95%* in five years)', subLabel: 'Chart title' },
  pictogram: { label: 'Pictogram', desc: 'Row of people icons with some highlighted (“1 in 5…”)', duration: 3.6, fields: ['text', 'values', 'sub'], layouts: ['panel', 'full'], position: 'top', group: 'Editorial', textLabel: 'Headline (e.g. One in five buyers *left*)', subLabel: 'Change label (e.g. ↓22%)' },
  definition: { label: 'Definition card', desc: 'Dictionary-style term, pronunciation and meaning', duration: 3.8, fields: ['text', 'sub', 'body'], layouts: ['panel', 'full'], position: 'top', group: 'Editorial', textLabel: 'Term', subLabel: 'Word type / pronunciation (e.g. noun · /vaɪb/)' },
  iconRow: { label: 'Icon header', desc: 'Title with a row of emoji tiles and a handwritten note', duration: 3.5, fields: ['text', 'items', 'sub'], layouts: ['overlay'], position: 'top', group: 'Clean', textLabel: 'Title (e.g. Top 5 productivity apps)', subLabel: 'Handwritten note', itemsLabel: 'Tiles: emoji + label, one per line (e.g. 🧠 Notion)' },
  photo: { label: 'Photo card', desc: 'Polaroid-style photo that pops in, with a handwritten caption', duration: 3, fields: ['asset', 'text'], layouts: ['overlay'], position: 'top', group: 'Clean', textLabel: 'Caption' },
  bubble: { label: 'Thought bubble', desc: 'Thought or speech bubble near the speaker', duration: 2.6, fields: ['text', 'variant', 'point'], layouts: ['overlay'], position: 'top', group: 'Clean', textLabel: 'What they’re thinking' },
  columns: { label: 'Tier list', desc: 'Up to 3 columns that fill one by one (Skip / Read / Study)', duration: 4.5, fields: ['text', 'items'], layouts: ['overlay'], position: 'top', group: 'Clean', textLabel: 'Title', itemsLabel: 'Columns, one per line: Header: item, item' },
  versus: { label: 'Versus', desc: 'Two sides compared: before vs after, myth vs fact', duration: 3.2, fields: ['text', 'sub', 'items'], layouts: ['overlay'], position: 'center', group: 'Clean', textLabel: 'Left side', subLabel: 'Right side', itemsLabel: 'Optional detail lines: left, then right' },
  emoji: { label: 'Emoji pop', desc: 'A big emoji that bounces in, with a handwritten label', duration: 1.6, fields: ['text', 'sub', 'point'], layouts: ['overlay'], position: 'center', group: 'Clean', textLabel: 'Emoji', subLabel: 'Label' },
  follow: { label: 'Follow button', desc: 'A cursor clicks a Follow button', duration: 2.6, fields: ['text', 'sub'], layouts: ['overlay'], position: 'bottom', group: 'Clean', textLabel: 'Button text', subLabel: 'Handle (e.g. @yourname)' },
  keyword: { label: 'Keyword pop', desc: 'One big word or phrase pops in', duration: 1.8, fields: ['text'], layouts: ['overlay'], position: 'center', group: 'Bold', textLabel: 'Word or phrase' },
  stat: { label: 'Stat counter', desc: 'A number counts up with a label', duration: 2.8, fields: ['text', 'sub'], layouts: ['overlay'], position: 'center', group: 'Bold', textLabel: 'Number (e.g. 73%, $1,200, 3x)', subLabel: 'What it means' },
  lowerThird: { label: 'Lower third', desc: 'Name and role slide in', duration: 3.5, fields: ['text', 'sub'], layouts: ['overlay'], position: 'bottom', group: 'Bold', textLabel: 'Name', subLabel: 'Role or label' },
  list: { label: 'Checklist', desc: 'Up to 4 points tick in one by one', duration: 4.5, fields: ['text', 'items'], layouts: ['overlay'], position: 'top', group: 'Bold', textLabel: 'Title', itemsLabel: 'Points, one per line (up to 4)' },
  chapter: { label: 'Chapter tag', desc: 'Section label slides in at the top', duration: 2.2, fields: ['text', 'sub'], layouts: ['overlay'], position: 'top', group: 'Bold', textLabel: 'Section title', subLabel: 'Small label (e.g. Step 2)' },
  callout: { label: 'Callout arrow', desc: 'Points at something on screen', duration: 2.5, fields: ['text', 'point'], layouts: ['overlay'], position: 'center', group: 'Bold', textLabel: 'Label' },
  progress: { label: 'Progress bar', desc: 'Thin bar along the top that fills up', duration: 10, fields: [], layouts: ['overlay'], position: 'top', group: 'Bold' },
};

export const GRAPHIC_COLORS = {
  accent: { label: 'Coral', hex: '#E9552F', ink: '#FFFFFF' },
  yellow: { label: 'Yellow', hex: '#FFD43B', ink: '#141210' },
  blue: { label: 'Blue', hex: '#3D7BFF', ink: '#FFFFFF' },
  purple: { label: 'Purple', hex: '#8B6CFF', ink: '#FFFFFF' },
  pink: { label: 'Pink', hex: '#FF4FA3', ink: '#FFFFFF' },
  cyan: { label: 'Cyan', hex: '#22D3EE', ink: '#062A30' },
  green: { label: 'Green', hex: '#2FD08A', ink: '#0E1A14' },
  white: { label: 'White', hex: '#FFFFFF', ink: '#141210' },
};
export const GRAPHIC_POSITIONS = { top: 'Top', center: 'Middle', bottom: 'Bottom' };
export const GRAPHIC_LAYOUTS = { panel: 'Top panel (speaker moves down)', full: 'Full screen card', overlay: 'Over the video' };

const PANEL_SHADOW = 'rgba(0,0,0,0.18)';
const DARK = 'rgba(18,16,14,0.9)';
const round = (n) => Math.round(n * 1000) / 1000;
const clampN = (n, lo, hi, dflt) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Number(n))) : dflt);
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Validate and normalise a graphic (used by the timeline ops). Throws on an unknown type. */
export function cleanGraphic(g = {}, base = {}) {
  const m = { ...base, ...g };
  const def = GRAPHIC_TYPES[m.type];
  if (!def) throw new Error(`Unknown motion graphic "${m.type}"`);
  const layout = def.layouts.includes(m.layout) ? m.layout : def.layouts[0];
  return {
    id: m.id,
    type: m.type,
    start: round(clampN(m.start, 0, 36000, 0)),
    duration: round(clampN(m.duration, 0.6, 36000, def.duration)),
    text: str(m.text, 120),
    sub: str(m.sub, 80),
    body: str(m.body, 200),
    items: (Array.isArray(m.items) ? m.items : []).map((s) => str(s, 80)).filter(Boolean).slice(0, m.type === 'iconRow' ? 5 : 4),
    values: (Array.isArray(m.values) ? m.values : []).map(Number).filter(Number.isFinite).slice(0, 6),
    labels: (Array.isArray(m.labels) ? m.labels : []).map((s) => str(s, 30)).slice(0, 6),
    x: round(clampN(m.x, 0.08, 0.92, 0.5)),
    y: round(clampN(m.y, 0.08, 0.9, m.type === 'bubble' ? 0.3 : 0.5)),
    color: GRAPHIC_COLORS[m.color] ? m.color : 'accent',
    position: GRAPHIC_POSITIONS[m.position] ? m.position : def.position,
    layout,
    variant: ['thought', 'speech'].includes(m.variant) ? m.variant : 'thought',
    assetId: m.assetId ? String(m.assetId).slice(0, 60) : null,
    sfx: m.sfx === 'none' ? 'none' : 'auto',
    reason: str(m.reason, 300),
  };
}

export const isActive = (g, t) => t >= g.start && t < g.start + g.duration;

/** How far a panel/full card is "in" at local time t (0 → 1 → 0). The export's video shift uses the same curve. */
export const PANEL_IN = 0.4;
export const PANEL_OUT = 0.3;
export const panelK = (t, dur) => Math.min(easeOut(t / PANEL_IN), easeOut((dur - t) / PANEL_OUT));

const ZONES = ['top', 'center', 'bottom'];
/** Screen areas a graphic occupies, for overlap checks. */
export function graphicZones(g) {
  if (g.layout === 'full') return ['top', 'center', 'bottom', 'callout', 'edge'];
  if (g.layout === 'panel') return ['top', 'center'];
  if (g.type === 'progress') return ['edge'];
  if (g.type === 'callout' || g.type === 'bubble' || g.type === 'emoji') return ['callout'];
  const i = ZONES.indexOf(g.position);
  return ['list', 'columns', 'iconRow'].includes(g.type) ? [g.position, ZONES[Math.min(2, i + 1)]] : [g.position];
}
const clash = (a, b) => a.start < b.start + b.duration && b.start < a.start + a.duration && graphicZones(a).some((z) => graphicZones(b).includes(z));

/**
 * Fit new graphics around existing ones so two never cover the same area at the same time.
 * An earlier new graphic is shortened to make room if at least half its usual length remains
 * (so a counter still has time to count); otherwise the later one is dropped. Existing
 * graphics are never changed.
 */
export function fitGraphics(existing, incoming) {
  const placed = (existing || []).map((g) => ({ ...g, locked: true }));
  const dropped = [];
  for (const g0 of [...incoming].sort((a, b) => a.start - b.start)) {
    const g = { ...g0 };
    const hits = placed.filter((p) => clash(p, g));
    const minLen = (p) => Math.max(0.8, (GRAPHIC_TYPES[p.type]?.duration || 2) * 0.5);
    const ok = hits.every((p) => !p.locked && p.start < g.start && g.start - p.start - 0.1 >= Math.min(minLen(p), p.duration));
    if (!ok) {
      dropped.push(g0);
      continue;
    }
    for (const p of hits) p.duration = round(g.start - p.start - 0.1);
    placed.push(g);
  }
  return { kept: placed.filter((p) => !p.locked), dropped };
}

/** Time ranges that contain at least one item, merged (for export frame rendering). */
export function graphicWindows(items, duration, pad = 0) {
  const spans = (items || [])
    .map((g) => [Math.max(0, g.start - pad), Math.min(duration, g.start + g.duration + pad)])
    .filter(([a, b]) => b - a > 0.02)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last.end + 0.5) last.end = Math.max(last.end, b);
    else out.push({ start: a, end: b });
  }
  return out.map((w) => ({ start: round(w.start), end: round(w.end) }));
}

/** "$1,200+" → { prefix: '$', value: 1200, decimals: 0, suffix: '+', grouping: true } */
export function parseStat(text) {
  const s = String(text || '');
  const m = s.match(/^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const num = m[2].replace(/,/g, '');
  return { prefix: m[1], value: Number(num), decimals: (num.split('.')[1] || '').length, suffix: m[3], grouping: m[2].includes(',') || Math.abs(Number(num)) >= 10000 };
}
export function formatStat(st, value) {
  const fixed = value.toFixed(st.decimals);
  const [i, d] = fixed.split('.');
  const int = st.grouping ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : i;
  return `${st.prefix}${int}${d ? `.${d}` : ''}${st.suffix}`;
}

// ---------- shared pieces ----------
const HEAD = (th, italic = false) => ({ family: th.head, weight: th.head === 'serif' ? 400 : th.head === 'clean' ? 800 : 700, italic });
const EMF = (th) => (th.emphasis === 'italic' ? { family: 'serif', weight: 400, italic: true } : HEAD(th));

/** Draw laid-out rich text. emStyle: italic (colour only), underline (growing line), marker (highlight sweep). */
function drawRich(ctx, lay, size, { x, y, align = 'left', maxW, color, emColor, th, emStyle = th.emphasis, reveal = 1, t = 9 }) {
  ctx.textBaseline = 'middle';
  lay.lines.forEach((line, li) => {
    const lp = clamp01(reveal * (lay.lines.length + 0.6) - li);
    if (lp <= 0) return;
    const off = align === 'center' ? x - line.width / 2 : align === 'right' ? x + maxW - line.width : x;
    const ly = y + li * lay.lineH + (1 - easeOut(lp)) * size * 0.35;
    ctx.save();
    ctx.globalAlpha *= easeOut(lp);
    line.words.forEach((w, wi) => {
      const f = w.em ? EMF(th) : HEAD(th);
      if (w.em && emStyle === 'marker') {
        const sweep = easeOut((t - 0.35 - li * 0.15) / 0.4);
        const next = line.words[wi + 1];
        const span = next?.em ? next.x - w.x : w.w; // one continuous highlight across a phrase
        ctx.save();
        ctx.fillStyle = emColor;
        ctx.globalAlpha *= 0.38;
        rrect(ctx, off + w.x - size * 0.06, ly - size * 0.42, (span + size * 0.12) * sweep, size * 0.84, size * 0.08);
        ctx.fill();
        ctx.restore();
      }
      setFont(ctx, size, f);
      ctx.textAlign = 'left';
      ctx.fillStyle = w.em && emStyle !== 'marker' ? emColor : color;
      ctx.fillText(w.t, off + w.x, ly);
      if (w.em && emStyle === 'underline') {
        const u = easeOut((t - 0.3 - li * 0.15) / 0.35);
        ctx.fillStyle = emColor;
        ctx.fillRect(off + w.x, ly + size * 0.42, w.w * u, Math.max(2, size * 0.07));
      }
    });
    ctx.restore();
  });
}

/** Cream panel across the top. Returns the panel's current top offset (slides down/up). */
function drawPanel(ctx, g, t, W, gd, th) {
  const k = panelK(t, g.duration);
  const P = gd.panelH;
  const y = -P * (1 - k);
  ctx.fillStyle = th.paper;
  ctx.fillRect(0, y, W, P);
  ctx.fillStyle = PANEL_SHADOW;
  ctx.fillRect(0, y + P - Math.max(1, gd.base * 0.004), W, Math.max(1, gd.base * 0.004));
  return { y, P, k };
}
/** Full-screen paper card. Returns its progress. */
function drawFull(ctx, g, t, W, H, th) {
  const k = panelK(t, g.duration);
  ctx.globalAlpha = k;
  ctx.fillStyle = th.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.025)';
  for (let i = 0; i < 6; i++) ctx.fillRect(0, (H * (i + 0.5)) / 6, W, 1);
  return k;
}
/** Content box for panel/full/overlay layouts: { x, y, w, h, k, onPaper } */
function stage(ctx, g, t, W, H, gd, th) {
  if (g.layout === 'panel') {
    const { y, P, k } = drawPanel(ctx, g, t, W, gd, th);
    const padY = P * 0.14;
    return { x: gd.marginX, y: y + padY, w: W - gd.marginX * 2, h: P - padY * 2, k, onPaper: true };
  }
  if (g.layout === 'full') {
    const k = drawFull(ctx, g, t, W, H, th);
    return { x: gd.marginX * 1.3, y: H * 0.22, w: W - gd.marginX * 2.6, h: H * 0.56, k, onPaper: true };
  }
  const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
  ctx.globalAlpha = clamp01(t / 0.15) * (1 - exit);
  const cy = gd.anchors[g.position];
  return { x: gd.marginX, y: cy - H * 0.14, w: W - gd.marginX * 2, h: H * 0.28, k: 1 - exit, onPaper: false };
}

function person(ctx, cx, cy, s, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.32, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  rrect(ctx, cx - s * 0.3, cy - s * 0.08, s * 0.6, s * 0.58, s * 0.22);
  ctx.fill();
}
function personOutline(ctx, cx, cy, s, stroke, lw) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.setLineDash?.([lw * 1.5, lw * 1.2]);
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.32, s * 0.2, 0, Math.PI * 2);
  ctx.stroke();
  rrect(ctx, cx - s * 0.3, cy - s * 0.08, s * 0.6, s * 0.58, s * 0.22);
  ctx.stroke();
  ctx.setLineDash?.([]);
}
function tick(ctx, cx, cy, r, p, color) {
  if (p <= 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.28;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p1 = [cx - r * 0.42, cy + r * 0.02];
  const p2 = [cx - r * 0.1, cy + r * 0.34];
  const p3 = [cx + r * 0.45, cy - r * 0.3];
  ctx.beginPath();
  ctx.moveTo(...p1);
  if (p < 0.4) ctx.lineTo(p1[0] + (p2[0] - p1[0]) * (p / 0.4), p1[1] + (p2[1] - p1[1]) * (p / 0.4));
  else {
    const q = (p - 0.4) / 0.6;
    ctx.lineTo(...p2);
    ctx.lineTo(p2[0] + (p3[0] - p2[0]) * q, p2[1] + (p3[1] - p2[1]) * q);
  }
  ctx.stroke();
}
/** A hand-drawn curvy arrow from (x1,y1) to (x2,y2), drawn up to progress p. */
function scribbleArrow(ctx, x1, y1, x2, y2, p, color, lw) {
  if (p <= 0) return;
  const mx = (x1 + x2) / 2 + (y2 - y1) * 0.25;
  const my = (y1 + y2) / 2 - (x2 - x1) * 0.25;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const n = 24;
  ctx.moveTo(x1, y1);
  for (let i = 1; i <= Math.round(n * p); i++) {
    const u = i / n;
    ctx.lineTo((1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * mx + u * u * x2, (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * my + u * u * y2);
  }
  ctx.stroke();
  if (p > 0.92) {
    const ang = Math.atan2(y2 - my, x2 - mx);
    const hs = lw * 3.5;
    ctx.beginPath();
    ctx.moveTo(x2 - Math.cos(ang - 0.5) * hs, y2 - Math.sin(ang - 0.5) * hs);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang + 0.5) * hs, y2 - Math.sin(ang + 0.5) * hs);
    ctx.stroke();
  }
}
const EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u;

// ---------- the graphics ----------
const DRAW = {
  headline(ctx, g, t, W, H, gd, col, env) {
    const th = env.theme;
    const st = stage(ctx, g, t, W, H, gd, th);
    const full = g.layout === 'full';
    const color = st.onPaper ? th.ink : '#FFFFFF';
    const size0 = gd.base * (full ? 0.13 : g.layout === 'panel' ? 0.1 : 0.085);
    const subS = gd.base * 0.036;
    const room = st.h - (g.sub ? subS * 2.2 : 0);
    const fonts = full && th.head !== 'sans' ? { normal: { family: 'serif', weight: 400 }, em: { family: 'serif', weight: 400 } } : { normal: HEAD(th), em: EMF(th) };
    const lay = fitRich(ctx, g.text || 'Your *headline*', size0, st.w, room, fonts, 1.08);
    const blockH = lay.lines.length * lay.lineH + (g.sub ? subS * 2.2 : 0);
    const y0 = st.y + (st.h - blockH) / 2 + lay.lineH / 2;
    const align = full || g.layout === 'overlay' ? 'center' : 'left';
    const x = align === 'center' ? W / 2 : st.x;
    if (!st.onPaper) shadow(ctx, gd.base);
    drawRich(ctx, lay, lay.size, { x, y: y0, align, maxW: st.w, color, emColor: col.hex, th: full && th.head !== 'sans' ? { ...th, head: 'serif', emphasis: 'marker' } : th, emStyle: full ? 'marker' : th.emphasis, reveal: easeOut((t - 0.15) / 0.6), t });
    shadow(ctx, gd.base, false);
    if (g.sub) {
      ctx.globalAlpha *= easeOut((t - 0.5) / 0.4);
      drawText(ctx, g.sub, x, y0 + lay.lines.length * lay.lineH - lay.lineH / 2 + subS * 1.4, subS, st.onPaper ? th.muted : 'rgba(255,255,255,.85)', align, { family: 'clean', weight: 400 });
    }
  },

  chart(ctx, g, t, W, H, gd, col, env) {
    const th = env.theme;
    const st = stage(ctx, g, t, W, H, gd, th);
    const [from = 100, to = 40] = g.values;
    const [fromL = '', toL = '', unit = ''] = g.labels;
    const full = g.layout === 'full';
    const side = full ? st.w : st.w * 0.46;
    const numF = { family: th.head === 'serif' ? 'serif' : 'clean', weight: th.head === 'serif' ? 400 : 700 };
    const lay = fitRich(ctx, g.text || `Down *${Math.round((1 - to / (from || 1)) * 100)}%*`, gd.base * 0.082, side, st.h * 0.55, { normal: HEAD(th), em: EMF(th) }, 1.06);
    const textTop = full ? st.y : st.y + st.h * 0.05;
    drawRich(ctx, lay, lay.size, { x: st.x, y: textTop + lay.lineH / 2, maxW: side, color: th.ink, emColor: col.hex, th, reveal: easeOut((t - 0.15) / 0.5), t });
    const fy = textTop + lay.lines.length * lay.lineH + gd.base * 0.05;
    const fs = gd.base * 0.06;
    const fmt = (v) => `${unit}${v}`;
    const w1 = textWidth(ctx, fmt(from), fs, numF);
    const x2 = st.x + Math.max(w1 + fs * 1.4, side * 0.38);
    ctx.save();
    ctx.globalAlpha *= easeOut((t - 0.5) / 0.35);
    drawText(ctx, fmt(from), st.x, fy, fs, th.ink, 'left', numF);
    drawText(ctx, fmt(to), x2, fy, fs, col.hex, 'left', numF);
    if (fromL) drawText(ctx, fromL, st.x, fy + fs * 0.9, gd.base * 0.022, th.muted, 'left', { family: 'clean', weight: 400 });
    if (toL) drawText(ctx, toL, x2, fy + fs * 0.9, gd.base * 0.022, th.muted, 'left', { family: 'clean', weight: 400 });
    ctx.restore();
    const cw = full ? st.w : st.w * 0.5;
    const cx = full ? st.x : st.x + st.w - cw;
    const ch = full ? st.h * 0.45 : st.h * 0.92;
    const cy = full ? fy + fs * 2 : st.y + (st.h - ch) / 2;
    const pop = easeOutBack((t - 0.2) / 0.45, 1.2);
    if (pop <= 0) return;
    ctx.save();
    ctx.translate(cx + cw / 2, cy + ch / 2);
    ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
    ctx.globalAlpha *= clamp01(pop);
    shadow(ctx, gd.base, true, 0.6);
    ctx.fillStyle = th.card;
    rrect(ctx, -cw / 2, -ch / 2, cw, ch, gd.base * 0.018);
    ctx.fill();
    shadow(ctx, gd.base, false);
    const pad = cw * 0.08;
    if (g.sub) drawText(ctx, ellipsize(ctx, g.sub, gd.base * 0.022, cw - pad * 2, { family: 'clean', weight: 400 }), -cw / 2 + pad, -ch / 2 + pad * 0.9, gd.base * 0.022, th.muted, 'left', { family: 'clean', weight: 400 });
    drawText(ctx, fmt(to), -cw / 2 + pad, -ch / 2 + pad * 0.9 + gd.base * 0.04, gd.base * 0.04, th.ink, 'left', { family: 'clean', weight: 700 });
    const gx0 = -cw / 2 + pad;
    const gx1 = cw / 2 - pad;
    const gy0 = -ch / 2 + ch * 0.38;
    const gy1 = ch / 2 - pad;
    const n = 28;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to) || 1;
    const pts = Array.from({ length: n }, (_, i) => {
      const u = i / (n - 1);
      const trend = from + (to - from) * (to < from ? 1 - Math.pow(1 - u, 2.2) : Math.pow(u, 1.6));
      const wig = (rand(g.id || g.text, i) - 0.5) * (hi - lo) * 0.12 * (1 - Math.abs(u - 0.5));
      const v = i === 0 ? from : i === n - 1 ? to : trend + wig;
      return [lerp(gx0, gx1, u), lerp(gy1, gy0, clamp01((v - lo * 0.9) / (hi * 1.05 - lo * 0.9 || 1)))];
    });
    const upto = Math.max(1, Math.floor(easeOut((t - 0.45) / 1.0) * (n - 1)));
    ctx.fillStyle = `${col.hex}22`;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], gy1);
    for (let i = 0; i <= upto; i++) ctx.lineTo(...pts[i]);
    ctx.lineTo(pts[upto][0], gy1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col.hex;
    ctx.lineWidth = Math.max(2, gd.base * 0.006);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    for (let i = 1; i <= upto; i++) ctx.lineTo(...pts[i]);
    ctx.stroke();
    ctx.fillStyle = col.hex;
    ctx.beginPath();
    ctx.arc(pts[upto][0], pts[upto][1], gd.base * 0.008, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  pictogram(ctx, g, t, W, H, gd, col, env) {
    const th = env.theme;
    const st = stage(ctx, g, t, W, H, gd, th);
    const total = Math.max(2, Math.min(10, Math.round(g.values[0] || 5)));
    const hl = Math.max(1, Math.min(total, Math.round(g.values[1] || 1)));
    const full = g.layout === 'full';
    const side = full ? st.w : st.w * 0.48;
    const lay = fitRich(ctx, g.text || 'One in five *left*', gd.base * 0.08, side, full ? st.h * 0.35 : st.h, { normal: HEAD(th), em: EMF(th) }, 1.06);
    const ty = full ? st.y + lay.lineH / 2 : st.y + (st.h - lay.lines.length * lay.lineH) / 2 + lay.lineH / 2;
    drawRich(ctx, lay, lay.size, { x: full ? W / 2 : st.x, y: ty, align: full ? 'center' : 'left', maxW: side, color: th.ink, emColor: col.hex, th, reveal: easeOut((t - 0.15) / 0.5), t });
    const areaX = full ? st.x : st.x + st.w * 0.52;
    const areaW = full ? st.w : st.w * 0.48;
    const s = Math.min(areaW / total, (full ? st.h * 0.4 : st.h * 0.78) / 1.15);
    const ox = areaX + (areaW - s * total) / 2 + s / 2;
    const oy = full ? st.y + st.h * 0.62 : st.y + st.h * 0.42;
    const settled = t > 0.3 + total * 0.08 + 0.3;
    for (let i = 0; i < total; i++) {
      const p = spring((t - 0.3 - i * 0.08) / 0.5);
      if (p <= 0) continue;
      ctx.save();
      ctx.translate(ox + i * s, oy);
      ctx.scale(p, p);
      if (i >= total - hl && settled) personOutline(ctx, 0, 0, s * 0.95, col.hex, Math.max(1.5, s * 0.03));
      else person(ctx, 0, 0, s * 0.95, th.ink);
      ctx.restore();
    }
    if (g.sub) {
      ctx.globalAlpha *= easeOut((t - 0.9) / 0.35);
      drawText(ctx, g.sub, ox + (total - 1) * s, oy + s * 0.78, gd.base * 0.05, col.hex, 'center', { family: th.head === 'serif' ? 'serif' : 'clean', weight: th.head === 'serif' ? 400 : 700 });
    }
  },

  definition(ctx, g, t, W, H, gd, col, env) {
    const th = env.theme;
    const st = stage(ctx, g, t, W, H, gd, th);
    const term = g.text || 'term';
    const tf = { family: 'clean', weight: 400 };
    const termS = fitSize(ctx, term, gd.base * (g.layout === 'full' ? 0.13 : 0.11), st.w, tf);
    const cy = st.y + st.h * 0.3;
    const chars = Math.ceil(term.length * easeOut((t - 0.1) / 0.6));
    drawText(ctx, term.slice(0, chars), W / 2 - textWidth(ctx, term, termS, tf) / 2, cy, termS, th.ink, 'left', tf);
    if (g.sub) {
      ctx.save();
      ctx.globalAlpha *= easeOut((t - 0.6) / 0.35);
      drawText(ctx, g.sub, W / 2, cy + termS * 0.75, gd.base * 0.026, th.muted, 'center', tf);
      ctx.restore();
    }
    if (g.body) {
      const lay = fitRich(ctx, g.body, gd.base * 0.034, st.w * 0.92, st.h * 0.4, { normal: tf, em: { family: 'clean', weight: 700 } }, 1.25);
      ctx.save();
      ctx.globalAlpha *= easeOut((t - 0.85) / 0.4);
      lay.lines.forEach((line, i) => {
        const x0 = W / 2 - line.width / 2;
        for (const w of line.words) {
          setFont(ctx, lay.size, { family: 'clean', weight: w.em ? 700 : 400 });
          ctx.fillStyle = w.em ? col.hex : th.ink;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(w.t, x0 + w.x, cy + termS * 1.35 + i * lay.lineH);
        }
      });
      ctx.restore();
    }
  },

  iconRow(ctx, g, t, W, H, gd, col) {
    const { base, marginX } = gd;
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    ctx.globalAlpha = 1 - exit;
    const top = g.position === 'bottom' ? gd.anchors.bottom - base * 0.36 : g.position === 'center' ? gd.anchors.center - base * 0.18 : gd.anchors.top - base * 0.05;
    const tiles = (g.items.length ? g.items : ['🧠 Notion', '📅 Calendar', '✅ Todoist']).map((it) => {
      const m = it.match(EMOJI_RE);
      return m ? { e: m[1], l: m[2] } : { e: '⭐', l: it };
    });
    const n = tiles.length;
    const ts = Math.min(base * 0.18, ((W - marginX * 2) / n) * 0.8);
    const gap = Math.min(ts * 0.35, (W - marginX * 2 - ts * n) / Math.max(1, n - 1));
    const x0 = (W - (n * ts + (n - 1) * gap)) / 2;
    tiles.forEach((tile, i) => {
      const p = spring((t - 0.05 - i * 0.12) / 0.55);
      if (p <= 0) return;
      const cx = x0 + i * (ts + gap) + ts / 2;
      const cy = top + ts / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rand(g.id || g.text, i) - 0.5) * 0.12 * (1 - clamp01(t - 0.6)));
      ctx.scale(p, p);
      shadow(ctx, base, true, 0.7);
      ctx.fillStyle = '#FFFFFF';
      rrect(ctx, -ts / 2, -ts / 2, ts, ts, ts * 0.24);
      ctx.fill();
      shadow(ctx, base, false);
      drawText(ctx, tile.e, 0, ts * 0.04, ts * 0.56, '#000', 'center', { family: 'clean' });
      ctx.restore();
      if (tile.l) {
        ctx.save();
        ctx.globalAlpha *= clamp01(p);
        shadow(ctx, base, true, 0.8);
        drawText(ctx, ellipsize(ctx, tile.l, base * 0.036, ts + gap * 0.9, { family: 'clean', weight: 700 }), cx, cy + ts * 0.74, base * 0.036, '#FFFFFF', 'center', { family: 'clean', weight: 700 });
        ctx.restore();
      }
    });
    if (g.text) {
      const s = fitSize(ctx, g.text.toUpperCase(), base * 0.068, W - marginX * 2, { family: 'clean', weight: 800 });
      ctx.save();
      ctx.globalAlpha *= easeOut(t / 0.3);
      shadow(ctx, base);
      drawText(ctx, g.text.toUpperCase(), W / 2, top - s * 0.95 + (1 - easeOut(t / 0.3)) * s * 0.3, s, '#FFFFFF', 'center', { family: 'clean', weight: 800 });
      ctx.restore();
    }
    if (g.sub) {
      const hf = { family: 'hand' };
      const hs = fitSize(ctx, g.sub, base * 0.065, W * 0.72, hf);
      const hy = top + ts + base * 0.13;
      const hw = textWidth(ctx, g.sub, hs, hf);
      ctx.save();
      ctx.beginPath();
      ctx.rect(W / 2 - hw / 2 - 4, hy - hs, (hw + 8) * easeOut((t - 0.6) / 0.6), hs * 2);
      ctx.clip();
      shadow(ctx, base, true, 0.6);
      drawText(ctx, g.sub, W / 2, hy, hs, col.hex === '#FFFFFF' ? '#FFFFFF' : '#FFFFFF', 'center', hf);
      ctx.restore();
      scribbleArrow(ctx, W / 2 + hw / 2 + hs * 0.2, hy, W / 2 + hw / 2 + hs * 0.6, top + ts * 1.05, easeOut((t - 1.0) / 0.4), '#FFFFFF', Math.max(2, base * 0.005));
    }
  },

  photo(ctx, g, t, W, H, gd, col, env) {
    const { base } = gd;
    const img = g.assetId ? env.images?.get?.(g.assetId) : null;
    const iw = img?.width || img?.naturalWidth || 4;
    const ih = img?.height || img?.naturalHeight || 3;
    const sc = Math.min((W * 0.7) / iw, (H * 0.32) / ih);
    const w = iw * sc;
    const h = ih * sc;
    const border = base * 0.02;
    const capH = g.text ? base * 0.07 : border;
    const cy = g.position === 'bottom' ? gd.anchors.bottom - (h + capH) / 2 : g.position === 'center' ? gd.anchors.center : H * 0.06 + (h + capH + border) / 2;
    const p = spring((t - 0.02) / 0.6, 1.8);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    if (p <= 0) return;
    ctx.save();
    ctx.translate(W / 2, cy + exit * H * 0.05);
    ctx.rotate(lerp(-0.18, -0.04 + (rand(g.id || 'p', 1) - 0.5) * 0.06, clamp01(p)));
    ctx.scale(lerp(0.4, 1, p) * (1 - exit * 0.1), lerp(0.4, 1, p) * (1 - exit * 0.1));
    ctx.globalAlpha = clamp01(p * 2) * (1 - exit);
    shadow(ctx, base, true, 1.2);
    ctx.fillStyle = '#FFFFFF';
    rrect(ctx, -w / 2 - border, -(h + capH + border) / 2, w + border * 2, h + capH + border, base * 0.008);
    ctx.fill();
    shadow(ctx, base, false);
    const ix = -w / 2;
    const iy = -(h + capH + border) / 2 + border;
    if (img) ctx.drawImage(img, ix, iy, w, h);
    else {
      ctx.fillStyle = '#D9D3C9';
      ctx.fillRect(ix, iy, w, h);
    }
    if (g.text) drawText(ctx, ellipsize(ctx, g.text, base * 0.045, w, { family: 'hand' }), 0, iy + h + capH / 2, base * 0.045, '#2A2520', 'center', { family: 'hand' });
    ctx.restore();
  },

  bubble(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const tf = { family: 'clean', weight: 700 };
    const lay = fitRich(ctx, g.text || 'Hmm…', base * 0.042, W * 0.62, H * 0.2, { normal: tf, em: { family: 'clean', weight: 800 } }, 1.18);
    const bw = Math.max(...lay.lines.map((l) => l.width), base * 0.2) + base * 0.09;
    const bh = lay.lines.length * lay.lineH + base * 0.07;
    const ax = g.x * W;
    const ay = g.y * H;
    const bx = Math.max(gd.marginX, Math.min(W - gd.marginX - bw, ax - bw / 2));
    const by = Math.max(H * 0.05, ay - bh - base * 0.12);
    const p = spring((t - 0.05) / 0.5, 1.6);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.25));
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp01(p * 2) * (1 - exit);
    ctx.translate(ax, ay);
    ctx.scale(p * (1 - exit * 0.3), p * (1 - exit * 0.3));
    ctx.translate(-ax, -ay);
    shadow(ctx, base, true, 0.7);
    ctx.fillStyle = '#FFFFFF';
    if (g.variant === 'thought') {
      rrect(ctx, bx, by, bw, bh, bh / 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(bx + bw * (0.15 + i * 0.175), by + bh * 0.08, bh * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      [0.45, 0.72, 0.9].forEach((f, i) => {
        ctx.beginPath();
        ctx.arc(lerp(bx + bw / 2, ax, f), lerp(by + bh, ay, f), base * [0.06, 0.035, 0.02][i], 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      rrect(ctx, bx, by, bw, bh, base * 0.04);
      ctx.fill();
      const tx = Math.max(bx + bw * 0.2, Math.min(bx + bw * 0.8, ax));
      ctx.beginPath();
      ctx.moveTo(tx - base * 0.03, by + bh - 1);
      ctx.lineTo(ax, ay - base * 0.02);
      ctx.lineTo(tx + base * 0.03, by + bh - 1);
      ctx.closePath();
      ctx.fill();
    }
    shadow(ctx, base, false);
    lay.lines.forEach((line, i) => {
      for (const w of line.words) {
        setFont(ctx, lay.size, { family: 'clean', weight: w.em ? 800 : 700 });
        ctx.fillStyle = w.em ? col.hex : '#1E1A16';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(w.t, bx + (bw - line.width) / 2 + w.x, by + base * 0.035 + lay.lineH * (i + 0.5));
      }
    });
    ctx.restore();
  },

  columns(ctx, g, t, W, H, gd, col, env) {
    const { base, marginX } = gd;
    const th = env.theme;
    const cols = (g.items.length ? g.items : ['Skip: A, B', 'Read: C, D', 'Study: E']).slice(0, 3).map((line) => {
      const i = line.indexOf(':');
      return { h: (i >= 0 ? line.slice(0, i) : line).trim(), items: (i >= 0 ? line.slice(i + 1) : '').split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 4) };
    });
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    ctx.globalAlpha = 1 - exit;
    let y = g.position === 'center' ? gd.anchors.center - H * 0.12 : gd.anchors.top - base * 0.04;
    const w = W - marginX * 2;
    if (g.text) {
      const s = fitSize(ctx, g.text.toUpperCase(), base * 0.058, w, { family: 'clean', weight: 800 });
      ctx.save();
      ctx.globalAlpha *= easeOut(t / 0.3);
      shadow(ctx, base);
      drawText(ctx, g.text.toUpperCase(), W / 2, y, s, '#FFFFFF', 'center', { family: 'clean', weight: 800 });
      ctx.restore();
      y += s * 1.2;
    }
    const cw = w / cols.length;
    const hs = base * 0.065;
    const chip = base * 0.042;
    const count = cols.reduce((n, c) => n + c.items.length, 0);
    const per = Math.max(0.25, Math.min(0.5, (g.duration - 1.4) / Math.max(1, count)));
    const heads = ['#FF8A8A', GRAPHIC_COLORS.yellow.hex, col.hex];
    let k = 0;
    cols.forEach((c, ci) => {
      const cx = marginX + cw * (ci + 0.5);
      const hp = easeOut((t - 0.15 - ci * 0.12) / 0.35);
      ctx.save();
      ctx.globalAlpha *= hp;
      shadow(ctx, base, true, 0.8);
      drawText(ctx, ellipsize(ctx, c.h, hs, cw * 0.95, { family: 'serif', italic: true }), cx, y + hs * 0.6 + (1 - hp) * hs * 0.4, hs, heads[ci], 'center', { family: 'serif', italic: true });
      ctx.restore();
      c.items.forEach((it, ii) => {
        const p = easeOutBack((t - 0.55 - k++ * per) / 0.35);
        if (p <= 0) return;
        const iy = y + hs * 1.5 + ii * chip * 2.1 - (1 - clamp01(p)) * base * 0.08;
        const tw = Math.min(cw * 0.9, textWidth(ctx, it, chip, { family: 'clean', weight: 700 }) + chip * 1.2);
        ctx.save();
        ctx.globalAlpha *= clamp01(p);
        shadow(ctx, base, true, 0.6);
        ctx.fillStyle = th.card;
        rrect(ctx, cx - tw / 2, iy, tw, chip * 1.7, chip * 0.4);
        ctx.fill();
        shadow(ctx, base, false);
        drawText(ctx, ellipsize(ctx, it, chip, tw - chip * 0.8, { family: 'clean', weight: 700 }), cx, iy + chip * 0.86, chip, th.ink, 'center', { family: 'clean', weight: 700 });
        ctx.restore();
      });
    });
  },

  versus(ctx, g, t, W, H, gd, col, env) {
    const { base, marginX } = gd;
    const th = env.theme;
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    ctx.globalAlpha = 1 - exit;
    const cy = gd.anchors[g.position];
    const w = (W - marginX * 2 - base * 0.06) / 2;
    const h = base * (g.items.length ? 0.3 : 0.22);
    const sides = [
      { x: marginX, text: g.text || 'Before', detail: g.items[0], mark: '✕', bg: 'rgba(30,26,22,0.9)', ring: '#FF6B6B', ringInk: '#FFFFFF', ink: '#FFFFFF', sub: 'rgba(255,255,255,.75)', from: -1 },
      { x: W - marginX - w, text: g.sub || 'After', detail: g.items[1], mark: '✓', bg: th.card, ring: col.hex, ringInk: col.ink, ink: th.ink, sub: th.muted, from: 1 },
    ];
    sides.forEach((s, i) => {
      const p = easeOutBack((t - 0.05 - i * 0.25) / 0.45);
      if (p <= 0) return;
      ctx.save();
      ctx.translate(s.x + w / 2 + (1 - clamp01(p)) * s.from * W * 0.3, cy);
      ctx.globalAlpha *= clamp01(p);
      shadow(ctx, base, true, 0.8);
      ctx.fillStyle = s.bg;
      rrect(ctx, -w / 2, -h / 2, w, h, base * 0.03);
      ctx.fill();
      shadow(ctx, base, false);
      ctx.fillStyle = s.ring;
      ctx.beginPath();
      ctx.arc(0, -h / 2 + base * 0.055, base * 0.032, 0, Math.PI * 2);
      ctx.fill();
      drawText(ctx, s.mark, 0, -h / 2 + base * 0.057, base * 0.036, s.ringInk, 'center', { family: 'clean', weight: 800 });
      const ts = fitSize(ctx, s.text, base * 0.05, w * 0.88, { family: 'clean', weight: 800 });
      drawText(ctx, s.text, 0, -h / 2 + base * 0.13, ts, s.ink, 'center', { family: 'clean', weight: 800 });
      if (s.detail) drawText(ctx, ellipsize(ctx, s.detail, base * 0.03, w * 0.88, { family: 'clean', weight: 400 }), 0, -h / 2 + base * 0.2, base * 0.03, s.sub, 'center', { family: 'clean', weight: 400 });
      ctx.restore();
    });
    const vp = spring((t - 0.45) / 0.5);
    if (vp > 0) {
      ctx.save();
      ctx.translate(W / 2, cy);
      ctx.scale(vp, vp);
      ctx.rotate(-0.12);
      ctx.fillStyle = GRAPHIC_COLORS.yellow.hex;
      ctx.beginPath();
      ctx.arc(0, 0, base * 0.05, 0, Math.PI * 2);
      ctx.fill();
      drawText(ctx, 'VS', 0, base * 0.003, base * 0.042, '#141210', 'center', { family: 'sans' });
      ctx.restore();
    }
  },

  emoji(ctx, g, t, W, H, gd) {
    const { base } = gd;
    const p = spring((t - 0.02) / 0.55, 2.5);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.25));
    if (p <= 0) return;
    const x = g.x * W;
    const y = g.y * H;
    const s = base * 0.2;
    ctx.save();
    ctx.translate(x, y - Math.sin(clamp01(t / 0.6) * Math.PI) * base * 0.03);
    ctx.rotate(Math.sin(t * 7) * 0.12 * Math.exp(-t * 1.5));
    ctx.scale(p * (1 - exit), p * (1 - exit));
    shadow(ctx, base, true, 0.8);
    drawText(ctx, g.text || '🔥', 0, 0, s, '#000', 'center', { family: 'clean' });
    ctx.restore();
    if (g.sub) {
      ctx.save();
      ctx.globalAlpha = easeOut((t - 0.35) / 0.3) * (1 - exit);
      shadow(ctx, base, true, 0.7);
      drawText(ctx, g.sub, x, y + s * 0.75, base * 0.05, '#FFFFFF', 'center', { family: 'hand' });
      ctx.restore();
    }
  },

  follow(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const label = g.text || 'Follow';
    const bf = { family: 'clean', weight: 800 };
    const cy = gd.anchors[g.position];
    const bs = base * 0.05;
    const bw = textWidth(ctx, `+ ${label}`, bs, bf) + bs * 1.8;
    const bh = bs * 2;
    const p = easeOutBack((t - 0.02) / 0.4);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    const clickAt = Math.min(1.2, g.duration * 0.45);
    const clicked = t >= clickAt;
    const squash = clicked ? 1 - 0.12 * Math.max(0, 1 - (t - clickAt) / 0.18) : 1;
    ctx.save();
    ctx.globalAlpha = clamp01(p) * (1 - exit);
    ctx.translate(W / 2, cy);
    ctx.scale(p * squash, p * squash);
    shadow(ctx, base, true, 0.9);
    ctx.fillStyle = clicked ? '#2A2622' : col.hex;
    rrect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
    ctx.fill();
    shadow(ctx, base, false);
    drawText(ctx, clicked ? 'Following ✓' : `+ ${label}`, 0, 0, bs, clicked ? '#FFFFFF' : col.ink, 'center', bf);
    ctx.restore();
    if (g.sub) {
      ctx.save();
      ctx.globalAlpha = easeOut((t - 0.2) / 0.3) * (1 - exit);
      shadow(ctx, base, true, 0.8);
      drawText(ctx, g.sub, W / 2, cy - bh * 0.95, base * 0.036, '#FFFFFF', 'center', { family: 'clean', weight: 700 });
      ctx.restore();
    }
    const cp = easeOut((t - 0.2) / Math.max(0.3, clickAt - 0.3));
    if (cp > 0 && t < g.duration - 0.2) {
      const s = base * 0.05 * (clicked && t - clickAt < 0.15 ? 0.85 : 1);
      ctx.save();
      ctx.globalAlpha = 1 - exit;
      ctx.translate(lerp(W * 0.85, W / 2 + bw * 0.22, cp), lerp(cy + H * 0.15, cy + bh * 0.15, cp));
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#141210';
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(s * 0.28, s * 0.74);
      ctx.lineTo(s * 0.48, s * 1.08);
      ctx.lineTo(s * 0.62, s * 1.0);
      ctx.lineTo(s * 0.44, s * 0.68);
      ctx.lineTo(s * 0.78, s * 0.66);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (clicked && t - clickAt < 0.35) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.globalAlpha *= 1 - (t - clickAt) / 0.35;
        ctx.beginPath();
        ctx.arc(0, 0, s * (0.4 + (t - clickAt) * 3), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  },

  lowerThird(ctx, g, t, W, H, gd, col) {
    const { base, marginX } = gd;
    const nameS = fitSize(ctx, g.text || 'Name', base * 0.058, W * 0.78);
    const subS = base * 0.036;
    const padX = base * 0.032;
    const h1 = nameS * 1.55;
    const h2 = g.sub ? subS * 1.75 : 0;
    const bottom = g.position === 'top' ? gd.anchors.top + h1 + h2 : g.position === 'center' ? gd.anchors.center + (h1 + h2) / 2 : gd.anchors.bottom;
    const y1 = bottom - h1 - h2;
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.35));
    const dx = -exit * W * 0.12;
    ctx.globalAlpha = 1 - exit;
    const stripe = base * 0.012;
    const grow = easeOut(t / 0.35);
    ctx.fillStyle = col.hex;
    ctx.fillRect(marginX + dx, y1 + (h1 + h2) * (1 - grow) * 0.5, stripe, (h1 + h2) * grow);
    const x = marginX + stripe + dx;
    const name = g.text || 'Name';
    const w1 = (textWidth(ctx, name, nameS) + padX * 2) * easeOut((t - 0.08) / 0.45);
    if (w1 > 1) {
      shadow(ctx, base);
      ctx.fillStyle = DARK;
      ctx.fillRect(x, y1, w1, h1);
      shadow(ctx, base, false);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y1, w1, h1);
      ctx.clip();
      drawText(ctx, name, x + padX, y1 + h1 / 2, nameS, '#FFFFFF');
      ctx.restore();
    }
    if (g.sub) {
      const w2 = (textWidth(ctx, g.sub, subS) + padX * 2) * easeOut((t - 0.25) / 0.45);
      if (w2 > 1) {
        ctx.fillStyle = col.hex;
        ctx.fillRect(x, y1 + h1, w2, h2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y1 + h1, w2, h2);
        ctx.clip();
        drawText(ctx, g.sub, x + padX, y1 + h1 + h2 / 2, subS, col.ink);
        ctx.restore();
      }
    }
  },

  keyword(ctx, g, t, W, H, gd, col, env) {
    const { base } = gd;
    const word = g.text || 'Keyword';
    const f = env.theme.head === 'serif' ? { family: 'serif', italic: true } : { family: 'sans' };
    const size = fitSize(ctx, word, base * 0.13, W * 0.8, f);
    const cy = gd.anchors[g.position];
    const tw = textWidth(ctx, word, size, f);
    const pop = spring((t - 0.02) / 0.5, 2);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.25));
    const scale = (0.55 + 0.45 * pop) * (1 - exit * 0.25);
    ctx.globalAlpha = clamp01(t / 0.1) * (1 - exit);
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.rotate(-0.035);
    const bw = (tw + size * 0.7) * easeOut((t - 0.04) / 0.3);
    const bh = size * 1.35;
    shadow(ctx, base);
    ctx.fillStyle = col.hex;
    rrect(ctx, -bw / 2, -bh / 2, bw, bh, base * 0.012);
    ctx.fill();
    shadow(ctx, base, false);
    ctx.scale(scale, scale);
    drawText(ctx, word, 0, size * 0.04, size, col.ink, 'center', f);
    ctx.restore();
  },

  stat(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const st = parseStat(g.text);
    const shown = st ? formatStat(st, st.value * easeOut(t / 1.1)) : g.text || '100%';
    const finalText = st ? formatStat(st, st.value) : shown;
    const size = fitSize(ctx, finalText, base * 0.17, W * 0.82);
    const cy = gd.anchors[g.position] - (g.sub ? base * 0.03 : 0);
    const pop = easeOutBack(t / 0.4);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    ctx.globalAlpha = clamp01(t / 0.12) * (1 - exit);
    const rp = clamp01((t - 0.9) / 0.5);
    if (rp > 0 && rp < 1) {
      ctx.save();
      ctx.strokeStyle = col.hex;
      ctx.globalAlpha *= 1 - rp;
      ctx.lineWidth = base * 0.01;
      ctx.beginPath();
      ctx.arc(W / 2, cy, size * (0.6 + rp * 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(W / 2, cy);
    const bump = t > 1.1 && t < 1.3 ? 1 + 0.06 * Math.sin(((t - 1.1) / 0.2) * Math.PI) : 1;
    const sc = (0.6 + 0.4 * pop) * (1 - exit * 0.2) * bump;
    ctx.scale(sc, sc);
    setFont(ctx, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = 'rgba(14,12,10,0.9)';
    ctx.strokeText(shown, 0, 0);
    ctx.fillStyle = col.hex;
    ctx.fillText(shown, 0, 0);
    ctx.restore();
    if (g.sub) {
      const subS = fitSize(ctx, g.sub, base * 0.048, W * 0.84);
      const ly = cy + size * 0.62 + subS * 0.6;
      const la = easeOut((t - 0.3) / 0.35);
      ctx.globalAlpha = la * (1 - exit);
      shadow(ctx, base);
      drawText(ctx, g.sub, W / 2, ly + (1 - la) * base * 0.03, subS, '#FFFFFF', 'center');
      shadow(ctx, base, false);
      const uw = textWidth(ctx, g.sub, subS) * 0.35 * easeOut((t - 0.45) / 0.4);
      ctx.fillStyle = col.hex;
      ctx.fillRect(W / 2 - uw / 2, ly + subS * 0.75, uw, base * 0.008);
    }
  },

  list(ctx, g, t, W, H, gd, col) {
    const { base, marginX } = gd;
    const items = g.items.length ? g.items : ['First point', 'Second point', 'Third point'];
    const titleS = base * 0.05;
    const itemS = base * 0.042;
    const pad = base * 0.04;
    const rowH = itemS * 1.9;
    const titleH = g.text ? titleS * 1.7 : 0;
    const w = W - marginX * 2;
    const h = pad * 2 + titleH + items.length * rowH - (items.length ? rowH - itemS * 1.4 : 0);
    const top = g.position === 'bottom' ? gd.anchors.bottom - h : g.position === 'center' ? gd.anchors.center - h / 2 : gd.anchors.top;
    const enter = easeOut(t / 0.4);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.35));
    ctx.globalAlpha = enter * (1 - exit);
    const y0 = top + (1 - enter) * base * 0.04 - exit * base * 0.03;
    shadow(ctx, base);
    ctx.fillStyle = DARK;
    rrect(ctx, marginX, y0, w, h, base * 0.03);
    ctx.fill();
    shadow(ctx, base, false);
    if (g.text) drawText(ctx, ellipsize(ctx, g.text, titleS, w - pad * 2), marginX + pad, y0 + pad + titleS * 0.6, titleS, col.hex);
    const step = Math.min(0.6, Math.max(0.22, (g.duration - 1.3) / items.length));
    items.forEach((it, i) => {
      const a = easeOut((t - 0.35 - i * step) / 0.3);
      if (a <= 0) return;
      const cy = y0 + pad + titleH + i * rowH + itemS * 0.7;
      const cx = marginX + pad + itemS * 0.5;
      const r = itemS * 0.5;
      ctx.globalAlpha = a * (1 - exit);
      ctx.fillStyle = col.hex;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.6 + 0.4 * easeOutBack((t - 0.35 - i * step) / 0.3)), 0, Math.PI * 2);
      ctx.fill();
      tick(ctx, cx, cy, r, easeOut((t - 0.45 - i * step) / 0.25), col.ink);
      const tx = cx + r + itemS * 0.55 + (1 - a) * base * 0.03;
      drawText(ctx, ellipsize(ctx, it, itemS, w - (tx - marginX) - pad), tx, cy, itemS, '#FFFFFF');
    });
  },

  chapter(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const title = g.text || 'Chapter';
    const ts = fitSize(ctx, title, base * 0.062, W * 0.8);
    const ss = base * 0.034;
    const label = (g.sub || '').toUpperCase();
    const tw = textWidth(ctx, title, ts) + base * 0.07;
    const th = ts * 1.75;
    const sw = label ? textWidth(ctx, label, ss) + base * 0.04 : 0;
    const sh = ss * 1.8;
    const total = th + (label ? sh + base * 0.012 : 0);
    const top = g.position === 'bottom' ? gd.anchors.bottom - total : g.position === 'center' ? gd.anchors.center - total / 2 : H * 0.075;
    const enter = easeOutBack(t / 0.45);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    ctx.globalAlpha = clamp01(t / 0.15) * (1 - exit);
    let y = top + (1 - enter) * -base * 0.12 - exit * base * 0.06;
    if (label) {
      ctx.fillStyle = col.hex;
      rrect(ctx, W / 2 - sw / 2, y, sw, sh, sh / 2);
      ctx.fill();
      drawText(ctx, label, W / 2, y + sh / 2, ss, col.ink, 'center');
      y += sh + base * 0.012;
    }
    shadow(ctx, base);
    ctx.fillStyle = DARK;
    rrect(ctx, W / 2 - tw / 2, y, tw, th, th / 2);
    ctx.fill();
    shadow(ctx, base, false);
    drawText(ctx, title, W / 2, y + th / 2, ts, '#FFFFFF', 'center');
  },

  callout(ctx, g, t, W, H, gd, col) {
    const { base, marginX } = gd;
    const px = g.x * W;
    const py = g.y * H;
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    ctx.globalAlpha = 1 - exit;
    const r = base * 0.06 * easeOutBack(t / 0.35);
    ctx.strokeStyle = col.hex;
    ctx.lineWidth = base * 0.01;
    if (r > 0) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      const ph = ((t + 1.2) % 1.2) / 1.2;
      if (t > 0.35) {
        ctx.globalAlpha = (1 - ph) * 0.6 * (1 - exit);
        ctx.beginPath();
        ctx.arc(px, py, r * (1 + ph * 0.8), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1 - exit;
      }
    }
    const label = g.text || 'Look here';
    const ls = fitSize(ctx, label, base * 0.045, W * 0.6);
    const lw = textWidth(ctx, label, ls) + base * 0.06;
    const lh = ls * 1.8;
    const dirX = g.x < 0.5 ? 1 : -1;
    const dirY = g.y < 0.5 ? 1 : -1;
    const bx = Math.max(marginX, Math.min(W - marginX - lw, px + dirX * base * 0.2 - (dirX < 0 ? lw : 0)));
    const by = Math.max(H * 0.06, Math.min(H * 0.9 - lh, py + dirY * base * 0.2 - lh / 2));
    const sx = bx + lw / 2;
    const sy = by + (dirY > 0 ? 0 : lh);
    const ang = Math.atan2(py - sy, px - sx);
    const ex = px - Math.cos(ang) * (base * 0.075);
    const ey = py - Math.sin(ang) * (base * 0.075);
    const draw = easeOut((t - 0.15) / 0.35);
    if (draw > 0) {
      const tx = sx + (ex - sx) * draw;
      const ty = sy + (ey - sy) * draw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      if (draw > 0.85) {
        const hs = base * 0.045;
        ctx.fillStyle = col.hex;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.cos(ang - 0.45) * hs, ty - Math.sin(ang - 0.45) * hs);
        ctx.lineTo(tx - Math.cos(ang + 0.45) * hs, ty - Math.sin(ang + 0.45) * hs);
        ctx.closePath();
        ctx.fill();
      }
    }
    const la = easeOut((t - 0.25) / 0.3);
    if (la > 0) {
      ctx.globalAlpha = la * (1 - exit);
      shadow(ctx, base);
      ctx.fillStyle = col.hex;
      rrect(ctx, bx, by, lw, lh, lh / 2);
      ctx.fill();
      shadow(ctx, base, false);
      drawText(ctx, label, bx + lw / 2, by + lh / 2, ls, col.ink, 'center');
    }
  },

  progress(ctx, g, t, W, H, gd, col) {
    const h = gd.base * 0.014;
    const y = g.position === 'bottom' ? H - h : 0;
    ctx.globalAlpha = clamp01(t / 0.2) * clamp01((g.duration - t) / 0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = col.hex;
    ctx.fillRect(0, y, W * clamp01(t / g.duration), h);
  },
};

/**
 * Draw one graphic at timeline time `time` (no-op when it isn't on screen).
 * env: { theme: THEMES[x] (default editorial), images: Map(assetId → drawable image) }
 */
export function drawGraphic(ctx, g, time, W, H, env = {}) {
  if (!isActive(g, time) || !DRAW[g.type]) return false;
  const gd = frameGuides(W, H);
  const col = GRAPHIC_COLORS[g.color] || GRAPHIC_COLORS.accent;
  ctx.save();
  try {
    DRAW[g.type](ctx, g, time - g.start, W, H, gd, col, { theme: env.theme || THEMES.editorial, images: env.images });
  } finally {
    ctx.restore();
  }
  return true;
}

/** Draw every graphic active at `time` (full-screen cards first, so the rest sit on top). */
export function drawGraphics(ctx, graphics, time, W, H, env = {}) {
  let n = 0;
  const list = [...(graphics || [])].sort((a, b) => (a.layout === 'full' ? 0 : 1) - (b.layout === 'full' ? 0 : 1));
  for (const g of list) if (drawGraphic(ctx, g, time, W, H, env)) n++;
  return n;
}

/** Plain text of a graphic, for lists and timeline chips. */
export const graphicLabel = (g) => plainText(g.text) || g.items?.[0] || GRAPHIC_TYPES[g.type]?.label || 'Graphic';
