'use strict';
require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb', strict: true }));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'cineframe.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(
  'CREATE TABLE IF NOT EXISTS users (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);' +
  'CREATE TABLE IF NOT EXISTS sessions (' +
  'token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);' +
  'CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);' +
  'CREATE TABLE IF NOT EXISTS libraries (' +
  'user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at INTEGER NOT NULL);'
);

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const nativeOrigins = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost', 'http://localhost:8100']);
const sameOrigin = origin => {
  if (!origin) return true;
  if (nativeOrigins.has(origin)) return true;
  if (process.env.APP_ORIGIN && origin === process.env.APP_ORIGIN) return true;
  return origin === 'https://' + (process.env.PUBLIC_HOST || '') ||
    origin === 'http://' + (process.env.PUBLIC_HOST || '');
};
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !sameOrigin(origin) && origin !== req.protocol + '://' + req.get('host')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (origin && (nativeOrigins.has(origin) || origin === process.env.APP_ORIGIN || origin === req.protocol + '://' + req.get('host'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

function parseCookies(req) {
  const out = Object.create(null);
  String(req.headers.cookie || '').split(';').forEach(part => {
    const at = part.indexOf('=');
    if (at < 0) return;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch {}
  });
  return out;
}
function setSessionCookie(res, token) {
  const production = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', 'sv=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=' + (production ? 'None; Secure' : 'Lax') + '; Max-Age=' + Math.floor(SESSION_TTL / 1000));
}
function clearSessionCookie(res) {
  const production = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', 'sv=; Path=/; HttpOnly; SameSite=' + (production ? 'None; Secure' : 'Lax') + '; Max-Age=0');
}
function userForRequest(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : parseCookies(req).sv;
  if (!token || token.length > 256) return null;
  const row = db.prepare('SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hashToken(token));
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    return null;
  }
  return { id: row.id, email: row.email };
}
function requireUser(req, res, next) {
  const user = userForRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to continue' });
  req.user = user;
  next();
}
function cleanLibrary(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const output = {};
  ['watch', 'plan', 'done', 'hist', 'cw', 'pos'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(data, key)) output[key] = data[key];
  });
  if (!Array.isArray(output.watch)) output.watch = [];
  if (!Array.isArray(output.plan)) output.plan = [];
  if (!Array.isArray(output.done)) output.done = [];
  if (!Array.isArray(output.hist)) output.hist = [];
  if (!output.cw || typeof output.cw !== 'object' || Array.isArray(output.cw)) output.cw = {};
  if (!output.pos || typeof output.pos !== 'object' || Array.isArray(output.pos)) output.pos = {};
  const text = JSON.stringify(output);
  if (text.length > 500000) return null;
  return JSON.parse(text);
}
function makePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, passwordHash };
}
function passwordMatches(password, salt, expected) {
  const actual = crypto.scryptSync(password, salt, 64);
  const wanted = Buffer.from(expected, 'hex');
  return wanted.length === actual.length && crypto.timingSafeEqual(actual, wanted);
}
function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hashToken(token), user.id, Date.now() + SESSION_TTL);
  setSessionCookie(res, token);
  return { user: { id: user.id, email: user.email }, sessionToken: token };
}

