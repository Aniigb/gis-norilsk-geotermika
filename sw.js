/* Миграция GitHub Pages → https://gis.aniigb.ru/.
   Старые кэши удаляются, навигация всегда получает страницу переадресации из сети. */
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ГИС-ГТМ Норильск</title><body style="font-family:Arial,sans-serif;padding:32px"><h1>ГИС-ГТМ Норильск переехала</h1><p><a href="https://gis.aniigb.ru/">Открыть новый адрес</a></p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ))
  );
});
