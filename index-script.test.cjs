'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
assert.ok(inlineScripts.length > 0, 'index.html should contain the app script');
for (const [index, script] of inlineScripts.entries()) new vm.Script(script, {filename: `index.inline.${index}.js`});
const appCode = inlineScripts.join('\n');
for (const id of ['dsd-output-rate', 'dsd-output-depth']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} control should exist`);
  assert.ok(appCode.includes(`$('${id}')`), `${id} should be initialized by app code`);
}
assert.match(html, /nocturne-dsd-output-rate/, 'DSD output rate should persist');
assert.match(html, /nocturne-dsd-output-depth/, 'DSD output depth should persist');
assert.ok(appCode.includes('state.analyser.connect(state.context.destination)'), 'EQ analyser output should be routed to the speakers');
assert.ok(appCode.includes('state.directAnalyser.connect(state.context.destination)'), 'Direct output should be routed to the speakers');
assert.ok(appCode.includes('library.metadataOptions'), 'Artist/album dropdowns should use normalized metadata options');
assert.ok(appCode.includes('library.resolveTrackMetadata'), 'Local and cloud metadata should share the same cleanup logic');
assert.ok(appCode.includes('restoreCloudCatalog'), 'Cloud catalog should be restored from IndexedDB');
assert.ok(appCode.includes('CLOUD_CATALOG_STORE'), 'Cloud tracks should persist in IndexedDB instead of volatile memory');
assert.ok(appCode.includes('includeItemsFromAllDrives'), 'Drive listing should include shared/team drives');
assert.ok(appCode.includes("corpora:'allDrives'"), 'Drive listing should search all shared drive corpora');
assert.ok(appCode.includes('@odata.nextLink'), 'OneDrive listing should follow every page');
assert.ok(appCode.includes('restoreMicrosoftSession'), 'OneDrive should restore silently from the MSAL account cache');
assert.ok(appCode.includes("requestGoogleToken('none')"), 'Google restore should use the silent token prompt first');
assert.ok(appCode.includes('setSidebarOpen(!sidebarIsOpen())'), 'Sidebar toggle should switch the drawer');
assert.ok(appCode.includes("$('sidebar-close').addEventListener('click'"), 'Sidebar close button should hide the drawer');
assert.ok(appCode.includes("$('sidebar-backdrop').addEventListener('click'"), 'Sidebar backdrop should hide the drawer');
assert.ok(appCode.includes('target.muted = false'), 'Promoted playback deck must be unmuted');
assert.ok(html.includes('.seek-range') && html.includes('accent-color: #050505'), 'Seek slider should use a dedicated black styling treatment');
assert.ok(html.includes('seek-range'), 'Seek controls should use the dedicated slider class');
assert.ok(appCode.includes('paintSeek'), 'Seek controls should paint the slider progress');
assert.ok(appCode.includes('--seek-progress'), 'Seek slider should expose a CSS progress variable');
assert.ok(appCode.includes('object-contain'), 'Artwork should fit within its frame instead of cropping it');
assert.ok(appCode.includes('mediaSession'), 'Playback should expose lock-screen/media controls');
assert.ok(appCode.includes("action('nexttrack'"), 'Playback should support lock-screen next-track control');
assert.ok(appCode.includes("action('seekto'"), 'Playback should support lock-screen seeking');
assert.match(html, /body\s*\{\s*background:\s*#09090b;\s*\}/, 'Body should retain its dark base background');
assert.match(html, /#app-shell\s*\{\s*position:\s*relative;\s*z-index:\s*1;/, 'App content should render above the ambient artwork');
assert.match(html, /id=["']ambient["'][^>]*\bz-0\b/, 'Ambient artwork layer should render above the body background');
assert.ok(appCode.includes("$('ambient').style.background = track.cover ?"), 'Current track artwork should drive the ambient background');
assert.match(html, /id=["']update-banner["']/, 'Update banner should exist for new-version prompts');
assert.match(html, /id=["']update-now["']/, 'Update banner should offer an apply control');
assert.match(html, /id=["']update-later["']/, 'Update banner should offer a dismiss control');
assert.ok(appCode.includes('checkForAppUpdate'), 'App should poll for a newer deployed version');
assert.ok(appCode.includes('applyAppUpdate'), 'App should apply a pending update explicitly');
assert.ok(appCode.includes('isAppPlaying'), 'Update flow should know whether audio is playing');
assert.ok(appCode.includes('UPDATE_CHECK_INTERVAL'), 'Update polling should use a shared interval');
assert.ok(appCode.includes('visibilitychange'), 'Update check should rerun when the tab becomes visible');
assert.ok(appCode.includes("location.reload()"), 'Applying an update should reload the new version');
assert.ok(appCode.includes("if (isAppPlaying())"), 'Applying an update must be blocked while audio is playing');
for (const id of ['listening-room', 'room-cover', 'room-signal', 'room-seek', 'queue-panel', 'queue-list', 'sleep-panel', 'sleep-track-end', 'autoplay-button']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} UI should exist`);
}
for (const feature of ['function renderQueue()', 'function addToQueue(', 'function removeFromQueue(', 'function moveQueueTrack(', 'function setSleepTimer(', 'function clearSleepTimer(', 'function signalDescription(']) {
  assert.ok(appCode.includes(feature), `${feature} implementation should exist`);
}
assert.ok(appCode.includes('queueTracks()[0]'), 'Explicit play-next queue should take priority when advancing');
assert.ok(appCode.includes("if (!state.autoplay || state.repeat === 2) return -1"), 'Autoplay off should not preload library tracks');
assert.ok(appCode.includes("action('seekto'"), 'Expanded listening room keeps lock-screen seek support');
assert.ok(appCode.includes('không thể xác nhận bit-perfect'), 'Signal-path view should not claim unverified bit-perfect output');
assert.ok(appCode.includes("event.key === 'Escape'"), 'Escape should close listening overlays');
assert.ok(appCode.includes("$('room-current-time')"), 'Expanded listening room should mirror playback time');
assert.ok(appCode.includes("event.code === 'Space'"), 'Listening room should support spacebar play/pause');
assert.ok(appCode.includes("data-queue-action=\"add\""), 'Library tracks should expose a play-next control');
const updateCheckBody = appCode.slice(appCode.indexOf('async function checkForAppUpdate'));
assert.ok(!updateCheckBody.slice(0, updateCheckBody.indexOf('function applyAppUpdate')).includes('location.reload()'), 'Background version checks must never reload automatically');
assert.ok(appCode.includes('cover:track.cover || null'), 'Cloud catalog should persist extracted cover art');
assert.ok(appCode.includes('if (!track.metadataLoaded || track.cover === undefined)'), 'Legacy cloud entries without a cover should re-read metadata on playback');
assert.ok(appCode.includes('function normalizeCoverImage('), 'Large cover art should be downscaled before persistence');
assert.ok(appCode.includes('track.cover = await normalizeCoverImage(tags.cover)'), 'Extracted cloud covers should be normalized before display');
assert.ok(appCode.includes('await loadCloudMetadata(track, track.file)'), 'DSD cloud entries should also recover missing cover art');

