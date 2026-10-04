// Meme Deck service worker: держит приложение в кэше, чтобы все работало офлайн.
// Страница: сначала сеть (всегда свежая версия), без интернета — из кэша.
// Остальные файлы: из кэша мгновенно, в фоне обновляются.
const CACHE = 'meme-deck-v2';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' — мимо HTTP-кэша браузера, иначе можно закэшировать старую версию
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    try { await cache.add(new Request(JSZIP_URL, { mode: 'cors' })); } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function fromNetwork(req, key, cache) {
  const res = await fetch(req, { cache: 'no-cache' });  // проверить у сервера, не изменился ли файл
  if (res && res.ok) await cache.put(key, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && req.url !== JSZIP_URL) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        // ждем сеть максимум 3 секунды, потом отдаем кэш
        return await Promise.race([
          fromNetwork('./index.html', './index.html', cache),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3000)),
        ]);
      } catch (e) {
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('Офлайн', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fromNetwork(req, req, cache).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || new Response('', { status: 504 });
  })());
});
