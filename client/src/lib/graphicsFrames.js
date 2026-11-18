// The canvas layer in the browser: font loading for the preview, PNG frame rendering for the
// export, images for photo cards, and the sound-effects track. Drawing itself lives in
// shared/layer.js (one implementation for preview and export).
import { FONT_FILES } from '@shared/gfx-core.js';
import { drawLayer, layerItems, brollCards, sfxEvents } from '@shared/layer.js';
import { graphicWindows } from '@shared/graphics.js';
import { renderSfx, bufferToWav } from '@shared/sfx.js';

let fontPromise = null;
/** Register every font the graphics and animated captions use. */
export function ensureGraphicsFont() {
  if (!fontPromise) {
    fontPromise = Promise.all(
      FONT_FILES.map(async (f) => {
        try {
          const face = new FontFace(f.family, `url(${f.url})`, { weight: f.weight || '400', style: f.style || 'normal' });
          await face.load();
          document.fonts.add(face);
        } catch {
          /* falls back to a system font */
        }
      }),
    ).then(() => true);
  }
  return fontPromise;
}

/** Asset ids whose images the layer draws (photo cards, photo graphics). */
export function layerImageIds(tl) {
  const ids = new Set();
  for (const g of [...(tl.graphics || []), ...brollCards(tl)]) if (g.type === 'photo' && g.assetId) ids.add(g.assetId);
  return [...ids];
}

/** Decode images for the layer: Map(assetId → ImageBitmap). getBlob(assetId) → Blob. */
export async function loadLayerImages(tl, getBlob) {
  const map = new Map();
  for (const id of layerImageIds(tl)) {
    try {
      map.set(id, await createImageBitmap(await getBlob(id)));
    } catch {
      /* drawn as a placeholder */
    }
  }
  return map;
}

export const GRAPHICS_FPS = 30;

function makeCanvas(W, H) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}
const toPng = (c) => (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((r) => c.toBlob(r, 'image/png')));

/**
 * Draw the layer (graphics, photo cards, animated captions) into PNG frames inside the ffmpeg
 * file system, one ffconcat list per time window. Identical consecutive frames are written once
 * with a longer duration, so anything that holds still costs one file, not hundreds.
 * @returns [{ listName, start, end, files }] for buildRenderPlan's `graphics` option
 */
export async function writeGraphicFrames(ff, tl, duration, W, H, dir, env = {}, onProgress) {
  const windows = graphicWindows(layerItems(tl), duration);
  if (!windows.length) return [];
  await ensureGraphicsFont();
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const totalFrames = windows.reduce((n, w) => n + Math.ceil((w.end - w.start) * GRAPHICS_FPS), 0);
  let done = 0;
  const out = [];
  for (const [wi, w] of windows.entries()) {
    const frames = Math.max(1, Math.ceil((w.end - w.start) * GRAPHICS_FPS));
    const entries = [];
    const files = [];
    let prev = null;
    for (let k = 0; k < frames; k++) {
      ctx.clearRect(0, 0, W, H);
      drawLayer(ctx, tl, w.start + k / GRAPHICS_FPS, W, H, env);
      const px = new Uint32Array(ctx.getImageData(0, 0, W, H).data.buffer);
      let same = !!prev;
      if (same) for (let i = 0; i < px.length; i++) if (px[i] !== prev[i]) ((same = false), (i = px.length));
      if (same) entries[entries.length - 1].count++;
      else {
        const file = `${dir}g${wi}_${String(entries.length).padStart(5, '0')}.png`;
        await ff.writeFile(file, new Uint8Array(await (await toPng(canvas)).arrayBuffer()));
        files.push(file);
        entries.push({ file, count: 1 });
        prev = px;
      }
      if (++done % 15 === 0) onProgress?.(done / totalFrames);
    }
    const name = (f) => f.split('/').pop();
    const list = ['ffconcat version 1.0', ...entries.flatMap((e) => [`file '${name(e.file)}'`, `duration ${(e.count / GRAPHICS_FPS).toFixed(4)}`]), `file '${name(entries[entries.length - 1].file)}'`].join('\n') + '\n';
    const listName = `${dir}graphics_${wi}.txt`;
    await ff.writeFile(listName, list);
    out.push({ listName, start: w.start, end: w.end, files: [...files, listName] });
  }
  return out;
}

/** The sound-effects track as WAV bytes (or null when there are none / they're off). */
export async function sfxWav(tl, duration) {
  const ev = sfxEvents(tl);
  if (!ev.length) return null;
  const buf = await renderSfx(ev, duration, tl.sfx?.volume ?? 0.5);
  return buf ? bufferToWav(buf) : null;
}
