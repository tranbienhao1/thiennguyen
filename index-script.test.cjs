'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const libraryCode = fs.readFileSync(path.join(__dirname, 'library-utils.js'), 'utf8');
const metadataCode = fs.readFileSync(path.join(__dirname, 'metadata-utils.js'), 'utf8');
const metadataUiCode = fs.readFileSync(path.join(__dirname, 'metadata-ui.js'), 'utf8');
const cloudMetadataCode = fs.readFileSync(path.join(__dirname, 'cloud-metadata.js'), 'utf8');
new vm.Script(cloudMetadataCode, {filename:'cloud-metadata.js'});
new vm.Script(metadataCode, {filename:'metadata-utils.js'});
new vm.Script(metadataUiCode, {filename:'metadata-ui.js'});
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
assert.ok(inlineScripts.length > 0, 'index.html should contain the app script');
assert.match(html, /<script src="metadata-utils\.js"><\/script>/, 'Music metadata lookup module should load before the app');
assert.match(html, /<script src="metadata-ui\.js"><\/script>/, 'Metadata detail UI module should load before the app');
assert.match(html, /<script src="cloud-metadata\.js"><\/script>/, 'Cloud range metadata reader should load before the app');
assert.match(html, /id="metadata-modal"[^>]*role="dialog"/, 'Metadata lookup should provide an accessible dialog');
for (const id of ['metadata-title','metadata-subtitle','metadata-query','metadata-search-button','metadata-results','metadata-detail','metadata-status','metadata-close','metadata-back']) assert.match(html, new RegExp(`id="${id}"`), `Metadata dialog should include ${id}`);
for (const kind of ['track','album','artist']) assert.match(html, new RegExp(`data-metadata-kind="${kind}"`), `${kind} lookup tab should exist`);
assert.match(html, /data-metadata-action="open"/, 'Track rows should offer direct metadata lookup');
for (const [index, script] of inlineScripts.entries()) new vm.Script(script, {filename: `index.inline.${index}.js`});
const appCode = inlineScripts.join('\n');
assert.ok(appCode.includes('cloudMetadata.readRemoteTags'), 'Cloud tags should be extracted by authenticated range reads');
assert.ok(appCode.includes('CLOUD_METADATA_CONCURRENCY = 3'), 'Cloud metadata enrichment should be concurrency-limited');
assert.match(html, /id="reset-cloud-catalog"[^>]*>Xóa danh mục Cloud đã lưu<\/button>/, 'Settings should provide a reset action for the cached cloud catalog');
assert.ok(appCode.includes('store.clear();'), 'Cloud catalog reset should clear only its IndexedDB object store');
assert.ok(appCode.includes('const transaction = store.transaction;'), 'Cloud reset should wait for the IndexedDB transaction to finish before reloading');
assert.ok(appCode.includes('if (!confirmed || cloudCatalogResetting) return;'), 'Cloud reset should require confirmation and prevent concurrent reset attempts');
assert.ok(appCode.includes('if (cloudCatalogResetting) return Promise.resolve();'), 'Cloud metadata should not repopulate the catalog while reset is running');
assert.ok(appCode.includes('await clearCloudCatalog();\n        location.reload();'), 'Cloud reset should reload only after IndexedDB deletion completes');
assert.ok(appCode.includes('files(id,name,mimeType,size,thumbnailLink)'), 'Google scans should request thumbnail metadata');
assert.ok(appCode.includes('if (track.source === \'onedrive\' && track.downloadUrl)'), 'Temporary OneDrive download links must not be kept after metadata enrichment');
assert.ok(cloudMetadataCode.includes('MAX_TOTAL = 16 * 1024 * 1024'), 'Cloud metadata range reads should enforce a strict byte budget');
assert.ok(appCode.includes('size,audio&$top=500'), 'OneDrive scans should request audio facet metadata');
assert.ok(appCode.includes('item[\'@microsoft.graph.downloadUrl\']'), 'OneDrive metadata should use its short-lived download URL for range requests');
assert.ok(appCode.includes('thumbnailUrl:file.thumbnailLink ||'), 'Google thumbnail links should be retained for artwork enrichment');
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1]).filter(id => !id.includes('${'));
const idCounts = new Map();
for (const id of ids) idCounts.set(id, (idCounts.get(id) || 0) + 1);
assert.deepEqual([...idCounts].filter(([, count]) => count > 1), [], 'HTML should not define duplicate element IDs');
const missingLiteralIds = [...new Set([...appCode.matchAll(/\$\(["']([^"']+)["']\)/g)].map(match => match[1]))]
  .filter(id => !idCounts.has(id));
