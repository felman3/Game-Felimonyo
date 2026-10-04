// Keeps a copy of the game on the device so it still opens without internet
// (for Practice mode) once you've visited.
const CACHE = 'splash-royale-v1';
const FILES = [
  './', 'index.html', 'style.css', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'vendor/three.module.min.js', 'vendor/peerjs.min.js',
  'js/main.js', 'js/game.js', 'js/host.js', 'js/net.js', 'js/render.js', 'js/shared.js', 'js/input.js', 'js/audio.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Always try the network first so everyone plays the same version; use the
// saved copy only when offline (or the network is very slow).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(e.request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 6000))
      ]);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
