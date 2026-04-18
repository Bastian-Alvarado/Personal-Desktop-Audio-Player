const CACHE_NAME = 'simonrelays-desktop-pwa-v4';
const DB_NAME = 'SimonOffline'; 
const STORE_NAME = 'tracks';

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

// Helper to get track from IndexedDB inside the worker
function getTrackFromIDB(id) {
    return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                resolve(null);
                return;
            }
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const getReq = store.get(id);
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
    });
}

// Network-first strategy for a dynamic desktop/web app combo
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // 1. Handle PWA Offline Requests with Range Support
    if (url.pathname.includes('/pwa-offline/')) {
        const decodedId = decodeURIComponent(url.pathname.split('/pwa-offline/')[1]);
        e.respondWith(
            getTrackFromIDB(decodedId).then(record => {
                if (!record || !record.blob) {
                    return fetch(e.request); 
                }

                const blob = record.blob;
                const range = e.request.headers.get('range');

                if (range) {
                    const parts = range.replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : blob.size - 1;
                    const chunk = blob.slice(start, end + 1);

                    return new Response(chunk, {
                        status: 206,
                        statusText: 'Partial Content',
                        headers: {
                            'Content-Range': `bytes ${start}-${end}/${blob.size}`,
                            'Content-Length': chunk.size,
                            'Accept-Ranges': 'bytes',
                            'Content-Type': blob.type || 'audio/mpeg'
                        }
                    });
                }

                return new Response(blob, {
                    headers: {
                        'Content-Length': blob.size,
                        'Content-Type': blob.type || 'audio/mpeg',
                        'Accept-Ranges': 'bytes'
                    }
                });
            })
        );
        return;
    }

    // 2. Standard Static Asset Caching
    if (e.request.method !== 'GET') return;
    
    // Ignore external APIs or strictly dynamic logic
    if (e.request.url.includes('/api/') || e.request.url.includes('api.deezer.com')) {
        return;
    }

    // Pass through Tidal CDN audio segments and qqdl streaming APIs.
    // These are cross-origin requests that have no CORS headers for github.io.
    // The service worker intercepting them (and failing) prevents the browser's
    // native audio element from handling them. With no respondWith(), the browser
    // handles natively, which is more permissive for <audio> src loading.
    const isExternalMedia = (
        e.request.url.includes('audio.tidal.com') ||
        e.request.url.includes('qqdl.site') ||
        e.request.url.includes('tidal-uptime') ||
        e.request.url.includes('firebasedatabase.app')
    );
    if (isExternalMedia) return;

    e.respondWith(
        fetch(e.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(e.request, clone);
                });
                return response;
            })
            .catch(() => {
                return caches.match(e.request);
            })
    );
});