assert.equal((html.match(/<script\b[^>]*\bsrc=["'][^"']*jsmediatags[^"']*["']/gi) || []).length, 1, 'jsmediatags should be loaded once');
assert.match(html, /jsdelivr\.net\/npm\/jsmediatags@3\.9\.7\//, 'jsmediatags should use the standardized CDN version');
assert.ok(appCode.includes('Math.max(naturalWidth, naturalHeight) <= maxEdge'), 'Cover normalization should use image dimensions');
assert.ok(appCode.includes("if (!context) return resolve(cover)"), 'Cover normalization should tolerate an unavailable 2D canvas context');
assert.ok(appCode.includes('const localFileKey = file => `${file.relativePath || file.webkitRelativePath || file.name}-${file.size}`'), 'Local duplicate keys should include relative paths and file sizes');
assert.ok(appCode.includes('existing.set(key, track)'), 'New local tracks should be registered using their path-based duplicate key');
assert.ok(appCode.includes('track.relativePath = file.relativePath || file.webkitRelativePath || file.name'), 'Local tracks should retain relative paths for later duplicate checks');
assert.ok(appCode.includes('state.activeAnalyser = enabled ? state.analyser : state.directAnalyser'), 'EQ toggle should switch the visualizer to the active output analyser');
assert.ok(appCode.includes("new URL('.', document.baseURI || location.href).href"), 'DSD worker base URL should come from the document URL');
assert.ok(appCode.includes("element.addEventListener('ended', () => { if (element === audio) playNext(1, true); })"), 'Natural track endings should be distinguishable from manual Next');
assert.ok(appCode.includes('if (event.target !== row || (event.key !== \'Enter\' && event.key !== \' \')) return'), 'Track-row keyboard playback should only trigger when the row itself has focus');

const playNextStart = appCode.indexOf('function playNext(direction = 1, auto = false) {');
assert.ok(playNextStart >= 0, 'playNext implementation should exist for regression checks');
const playNextEndMarker = 'async function pickLocalFiles';
const playNextEnd = appCode.indexOf(playNextEndMarker, playNextStart);
assert.ok(playNextEnd > playNextStart, 'playNext implementation should be extractable for regression checks');
const playNextSource = appCode.slice(playNextStart, playNextEnd);
assert.ok(playNextSource.includes('if (element === audio) playNext') === false, 'extracted playNext source should end before deck wiring');
function exercisePlayNext({auto = false, autoplay = true, repeat = 0, sleepAtTrackEnd = false, queued = []} = {}) {
  const calls = {played:[], pause:0, play:0, cleared:0, stopped:0, currentTime:37};
  const state = {tracks:[{id:'current'}, {id:'next'}], currentId:'current', autoplay, repeat, sleepAtTrackEnd, shuffle:false, preloadTrackId:null, dsdWorker:null, dsdUrl:null};
  const audio = {get currentTime() { return calls.currentTime; }, set currentTime(value) { calls.currentTime = value; }, pause() { calls.pause++; }, play() { calls.play++; return Promise.resolve(); }};
  const playNextFactory = new Function('state', 'audio', 'queueTracks', 'stopDsdWorker', 'clearSleepTimer', 'toast', 'playTrack', playNextSource + '\nreturn playNext;');
  const playNext = playNextFactory(state, audio, () => queued, () => calls.stopped++, () => calls.cleared++, () => {}, trackId => calls.played.push(trackId));
  playNext(1, auto);
  return calls;
}
assert.deepEqual(exercisePlayNext({autoplay:false}).played, ['next'], 'Manual Next should work with autoplay disabled');
assert.deepEqual(exercisePlayNext({auto:true, autoplay:false}).played, [], 'Autoplay disabled should stop automatic advance at track end');
assert.deepEqual(exercisePlayNext({auto:true, autoplay:false, queued:[{id:'queued'}]}).played, ['queued'], 'The explicit queue should still advance when autoplay is disabled');
assert.deepEqual(exercisePlayNext({sleepAtTrackEnd:true}).played, ['next'], 'Manual Next should not trigger the track-end sleep timer');
const sleepAtEnd = exercisePlayNext({auto:true, sleepAtTrackEnd:true});
assert.equal(sleepAtEnd.pause, 1, 'Track-end sleep should pause on a natural track ending');
assert.equal(sleepAtEnd.cleared, 1, 'Track-end sleep should clear after it pauses');
assert.deepEqual(exercisePlayNext({repeat:2}).played, ['next'], 'Manual Next should skip the current track even in repeat-one mode');
const repeatAtEnd = exercisePlayNext({auto:true, repeat:2});
assert.equal(repeatAtEnd.currentTime, 0, 'Natural ending in repeat-one mode should restart the current track');
assert.equal(repeatAtEnd.play, 1, 'Repeat-one should resume playback at the beginning');
assert.deepEqual(exercisePlayNext({auto:true, autoplay:false, repeat:2, queued:[{id:'queued'}]}).played, ['queued'], 'Explicit queue should take precedence over repeat-one and autoplay settings');
console.log('Inline app syntax, persistence and recent playback/UI regression tests passed.');
