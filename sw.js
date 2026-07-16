// ===== MetaClean Service Worker =====
const CACHE_NAME = 'metaclean-v2';

const STATIC_ASSETS = [
  '/metadata-cleaner/',
  '/metadata-cleaner/index.html',
  '/metadata-cleaner/app.js',
  '/metadata-cleaner/style.css',
  '/metadata-cleaner/manifest.json',
  '/metadata-cleaner/icon-192.png',
  '/metadata-cleaner/icon-512.png'
];

// ===== INSTALL — cache all static assets =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ===== ACTIVATE — remove old caches =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ===== FETCH — serve from cache, fall back to network =====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle share_target POST from Android share sheet
  if (
    event.request.method === 'POST' &&
    url.pathname === '/metadata-cleaner/index.html'
  ) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // All other requests: cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ===== SHARE TARGET HANDLER =====
// Receives the shared image files from Android's share sheet,
// stores them in a temporary cache entry, then redirects to the app.
// app.js reads them on load via the 'share-target-files' cache key.
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('photos'); // must match manifest params.files[].name

    if (files.length > 0) {
      // Store files in IndexedDB to avoid postMessage race conditions
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('MetaCleanDB', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('SharedFiles');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('SharedFiles', 'readwrite');
          tx.objectStore('SharedFiles').put(files, 'latest');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }
  } catch (err) {
    // Silently fail — redirect to app regardless
  }

  // Always redirect to app after handling the POST
  return Response.redirect('/metadata-cleaner/', 303);
}