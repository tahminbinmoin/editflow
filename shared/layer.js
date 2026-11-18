// The canvas layer that sits over the video: B-roll photo cards, motion graphics and animated
// captions. Preview (Player.jsx) and export (graphicsFrames.js) both call drawLayer, so they
// match. Also: when the speaker video is pushed down (top panels, split-screen B-roll), and the
// sound effects that go with graphics.
import { timelineCaptions, totalDuration } from './timeline.js';
import { drawGraphics, panelK, PANEL_IN, PANEL_OUT, isActive } from './graphics.js';
import { captionWords, drawCaptions, isAnimatedStyle } from './captions-anim.js';
import { themeOf, frameGuides } from './gfx-core.js';
import { GRAPHIC_COLORS } from './graphics.js';

export const SPLIT_FRAC = 0.5; // split-screen B-roll takes the top half

/** B-roll shown as a photo card is drawn on the canvas like a graphic. */
export function brollCards(tl) {
  return (tl.broll || [])
    .filter((b) => b.layout === 'card' && b.assetId)
    .map((b) => ({ id: `card_${b.id}`, type: 'photo', start: b.start, duration: b.duration, assetId: b.assetId, text: b.caption || '', position: 'top', layout: 'overlay', color: 'accent', items: [], values: [], labels: [] }));
}

const captionCache = new WeakMap();
function animatedCaptions(tl) {
  if (!tl.captions?.enabled || !isAnimatedStyle(tl.captions.style)) return [];
  let c = captionCache.get(tl);
  if (!c) {
    c = captionWords(timelineCaptions(tl), tl.captions.emphasis);
    captionCache.set(tl, c);
  }
  return c;
}

/** Everything drawn on the layer, as time spans (for export frame windows). */
export function layerItems(tl) {
  return [...(tl.graphics || []), ...brollCards(tl), ...animatedCaptions(tl).map((c) => ({ start: c.start, duration: c.end - c.start }))];
}

/**
 * Draw the whole layer at `time`. env: { images: Map(assetId → image) }.
 * The caller clears the canvas.
 */
export function drawLayer(ctx, tl, time, W, H, env = {}) {
  const theme = themeOf(tl);
  const e = { theme, images: env.images };
  let n = drawGraphics(ctx, [...brollCards(tl), ...(tl.graphics || [])], time, W, H, e);
  const caps = animatedCaptions(tl);
  if (caps.length) {
    const panelUp = (tl.graphics || []).some((g) => g.layout === 'full' && isActive(g, time));
    if (!panelUp) n += drawCaptions(ctx, caps, time, W, H, { style: tl.captions.style, position: tl.captions.position, accent: GRAPHIC_COLORS[tl.style?.captionColor]?.hex || GRAPHIC_COLORS.yellow.hex }) ? 1 : 0;
  }
  return n;
}

/**
 * Time windows where the speaker video moves down: top panels push it down by the panel height,
 * split-screen B-roll by half the frame. [{ start, end, px }] (px in an H-pixel-tall frame)
 */
export function shiftWindows(tl, W, H) {
  const { panelH } = frameGuides(W, H);
  const out = [];
  for (const g of tl.graphics || []) if (g.layout === 'panel') out.push({ start: g.start, end: g.start + g.duration, px: panelH });
  for (const b of tl.broll || []) if (b.layout === 'split' && b.assetId) out.push({ start: b.start, end: b.start + b.duration, px: Math.round(H * SPLIT_FRAC) });
  const D = totalDuration(tl);
  return out.filter((w) => w.start < D).map((w) => ({ ...w, end: Math.min(D, w.end) })).sort((a, b) => a.start - b.start);
}

/** Pixels the speaker video is pushed down at `time` (same easing as the panels). */
export function videoShiftAt(tl, time, W, H) {
  let px = 0;
  for (const w of shiftWindows(tl, W, H)) if (time >= w.start && time < w.end) px = Math.max(px, w.px * panelK(time - w.start, w.end - w.start));
  return px;
}

/** ffmpeg expression for the same easing (used by render-graph.js). */
export const shiftExpr = (w) => {
  const ease = (x) => `(1-pow(1-clip(${x},0,1),3))`;
  return `${w.px}*min(${ease(`(t-${w.start.toFixed(3)})/${PANEL_IN}`)},${ease(`(${w.end.toFixed(3)}-t)/${PANEL_OUT}`)})`;
};

// ---------- sound effects ----------
const SFX_FOR = {
  keyword: 'pop', stat: 'pop', emoji: 'pop', photo: 'pop', bubble: 'pop', iconRow: 'pop', callout: 'pop', versus: 'whoosh',
  headline: 'whoosh', chart: 'whoosh', pictogram: 'whoosh', definition: 'whoosh', lowerThird: 'whoosh', chapter: 'whoosh', list: 'whoosh', columns: 'whoosh', follow: 'click',
};
/** [{ t, kind }] sound effects for the timeline (empty when turned off). */
export function sfxEvents(tl) {
  if (tl.sfx && tl.sfx.enabled === false) return [];
  const ev = [];
  for (const g of tl.graphics || []) {
    if (g.sfx === 'none' || !SFX_FOR[g.type]) continue;
    const kind = SFX_FOR[g.type];
    ev.push({ t: kind === 'click' ? g.start + Math.min(1.2, g.duration * 0.45) : g.start, kind });
    if (g.type === 'stat') ev.push({ t: g.start + 1.1, kind: 'ding' });
  }
  for (const b of tl.broll || []) if (b.assetId) ev.push({ t: b.start, kind: b.layout === 'card' ? 'pop' : 'swoosh' });
  return ev.sort((a, b) => a.t - b.t).filter((e, i, a) => i === 0 || e.t - a[i - 1].t > 0.08);
}
