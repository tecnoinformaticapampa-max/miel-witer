// Miel Witer – Service Worker v4
const CACHE = 'mielwiter-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Solo procesar HTTP/HTTPS — ignorar chrome-extension, data:, blob:, etc.
  if (!url.startsWith('http')) return;

  // Solo cachear GET
  if (e.request.method !== 'GET') return;

  // Nunca cachear — siempre frescos
  if (url.includes('raw.githubusercontent.com')) return;
  if (url.includes('cloudinary.com')) return;
  if (url.includes('fonts.googleapis.com')) return;
  if (url.includes('fonts.gstatic.com')) return;
  if (url.includes('postimg.cc')) return;
  if (url.includes('maps.googleapis.com')) return;
  if (url.includes('google.com/maps')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request)
        .then(res => {
          // Solo cachear respuestas validas de nuestro dominio
          if (res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
