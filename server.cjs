'use strict';

require('dotenv').config();
const express = require('express');
const path = require('node:path');

const app = express();
app.disable('x-powered-by');

const WEB_ROOT = path.join(__dirname, 'www');
const TMDB_ROOTS = new Set([
  'movie', 'tv', 'search', 'discover', 'genre', 'trending', 'person',
  'collection', 'company', 'keyword', 'configuration', 'watch'
]);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'cineframe' }));

// Supabase anon keys are intentionally public. Enforce access to each user's
// stored library with Supabase Auth + row-level security policies.
app.get('/api/app-config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

app.get('/api/tmdb/*', async (req, res) => {
  const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_KEY;
  if (!apiKey) return res.status(501).json({ error: 'TMDB_API_KEY is not configured in the server environment.' });

  const rawPath = String(req.params[0] || '');
  const segments = rawPath.split('/').filter(Boolean);
  if (!segments.length || !TMDB_ROOTS.has(segments[0]) ||
      segments.some(part => part === '.' || part === '..' || !/^[a-zA-Z0-9_-]+$/.test(part))) {
    return res.status(404).json({ error: 'TMDB endpoint not allowed.' });
  }

  const url = new URL('https://api.themoviedb.org/3/' + segments.map(encodeURIComponent).join('/'));
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'en-US');
  for (const [key, raw] of Object.entries(req.query || {})) {
    if (key === 'api_key') continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value === 'string') url.searchParams.append(key, value);
    }
  }

  try {
    const upstream = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.send(body);
  } catch {
    return res.status(502).json({ error: 'Unable to reach TMDB. Check the server network and try again.' });
  }
});

app.use(express.static(WEB_ROOT, { dotfiles: 'ignore', index: false, fallthrough: true }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || path.extname(req.path)) return res.status(404).end();
  return res.sendFile(path.join(WEB_ROOT, 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log('CineFrame local server listening on port ' + port));
