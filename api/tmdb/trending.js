export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "TMDB server key is not configured. Add TMDB_API_KEY in Vercel Project Settings > Environment Variables, then redeploy."
    });
  }

  try {
    const url = new URL("https://api.themoviedb.org/3/trending/all/week");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", "en-US");

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
