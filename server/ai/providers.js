// AI provider adapters: ChatGPT (OpenAI API) and Claude (Anthropic API). Both have the same
// small interface, so the product never depends on one vendor:
//   test(cfg, key) → { ok, models, message }
//   chat(cfg, key, { system, user, json, images }) → { text, model, routedVia, usage }
//     images: [{ label, data (base64 JPEG), mime } | { label, url }] — frames / stock thumbnails
// OpenAI also transcribes speech (transcribe()). Keys are decrypted on the server only.
//
// Base URLs can be overridden for tests (OPENAI_BASE_URL / ANTHROPIC_BASE_URL).

const TIMEOUT_MS = 170_000;
const OPENAI = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const ANTHROPIC = () => (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');

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
    const reason = e.name === 'TimeoutError' ? 'timed out' : e.cause?.code === 'ECONNREFUSED' ? 'connection refused' : e.message;
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
          ? ' The rate limit or your API credit was reached. Check billing on the provider’s dashboard, wait, or switch provider.'
          : res.status === 402
            ? ' Add API credit on the provider’s dashboard.'
            : '';
    throw Object.assign(new Error(`${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`), { status: res.status });
  }
  return { json, text, headers: res.headers };
}

const SUBSCRIPTION_NOTE =
  'A ChatGPT Plus/Pro or Claude Pro/Max subscription does not cover requests from other apps: Editflow uses an API key, billed per request on the provider’s developer platform.';

