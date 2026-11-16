export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.TMDB_API_KEY?.trim();

  if (!apiKey) {
    return res.status(503).json({
      error: "TMDB_API_KEY is not configured"
    });
  }

  const url = new URL(
    "https://api.themoviedb.org/3/trending/all/week"
  );
  url.searchParams.set("api_key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    const body = await response.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", response.ok ? "public, s-maxage=60, stale-while-revalidate=300" : "no-store");
    return res.status(response.status).send(body);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "TMDB request timed out." : "TMDB connection failed"
    });
  } finally {
    clearTimeout(timeout);
  }
}
