'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const swCode = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
new vm.Script(swCode, {filename: 'sw.js'});
const ORIGIN = 'https://tranbienhao1.github.io';
const SW_URL = `${ORIGIN}/thiennguyen/sw.js`;
const shellUrl = file => new URL(file, SW_URL).href;

class FakeResponse { constructor(body, {ok = true} = {}) { this.body = body; this.ok = ok; } clone() { return new FakeResponse(this.body, {ok: this.ok}); } }
let networkUp = true;
const networkBodies = new Map();
const networkFailures = new Set();
async function fakeFetch(input) {
  if (!networkUp) throw new Error('Network offline');
  const url = typeof input === 'string' ? new URL(input, SW_URL).href : input.url;
  if (networkFailures.has(url)) return new FakeResponse('', {ok: false});
  return new FakeResponse(networkBodies.get(url) ?? `network:${url}`);
}
class FakeCache {
  constructor() { this.entries = new Map(); }
  async add(url) {
    const response = await fakeFetch(url);
    if (!response.ok) throw new Error(`Precache failed: ${url}`);
    this.entries.set(new URL(url, SW_URL).href, response);
  }
  async addAll(urls) { for (const url of urls) await this.add(url); }
  async put(request, response) { this.entries.set(request.url, response); }
  async delete(request) { const url = typeof request === 'string' ? new URL(request, SW_URL).href : request.url; return this.entries.delete(url); }
  async keys() { return [...this.entries.keys()].map(url => ({url})); }
  async match(request, {ignoreSearch = false} = {}) {
    const key = url => (ignoreSearch ? url.split('?')[0] : url);
    for (const [stored, value] of this.entries) if (key(stored) === key(request.url)) return value;
    return undefined;
  }
}
const cacheStore = new Map();
const cachesStub = {
  open: async name => { if (!cacheStore.has(name)) cacheStore.set(name, new FakeCache()); return cacheStore.get(name); },
  keys: async () => [...cacheStore.keys()],
  delete: async name => cacheStore.delete(name),
  match: async (request, options) => { for (const cache of cacheStore.values()) { const hit = await cache.match(request, options); if (hit) return hit; } return undefined; },
};
const listeners = {};
const sandbox = {
  self: {
    location: new URL(SW_URL),
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => { sandbox.self.skipWaitingCalled = true; },
    clients: { claim: () => { sandbox.self.claimCalled = true; } },
  },
  caches: cachesStub, fetch: fakeFetch, URL,
};
vm.createContext(sandbox);
vm.runInContext(swCode, sandbox, {filename: 'sw.js'});
const makeRequest = (url, {method = 'GET', mode = 'same-origin', cache = 'default', range = null} = {}) => ({url, method, mode, cache, headers: {get: name => (name === 'Range' ? range : null)}});
async function dispatch(type) { const event = {waitUntil(promise) { event.settled = promise; }}; listeners[type](event); await event.settled; }
function fetchEvent(request) { const event = {request, respondWith(promise) { event.response = promise; }}; listeners.fetch(event); return event.response; }
(async () => {
  // Install: precache toàn bộ app shell và kích hoạt ngay.
  await dispatch('install');
  assert.equal(sandbox.self.skipWaitingCalled, true, 'Install should skip waiting so the new worker activates');
  let shellCache = cacheStore.get('nocturne-v1');
  assert.ok(shellCache && shellCache.entries.size === 9 && shellCache.entries.has(shellUrl('index.html')), 'Install should precache all 9 app-shell entries');
  // Pha C: một file precache lỗi không được chặn cả lượt cài đặt — worker
  // mới vẫn phải kích hoạt để trình duyệt không kẹt với worker DSD cũ, và
  // các file còn lại vẫn được cache; file lỗi sẽ được nạp lại khi online.
  cacheStore.delete('nocturne-v1');
  networkFailures.add(shellUrl('icons/icon.svg'));
  sandbox.self.skipWaitingCalled = false;
  await dispatch('install');
  assert.equal(sandbox.self.skipWaitingCalled, true, 'Install with one failing file should still skip waiting so the new worker activates');
  const partialCache = cacheStore.get('nocturne-v1');
  assert.ok(partialCache && partialCache.entries.size === 8, 'Install with one failing file should still precache the other 8 app-shell entries');
  assert.equal(partialCache.entries.has(shellUrl('icons/icon.svg')), false, 'The failing file should be the only entry missing after a partial install');
  assert.ok(partialCache.entries.has(shellUrl('dsd-worker.js')), 'A partial install should still precache the DSD worker script');
  networkFailures.delete(shellUrl('icons/icon.svg'));
  await dispatch('install');
  shellCache = cacheStore.get('nocturne-v1');
  assert.equal(shellCache.entries.size, 9, 'Reinstall after the failure clears should precache all 9 app-shell entries again');
  // Activate: xoá cache cũ và chiếm quyền điều khiển ngay.
  cacheStore.set('nocturne-v0', new FakeCache());
  await dispatch('activate');
  assert.equal(cacheStore.has('nocturne-v0'), false, 'Activate should delete caches from older versions');
  assert.equal(sandbox.self.claimCalled, true, 'Activate should claim clients');
  // Online: network-first trả response mạng mới và cập nhật cache.
  networkBodies.set(shellUrl('library-utils.js'), 'library-v2');
  const online = await fetchEvent(makeRequest(shellUrl('library-utils.js')));
  assert.ok(online, 'App-shell fetch should be handled');
  assert.equal((await online).body, 'library-v2', 'Online fetch should return the network response');
  assert.equal(shellCache.entries.get(shellUrl('library-utils.js')).body, 'library-v2', 'Online fetch should refresh the cache');
  // Pha C: cache app shell chỉ giữ đúng 9 entry chuẩn — bản trùng do
  // query-string và đường dẫn lạ cùng origin bị dọn sau mỗi lần ghi.
  shellCache.entries.set(`${shellUrl('index.html')}?v=2`, new FakeResponse('stale-versioned'));
  shellCache.entries.set(`${ORIGIN}/thiennguyen/other.js`, new FakeResponse('stray'));
  const pruned = await fetchEvent(makeRequest(shellUrl('metadata-ui.js')));
  assert.equal((await pruned).body, `network:${shellUrl('metadata-ui.js')}`, 'Fetch that triggers pruning should still return the network response');
  assert.equal(shellCache.entries.has(`${shellUrl('index.html')}?v=2`), false, 'Versioned duplicate of a shell file should be pruned after a write');
  assert.equal(shellCache.entries.has(`${ORIGIN}/thiennguyen/other.js`), false, 'Non-shell same-origin entry should be pruned after a write');
  assert.equal(shellCache.entries.size, 9, 'Shell cache should keep exactly the 9 canonical app-shell entries');
  assert.equal(shellCache.entries.get(shellUrl('metadata-ui.js')).body, `network:${shellUrl('metadata-ui.js')}`, 'Canonical entry should be refreshed by the fetch');
  // Pha C: activate cũng dọn rác đã tích lũy từ các bản worker trước.
  shellCache.entries.set(`${shellUrl('index.html')}?v=3`, new FakeResponse('stale-activate'));
  await dispatch('activate');
  assert.equal(shellCache.entries.has(`${shellUrl('index.html')}?v=3`), false, 'Activate should prune versioned duplicates left by older workers');
  assert.equal(shellCache.entries.size, 9, 'Activate should keep exactly the 9 canonical app-shell entries');
  // Offline: navigation và worker script được phục vụ từ cache.
  networkUp = false;
  const offlineNav = await fetchEvent(makeRequest(shellUrl('./'), {mode: 'navigate'}));
  assert.equal((await offlineNav).body, `network:${shellUrl('./')}`, 'Offline navigation should fall back to the precached shell');
  const offlineWorker = await fetchEvent(makeRequest(shellUrl('dsd-worker.js')));
  assert.equal((await offlineWorker).body, `network:${shellUrl('dsd-worker.js')}`, 'Offline DSD worker should fall back to the precached script');
  const offlineManifest = await fetchEvent(makeRequest(shellUrl('manifest.json')));
  assert.equal((await offlineManifest).body, `network:${shellUrl('manifest.json')}`, 'Offline manifest should fall back to the precached file');
  // Offline nhưng chưa có cache: fetch phải reject thay vì trả trang trắng.
  cacheStore.delete('nocturne-v1');
  const uncached = fetchEvent(makeRequest(shellUrl('library-utils.js')));
  await assert.rejects(uncached, /Network offline/, 'Offline fetch with no cache should reject');
  // Các yêu cầu không thuộc app shell phải đi thẳng ra mạng, không qua cache.
  networkUp = true;
  const passthroughs = [
    makeRequest(`${ORIGIN}/thiennguyen/?_nocturne_update=123`, {mode: 'navigate', cache: 'no-store'}),
    makeRequest('https://cdn.tailwindcss.com/x.js'),
    makeRequest(shellUrl('library-utils.js'), {range: 'bytes=0-99'}),
    makeRequest(shellUrl('library-utils.js'), {method: 'POST'}),
    makeRequest(`${ORIGIN}/thiennguyen/audio/bai-hat.flac`),
  ];
  for (const request of passthroughs) assert.equal(await fetchEvent(request), undefined, `Should pass through without responding: ${request.url}`);
  assert.equal(cacheStore.has('nocturne-v1'), false, 'Passthrough requests should not recreate the cache');
  console.log('Service worker install/activate/fetch regression tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
