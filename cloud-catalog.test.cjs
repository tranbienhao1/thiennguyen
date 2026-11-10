'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

const coverStart = appCode.indexOf('const MAX_CATALOG_COVER_CHARS');
assert.ok(coverStart >= 0, 'Catalog cover cap should exist');
const serialStart = appCode.indexOf('const serializableCloudTrack = track => ({', coverStart);
assert.ok(serialStart > coverStart, 'serializableCloudTrack should follow the cover cap');
const serialEnd = appCode.indexOf('});', serialStart) + 3;
const factory = new Function(`${appCode.slice(coverStart, serialEnd)}\nreturn {coverForCatalog, serializableCloudTrack, MAX_CATALOG_COVER_CHARS};`);
const {coverForCatalog, serializableCloudTrack, MAX_CATALOG_COVER_CHARS} = factory();

assert.equal(MAX_CATALOG_COVER_CHARS, 512 * 1024, 'Catalog cover cap should be 512 KiB of characters');

const smallCover = `data:image/jpeg;base64,${'a'.repeat(1000)}`;
assert.equal(coverForCatalog(smallCover), smallCover, 'A small cover should persist unchanged');
const atCap = `data:image/png;base64,${'a'.repeat(MAX_CATALOG_COVER_CHARS - 22)}`;
assert.equal(atCap.length, MAX_CATALOG_COVER_CHARS, 'Test fixture should be exactly at the cap');
assert.equal(coverForCatalog(atCap), atCap, 'A cover exactly at the cap should persist');
assert.equal(coverForCatalog(`data:image/jpeg;base64,${'a'.repeat(MAX_CATALOG_COVER_CHARS)}`), null, 'A cover over the cap should be dropped instead of bloating the catalog');
assert.equal(coverForCatalog(null), null, 'A missing cover should serialize as null');
assert.equal(coverForCatalog(undefined), null, 'An undefined cover should serialize as null');
assert.equal(coverForCatalog(42), null, 'A non-string cover should serialize as null');
assert.equal(coverForCatalog(''), null, 'An empty cover should serialize as null');
assert.equal(coverForCatalog('https://example.com/cover.jpg'), 'https://example.com/cover.jpg', 'A remote cover URL should persist as-is (it costs no storage)');

const baseTrack = {id: 'google:1', remoteId: '1', remotePath: '/Music/a.flac', name: 'a.flac', title: 'A', artist: 'X', album: 'Al', format: 'FLAC', size: 1234, source: 'google', duration: 180, sampleRate: 96000, bitDepth: 24, channels: 2, cover: smallCover, metadataLoaded: true};
const entry = serializableCloudTrack(baseTrack);
assert.equal(entry.cover, smallCover, 'A normal cover should survive serialization');
assert.equal(entry.id, 'google:1', 'Serialization should keep the track id');
assert.equal(entry.metadataLoaded, true, 'Serialization should keep the loaded flag');
assert.equal(entry.url, undefined, 'Serialization should not persist the playback URL');
assert.equal(entry.file, undefined, 'Serialization should not persist the File handle');

const hugeTrack = {...baseTrack, cover: `data:image/jpeg;base64,${'b'.repeat(2 * 1024 * 1024)}`};
assert.ok(hugeTrack.cover.length > MAX_CATALOG_COVER_CHARS, 'Test fixture should actually exceed the cap');
assert.equal(serializableCloudTrack(hugeTrack).cover, null, 'A huge embedded cover should be dropped from the persisted catalog entry');
assert.equal(serializableCloudTrack({...baseTrack, cover: null}).cover, null, 'A track without a cover should serialize with a null cover');

assert.ok(appCode.includes('cover:coverForCatalog(track.cover)'), 'Cloud catalog serialization should route covers through the cap');
assert.ok(appCode.includes('persistCloudCatalog'), 'Cloud catalog persistence should still exist');
assert.ok(Number.isFinite(entry.savedAt), 'Serialization should stamp the entry with savedAt so the oldest can be pruned');
assert.ok(appCode.includes('savedAt:Date.now()'), 'Catalog entries should carry a save timestamp');
assert.ok(appCode.includes('pruneCloudCatalog().then(resolve);'), 'Catalog persistence should prune after writing');
assert.ok(appCode.includes('library.pruneCatalogEntries(request.result || [], library.MAX_CLOUD_CATALOG_ENTRIES)'), 'Pruning should use the shared library helper and cap');
assert.ok(appCode.includes('store.delete(id);'), 'Pruning should delete the stale catalog entries');
