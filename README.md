# CineFrame

CineFrame is a TMDB-powered film and series discovery interface with a Capacitor Android wrapper. The Android app keeps the existing CineFrame website's black/red identity and mobile layout rather than introducing a separate visual redesign.

## Features

- Browse, search, filter and sort movies and series using the existing TMDB integration.
- Save a local watchlist and continue-watching history.
- Create an account to sync watchlist and history across devices.
- Show saved playback-progress bars when the selected embedded player emits supported progress messages. Cross-origin players control their own playback and subtitle controls; CineFrame cannot read playback time or force subtitle settings unless the provider exposes that data.
- Native Android icon and splash assets generated from the existing CineFrame mark.
- GitHub Actions builds a debug APK and uploads it as the `cineframe-debug-apk` workflow artifact.

## Run locally

Use Node.js 20 or newer.

```sh
npm install
cp .env.example .env
# Configure TMDB_API_KEY and keep it server-side.
npm start
```

Open `http://localhost:3000`. The local Express server stores accounts and libraries in `data/cineframe.db`. To run the checks:

```sh
npm test
```

## Android APK

For a local build, create the Android project once, then build it with Android Studio/SDK and Java 21 installed:

```sh
npm install
npm run build:web
npx cap add android
npm run android:assets
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`.

The GitHub Actions workflow performs the same steps on pull requests into `main` and pushes to `main`. Open the completed workflow run and download the `cineframe-debug-apk` artifact. This is a debug APK for testing, not a Play Store release-signed APK.

## Account database for Vercel

The Vercel account API uses PostgreSQL so session and library data survive serverless restarts. Configure these environment variables in your Vercel project before enabling account sync:

- `DATABASE_URL`: connection string for a persistent PostgreSQL database (for example, a managed Neon database).
- `TMDB_API_KEY`: TMDB API key kept in server-side environment variables.
- `APP_ORIGIN`: your deployed website's origin if you use a custom domain. Native Capacitor origins are allowed for the Android WebView.
- `MAL_CLIENT_ID`: optional; only needed for a configured MyAnimeList integration.

Redeploy after adding environment variables. Without `DATABASE_URL`, discovery can still load, but account-backed sync returns a configuration error. The native app's API base currently follows the existing deployed alias `https://cineframe-web.vercel.app/api`; update the `API_ROOT` declaration in `index.html` if your deployment uses a different address.

## Security and deployment notes

- Never commit `.env`, database credentials, or API keys.
- The local Express backend uses SQLite and stores its database under `data/`; back up that file if you self-host.
- The Vercel backend uses PostgreSQL. Do not use a local SQLite file as persistent storage in serverless functions.
- Passwords are scrypt-hashed, sessions are random opaque tokens stored by hash, and the library endpoint only stores the supported library fields.
- Configure a persistent database and set an explicit `APP_ORIGIN` before exposing account creation publicly.
- Player embeds and subtitles are controlled by their respective providers. Use media sources and subtitle files you are authorized to access.