export const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    short: 'ChatGPT',
    tagline: 'OpenAI’s GPT models through your own OpenAI API key',
    billing: {
      label: 'API key · pay per use',
      tone: 'paid',
      detail:
        'Create a key at platform.openai.com/api-keys and add credit under Billing. The ChatGPT Plus/Pro subscription is billed separately and isn’t used here. Some ChatGPT Pro and Business plans include promotional API credits; check your OpenAI billing page.',
    },
    dataUse: 'OpenAI states that API data is not used to train its models by default. Review your organisation’s data controls at platform.openai.com.',
    fields: [
      { key: 'model', label: 'Model', placeholder: 'gpt-6.2-sol', help: 'Used for planning and video analysis. Must accept images for video analysis (current GPT models do).' },
      { key: 'transcribeModel', label: 'Transcription model', placeholder: 'gpt-transcribe', help: 'Speech-to-text model for the words themselves.' },
      { key: 'timingModel', label: 'Word timing model', placeholder: 'whisper-1', help: 'Gives each word its exact time, so cuts land between words and silences, fillers and mumbles can be removed. OpenAI only offers word timing on whisper-1 (supported until 26 Feb 2027). Type “off” to estimate timing from the audio instead.' },
      { key: 'imageModel', label: 'Image model', placeholder: 'gpt-image-2', help: 'Makes AI B-roll images when stock footage doesn’t fit.' },
    ],
    secretLabel: 'OpenAI API key (sk-…)',
    vision: true,
    defaults: () => ({ model: 'gpt-6.2-sol', transcribeModel: 'gpt-transcribe', timingModel: 'whisper-1', imageModel: 'gpt-image-2' }),
    async test(cfg, key) {
      const { json } = await http(`${OPENAI()}/models`, { headers: { authorization: `Bearer ${key}` }, timeout: 15000 });
      const ids = (json?.data || []).map((m) => m.id);
      const models = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/transcribe|realtime|audio|tts|image|search|embed|live|whisper|moderation|cyber/.test(id)).sort().reverse();
      const has = (m) => !m || ids.includes(m);
      const warn = [!has(cfg.model) && `the model “${cfg.model}” isn’t on your account`, !has(cfg.transcribeModel) && `the transcription model “${cfg.transcribeModel}” isn’t on your account`].filter(Boolean);
      return {
        ok: true,
        models,
        message: `Key accepted. ${models.length} chat models visible.${warn.length ? ` Note: ${warn.join('; ')}. Pick another below.` : ''} Requests are billed to your OpenAI API account.`,
      };
    },
    async chat(cfg, key, { system, user, json: wantJson, images = [] }) {
      const content = images.length
        ? [{ type: 'text', text: user }, ...images.flatMap((im) => [{ type: 'text', text: im.label }, { type: 'image_url', image_url: { url: im.url || `data:${im.mime || 'image/jpeg'};base64,${im.data}`, detail: 'low' } }])]
        : user;
      const { json } = await http(`${OPENAI()}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: {
          model: cfg.model || 'gpt-6.2-sol',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
        },
      });
      return { text: json?.choices?.[0]?.message?.content || '', model: json?.model, routedVia: `openai/${json?.model || cfg.model}`, usage: { input: json?.usage?.prompt_tokens, output: json?.usage?.completion_tokens } };
    },
    /** Speech to text for one short chunk of audio (WAV). Returns plain text. */
    async transcribe(cfg, key, audio, { prompt = '', language = '' } = {}) {
      const form = new FormData();
      form.append('file', audio, 'speech.wav');
      form.append('model', cfg.transcribeModel || 'gpt-transcribe');
      form.append('response_format', 'json');
      if (language) form.append('language', language);
      if (prompt) form.append('prompt', prompt.slice(-400));
      const { json } = await http(`${OPENAI()}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, timeout: 120_000 });
      return String(json?.text || '').trim();
    },
    /** Speech to text WITH word times for one chunk (whisper-1 verbose_json). Returns { text, words: [{ t, s, e }] }. */
    async transcribeWords(cfg, key, audio, { prompt = '', language = '' } = {}) {
      const form = new FormData();
      form.append('file', audio, 'speech.wav');
      form.append('model', cfg.timingModel || 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      if (language) form.append('language', language);
      if (prompt) form.append('prompt', prompt.slice(-400));
      const { json } = await http(`${OPENAI()}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, timeout: 120_000 });
      const words = (json?.words || []).filter((w) => w && Number.isFinite(+w.start) && Number.isFinite(+w.end)).map((w) => ({ t: String(w.word || '').trim(), s: +w.start, e: +w.end })).filter((w) => w.t);
      return { text: String(json?.text || '').trim(), words };
    },
  },

  anthropic: {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    short: 'Claude',
    tagline: 'Anthropic’s Claude models through your own Anthropic API key',
    billing: {
      label: 'API key · pay per use',
      tone: 'paid',
      detail:
        'Create a key at console.anthropic.com and add credit under Billing. Anthropic doesn’t allow a Claude Pro/Max subscription to power other apps, so the subscription isn’t used here.',
    },
    dataUse: 'Anthropic’s commercial terms state that API inputs and outputs are not used to train models by default. Review the current terms in the Anthropic Console.',
    fields: [{ key: 'model', label: 'Model', placeholder: 'claude-sonnet-5-5', help: 'Used for planning and video analysis (Claude models accept images).' }],
    secretLabel: 'Anthropic API key (sk-ant-…)',
    vision: true,
    defaults: () => ({ model: 'claude-sonnet-5-5' }),
    async test(cfg, key) {
      const { json } = await http(`${ANTHROPIC()}/models?limit=100`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 15000 });
      const models = (json?.data || []).map((m) => m.id);
      const warn = cfg.model && models.length && !models.includes(cfg.model) ? ` Note: “${cfg.model}” isn’t on your account; pick another below.` : '';
      return { ok: true, models, message: `Key accepted. ${models.length} models visible.${warn} Requests are billed to your Anthropic API account.` };
    },
    async chat(cfg, key, { system, user, images = [] }) {
      const content = images.length
        ? [...images.flatMap((im) => [{ type: 'text', text: im.label }, { type: 'image', source: im.url ? { type: 'url', url: im.url } : { type: 'base64', media_type: im.mime || 'image/jpeg', data: im.data } }]), { type: 'text', text: user }]
        : user;
      const { json } = await http(`${ANTHROPIC()}/messages`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: { model: cfg.model || 'claude-sonnet-5-5', max_tokens: 8000, system, messages: [{ role: 'user', content }] },
      });
      const text = (json?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { text, model: json?.model, routedVia: `anthropic/${json?.model || cfg.model}`, usage: { input: json?.usage?.input_tokens, output: json?.usage?.output_tokens } };
    },
  },
};

export const SUBSCRIPTION_INFO = SUBSCRIPTION_NOTE;

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
