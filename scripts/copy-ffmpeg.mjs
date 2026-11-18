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
console.log('ffmpeg.wasm core and fonts ready in client/public');
