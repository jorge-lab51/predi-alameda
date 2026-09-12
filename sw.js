const CACHE = 'alameda-v16';
const ASSETS = [
  './', 'index.html', 'app.js', 'leaflet.js', 'leaflet.css',
  'programa.json', 'territorios.geojson', 'envolventes.geojson', 'calles.geojson',
  'plano.webp', 'plano_bounds.json',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'
];

// 'reload' evita que el caché del navegador devuelva la versión anterior
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(
    ASSETS.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => c.put(u, r)))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // teselas del mapa real: red primero, con caché de respaldo
  const TESELAS = ['basemaps.cartocdn.com', 'tile.openstreetmap.org', 'server.arcgisonline.com'];
  if (TESELAS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE + '-tiles').then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // el programa del mes: red primero, para que se actualice solo
  if (url.origin === location.origin && url.pathname.endsWith('programa.json')) {
    e.respondWith(
      fetch(new Request(e.request.url, { cache: 'reload' })).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // resto de la app: caché primero
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (url.origin === location.origin) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match('index.html')))
  );
});
