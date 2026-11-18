// Motion graphics: animated overlays (lower thirds, keyword pops, stat counters, checklists,
// callout arrows, progress bars, chapter tags) drawn with the Canvas 2D API.
//
// The SAME drawing code runs in two places, so the preview matches the export:
//   - preview: Player.jsx draws the active graphics on a <canvas> over the video every frame
//   - export:  client/src/lib/graphicsFrames.js draws them into PNG frames that ffmpeg overlays
// Pure module: no DOM access. `ctx` only needs the standard CanvasRenderingContext2D methods.

/** Font family the client registers (Poppins Bold, same file the captions use). */
export const GRAPHIC_FONT = 'EditflowGraphics';

export const GRAPHIC_TYPES = {
  lowerThird: { label: 'Lower third', desc: 'Name and role slide in', duration: 3.5, fields: ['text', 'sub'], position: 'bottom', textLabel: 'Name', subLabel: 'Role or label' },
  keyword: { label: 'Keyword pop', desc: 'One big word or phrase pops in', duration: 1.8, fields: ['text'], position: 'center', textLabel: 'Word or phrase' },
  stat: { label: 'Stat counter', desc: 'A number counts up with a label', duration: 2.8, fields: ['text', 'sub'], position: 'center', textLabel: 'Number (e.g. 73%, $1,200, 3x)', subLabel: 'What it means' },
  list: { label: 'Checklist', desc: 'Up to 4 points tick in one by one', duration: 4.5, fields: ['text', 'items'], position: 'top', textLabel: 'Title' },
  callout: { label: 'Callout arrow', desc: 'Points at something on screen', duration: 2.5, fields: ['text', 'point'], position: 'center', textLabel: 'Label' },
  progress: { label: 'Progress bar', desc: 'Thin bar along the top that fills up', duration: 10, fields: [], position: 'top' },
  chapter: { label: 'Chapter tag', desc: 'Section label slides in at the top', duration: 2.2, fields: ['text', 'sub'], position: 'top', textLabel: 'Section title', subLabel: 'Small label (e.g. Step 2)' },
};

export const GRAPHIC_COLORS = {
  accent: { label: 'Coral', hex: '#FF5B3A', ink: '#FFFFFF' },
  yellow: { label: 'Yellow', hex: '#FFD43B', ink: '#141210' },
  blue: { label: 'Blue', hex: '#3D7BFF', ink: '#FFFFFF' },
  green: { label: 'Green', hex: '#2FD08A', ink: '#0E1A14' },
  white: { label: 'White', hex: '#FFFFFF', ink: '#141210' },
};

export const GRAPHIC_POSITIONS = { top: 'Top', center: 'Middle', bottom: 'Bottom' };

const PANEL = 'rgba(18,16,14,0.88)';
const round = (n) => Math.round(n * 1000) / 1000;
const clamp01 = (p) => (p < 0 ? 0 : p > 1 ? 1 : p);
const clampN = (n, lo, hi, dflt) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Number(n))) : dflt);
const easeOut = (p) => 1 - Math.pow(1 - clamp01(p), 3);
const easeIn = (p) => Math.pow(clamp01(p), 3);
const easeOutBack = (p) => {
  const c1 = 1.70158;
  const x = clamp01(p) - 1;
  return 1 + (c1 + 1) * x * x * x + c1 * x * x;
};
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Validate and normalise a graphic (used by the timeline ops). Throws on an unknown type. */
export function cleanGraphic(g = {}, base = {}) {
  const m = { ...base, ...g };
  const def = GRAPHIC_TYPES[m.type];
  if (!def) throw new Error(`Unknown motion graphic "${m.type}"`);
  return {
    id: m.id,
    type: m.type,
    start: round(clampN(m.start, 0, 36000, 0)),
    duration: round(clampN(m.duration, 0.6, 36000, def.duration)),
    text: str(m.text, 80),
    sub: str(m.sub, 80),
    items: (Array.isArray(m.items) ? m.items : []).map((s) => str(s, 60)).filter(Boolean).slice(0, 4),
    x: round(clampN(m.x, 0.08, 0.92, 0.5)),
    y: round(clampN(m.y, 0.08, 0.9, 0.5)),
    color: GRAPHIC_COLORS[m.color] ? m.color : 'accent',
    position: GRAPHIC_POSITIONS[m.position] ? m.position : def.position,
    reason: str(m.reason, 300),
  };
}

export const isActive = (g, t) => t >= g.start && t < g.start + g.duration;