assert.deepEqual(missingLiteralIds, [], 'App code should not query missing literal element IDs');
for (const id of ['dsd-output-rate', 'dsd-output-depth']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} control should exist`);
  assert.ok(appCode.includes(`$('${id}')`), `${id} should be initialized by app code`);
}
assert.match(html, /nocturne-dsd-output-rate/, 'DSD output rate should persist');
assert.match(html, /nocturne-dsd-output-depth/, 'DSD output depth should persist');
assert.ok([48000,96000,192000].every(rate => html.includes(`value="${rate}"`)), 'DSD settings should offer PCM outputs from the 48 kHz family');
assert.ok(appCode.includes('const dsdSourceInfo = rate =>'), 'DSD source family should be resolved for 44.1 and 48 kHz masters');
assert.ok(appCode.includes('state.dsdOutputRate = fallbackRate'), 'DSD playback should select a PCM rate compatible with the source rate family');
assert.ok(appCode.includes('[44100,48000,88200,96000,176400,192000].includes(savedRate)'), 'All supported DSD output rates should restore from settings');
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
assert.ok(!appCode.includes('async function restoreGoogleSession()'), 'Google OAuth must not run during page-load/background refresh');
assert.ok(appCode.includes('GIS tokens are short-lived and intentionally never refreshed during page-load/background work.'), 'Google authorization must only start from a user action');
assert.ok(appCode.includes("throw new Error('Phiên Google Drive đã hết hạn. Nhấn “Tiếp tục với Google” để kết nối lại.')"), 'Expired Google tokens should prompt an explicit user reconnect rather than an automatic OAuth popup');
assert.ok(!appCode.includes('state.googleToken = null'), 'A Google access token should not be persisted across page reloads as an apparently live session');
assert.ok(appCode.includes("const timeout = setTimeout(() => { script.remove(); reject(new Error('Tải Google Identity Services quá thời gian chờ."), 'Google Identity Services loading should time out and be retryable instead of leaving Connect stuck forever');
assert.ok(appCode.includes("cloudStatus('google', 'Google Drive · cần thử lại'"), 'Failed Google sign-in or Drive listing should not leave a misleading connecting status');
assert.ok(appCode.includes("cloudStatus('google', 'Client ID không hợp lệ'"), 'Invalid Google Client IDs should be visible in the connection status');
assert.ok(appCode.includes("cloudStatus('google', 'Cần HTTPS hoặc localhost'"), 'Google OAuth secure-origin requirements should be visible in the connection status');
assert.ok(appCode.includes('let googleScriptPromise = null;'), 'Google Identity Services loading should be shared and retryable');
assert.ok(appCode.includes('if (window.google?.accounts?.oauth2) return;'), 'Google GIS loading must detect an already-loaded async script and avoid waiting for a missed load event');
assert.ok(appCode.includes("client.requestAccessToken({prompt});"), 'Google OAuth must be invoked directly from the connect button gesture');
assert.ok(appCode.includes("if (!window.isSecureContext) throw new Error('Google OAuth chỉ hoạt động trên HTTPS hoặc localhost."), 'Google OAuth should explain its HTTPS/localhost requirement');
assert.ok(appCode.includes("if (!/^[\\w.-]+\\.apps\\.googleusercontent\\.com$/.test(clientId))"), 'Google connection should reject a pasted API key or malformed Client ID before opening OAuth');
assert.ok(appCode.includes('Không mở được cửa sổ OAuth của Google'), 'Google popup errors should explain how to unblock sign-in');
assert.ok(appCode.includes('Google Drive API ${response.status}: ${googleConfigurationHint(response.status, body)}'), 'Google API failures should include actionable configuration guidance');
assert.ok(appCode.includes('incompleteSearch'), 'Google Drive scans should inspect incomplete-search results for shared drives');
assert.ok(appCode.includes("corpora:'allDrives'"), 'Google Drive listing should include shared drives');
assert.ok(!appCode.includes("requestGoogleToken('none')"), 'Google must not try an unreliable background silent token flow');
assert.ok(!html.includes('data-gis="true" async defer'), 'GIS should not race a preloaded async script against its loader');
assert.match(html, /<dialog id="settings-modal"[^>]*aria-labelledby="settings-title"/, 'Settings should use the native dialog top layer for reliable input and dismissal');
assert.ok(appCode.includes("if (!modal.open) modal.showModal();") && appCode.includes('if (modal.open) modal.close();'), 'Settings should synchronize native dialog state when opening and closing');
assert.ok(appCode.includes("event.currentTarget.dataset.backdropPointer === 'true'"), 'Backdrop dismissal should work on touch as well as mouse');
assert.ok(!appCode.includes("modal.setAttribute('inert', '')"), 'Native dialog must manage focus and inert background state itself');
assert.ok(!html.includes('id="settings-modal" class="fixed inset-0 z-[80] hidden items-center justify-center overflow-y-auto bg-black/75'), 'Settings must not remain an ordinary div overlay vulnerable to stacking contexts');
assert.ok(appCode.includes('setSidebarOpen(!sidebarIsOpen())'), 'Sidebar toggle should switch the drawer');
assert.ok(appCode.includes("$('sidebar-close').addEventListener('click'"), 'Sidebar close button should hide the drawer');
assert.ok(appCode.includes("$('sidebar-backdrop').addEventListener('click'"), 'Sidebar backdrop should hide the drawer');
assert.ok(appCode.includes('target.muted = false'), 'Promoted playback deck must be unmuted');
assert.ok(!appCode.includes('requestedTrackId'), 'Preload eligibility should not depend on the never-assigned requestedTrackId flag');
assert.ok(appCode.includes('if (!wasPreloaded) ++state.preloadGeneration;'), 'Starting a track that was not preloaded should invalidate outstanding preload work');
assert.ok(!/if \(!wasPreloaded \|\| preloadGeneration !== state\.preloadGeneration\) \{\s*displayTrack/.test(appCode), 'Track promotion should not be accidentally wrapped in an unclosed preload conditional');
assert.ok(html.includes('.seek-range') && html.includes('accent-color:#92cce2'), 'Seek slider should use the Roon-inspired ice-blue treatment');
assert.ok(html.includes('seek-range'), 'Seek controls should use the dedicated slider class');
assert.ok(appCode.includes('paintSeek'), 'Seek controls should paint the slider progress');
assert.ok(appCode.includes('--seek-progress'), 'Seek slider should expose a CSS progress variable');
assert.ok(appCode.includes('object-contain'), 'Artwork should fit within its frame instead of cropping it');
assert.ok(appCode.includes('mediaSession'), 'Playback should expose lock-screen/media controls');
assert.ok(appCode.includes("action('nexttrack'"), 'Playback should support lock-screen next-track control');
assert.ok(appCode.includes("action('seekto'"), 'Playback should support lock-screen seeking');
assert.match(html, /body\s*\{\s*background:#111315;\s*\}/, 'Base body styling should retain the Roon-inspired charcoal background');
assert.match(html, /id="roon-inspired-theme"/, 'The app should include the Roon-inspired design layer');
assert.match(html, /body\s*\{\s*background:radial-gradient\(ellipse at 76% -18%,#20282b 0,transparent 38%\),#111315;/, 'The Roon-inspired interface should use layered charcoal surfaces');
assert.match(html, /--accent:126 189 216/, 'The interface should use a restrained ice-blue Roon-inspired accent');
assert.match(html, /id="roon-layout-theme"/, 'Library, album and player components should share the upgraded visual system');
assert.match(html, /\.hero-art/, 'The hero artwork style should remain in the older compatibility layer');
assert.ok([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].some(match => /#hero\s*\{\s*display:none!important\s*\}/.test(match[1])), 'The reference-inspired library should not show the previous landing-page hero');
assert.match(html, /\.track-row\.active \{[^}]*inset 2px 0 #91cde5/, 'The current track should have a visible Roon-inspired selection marker');
assert.ok(appCode.includes('function syncSourceNavigation()'), 'Sidebar navigation and source filter should share active state');
assert.ok(appCode.includes("button.setAttribute('aria-current', 'page')"), 'The active sidebar destination should be announced accessibly');
assert.ok(appCode.includes("'roon-responsive-theme','roon-reference-layout','roon-collection-responsive','roon-collection-mobile'].includes(element.id)"), 'Update detection should include every inline layout theme when comparing versions');
assert.ok(appCode.includes('data-track-index=') && appCode.includes('trackIndex + 1'), 'Library rows should expose track numbers in the hi-fi listening view');
assert.match(html, /@media \(max-width:640px\)/, 'The upgraded artwork and player should adapt to mobile');
assert.ok([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].some(match => /@media\s*\(prefers-reduced-motion:reduce\)/.test(match[1])), 'The UI should preserve reduced-motion preferences');
assert.match(html, /#content-col\s*>\s*header\s*\{[^}]*position:\s*sticky/, 'The page header should remain accessible while scrolling');
assert.match(html, /id="roon-reference-layout"/, 'The interface should use the reference-style structural layout, not only palette overrides');
assert.match(html, /id="collection-grid"/, 'The library should render album and artist collections as a responsive artwork grid');
assert.match(html, /id="home-view"/, 'The home page should include the reference-style library summary');
assert.match(html, /id="audio-zone-button"/, 'The idle player should display the audio-zone selector');
assert.match(html, /player-idle>div>div>div:not\(\.audio-zone-empty\)/, 'The idle player layout should hide playback controls until a track is selected');
assert.ok(appCode.includes('function renderCollectionCards(tracks)'), 'Collection cards should be generated from real library metadata');
assert.ok(appCode.includes("document.querySelectorAll('[data-view]')"), 'Reference sidebar navigation should switch library views');
assert.ok(appCode.includes("$('player-footer').classList.remove('player-idle')"), 'Selecting a track should reveal the persistent player controls');
assert.match(html, /footer\.glass\s*\{[^}]*border(?:-top)?:/, 'The fixed player should use the reference-style docked dark surface');
assert.match(html, /supports two rate families|hai họ tần số 44,1 và 48 kHz/, 'The hero should describe both supported DSD rate families');
assert.ok(!html.includes('id="ambient"') || /#app-shell\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/.test(html), 'App content should render above the ambient artwork when that layer is enabled');
assert.ok(!html.includes('id="ambient"') || /id=["']ambient["'][^>]*\bz-0\b/.test(html), 'Ambient artwork layer should render above the body background when present');
assert.ok(!html.includes('id="ambient"') || appCode.includes("$('ambient').style.background = track.cover ?"), 'Current track artwork should drive the ambient background when that layer is enabled');
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
for (const id of ['listening-room', 'room-cover', 'room-signal', 'room-seek', 'queue-panel', 'queue-list', 'sleep-panel', 'sleep-track-end', 'autoplay-button', 'recent-section', 'recent-list', 'recent-clear']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} UI should exist`);
}
for (const feature of ['function renderQueue()', 'function addToQueue(', 'function removeFromQueue(', 'function moveQueueTrack(', 'function setSleepTimer(', 'function clearSleepTimer(', 'function signalDescription(']) {
  assert.ok(appCode.includes(feature), `${feature} implementation should exist`);
}
assert.ok(appCode.includes('queueTracks()[0]'), 'Explicit play-next queue should take priority when advancing');
assert.ok(appCode.includes('const target = standbyAudio;'), 'Track switches should prepare the standby deck while the active deck keeps playing');
assert.ok(appCode.includes('target.volume = audio.volume; target.muted = false;'), 'The standby deck should inherit playback settings before the deck swap');
assert.ok(appCode.includes('state.dsdUrl) stopDsdWorker(false);'), 'Track switches should clear stale DSD decoder state');
assert.ok(appCode.includes('function scheduleTrackRender()'), 'Track-list redraws should be deferrable during switches');
assert.ok(appCode.includes('function renderRecentTracks()'), 'A recent-listening shelf should render quick resume cards');
assert.match(appCode, /target\.play\(\)[\s\S]{0,950}recordHistory\(track\);/, 'A track should enter history only after playback starts successfully');
assert.ok(appCode.includes("recordHistory(track); scheduleTrackRender()"), 'Successfully decoded DSD playback should also enter recent history');
assert.ok(!/scheduleTrackRender\(\);\s*recordHistory\(track\);/.test(appCode), 'Failed playback attempts must not be recorded as listening history');
assert.ok(appCode.includes('function restoreRecentTracks()'), 'Recent listening should restore after reload');
assert.ok(appCode.includes('restoreRecentTracks();') && appCode.includes('resolve(restored);'), 'Recent listening cards should update after cloud catalog restoration');
assert.ok(appCode.includes("openDatabase().then(restoreRecentTracks)"), 'Recent history should be restored after IndexedDB opens');
assert.ok(appCode.includes('store.openCursor(null, \'prev\')'), 'Persistent history should be trimmed to the newest entries');
assert.ok(appCode.includes('disabled title="Thêm lại thư mục/file vào thư viện để phát bài này"'), 'Unloaded local files should not show broken recent-play actions');
assert.ok(appCode.includes('state.recentHistory = [{trackKey, title:metadata.title'), 'Recent track cards should not need persistent local file paths or session IDs');
assert.ok(appCode.includes('function clearHistory()'), 'Listeners should be able to clear local history');
assert.ok(appCode.includes('Math.max(Date.now(), state.historyClearedAt + 1)'), 'Playback after clearing history should use a monotonic cutoff');
assert.ok(appCode.includes('state.historyClearedAt = 0;') && appCode.includes("localStorage.removeItem(`${RECENT_TRACKS_KEY}-cleared-at`)"), 'The clear cutoff should be released only after successful history persistence');
assert.ok(appCode.includes('MAX_RECENT_TRACKS = 30'), 'Recent listening should remain bounded');
assert.ok(appCode.includes("localStorage.setItem(`${RECENT_TRACKS_KEY}-cleared-at`"), 'Clearing history should survive concurrent IndexedDB restore');
assert.ok(appCode.includes('historyRestoreGeneration'), 'Late IndexedDB restore must not overwrite a newer history clear');
assert.ok(appCode.includes("$('recent-section').scrollIntoView"), 'The existing History control should navigate to the recent shelf');
assert.ok(appCode.includes('const localConcurrency = Math.min(4, pending.length)'), 'Local metadata extraction should use a bounded concurrency limit');
assert.ok(appCode.includes('lastDisplayedPlaybackSecond') && appCode.includes('lastPositionStateSecond'), 'Playback UI and media session position should avoid redundant per-frame updates');
assert.ok(appCode.includes('function updateCurrentTrackIndicator()') && !/if\s*\(state\.activeView === 'home'\)\s*renderTracks\(\)/.test(appCode), 'Track changes should update the active row without redrawing the home library');
assert.ok(appCode.includes('function setVisualizerRunning(running)') && appCode.includes('setVisualizerRunning(false)'), 'The visualizer should stop its animation loop while playback is paused');
assert.ok(libraryCode.includes('function historyTrackKey(track)'), 'History should use a stable normalized track identity');
assert.ok(libraryCode.includes("['local', hash.toString(16), path.length, Number(track.size) || 0]"), 'Local history keys should avoid persisting raw filesystem paths');
assert.ok(libraryCode.includes("track.source === 'url') return null"), 'Temporary direct URLs should not persist in recent history');
assert.ok(appCode.includes('setTimeout(() => loadCloudMetadata(track, blob)'), 'Cloud metadata follow-up should not block playable audio URLs');
assert.ok(appCode.includes('releaseUnusedCloudUrl(next)'), 'Superseded preloads should be able to release unused cloud URLs');
assert.ok(appCode.includes('releaseUnusedCloudUrl(previousTrack);'), 'Switching tracks should release the previous unused cloud URL');
assert.ok(appCode.includes("if (!state.autoplay || state.repeat === 2) return -1"), 'Autoplay off should not preload library tracks');
assert.ok(appCode.includes("action('seekto'"), 'Expanded listening room keeps lock-screen seek support');
assert.ok(appCode.includes('không thể xác nhận bit-perfect'), 'Signal-path view should not claim unverified bit-perfect output');
assert.ok(appCode.includes("event.key === 'Escape' && isSettingsOpen()"), 'Escape should close the settings modal before other overlays');
assert.ok(appCode.includes("$('close-settings').addEventListener('click', hideSettings)"), 'The settings close control should always hide the settings modal');
assert.ok(appCode.includes("if (modal.open) modal.close();"), 'Closing settings should remove the dialog from the top layer and restore background interaction');
assert.match(appCode, /catch \(error\) \{\s*if \(!isSettingsOpen\(\)\) return;\s*settingsError\(error\);/, 'A late OAuth failure must not reopen settings after the user closes the modal');
assert.ok(appCode.includes("if (isSettingsOpen()) hideSettings();"), 'OAuth success should close settings only if the user has not already closed them');
assert.match(html, /#settings-modal\s*\{\s*z-index:100!important/, 'Settings must layer above playback overlays so the close button remains clickable');
assert.match(html, /#settings-modal #close-settings\s*\{[^}]*min-width:44px;min-height:44px/, 'Settings close control should have a reliably clickable target');
assert.match(html, /<dialog id="settings-modal"[^>]*aria-labelledby="settings-title"/, 'Settings dialog should start closed and be hidden from interaction and assistive technology');
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
function exercisePlayNext({auto = false, autoplay = true, repeat = 0, sleepAtTrackEnd = false, queued = [], currentId = 'current', currentTime = 37, direction = 1} = {}) {
  const calls = {played:[], pause:0, play:0, cleared:0, stopped:0, currentTime};
  const state = {tracks:[{id:'current'}, {id:'next'}], currentId, autoplay, repeat, sleepAtTrackEnd, shuffle:false, preloadTrackId:null, dsdWorker:null, dsdUrl:null};
  const audio = {get currentTime() { return calls.currentTime; }, set currentTime(value) { calls.currentTime = value; }, pause() { calls.pause++; }, play() { calls.play++; return Promise.resolve(); }};
  const playNextFactory = new Function('state', 'audio', 'queueTracks', 'stopDsdWorker', 'clearSleepTimer', 'toast', 'playTrack', playNextSource + '\nreturn playNext;');
  const playNext = playNextFactory(state, audio, () => queued, () => calls.stopped++, () => calls.cleared++, () => {}, trackId => calls.played.push(trackId));
  playNext(direction, auto);
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
assert.ok(playNextSource.includes('audio.currentTime > 3'), 'Previous should restart the current track once it is more than 3 seconds in');
const previousDeepIn = exercisePlayNext({direction:-1, currentId:'next', currentTime:37});
assert.equal(previousDeepIn.currentTime, 0, 'Previous more than 3 seconds into a track should restart it from the beginning');
assert.deepEqual(previousDeepIn.played, [], 'Restarting the current track should not switch to another track');
const previousEarly = exercisePlayNext({direction:-1, currentId:'next', currentTime:2});
assert.deepEqual(previousEarly.played, ['current'], 'Previous within the first 3 seconds should go to the previous track');
const previousAtBoundary = exercisePlayNext({direction:-1, currentId:'next', currentTime:3});
assert.deepEqual(previousAtBoundary.played, ['current'], 'Previous at exactly 3 seconds should still go to the previous track');
const previousFirstTrack = exercisePlayNext({direction:-1, currentId:'current', currentTime:37});
assert.equal(previousFirstTrack.currentTime, 0, 'Previous on the first track should restart it instead of doing nothing');
assert.deepEqual(previousFirstTrack.played, [], 'Restarting the first track should not switch to another track');
const deckEventsStart = appCode.indexOf('function attachDeckEvents(element) {');
assert.ok(deckEventsStart >= 0, 'attachDeckEvents implementation should exist for regression checks');
const deckEventsEndMarker = 'attachDeckEvents(audio); attachDeckEvents(standbyAudio);';
const deckEventsEnd = appCode.indexOf(deckEventsEndMarker, deckEventsStart);
assert.ok(deckEventsEnd > deckEventsStart, 'attachDeckEvents implementation should be extractable for regression checks');
const deckEventsSource = appCode.slice(deckEventsStart, deckEventsEnd);
class FakeDeckElement {
  constructor() { this.handlers = {}; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  fire(type) { for (const handler of this.handlers[type] || []) handler(); }
}
function exerciseDeckError({currentId = 'bad', tracks = [{id:'bad', title:'Bài lỗi'}, {id:'next', title:'Bài sau'}], element = 'audio', errorSkipCount = 0} = {}) {
  const calls = {toasts: [], playedNext: []};
  const state = {tracks, currentId, errorSkipCount, preloadTrackId: 'next', preloadReadyUrl: 'next-url'};
  const audio = new FakeDeckElement();
  const standbyAudio = new FakeDeckElement();
  const attachDeckEvents = new Function('state', 'audio', 'standbyAudio', 'toast', 'playNext', 'setVisualizerRunning', '$', 'navigator', 'updatePositionState', `${deckEventsSource}\nreturn attachDeckEvents;`)(
    state, audio, standbyAudio,
    message => calls.toasts.push(message),
    (direction, auto) => calls.playedNext.push([direction, auto]),
    () => {}, id => ({textContent: ''}), {}, () => {},
  );
  attachDeckEvents(element === 'audio' ? audio : standbyAudio);
  return {calls, state, audio, standbyAudio, target: element === 'audio' ? audio : standbyAudio};
}
const badDeck = exerciseDeckError();
badDeck.target.fire('error');
assert.equal(badDeck.calls.playedNext.length, 1, 'A playback error on the active deck should skip to the next track');
assert.deepEqual(badDeck.calls.playedNext[0], [1, false], 'Error skip should advance without the autoplay, sleep-timer or repeat-one gates');
assert.ok(badDeck.calls.toasts[0].includes('Bài lỗi') && badDeck.calls.toasts[0].includes('chuyển sang bài tiếp theo'), 'A playback error should toast the failed track name and the skip');
assert.equal(badDeck.state.errorSkipCount, 1, 'A playback error should count toward the consecutive error-skip guard');
const preloadDeck = exerciseDeckError({element: 'standby'});
preloadDeck.target.fire('error');
assert.equal(preloadDeck.state.preloadTrackId, null, 'A preload error should clear the preloaded track');
assert.equal(preloadDeck.state.preloadReadyUrl, null, 'A preload error should clear the preloaded URL');
assert.deepEqual(preloadDeck.calls.playedNext, [], 'A preload error should not skip the playing track');
assert.deepEqual(preloadDeck.calls.toasts, [], 'A preload error should stay silent for the listener');
const loopingDeck = exerciseDeckError();
loopingDeck.target.fire('error'); loopingDeck.target.fire('error'); loopingDeck.target.fire('error');
assert.equal(loopingDeck.calls.playedNext.length, 2, 'Consecutive playback errors should stop skipping once every track in the list has failed');
assert.ok(loopingDeck.calls.toasts.at(-1).includes('đã dừng phát'), 'Skipping a fully broken list should toast that playback stopped');
const resetDeck = exerciseDeckError({errorSkipCount: 2});
resetDeck.audio.fire('play');
assert.equal(resetDeck.state.errorSkipCount, 0, 'Successful playback should reset the consecutive error-skip count');
assert.ok(appCode.includes('metadataUI.open(trackById(button.dataset.metadataTrackId))'), 'Track metadata button should open details without starting playback');
assert.ok(appCode.includes('library.normalizeSearchKey(selected)'), 'Filter selection should use the shared accent-insensitive search key');
assert.ok(appCode.includes('library.normalizeSearchKey(info.artist)'), 'Collection artist cards should group accent variants together');
assert.ok(appCode.includes('library.normalizeSearchKey(metadata(track).artist) === state.artist'), 'Collection artist filter should compare accent-insensitive keys');
assert.ok(appCode.includes('library.normalizeSearchKey(metadata(track).album)'), 'Collection album filter should compare accent-insensitive keys');
assert.ok(appCode.includes('library.normalizeSearchKey(state.query)'), 'Collection search should match queries typed without diacritics');
assert.ok(html.indexOf('</dialog>') > html.indexOf('<dialog id="settings-modal"') && html.indexOf('</dialog>') < html.indexOf('<div id="metadata-modal"'), 'Settings dialog should close with </dialog> before the metadata modal so later panels are not trapped inside it');
assert.ok(metadataUiCode.includes('client.wikipediaSummary'), 'Artist details should load a verified Wikipedia biography when available');
assert.ok(metadataUiCode.includes('client.coverArt'), 'Album details should retrieve Cover Art Archive artwork');
assert.ok(metadataUiCode.includes('data-metadata-follow'), 'Artist credits should link to related artist details');
assert.equal((appCode.match(/function refreshQueueRows\(\)/g) || []).length, 1, 'refreshQueueRows should be defined exactly once so only one queue-indicator implementation runs');
assert.ok(appCode.includes('data-queue-indicator="true"'), 'Queued track rows should mark their indicator so refreshQueueRows can swap it back to a play-next button');
const refreshStart = appCode.indexOf('function refreshQueueRows() {');
assert.ok(refreshStart >= 0, 'refreshQueueRows implementation should exist for regression checks');
const refreshEnd = appCode.indexOf('function addToQueue(trackId) {', refreshStart);
assert.ok(refreshEnd > refreshStart, 'refreshQueueRows implementation should be extractable for regression checks');
const refreshSource = appCode.slice(refreshStart, refreshEnd);
class FakeQueueElement {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.dataset = {}; this.children = []; this.parent = null; this.className = ''; this.title = ''; this.textContent = ''; this.type = ''; }
  append(child) { child.parent = this; this.children.push(child); return child; }
  replaceWith(element) { const index = this.parent ? this.parent.children.indexOf(this) : -1; if (index >= 0) { this.parent.children[index] = element; element.parent = this.parent; } }
  querySelector(selector) {
    const match = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
    if (!match) return null;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const visit = element => {
      for (const child of element.children) {
        if (child.dataset && Object.prototype.hasOwnProperty.call(child.dataset, key) && (match[2] === undefined || child.dataset[key] === match[2])) return child;
        const found = visit(child); if (found) return found;
      }
      return null;
    };
    return visit(this);
  }
  querySelectorAll(selector) { return selector === '[data-track-id]' ? this.children.filter(child => child.dataset && child.dataset.trackId !== undefined) : []; }
}
function exerciseRefreshQueueRows({queuedIds, currentId, rows}) {
  const trackList = new FakeQueueElement('div');
  for (const row of rows) trackList.append(row);
  const refreshQueueRows = new Function('state', '$', 'renderQueue', 'document', `${refreshSource}\nreturn refreshQueueRows;`)(
    {queueTrackIds: queuedIds, currentId},
    id => id === 'track-list' ? trackList : null,
    () => {},
    {createElement: tag => new FakeQueueElement(tag)},
  );
  refreshQueueRows();
  return rows;
}
function queueRow(trackId, control) { const row = new FakeQueueElement('div'); row.dataset.trackId = trackId; if (control) row.append(control); return row; }
function queueAddButton(trackId) { const button = new FakeQueueElement('button'); button.dataset.queueAction = 'add'; button.dataset.trackId = trackId; return button; }
function queueIndicator() { const indicator = new FakeQueueElement('span'); indicator.dataset.queueIndicator = 'true'; indicator.textContent = '☷'; return indicator; }
const removedFromQueue = exerciseRefreshQueueRows({queuedIds: [], currentId: 'playing', rows: [queueRow('t1', queueIndicator())]})[0];
assert.equal(removedFromQueue.querySelector('[data-queue-indicator]'), null, 'Removing a track from the queue should clear its queued indicator');
const restoredButton = removedFromQueue.querySelector('[data-queue-action="add"]');
assert.ok(restoredButton, 'Removing a track from the queue should restore its play-next button');
assert.equal(restoredButton.dataset.trackId, 't1', 'The restored play-next button should target the same track');
const addedToQueue = exerciseRefreshQueueRows({queuedIds: ['t2'], currentId: 'playing', rows: [queueRow('t2', queueAddButton('t2'))]})[0];
assert.equal(addedToQueue.querySelector('[data-queue-action="add"]'), null, 'Adding a track to the queue should replace its play-next button');
assert.ok(addedToQueue.querySelector('[data-queue-indicator]'), 'Adding a track to the queue should show its queued indicator');
const currentRow = exerciseRefreshQueueRows({queuedIds: ['playing'], currentId: 'playing', rows: [queueRow('playing', queueAddButton('playing'))]})[0];
assert.ok(currentRow.querySelector('[data-queue-action="add"]'), 'The currently playing track should keep its play-next control instead of a queue indicator');
console.log('Inline app syntax, persistence and recent playback/UI regression tests passed.');
