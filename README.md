# CineFrame

Discover movies, series and anime. Powered by [TMDB](https://www.themoviedb.org/), deployed as a static app with serverless API functions on Vercel.

## Features

- Trending, popular movies, popular TV and top-rated shelves
- Title details with ratings, age certifications, trailers and recommendations
- TV episode browser with per-season search
- My List (watchlist) and Continue-watching history, stored locally in your browser
- Personalized "For You" row based on your watchlist and history

## Setup

1. Create a free API key at [themoviedb.org](https://www.themoviedb.org/settings/api).
2. Deploy to Vercel and set the environment variable `TMDB_API_KEY` (v3 key or v4 read token) in the project settings.
3. Open the site — the page talks to TMDB only through the `/api/tmdb/[...path]` serverless proxy, so the key never reaches the browser.

The optional `TMDB_API_KEY` constant at the top of the `<script>` in `index.html` is only for opening the page as a local file (no server). Leave it empty when the app is served by the proxy.

## Project structure

```
index.html            # the entire front-end (HTML + CSS + JS)
api/tmdb/[...path].js # serverless proxy to api.themoviedb.org (keeps the API key server-side)
api/health.js         # health-check endpoint
```
