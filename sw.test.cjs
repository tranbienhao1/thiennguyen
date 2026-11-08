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
async function fakeFetch(input) {
  if (!networkUp) throw new Error('Network offline');
  const url = typeof input === 'string' ? new URL(input, SW_URL).href : input.url;
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
  const shellCache = cacheStore.get('nocturne-v1');
  assert.ok(shellCache && shellCache.entries.size === 7 && shellCache.entries.has(shellUrl('index.html')), 'Install should precache all 7 app-shell entries');
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
  // Offline: navigation và worker script được phục vụ từ cache.
  networkUp = false;
  const offlineNav = await fetchEvent(makeRequest(shellUrl('./'), {mode: 'navigate'}));
  assert.equal((await offlineNav).body, `network:${shellUrl('./')}`, 'Offline navigation should fall back to the precached shell');
  const offlineWorker = await fetchEvent(makeRequest(shellUrl('dsd-worker.js')));
  assert.equal((await offlineWorker).body, `network:${shellUrl('dsd-worker.js')}`, 'Offline DSD worker should fall back to the precached script');
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
