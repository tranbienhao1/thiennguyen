'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

test('1. MainActivity.java separates explicit Play/Pause/Stop MediaSession & Bluetooth commands from toggle and keeps pure ES5 JS', () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(java.includes('public void dispatchPlayToWeb()'), 'dispatchPlayToWeb must exist');
  assert.ok(java.includes('public void dispatchPauseToWeb()'), 'dispatchPauseToWeb must exist');
  assert.match(java, /case KeyEvent\.KEYCODE_MEDIA_PLAY:\s+dispatchPlayToWeb\(\);/);
  assert.match(java, /case KeyEvent\.KEYCODE_MEDIA_PAUSE:\s+case KeyEvent\.KEYCODE_MEDIA_STOP:\s+dispatchPauseToWeb\(\);/);
  assert.match(java, /onPlay\(\)\s*\{\s*dispatchPlayToWeb\(\);/);
  assert.match(java, /onPause\(\)\s*\{\s*dispatchPauseToWeb\(\);/);
  assert.match(java, /onStop\(\)\s*\{\s*dispatchPauseToWeb\(\);/);

  const dispatchSlice = java.slice(java.indexOf('public void dispatchPlayPauseToWeb()'), java.indexOf('public void dispatchNextToWeb()'))
    .replace(/\/\/.*$/gm, '');
  assert.ok(!dispatchSlice.includes('?.'), 'JS injected by dispatchPlay/Pause must remain ES5/Chromium 74 safe');
});

test('2. window.onHardwarePlay & onHardwarePause avoid inverse-toggling playback state in Web Audio and Bit-Perfect modes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('window.onHardwarePlayPause =');
  const end = html.indexOf('window.onHardwareNext =', start);
  assert.ok(start > 0 && end > start);

  let clicks = 0;
  const sandbox = {
    window: {},
    state: { isNativeBitPerfectPlaying: false, isNativeBitPerfectPaused: false },
    audio: { paused: true },
    $: (id) => (id === 'play-button' ? { click: () => { clicks++; } } : null)
  };
  vm.runInNewContext(html.slice(start, end), sandbox);

  // Audio paused: Play clicks, Pause is no-op
  sandbox.window.onHardwarePause();
  assert.equal(clicks, 0, 'Pause when already paused must not click toggle');
  sandbox.window.onHardwarePlay();
  assert.equal(clicks, 1, 'Play when paused must start playback');

  // Audio playing: Play is no-op, Pause clicks
  sandbox.audio.paused = false;
  sandbox.window.onHardwarePlay();
  assert.equal(clicks, 1, 'Play when already playing must not click toggle');
  sandbox.window.onHardwarePause();
  assert.equal(clicks, 2, 'Pause when playing must pause playback');

  // Native Bit-Perfect guard
  sandbox.state.isNativeBitPerfectPlaying = true;
  sandbox.state.isNativeBitPerfectPaused = false;
  sandbox.window.onHardwarePlay();
  assert.equal(clicks, 2, 'Play during active Bit-Perfect playback must be a no-op');
  sandbox.state.isNativeBitPerfectPaused = true;
  sandbox.window.onHardwarePause();
  assert.equal(clicks, 2, 'Pause when Bit-Perfect is already paused must be a no-op');
});

test('3. MainActivity.readLocalLyrics & triggerLyricsFetch load offline MicroSD .lrc / FLAC lyrics with zero network calls', async () => {
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');
  assert.ok(java.includes('@JavascriptInterface\n        public String readLocalLyrics(') || java.includes('@JavascriptInterface\r\n        public String readLocalLyrics(') || java.includes('public String readLocalLyrics('), 'readLocalLyrics bridge must be exposed');
  assert.ok(java.includes('extractFlacVorbisLyricsFromFile('), 'FLAC Vorbis LYRICS/UNSYNCEDLYRICS extraction must exist');
  assert.ok(java.includes('256 * 1024') && java.includes('512 * 1024'), 'file read safety caps must be enforced');
  assert.ok(java.includes('StandardCharsets.UTF_16LE') && java.includes('StandardCharsets.UTF_16BE'), 'UTF-16 BOM LRC decoding must be supported');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('let _activeLyricsFetchController = null;');
  const blockEnd = html.indexOf('    function updateLyricsHighlight()', start);
  assert.ok(start > 0 && blockEnd > start, 'triggerLyricsFetch block must be extractable');
  const block = html.slice(start, blockEnd);

  const rendered = [];
  const savedVault = [];
  let fetchCalls = 0;

  const sandbox = {
    window: {
      NocturneNative: {
        readLocalLyrics(p, u) {
          assert.equal(p, '/storage/AAAA-1111/Music/Song.flac');
          return '\uFEFF[00:10.00]Offline FiiO LRC Lyric';
        }
      },
      LrclibClient: {
        async findLocalSidecarLyrics() { return null; },
        async saveLyricsToVault(k, v) { savedVault.push({ k, v }); }
      }
    },
    state: { currentId: 'fiio_lrc_1', lyrics: [], tracks: [] },
    library: lib,
    $: () => null,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => { fetchCalls++; throw new Error('Should not hit network for offline local LRC'); },
    renderLyrics: (txt, meta) => { rendered.push({ txt, meta }); },
    toast: () => {},
    AbortController: globalThis.AbortController,
    console
  };

  vm.runInNewContext(block + '\nthis.triggerLyricsFetch = triggerLyricsFetch;', sandbox);
  const track = { id: 'fiio_lrc_1', title: 'Song', artist: 'Singer', path: '/storage/AAAA-1111/Music/Song.flac' };
  await sandbox.triggerLyricsFetch(track);

  assert.equal(fetchCalls, 0, 'Must not perform network fetch when offline LRC is found');
  assert.equal(track.lyricsSource, 'local-sidecar');
  assert.ok(track.lyricsText.includes('[00:10.00]Offline FiiO LRC Lyric'));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].meta.isSynced, true);
  assert.equal(savedVault.length, 1);
});