app.post('/api/register', (req, res) => {
  const email = String(req.body && req.body.email || '').trim().toLowerCase();
  const password = String(req.body && req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be 12–128 characters' });
  }
  const credentials = makePassword(password);
  try {
    const result = db.prepare('INSERT INTO users (email,salt,password_hash,created_at) VALUES (?,?,?,?)')
      .run(email, credentials.salt, credentials.passwordHash, Date.now());
    const session = createSession(res, { id: Number(result.lastInsertRowid), email });
    return res.status(200).json(session);
  } catch (error) {
    if (String(error && error.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'An account with that email already exists' });
    return res.status(500).json({ error: 'Unable to create account' });
  }
});
app.post('/api/login', (req, res) => {
  const email = String(req.body && req.body.email || '').trim().toLowerCase();
  const password = String(req.body && req.body.password || '');
  if (email.length > 254 || password.length > 128) return res.status(400).json({ error: 'Invalid email or password' });
  const row = db.prepare('SELECT id,email,salt,password_hash FROM users WHERE email=?').get(email);
  if (!row || !passwordMatches(password, row.salt, row.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect' });
  db.prepare('DELETE FROM sessions WHERE user_id=? AND expires_at<=?').run(row.id, Date.now());
  return res.status(200).json(createSession(res, row));
});
app.get('/api/me', (req, res) => res.json({ user: userForRequest(req) }));
app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).sv;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.get('/api/library', requireUser, (req, res) => {
  const row = db.prepare('SELECT data FROM libraries WHERE user_id=?').get(req.user.id);
  res.json({ data: row ? JSON.parse(row.data) : null });
});
app.put('/api/library', requireUser, (req, res) => {
  const data = cleanLibrary(req.body && req.body.data);
  if (!data) return res.status(400).json({ error: 'Invalid or oversized library data' });
  db.prepare('INSERT INTO libraries (user_id,data,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
    .run(req.user.id, JSON.stringify(data), Date.now());
  res.json({ ok: true, updatedAt: Date.now() });
});
app.post('/api/delete-account', requireUser, (req, res) => {
  const password = String(req.body && req.body.password || '');
  const row = db.prepare('SELECT salt,password_hash FROM users WHERE id=?').get(req.user.id);
  if (!row || !passwordMatches(password, row.salt, row.password_hash)) return res.status(401).json({ error: 'Password is incorrect' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

const allowedTmdb = new Set(['movie', 'tv', 'search', 'discover', 'genre', 'trending', 'person', 'collection', 'company', 'keyword', 'configuration', 'watch']);
app.get('/api/tmdb/*', requireUser, async (req, res) => {
  const apiKey = process.env.TMDB_KEY || process.env.TMDB_API_KEY;
  const rawPath = String(req.params[0] || '');
  const pieces = rawPath.split('/').filter(Boolean);
  if (!pieces.length || pieces.some(piece => piece === '..' || piece === '.' || /[^a-zA-Z0-9_-]/.test(piece)) || !allowedTmdb.has(pieces[0])) {
    return res.status(404).json({ error: 'TMDB endpoint not allowed' });
  }
  if (!apiKey) return res.status(501).json({ error: 'TMDB_KEY is not configured on the server' });
  const url = new URL('https://api.themoviedb.org/3/' + pieces.map(encodeURIComponent).join('/'));
  url.searchParams.set('api_key', apiKey);
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'api_key') return;
    (Array.isArray(value) ? value : [value]).forEach(item => {
      if (typeof item === 'string') url.searchParams.append(key, item);
    });
  });
  try {
    const upstream = await fetch(url.toString());
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=30');
    res.status(upstream.status).send(body);
  } catch {
    res.status(502).json({ error: 'Unable to connect to TMDB' });
  }
});
app.get('/api/mal/list', requireUser, (req, res) => {
  if (!process.env.MAL_CLIENT_ID) return res.status(501).json({ error: 'MAL_CLIENT_ID is not configured' });
  return res.status(501).json({ error: 'MAL list integration is not configured yet' });
});
app.get('/api/resolve', requireUser, async (req, res) => {
  const type = String(req.query.type || '');
  const id = String(req.query.id || '');
  const season = String(req.query.season || '1');
  const episode = String(req.query.episode || '1');
  if (!['movie', 'tv'].includes(type) || !/^\d{1,12}$/.test(id) || !/^\d{1,4}$/.test(season) || !/^\d{1,4}$/.test(episode)) {
    return res.status(400).json({ error: 'Invalid media parameters' });
  }
  const template = process.env.PROVIDER_URL;
  if (!template) return res.status(501).json({ error: 'PROVIDER_URL is not configured' });
  const target = template.replaceAll('{type}', encodeURIComponent(type))
    .replaceAll('{id}', encodeURIComponent(id))
    .replaceAll('{season}', encodeURIComponent(season))
    .replaceAll('{episode}', encodeURIComponent(episode));
  let upstream;
  try {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol)) return res.status(400).json({ error: 'Invalid provider URL' });
    upstream = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    return res.status(502).json({ error: 'Unable to contact provider' });
  }
  if (upstream.status === 404) return res.status(404).json({ error: 'unavail' });
  if (!upstream.ok) return res.status(502).json({ error: 'Provider request failed' });
  let payload;
  try { payload = await upstream.json(); } catch { return res.status(502).json({ error: 'Invalid provider response' }); }
  const safeUrl = value => {
    try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
  };
  const sources = (Array.isArray(payload.sources) ? payload.sources : []).map(source => ({
    url: safeUrl(source && source.url), label: String(source && source.label || 'Auto').slice(0, 40)
  })).filter(source => source.url);
  const subtitles = (Array.isArray(payload.subtitles) ? payload.subtitles : []).map(subtitle => ({
    url: safeUrl(subtitle && subtitle.url), lang: String(subtitle && (subtitle.lang || subtitle.label) || 'Unknown').slice(0, 32)
  })).filter(subtitle => subtitle.url);
  res.json({ sources, subtitles });
});

app.use((req, res, next) => {
  const pathname = String(req.path || '').toLowerCase();
  if (pathname.includes('..') || pathname.includes('%2f') || pathname.includes('%5c') ||
      /^\/(server\.cjs|package\.json|test\.js|\.env(?:\.|$))/.test(pathname)) {
    return res.status(404).end();
  }
  next();
});
const root = path.join(__dirname, 'www');
app.use(express.static(fs.existsSync(root) ? root : __dirname, { extensions: ['html'] }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || path.extname(req.path)) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
module.exports = server;
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log('CineFrame server listening on port ' + port));
}
