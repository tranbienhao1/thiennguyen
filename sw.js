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
  'manifest.json',
  'icons/icon.svg',
];

const normalizePath = pathname => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);
const shellPaths = new Set(APP_SHELL.map(entry => normalizePath(new URL(entry, self.location.href).pathname)));
const isShellPath = pathname => shellPaths.has(normalizePath(pathname))
  || shellPaths.has(`${normalizePath(pathname)}/index.html`);

// Pha C — giới hạn cache app shell: chỉ giữ đúng các file APP_SHELL với URL
// chuẩn (không query-string). Bản trùng do ?v= / ?x= và đường dẫn lạ cùng
// origin lọt qua networkFirst sẽ bị xóa sau mỗi lần ghi (và khi activate),
// để Cache Storage không phình vô hạn khi dùng offline lâu. Best-effort:
// lỗi dọn cache không chặn việc trả response cho trang.
async function pruneShellCache(cache) {
  try {
    const keys = await cache.keys();
    await Promise.all(keys.map(request => {
      const url = new URL(request.url);
      return isShellPath(url.pathname) && !url.search ? undefined : cache.delete(request);
    }));
  } catch (error) { /* Dọn cache thất bại: giữ nguyên cache hiện tại. */ }
}

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
        await pruneShellCache(cache);
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
  // Pha C — precache từng file riêng lẻ: cache.addAll dừng cả lượt cài đặt
  // khi chỉ một file lỗi (404/mạng chập chờn) khiến worker mới không bao giờ
  // kích hoạt và trình duyệt cứ chạy worker DSD cũ; allSettled vẫn kích
  // hoạt worker mới, file lỗi sẽ được networkFirst nạp lại khi online.
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => Promise.allSettled(APP_SHELL.map(entry => cache.add(entry))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(names => Promise.all(names
      .filter(name => name !== CACHE_NAME)
      .map(name => caches.delete(name))))
    .then(() => caches.open(CACHE_NAME))
    .then(cache => pruneShellCache(cache))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (!shouldHandle(event.request)) return;
  event.respondWith(networkFirst(event.request));
});
