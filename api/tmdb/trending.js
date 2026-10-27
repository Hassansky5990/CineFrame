
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "TMDB_API_KEY is missing"
    });
  }

  try {
    const url = new URL(
      "https://api.themoviedb.org/3/trending/all/week"
    );
    url.searchParams.set("api_key", apiKey);

    const response = await fetch(url);
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({
      error: "TMDB connection failed"
    });
  }
}
