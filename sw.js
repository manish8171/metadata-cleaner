// ===== MetaClean Service Worker =====
const CACHE_NAME = 'metaclean-v8';

const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ===== INSTALL — cache static assets =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
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

// ===== FETCH — Network-First strategy so updates take effect immediately =====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle share_target POST from Android share sheet
  if (event.request.method === 'POST' && url.pathname.includes('index.html')) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Network-First with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// ===== SHARE TARGET HANDLER =====
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('photos');

    if (files.length > 0) {
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
  } catch (err) {}

  return Response.redirect('./', 303);
}