import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedTmdbPath, isAllowedTmdbQueryKey } from './lib/tmdb-path.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

app.get(['/api/tmdb/*', '/api/tmdb-proxy'], async (req, res) => {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'TMDB_API_KEY is not configured. Add it to the server .env file.'
    });
  }

  // Two accepted transports: the original /api/tmdb/<path> segments and the
  // flat /api/tmdb-proxy?path=<path> used by the deployed Vercel function.
  const rawPath = (Array.isArray(req.query.path)
    ? req.query.path.join('/')
    : String(req.query.path || req.params[0] || '')).replace(/^\/+/, '');
  if (!isAllowedTmdbPath(rawPath)) {
    return res.status(400).json({ error: 'TMDB endpoint is not available through CineFrame.' });
  }

  const upstream = new URL(
    rawPath.split('/').map(encodeURIComponent).join('/'),
    'https://api.themoviedb.org/3/'
  );
  upstream.searchParams.set('api_key', apiKey);

  for (const [key, rawValue] of Object.entries(req.query)) {
    if (!isAllowedTmdbQueryKey(key)) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (typeof value === 'string' || typeof value === 'number') {
        upstream.searchParams.append(key, String(value));
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(upstream, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const body = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', response.ok ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store');
    return res.send(body);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'TMDB request timed out.' : 'Unable to connect to TMDB.'
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(root, 'index.html'));
});

// PWA assets and the watchdog status file the client fetches same-origin.
app.use(express.static(root, { index: false, fallthrough: true, dotfiles: 'deny' }));

app.use((_req, res) => {
  res.status(404).type('text').send('Not found');
});

// A rejected promise in any route lands here instead of hanging the request
// or killing the process (Express 4 does not forward async rejections).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`CineFrame is running at http://localhost:${port}`);
});
