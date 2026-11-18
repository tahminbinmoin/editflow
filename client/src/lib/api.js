import { accessToken } from './supabase.js';

export class ApiError extends Error {
  constructor(message, { status, code, provider } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.provider = provider;
  }
}

/** Calls the Editflow API (Vercel function) with the user's Supabase session. */
export async function api(path, { method = 'GET', body } = {}) {
  const token = await accessToken();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the Editflow API. Check your connection.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, { status: res.status, code: data?.code, provider: data?.provider });
  return data;
}
