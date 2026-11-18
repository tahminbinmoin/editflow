// AI provider adapters. Each adapter has the same small interface so the product never
// depends on one model vendor:  test(cfg, key) → { ok, models, message, quota }
//                              chat(cfg, key, { system, user, json }) → { text, model, routedVia, usage }
// Keys are decrypted on the server only; they never reach the browser.

const TIMEOUT_MS = 150_000;

async function http(url, { method = 'GET', headers = {}, body, timeout = TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json', ...headers } : headers,
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const reason = e.name === 'TimeoutError' ? 'timed out' : e.cause?.code === 'ECONNREFUSED' ? 'connection refused — is it running?' : e.message;
    throw Object.assign(new Error(`Could not reach ${new URL(url).host}: ${reason}`), { status: 0 });
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || json?.error || text.slice(0, 300) || res.statusText;
    const hint =
      res.status === 401 || res.status === 403
        ? ' Check the API key.'
        : res.status === 429
          ? ' The provider rate limit or quota was reached — wait and retry, or switch provider.'
          : res.status === 402
            ? ' This provider needs billing/credits on your account.'
            : '';
    throw Object.assign(new Error(`${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`), { status: res.status });
  }
  return { json, text, headers: res.headers };
}

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

/** On the hosted app, refuse private/loopback router URLs (they can't be reached and would be an SSRF vector). */
export function checkRouterUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Object.assign(new Error('Router URL is not a valid URL.'), { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Router URL must start with http:// or https://'), { status: 400 });
  const host = u.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || host === '0.0.0.0' || host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd');
  if (isPrivate && process.env.VERCEL) {
    throw Object.assign(
      new Error('The hosted app cannot reach a router on your own computer (localhost or a private address). Deploy FreeLLMAPI somewhere public with https, or run Editflow locally to use a local router.'),
      { status: 400 },
    );
  }
  return trimSlash(u.toString());
}

export const PROVIDERS = {
  freellmapi: {
    id: 'freellmapi',
    name: 'FreeLLMAPI router',
    tagline: 'Free-tier models through your own self-hosted router',
    recommended: true,
    billing: {
      label: 'Free tiers of keys you add',
      tone: 'free',
      detail:
        'Editflow calls your own FreeLLMAPI router (github.com/tashfeenahmed/freellmapi). It routes each request to a provider key you added there (Groq, Gemini, Mistral, OpenRouter…) within that provider’s free-tier limits, and fails over when one is rate-limited. Editflow adds no charge. The router’s authors describe it as for personal experimentation, not production: use it for demos and prototyping, and switch to paid API keys before serving paying customers.',
    },
    dataUse:
      'Your router may forward a request to any provider in its fallback chain. Some free tiers (for example Google’s Gemini free tier) may use prompts to improve their products. Editflow shows which provider actually answered each request.',
    fields: [
      { key: 'baseUrl', label: 'Router URL', placeholder: 'https://your-router.example.com/v1', help: 'Where your FreeLLMAPI router runs. On the hosted app it must be a public https URL; localhost only works when you run Editflow on the same computer.' },
      { key: 'model', label: 'Model', placeholder: 'auto:smart', help: '“auto:smart” prefers the most capable free model; “auto:fast” prefers speed; or enter a model ID from the list.' },
    ],
    secretLabel: 'Unified key (freellmapi-…)',
    defaults: () => ({ baseUrl: process.env.FREELLMAPI_BASE_URL || 'http://localhost:3001/v1', model: 'auto:smart' }),
    async test(cfg, key) {
      const base = checkRouterUrl(cfg.baseUrl);
      const auth = { authorization: `Bearer ${key}` };
      const { json } = await http(`${base}/models?execution_status=ready`, { headers: auth, timeout: 15000 });
      const models = (json?.data || []).map((m) => m.id).filter(Boolean);
      let quota = null;
      try {
        const u = await http(`${base}/usage`, { headers: auth, timeout: 8000 });
        quota = u.json;
      } catch {}
      const real = models.filter((m) => !/^auto|fusion/.test(m));
      return {
        ok: true,
        models: ['auto', 'auto:smart', 'auto:fast', 'auto:reliable', ...real.slice(0, 300)],
        message: real.length
          ? `Connected. ${real.length} model${real.length === 1 ? '' : 's'} ready to serve requests right now.`
          : 'Connected, but no models are ready. Add provider keys in the FreeLLMAPI dashboard (Keys page).',
        quota,
      };
    },
    async chat(cfg, key, { system, user }) {
      const base = checkRouterUrl(cfg.baseUrl);
      const { json, headers } = await http(`${base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: {
          model: cfg.model || 'auto:smart',
          temperature: 0.4,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
      });
      return {
        text: json?.choices?.[0]?.message?.content || '',
        model: json?.model || cfg.model,
        routedVia: headers.get('x-routed-via') || null,
        fallbackAttempts: Number(headers.get('x-fallback-attempts') || 0),
        usage: { input: json?.usage?.prompt_tokens, output: json?.usage?.completion_tokens },
      };
    },
  },

  openai: {
    id: 'openai',
    name: 'OpenAI (ChatGPT models)',
    tagline: 'Direct OpenAI API with your own key',
    billing: {
      label: 'Paid API billing',
      tone: 'paid',
      detail:
        'Requires an OpenAI API account with billing at platform.openai.com. ChatGPT app subscriptions are billed separately from the API — check your platform billing page for any API credits on your account before running requests.',
    },
    dataUse: 'OpenAI states API data is not used for training by default. Review your organization’s data controls at platform.openai.com.',
    fields: [{ key: 'model', label: 'Model', placeholder: 'Load models after saving your key', help: 'Pick a model from your account’s list.' }],
    secretLabel: 'OpenAI API key',
    defaults: () => ({ model: '' }),
    async test(cfg, key) {
      const { json } = await http('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` }, timeout: 15000 });
      const models = (json?.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id)).sort();
      return { ok: true, models, message: `Key accepted. ${models.length} chat models visible. Requests are billed to your OpenAI account.` };
    },
    async chat(cfg, key, { system, user, json: wantJson }) {
      if (!cfg.model) throw new Error('Choose an OpenAI model in AI settings first.');
      const { json } = await http('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: {
          model: cfg.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
        },
      });
      return { text: json?.choices?.[0]?.message?.content || '', model: json?.model, routedVia: `openai/${json?.model}`, usage: { input: json?.usage?.prompt_tokens, output: json?.usage?.completion_tokens } };
    },
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude models)',
    tagline: 'Direct Claude API with your own key',
    billing: {
      label: 'Paid API billing',
      tone: 'paid',
      detail: 'Requires an Anthropic Console account (console.anthropic.com) with API credits. Claude.ai app subscriptions are separate from API usage.',
    },
    dataUse: 'Anthropic’s commercial terms state API inputs and outputs are not used to train models by default. Review the current terms in the Anthropic Console.',
    fields: [{ key: 'model', label: 'Model', placeholder: 'claude-sonnet-5-5', help: 'Load your available models after saving the key.' }],
    secretLabel: 'Anthropic API key',
    defaults: () => ({ model: 'claude-sonnet-5-5' }),
    async test(cfg, key) {
      const { json } = await http('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        timeout: 15000,
      });
      const models = (json?.data || []).map((m) => m.id);
      return { ok: true, models, message: `Key accepted. ${models.length} models visible. Requests are billed to your Anthropic account.` };
    },
    async chat(cfg, key, { system, user }) {
      const { json } = await http('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: { model: cfg.model || 'claude-sonnet-5-5', max_tokens: 8000, system, messages: [{ role: 'user', content: user }] },
      });
      const text = (json?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { text, model: json?.model, routedVia: `anthropic/${json?.model}`, usage: { input: json?.usage?.input_tokens, output: json?.usage?.output_tokens } };
    },
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'Direct Gemini API with a Google AI Studio key',
    billing: {
      label: 'Free tier available (rate-limited)',
      tone: 'mixed',
      detail:
        'Google AI Studio keys start on a rate-limited free tier for some models; higher limits need a billing account. Free-tier limits change often — check ai.google.dev/gemini-api/docs/rate-limits. The free tier is not available in every region.',
    },
    dataUse: 'Google’s pricing page states free-tier prompts and responses may be used to improve Google products; paid-tier data is not. Avoid sending sensitive transcripts on the free tier.',
    fields: [{ key: 'model', label: 'Model', placeholder: 'Load models after saving your key', help: 'Pick a model your key can use.' }],
    secretLabel: 'Gemini API key',
    defaults: () => ({ model: '' }),
    async test(cfg, key) {
      const { json } = await http('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, timeout: 15000 });
      const models = (json?.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''));
      return { ok: true, models, message: `Key accepted. ${models.length} models visible. Usage depends on your key’s tier.` };
    },
    async chat(cfg, key, { system, user, json: wantJson }) {
      if (!cfg.model) throw new Error('Choose a Gemini model in AI settings first.');
      const { json } = await http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.4, ...(wantJson ? { responseMimeType: 'application/json' } : {}) },
        },
      });
      const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      return { text, model: cfg.model, routedVia: `google/${cfg.model}`, usage: { input: json?.usageMetadata?.promptTokenCount, output: json?.usageMetadata?.candidatesTokenCount } };
    },
  },
};

