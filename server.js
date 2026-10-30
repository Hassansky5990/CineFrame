import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));
const tmdbKey = process.env.TMDB_API_KEY;

app.disable("x-powered-by");
app.get("/api/tmdb/*", async (req, res) => {
  if (!tmdbKey) {
    return res.status(500).json({ error: "TMDB_API_KEY is missing. Add it to .env." });
  }

  const route = String(req.params[0] || "");
  if (!route || route.includes("..") || route.startsWith("/") || route.includes("\\") ||
      !/^[a-zA-Z0-9_./-]+$/.test(route)) {
    return res.status(400).json({ error: "Invalid TMDB endpoint path" });
  }

  const upstream = new URL("https://api.themoviedb.org/3/" +
    route.split("/").map(encodeURIComponent).join("/"));
  upstream.searchParams.set("api_key", tmdbKey);
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "api_key" || key === "path") continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === "string") upstream.searchParams.append(key, entry);
    }
  }

  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(12000) });
    const body = await response.text();
    res.status(response.status).type("application/json").send(body);
  } catch (error) {
    console.error("TMDB proxy error:", error.message);
    res.status(502).json({ error: "Unable to connect to TMDB" });
  }
});

app.use(express.static(root, { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(root, "index.html")));
app.listen(port, () => console.log(`CineFrame running at http://localhost:${port}`));