const ZONES = ['top', 'center', 'bottom'];
/** Screen areas a graphic occupies (a checklist panel also covers the area below it). */
export function graphicZones(g) {
  if (g.type === 'progress') return ['edge'];
  if (g.type === 'callout') return ['callout'];
  const i = ZONES.indexOf(g.position);
  return g.type === 'list' ? [g.position, ZONES[Math.min(2, i + 1)]] : [g.position];
}
const clash = (a, b) => a.start < b.start + b.duration && b.start < a.start + a.duration && graphicZones(a).some((z) => graphicZones(b).includes(z));

/**
 * Fit new graphics around existing ones so two never cover the same area at the same time.
 * An earlier new graphic is shortened to make room if at least half its usual length remains
 * (so a counter still has time to count); otherwise the later one is dropped. Existing
 * graphics are never changed.
 * @returns { kept: [...incoming, possibly shortened], dropped: [...incoming] }
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

/** Time ranges that contain at least one graphic, merged (for export frame rendering). */
export function graphicWindows(graphics, duration, pad = 0.0) {
  const spans = (graphics || [])
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

// ---------- drawing helpers ----------
function font(ctx, size) {
  ctx.font = `${Math.max(6, Math.round(size))}px ${GRAPHIC_FONT}, Poppins, "Helvetica Neue", Arial, sans-serif`;
}
function textWidth(ctx, text, size) {
  font(ctx, size);
  return ctx.measureText(text).width;
}
/** Largest size ≤ `size` (and ≥ half of it) at which `text` fits in `maxW`. */
function fit(ctx, text, size, maxW) {
  const w = textWidth(ctx, text, size);
  return w <= maxW ? size : Math.max(size * 0.5, (size * maxW) / w);
}
function ellipsize(ctx, text, size, maxW) {
  if (textWidth(ctx, text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && textWidth(ctx, `${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function rrect(ctx, x, y, w, h, r) {
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
function shadow(ctx, base, on = true) {
  ctx.shadowColor = on ? 'rgba(0,0,0,0.35)' : 'transparent';
  ctx.shadowBlur = on ? base * 0.025 : 0;
  ctx.shadowOffsetY = on ? base * 0.006 : 0;
}
function text(ctx, s, x, y, size, color, align = 'left') {
  font(ctx, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/** Frame geometry shared by all graphics: margins and the vertical anchors that keep clear of captions. */
export function frameGuides(W, H) {
  const base = Math.min(W, H);
  const captionTop = H * 0.83 - base * 0.19;
  return {
    base,
    marginX: W * 0.065,
    anchors: { top: H * 0.13, center: H * 0.4, bottom: Math.min(H * 0.7, captionTop - base * 0.03) },
  };
}

// ---------- the graphics ----------
const DRAW = {
  lowerThird(ctx, g, t, W, H, gd, col) {
    const { base, marginX } = gd;
    const nameS = fit(ctx, g.text || 'Name', base * 0.058, W * 0.78);
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
      ctx.fillStyle = PANEL;
      ctx.fillRect(x, y1, w1, h1);
      shadow(ctx, base, false);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y1, w1, h1);
      ctx.clip();
      text(ctx, name, x + padX, y1 + h1 / 2, nameS, '#FFFFFF');
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
        text(ctx, g.sub, x + padX, y1 + h1 + h2 / 2, subS, col.ink);
        ctx.restore();
      }
    }
  },

  keyword(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const word = g.text || 'Keyword';
    const size = fit(ctx, word, base * 0.13, W * 0.8);
    const cy = gd.anchors[g.position];
    const tw = textWidth(ctx, word, size);
    const pop = easeOutBack(t / 0.38);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.25));
    const scale = (0.55 + 0.45 * pop) * (1 - exit * 0.25);
    ctx.globalAlpha = clamp01(t / 0.12) * (1 - exit);
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
    text(ctx, word, 0, size * 0.04, size, col.ink, 'center');
    ctx.restore();
  },

  stat(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const st = parseStat(g.text);
    const shown = st ? formatStat(st, st.value * easeOut(t / 1.1)) : g.text || '100%';
    const finalText = st ? formatStat(st, st.value) : shown;
    const size = fit(ctx, finalText, base * 0.17, W * 0.82);
    const cy = gd.anchors[g.position] - (g.sub ? base * 0.03 : 0);
    const pop = easeOutBack(t / 0.4);
    const exit = easeIn(1 - clamp01((g.duration - t) / 0.3));
    ctx.globalAlpha = clamp01(t / 0.12) * (1 - exit);
    ctx.save();
    ctx.translate(W / 2, cy);
    const sc = (0.6 + 0.4 * pop) * (1 - exit * 0.2);
    ctx.scale(sc, sc);
    font(ctx, size);
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
      const subS = fit(ctx, g.sub, base * 0.048, W * 0.84);
      const ly = cy + size * 0.62 + subS * 0.6;
      const la = easeOut((t - 0.3) / 0.35);
      ctx.globalAlpha = la * (1 - exit);
      shadow(ctx, base);
      text(ctx, g.sub, W / 2, ly + (1 - la) * base * 0.03, subS, '#FFFFFF', 'center');
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
    ctx.fillStyle = PANEL;
    rrect(ctx, marginX, y0, w, h, base * 0.03);
    ctx.fill();
    shadow(ctx, base, false);
    if (g.text) text(ctx, ellipsize(ctx, g.text, titleS, w - pad * 2), marginX + pad, y0 + pad + titleS * 0.6, titleS, col.hex);
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
      const tick = easeOut((t - 0.45 - i * step) / 0.25);
      if (tick > 0) {
        ctx.strokeStyle = col.ink;
        ctx.lineWidth = r * 0.28;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const p1 = [cx - r * 0.42, cy + r * 0.02];
        const p2 = [cx - r * 0.1, cy + r * 0.34];
        const p3 = [cx + r * 0.45, cy - r * 0.3];
        ctx.moveTo(...p1);
        if (tick < 0.4) ctx.lineTo(p1[0] + (p2[0] - p1[0]) * (tick / 0.4), p1[1] + (p2[1] - p1[1]) * (tick / 0.4));
        else {
          const q = (tick - 0.4) / 0.6;
          ctx.lineTo(...p2);
          ctx.lineTo(p2[0] + (p3[0] - p2[0]) * q, p2[1] + (p3[1] - p2[1]) * q);
        }
        ctx.stroke();
      }
      const tx = cx + r + itemS * 0.55 + (1 - a) * base * 0.03;
      text(ctx, ellipsize(ctx, it, itemS, w - (tx - marginX) - pad), tx, cy, itemS, '#FFFFFF');
    });
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
    const ls = fit(ctx, label, base * 0.045, W * 0.6);
    const lw = textWidth(ctx, label, ls) + base * 0.06;
    const lh = ls * 1.8;
    const dirX = g.x < 0.5 ? 1 : -1;
    const dirY = g.y < 0.5 ? 1 : -1;
    let bx = px + dirX * base * 0.2 - (dirX < 0 ? lw : 0);
    let by = py + dirY * base * 0.2 - lh / 2;
    bx = Math.max(marginX, Math.min(W - marginX - lw, bx));
    by = Math.max(H * 0.06, Math.min(H * 0.9 - lh, by));
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
      text(ctx, label, bx + lw / 2, by + lh / 2, ls, col.ink, 'center');
    }
  },

  progress(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const h = base * 0.014;
    const y = g.position === 'bottom' ? H - h : 0;
    ctx.globalAlpha = clamp01(t / 0.2) * clamp01((g.duration - t) / 0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = col.hex;
    ctx.fillRect(0, y, W * clamp01(t / g.duration), h);
  },

  chapter(ctx, g, t, W, H, gd, col) {
    const { base } = gd;
    const title = g.text || 'Chapter';
    const ts = fit(ctx, title, base * 0.062, W * 0.8);
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
    const dy = (1 - enter) * -base * 0.12 - exit * base * 0.06;
    ctx.globalAlpha = clamp01(t / 0.15) * (1 - exit);
    let y = top + dy;
    if (label) {
      ctx.fillStyle = col.hex;
      rrect(ctx, W / 2 - sw / 2, y, sw, sh, sh / 2);
      ctx.fill();
      text(ctx, label, W / 2, y + sh / 2, ss, col.ink, 'center');
      y += sh + base * 0.012;
    }
    shadow(ctx, base);
    ctx.fillStyle = PANEL;
    rrect(ctx, W / 2 - tw / 2, y, tw, th, th / 2);
    ctx.fill();
    shadow(ctx, base, false);
    text(ctx, title, W / 2, y + th / 2, ts, '#FFFFFF', 'center');
  },
};

/** Draw one graphic at timeline time `time` (no-op when it isn't on screen). */
export function drawGraphic(ctx, g, time, W, H) {
  if (!isActive(g, time) || !DRAW[g.type]) return false;
  const gd = frameGuides(W, H);
  const col = GRAPHIC_COLORS[g.color] || GRAPHIC_COLORS.accent;
  ctx.save();
  try {
    DRAW[g.type](ctx, g, time - g.start, W, H, gd, col);
  } finally {
    ctx.restore();
  }
  return true;
}

/** Draw every graphic active at `time`, in timeline order. Returns how many were drawn. */
export function drawGraphics(ctx, graphics, time, W, H) {
  let n = 0;
  for (const g of graphics || []) if (drawGraphic(ctx, g, time, W, H)) n++;
  return n;
}
