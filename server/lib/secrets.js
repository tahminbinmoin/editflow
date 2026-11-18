// AES-256-GCM encryption for provider API keys. The key comes from EDITFLOW_SECRET, a
// server-only environment variable. Ciphertext is stored in Supabase; plaintext keys never
// reach the browser or the database.
import crypto from 'node:crypto';

let cached = null;
function key() {
  if (cached) return cached;
  const secret = process.env.EDITFLOW_SECRET;
  if (!secret) {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      throw Object.assign(new Error('The server is missing EDITFLOW_SECRET, so it cannot store API keys. Add it in your Vercel project settings.'), { status: 500 });
    }
    console.warn('[editflow] EDITFLOW_SECRET is not set — using an insecure development key.');
  }
  cached = crypto.createHash('sha256').update(secret || 'editflow-insecure-dev-secret').digest();
  return cached;
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(blob) {
  if (!blob) return null;
  const parts = blob.split('.');
  if (parts[0] !== 'v1' || parts.length !== 4) return null;
  const [, iv, tag, data] = parts.map((s, i) => (i ? Buffer.from(s, 'base64') : s));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export const mask = (k) => (k ? `••••${String(k).slice(-4)}` : '');
