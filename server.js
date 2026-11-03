import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedTmdbPath, isAllowedTmdbQueryKey } from './lib/tmdb-path.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');

app.get('/api/tmdb/*', async (req, res) => {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'TMDB_API_KEY is not configured. Add it to the server .env file.'
    });
  }

  const rawPath = String(req.params[0] || '');
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
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
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

app.use((_req, res) => {
  res.status(404).type('text').send('Not found');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`CineFrame is running at http://localhost:${port}`);
});
