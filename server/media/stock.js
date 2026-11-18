// B-roll sources: Pexels and Pixabay stock video/photos (free licences, attribution shown in the
// app), and AI-generated images through the user's OpenAI key. Search results are normalised to
// one candidate shape; downloads always re-resolve the file from the provider by id (never from
// a URL the browser sent), so the API can't be used to fetch arbitrary URLs.
//
// Keys: PEXELS_API_KEY / PIXABAY_API_KEY on the server (app-wide), or each user's own key.

const PEXELS = () => (process.env.PEXELS_BASE_URL || 'https://api.pexels.com').replace(/\/+$/, '');
const PIXABAY = () => (process.env.PIXABAY_BASE_URL || 'https://pixabay.com/api').replace(/\/+$/, '');
const OPENAI = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

export const STOCK_SOURCES = {
  pexels: { id: 'pexels', name: 'Pexels', site: 'https://www.pexels.com', keyUrl: 'https://www.pexels.com/api/new/', licence: 'Free to use, no attribution required (credit appreciated). Photos and videos provided by Pexels.' },
  pixabay: { id: 'pixabay', name: 'Pixabay', site: 'https://pixabay.com', keyUrl: 'https://pixabay.com/api/docs/', licence: 'Free under the Pixabay Content License. Videos provided by Pixabay.' },
};

