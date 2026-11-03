# CineFrame

CineFrame is a single-page movie and series discovery interface powered by TMDB. Playback is provided by the configured external embed providers; provider capabilities and availability can vary.

## Run locally

Requirements: Node.js 18.17 or newer.

1. Install dependencies:
   ```sh
   npm install
   ```
2. Create a server-side `.env` file in the project root:
   ```env
   TMDB_API_KEY=your_tmdb_api_key
   PORT=3000
   ```
3. Start CineFrame:
   ```sh
   npm start
   ```
4. Open http://localhost:3000.

Run the static source checks with `npm run check`.

The TMDB key is read by the server and must never be added to the browser code or committed to Git.

## Deploy on Vercel

Set `TMDB_API_KEY` in the Vercel project environment variables. The `/api/tmdb/*` rewrite is handled by the Vercel function in `api/tmdb-proxy.js`. Redeploy after changing environment variables.

## Playback notes

CineFrame uses provider-owned embedded players. The app only exposes custom controls when a provider integration is verified. An iframe loading is not proof that a video has started, and a provider may fail independently of CineFrame. Native HTML5 playback requires an authorized direct media source and provider permission/support.

## Security

- Keep `.env` and API credentials out of source control.
- Do not expose provider tokens or private keys in `index.html`.
- Treat provider messages and playback progress as untrusted input.

## Account-synced library setup

The account UI uses Supabase Auth. The cloud watchlist and viewing history require a one-time database setup:

1. In Supabase Dashboard, open **SQL Editor** and run `supabase/migrations/202611010001_cineframe_cloud_library.sql`.
2. In **Authentication → URL Configuration**, allow the production confirmation redirect `https://cineframe-web.vercel.app/?auth=confirmed`. For local testing, also allow `http://localhost:3000/?auth=confirmed`.
3. Configure the project's email confirmation and password-recovery settings before testing account flows.

Until the migration is applied and the redirect URLs are allowed, local watchlist/history can still use browser storage, but account-synced library features cannot be considered ready. The browser may contain a Supabase publishable key; never put a Supabase `service_role` key in frontend code.
