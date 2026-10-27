
export default async function handler(req, res) {
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
