'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const HTML_404 = path.join(ROOT, '404.html');
const SW_JS = path.join(ROOT, 'sw.js');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const MAIN_JAVA = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const PUBLISH_JS = path.join(ROOT, '.agent', 'publish-release.cjs');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, 'Missing start marker: ' + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, 'Missing end marker: ' + endMarker);
  return src.slice(start, end);
}

test('1. Android BitPerfectAudioPlayer handles USB DAC hot-swap during pause & playback and applies API 34 Bit-Perfect mode on rebuilds', () => {
  const java = readFile(MAIN_JAVA);

  assert.ok(java.includes('private final java.util.concurrent.atomic.AtomicBoolean mRouteRefreshRequested = new java.util.concurrent.atomic.AtomicBoolean(false);'));
  assert.ok(java.includes('private volatile boolean mRouteRefreshWasDisconnect = false;'));
  assert.ok(java.includes('public void onAudioOutputRouteChanged(boolean connected)'), 'BitPerfectAudioPlayer must expose onAudioOutputRouteChanged');
  assert.ok(java.includes('mBitPerfectPlayer.onAudioOutputRouteChanged(connected);'), 'notifyUsbDacChange must wake BitPerfectAudioPlayer on route changes');
  assert.ok(java.includes('private void applyApi34BitPerfectMode(@Nullable AudioTrack track)'), 'BitPerfectAudioPlayer must extract applyApi34BitPerfectMode helper');
  assert.ok(java.includes('private AudioTrack createAndConfigureBitPerfectAudioTrack('), 'BitPerfectAudioPlayer must share createAndConfigureBitPerfectAudioTrack rebuild helper');

  const routeRefreshCalls = java.match(/mRouteRefreshRequested\.compareAndSet\(true,\s*false\)/g) || [];
  assert.equal(routeRefreshCalls.length, 2, 'Both outer pause loop and PCM write loop must handle mRouteRefreshRequested');
  assert.ok(java.includes('!mRouteRefreshRequested.get()'), 'Pause wait loops must wake on mRouteRefreshRequested');
  assert.ok(java.includes('Api34AudioHelper.clearPreferredMixer(mAudioManager, audioAttributes, preferredDevice);'), 'Route rebuild must clear stale API 34 mixer attributes first');

  const api34Calls = java.match(/applyApi34BitPerfectMode\(/g) || [];
  assert.ok(api34Calls.length >= 4, 'applyApi34BitPerfectMode must be declared and invoked across initial build, format change, and route/dead-object rebuilds');

  // Legacy Android invariants
  assert.ok(java.includes('notifyBitPerfectErrorToWeb(pendingErrorReason);'), 'Keep legacy notifyBitPerfectErrorToWeb invariant');
  assert.ok(java.includes('inSampleSize = computeCoverSampleSize'), 'Keep legacy computeCoverSampleSize invariant');
  assert.ok(java.includes('AudioTrack.ERROR_DEAD_OBJECT'), 'Keep ERROR_DEAD_OBJECT recovery');
  assert.ok(java.includes('track.getState() != AudioTrack.STATE_INITIALIZED'), 'Keep STATE_INITIALIZED invariant');
});

test('2. Web Bit-Perfect attachAudioElement clone preserves custom DAC sinkId & playbackRate on sampleRate AudioContext rebuild', async () => {
  const html = readFile(INDEX_HTML);
  const fnSrc = sliceBetween(html, 'function attachAudioElement(element) {', 'function createSoftLimiter(context) {');

  const sinkCalls = [];
  let attachEventsCount = 0;
  let createMediaCalls = 0;
  const fakeRouterGain = { gain: { value: 0 }, connect: () => {} };
  const cloneEl = {
    defaultMuted: true,
    muted: false,
    playbackRate: 1.0,
    pause: () => {},
    removeAttribute: () => {},
    setSinkId: async (id) => { sinkCalls.push(id); }
  };
  const oldEl = {
    sinkId: 'usb-dac-balanced-44100',
    parentNode: {
      replaceChild: (next, prev) => {
        assert.equal(next, cloneEl);
        assert.equal(prev, oldEl);
      }
    },
    pause: () => {},
    cloneNode: () => cloneEl
  };

  const ctx = {
    audio: oldEl,
    standbyAudio: {},
    state: {
      playbackRate: 1.25,
      context: {
        createMediaElementSource: (el) => {
          createMediaCalls++;
          if (createMediaCalls === 1) throw new Error('InvalidStateError: already connected to previous AudioContext');
          return { connect: () => {} };
        },
        createGain: () => ({ gain: { value: 1 }, connect: () => {} })
      }
    },
    localStorage: { getItem: () => 'usb-dac-balanced-44100' },
    attachDeckEvents: () => { attachEventsCount++; }
  };

  vm.runInNewContext(fnSrc, ctx);
  const routerGainOverrideCtx = Object.assign(ctx, {
    state: Object.assign(ctx.state, {
      context: {
        createMediaElementSource: ctx.state.context.createMediaElementSource,
        createGain: () => ({ gain: { value: 1 }, connect: () => {} })
      }
    })
  });
  const deck = routerGainOverrideCtx.attachAudioElement(oldEl);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(createMediaCalls, 2);
  assert.equal(deck.element, cloneEl);
  assert.equal(ctx.audio, cloneEl);
  assert.equal(attachEventsCount, 1);
  assert.deepEqual(sinkCalls, ['usb-dac-balanced-44100'], 'Cloned <audio> element must preserve active DAC sinkId');
  assert.equal(cloneEl.playbackRate, 1.25, 'Cloned <audio> element must preserve active playbackRate');
});

test('3. Android SAF revoked-URI early detection (hasValidPersistedUriPermission + /local-media HEAD probe) & playTrack 403 messaging', async () => {
  const html = readFile(INDEX_HTML);
  const localHelpersSrc = sliceBetween(
    html,
    'async function probeLocalMediaAccessError(mediaUrl) {',
    '// Pha C — hủy bản preload cũ'
  );

  // 3.1 SAF URI with revoked grant & 403 X-Nocturne-Storage-Error -> marks permission_denied & blocks empty URL
  {
    const headCalls = [];
    const safUri = 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2Ftrack.flac';
    const track = {
      id: 'saf-1',
      source: 'local',
      uri: safUri,
      url: 'https://appassets.androidplatform.net/local-media?uri=' + encodeURIComponent(safUri),
      _localAccessError: ''
    };
    const sandbox = {
      fetch: async (url, opts) => {
        headCalls.push({ url, method: opts && opts.method });
        return {
          status: 403,
          headers: { get: (k) => (k === 'X-Nocturne-Storage-Error' ? 'SAF_PERMISSION_REVOKED' : null) }
        };
      },
      AbortController,
      window: {
        NocturneNative: {
          hasValidPersistedUriPermission: (u) => {
            assert.equal(u, safUri);
            return false;
          }
        }
      },
      restoreLocalTrackUrlSync: () => {},
      state: { tracks: [track], objectUrls: new Set() },
      setTimeout,
      clearTimeout,
      URL
    };
    vm.runInNewContext(localHelpersSrc, sandbox);
    const outUrl = await sandbox.ensureLocalTrackPlayableUrl(track, { requestPermission: true });
    assert.equal(outUrl, '', 'Revoked SAF track with 403 probe must return empty URL');
    assert.equal(track._localAccessError, 'permission_denied');
    assert.equal(headCalls.length, 1);
    assert.equal(headCalls[0].method, 'HEAD');
  }

  // 3.2 SAF URI with revoked SAF grant BUT MainActivity physical path fallback succeeds (HEAD 200 OK) -> still playable!
  {
    const safUri = 'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2Ffallback.flac';
    const playableUrl = 'https://appassets.androidplatform.net/local-media?uri=' + encodeURIComponent(safUri) + '&path=' + encodeURIComponent('/sdcard/Music/fallback.flac');
    const track = {
      id: 'saf-2',
      source: 'local',
      uri: safUri,
      path: '/sdcard/Music/fallback.flac',
      url: playableUrl,
      _localAccessError: ''
    };
    const sandbox = {
      fetch: async () => ({ status: 200, headers: { get: () => null } }),
      AbortController,
      window: { NocturneNative: { hasValidPersistedUriPermission: () => false } },
      restoreLocalTrackUrlSync: () => {},
      state: { tracks: [track], objectUrls: new Set() },
      setTimeout,
      clearTimeout,
      URL
    };
    vm.runInNewContext(localHelpersSrc, sandbox);
    const outUrl = await sandbox.ensureLocalTrackPlayableUrl(track);
    assert.equal(outUrl, playableUrl, 'Track rescued by MainActivity physical/MediaStore fallback must remain playable');
    assert.equal(track._localAccessError, '');
  }

  // 3.3 Standard MediaStore content://media/... URI does NOT query SAF persisted permissions unnecessarily
  {
    let persistedChecked = 0;
    const msUri = 'content://media/external/audio/media/99';
    const msUrl = 'https://appassets.androidplatform.net/local-media?uri=' + encodeURIComponent(msUri);
    const track = { id: 'ms-99', source: 'local', uri: msUri, url: msUrl, _localAccessError: '' };
    const sandbox = {
      fetch: async () => { throw new Error('Should not probe HEAD for healthy MediaStore URI'); },
      AbortController,
      window: {
        NocturneNative: {
          hasValidPersistedUriPermission: () => {
            persistedChecked++;
            return false;
          }
        }
      },
      restoreLocalTrackUrlSync: () => {},
      state: { tracks: [track], objectUrls: new Set() },
      setTimeout,
      clearTimeout,
      URL
    };
    vm.runInNewContext(localHelpersSrc, sandbox);
    const outUrl = await sandbox.ensureLocalTrackPlayableUrl(track);
    assert.equal(persistedChecked, 0, 'MediaStore URIs must bypass SAF permission check');
    assert.equal(outUrl, msUrl);
  }

  // 3.4 playTrack catch probes /local-media? for SAF 403 and onAndroidAudioDeviceChanged refreshes output list & resumes suspended context
  const playTrackSrc = sliceBetween(html, 'async function playTrack(trackId) {', 'function stopDsdWorker(');
  assert.ok(playTrackSrc.includes("const localAccessErr = await probeLocalMediaAccessError(playUrl).catch(() => '');"));
  assert.ok(playTrackSrc.includes("if (localAccessErr === 'permission_denied')"));

  const devChangeSrc = sliceBetween(html, 'window.onAndroidAudioDeviceChanged = (deviceName, connected) => {', 'let activeScreenWakeLock = null;');
  assert.ok(devChangeSrc.includes('refreshAudioOutputDevices()'), 'onAndroidAudioDeviceChanged must refresh enumerated audio outputs');
  assert.ok(devChangeSrc.includes("state.context.state === 'suspended'") && devChangeSrc.includes('state.context.resume()'), 'onAndroidAudioDeviceChanged must resume suspended Web Audio context when DAC reconnects');
});

test('4. Version v3.9.74 / versionCode 128 sync, 404.html parity, Web Audio invariants, 0 ES2020+ syntax & 0 CR bytes', () => {
  const html = readFile(INDEX_HTML);
  const html404 = fs.readFileSync(HTML_404);
  const sw = readFile(SW_JS);
  const gradle = readFile(BUILD_GRADLE);
  const java = readFile(MAIN_JAVA);
  const pub = readFile(PUBLISH_JS);

  assert.equal(html404.toString('utf8'), html, '404.html must match index.html');
  assert.equal(html404.includes(0x0d), false, '404.html must contain 0 CR bytes');
  assert.ok(/FiiO M11S · v3\.9\.(?:7[4-9]|[89]\d|\d{3,})/.test(html), 'index.html FiiO badge must be >= v3.9.74');
  assert.ok(/const CACHE_VERSION = 'v3\.9\.(?:7[4-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_VERSION must be >= v3.9.74');
  assert.ok(/const CACHE_NAME = 'nocturne-v3\.9\.(?:7[4-9]|[89]\d|\d{3,})';/.test(sw), 'sw.js CACHE_NAME must be >= nocturne-v3.9.74');
  assert.ok(/versionCode\s*=\s*(?:12[89]|1[3-9]\d|[2-9]\d{2,})\b/.test(gradle), 'build.gradle.kts versionCode must be >= 128');
  assert.ok(/versionName = "3\.9\.(?:7[4-9]|[89]\d|\d{3,})"/.test(gradle), 'build.gradle.kts versionName must be >= 3.9.74');
  assert.ok(/"3\.9\.(?:7[4-9]|[89]\d|\d{3,})"/.test(java), 'MainActivity.java fallback versionName must be >= 3.9.74');
  assert.ok(/v3\.9\.(?:7[4-9]|[89]\d|\d{3,})/.test(pub) && /versionCode\s+(?:12[89]|1[3-9]\d|[2-9]\d{2,})/.test(pub), 'publish-release.cjs must target >= v3.9.74 / versionCode >= 128');

  // Web Audio invariants
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  assert.ok(html.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'));
  assert.ok(html.includes('target.volume = audio.volume; target.muted = false;'));

  const syncedFiles = [
    'index.html', 'tailwind.min.css',
    'library-utils.js', 'metadata-utils.js', 'cloud-metadata.js', 'sw.js',
    'autoeq-cue.js', 'dsd-worker.js', 'library-tools.js', 'lrclib-client.js',
    'lyrics-editor-ui.js', 'lyrics-utils.js', 'metadata-ui.js', 'ui-overlay.js', 'virtual-scroll.js'
  ];
  for (const f of syncedFiles) {
    const assetBuf = fs.readFileSync(path.join(ASSETS_DIR, f));
    assert.equal(assetBuf.includes(0x0d), false, `${f} in android assets must have 0 CR bytes (Unix LF)`);
  }

  const scriptStart = html.lastIndexOf('<script>');
  const scriptEnd = html.lastIndexOf('</script>');
  const codeFiles = [['index.html <script>', html.slice(scriptStart + 8, scriptEnd)]];
  for (const f of syncedFiles.filter((name) => name.endsWith('.js'))) {
    codeFiles.push([f, readFile(path.join(ROOT, f))]);
  }
  for (const [label, src] of codeFiles) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const stripped = lines[i]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/\/.*?[^\\]\/[gimsuy]*/g, '""');
      assert.equal(/\?\./.test(stripped), false, `${label}:${i + 1} must not contain (?.)`);
      assert.equal(/\?\?(?!\?)/.test(stripped), false, `${label}:${i + 1} must not contain (??)`);
      assert.equal(/\.replaceAll\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .replaceAll()`);
      assert.equal(/\.at\s*\(/.test(stripped), false, `${label}:${i + 1} must not contain .at()`);
      assert.equal(/\bcatch\s*\{/.test(stripped), false, `${label}:${i + 1} must not contain bare catch {}`);
    }
  }
});
