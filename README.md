# CineFrame

**Browse and watch movies and TV shows right in your browser — no install, no account required.**

▶ **Open it here: [cineframe-web.vercel.app](https://cineframe-web.vercel.app)**

CineFrame is a fast, clean way to watch anything from TMDB's huge catalog — trending titles, movies, shows and anime, instant search, your own watchlist. Pick something, press play, and the built-in multi-server player does the work of finding a stream that actually plays on your connection.

## What you get

- **A player that doesn't give up** — streams come from several public embed servers. If one is dead or slow on your network, CineFrame notices and automatically fails over to the next one instead of leaving you staring at a black screen.
- **Continue watching** — your place is remembered per episode, and resume prefers servers that can skip ahead, so you don't get dumped back at 0:00.
- **Your list, optionally in the cloud** — sign in with an email account and your watchlist and history follow you between devices. Everything also works fine without ever signing in.
- **Installable app** — it's a PWA: on Android, use the install prompt or "Add to Home Screen" and CineFrame runs full-screen like a native app, with an offline banner when your connection drops.
- **Network diagnostics** — one tap in the player (footer → Diagnostics) shows every stream server with its live response time on *your* network, so you always know which servers work where you are.
- **Quality-of-life touches** — Android back button closes menus instead of leaving the app, haptic feedback, a Data Saver toggle for metered connections, instant search, dark UI that's easy at night.

## How watching works

1. Open [cineframe-web.vercel.app](https://cineframe-web.vercel.app)
2. Browse the shelves or search for a title
3. Press **Play** — the player picks the healthiest server automatically
4. If a server misbehaves, it fails over on its own; you can also pick one manually with **Switch server**, or run **Diagnostics** to see the full picture

## About the stream sources

Playback is handled by third-party public embed services (VidZee, 2Embed, VidLink, VidSrc.su in today's active lineup, with more kept in reserve). A scheduled watchdog probes all of them every day, publishes the results, and the app automatically avoids anything that's down — even for first-time visitors.

CineFrame does not host, store, or distribute any media. Title information and artwork come from TMDB; video streams come from those external services, and their availability can change at any time.

---

<details>
<summary><strong>For developers — run it locally, repo map</strong></summary>

### Run locally

Requirements: Node.js 18.17+.

```sh
npm install
```

Create a `.env` in the project root:

```env
TMDB_API_KEY=your_tmdb_api_key
PORT=3000
```

Then:

```sh
npm start        # http://localhost:3000
npm run check    # static source checks
npm test         # allowlist unit tests
```

The TMDB key lives only in server-side environment variables — the browser never sees it.

### Repository map

| Path | What it is |
| --- | --- |
| `index.html` | The entire app — UI, player, providers, library (single-file by design) |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | PWA shell: offline shell (stale-while-revalidate), install assets |
| `api/tmdb-proxy.js` | Vercel serverless TMDB proxy — the transport the app uses |
| `api/tmdb/trending.js`, `api/health.js` | Convenience Vercel functions |
| `server.js` | Local dev server (`npm start`) — serves the same proxy contract |
| `lib/tmdb-path.js` | Shared allowlist for TMDB endpoints and query keys |
| `test/tmdb-path.test.js` | Node test for the allowlist |
| `scripts/check-project.mjs` | Static source check (`npm run check`) |
| `.github/workflows/validate.yml` | CI: runs the checks on every push and PR |
| `.github/workflows/provider-watchdog.yml` | Daily provider probe (cron + manual run button) |
| `.github/scripts/provider_check.py` | The probe — writes `provider-status.json`, manages outage issues |
| `provider-status.json` | Latest watchdog probe result (auto-committed daily) |
| `supabase/` | Cloud library: migrations + auth email templates |

</details>