// Speech-to-text providers (separate from text models).
export const TRANSCRIBERS = {
  groq: {
    id: 'groq',
    name: 'Groq Whisper',
    billing: 'Groq has a free plan for Whisper with rate limits and a 25 MB file limit (Editflow sends 16 kHz mono audio, so about 13 minutes per file). Check console.groq.com/docs for current limits.',
    dataUse: 'The audio track (not the video) is uploaded to Groq for transcription.',
    secretLabel: 'Groq API key',
    async transcribe(key, audio, { model = 'whisper-large-v3-turbo', prompt = '', type = 'audio/wav', filename = 'audio.wav' } = {}) {
      const form = new FormData();
      form.append('file', audio instanceof Blob ? audio : new Blob([audio], { type }), filename);
      form.append('model', model);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      if (prompt) form.append('prompt', prompt.slice(0, 400));
      const { json } = await http('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: form,
        timeout: 300_000,
      });
      return { language: json?.language, segments: (json?.segments || []).map((s) => ({ start: s.start, end: s.end, text: String(s.text).trim() })) };
    },
  },
};

/** Pull the first JSON object out of a model reply (handles ``` fences and stray prose). */
export function extractJson(text) {
  if (!text) throw new Error('The model returned an empty reply.');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model reply did not contain JSON.');
  return JSON.parse(body.slice(start, end + 1));
}
