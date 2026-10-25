'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
const E = process.env, PORT = +E.PORT || 3000, BASE = (E.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
if (!E.SESSION_SECRET || E.SESSION_SECRET.length < 32) { console.error('Set SESSION_SECRET (32+ characters) in .env'); process.exit(1); }
const KEY = crypto.createHash('sha256').update(E.SESSION_SECRET).digest(), SECURE = BASE.startsWith('https://');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* ---------- database + migrations ---------- */
const db = new DatabaseSync(E.DB_PATH || path.join(__dirname, 'streamvault.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
const MIGRATIONS = [`
 CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL, created INTEGER NOT NULL);
 CREATE TABLE sessions(id TEXT PRIMARY KEY, uid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, exp INTEGER NOT NULL, mal_state TEXT, mal_verifier TEXT);
 CREATE TABLE library(uid INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated INTEGER NOT NULL);
 CREATE TABLE mal(uid INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, access TEXT NOT NULL, refresh TEXT NOT NULL, exp INTEGER NOT NULL, name TEXT);`];
for (let v = db.prepare('PRAGMA user_version').get().user_version; v < MIGRATIONS.length; v++) { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version=${v + 1}`); }
const q = (sql, ...a) => db.prepare(sql).get(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
const sweep = () => run('DELETE FROM sessions WHERE exp<?', Date.now()); sweep(); setInterval(sweep, 36e5).unref();

/* ---------- crypto helpers ---------- */
const hashPw = pw => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const DUMMY = hashPw('dummy-password');
const checkPw = (pw, stored) => { const [s, h] = stored.split(':'); const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv), ct = Buffer.concat([c.update(t, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const dec = b => { const x = Buffer.from(b, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, x.subarray(0, 12)); d.setAuthTag(x.subarray(12, 28)); return Buffer.concat([d.update(x.subarray(28)), d.final()]).toString('utf8'); };

/* ---------- http helpers ---------- */
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
const send = (res, code, obj, h = {}) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...h }); res.end(b); };
const fail = (code, error) => Object.assign(new Error(error), { code, error });
const readBody = (req, max = 1.1e6) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > max) { no(fail(413, 'too_large')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c)) : {}); } catch { no(fail(400, 'bad_json')); } }); req.on('error', no); });
const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === n)?.[1];
const setSession = (res, id, age) => res.setHeader('Set-Cookie', `sv=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${SECURE ? '; Secure' : ''}`);
const session = req => { const id = cookie(req, 'sv'); if (!id) return null; const s = q('SELECT s.*,u.email FROM sessions s JOIN users u ON u.id=s.uid WHERE s.id=? AND s.exp>?', sha(id), Date.now()); return s ? { ...s, raw: id } : null; };
const need = req => { const s = session(req); if (!s) throw fail(401, 'login_required'); return s; };
const hits = new Map();
const limited = (k, max = 10, win = 9e5) => { const n = Date.now(), a = (hits.get(k) || []).filter(t => n - t < win); a.push(n); hits.set(k, a); return a.length > max; };
setInterval(() => hits.clear(), 36e5).unref();
const form = o => new URLSearchParams(o).toString();
const malOn = () => !!E.MAL_CLIENT_ID;

/* ---------- MyAnimeList ---------- */
async function malToken(uid) {
  const r = q('SELECT * FROM mal WHERE uid=?', uid); if (!r) throw fail(409, 'mal_not_connected');
  if (r.exp > Date.now() + 60000) return dec(r.access);
  const body = { client_id: E.MAL_CLIENT_ID, grant_type: 'refresh_token', refresh_token: dec(r.refresh) }; if (E.MAL_CLIENT_SECRET) body.client_secret = E.MAL_CLIENT_SECRET;
  const t = await fetch('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body), signal: AbortSignal.timeout(10000) }).catch(() => { throw fail(502, 'mal_unreachable'); });
  if (!t.ok) { if (t.status < 500) { run('DELETE FROM mal WHERE uid=?', uid); throw fail(401, 'mal_expired'); } throw fail(502, 'mal_unreachable'); }
  const j = await t.json(); run('UPDATE mal SET access=?,refresh=?,exp=? WHERE uid=?', enc(j.access_token), enc(j.refresh_token), Date.now() + j.expires_in * 1000, uid); return j.access_token;
}
async function malApi(uid, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + await malToken(uid) }, signal: AbortSignal.timeout(10000) }).catch(() => { throw fail(502, 'mal_unreachable'); });
  if (r.status === 401) { run('DELETE FROM mal WHERE uid=?', uid); throw fail(401, 'mal_expired'); }
  if (r.status === 429) throw fail(429, 'mal_rate_limited');
  if (!r.ok) throw fail(502, 'mal_error_' + r.status);
  return r.json();
}

/* ---------- TMDB proxy ---------- */
const tcache = new Map();
async function tmdb(url) {
  if (!E.TMDB_KEY) throw fail(501, 'tmdb_not_configured');
  const u = new URL('https://api.themoviedb.org/3' + url.pathname.slice('/api/tmdb'.length)), h = {};
  url.searchParams.forEach((v, k) => { if (k !== 'api_key') u.searchParams.set(k, v); });
  if (E.TMDB_KEY.length > 40) h.Authorization = 'Bearer ' + E.TMDB_KEY; else u.searchParams.set('api_key', E.TMDB_KEY);
  const ck = u.pathname + '?' + [...u.searchParams].filter(([k]) => k !== 'api_key').join('&'), hit = tcache.get(ck);
  if (hit && hit.exp > Date.now()) return hit;
  const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(10000) }).catch(() => { throw fail(502, 'tmdb_unreachable'); });
  const out = { status: r.status, body: await r.text(), exp: Date.now() + 3e5 };
  if (r.ok) { if (tcache.size > 500) tcache.clear(); tcache.set(ck, out); }
  return out;
}

/* ---------- playback provider ---------- */
async function resolve(u) {
  if (!E.PROVIDER_URL) throw fail(501, 'noprov');
  const v = { type: u.searchParams.get('type'), id: u.searchParams.get('id'), season: u.searchParams.get('season') || '', episode: u.searchParams.get('episode') || '' };
  if (!['movie', 'tv'].includes(v.type) || !/^\d+$/.test(v.id || '') || !/^\d*$/.test(v.season) || !/^\d*$/.test(v.episode)) throw fail(400, 'bad_params');
  const url = E.PROVIDER_URL.replace(/\{(type|id|season|episode)\}/g, (_, k) => encodeURIComponent(v[k])), h = { Accept: 'application/json' };
  if (E.PROVIDER_TOKEN) h.Authorization = 'Bearer ' + E.PROVIDER_TOKEN;
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(10000) }).catch(() => { throw fail(502, 'provider_unreachable'); });
  if (r.status === 404) throw fail(404, 'unavail'); if (!r.ok) throw fail(502, 'provider_error');
  const j = await r.json().catch(() => { throw fail(502, 'provider_bad_response'); });
  const ok = a => (Array.isArray(a) ? a : []).filter(x => x && /^https?:\/\//.test(x.url)).map(x => ({ url: x.url, type: x.type, label: x.label, lang: x.lang }));
  const sources = ok(j.sources); if (!sources.length) throw fail(404, 'unavail');
  return { sources, subtitles: ok(j.subtitles) };
}

/* ---------- routes ---------- */
const STATUSES = ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'];
const me = s => ({ user: { email: s.email }, mal: { available: malOn(), connected: !!q('SELECT 1 x FROM mal WHERE uid=?', s.uid), name: q('SELECT name FROM mal WHERE uid=?', s.uid)?.name || null }, provider: !!E.PROVIDER_URL });
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m !== 'GET' && req.headers.origin && req.headers.origin !== new URL(BASE).origin) throw fail(403, 'bad_origin');
  if (p === '/api/me' && m === 'GET') { const s = session(req); return send(res, 200, s ? me(s) : { user: null, registration: E.ALLOW_REGISTRATION !== 'false' }); }
  if (p === '/api/register' && m === 'POST') {
    if (E.ALLOW_REGISTRATION === 'false') throw fail(403, 'registration_closed');
    if (limited('r' + req.socket.remoteAddress, 20)) throw fail(429, 'too_many_attempts');
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (!/^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(email)) throw fail(400, 'bad_email');
    if (pw.length < 10 || pw.length > 200) throw fail(400, 'password_10_to_200_chars');
    let id; try { id = run('INSERT INTO users(email,pw,created) VALUES(?,?,?)', email, hashPw(pw), Date.now()).lastInsertRowid; } catch { throw fail(409, 'registration_failed'); }
    return startSession(res, Number(id), email);
  }
  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase(), k = 'l' + req.socket.remoteAddress + email;
    if (limited(k)) throw fail(429, 'too_many_attempts');
    const u = q('SELECT * FROM users WHERE email=?', email), good = checkPw(String(b.password || ''), u ? u.pw : DUMMY);
    if (!u || !good) throw fail(401, 'wrong_email_or_password');
    return startSession(res, u.id, email);
  }
  if (p === '/api/logout' && m === 'POST') { const s = session(req); if (s) run('DELETE FROM sessions WHERE id=?', sha(s.raw)); setSession(res, '', 0); return send(res, 200, { ok: true }); }
  const s = need(req);
  if (p === '/api/delete-account' && m === 'POST') { const b = await readBody(req), u = q('SELECT * FROM users WHERE id=?', s.uid); if (!checkPw(String(b.password || ''), u.pw)) throw fail(401, 'wrong_email_or_password'); run('DELETE FROM users WHERE id=?', s.uid); setSession(res, '', 0); return send(res, 200, { ok: true }); }
  if (p === '/api/library' && m === 'GET') { const r = q('SELECT data,updated FROM library WHERE uid=?', s.uid); return send(res, 200, r ? { data: JSON.parse(r.data), updated: r.updated } : { data: null, updated: 0 }); }
  if (p === '/api/library' && m === 'PUT') {
    const b = (await readBody(req)).data, arr = x => Array.isArray(x) ? x.slice(0, 2000) : [], obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
    if (!b || typeof b !== 'object') throw fail(400, 'bad_library');
    const data = JSON.stringify({ watch: arr(b.watch), plan: arr(b.plan), done: arr(b.done), hist: arr(b.hist).slice(0, 100), cw: obj(b.cw), pos: obj(b.pos) }), t = Date.now();
    run('INSERT INTO library(uid,data,updated) VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET data=excluded.data,updated=excluded.updated', s.uid, data, t);
    return send(res, 200, { updated: t });
  }
  if (p.startsWith('/api/tmdb/') && m === 'GET') {
    if (!/^\/api\/tmdb\/(trending|movie|tv|search|discover|genre|configuration)(\/|$)/.test(p) || p.includes('..')) throw fail(404, 'not_found');
    const r = await tmdb(url); res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...SEC }); return res.end(r.body);
  }
  if (p === '/api/resolve' && m === 'GET') return send(res, 200, await resolve(url));
  if (p.startsWith('/api/mal/')) {
    if (!malOn()) throw fail(501, 'mal_not_configured');
    if (p === '/api/mal/login' && m === 'GET') {
      const state = crypto.randomBytes(16).toString('hex'), ver = crypto.randomBytes(64).toString('base64url');
      run('UPDATE sessions SET mal_state=?,mal_verifier=? WHERE id=?', state, ver, sha(s.raw));
      res.writeHead(302, { Location: 'https://myanimelist.net/v1/oauth2/authorize?' + form({ response_type: 'code', client_id: E.MAL_CLIENT_ID, code_challenge: ver, code_challenge_method: 'plain', state, redirect_uri: BASE + '/api/mal/callback' }) }); return res.end();
    }
    if (p === '/api/mal/callback' && m === 'GET') {
      const row = q('SELECT mal_state,mal_verifier FROM sessions WHERE id=?', sha(s.raw)), code = url.searchParams.get('code');
      run('UPDATE sessions SET mal_state=NULL,mal_verifier=NULL WHERE id=?', sha(s.raw));
      const back = r => { res.writeHead(302, { Location: '/#/settings?mal=' + r }); res.end(); };
      if (url.searchParams.get('error') || !code || !row?.mal_state || url.searchParams.get('state') !== row.mal_state) return back('denied');
      const body = { client_id: E.MAL_CLIENT_ID, grant_type: 'authorization_code', code, code_verifier: row.mal_verifier, redirect_uri: BASE + '/api/mal/callback' }; if (E.MAL_CLIENT_SECRET) body.client_secret = E.MAL_CLIENT_SECRET;
      const t = await fetch('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body), signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!t?.ok) return back('failed');
      const j = await t.json();
      run('INSERT INTO mal(uid,access,refresh,exp) VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET access=excluded.access,refresh=excluded.refresh,exp=excluded.exp', s.uid, enc(j.access_token), enc(j.refresh_token), Date.now() + j.expires_in * 1000);
      try { const u = await malApi(s.uid, 'https://api.myanimelist.net/v2/users/@me'); run('UPDATE mal SET name=? WHERE uid=?', String(u.name || ''), s.uid); } catch {}
      return back('ok');
    }
    if (p === '/api/mal/list' && m === 'GET') {
      const st = url.searchParams.get('status') || '', off = url.searchParams.get('offset') || '0';
      if ((st && !STATUSES.includes(st)) || !/^\d{1,5}$/.test(off)) throw fail(400, 'bad_params');
      const j = await malApi(s.uid, 'https://api.myanimelist.net/v2/users/@me/animelist?' + form({ fields: 'list_status,num_episodes', limit: 100, offset: off, ...(st && { status: st }) }));
      return send(res, 200, j);
    }
    if (p === '/api/mal/update' && m === 'POST') {
      const b = await readBody(req), id = Number(b.id), f = {};
      if (!Number.isInteger(id) || id < 1) throw fail(400, 'bad_params');
      if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw fail(400, 'bad_status'); f.status = b.status; }
      if (b.num_watched_episodes !== undefined) { const n = Number(b.num_watched_episodes); if (!Number.isInteger(n) || n < 0 || n > 10000) throw fail(400, 'bad_episodes'); f.num_watched_episodes = n; }
      if (!Object.keys(f).length) throw fail(400, 'nothing_to_update');
      return send(res, 200, await malApi(s.uid, `https://api.myanimelist.net/v2/anime/${id}/my_list_status`, { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(f) }));
    }
    if (p === '/api/mal/disconnect' && m === 'POST') { run('DELETE FROM mal WHERE uid=?', s.uid); return send(res, 200, { ok: true }); }
  }
  throw fail(404, 'not_found');
}
function startSession(res, uid, email) {
  const id = crypto.randomBytes(32).toString('hex'), age = 30 * 86400;
  run('INSERT INTO sessions(id,uid,exp) VALUES(?,?,?)', sha(id), uid, Date.now() + age * 1000); setSession(res, id, age);
  send(res, 200, { user: { email } }, { 'Set-Cookie': res.getHeader('Set-Cookie') });
}

/* ---------- static files ---------- */
const PUB = path.join(__dirname, 'public'), MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serve(req, res, url) {
  let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, SEC); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC }); fs.createReadStream(f).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC); return res.end(); }
    serve(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e.code && e.error) return send(res, e.code, { error: e.error });
    console.error('Unhandled error:', e.message); send(res, 500, { error: 'server_error' });
  }
});
if (require.main === module) server.listen(PORT, () => console.log(`StreamVault server on ${BASE} (port ${PORT})`));
module.exports = server;
