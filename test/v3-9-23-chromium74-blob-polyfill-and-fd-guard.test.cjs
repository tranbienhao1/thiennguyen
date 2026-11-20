'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const DSD_WORKER = path.join(ROOT, 'dsd-worker.js');
const SW_JS = path.join(ROOT, 'sw.js');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

test('1. index.html installs Chromium 74 Blob.prototype.arrayBuffer and .text polyfills before library-utils.js', async () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const polyIdx = html.indexOf('Blob.prototype.arrayBuffer = function');
  const libIdx = html.indexOf('<script src="library-utils.js"></script>');
  assert.ok(polyIdx > 0 && libIdx > polyIdx, 'Blob polyfill must execute before library-utils.js');

  const scriptStart = html.lastIndexOf('<script>', polyIdx);
  const scriptEnd = html.indexOf('</script>', polyIdx);
  const headScript = html.slice(scriptStart + '<script>'.length, scriptEnd);

  function FakeBlob(bytes, text) {
    this._bytes = bytes;
    this._text = text;
  }
  function FakeFileReader() {}
  FakeFileReader.prototype.readAsArrayBuffer = function (blob) {
    this.result = blob._bytes.buffer;
    setTimeout(() => { if (this.onload) this.onload(); }, 0);
  };
  FakeFileReader.prototype.readAsText = function (blob) {
    this.result = blob._text;
    setTimeout(() => { if (this.onload) this.onload(); }, 0);
  };

  const sandbox = {
    Blob: FakeBlob,
    FileReader: FakeFileReader,
    Promise,
    Error,
    window: { isNativeAndroid: true },
    navigator: { onLine: false },
    document: { head: { appendChild() {} }, createElement() { return {}; } }
  };
  vm.runInNewContext(headScript, sandbox);

  assert.equal(typeof FakeBlob.prototype.arrayBuffer, 'function');
  assert.equal(typeof FakeBlob.prototype.text, 'function');

  const sample = new FakeBlob(new Uint8Array([0x44, 0x53, 0x44, 0x20]), 'DSD ');
  const ab = await sample.arrayBuffer();
  assert.deepEqual(Array.from(new Uint8Array(ab)), [0x44, 0x53, 0x44, 0x20]);
  assert.equal(await sample.text(), 'DSD ');
});

test('2. dsd-worker.js installs Chromium 74 Blob.prototype.arrayBuffer polyfill via FileReaderSync fast path + FileReader fallback', async () => {
  const workerCode = fs.readFileSync(DSD_WORKER, 'utf8');
  const polyStart = workerCode.indexOf('// Chromium 74 (FiiO M11S WebView 74) polyfill');
  const polyEnd = workerCode.indexOf('const DEFAULT_TARGET_RATE', polyStart);
  assert.ok(polyStart !== -1 && polyEnd > polyStart, 'dsd-worker.js must define Blob.prototype.arrayBuffer polyfill at top');
  const polyCode = workerCode.slice(polyStart, polyEnd);

  // Path A: FileReaderSync fast path inside Web Worker
  {
    function WorkerBlob(bytes) { this._bytes = bytes; }
    function FakeFileReaderSync() {}
    FakeFileReaderSync.prototype.readAsArrayBuffer = function (b) { return b._bytes.buffer; };
    const ctx = { Blob: WorkerBlob, FileReaderSync: FakeFileReaderSync, Promise, Error };
    vm.runInNewContext(polyCode, ctx);
    const out = await new WorkerBlob(new Uint8Array([1, 2, 3, 4])).arrayBuffer();
    assert.deepEqual(Array.from(new Uint8Array(out)), [1, 2, 3, 4]);
  }

  // Path B: Async FileReader fallback when FileReaderSync is unavailable
  {
    function WorkerBlob(bytes) { this._bytes = bytes; }
    function FakeFileReader() {}
    FakeFileReader.prototype.readAsArrayBuffer = function (b) {
      this.result = b._bytes.buffer;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    };
    const ctx = { Blob: WorkerBlob, FileReader: FakeFileReader, Promise, Error };
    vm.runInNewContext(polyCode, ctx);
    const out = await new WorkerBlob(new Uint8Array([9, 8, 7])).arrayBuffer();
    assert.deepEqual(Array.from(new Uint8Array(out)), [9, 8, 7]);
  }
});

test('3. MainActivity.java closes AssetFileDescriptor on IOException & maps .wv / .mka MIME types', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('if (lower.endsWith(".wv")) return "audio/x-wavpack";'), 'Must map .wv to audio/x-wavpack');
  assert.ok(java.includes('if (lower.endsWith(".mka")) return "audio/x-matroska";'), 'Must map .mka to audio/x-matroska');
  assert.ok(java.includes('catch (IOException openErr) {\n                try { afd.close(); } catch (IOException ignored) {}\n                throw openErr;\n            }'), 'streamContentUriResponse must close afd if createInputStream fails');
  assert.ok(java.includes('catch (IOException streamErr) {\n            try { afd.close(); } catch (IOException ignored) {}\n            throw streamErr;\n        }'), 'streamContentUriResponse must close afd if BoundedContentUriInputStream fails');
});

test('4. Version sync v3.9.23 (versionCode 77), Unix LF asset parity (including dsd-worker.js), and Web Audio invariants', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const dsdWorker = fs.readFileSync(DSD_WORKER, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');

  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'dsd-worker.js'), 'utf8'), dsdWorker);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8'), html);
  assert.equal(fs.readFileSync(path.join(ASSETS_DIR, 'sw.js'), 'utf8'), sw);
  assert.ok(!fs.readFileSync(path.join(ASSETS_DIR, 'dsd-worker.js'), 'utf8').includes('\r'));
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.23';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.23';"));
  assert.ok(gradle.includes('versionCode = 77'));
  assert.ok(gradle.includes('versionName = "3.9.23"'));
  assert.ok(/:\s*"3\.9\.\d+";/.test(java));
  assert.ok(/FiiO M11S · v3\.9\.\d+/.test(html));
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
});
