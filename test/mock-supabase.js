// TEST FIXTURE ONLY — a small in-memory stand-in for the parts of Supabase that Editflow uses
// (Auth, PostgREST tables with per-user row filtering, Storage), so the whole app can be
// exercised in a browser without a network connection. Row-level security on the real
// project is verified separately in SQL (see supabase/migrations).
// Run: node test/mock-supabase.js   → http://localhost:54321
import http from 'node:http';
import crypto from 'node:crypto';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function startMockSupabase(port = Number(process.env.MOCK_SUPABASE_PORT || 54321)) {
  const users = new Map(); // id → {id,email,password,is_anonymous}
  const tokens = new Map(); // access token → user id
  const refresh = new Map(); // refresh token → user id
  const tables = { projects: [], project_history: [], provider_settings: [], ai_log: [], usage_events: [], subscriptions: [], admins: [], admin_invites: [], edit_styles: [], training_examples: [] };
  // Admin invite codes (supabase/migrations/0002): one test code is seeded.
  const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
  tables.admin_invites.push({ id: crypto.randomUUID(), code_hash: sha(process.env.MOCK_ADMIN_CODE || 'TEST-ADMIN-CODE'), used_by: null, expires_at: new Date(Date.now() + 864e5).toISOString() });
  const isAdmin = (u) => tables.admins.some((a) => a.user_id === u.id);
  // Row-level security per table (mirrors the SQL policies). Default: own rows (user_id).
  const POLICY = {
    edit_styles: { read: (u, r) => r.published || isAdmin(u), write: (u) => isAdmin(u), owner: 'created_by' },
    training_examples: { read: (u) => isAdmin(u), write: (u) => isAdmin(u), owner: 'created_by' },
    admins: { read: (u, r) => r.user_id === u.id || isAdmin(u), write: () => false },
    admin_invites: { read: () => false, write: () => false },
    subscriptions: { read: (u, r) => r.user_id === u.id, write: () => false },
  };
  const files = new Map(); // "bucket/path" → {buf, type}
  const signed = new Map(); // token → key

  const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email || '', is_anonymous: !!u.is_anonymous, app_metadata: { provider: u.is_anonymous ? 'anonymous' : 'email' }, user_metadata: u.meta || {}, created_at: u.created_at });
  const session = (u) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: u.id, role: 'authenticated', exp, email: u.email, is_anonymous: !!u.is_anonymous, aud: 'authenticated' })}.${crypto.randomBytes(16).toString('base64url')}`;
    const rt = crypto.randomBytes(16).toString('hex');
    tokens.set(access, u.id);
    refresh.set(rt, u.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user: userJson(u) };
  };
  const who = (req) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    return tokens.has(t) ? users.get(tokens.get(t)) : null;
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readRaw = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

  // ----- PostgREST subset -----
  function applyFilters(rows, params) {
    let out = rows;
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      const m = v.match(/^(eq|neq|gte|lte|gt|lt|in)\.(.*)$/);
      if (!m) continue;
      const [, op, val] = m;
      out = out.filter((r) => {
        const x = r[k];
        if (op === 'eq') return String(x) === val;
        if (op === 'neq') return String(x) !== val;
        if (op === 'gte') return String(x) >= val;
        if (op === 'lte') return String(x) <= val;
        if (op === 'gt') return String(x) > val;
        if (op === 'lt') return String(x) < val;
        if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x));
        return true;
      });
    }
    const order = params.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (params.get('limit')) out = out.slice(0, Number(params.get('limit')));
    return out;
  }
  const project = (row, select) => {
    if (!select || select === '*') return row;
    const cols = select.split(',').map((s) => s.trim());
    return Object.fromEntries(cols.map((c) => [c, row[c]]));
  };
  const defaults = {
    projects: (u) => ({ id: crypto.randomUUID(), user_id: u.id, name: 'Untitled video', status: 'setup', is_sample: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    project_history: (u) => ({ id: crypto.randomUUID(), user_id: u.id, label: '', source: 'user', created_at: new Date().toISOString() }),
    provider_settings: (u) => ({ user_id: u.id, config: {}, secret: null, updated_at: new Date().toISOString() }),
    ai_log: (u) => ({ id: Math.floor(Math.random() * 1e9), user_id: u.id, created_at: new Date().toISOString() }),
    usage_events: (u) => ({ id: Math.floor(Math.random() * 1e9), user_id: u.id, amount: 1, created_at: new Date().toISOString() }),
    edit_styles: (u) => ({ id: crypto.randomUUID(), created_by: u.id, version: 1, published: false, rules: [], examples: [], pacing: {}, created_at: new Date().toISOString() }),
    training_examples: (u) => ({ id: crypto.randomUUID(), created_by: u.id, data: {}, created_at: new Date().toISOString() }),
  };

  // ----- RPC (security-definer functions in the real schema) -----
  async function rpc(req, res, fn) {
    const u = who(req);
    if (!u) return send(res, 401, { message: 'JWT required' });
    const body = JSON.parse((await readRaw(req)).toString() || '{}');
    if (fn === 'is_admin') return send(res, 200, isAdmin(u));
    if (fn === 'claim_admin') {
      if (u.is_anonymous) return send(res, 400, { message: 'Guest accounts cannot become admins.', code: 'P0001' });
      const inv = tables.admin_invites.find((i) => i.code_hash === sha(String(body.code || '').trim().toUpperCase()) && !i.used_by && i.expires_at > new Date().toISOString());
      if (!inv) return send(res, 400, { message: 'That invite code is not valid, expired or already used.', code: 'P0001' });
      if (!isAdmin(u)) tables.admins.push({ user_id: u.id, created_at: new Date().toISOString() });
      inv.used_by = u.id;
      return send(res, 200, true);
    }
    if (!isAdmin(u)) return send(res, 403, { message: 'Admins only', code: '42501' });
    if (fn === 'create_admin_invite') {
      const code = crypto.randomBytes(6).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
      tables.admin_invites.push({ id: crypto.randomUUID(), code_hash: sha(code), used_by: null, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
      return send(res, 200, code);
    }
    if (fn === 'admin_stats') return send(res, 200, { users: users.size, projects: tables.projects.length, exported: tables.projects.filter((p) => p.status === 'exported').length, ai_requests_30d: tables.ai_log.length, signups_7d: users.size, admins: tables.admins.length });
    send(res, 404, { message: 'no function' });
  }

  async function rest(req, res, url, table) {
    const u = who(req);
    if (!u) return send(res, 401, { message: 'JWT required' });
    if (!tables[table]) return send(res, 404, { message: 'no table' });
    const pol = POLICY[table];
    const own = tables[table].filter((r) => (pol ? pol.read(u, r) : r.user_id === u.id)); // row-level security
    const params = url.searchParams;
    const wantsObject = /vnd\.pgrst\.object/.test(req.headers.accept || '');
    const prefer = req.headers.prefer || '';
    const reply = (rows) => {
      const shaped = rows.map((r) => project(r, params.get('select')));
      if (wantsObject) return shaped.length === 1 ? send(res, 200, shaped[0]) : send(res, 406, { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' });
      if (req.method !== 'GET' && !/return=representation/.test(prefer)) return send(res, 201, undefined);
      send(res, 200, shaped);
    };
    if (req.method === 'GET') return reply(applyFilters(own, params));
    const body = req.method === 'DELETE' ? null : JSON.parse((await readRaw(req)).toString() || 'null');
    if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const out = [];
      for (const item of list) {
        if (pol) {
          if (!pol.write(u, item)) return send(res, 403, { message: 'new row violates row-level security policy' });
          const row = { ...defaults[table](u), ...item };
          tables[table].push(row);
          out.push(row);
          continue;
        }
        if (item.user_id && item.user_id !== u.id) return send(res, 403, { message: 'new row violates row-level security policy' });
        if (table === 'project_history' && !tables.projects.some((p) => p.id === item.project_id && p.user_id === u.id)) return send(res, 403, { message: 'row-level security' });
        const conflict = params.get('on_conflict');
        if (/merge-duplicates/.test(prefer) && conflict) {
          const keys = conflict.split(',');
          const existing = tables[table].find((r) => keys.every((k) => String(r[k]) === String(item[k] ?? (k === 'user_id' ? u.id : undefined))));
          if (existing) {
            Object.assign(existing, item, { updated_at: new Date().toISOString() });
            out.push(existing);
            continue;
          }
        }
        const row = { ...defaults[table](u), ...item, user_id: u.id };
        tables[table].push(row);
        out.push(row);
      }
      return reply(out);
    }
    const hits = applyFilters(own, params);
    if (pol && !pol.write(u, {})) return send(res, 403, { message: 'row-level security' });
    if (req.method === 'PATCH') {
      for (const r of hits) Object.assign(r, body, pol ? { updated_at: new Date().toISOString() } : { user_id: u.id, updated_at: new Date().toISOString() });
      return reply(hits);
    }
    if (req.method === 'DELETE') {
      tables[table] = tables[table].filter((r) => !hits.includes(r));
      if (table === 'projects') tables.project_history = tables.project_history.filter((h) => !hits.some((p) => p.id === h.project_id));
      return reply(hits);
    }
    send(res, 405, { message: 'method' });
  }

  // ----- Storage subset -----
  async function storage(req, res, url) {
    const p = decodeURIComponent(url.pathname.replace('/storage/v1/', ''));
    const signedMatch = p.match(/^object\/sign\/([^/]+)\/(.+)$/);
    if (req.method === 'GET' && signedMatch && url.searchParams.get('token')) {
      const key = signed.get(url.searchParams.get('token'));
      const f = key && files.get(key);
      if (!f) return send(res, 404, { message: 'Object not found' });
      return serveFile(req, res, f);
    }
    const u = who(req);
    if (!u) return send(res, 401, { message: 'unauthorized' });
    const ownPath = (path) => path.split('/')[0] === u.id;
    if (req.method === 'POST' && /^object\/sign\/[^/]+$/.test(p)) {
      const bucket = p.split('/')[2];
      const body = JSON.parse((await readRaw(req)).toString());
      return send(
        res,
        200,
        body.paths.map((path) => {
          if (!ownPath(path) || !files.has(`${bucket}/${path}`)) return { path, error: 'Object not found', signedURL: null };
          const t = crypto.randomBytes(12).toString('hex');
          signed.set(t, `${bucket}/${path}`);
          return { path, error: null, signedURL: `/object/sign/${bucket}/${path}?token=${t}` };
        }),
      );
    }
    if (req.method === 'POST' && /^object\/list\/[^/]+$/.test(p)) {
      const bucket = p.split('/')[2];
      const { prefix = '' } = JSON.parse((await readRaw(req)).toString());
      if (!ownPath(prefix)) return send(res, 200, []);
      const names = new Map();
      for (const key of files.keys()) {
        if (!key.startsWith(`${bucket}/${prefix}/`)) continue;
        const rest = key.slice(bucket.length + prefix.length + 2);
        const [first, ...more] = rest.split('/');
        names.set(first, more.length ? { name: first, id: null, metadata: null } : { name: first, id: crypto.randomUUID(), metadata: { size: files.get(key).buf.length } });
      }
      return send(res, 200, [...names.values()]);
    }
    if (req.method === 'DELETE' && /^object\/[^/]+$/.test(p)) {
      const bucket = p.split('/')[1];
      const { prefixes } = JSON.parse((await readRaw(req)).toString());
      for (const path of prefixes) if (ownPath(path)) files.delete(`${bucket}/${path}`);
      return send(res, 200, prefixes.map((name) => ({ name })));
    }
    const obj = p.match(/^object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
    if (obj) {
      const [, bucket, path] = obj;
      if (!ownPath(path)) return send(res, 403, { message: 'new row violates row-level security policy', statusCode: '403' });
      if (req.method === 'POST' || req.method === 'PUT') {
        const buf = await readRaw(req);
        if (buf.length > 50 * 1024 * 1024) return send(res, 413, { message: 'The object exceeded the maximum allowed size' });
        files.set(`${bucket}/${path}`, { buf, type: req.headers['content-type'] || 'application/octet-stream' });
        return send(res, 200, { Key: `${bucket}/${path}` });
      }
      if (req.method === 'GET') {
        const f = files.get(`${bucket}/${path}`);
        return f ? serveFile(req, res, f) : send(res, 404, { message: 'Object not found' });
      }
    }
    send(res, 404, { message: 'not found' });
  }

  function serveFile(req, res, f) {
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = Number(range[1] || 0);
      const end = range[2] ? Number(range[2]) : f.buf.length - 1;
      res.writeHead(206, { 'content-type': f.type, 'content-range': `bytes ${start}-${end}/${f.buf.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      return res.end(f.buf.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': f.type, 'accept-ranges': 'bytes', 'content-length': f.buf.length });
    res.end(f.buf);
  }

  // ----- Auth subset -----
  async function auth(req, res, url) {
    const p = url.pathname.replace('/auth/v1', '');
    if (p === '/health') return send(res, 200, { ok: true });
    if (p === '/signup' && req.method === 'POST') {
      const body = JSON.parse((await readRaw(req)).toString() || '{}');
      if (!body.email) {
        const u = { id: crypto.randomUUID(), is_anonymous: true, created_at: new Date().toISOString() };
        users.set(u.id, u);
        return send(res, 200, session(u));
      }
      if ([...users.values()].some((x) => x.email === body.email)) return send(res, 422, { msg: 'User already registered', error_code: 'user_already_exists' });
      const u = { id: crypto.randomUUID(), email: body.email, password: body.password, meta: body.data, created_at: new Date().toISOString() };
      users.set(u.id, u);
      return send(res, 200, session(u));
    }
    if (p === '/token') {
      const body = JSON.parse((await readRaw(req)).toString() || '{}');
      if (url.searchParams.get('grant_type') === 'password') {
        const u = [...users.values()].find((x) => x.email === body.email && x.password === body.password);
        return u ? send(res, 200, session(u)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', error_code: 'invalid_credentials' });
      }
      const id = refresh.get(body.refresh_token);
      return id ? send(res, 200, session(users.get(id))) : send(res, 400, { error: 'invalid_grant', msg: 'Invalid Refresh Token' });
    }
    if (p === '/user') {
      const u = who(req);
      if (!u) return send(res, 401, { msg: 'invalid JWT', error_code: 'bad_jwt' });
      if (req.method === 'PUT') {
        const body = JSON.parse((await readRaw(req)).toString() || '{}');
        if (body.email) (u.email = body.email), (u.is_anonymous = false);
        if (body.password) u.password = body.password;
      }
      return send(res, 200, userJson(u));
    }
    if (p === '/logout') {
      tokens.delete((req.headers.authorization || '').replace(/^Bearer /, ''));
      return send(res, 204);
    }
    send(res, 404, { msg: 'not found' });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('access-control-expose-headers', 'content-range, content-length, x-routed-via');
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/auth/v1')) return await auth(req, res, url);
      if (url.pathname.startsWith('/rest/v1/rpc/')) return await rpc(req, res, url.pathname.split('/')[4]);
      if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url, url.pathname.split('/')[3]);
      if (url.pathname.startsWith('/storage/v1/')) return await storage(req, res, url);
      send(res, 404, { message: 'not found' });
    } catch (e) {
      send(res, 500, { message: e.message });
    }
  });
  server.listen(port);
  server.state = { users, tables, files };
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMockSupabase();
  console.log('Mock Supabase on http://localhost:54321 — test fixture only');
}
