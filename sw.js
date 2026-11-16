/* CineFrame shell service worker.
   Strategy: stale-while-revalidate for app-shell navigations only.
   - First load: network as usual; the shell document is cached on install.
   - Later loads on flaky/offline networks: the shell is served instantly
     from cache and refreshed in the background for the next visit.
   - TMDB, provider embeds, Supabase and every cross-origin request are
     never intercepted. Non-navigation requests pass through untouched. */
const CACHE = 'cineframe-shell-v10';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(['./', 'index.html']);
    } catch (error) {
      // A partial cache is fine: the fetch handler revalidates on the fly.
      try { await cache.add('./'); } catch (_) {}
    }
    // PWA install assets: best-effort precache so the installed app can
    // cold-start with its icon and manifest even with no connection.
    ['manifest.webmanifest', 'icon-192.png', 'icon-512.png'].forEach((file) => {
      cache.add(file).catch(() => {});
    });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
    // One-time refresh on update: the just-installed worker already precached
    // the current shell, so reloading open tabs here means a deploy lands on
    // the first visit instead of the visit after next. Runs once per version.
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach((client) => {
      try { client.navigate(client.url).catch(() => {}); } catch (_) {}
    });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // App documents only: never touch API calls, media segments or embeds.
  if (request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Shell caching covers only the app document itself. Any other
  // same-origin document (test pages, future routes) loads from the
  // network untouched so it can never be answered with the shell.
  const path = url.pathname.replace(/\/+$/, '');
  const shellPath = new URL('./', self.location.origin).pathname.replace(/\/+$/, '');
  if (path !== shellPath && !path.endsWith('/index.html')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached =
      await cache.match(request, { ignoreSearch: true }) ||
      await cache.match('./', { ignoreSearch: true });
    const shellUrl = new URL('./', self.location.origin).href;

    const refresh = fetch(request).then((response) => {
      if (response && (response.ok || response.type === 'opaqueredirect')) {
        cache.put(request, response.clone()).catch(() => {});
        if (new URL(request.url).href !== shellUrl) {
          cache.put(shellUrl, response.clone()).catch(() => {});
        }
      }
      return response;
    }).catch(() => null);

    // Serve instantly from cache; keep the network refresh running.
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    const fresh = await refresh;
    return fresh || Response.error();
  })());
});
