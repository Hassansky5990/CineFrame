import { isAllowedTmdbPath, isAllowedTmdbQueryKey } from '../../lib/tmdb-path.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'TMDB_API_KEY is not configured' });
  }

  const rawPath = req.query.path;
  const path = Array.isArray(rawPath)
    ? rawPath.join('/')
    : typeof rawPath === 'string'
      ? rawPath
      : '';

  if (!isAllowedTmdbPath(path)) {
    return res.status(400).json({ error: 'TMDB endpoint is not available through CineFrame.' });
  }

  const url = new URL(
    path.split('/').map(encodeURIComponent).join('/'),
    'https://api.themoviedb.org/3/'
  );
  url.searchParams.set('api_key', apiKey);

  for (const [key, value] of Object.entries(req.query)) {
    if (!isAllowedTmdbQueryKey(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string' || typeof item === 'number') {
        url.searchParams.append(key, String(item));
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const body = await response.text();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', response.ok ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store');
    return res.status(response.status).send(body);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'TMDB request timed out.' : 'Unable to connect to TMDB.'
    });
  } finally {
    clearTimeout(timeout);
  }
}
