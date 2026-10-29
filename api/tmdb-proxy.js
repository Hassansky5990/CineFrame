const ALLOWED_ROOTS = new Set([
  "movie", "tv", "search", "discover", "genre", "trending", "person",
  "collection", "company", "keyword", "configuration", "watch"
]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Support both current and legacy deployment variable names.
  const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "TMDB server key is not configured. Add TMDB_API_KEY (or TMDB_KEY) in the Vercel project environment variables, then redeploy."
    });
  }

  const rawPath = req.query?.path;
  const requestPath = Array.isArray(rawPath)
    ? rawPath.join("/")
    : typeof rawPath === "string"
      ? rawPath
      : "";
  const segments = requestPath.split("/").filter(Boolean);

  if (
    !segments.length ||
    !ALLOWED_ROOTS.has(segments[0]) ||
    segments.some(part => part === "." || part === ".." || !/^[a-zA-Z0-9_-]+$/.test(part))
  ) {
    return res.status(400).json({ error: "Invalid or unsupported TMDB path" });
  }

  const url = new URL(
    "https://api.themoviedb.org/3/" +
    segments.map(encodeURIComponent).join("/")
  );
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", "en-US");

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === "path" || key === "api_key") continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") url.searchParams.append(key, item);
    }
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });
    const body = await response.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=30");
    return res.status(response.status).send(body);
  } catch {
    return res.status(502).json({
      error: "Unable to connect to TMDB from the server. Check deployment network access and retry."
    });
  }
}
