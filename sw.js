/* Beach-Volleyball Turniervorlagen – Service Worker
   Ermöglicht vollständigen Offline-Betrieb (PWA).
   Bei Änderungen an den Seiten die CACHE_VERSION erhöhen. */
const CACHE_VERSION = 'beachl-turniere-v17';

/* Alle App-Ressourcen (self-contained HTML, keine externen Abhängigkeiten). */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app-skin.css',
  './appbar.js',
  './form-flow.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './Turnierbogen_6_Teams_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_8_Teams_4_Felder_Gruppen_KO_System.html',
  './Turnierbogen_8_Teams_4_Felder_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_8_Teams_4_Felder_KO_System.html',
  './Turnierbogen_10_Teams_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_12_Teams_6_Felder_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_12_Teams_Schweizer_System.html',
  './Turnierbogen_16_Teams_8_Felder_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_Flexibel_Alle_gegen_Alle.html',
  './Turnierbogen_Schweizer_System.html',
  './docs/format-jeder-gegen-jeden.html',
  './docs/format-gruppen-platzierungsrunde.html',
  './docs/format-ko-system.html',
  './docs/format-schweizer-system.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* Strategie: Stale-While-Revalidate für eigene GET-Requests.
   Sofort aus dem Cache liefern (offline-fähig), im Hintergrund aktualisieren. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(cached => {
        const network = fetch(req).then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => cached || (req.mode === 'navigate' ? cache.match('./index.html') : undefined));
        return cached || network;
      })
    )
  );
});
