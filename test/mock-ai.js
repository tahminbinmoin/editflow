// TEST FIXTURE ONLY: a tiny stand-in for the OpenAI and Anthropic APIs, so the whole AI path
// (auth headers, model lists, JSON parsing, consent, image input, transcription, proposals)
// can be tested without real keys. It does NOT analyse anything: replies follow fixed patterns
// built from the IDs and labels in the prompt.
//   OpenAI:    http://localhost:PORT/openai/v1     key "sk-test"
//   Anthropic: http://localhost:PORT/anthropic/v1  key "sk-ant-test"
//   Pexels:    http://localhost:PORT/pexels         key "pexels-test"
//   Pixabay:   http://localhost:PORT/pixabay        key "pixabay-test"
// Run: npm run mock:ai   (port 3999)
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.MOCK_PORT || 3999);
export const state = { requests: [] };

const reply = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readRaw = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

/** Fake model: same JSON for both vendors. `text` = all text parts, `images` = count. */
function think(system, text, images) {
  const ids = [...new Set([...text.matchAll(/^(s\d+) \[/gm)].map((m) => m[1]))];
  if (/CREATOR REQUEST:/.test(text)) {
    const clipIds = [...text.matchAll(/id=(clip_[a-z0-9]+|c\d+)/g)].map((m) => m[1]);
    return { summary: 'Mock: moves the last clip to the front, lowers the music and adds a keyword.', ops: [{ type: 'moveClip', clipId: clipIds[clipIds.length - 1], toIndex: 0 }, { type: 'setMusic', patch: { volume: 0.1 } }, { type: 'addGraphic', graphic: { type: 'keyword', text: 'Mock', start: 0.5 } }, { type: 'bogusOp' }], notes: ['mock note'] };
  }
  if (/"matchPlan"/.test(text)) return { structure: 'mock', pacing: 'mock', matchPlan: ['mock step'], confidence: 'mock' };
  if (/You choose stock B-roll/.test(system)) {
    const slots = [...text.matchAll(/^S(\d+) at/gm)].map((m) => m[1]);
    return { picks: slots.map((n, i) => ({ slot: `S${n}`, choice: i === 0 ? 'C2' : i === 1 ? null : 'C1', why: `mock pick ${n}` })) };
  }
  if (/visual editor/.test(system)) {
    const hasLib = /B-ROLL LIBRARY B1/.test(text);
    return {
      summary: `Mock visual plan from ${images} images.`,
      scenes: [{ start: 0, end: 2, what: 'mock scene' }],
      broll: [
        { start: 1.6, duration: 1.2, description: 'Close-up of the product', reason: 'mock', layout: 'full', footage: hasLib ? 'B1' : null, srcIn: 1, queries: ['coffee close up'], kind: 'video' },
        { start: 3, duration: 2, description: 'Kettle on a stove', reason: 'mock', layout: 'split', queries: ['kettle stove', 'boiling water'], kind: 'video', imagePrompt: 'A kettle on a gas stove' },
        { start: 5.2, duration: 9, description: 'Overlong shot', reason: 'clamped to 6s', layout: 'card', queries: ['coffee beans'], kind: 'photo', caption: 'beans!' },
        { start: 5.5, duration: 1, description: 'Overlaps the previous one', reason: 'dropped', queries: ['x'] },
      ],
      graphics: [
        { type: 'headline', layout: 'panel', start: 0.2, duration: 1.3, text: 'Most people brew it *too hot*', color: 'purple', reason: 'mock' },
        { type: 'keyword', start: 1, duration: 1.5, text: 'Ninety percent', color: 'yellow', position: 'center', reason: 'mock' },
        { type: 'stat', start: 3, text: '90%', sub: 'brew it too hot', reason: 'mock' },
        { type: 'headline', layout: 'panel', start: 3.2, duration: 1.5, text: 'Clashes with the split shot' },
        { type: 'callout', start: 6, text: 'Kettle', x: 1.4, y: -2 },
        { type: 'photo', start: 2, text: 'photo cards come as B-roll' },
        { type: 'sparkles', start: 2, text: 'not a real type' },
      ],
      zooms: [{ at: 1, zoom: 1.2 }, { at: 2, zoom: 1.3 }, { at: 5, zoom: 2 }],
      captionEmphasis: ['too hot', '90%'],
      notes: ['mock visual note'],
    };
  }
  const pick = ids.slice(0, 6);
  return {
    summary: 'Mock plan for testing.',
    hookOptions: [{ text: 'mock', segmentIds: [pick[pick.length - 1]], why: 'mock' }],
    hookTitle: 'Mock title',
    beats: [{ role: 'hook', title: 'Hook', segmentIds: [pick[pick.length - 1]], why: 'mock' }],
    clips: [{ segmentIds: [pick[pick.length - 1]], role: 'hook' }, ...pick.slice(0, -1).map((id) => ({ segmentIds: [id], role: 'progression' })), { segmentIds: ['s999'], role: 'cta' }],
    broll: [{ segmentId: pick[1], description: 'mock shot', reason: 'mock reason' }],
    overlays: [{ segmentId: pick[0], template: 'kicker', text: 'Mock kicker' }],
    music: { mood: 'mock mood', tempo: '100 BPM', notes: '' },
    soundDesign: [],
    audio: { suggestions: ['mock'], normalize: true, denoise: true },
    review: ['mock review'],
    changes: ['mock change'],
  };
}

// A 1×1 JPEG, for downloads and generated images.
export const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const pexelsVideo = (id, base) => ({ id, width: 1080, height: 1920, url: `https://www.pexels.com/video/${id}/`, image: `${base}/files/thumb-${id}.jpg`, duration: 12, user: { name: `Author ${id}`, url: 'https://www.pexels.com/@author' }, video_files: [{ id: 1, quality: 'sd', file_type: 'video/mp4', width: 540, height: 960, link: `${base}/files/pexels-${id}-540.mp4` }, { id: 2, quality: 'hd', file_type: 'video/mp4', width: 720, height: 1280, link: `${base}/files/pexels-${id}-720.mp4` }, { id: 3, quality: 'hd', file_type: 'video/mp4', width: 2160, height: 3840, link: `${base}/files/pexels-${id}-4k.mp4` }], video_pictures: [] });
const pexelsPhoto = (id, base) => ({ id, width: 4000, height: 3000, url: `https://www.pexels.com/photo/${id}/`, photographer: `Photographer ${id}`, photographer_url: 'https://www.pexels.com/@p', alt: 'mock', src: { medium: `${base}/files/thumb-${id}.jpg`, large2x: `${base}/files/photo-${id}.jpg`, large: `${base}/files/photo-${id}.jpg` } });

export function startMock(port = PORT) {
  let transcribed = 0;
  const base = `http://localhost:${port}`;
  const server = http.createServer(async (req, res) => {
    const url = req.url;
    if (url.startsWith('/files/')) {
      state.requests.push({ vendor: 'files', kind: 'download', path: url });
      res.writeHead(200, { 'content-type': url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', 'access-control-allow-origin': '*' });
      // MOCK_MEDIA_DIR (browser tests): serve real media so previews and exports work.
      const dir = process.env.MOCK_MEDIA_DIR;
      if (dir) return res.end(fs.readFileSync(`${dir}/${url.endsWith('.mp4') ? 'stock.mp4' : 'stock.jpg'}`));
      return res.end(url.endsWith('.mp4') ? Buffer.concat([Buffer.from('mockmp4'), Buffer.alloc(2048, 1)]) : TINY_JPEG);
    }
    if (url.startsWith('/pexels/')) {
      if (req.headers.authorization !== 'pexels-test') return reply(res, 401, { error: 'Invalid API key' });
      const u = new URL(url, base);
      state.requests.push({ vendor: 'pexels', kind: 'search', path: u.pathname, q: u.searchParams.get('query'), orientation: u.searchParams.get('orientation') });
      const seed = (u.searchParams.get('query') || 'x').length * 100;
      if (u.pathname === '/pexels/v1/videos/search') return reply(res, 200, { videos: [1, 2, 3].map((i) => pexelsVideo(seed + i, base)) });
      if (u.pathname === '/pexels/v1/search') return reply(res, 200, { photos: [1, 2, 3].map((i) => pexelsPhoto(seed + i, base)) });
      let m = u.pathname.match(/^\/pexels\/v1\/videos\/videos\/(\d+)$/);
      if (m) return reply(res, 200, pexelsVideo(Number(m[1]), base));
      m = u.pathname.match(/^\/pexels\/v1\/photos\/(\d+)$/);
      if (m) return reply(res, 200, pexelsPhoto(Number(m[1]), base));
    }
    if (url.startsWith('/pixabay/')) {
      const u = new URL(url, base);
      if (u.searchParams.get('key') !== 'pixabay-test') return reply(res, 400, { error: '[ERROR 400] Invalid or missing API key' });
      state.requests.push({ vendor: 'pixabay', kind: 'search', q: u.searchParams.get('q'), id: u.searchParams.get('id') });
      const hit = (id) => ({ id, pageURL: `https://pixabay.com/videos/x-${id}/`, duration: 15, user: 'pixuser', user_id: 7, videos: { large: { url: `${base}/files/pixabay-${id}-1080.mp4`, width: 1080, height: 1920, size: 9e6, thumbnail: `${base}/files/thumb-p${id}.jpg` }, medium: { url: `${base}/files/pixabay-${id}-720.mp4`, width: 720, height: 1280, size: 4e6, thumbnail: `${base}/files/thumb-p${id}.jpg` }, small: { url: '', width: 0, height: 0, size: 0 }, tiny: { url: '', size: 0 } } });
      if (u.searchParams.get('id')) return reply(res, 200, { hits: [hit(Number(u.searchParams.get('id')))] });
      return reply(res, 200, { total: 2, totalHits: 2, hits: [hit(901), hit(902)] });
    }
    if (url.startsWith('/openai/v1/')) {
      if (req.headers.authorization !== 'Bearer sk-test') return reply(res, 401, { error: { message: 'Incorrect API key provided' } });
      const p = url.slice('/openai/v1'.length);
      if (p.startsWith('/models')) return reply(res, 200, { data: ['gpt-6.2-sol', 'gpt-6-luna', 'gpt-transcribe', 'gpt-image-2', 'text-embedding-3-small'].map((id) => ({ id })) });
      if (p === '/images/generations' && req.method === 'POST') {
        const body = JSON.parse((await readRaw(req)).toString());
        state.requests.push({ vendor: 'openai', kind: 'image', model: body.model, size: body.size, prompt: body.prompt });
        const img = process.env.MOCK_MEDIA_DIR ? fs.readFileSync(`${process.env.MOCK_MEDIA_DIR}/stock.jpg`) : TINY_JPEG;
        return reply(res, 200, { data: [{ b64_json: img.toString('base64') }] });
      }
      if (p === '/audio/transcriptions' && req.method === 'POST') {
        const raw = await readRaw(req);
        const n = ++transcribed;
        state.requests.push({ vendor: 'openai', kind: 'transcribe', bytes: raw.length, model: (raw.toString('latin1').match(/name="model"\r\n\r\n([^\r]+)/) || [])[1] });
        return reply(res, 200, { text: `Mock line ${n}.` });
      }
      if (p === '/chat/completions' && req.method === 'POST') {
        const body = JSON.parse((await readRaw(req)).toString());
        const system = body.messages.find((m) => m.role === 'system').content;
        const user = body.messages.find((m) => m.role === 'user').content;
        const parts = Array.isArray(user) ? user : [{ type: 'text', text: user }];
        const text = parts.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
        const images = parts.filter((x) => x.type === 'image_url' && /^(data:image\/jpeg;base64,|https?:)/.test(x.image_url.url)).length;
        state.requests.push({ vendor: 'openai', kind: 'chat', model: body.model, images, json: body.response_format?.type });
        return reply(res, 200, { model: body.model, choices: [{ message: { role: 'assistant', content: 'Plan:\n```json\n' + JSON.stringify(think(system, text, images)) + '\n```' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
      }
    }
    if (url.startsWith('/anthropic/v1/')) {
      if (req.headers['x-api-key'] !== 'sk-ant-test' || !req.headers['anthropic-version']) return reply(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      const p = url.slice('/anthropic/v1'.length);
      if (p.startsWith('/models')) return reply(res, 200, { data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] });
      if (p === '/messages' && req.method === 'POST') {
        const body = JSON.parse((await readRaw(req)).toString());
        const content = body.messages[0].content;
        const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
        const text = parts.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
        const images = parts.filter((x) => x.type === 'image' && ((x.source?.type === 'base64' && x.source.data) || (x.source?.type === 'url' && x.source.url))).length;
        state.requests.push({ vendor: 'anthropic', kind: 'chat', model: body.model, images });
        return reply(res, 200, { model: body.model, content: [{ type: 'text', text: JSON.stringify(think(body.system, text, images)) }], usage: { input_tokens: 120, output_tokens: 60 } });
      }
    }
    reply(res, 404, { error: { message: 'not found' } });
  });
  server.listen(port);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMock();
  console.log(`Mock OpenAI on http://localhost:${PORT}/openai/v1 (key sk-test), mock Anthropic on http://localhost:${PORT}/anthropic/v1 (key sk-ant-test). Test fixture only.`);
}
