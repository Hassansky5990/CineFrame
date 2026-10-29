
function addNativeCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let sameHost = false;
  try { sameHost = new URL(origin).host === String(req.headers.host || ''); } catch {}
  const native = ['capacitor://localhost', 'https://localhost', 'http://localhost', 'http://localhost:8100'].includes(origin);
  const allowed = sameHost || native || origin === process.env.APP_ORIGIN || origin === 'https://cineframe-web.vercel.app';
  if (!allowed) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Vary', 'Origin');
  return true;
}

export default async function handler(req, res) {
  if (!addNativeCors(req, res)) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "TMDB_API_KEY is missing from Vercel environment variables"
    });
  }

  const route = req.query.path;
  const path = Array.isArray(route)
    ? route.join("/")
    : typeof route === "string"
      ? route
      : "";

  if (!path) {
    return res.status(400).json({ error: "Missing TMDB endpoint path" });
  }

  const url = new URL(
    `https://api.themoviedb.org/3/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`
  );

  url.searchParams.set("api_key", apiKey);

  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path" || key === "api_key") continue;

    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") {
        url.searchParams.append(key, item);
      }
    }
  }

  try {
    const response = await fetch(url.toString());
    const body = await response.text();

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");

    return res.status(response.status).send(body);
  } catch {
    return res.status(502).json({
      error: "Unable to connect to TMDB"
    });
  }
}
