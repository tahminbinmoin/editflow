// Motion graphics in the browser: font loading for the preview, and PNG frame rendering for
// the export. Drawing itself lives in shared/graphics.js (one implementation for both).
import { drawGraphics, graphicWindows, GRAPHIC_FONT } from '@shared/graphics.js';

let fontPromise = null;
/** Register Poppins Bold under GRAPHIC_FONT (the same file the captions use). */
export function ensureGraphicsFont() {
  if (!fontPromise) {
    fontPromise = (async () => {
      const face = new FontFace(GRAPHIC_FONT, 'url(/fonts/Poppins-Bold.ttf)');
      await face.load();
      document.fonts.add(face);
      return true;
    })().catch(() => false); // falls back to a system sans-serif
  }
  return fontPromise;
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
 * Draw the graphics into PNG frames inside the ffmpeg file system, one ffconcat list per
 * time window. Identical consecutive frames are written once with a longer duration, so a
 * graphic that holds still costs one file, not hundreds.
 * @returns [{ listName, start, end, files: [paths] }] for buildRenderPlan's `graphics` option
 */
export async function writeGraphicFrames(ff, graphics, duration, W, H, dir, onProgress) {
  const windows = graphicWindows(graphics, duration);
  if (!windows.length) return [];
  await ensureGraphicsFont();
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const totalFrames = windows.reduce((n, w) => n + Math.ceil((w.end - w.start) * GRAPHICS_FPS), 0);
  let done = 0;
  const out = [];
  for (const [wi, w] of windows.entries()) {
    const frames = Math.max(1, Math.ceil((w.end - w.start) * GRAPHICS_FPS));
    const entries = []; // { file, count }
    const files = [];
    let prev = null;
    for (let k = 0; k < frames; k++) {
      ctx.clearRect(0, 0, W, H);
      drawGraphics(ctx, graphics, w.start + k / GRAPHICS_FPS, W, H);
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
