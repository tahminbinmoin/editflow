// Media work that happens in the browser: reading file info, waveform, pause detection,
// thumbnails, reference pacing, and uploads to Supabase Storage. Nothing here needs a server.
import { supabase, SUPABASE_URL, SUPABASE_KEY, accessToken } from './supabase.js';
import { MEDIA_BUCKET, MAX_UPLOAD_MB } from '@shared/config.js';
import { localUrl, getLocalFile } from './localFolder.js';

const loadEl = (src, tag) =>
  new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    el.preload = 'auto';
    el.muted = true;
    el.playsInline = true;
    el.crossOrigin = 'anonymous';
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => reject(new Error('This browser cannot read that file. Try MP4 (H.264) or WebM.'));
    el.src = src;
  });

const release = (el) => {
  try {
    el.removeAttribute('src');
    el.load();
  } catch {}
};

const seek = (el, t) =>
  new Promise((resolve) => {
    const done = () => (el.removeEventListener('seeked', done), resolve());
    el.addEventListener('seeked', done);
    el.currentTime = Math.min(Math.max(0, t), Math.max(0, (el.duration || 0) - 0.05));
  });

export async function probeFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const isAudio = /^audio\//.test(file.type) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
    const el = await loadEl(url, isAudio ? 'audio' : 'video');
    const info = { duration: +el.duration.toFixed(3), width: el.videoWidth || 0, height: el.videoHeight || 0, hasVideo: !!el.videoWidth };
    release(el);
    return info;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeAudio(file) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      return await ctx.decodeAudioData(await file.arrayBuffer());
    } finally {
      ctx.close();
    }
  } catch {
    return null; // no audio track, or a codec the browser can't decode
  }
}

const mono = (buf) => {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const a = buf.getChannelData(0);
  const b = buf.getChannelData(1);
  const m = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) / 2;
  return m;
};

/** Waveform peaks 0–100 at `perSecond` resolution. */
export function peaksFrom(buf, perSecond = 20) {
  const d = mono(buf);
  const size = Math.max(1, Math.floor(buf.sampleRate / perSecond));
  const out = [];
  for (let i = 0; i < d.length; i += size) {
    let m = 0;
    const end = Math.min(d.length, i + size);
    for (let j = i; j < end; j++) {
      const v = Math.abs(d[j]);
      if (v > m) m = v;
    }
    out.push(Math.round(Math.min(1, m) * 100));
  }
  return out;
}

/** Pauses quieter than `noiseDb` for at least `minSilence` seconds. */
export function silencesFrom(buf, { noiseDb = -35, minSilence = 0.6 } = {}) {
  const d = mono(buf);
  const win = Math.floor(buf.sampleRate * 0.05);
  const thr = Math.pow(10, noiseDb / 20);
  const res = [];
  let start = null;
  for (let i = 0; i < d.length; i += win) {
    let sum = 0;
    const end = Math.min(d.length, i + win);
    for (let j = i; j < end; j++) sum += d[j] * d[j];
    const quiet = Math.sqrt(sum / (end - i)) < thr;
    const t = i / buf.sampleRate;
    if (quiet && start == null) start = t;
    if (!quiet && start != null) {
      if (t - start >= minSilence) res.push({ start: +start.toFixed(2), end: +t.toFixed(2) });
      start = null;
    }
  }
  if (start != null && buf.duration - start >= minSilence) res.push({ start: +start.toFixed(2), end: +buf.duration.toFixed(2) });
  return res;
}

