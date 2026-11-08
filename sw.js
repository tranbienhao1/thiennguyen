'use strict';

/* NOCTURNE service worker: app shell dùng được khi mất mạng.
 *
 * Chiến lược network-first cho mọi yêu cầu app shell cùng origin; cache chỉ
 * là phương án dự phòng khi mất mạng. Yêu cầu cross-origin (CDN, API
 * Drive/OneDrive, luồng nhạc), yêu cầu no-store (bộ kiểm tra cập nhật trong
 * app) và yêu cầu Range không bao giờ đi qua cache.
 */
const CACHE_NAME = 'nocturne-v1';
const APP_SHELL = [
  './',
  'index.html',
  'library-utils.js',
  'metadata-utils.js',
  'metadata-ui.js',
  'cloud-metadata.js',
  'dsd-worker.js',
];

const normalizePath = pathname => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);
const shellPaths = new Set(APP_SHELL.map(entry => normalizePath(new URL(entry, self.location.href).pathname)));
const isShellPath = pathname => shellPaths.has(normalizePath(pathname))
  || shellPaths.has(`${normalizePath(pathname)}/index.html`);

function shouldHandle(request) {
  if (request.method !== 'GET') return false;
  if (request.cache === 'no-store' || request.cache === 'only-if-cached') return false;
  if (request.headers.get('Range')) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.searchParams.has('_nocturne_update')) return false;
  return request.mode === 'navigate' || isShellPath(url.pathname);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch (error) { /* Cache đầy hoặc response không cache được: vẫn trả response mạng. */ }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, {ignoreSearch: true});
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(APP_SHELL))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(names => Promise.all(names
      .filter(name => name !== CACHE_NAME)
      .map(name => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (!shouldHandle(event.request)) return;
  event.respondWith(networkFirst(event.request));
});
