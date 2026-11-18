// TEST FIXTURE ONLY — a tiny stand-in for a FreeLLMAPI router so the integration path
// (auth header, /models, /usage, /chat/completions, X-Routed-Via, JSON parsing, consent,
// proposals) can be tested without real provider keys. It does NOT analyse anything:
// it echoes transcript IDs from the prompt in a fixed pattern.
// Run: npm run mock:freellmapi   (listens on http://localhost:3999/v1, key "freellmapi-test")
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 3999);
const KEY = 'freellmapi-test';

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export function startMock(port = PORT) {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) return reply(res, 401, { error: { message: 'Invalid unified key' } });
    if (req.url.startsWith('/v1/models')) return reply(res, 200, { data: [{ id: 'auto' }, { id: 'mock-model-a' }, { id: 'mock-model-b' }] });
    if (req.url.startsWith('/v1/usage')) return reply(res, 200, { month: 'mock', requests: 3, tokens: 1234 });
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const { messages } = JSON.parse(body);
        const user = messages.find((m) => m.role === 'user').content;
        const ids = [...new Set([...user.matchAll(/^(s\d+) \[/gm)].map((m) => m[1]))];
        let content;
        if (/CREATOR REQUEST:/.test(user)) {
          const clipIds = [...user.matchAll(/id=(clip_[a-z0-9]+)/g)].map((m) => m[1]);
          content = JSON.stringify({ summary: 'Mock: moves the last clip to the front and lowers the music.', ops: [{ type: 'moveClip', clipId: clipIds[clipIds.length - 1], toIndex: 0 }, { type: 'setMusic', patch: { volume: 0.1 } }, { type: 'bogusOp' }], notes: ['mock note'] });
        } else if (/"matchPlan"/.test(user)) {
          content = JSON.stringify({ structure: 'mock', pacing: 'mock', matchPlan: ['mock step'], confidence: 'mock' });
        } else {
          const pick = ids.slice(0, 6);
          content =
            'Here is the plan:\n```json\n' +
            JSON.stringify({
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
            }) +
            '\n```';
        }
        reply(res, 200, { model: 'mock-model-a', choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }, { 'x-routed-via': 'mockprovider/mock-model-a' });
      });
      return;
    }
    reply(res, 404, { error: { message: 'not found' } });
  });
  server.listen(port);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMock();
  console.log(`Mock FreeLLMAPI on http://localhost:${PORT}/v1 (key ${KEY}) — test fixture only`);
}
