export default async function handler(req, res) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return res.status(503).json({ error: 'TMDB_API_KEY is not configured in Vercel Environment Variables.' });
  const segments = req.query.path;
  const path = Array.isArray(segments) ? segments.join('/') : String(segments || '');
  if (!path || path.includes('..')) return res.status(400).json({ error: 'Invalid TMDB path.' });
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [name, value] of Object.entries(req.query)) {
    if (name === 'path') continue;
    if (typeof value === 'string') url.searchParams.set(name, value);
    else if (Array.isArray(value)) value.forEach(v => url.searchParams.append(name, v));
  }
  url.searchParams.set('api_key', key);
  try {
    const upstream = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.send(body);
  } catch (error) {
    return res.status(502).json({ error: 'TMDB upstream request failed', detail: String(error?.message || error) });
  }
}
