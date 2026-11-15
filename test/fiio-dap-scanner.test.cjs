const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

test('1. FiiO Track Factory: createFiioTrack creates valid audiophile track objects', () => {
  const flacFile = {
    name: '01 - Hotel California.flac',
    path: '/storage/0000-0000/Music/Eagles/01 - Hotel California.flac',
    size: 45678901
  };
  const flacTrack = library.createFiioTrack(flacFile);
  assert.ok(flacTrack);
  assert.ok(flacTrack.id.startsWith('fiio_'));
  assert.equal(flacTrack.title, '01 - Hotel California');
  assert.equal(flacTrack.name, '01 - Hotel California');
  assert.equal(flacTrack.path, flacFile.path);
  assert.equal(flacTrack.source, 'local');
  assert.equal(flacTrack.url, 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(flacFile.path));
  assert.equal(flacTrack.size, 45678901);
  assert.equal(flacTrack.isDsd, false);
  assert.equal(flacTrack.format, 'FLAC');

  // DSD DSF track
  const dsfFile = {
    name: 'Diana Krall - Temptation.dsf',
    path: '/sdcard/Music/DSD/Diana Krall - Temptation.dsf',
    size: 156789000
  };
  const dsfTrack = library.createFiioTrack(dsfFile);
  assert.ok(dsfTrack.id.startsWith('fiio_'));
  assert.equal(dsfTrack.isDsd, true);
  assert.equal(dsfTrack.format, 'DSF');
  assert.equal(dsfTrack.title, 'Diana Krall - Temptation');
  assert.equal(dsfTrack.url, 'https://appassets.androidplatform.net/local-media?path=' + encodeURIComponent(dsfFile.path));

  // DSD DFF track
  const dffFile = {
    name: 'Track01.dff',
    path: '/storage/1234-5678/DSD/Track01.dff',
    size: 98765432
  };
  const dffTrack = library.createFiioTrack(dffFile);
  assert.equal(dffTrack.isDsd, true);
  assert.equal(dffTrack.format, 'DFF');
});

test('2. FiiO Scan Results Parser: deduplication and batch conversion', () => {
  const mockFiles = [
    { name: 'Song1.flac', path: '/storage/sdcard1/Music/Song1.flac', size: 1000 },
    { name: 'Song2.dsf', path: '/storage/sdcard1/Music/Song2.dsf', size: 2000 },
    { name: 'Song1.flac', path: '/storage/sdcard1/Music/Song1.flac', size: 1000 }, // Duplicate
    { name: 'Song3.wav', path: '/sdcard/Music/Song3.wav', size: 3000 }
  ];

  const tracksFromArray = library.parseFiioScanResults(mockFiles);
  assert.equal(tracksFromArray.length, 3);
  assert.equal(tracksFromArray[0].title, 'Song1');
  assert.equal(tracksFromArray[1].title, 'Song2');
  assert.equal(tracksFromArray[2].title, 'Song3');

  const tracksFromJson = library.parseFiioScanResults(JSON.stringify(mockFiles));
  assert.equal(tracksFromJson.length, 3);
});

test('3. FiiO DAP Environment & Mode Detection', () => {
  assert.equal(library.isFiioDapEnvironment(null), false);
  assert.equal(library.isFiioDapEnvironment({ isNativeAndroid: true }), true);
  assert.equal(library.isFiioDapEnvironment({ NocturneNative: {} }), true);

  // Default mode
  const mockStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); }
  };

  // On Android DAP environment, default should be true
  assert.equal(library.getFiioDapMode(mockStorage, { isNativeAndroid: true }), true);
  // On standard desktop browser without setting, default false
  assert.equal(library.getFiioDapMode(mockStorage, {}), false);

  // Explicit user override
  mockStorage.setItem('nocturne-fiio-dap-mode', 'false');
  assert.equal(library.getFiioDapMode(mockStorage, { isNativeAndroid: true }), false);

  mockStorage.setItem('nocturne-fiio-dap-mode', 'true');
  assert.equal(library.getFiioDapMode(mockStorage, {}), true);

  // Telemetry formatting
  const msg = library.formatFiioScanTelemetry(42);
  assert.equal(msg, 'Đã quét xong: tìm thấy 42 bài hát trên bộ nhớ FiiO & thẻ MicroSD.');
});

test('4. HTML & UI: FiiO buttons and settings exist in index.html', () => {
  // Library header button
  assert.match(indexHtml, /id="fiio-scan-header-btn"/);
  assert.match(indexHtml, /Quét thẻ nhớ FiiO/);

  // Settings section & button
  assert.match(indexHtml, /id="fiio-dap-section"/);
  assert.match(indexHtml, /id="fiio-scan-settings-btn"/);
  assert.match(indexHtml, /Máy nghe nhạc FiiO DAP &amp; Android/);
  assert.match(indexHtml, /id="fiio-dap-mode-toggle"/);
  assert.match(indexHtml, /Chế độ FiiO DAP \(Snapdragon 660 Hiệu năng cao &amp; Tiết kiệm pin\)/);

  // CSS performance mode rules
  assert.match(indexHtml, /body\.fiio-dap-mode/);
  assert.match(indexHtml, /backdrop-filter:\s*none\s*!important/);
});

test('5. Android Notification Synchronization: updateMediaNotification in index.html', () => {
  assert.match(indexHtml, /NocturneNative\?\.updateMediaNotification/);
  assert.match(indexHtml, /function displayTrack/);
  assert.match(indexHtml, /function finishPlaybackStart/);
  assert.match(indexHtml, /scanFiioStorage/);
  assert.match(indexHtml, /saveFiioCatalog/);
  assert.match(indexHtml, /restoreFiioCatalog/);
  assert.match(indexHtml, /applyFiioDapMode/);
});

test('6. STRICT INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) strictly preserved', () => {
  assert.match(indexHtml, /state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/);
  const matches = indexHtml.match(/state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/g);
  assert.ok(matches && matches.length >= 2, 'Graph invariant must be present in audio graph setup');
});
