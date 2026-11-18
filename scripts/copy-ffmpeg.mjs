// Copies the ffmpeg.wasm core and the caption font into client/public so the browser can
// load them from the same origin. Runs automatically before `npm run dev` and `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
};

const core = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copy(path.join(core, f), path.join(root, 'client', 'public', 'ffmpeg', f));
copy(path.join(root, 'assets', 'fonts', 'Poppins-Bold.ttf'), path.join(root, 'client', 'public', 'fonts', 'Poppins-Bold.ttf'));
// Fonts for motion graphics and animated captions (drawn with canvas): editorial serif,
// handwriting, a clean sans, and Bangla.
const fs_ = (pkg, file) => copy(path.join(root, 'node_modules', '@fontsource', pkg, 'files', file), path.join(root, 'client', 'public', 'fonts', file));
for (const f of ['instrument-serif-latin-400-normal.woff2', 'instrument-serif-latin-400-italic.woff2']) fs_('instrument-serif', f);
for (const f of ['caveat-latin-700-normal.woff2']) fs_('caveat', f);
for (const f of ['inter-latin-400-normal.woff2', 'inter-latin-700-normal.woff2', 'inter-latin-800-normal.woff2']) fs_('inter', f);
for (const f of ['hind-siliguri-bengali-600-normal.woff2', 'hind-siliguri-bengali-700-normal.woff2']) fs_('hind-siliguri', f);
console.log('ffmpeg.wasm core and fonts ready in client/public');
