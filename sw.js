/* Beach-Volleyball Turniervorlagen – Service Worker
   Ermöglicht vollständigen Offline-Betrieb (PWA).
   Bei Änderungen an den Seiten die CACHE_VERSION erhöhen. */
const CACHE_VERSION = 'beachl-turniere-v67';

/* Alle App-Ressourcen (self-contained HTML, keine externen Abhängigkeiten). */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app-skin.css',
  './spielplan.css',
  './round-nav.css',
  './appbar.js',
  './form-flow.js',
  './spielplan-enh.js',
  './round-nav.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  /* Weiterleitungs-Stubs der abgelösten Bögen – bleiben im Cache, damit
     gespeicherte Lesezeichen und installierte PWA-Verknüpfungen offline
     ankommen und den Nutzer zum passenden dynamischen Bogen leiten. */
  './Turnierbogen_6_Teams_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_8_Teams_4_Felder_Gruppen_KO_System.html',
  './Turnierbogen_8_Teams_4_Felder_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_8_Teams_4_Felder_KO_System.html',
  './Turnierbogen_10_Teams_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_12_Teams_6_Felder_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_16_Teams_8_Felder_Gruppen_Platzierungsrunde.html',
  './Turnierbogen_Flexibel_Alle_gegen_Alle.html',
  './Turnierbogen_Schweizer_System.html',
  /* Dynamische Universalbögen und ihre gemeinsame Engine */
  './Turnierbogen_Gruppen_Finalrunde.html',
  './Turnierbogen_KO_System.html',
  './Turnierbogen_Doppel_KO_System.html',
  './Turnierbogen_Runden_System.html',
  './Turnierbogen_Modified_Pool_Play.html',
  './Turnierbogen_King_Queen_of_the_Court.html',
  './core/turnier-base.css',
  './core/compat.js',
  './core/compat-flexgap.css',
  './core/turnier-archive.js',
  './core/turnier-core.js',
  './core/turnier-format.js',
  './core/turnier-store.js',
  './core/turnier-ui.js',
  './docs/format-jeder-gegen-jeden.html',
  './docs/format-gruppen-platzierungsrunde.html',
  './docs/format-ko-system.html',
  './docs/format-double-elimination.html',
  './docs/format-schweizer-system.html',
  './docs/format-modified-pool-play.html',
  './docs/format-king-of-the-court.html'
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

/* Strategie:
   - Seiten, Skripte und Stylesheets: Network-First. Online zeigt der erste
     Aufruf damit immer den aktuellen Stand (kein Hard-Reload nötig); offline
     wird aus dem Cache geliefert.
   - Übrige Ressourcen (Icons, Manifest): Stale-While-Revalidate, da sie sich
     praktisch nie ändern und sofort verfügbar sein sollen. */
function isFreshFirst(req) {
  if (req.mode === 'navigate') return true;
  const d = req.destination;
  return d === 'document' || d === 'script' || d === 'style';
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isFreshFirst(req)) {
    /* `no-cache` erzwingt eine Revalidierung beim Server (billiges 304), damit
       nicht der HTTP-Cache des Browsers eine veraltete Seite zurückgibt. */
    const fresh = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    event.respondWith(
      caches.open(CACHE_VERSION).then(cache =>
        fetch(fresh).then(res => {
          if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch(() =>
          cache.match(req, { ignoreSearch: true })
            .then(cached => cached || (req.mode === 'navigate' ? cache.match('./index.html') : undefined))
        )
      )
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(cached => {
        const network = fetch(req).then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    )
  );
});
