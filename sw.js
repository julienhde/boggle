// Service worker : rend le jeu installable et jouable hors-ligne.
// Stratégie "stale-while-revalidate" : on sert le cache immédiatement (rapide,
// marche hors-ligne) et on le rafraîchit en arrière-plan — une mise à jour du
// site est donc visible au rechargement suivant. Incrémenter CACHE_NAME force
// un rafraîchissement complet immédiat.
const CACHE_NAME = 'boggle-v6';

const ASSETS = [
  '.',
  'index.html',
  'admin.html',
  'css/style.css',
  'js/core.js',
  'js/app.js',
  'js/admin.js',
  'data/words_fr.txt.gz',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const refresh = fetch(event.request)
        .then((res) => {
          if (res.ok && new URL(event.request.url).origin === self.location.origin) {
            cache.put(event.request, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
