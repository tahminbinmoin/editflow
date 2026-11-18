// TEST FIXTURE ONLY: a tiny stand-in for the OpenAI and Anthropic APIs, so the whole AI path
// (auth headers, model lists, JSON parsing, consent, image input, transcription, proposals)
// can be tested without real keys. It does NOT analyse anything: replies follow fixed patterns
// built from the IDs and labels in the prompt.
//   OpenAI:    http://localhost:PORT/openai/v1     key "sk-test"
//   Anthropic: http://localhost:PORT/anthropic/v1  key "sk-ant-test"
// Run: npm run mock:ai   (port 3999)
import http from 'node:http';

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
  if (/visual editor/.test(system)) {
    const hasLib = /B-ROLL LIBRARY B1/.test(text);
    return {
      summary: `Mock visual plan from ${images} images.`,
      scenes: [{ start: 0, end: 2, what: 'mock scene' }],
      broll: [
        { start: 2, duration: 2, description: 'Close-up of the product', reason: 'mock', footage: hasLib ? 'B1' : null, srcIn: 1 },
        { start: 5, duration: 9, description: 'Overlong shot', reason: 'clamped to 6s', footage: null },
      ],
      graphics: [
        { type: 'keyword', start: 1, duration: 1.5, text: 'Ninety percent', color: 'yellow', position: 'center', reason: 'mock' },
        { type: 'stat', start: 3, text: '90%', sub: 'brew it too hot', reason: 'mock' },
        { type: 'list', start: 4, text: 'Steps', items: ['Boil', 'Wait 30 s', 'Pour', 'Enjoy', 'Too many'] },
        { type: 'callout', start: 6, text: 'Kettle', x: 1.4, y: -2 },
        { type: 'sparkles', start: 2, text: 'not a real type' },
      ],
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

export function startMock(port = PORT) {
  let transcribed = 0;
  const server = http.createServer(async (req, res) => {
    const url = req.url;
    if (url.startsWith('/openai/v1/')) {
      if (req.headers.authorization !== 'Bearer sk-test') return reply(res, 401, { error: { message: 'Incorrect API key provided' } });
      const p = url.slice('/openai/v1'.length);
      if (p.startsWith('/models')) return reply(res, 200, { data: ['gpt-6.2-sol', 'gpt-6-luna', 'gpt-transcribe', 'text-embedding-3-small'].map((id) => ({ id })) });
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
        const images = parts.filter((x) => x.type === 'image_url' && /^data:image\/jpeg;base64,/.test(x.image_url.url)).length;
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
        const images = parts.filter((x) => x.type === 'image' && x.source?.type === 'base64' && x.source.data).length;
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
