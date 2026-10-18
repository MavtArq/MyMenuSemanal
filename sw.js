// ============================================================
//  sw.js · Service worker: guarda la app en caché para que
//  funcione sin conexión y se pueda instalar en el móvil.
//
//  Estrategia "stale-while-revalidate": responde al instante con
//  lo que hay en caché y, en segundo plano, descarga la versión
//  nueva. Los cambios aparecen en la siguiente apertura.
//
//  Si añades o renombras ficheros, actualiza ARCHIVOS y sube la
//  versión de CACHE.
// ============================================================

const CACHE = 'menu-semanal-v1';

const ARCHIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/estilos.css',
  'js/app.js',
  'js/db.js',
  'js/modelo.js',
  'sql/schema.sql',
  'sql/datos_iniciales.sql',
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
  'icons/icono-192.png',
  'icons/icono-512.png',
];

self.addEventListener('install', evento => {
  evento.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(c => c !== CACHE).map(c => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', evento => {
  if (evento.request.method !== 'GET') return;
  evento.respondWith(
    caches.open(CACHE).then(async cache => {
      const enCache = await cache.match(evento.request, { ignoreSearch: true });
      const deRed = fetch(evento.request)
        .then(respuesta => {
          if (respuesta.ok) cache.put(evento.request, respuesta.clone());
          return respuesta;
        })
        .catch(() => enCache);
      return enCache ?? deRed;
    }),
  );
});
