// ATB Cross Uitslagen - service worker
// Website-bestanden: eerst het netwerk, bij geen verbinding de bewaarde versie.
// Uitslagen (data/*.json) worden altijd vers opgehaald; zonder verbinding de laatst bewaarde.
const CACHE = 'atb-uitslagen-v3';
const BASIS = ['./', './index.html', './logo.png', './manifest.webmanifest', './icon-192.png', './icon-512.png', './privacy.html',
               './fonts/barlow-400.woff', './fonts/barlow-500.woff', './fonts/barlow-600.woff', './fonts/barlow-700.woff', './fonts/saira-600.woff', './fonts/saira-800.woff'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // externe bronnen: niet via de cache
  const sleutel = url.pathname.includes('/data/') ? url.origin + url.pathname : req;  // zonder ?t=...
  e.respondWith(
    fetch(req).then(antw => {
      if (antw.ok) { const kopie = antw.clone(); caches.open(CACHE).then(c => c.put(sleutel, kopie)); }
      return antw;
    }).catch(() => caches.match(sleutel).then(b => b || caches.match('./index.html')))
  );
});
