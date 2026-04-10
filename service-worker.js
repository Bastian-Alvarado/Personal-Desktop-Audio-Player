const CACHE_NAME = 'simonrelays-desktop-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './renderer.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Network-first strategy for a dynamic desktop/web app combo
self.addEventListener('fetch', (e) => {
    // We only handle GET requests for PWA standard caching
    if (e.request.method !== 'GET') return;
    
    // Ignore external APIs like Deezer or strictly local audio streams dynamically
    if (e.request.url.includes('/api/') || e.request.url.includes('api.deezer.com')) {
        return;
    }

    e.respondWith(
        fetch(e.request)
            .then(response => {
                // Return fresh resources and cache a copy
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(e.request, clone);
                });
                return response;
            })
            .catch(() => {
                // If offline or network fails, fallback to cache
                return caches.match(e.request);
            })
    );
});
