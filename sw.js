/* CineFrame shell service worker.
   Strategy: stale-while-revalidate for app-shell navigations only.
   - First load: network as usual; the shell document is cached on install.
   - Later loads on flaky/offline networks: the shell is served instantly
     from cache and refreshed in the background for the next visit.
   - TMDB, provider embeds, Supabase and every cross-origin request are
     never intercepted. Non-navigation requests pass through untouched. */
const CACHE = 'cineframe-shell-v15';
const IMAGES = 'cineframe-images-v1';


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
    // Verify this version actually precached the shell BEFORE deleting
    // the old caches — never wipe the last-known-good shell.
    let healthy = false;
    try {
      const cache = await caches.open(CACHE);
      healthy = Boolean(await cache.match('./') || await cache.match('index.html'));
    } catch (_) { healthy = false; }

    const keys = await caches.keys();
    const oldKeys = keys.filter((key) => key !== CACHE && key !== IMAGES);
    const isUpgrade = oldKeys.some((key) => key.indexOf('cineframe-shell-') === 0);

    if (healthy) {
      await Promise.all(oldKeys.map((key) => caches.delete(key)));
    } else {
      console.warn('[sw] new cache is empty; keeping old shells for rollback');
    }
    await self.clients.claim();

    // Reload open tabs only on a genuine upgrade with a healthy cache.
    // Never on first install, never when this version failed to precache.
    if (healthy && isUpgrade) {
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach((client) => {
        try { client.navigate(client.url).catch(() => {}); } catch (_) {}
      });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Posters and backdrops come from one immutable origin. Cache-first with
  // a hard cap so shelves are instant on repeat visits and poor networks.
  if (request.method === 'GET' && new URL(request.url).origin === 'https://image.tmdb.org') {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGES);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          cache.put(request, fresh.clone()).catch(() => {});
          const keys = await cache.keys();
          if (keys.length > 140) {
            keys.slice(0, keys.length - 140).forEach((key) => cache.delete(key).catch(() => {}));
          }
        }
        return fresh;
      } catch (_) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // App documents only: never touch API calls, media segments or embeds.
  if (request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Shell caching covers only the app document itself. Anything else loads
  // from the network untouched so it can never be answered with the shell.
  const shellUrl = new URL('./', self.registration.scope);
  const path = url.pathname.replace(/\/+$/, '');
  const shellPath = shellUrl.pathname.replace(/\/+$/, '');
  const isShell = path === shellPath
    || path === (shellPath + '/index.html')
    || path === '/index.html';
  if (!isShell) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached =
      await cache.match(request, { ignoreSearch: true }) ||
      await cache.match('./', { ignoreSearch: true });
    const shellUrl = new URL('./', self.registration.scope).href;

    // Only cache clean, successful responses — never error pages or
    // opaque redirects, which would poison the offline shell forever.
    const refresh = fetch(request).then((response) => {
      if (response && response.ok) {
        const shellHref = new URL('./', self.registration.scope).href;
        cache.put(shellHref, response.clone()).catch(() => {});
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
