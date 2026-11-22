'use strict';

/* NOCTURNE service worker: app shell dùng được khi mất mạng.
 *
 * Chiến lược network-first cho mọi yêu cầu app shell cùng origin; cache chỉ
 * là phương án dự phòng khi mất mạng. Yêu cầu cross-origin (CDN, API
 * Drive/OneDrive, luồng nhạc), yêu cầu no-store (bộ kiểm tra cập nhật trong
 * app) và yêu cầu Range không bao giờ đi qua cache.
 */
const CACHE_VERSION = 'v3.9.90'; // History: const CACHE_VERSION = 'v3.9.89'; const CACHE_VERSION = 'v3.9.88'; const CACHE_VERSION = 'v3.9.87'; const CACHE_VERSION = 'v3.9.86'; const CACHE_VERSION = 'v3.9.85'; const CACHE_VERSION = 'v3.9.84'; const CACHE_VERSION = 'v3.9.83'; const CACHE_VERSION = 'v3.9.82'; const CACHE_VERSION = 'v3.9.81'; const CACHE_VERSION = 'v3.9.80'; const CACHE_VERSION = 'v3.9.79'; const CACHE_VERSION = 'v3.9.78'; const CACHE_VERSION = 'v3.9.77'; const CACHE_VERSION = 'v3.9.76'; const CACHE_VERSION = 'v3.9.75'; const CACHE_VERSION = 'v3.9.74'; const CACHE_VERSION = 'v3.9.73'; const CACHE_VERSION = 'v3.9.72'; const CACHE_VERSION = 'v3.9.71'; const CACHE_VERSION = 'v3.9.70'; const CACHE_VERSION = 'v3.9.69'; const CACHE_VERSION = 'v3.9.68'; const CACHE_VERSION = 'v3.9.67'; const CACHE_VERSION = 'v3.9.66'; const CACHE_VERSION = 'v3.9.65'; const CACHE_VERSION = 'v3.9.64'; const CACHE_VERSION = 'v3.9.63'; const CACHE_VERSION = 'v3.9.62'; const CACHE_VERSION = 'v3.9.61'; const CACHE_VERSION = 'v3.9.60'; const CACHE_VERSION = 'v3.9.59'; const CACHE_VERSION = 'v3.9.58'; const CACHE_VERSION = 'v3.9.57'; const CACHE_VERSION = 'v3.9.56'; const CACHE_VERSION = 'v3.9.55'; const CACHE_VERSION = 'v3.9.54'; const CACHE_VERSION = 'v3.9.53'; const CACHE_VERSION = 'v3.9.52'; const CACHE_VERSION = 'v3.9.51'; const CACHE_VERSION = 'v3.9.50'; const CACHE_VERSION = 'v3.9.49'; const CACHE_VERSION = 'v3.9.48'; const CACHE_VERSION = 'v3.9.47'; const CACHE_VERSION = 'v3.9.46'; const CACHE_VERSION = 'v3.9.45'; const CACHE_VERSION = 'v3.9.44'; const CACHE_VERSION = 'v3.9.43'; const CACHE_VERSION = 'v3.9.42'; const CACHE_VERSION = 'v3.9.41'; const CACHE_VERSION = 'v3.9.40'; const CACHE_VERSION = 'v3.9.39'; const CACHE_VERSION = 'v3.9.38'; const CACHE_VERSION = 'v3.9.37'; const CACHE_VERSION = 'v3.9.36'; const CACHE_VERSION = 'v3.9.35'; const CACHE_VERSION = 'v3.9.34'; const CACHE_VERSION = 'v3.9.33'; const CACHE_VERSION = 'v3.9.32'; const CACHE_VERSION = 'v3.9.31'; const CACHE_VERSION = 'v3.9.30'; const CACHE_VERSION = 'v3.9.29'; const CACHE_VERSION = 'v3.9.28'; const CACHE_VERSION = 'v3.9.27'; const CACHE_VERSION = 'v3.9.26'; const CACHE_VERSION = 'v3.9.25'; const CACHE_VERSION = 'v3.9.24'; const CACHE_VERSION = 'v3.9.23'; const CACHE_VERSION = 'v3.9.22'; const CACHE_VERSION = 'v3.9.21'; const CACHE_VERSION = 'v3.9.20'; const CACHE_VERSION = 'v3.9.19'; const CACHE_VERSION = 'v3.9.18'; const CACHE_VERSION = 'v3.9.17'; const CACHE_VERSION = 'v3.9.16'; const CACHE_VERSION = 'v3.9.15'; const CACHE_VERSION = 'v3.9.14'; const CACHE_VERSION = 'v3.9.13'; const CACHE_VERSION = 'v3.9.12'; const CACHE_VERSION = 'v3.9.8'; const CACHE_VERSION = 'v3.1.1';
const CACHE_NAME = 'nocturne-v3.9.90'; // History: const CACHE_NAME = 'nocturne-v3.9.89'; const CACHE_NAME = 'nocturne-v3.9.88'; const CACHE_NAME = 'nocturne-v3.9.87'; const CACHE_NAME = 'nocturne-v3.9.86'; const CACHE_NAME = 'nocturne-v3.9.85'; const CACHE_NAME = 'nocturne-v3.9.84'; const CACHE_NAME = 'nocturne-v3.9.83'; const CACHE_NAME = 'nocturne-v3.9.82'; const CACHE_NAME = 'nocturne-v3.9.81'; const CACHE_NAME = 'nocturne-v3.9.80'; const CACHE_NAME = 'nocturne-v3.9.79'; const CACHE_NAME = 'nocturne-v3.9.78'; const CACHE_NAME = 'nocturne-v3.9.77'; const CACHE_NAME = 'nocturne-v3.9.76'; const CACHE_NAME = 'nocturne-v3.9.75'; const CACHE_NAME = 'nocturne-v3.9.74'; const CACHE_NAME = 'nocturne-v3.9.73'; const CACHE_NAME = 'nocturne-v3.9.72'; const CACHE_NAME = 'nocturne-v3.9.71'; const CACHE_NAME = 'nocturne-v3.9.70'; const CACHE_NAME = 'nocturne-v3.9.69'; const CACHE_NAME = 'nocturne-v3.9.68'; const CACHE_NAME = 'nocturne-v3.9.67'; const CACHE_NAME = 'nocturne-v3.9.66'; const CACHE_NAME = 'nocturne-v3.9.65'; const CACHE_NAME = 'nocturne-v3.9.64'; const CACHE_NAME = 'nocturne-v3.9.63'; const CACHE_NAME = 'nocturne-v3.9.62'; const CACHE_NAME = 'nocturne-v3.9.61'; const CACHE_NAME = 'nocturne-v3.9.60'; const CACHE_NAME = 'nocturne-v3.9.59'; const CACHE_NAME = 'nocturne-v3.9.58'; const CACHE_NAME = 'nocturne-v3.9.57'; const CACHE_NAME = 'nocturne-v3.9.56'; const CACHE_NAME = 'nocturne-v3.9.55'; const CACHE_NAME = 'nocturne-v3.9.54'; const CACHE_NAME = 'nocturne-v3.9.53'; const CACHE_NAME = 'nocturne-v3.9.52'; const CACHE_NAME = 'nocturne-v3.9.51'; const CACHE_NAME = 'nocturne-v3.9.50'; const CACHE_NAME = 'nocturne-v3.9.49'; const CACHE_NAME = 'nocturne-v3.9.48'; const CACHE_NAME = 'nocturne-v3.9.47'; const CACHE_NAME = 'nocturne-v3.9.46'; const CACHE_NAME = 'nocturne-v3.9.45'; const CACHE_NAME = 'nocturne-v3.9.44'; const CACHE_NAME = 'nocturne-v3.9.43'; const CACHE_NAME = 'nocturne-v3.9.42'; const CACHE_NAME = 'nocturne-v3.9.41'; const CACHE_NAME = 'nocturne-v3.9.40'; const CACHE_NAME = 'nocturne-v3.9.39'; const CACHE_NAME = 'nocturne-v3.9.38'; const CACHE_NAME = 'nocturne-v3.9.37'; const CACHE_NAME = 'nocturne-v3.9.36'; const CACHE_NAME = 'nocturne-v3.9.35'; const CACHE_NAME = 'nocturne-v3.9.34'; const CACHE_NAME = 'nocturne-v3.9.33'; const CACHE_NAME = 'nocturne-v3.9.32'; const CACHE_NAME = 'nocturne-v3.9.31'; const CACHE_NAME = 'nocturne-v3.9.30'; const CACHE_NAME = 'nocturne-v3.9.29'; const CACHE_NAME = 'nocturne-v3.9.28'; const CACHE_NAME = 'nocturne-v3.9.27'; const CACHE_NAME = 'nocturne-v3.9.26'; const CACHE_NAME = 'nocturne-v3.9.25'; const CACHE_NAME = 'nocturne-v3.9.24'; const CACHE_NAME = 'nocturne-v3.9.23'; const CACHE_NAME = 'nocturne-v3.9.22'; const CACHE_NAME = 'nocturne-v3.9.21'; const CACHE_NAME = 'nocturne-v3.9.20'; const CACHE_NAME = 'nocturne-v3.9.19'; const CACHE_NAME = 'nocturne-v3.9.18'; const CACHE_NAME = 'nocturne-v3.9.17'; const CACHE_NAME = 'nocturne-v3.9.16'; const CACHE_NAME = 'nocturne-v3.9.15'; const CACHE_NAME = 'nocturne-v3.9.14'; const CACHE_NAME = 'nocturne-v3.9.13'; const CACHE_NAME = 'nocturne-v3.9.12'; const CACHE_NAME = 'nocturne-v3.9.8'; const CACHE_NAME = 'nocturne-v3.1.1';
self.CACHE_VERSION = CACHE_VERSION;
self.CACHE_NAME = CACHE_NAME;
const APP_SHELL = [
  './',
  'index.html',
  'tailwind.min.css',
  'library-utils.js',
  'library-tools.js',
  'virtual-scroll.js',
  'ui-overlay.js',
  'metadata-utils.js',
  'metadata-ui.js',
  'cloud-metadata.js',
  'autoeq-cue.js',
  'lrclib-client.js',
  'lyrics-utils.js',
  'lyrics-editor-ui.js',
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
    .then(cache => Promise.all(APP_SHELL.map(entry => cache.add(entry).catch(() => null))))
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

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
