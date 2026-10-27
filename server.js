import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const TMDB_API_KEY = process.env.TMDB_API_KEY || '6c9d63d13035995f6127e4b5c3689cb4';
const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID || 'd5923b0b793596f293642e01c45235af';
// Keep OAuth secrets server-side only. MAL's public API commonly uses a client ID;
// this secret is reserved for OAuth flows if your registered app requires one.
const MAL_CLIENT_SECRET = process.env.MAL_CLIENT_SECRET || '4f6c200a4939b501ce32edcc5fbe26d1e021afddaf7c553629257f434d9cfcbf';

app.disable('x-powered-by');
// Never expose backend source, dependency manifests, or environment files via static hosting.
app.use((req, res, next) => {
  if (/\/(?:server\.js|package\.json|package-lock\.json|\.env(?:\..*)?)$/.test(req.path)) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname));
app.get('/api/tmdb/*', async (req, res) => {
  if (!TMDB_API_KEY) return res.status(503).json({ error: 'TMDB_API_KEY is missing from server .env' });
  try {
    const subpath = req.params[0] || '';
    const url = new URL(`https://api.themoviedb.org/3/${subpath}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') url.searchParams.set(key, value);
    }
    const upstream = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await upstream.text();
    res.status(upstream.status).type('application/json').send(body);
  } catch (err) {
    res.status(502).json({ error: 'TMDB request failed', detail: err.message });
  }
});

// Minimal server-side MAL search endpoint. MAL credentials are never sent to the browser.
app.get('/api/mal/search', async (req, res) => {
  if (!MAL_CLIENT_ID) return res.status(503).json({ error: 'MAL_CLIENT_ID is missing from server .env' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Provide a q search term' });
  try {
    const url = new URL('https://api.myanimelist.net/v2/anime');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '10');
    url.searchParams.set('fields', 'id,title,main_picture,mean,genres,media_type,num_episodes,start_date');
    const headers = { 'X-MAL-CLIENT-ID': MAL_CLIENT_ID, accept: 'application/json' };
    // Secret deliberately remains on server; only add it to a future OAuth flow when required.
    void MAL_CLIENT_SECRET;
    const upstream = await fetch(url, { headers });
    const body = await upstream.text();
    res.status(upstream.status).type('application/json').send(body);
  } catch (err) {
    res.status(502).json({ error: 'MAL request failed', detail: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, tmdbConfigured: Boolean(TMDB_API_KEY), malConfigured: Boolean(MAL_CLIENT_ID), malOAuthSecretConfigured: Boolean(MAL_CLIENT_SECRET) }));
app.listen(PORT, () => console.log(`CineFrame running at http://localhost:${PORT}`));