test('4. loadCloudMetadata merges FLAC/MP4 Vorbis tags, albumArtist, lyrics, ReplayGain & preserves existing sibling cover', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('async function loadCloudMetadata(track, blob) {');
  const end = html.indexOf('function finishCloudMetadataInBackground(track, blob) {', start);
  assert.ok(start > 0 && end > start);

  const renderedLyrics = [];
  const dom = { duration: { textContent: '0:00' }, 'duration-mobile': { textContent: '0:00' } };
  let flacTechResult = {
    title: 'Ngày Xuân Long Phụng Sum Vầy',
    artist: 'Minh Vương',
    album: 'Xuân Sum Vầy',
    albumArtist: 'Various Artists',
    lyrics: '[00:05.00]Xuân đã về',
    cover: 'data:image/jpeg;base64,QUJD',
    sampleRate: 96000,
    bitDepth: 24,
    channels: 2,
    duration: 245.5,
    replayGainTrackGain: -4.2,
    replayGainTrackPeak: 0.98
  };

  const sandbox = {
    trackMetadataRevision: 0,
    filterOptionsSignature: 'old',
    state: { currentId: 'google:1', lyrics: [], tracks: [], albumCovers: new Map() },
    library: lib,
    File: function MockFile(parts, name) { this.name = name; this.size = 1024; },
    $: (id) => dom[id] || null,
    formatTime: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
    filenameMetadata: () => ({ title: 'fallback', artist: 'Unknown Artist', album: 'Unknown Album' }),
    getTags: async () => ({ title: undefined, artist: '', album: null, cover: undefined }),
    readAudioMetadata: async () => flacTechResult,
    normalizeCoverImage: async (c) => c || '',
    syncAlbumCoversImmediate: () => {},
    updateMetadataFilters: () => {},
    scheduleTrackRender: () => {},
    renderLyrics: (txt, entry) => renderedLyrics.push({ txt, entry }),
    console
  };

  vm.runInNewContext(html.slice(start, end) + '\nthis.loadCloudMetadata = loadCloudMetadata;', sandbox);

  const track1 = { id: 'google:1', source: 'google', name: '01.flac', format: 'FLAC', title: '01' };
  await sandbox.loadCloudMetadata(track1, { type: 'audio/flac' });

  assert.equal(track1.title, 'Ngày Xuân Long Phụng Sum Vầy');
  assert.equal(track1.artist, 'Minh Vương');
  assert.equal(track1.album, 'Xuân Sum Vầy');
  assert.equal(track1.albumArtist, 'Various Artists');
  assert.equal(track1.lyricsText, '[00:05.00]Xuân đã về');
  assert.equal(track1.cover, 'data:image/jpeg;base64,QUJD');
  assert.equal(track1.sampleRate, 96000);
  assert.equal(track1.replayGainTrackGain, -4.2);
  assert.equal(dom.duration.textContent, '4:05');
  assert.equal(renderedLyrics.length, 1, 'newly discovered embedded lyrics on playing track should render immediately');

  // Preserve pre-existing Drive/OneDrive sibling cover when file lacks embedded art
  flacTechResult = { sampleRate: 44100, bitDepth: 16, channels: 2, duration: 180 };
  const track2 = { id: 'onedrive:2', source: 'onedrive', name: '02.flac', format: 'FLAC', cover: 'https://example.com/folder.jpg' };
  await sandbox.loadCloudMetadata(track2, { type: 'audio/flac' });
  assert.equal(track2.cover, 'https://example.com/folder.jpg', 'must preserve sibling folder cover when embedded art is absent');
});

test('5. Version sync v3.9.37 / versionCode 91, Unix LF parity & zero Chromium 74 ES2020+ syntax', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/nocturne/audiophile/MainActivity.java'), 'utf8');

  assert.ok(indexHtml.includes('FiiO M11S · v3.9.37'));
  assert.ok(swJs.includes("const CACHE_VERSION = 'v3.9.37';"));
  assert.ok(swJs.includes("const CACHE_NAME = 'nocturne-v3.9.37';"));
  assert.ok(/versionCode\s*=\s*91\b/.test(gradle));
  assert.ok(/versionName\s*=\s*"3\.9\.37"/.test(gradle));
  assert.ok(mainActivity.includes('"3.9.37"'));

  assert.ok(!fs.readFileSync(path.join(ROOT, '404.html')).includes(13), '404.html must have 0 CR bytes');
  assert.equal(fs.readFileSync(path.join(ROOT, '404.html'), 'utf8'), indexHtml, '404.html must equal index.html');

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const rel of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets', rel));
    assert.ok(!assetBuf.includes(13), `${rel} in android assets must have 0 CR bytes`);
  }
  const filesToScan = syncedFiles.filter(f => f !== 'tailwind.min.css');
  for (const rel of filesToScan) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    assert.ok(!/[^\w$]\?\.\w|\?\.\[|\?\.\(/.test(stripped), `${rel} must not use optional chaining (?.)`);
    assert.ok(!/\?\?[^=]/.test(stripped), `${rel} must not use nullish coalescing (??)`);
    assert.ok(!/\.replaceAll\s*\(/.test(stripped), `${rel} must not use .replaceAll()`);
    assert.ok(!/\bcatch\s*\{/.test(stripped), `${rel} must not use bare catch {}`);
  }
});
