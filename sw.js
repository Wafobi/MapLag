// ── MapLag service worker ──────────────────────────────────
// Keeps the app usable without network:
// - Map tiles: network first; every tile seen online is kept (oldest dropped
//   beyond MAX_TILES) and served when the network is gone.
// - App files and libraries: network first, cached copy when offline, so a
//   reload in a dead zone still opens the app. Online you always get the
//   current version.
// Everything else (Firebase, search, boundaries) passes through untouched.

const VERSION = 'v1';
const SHELL_CACHE = `maplag-shell-${VERSION}`;
const TILE_CACHE = `maplag-tiles-${VERSION}`;
const MAX_TILES = 4000;  // ~80–120 MB of raster tiles

const SHELL = [
  './', 'index.html', 'styles.css',
  'js/main.js', 'js/state.js', 'js/bridge.js', 'js/i18n.js', 'js/map.js', 'js/zones.js',
  'js/ui.js', 'js/radar.js', 'js/thermo.js', 'js/measure.js', 'js/search.js',
  'js/admin.js', 'js/firebase.js', 'js/offline.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
];

// Only providers that send CORS headers — opaque responses would cost
// ~7 MB of storage quota each in Chrome
const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.openstreetmap.de', 'basemaps.cartocdn.com', 'server.arcgisonline.com'];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'www.gstatic.com'];

const hostIn = (host, list) => list.some(h => host === h || host.endsWith('.' + h));

// a.basemaps… and b.basemaps… serve the same tile: cache under one key
function tileKey(url) {
  const u = new URL(url);
  u.hostname = u.hostname.replace(/^[a-d]\./, '');
  return u.href;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, TILE_CACHE];
    for (const k of await caches.keys()) if (k.startsWith('maplag-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (hostIn(url.hostname, TILE_HOSTS)) e.respondWith(tile(req));
  else if (url.origin === self.location.origin || hostIn(url.hostname, LIB_HOSTS)) e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') await cache.put(req, res.clone());
    return res;
  } catch (err) {
    // ?room=… links should still open the cached page
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

let _putsSinceTrim = 0;

async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const key = tileKey(req.url);
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') {
      await cache.put(key, res.clone());
      if (++_putsSinceTrim >= 50) { _putsSinceTrim = 0; await trimTiles(cache); }
    }
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

// Cache keys come back in insertion order: drop the oldest beyond the cap
async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
