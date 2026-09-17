/* Service Worker ГИС-ГТМ Норильск: устанавливаемость (PWA) + офлайн-открытие.
   Стратегия: network-first с фолбэком в кэш — актуальность данных важнее офлайна;
   кэш обновляется в фоне при каждом успешном ответе. Версия кэша — в имени. */
const NGK_CACHE = 'ngk-pwa-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== NGK_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // сторонние (тайлы OSM, метео) — напрямую
  e.respondWith(
    fetch(req)
      .then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(NGK_CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then(cached => cached || Promise.reject(new Error('offline'))))
  );
});
