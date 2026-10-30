// Vedant Enterprises Service Worker for PWA Installation & Offline Support
const CACHE_NAME = 'vedant-app-v5';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './sync.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('SW cache pre-fetch error:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('SW deleting legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-First with Cache Fallback for instant fresh updates
self.addEventListener('fetch', (event) => {
  // Only handle local same-origin assets; let Firebase and Google Fonts stream directly
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Network First: Always try to get the newest version from GitHub
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return networkResponse;
      })
      .catch(() => {
        // If offline or network error, serve from cache
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html');
        });
      })
  );
});