async function getJson(url, headers = {}, timeout = 20000) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw Object.assign(new Error(`Could not reach ${new URL(url).host}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`), { status: 502 });
  }
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 200)}${res.status === 401 || res.status === 403 ? ' (check the API key)' : res.status === 429 ? ' (rate limit reached; try again later)' : ''}`), { status: res.status === 429 ? 429 : 502 });
  return JSON.parse(text);
}

const orient = (o) => (['portrait', 'landscape', 'square'].includes(o) ? o : 'portrait');
const small = (u, w = 360) => (u && u.includes('images.pexels.com') ? u.replace(/\?.*$/, '') + `?auto=compress&cs=tinysrgb&w=${w}` : u);

function pexelsVideo(v) {
  return {
    provider: 'pexels',
    id: String(v.id),
    kind: 'video',
    duration: v.duration,
    width: v.width,
    height: v.height,
    thumb: small(v.image || v.video_pictures?.[0]?.picture),
    pageUrl: v.url,
    author: v.user?.name || '',
    authorUrl: v.user?.url || '',
    files: (v.video_files || []).filter((f) => f.link && f.width && /mp4/.test(f.file_type || 'mp4')).map((f) => ({ url: f.link, width: f.width, height: f.height })),
  };
}
function pexelsPhoto(p) {
  return {
    provider: 'pexels',
    id: String(p.id),
    kind: 'photo',
    width: p.width,
    height: p.height,
    thumb: small(p.src?.medium || p.src?.large),
    pageUrl: p.url,
    author: p.photographer || '',
    authorUrl: p.photographer_url || '',
    alt: p.alt || '',
    files: [{ url: p.src?.large2x || p.src?.large || p.src?.original, width: Math.min(p.width, 1880), height: Math.round((Math.min(p.width, 1880) / p.width) * p.height) }],
  };
}
function pixabayVideo(h) {
  const v = h.videos || {};
  return {
    provider: 'pixabay',
    id: String(h.id),
    kind: 'video',
    duration: h.duration,
    width: v.large?.width || v.medium?.width,
    height: v.large?.height || v.medium?.height,
    thumb: v.medium?.thumbnail || v.small?.thumbnail || v.tiny?.thumbnail,
    pageUrl: h.pageURL,
    author: h.user || '',
    authorUrl: h.user_id ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : '',
    files: ['large', 'medium', 'small', 'tiny'].map((k) => v[k]).filter((f) => f?.url && f.size > 0).map((f) => ({ url: f.url, width: f.width, height: f.height, size: f.size })),
  };
}

/** Search one source. kind: 'video' | 'photo'. Returns normalised candidates. */
export async function searchStock(source, key, query, { kind = 'video', orientation = 'portrait', perPage = 6 } = {}) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return [];
  if (source === 'pexels') {
    const auth = { authorization: key };
    if (kind === 'photo') {
      const j = await getJson(`${PEXELS()}/v1/search?query=${encodeURIComponent(q)}&orientation=${orient(orientation)}&per_page=${perPage}`, auth);
      return (j.photos || []).map(pexelsPhoto);
    }
    const j = await getJson(`${PEXELS()}/v1/videos/search?query=${encodeURIComponent(q)}&orientation=${orient(orientation)}&size=medium&per_page=${perPage}`, auth);
    return (j.videos || []).map(pexelsVideo).filter((c) => c.files.length);
  }
  if (source === 'pixabay') {
    if (kind === 'photo') return [];
    const j = await getJson(`${PIXABAY()}/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=${Math.max(3, perPage)}&safesearch=true&video_type=film`);
    return (j.hits || []).map(pixabayVideo).filter((c) => c.files.length);
  }
  return [];
}

/** Look a candidate up again by id (downloads never trust a URL from the browser). */
export async function resolveStock(source, key, id, kind) {
  const sid = String(id).replace(/[^0-9]/g, '');
  if (!sid) throw Object.assign(new Error('Invalid stock id'), { status: 400 });
  if (source === 'pexels') {
    if (kind === 'photo') return pexelsPhoto(await getJson(`${PEXELS()}/v1/photos/${sid}`, { authorization: key }));
    return pexelsVideo(await getJson(`${PEXELS()}/v1/videos/videos/${sid}`, { authorization: key }));
  }
  if (source === 'pixabay') {
    const j = await getJson(`${PIXABAY()}/videos/?key=${encodeURIComponent(key)}&id=${sid}`);
    if (!j.hits?.[0]) throw Object.assign(new Error('That Pixabay video is no longer available'), { status: 404 });
    return pixabayVideo(j.hits[0]);
  }
  throw Object.assign(new Error('Unknown stock source'), { status: 400 });
}

/**
 * The rendition to download: matches the output orientation, at least `minShort` px on the
 * short side when possible, and as small as possible above that (fast downloads, small files).
 */
export function pickFile(files, { minShort = 720, maxShort = 1080 } = {}) {
  const ok = files.filter((f) => f.width && f.height);
  if (!ok.length) return files[0] || null;
  const short = (f) => Math.min(f.width, f.height);
  const fitting = ok.filter((f) => short(f) >= minShort && short(f) <= maxShort).sort((a, b) => short(a) - short(b));
  if (fitting.length) return fitting[0];
  const bigger = ok.filter((f) => short(f) > maxShort).sort((a, b) => short(a) - short(b));
  if (bigger.length) return bigger[0];
  return ok.sort((a, b) => short(b) - short(a))[0];
}

const ALLOWED_HOSTS = /(^|\.)(pexels\.com|pixabay\.com|vimeo\.com|vimeocdn\.com|akamaized\.net|cdn\.pixabay\.com)$/i;
/** Download a resolved file (host-allowlisted), capped at `maxBytes`. */
export async function download(url, maxBytes = 45 * 1024 * 1024) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !process.env.PEXELS_BASE_URL && !process.env.PIXABAY_BASE_URL) throw Object.assign(new Error('Refusing a non-https download'), { status: 400 });
  if (!ALLOWED_HOSTS.test(u.hostname) && !process.env.PEXELS_BASE_URL && !process.env.PIXABAY_BASE_URL) throw Object.assign(new Error(`Refusing to download from ${u.hostname}`), { status: 400 });
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw Object.assign(new Error(`Download failed (${res.status})`), { status: 502 });
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw Object.assign(new Error(`That file is too big (${(len / 1048576).toFixed(0)} MB)`), { status: 413 });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw Object.assign(new Error('That file is too big'), { status: 413 });
  return { buf, type: res.headers.get('content-type') || '' };
}

/** AI image through the OpenAI Images API (b64 JPEG). orientation → size. */
export async function generateImage(cfg, key, prompt, orientation = 'portrait') {
  const size = orientation === 'landscape' ? '1536x1024' : orientation === 'square' ? '1024x1024' : '1024x1536';
  let res;
  try {
    res = await fetch(`${OPENAI()}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.imageModel || 'gpt-image-2', prompt: String(prompt).slice(0, 1500), size, quality: 'medium', output_format: 'jpeg', n: 1 }),
      signal: AbortSignal.timeout(170_000),
    });
  } catch (e) {
    throw Object.assign(new Error(`Could not reach OpenAI: ${e.message}`), { status: 502 });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`OpenAI image: ${j?.error?.message || res.status}${res.status === 401 ? ' (check the API key)' : ''}`), { status: res.status === 400 ? 400 : 502 });
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error('OpenAI returned no image'), { status: 502 });
  const [w, h] = size.split('x').map(Number);
  return { buf: Buffer.from(b64, 'base64'), width: w, height: h, model: cfg.imageModel || 'gpt-image-2' };
}