export async function thumbnailFrom(file, at) {
  const url = URL.createObjectURL(file);
  try {
    const v = await loadEl(url, 'video');
    await seek(v, at ?? Math.min(1, v.duration / 3));
    const w = 480;
    const h = Math.round((w * v.videoHeight) / v.videoWidth / 2) * 2;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    release(v);
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.78));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Measured pacing of a reference video by comparing sampled frames (no AI). */
export async function analyzeReference(file, info, buf, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const v = await loadEl(url, 'video');
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d', { willReadFrequently: true });
    const dur = v.duration;
    const step = dur > 120 ? 0.5 : 0.25;
    const cuts = [];
    let prev = null;
    for (let t = 0; t < dur; t += step) {
      await seek(v, t);
      g.drawImage(v, 0, 0, 32, 18);
      const px = g.getImageData(0, 0, 32, 18).data;
      const lum = new Float32Array(32 * 18);
      for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      if (prev) {
        let diff = 0;
        for (let i = 0; i < lum.length; i++) diff += Math.abs(lum[i] - prev[i]);
        if (diff / lum.length > 28 && t > 0.2) cuts.push(+t.toFixed(2));
      }
      prev = lum;
      onProgress?.(t / dur);
    }
    release(v);
    const bounds = [0, ...cuts, dur];
    const shots = [];
    for (let i = 1; i < bounds.length; i++) if (bounds[i] - bounds[i - 1] > 0.05) shots.push(+(bounds[i] - bounds[i - 1]).toFixed(2));
    const sorted = [...shots].sort((a, b) => a - b);
    let level = null;
    if (buf) {
      const d = mono(buf);
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] * d[i];
      level = +(20 * Math.log10(Math.sqrt(sum / (d.length / 4)) || 1e-9)).toFixed(1);
    }
    return {
      measured: true,
      duration: +dur.toFixed(2),
      aspect: info.width ? `${info.width}x${info.height}` : null,
      shotCount: shots.length,
      cutsPerMinute: dur ? +((cuts.length / dur) * 60).toFixed(1) : 0,
      avgShotSeconds: shots.length ? +(shots.reduce((a, b) => a + b, 0) / shots.length).toFixed(2) : +dur.toFixed(2),
      medianShotSeconds: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      cutsInFirst3s: cuts.filter((t) => t < 3).length,
      averageLevelDb: level,
      cutTimes: cuts.slice(0, 200),
      method: 'Sampled frames every ' + step + 's in the browser',
      notMeasured: ['title treatment', 'transition styles', 'music genre', 'shot framing'],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 16 kHz mono WAV for speech-to-text (≈ 32 KB per second). */
export async function speechWav(buf) {
  const rate = 16000;
  const len = Math.ceil(buf.duration * rate);
  const off = new OfflineAudioContext(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const r = await off.startRendering();
  const d = r.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + d.length * 2));
  const w = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + d.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 0x7fff, true);
  return new Blob([out], { type: 'audio/wav' });
}

/** Upload with progress straight to Supabase Storage (the API server never handles video bytes). */
export async function uploadToStorage(path, blob, onProgress, contentType) {
  if (blob.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`Files must be under ${MAX_UPLOAD_MB} MB on the current plan. Export a shorter or lower-resolution clip, or raise the Supabase storage limit.`);
  const token = await accessToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_KEY);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.setRequestHeader('content-type', contentType || blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(path);
      else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          msg = JSON.parse(xhr.responseText).message || msg;
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(blob);
  });
}

// Signed URLs for private files, cached until shortly before they expire.
const urlCache = new Map();
export async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter((p) => p && !(urlCache.get(p)?.exp > now + 60_000)))];
  if (need.length) {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(need, 3600);
    if (error) throw new Error(error.message);
    for (const d of data || []) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 3600_000 });
  }
  return Object.fromEntries(paths.filter(Boolean).map((p) => [p, urlCache.get(p)?.url]));
}

/**
 * Resolved URLs per asset: sample assets are static files, uploaded assets are signed Storage
 * URLs, and folder assets are object URLs of the file on this computer (null if the folder
 * isn't connected in this browser — then `missing` is true).
 */
export async function assetUrls(assets) {
  const paths = assets.flatMap((a) => [a.path, a.thumbPath, a.peaksPath]).filter(Boolean);
  const signed = paths.length ? await signedUrls(paths).catch(() => ({})) : {};
  const out = {};
  for (const a of assets) {
    const local = a.source === 'local' ? await localUrl(a) : null;
    out[a.id] = {
      file: a.source === 'local' ? local : a.url || signed[a.path],
      thumb: a.thumbUrl || signed[a.thumbPath],
      peaks: a.peaksUrl || signed[a.peaksPath],
      missing: a.source === 'local' && !local,
    };
  }
  return out;
}

/** The media bytes for rendering: the local File itself (no copy) or a downloaded Blob. */
export async function assetBlob(asset, urls) {
  if (asset.source === 'local') {
    const f = await getLocalFile(asset.folderId, asset.relPath);
    if (!f) throw new Error(`${asset.name} is in a folder that isn't connected in this browser. Reconnect it in the Media tab.`);
    return f;
  }
  const url = urls[asset.id]?.file;
  if (!url) throw new Error(`Could not open ${asset.name}.`);
  return (await fetch(url)).blob();
}
