import { Pool } from 'pg';
import crypto from 'node:crypto';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const nativeOrigins = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost', 'http://localhost:8100']);
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const passwordHash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!globalThis.__cineframePool) {
    globalThis.__cineframePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
  }
  return globalThis.__cineframePool;
}

async function ensureSchema(pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS cineframe_users (' +
    'id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS cineframe_sessions (' +
    'token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES cineframe_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL)'
  );
  await pool.query(
    'CREATE TABLE IF NOT EXISTS cineframe_libraries (' +
    'user_id BIGINT PRIMARY KEY REFERENCES cineframe_users(id) ON DELETE CASCADE, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
  );
  await pool.query('CREATE INDEX IF NOT EXISTS cineframe_sessions_expiry ON cineframe_sessions(expires_at)');
}

function addCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let sameHost = false;
  try { sameHost = new URL(origin).host === String(req.headers.host || ''); } catch {}
  const allow = sameHost || nativeOrigins.has(origin) || origin === process.env.APP_ORIGIN || origin === 'https://cineframe-web.vercel.app';
  if (!allow) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Vary', 'Origin');
  return true;
}
function cookies(req) {
  const out = Object.create(null);
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
  });
  return out;
}
function setCookie(res, token) {
  res.setHeader('Set-Cookie', 'sv=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=' + SESSION_TTL_SECONDS);
}
function clearCookie(res) {
  res.setHeader('Set-Cookie', 'sv=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0');
}
function cleanData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const result = {};
  for (const key of ['watch', 'plan', 'done', 'hist', 'cw', 'pos']) {
    if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
  }
  if (!Array.isArray(result.watch)) result.watch = [];
  if (!Array.isArray(result.plan)) result.plan = [];
  if (!Array.isArray(result.done)) result.done = [];
  if (!Array.isArray(result.hist)) result.hist = [];
  if (!result.cw || typeof result.cw !== 'object' || Array.isArray(result.cw)) result.cw = {};
  if (!result.pos || typeof result.pos !== 'object' || Array.isArray(result.pos)) result.pos = {};
  let serialised;
  try { serialised = JSON.stringify(result); } catch { return null; }
  if (!serialised || serialised.length > 500000) return null;
  try { return JSON.parse(serialised); } catch { return null; }
}
function sendError(res, status, error) {
  return res.status(status).json({ error });
}
async function findUser(pool, req) {
  const token = cookies(req).sv;
  if (!token || token.length > 256) return null;
  const result = await pool.query(
    'SELECT u.id, u.email FROM cineframe_sessions s JOIN cineframe_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > NOW()',
    [hashToken(token)]
  );
  return result.rows[0] || null;
}
async function createSession(pool, res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO cineframe_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW() + INTERVAL \'30 days\')', [hashToken(token), user.id]);
  setCookie(res, token);
  return { id: String(user.id), email: user.email };
}

export default async function handler(req, res) {
  if (!addCors(req, res)) return sendError(res, 403, 'Origin not allowed');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const pool = getPool();
  if (!pool) return sendError(res, 503, 'Account storage is not configured. Set DATABASE_URL to a persistent PostgreSQL database.');
  try {
    await ensureSchema(pool);
    const op = String((req.query && req.query.op) || '').toLowerCase();
    if (op === 'register') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'Method not allowed'); }
      const email = String(req.body && req.body.email || '').trim().toLowerCase();
      const password = String(req.body && req.body.password || '');
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) return sendError(res, 400, 'Enter a valid email address');
      if (password.length < 12 || password.length > 128) return sendError(res, 400, 'Password must be 12–128 characters');
      const salt = crypto.randomBytes(16).toString('hex');
      const digest = passwordHash(password, salt);
      let inserted;
      try {
        inserted = await pool.query('INSERT INTO cineframe_users (email,salt,password_hash) VALUES ($1,$2,$3) RETURNING id,email', [email, salt, digest]);
      } catch (error) {
        if (error && error.code === '23505') return sendError(res, 409, 'An account with that email already exists');
        throw error;
      }
      return res.status(200).json({ user: await createSession(pool, res, inserted.rows[0]) });
    }
    if (op === 'login') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'Method not allowed'); }
      const email = String(req.body && req.body.email || '').trim().toLowerCase();
      const password = String(req.body && req.body.password || '');
      if (email.length > 254 || password.length > 128) return sendError(res, 400, 'Invalid email or password');
      const result = await pool.query('SELECT id,email,salt,password_hash FROM cineframe_users WHERE email=$1', [email]);
      const user = result.rows[0];
      const actual = user ? Buffer.from(passwordHash(password, user.salt), 'hex') : Buffer.alloc(64);
      const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
      if (!user || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return sendError(res, 401, 'Email or password is incorrect');
      return res.status(200).json({ user: await createSession(pool, res, user) });
    }
    if (op === 'me') {
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'Method not allowed'); }
      return res.status(200).json({ user: await findUser(pool, req) });
    }
    if (op === 'logout') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'Method not allowed'); }
      const token = cookies(req).sv;
      if (token) await pool.query('DELETE FROM cineframe_sessions WHERE token_hash=$1', [hashToken(token)]);
      clearCookie(res);
      return res.status(200).json({ ok: true });
    }
    if (op === 'library') {
      const user = await findUser(pool, req);
      if (!user) return sendError(res, 401, 'Sign in to continue');
      if (req.method === 'GET') {
        const result = await pool.query('SELECT data FROM cineframe_libraries WHERE user_id=$1', [user.id]);
        return res.status(200).json({ data: result.rows[0] ? result.rows[0].data : null });
      }
      if (req.method === 'PUT') {
        const data = cleanData(req.body && req.body.data);
        if (!data) return sendError(res, 400, 'Invalid or oversized library data');
        await pool.query(
          'INSERT INTO cineframe_libraries (user_id,data,updated_at) VALUES ($1,$2::jsonb,NOW()) ' +
          'ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()',
          [user.id, JSON.stringify(data)]
        );
        return res.status(200).json({ ok: true, updatedAt: new Date().toISOString() });
      }
      res.setHeader('Allow', 'GET, PUT');
      return sendError(res, 405, 'Method not allowed');
    }
    if (op === 'delete-account') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'Method not allowed'); }
      const user = await findUser(pool, req);
      if (!user) return sendError(res, 401, 'Sign in to continue');
      const password = String(req.body && req.body.password || '');
      const result = await pool.query('SELECT salt,password_hash FROM cineframe_users WHERE id=$1', [user.id]);
      const row = result.rows[0];
      const actual = row ? Buffer.from(passwordHash(password, row.salt), 'hex') : Buffer.alloc(64);
      const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
      if (!row || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return sendError(res, 401, 'Password is incorrect');
      await pool.query('DELETE FROM cineframe_users WHERE id=$1', [user.id]);
      clearCookie(res);
      return res.status(200).json({ ok: true });
    }
    return sendError(res, 404, 'Account endpoint not found');
  } catch (error) {
    console.error('CineFrame account endpoint failed:', error && error.message ? error.message : 'unknown error');
    return sendError(res, 500, 'Account service error');
  }
}
