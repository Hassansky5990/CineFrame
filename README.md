# CineFrame

CineFrame is a mobile-first movie, series, and anime discovery app with a Capacitor Android wrapper.

## Build an Android APK

A GitHub Actions workflow builds a **debug APK** and publishes it as a downloadable artifact.

1. Open the repository's **Actions** tab.
2. Select **Build CineFrame Android APK**.
3. Choose **Run workflow** (or push a change to a watched app/build file).
4. Open the completed workflow run, download `cineframe-debug-apk`, and extract `app-debug.apk`.

The Android project is generated on the workflow runner, so it is not committed back into this repository. The APK is a debug/test build, not a signed Google Play release.

## App features in this repository

- Existing mobile-first CineFrame interface packaged with Capacitor.
- Branded CineFrame app icon and native splash resources generated during the Android build.
- Existing My List and Continue Watching history persisted locally on the device.
- Existing recommendations, search, title filters, and external player integration.
- Optional Supabase email/password accounts and cloud library sync. Cloud sync requires the setup below.
- The current external players control actual playback and subtitles. CineFrame stores the last title and season/episode when available, but exact playback timestamps cannot be read from a cross-origin iframe unless the provider exposes a supported progress API.

The TMDB proxy used by the hosted app is `https://cineframe-web.vercel.app/api/tmdb`. If the deployment domain changes, update the native API base in `index.html`. Set `TMDB_API_KEY` as a Vercel environment variable; never put the private key in client HTML.

## Enable email accounts and cross-device sync

The account interface is included but cloud accounts are disabled until you connect a Supabase project. In Vercel, add these environment variables and redeploy:

- `SUPABASE_URL`: the project URL.
- `SUPABASE_ANON_KEY`: the project's publishable/anon key. This is designed for client use; security must come from Row Level Security, not secrecy.

In the Supabase SQL editor, run this once:

```sql
create table if not exists public.cineframe_library (
  user_id uuid primary key references auth.users(id) on delete cascade,
  watchlist jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cineframe_library enable row level security;

create policy "Users can read their own CineFrame library"
on public.cineframe_library for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own CineFrame library"
on public.cineframe_library for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own CineFrame library"
on public.cineframe_library for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
```

Use Supabase Auth email/password and set the email-confirmation behavior you want in the Supabase dashboard. The API config endpoint only returns the public anon key and project URL; the user's access token and RLS policies protect per-user data.

## Local Android development

Install Node.js 20+, Java 21, and Android Studio/SDK, then run:

```sh
npm install
npm run build:web
npx cap add android
npx capacitor-assets generate --android --assetPath assets --androidProject android --splashBackgroundColor '#000000' --iconBackgroundColor '#080808'
npx cap sync android
npx cap open android
```

After generating the Android project once, use `npm run android:build` when web code or assets change.
