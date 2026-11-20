'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const mainActivityPath = path.join(
  rootDir,
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'nocturne',
  'audiophile',
  'MainActivity.java'
);
const indexHtmlPath = path.join(rootDir, 'index.html');
const html404Path = path.join(rootDir, '404.html');
const assetIndexPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'index.html');
const libraryUtilsPath = path.join(rootDir, 'library-utils.js');
const assetLibraryUtilsPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'library-utils.js');
const swPath = path.join(rootDir, 'sw.js');
const assetSwPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'sw.js');

const library = require('../library-utils.js');
const mainJava = fs.readFileSync(mainActivityPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

const inlineScripts = [...indexHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim())
  .filter(Boolean);
const appCode = inlineScripts.join('\n');

function extractFunction(code, name) {
  let start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should be defined in index.html`);
  if (code.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const brace = code.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

test('Android APK Audio Playback & Native Media Engine Fix Suite (All 8 Root Causes)', async (t) => {

  await t.test('1. MainActivity.java BoundedContentUriInputStream & handleLocalMediaStreaming content:// + /local-media?uri=... + CORS headers', () => {
    assert.match(
      mainJava,
      /class\s+BoundedContentUriInputStream\s+extends\s+InputStream/,
      'BoundedContentUriInputStream must be implemented for Android 11-15 Scoped Storage content:// streaming'
    );
    assert.match(
      mainJava,
      /openAssetFileDescriptor\s*\(\s*contentUri\s*,\s*["']r["']\s*\)/,
      'Must open content:// URIs via ContentResolver.openAssetFileDescriptor(contentUri, "r")'
    );
    assert.match(
      mainJava,
      /getStatSize\s*\(\s*\)/,
      'Must fall back to ParcelFileDescriptor.getStatSize() when AssetFileDescriptor.getLength() is unknown'
    );
    assert.match(
      mainJava,
      /uri\.getQueryParameter\s*\(\s*["']uri["']\s*\)/,
      'handleLocalMediaStreaming must accept /local-media?uri=<encoded_content_uri>'
    );
    assert.match(
      mainJava,
      /uri\.getQueryParameter\s*\(\s*["']name["']\s*\)/,
      'handleLocalMediaStreaming must accept optional &name=<filename> parameter for MIME resolution'
    );
    assert.match(
      mainJava,
      /resolver\.getType\s*\(\s*contentUri\s*\)/,
      'Must fall back to ContentResolver.getType(contentUri) for MIME resolution'
    );
    assert.match(
      mainJava,
      /class\s+BoundedFileInputStream\s+extends\s+InputStream/,
      'Existing BoundedFileInputStream must remain intact for legacy /local-media?path=... streaming'
    );
    // Verify CORS headers helper includes required headers
    assert.ok(mainJava.includes('headers.put("Access-Control-Allow-Origin", "*");'));
    assert.ok(mainJava.includes('headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");'));
    assert.ok(mainJava.includes('headers.put("Access-Control-Allow-Headers", "*");'));
    assert.ok(mainJava.includes('headers.put("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");'));
    // Verify getAudioMimeType mappings
    assert.ok(mainJava.includes('if (lower.endsWith(".flac")) return "audio/flac";'));
    assert.ok(mainJava.includes('if (lower.endsWith(".wav")) return "audio/wav";'));
    assert.ok(mainJava.includes('if (lower.endsWith(".mp3")) return "audio/mpeg";'));
    assert.ok(mainJava.includes('if (lower.endsWith(".m4a") || lower.endsWith(".alac")) return "audio/mp4";'));
    assert.ok(mainJava.includes('if (lower.endsWith(".aac")) return "audio/aac";'));
  });

  await t.test('2. MainActivity.java scanMediaStoreAudio + FLAG_GRANT_READ_URI_PERMISSION + onAndroidStoragePermissionGranted', () => {
    assert.match(
      mainJava,
      /@JavascriptInterface\s+public\s+String\s+scanMediaStoreAudio\s*\(\s*int\s+maxFiles\s*\)/,
      'WebAppInterface must expose @JavascriptInterface scanMediaStoreAudio(int maxFiles)'
    );
    assert.ok(
      mainJava.includes('MediaStore.Audio.Media.EXTERNAL_CONTENT_URI'),
      'scanMediaStoreAudio must query MediaStore.Audio.Media.EXTERNAL_CONTENT_URI'
    );
    assert.ok(
      mainJava.includes('ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id)'),
      'scanMediaStoreAudio must construct canonical content:// URIs via ContentUris.withAppendedId'
    );
    for (const col of ['_ID', 'DISPLAY_NAME', 'TITLE', 'ARTIST', 'ALBUM', 'DURATION', 'SIZE', 'MIME_TYPE', 'DATA']) {
      assert.ok(
        mainJava.includes(`MediaStore.Audio.Media.${col}`),
        `scanMediaStoreAudio projection must include MediaStore.Audio.Media.${col}`
      );
    }

    // Chooser URI permission flags
    const chooserStart = mainJava.indexOf('public boolean launchDapMusicChooser');
    const chooserEnd = mainJava.indexOf('private static boolean isLocalOrPrivateNetwork', chooserStart);
    assert.ok(chooserStart > 0 && chooserEnd > chooserStart);
    const chooserBlock = mainJava.slice(chooserStart, chooserEnd);
    const readPermMatches = chooserBlock.match(/Intent\.FLAG_GRANT_READ_URI_PERMISSION/g) || [];
    assert.ok(readPermMatches.length >= 4, 'All chooser intents must include FLAG_GRANT_READ_URI_PERMISSION');
    assert.ok(
      chooserBlock.includes('Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION'),
      'openDocIntent must include FLAG_GRANT_PERSISTABLE_URI_PERMISSION'
    );

    // Runtime permission callback notifies JS
    assert.ok(
      mainJava.includes('window.onAndroidStoragePermissionGranted'),
      'mPermissionLauncher must notify window.onAndroidStoragePermissionGranted() when audio/storage permission is granted'
    );
  });

  await t.test('3. MainActivity.java OnAudioFocusChangeListener never self-pauses WebView or pauses on CAN_DUCK', () => {
    const focusStart = mainJava.indexOf('public boolean requestAudioFocus()');
    const focusEnd = mainJava.indexOf('public void abandonAudioFocus()', focusStart);
    assert.ok(focusStart > 0 && focusEnd > focusStart, 'requestAudioFocus and abandonAudioFocus must exist');
    const focusBlock = mainJava.slice(focusStart, focusEnd);

    assert.ok(
      !focusBlock.includes("$('play-button')?.click()"),
      'OnAudioFocusChangeListener must NEVER click #play-button on WebView (prevents WebView self-pause bug)'
    );
    const duckCaseMatch = focusBlock.match(/case\s+AudioManager\.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:([\s\S]*?)break;/);
    assert.ok(duckCaseMatch, 'AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK case must exist');
    assert.ok(
      !duckCaseMatch[1].includes('.pause()') && !duckCaseMatch[1].includes('play-button'),
      'AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK must never pause playback'
    );
    assert.ok(
      focusBlock.includes('mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()') &&
      focusBlock.includes('mBitPerfectPlayer.pause()'),
      'AUDIOFOCUS_LOSS / LOSS_TRANSIENT must only pause native mBitPerfectPlayer when actively playing'
    );
  });

  await t.test('4. MainActivity.java BitPerfectAudioPlayer content:// URI support, live position updates, and error fallback', () => {
    const bpStart = mainJava.indexOf('public class BitPerfectAudioPlayer');
    const bpEnd = mainJava.indexOf('public static class WebAppInterface', bpStart);
    assert.ok(bpStart > 0 && bpEnd > bpStart);
    const bpBlock = mainJava.slice(bpStart, bpEnd);

    assert.ok(
      bpBlock.includes('trimmedUrl.startsWith("blob:")'),
      'BitPerfectAudioPlayer.start must reject blob: URLs so Web Audio handles them'
    );
    assert.ok(
      bpBlock.includes('parsedLocal.getQueryParameter("uri")'),
      'BitPerfectAudioPlayer.runPlaybackLoop must unwrap /local-media?uri=... query parameter'
    );
    assert.ok(
      bpBlock.includes('extractor.setDataSource(MainActivity.this, Uri.parse(resolvedUri), null)'),
      'BitPerfectAudioPlayer.runPlaybackLoop must open content:// URIs via MediaExtractor.setDataSource(Context, Uri, null)'
    );
    assert.ok(
      bpBlock.includes('window.onNativeBitPerfectPosition('),
      'BitPerfectAudioPlayer.runPlaybackLoop must post live position updates to window.onNativeBitPerfectPosition'
    );
    assert.ok(
      bpBlock.includes('window.onNativeBitPerfectError('),
      'BitPerfectAudioPlayer.runPlaybackLoop must post errors to window.onNativeBitPerfectError so JS falls back to Web Audio'
    );
  });

  await t.test('5. library-utils.js createFiioTrack & parseFiioScanResults support content:// URIs + MediaStore metadata + legacy path backwards compatibility', () => {
    // A. Content URI with full MediaStore tags
    const msTrack = library.createFiioTrack({
      uri: 'content://media/external/audio/media/501',
      name: '01 - Hotel California.flac',
      title: 'Hotel California (Live)',
      artist: 'Eagles',
      album: 'Hell Freezes Over',
      duration: 432.4,
      size: 52428800,
      mimeType: 'audio/flac',
      path: '/storage/emulated/0/Music/Eagles/01 - Hotel California.flac'
    });
    assert.ok(msTrack);
    assert.ok(msTrack.id.startsWith('fiio_'));
    assert.equal(msTrack.uri, 'content://media/external/audio/media/501');
    assert.equal(
      msTrack.url,
      'https://appassets.androidplatform.net/local-media?uri=' +
        encodeURIComponent('content://media/external/audio/media/501') +
        '&name=' +
        encodeURIComponent('01 - Hotel California.flac')
    );
    assert.equal(msTrack.title, 'Hotel California (Live)');
    assert.equal(msTrack.artist, 'Eagles');
    assert.equal(msTrack.album, 'Hell Freezes Over');
    assert.equal(msTrack.duration, 432.4);
    assert.equal(msTrack.format, 'FLAC');
    assert.equal(msTrack.isDsd, false);

    // B. Content URI with <unknown> tags falls back cleanly to filename parsing
    const unknownTagTrack = library.createFiioTrack({
      uri: 'content://media/external/audio/media/502',
      name: 'Norah Jones - Come Away With Me.flac',
      title: '<unknown>',
      artist: '<unknown>',
      album: '<unknown>',
      duration: 198,
      size: 24000000
    });
    assert.equal(unknownTagTrack.artist, 'Norah Jones');
    assert.equal(unknownTagTrack.title, 'Come Away With Me');
    assert.ok(unknownTagTrack.url.includes('/local-media?uri=content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F502'));

    // C. Legacy path-only backwards compatibility
    const legacyTrack = library.createFiioTrack({
      name: '01 - Hotel California.flac',
      path: '/storage/0000-0000/Music/Eagles/01 - Hotel California.flac',
      size: 45678901
    });
    assert.equal(legacyTrack.title, '01 - Hotel California');
    assert.equal(legacyTrack.artist, 'Unknown Artist');
    assert.equal(legacyTrack.album, 'FiiO Internal & SD Card');
    assert.equal(
      legacyTrack.url,
      'https://appassets.androidplatform.net/local-media?path=' +
        encodeURIComponent('/storage/0000-0000/Music/Eagles/01 - Hotel California.flac')
    );

    // D. parseFiioScanResults deduplicates across MediaStore uri and directory path
    const merged = library.parseFiioScanResults([
      {
        uri: 'content://media/external/audio/media/77',
        name: 'SongA.flac',
        title: 'Song A Tagged',
        artist: 'Artist A',
        path: '/storage/emulated/0/Music/SongA.flac',
        size: 1000
      },
      {
        name: 'SongA.flac',
        path: '/storage/emulated/0/Music/SongA.flac',
        size: 1000
      },
      {
        uri: 'content://media/external/audio/media/88',
        name: 'ScopedOnly.m4a',
        title: 'Scoped Only',
        path: '',
        size: 2000
      }
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].title, 'Song A Tagged');
    assert.ok(merged[0].url.includes('uri=content%3A'));
    assert.equal(merged[1].title, 'Scoped Only');
  });

  await t.test('6. index.html pickLocalFiles Android gesture preservation, Fast-Tap native button bypass, AudioContext unlocker & metadata timeouts', async () => {
    // Test pickLocalFiles calls file-input.click() synchronously on Android without calling showOpenFilePicker
    let fileInputClicked = 0;
    let openPickerCalled = 0;
    const pickFnCode = extractFunction(appCode, 'pickLocalFiles');
    const runPick = new Function('window', '$', 'addLocalFiles', `${pickFnCode}\nreturn pickLocalFiles;`);
    const pickLocalFiles = runPick(
      {
        isNativeAndroid: true,
        showOpenFilePicker: async () => { openPickerCalled++; return []; }
      },
      id => (id === 'file-input' ? { click() { fileInputClicked++; } } : null),
      async () => {}
    );
    await pickLocalFiles();
    assert.equal(fileInputClicked, 1, 'pickLocalFiles must click #file-input immediately on Android');
    assert.equal(openPickerCalled, 0, 'pickLocalFiles must bypass window.showOpenFilePicker on Android');

    // Fast-Tap skips native <button>, <a>, <summary>, <label> to preserve trusted user activation
    assert.ok(
      appCode.includes("target?.closest?.('input, select, textarea, .seek-range, button, a, summary, label')"),
      'Fast-Tap touchend must skip native button/a/summary/label elements'
    );
    assert.ok(
      appCode.includes("document.addEventListener('pointerdown', unlockAudioContextOnGesture"),
      'Document must attach passive trusted gesture AudioContext unlocker'
    );

    // 2500ms timeout guard on getTags and readAudioMetadata
    const getTagsCode = extractFunction(appCode, 'getTags');
    const readMetaCode = extractFunction(appCode, 'readAudioMetadata');
    assert.ok(getTagsCode.includes('2500'), 'getTags must enforce a 2500ms timeout fallback');
    assert.ok(readMetaCode.includes('2500'), 'readAudioMetadata must enforce a 2500ms timeout fallback');
  });

  await t.test('7. index.html cold-start crossfade unity gain (1.0), DSD unmute fix, waveform Android OOM guard & Bit-Perfect/CORS fallbacks', async () => {
    function createMockGainParam(initial = 0) {
      return {
        value: initial,
        calls: [],
        cancelScheduledValues(t) { this.calls.push({ m: 'cancelScheduledValues', t }); },
        cancelAndHoldAtTime(t) { this.calls.push({ m: 'cancelAndHoldAtTime', t }); },
        setValueAtTime(v, t) { this.value = v; this.calls.push({ m: 'setValueAtTime', v, t }); },
        setTargetAtTime(v, t, tc) { this.calls.push({ m: 'setTargetAtTime', v, t, tc }); },
        setValueCurveAtTime(vals, t, d) { this.calls.push({ m: 'setValueCurveAtTime', vals: Array.from(vals), t, d }); }
      };
    }

    class MockAudioEl {
      constructor() {
        this.src = '';
        this.paused = true;
        this.muted = true;
        this.currentTime = 0;
        this.volume = 0.72;
      }
      pause() { this.paused = true; }
      removeAttribute(attr) { if (attr === 'src') this.src = ''; }
      load() {}
      async play() { this.paused = false; }
    }

    // A. Cold-start finishPlaybackStart even with crossfadeSeconds = 5 -> immediate unity gain 1.0 (0s fade!)
    const applyCfCode = extractFunction(appCode, 'applyCrossfade');
    const finishCode = extractFunction(appCode, 'finishPlaybackStart');
    const elA = new MockAudioEl();
    const elB = new MockAudioEl();
    elB.src = 'https://appassets.androidplatform.net/local-media?uri=content%3A%2F%2Fmedia%2Fexternal%2Faudio%2Fmedia%2F1';
    elB.paused = false;

    const deckA = { element: elA, router: { gain: createMockGainParam(1) } };
    const deckB = { element: elB, router: { gain: createMockGainParam(0) } };
    const mockState = {
      tracks: [{ id: 't1', title: 'Cold Start Song', url: elB.src }],
      currentId: 't1',
      playGeneration: 1,
      crossfadeSeconds: 5,
      crossfadeUntil: 0,
      context: { currentTime: 0, state: 'suspended' },
      deckA,
      deckB,
      activeDeck: deckA,
      preloadTrackId: null,
      preloadReadyUrl: null
    };
    const timeouts = [];
    const finishFactory = new Function(
      'state', 'audio', 'standbyAudio', '$', 'library',
      'recordHistory', 'scheduleTrackRender', 'preloadNext',
      'releaseUnusedCloudUrl', 'releaseUnusedLocalUrl', 'setTimeout', 'location',
      `${applyCfCode}\n${finishCode}\nreturn finishPlaybackStart;`
    );
    const finishPlaybackStart = finishFactory(
      mockState, elA, elB,
      () => ({ textContent: '' }),
      library,
      () => {}, () => {}, () => {}, () => {}, () => {},
      (fn, ms) => timeouts.push({ fn, ms }),
      { href: 'https://appassets.androidplatform.net/assets/index.html' }
    );

    const started = finishPlaybackStart(mockState.tracks[0], 1, elB, null);
    assert.equal(started, true);
    assert.equal(elB.muted, false, 'Target audio element must be unmuted on finishPlaybackStart');
    assert.equal(mockState.activeDeck, deckB, 'activeDeck must match target.element explicitly');
    assert.equal(deckB.router.gain.value, 1, 'Cold-start playback must set newDeck.router.gain.value = 1 immediately');
    assert.equal(timeouts.length, 0, 'Cold-start playback must NOT schedule a slow crossfade');

    // B. playDsdFirstSlice unmutes audio and aligns activeDeck router gain to 1
    const dsdSliceCode = extractFunction(appCode, 'playDsdFirstSlice');
    const dsdAudio = new MockAudioEl();
    dsdAudio.muted = true; // Previously stuck muted after deck swap!
    const dsdStandby = new MockAudioEl();
    const dsdDeckA = { element: dsdStandby, router: { gain: createMockGainParam(1) } };
    const dsdDeckB = { element: dsdAudio, router: { gain: createMockGainParam(0) } };
    const dsdState = {
      playGeneration: 1,
      currentId: 'dsd-1',
      bitPerfectEnabled: false,
      context: { state: 'running', currentTime: 10, resume: async () => {} },
      objectUrls: new Set(),
      deckA: dsdDeckA,
      deckB: dsdDeckB,
      activeDeck: dsdDeckA
    };
    const dsdCtx = {
      URL, Blob, performance, console,
      state: dsdState,
      audio: dsdAudio,
      standbyAudio: dsdStandby,
      setupAudio: () => {},
      displayTrack: () => {},
      recordTimeToFirstAudio: () => {},
      renderRoomSignal: () => {},
      recordHistory: () => {},
      scheduleTrackRender: () => {},
      preloadNext: () => {},
      $: id => (id === 'volume' ? { value: '80', textContent: '' } : { value: '', textContent: '' })
    };
    vm.createContext(dsdCtx);
    vm.runInContext(dsdSliceCode, dsdCtx);
    const dsdTrack = { id: 'dsd-1', source: 'local', title: 'DSD64 Track' };
    const sliceUrl = await dsdCtx.playDsdFirstSlice(dsdTrack, new Blob(['pcm-slice']), 1, 0);
    assert.ok(sliceUrl && sliceUrl.startsWith('blob:'));
    assert.equal(dsdAudio.muted, false, 'playDsdFirstSlice must unmute audio');
    assert.ok(Math.abs(dsdAudio.volume - 0.8) < 1e-6, 'playDsdFirstSlice must restore volume from slider');
    assert.equal(dsdState.activeDeck, dsdDeckB, 'playDsdFirstSlice must set activeDeck to the deck owning audio');
    assert.equal(dsdDeckB.router.gain.value, 1, 'DSD active deck router.gain.value must be 1');
    assert.equal(dsdDeckA.router.gain.value, 0, 'Inactive deck router.gain.value must be 0');
    URL.revokeObjectURL(sliceUrl);

    // C. generateTrackWaveform skips full ArrayBuffer fetch/decode on Android while rendering deterministic peaks
    const wfCode = extractFunction(appCode, 'generateTrackWaveform');
    let fetchCalled = 0;
    let renderWfCalled = 0;
    const wfState = { waveformTrackId: null, waveformPeaks: null, waveformDecoding: false, fiioDapMode: false };
    const wfFn = new Function(
      'document', 'window', 'state', 'NocturneLibrary', 'library', 'fetch', 'renderWaveformSeekbar',
      `${wfCode}\nreturn generateTrackWaveform;`
    )(
      { getElementById: id => (id === 'waveform-canvas' ? {} : null) },
      { isNativeAndroid: true },
      wfState,
      library,
      library,
      async () => { fetchCalled++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
      () => { renderWfCalled++; }
    );
    await wfFn({ id: 'flac-hi-res', title: 'Hi-Res', artist: 'Artist', url: 'blob:https://app/flac', size: 1024 });
    assert.equal(fetchCalled, 0, 'generateTrackWaveform must skip full fetch + decodeAudioData on Android');
    assert.ok(wfState.waveformPeaks instanceof Float32Array && wfState.waveformPeaks.length === 200);
    assert.ok(renderWfCalled >= 1, 'Deterministic waveform peaks must still render immediately');

    // D. Native BitPerfect error callback & external non-CORS stream fallback wired in index.html
    assert.ok(appCode.includes('window.onNativeBitPerfectError ='), 'setupBitPerfectIntegration must register window.onNativeBitPerfectError');
    assert.ok(appCode.includes('curTrack._skipNativeBpOnce = true'), 'onNativeBitPerfectError must bypass native BP once and retry via Web Audio');
    assert.ok(appCode.includes('!bpCandidateUrl.startsWith(\'blob:\')'), 'playTrack must never pass blob: URLs to native MediaExtractor');
    assert.ok(appCode.includes('playViaDirectCorsBypassAudio'), 'playTrack must fall back cleanly for external HTTP(S) streams without CORS');
    assert.ok(appCode.includes('native.scanMediaStoreAudio(10000)'), 'scanFiioStorage must query native.scanMediaStoreAudio on Android');
    assert.ok(appCode.includes('window.onAndroidStoragePermissionGranted ='), 'index.html must register window.onAndroidStoragePermissionGranted');
  });

  await t.test('8. Asset Parity (0 CR bytes) & Web Audio Graph Invariant Preservation', () => {
    const html404 = fs.readFileSync(html404Path);
    const indexBuf = fs.readFileSync(indexHtmlPath);
    const assetIndexBuf = fs.readFileSync(assetIndexPath);
    const libBuf = fs.readFileSync(libraryUtilsPath);
    const assetLibBuf = fs.readFileSync(assetLibraryUtilsPath);
    const swBuf = fs.readFileSync(swPath);
    const assetSwBuf = fs.readFileSync(assetSwPath);

    assert.equal(indexBuf.includes(0x0d), false, 'index.html must contain 0 CR (\\r) bytes');
    assert.equal(libBuf.includes(0x0d), false, 'library-utils.js must contain 0 CR (\\r) bytes');
    assert.equal(swBuf.includes(0x0d), false, 'sw.js must contain 0 CR (\\r) bytes');

    assert.equal(Buffer.compare(indexBuf, html404), 0, '404.html must be byte-identical to index.html');
    assert.equal(Buffer.compare(indexBuf, assetIndexBuf), 0, 'android assets/index.html must be byte-identical to index.html');
    assert.equal(Buffer.compare(libBuf, assetLibBuf), 0, 'android assets/library-utils.js must be byte-identical to library-utils.js');
    assert.equal(Buffer.compare(swBuf, assetSwBuf), 0, 'android assets/sw.js must be byte-identical to sw.js');

    const invMatches = indexHtml.match(/state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/g);
    assert.ok(invMatches && invMatches.length >= 2, 'state.crossfeedNodes.output.connect(state.context.destination) must be strictly preserved');
  });
});
