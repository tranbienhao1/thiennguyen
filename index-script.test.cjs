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
assert.ok(appCode.includes("library.parseCloudConfig(localStorage.getItem('nocturne-google'))"), 'Google config reads should go through the safe cloud-config parser');
assert.ok(appCode.includes("library.parseCloudConfig(localStorage.getItem('nocturne-microsoft'))"), 'Microsoft config reads should go through the safe cloud-config parser');
assert.ok(appCode.includes('library.shouldPreloadNext(element.duration, element.currentTime, standbyAudio.src, state.preloadReadyUrl, library.PRELOAD_LEAD_SECONDS, location.href)'), 'Next-track preload should start 15 seconds before the current track ends');
assert.ok(!appCode.includes('element.duration - element.currentTime <= 12'), 'Preload timing should use the shared 15-second lead helper instead of a hardcoded 12-second check');
assert.ok(libraryCode.includes('PRELOAD_LEAD_SECONDS = 15'), 'Preload lead should be 15 seconds for gapless playback');
assert.ok(!appCode.includes("JSON.parse(localStorage.getItem('nocturne-google')"), 'Corrupt Google config must not throw at read time');
assert.ok(!appCode.includes("JSON.parse(localStorage.getItem('nocturne-microsoft')"), 'Corrupt Microsoft config must not throw at read time');
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
assert.match(html, /#track-list \.track-row \{[^}]*content-visibility:auto/, 'Off-screen library rows should skip rendering so large lists scroll at 60fps');
assert.match(html, /#track-list \.track-row \{[^}]*contain-intrinsic-size:auto 64px/, 'Skipped library rows should reserve their 64px height so the scrollbar stays stable');
assert.match(html, /#track-list \.track-row \{[^}]*min-height:64px/, 'Library rows should keep their 64px minimum height after the visibility optimization');
assert.equal([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce((count, match) => count + [...match[1].matchAll(/content-visibility:auto/g)].length, 0), 4, 'The content-visibility optimization should apply exactly four times: to library rows, collection cards, queue rows and lyric lines');
assert.match(html, /\.lyric-line \{[^}]*content-visibility:auto/, 'Off-screen lyric lines should skip rendering so long synced lyrics scroll at 60fps');
assert.match(html, /\.lyric-line \{[^}]*contain-intrinsic-size:auto 28px/, 'Skipped lyric lines should reserve their 28px height so the lyrics scrollbar stays stable');
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
assert.ok(appCode.includes('cover:coverForCatalog(track.cover)'), 'Cloud catalog should persist extracted cover art through the size cap');
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

const auditStart = appCode.indexOf('function formatDecodeAudit(decodeMs, maxChunkMs, chunksOverBudget, throughputMBps, initialChunkBytes, maxConsecutiveOverBudget, minSliceThroughputMBps) {');
assert.ok(auditStart >= 0, 'DSD decode audit formatter should exist for regression checks');
const auditEnd = appCode.indexOf('function signalDescription(track) {', auditStart);
assert.ok(auditEnd > auditStart, 'DSD decode audit formatter should be extractable for regression checks');
const formatDecodeAudit = new Function(appCode.slice(auditStart, auditEnd) + '\nreturn formatDecodeAudit;')();
assert.equal(formatDecodeAudit(1234, 34), 'giải mã 1.2 s · lát chậm nhất 34 ms', 'Slow DSD decode should show seconds and the slowest chunk');
assert.equal(formatDecodeAudit(850, 12), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Fast DSD decode should show milliseconds');
assert.equal(formatDecodeAudit(1000, 0), 'giải mã 1.0 s · lát chậm nhất 0 ms', 'Decode of exactly one second should use the seconds form');
assert.equal(formatDecodeAudit(1234, 120, 3), 'giải mã 1.2 s · lát chậm nhất 120 ms · 3 lát vượt 50 ms', 'Over-budget chunks should be reported in the audit line');
assert.equal(formatDecodeAudit(1234, 120, 3, 12.34), 'giải mã 1.2 s · lát chậm nhất 120 ms · 3 lát vượt 50 ms · 12.3 MB/s', 'Decode throughput should be reported in the audit line when measured');
assert.equal(formatDecodeAudit(1234, 120, 3, 12.34, 262144), 'giải mã 1.2 s · lát chậm nhất 120 ms · 3 lát vượt 50 ms · 12.3 MB/s · lát đầu 256 KiB', 'The first chunk size should be reported in the audit line when measured');
assert.equal(formatDecodeAudit(1234, 120, 3, 12.34, 32768), 'giải mã 1.2 s · lát chậm nhất 120 ms · 3 lát vượt 50 ms · 12.3 MB/s · lát đầu 32 KiB', 'A small first chunk should be reported in KiB');
assert.equal(formatDecodeAudit(850, 12, 0, 0, 0), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Zero first-chunk size should not add an audit segment');
assert.equal(formatDecodeAudit(850, 12, 0, undefined, undefined), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Tracks decoded before the first-chunk audit should keep the old audit line');
assert.equal(formatDecodeAudit(850, 12, 0, 0), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Zero throughput should not add an audit segment');
assert.equal(formatDecodeAudit(850, 12, 0, undefined), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Tracks decoded before the throughput audit should keep the old audit line');
assert.equal(formatDecodeAudit(850, 12, 0, NaN), 'giải mã 850 ms · lát chậm nhất 12 ms', 'An invalid throughput should not add an audit segment');
assert.equal(formatDecodeAudit(850, 12, 0), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Zero over-budget chunks should not add an audit segment');
assert.equal(formatDecodeAudit(1234, 120, 3, 12.34, 262144, 3, 0.8), 'giải mã 1.2 s · lát chậm nhất 120 ms · 3 lát vượt 50 ms · cảnh báo: 3 lát liên tiếp vượt 50 ms · 12.3 MB/s · throughput lát chậm nhất 0.8 MB/s · lát đầu 256 KiB', 'Three over-budget chunks in a row should warn and show the slowest-slice throughput');
assert.equal(formatDecodeAudit(1234, 120, 2, 12.34, 262144, 2, 0.8), 'giải mã 1.2 s · lát chậm nhất 120 ms · 2 lát vượt 50 ms · 12.3 MB/s · throughput lát chậm nhất 0.8 MB/s · lát đầu 256 KiB', 'A streak of 2 should not warn yet it should still show the slowest-slice throughput');
assert.equal(formatDecodeAudit(1234, 120, 3, 12.34, 262144, 3, 0), 'giải mã 1.2 s · lát chậm nhất 120 ms · 3 lát vượt 50 ms · cảnh báo: 3 lát liên tiếp vượt 50 ms · 12.3 MB/s · lát đầu 256 KiB', 'Zero slowest-slice throughput should not add an audit segment');
assert.equal(formatDecodeAudit(850, 12, 0, undefined, undefined, undefined, undefined), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Tracks decoded before the streak audit should keep the old audit line');
assert.equal(formatDecodeAudit(850, 12, undefined), 'giải mã 850 ms · lát chậm nhất 12 ms', 'Tracks decoded before the over-budget audit should keep the old audit line');
assert.equal(formatDecodeAudit(850, 12, -1), 'giải mã 850 ms · lát chậm nhất 12 ms', 'A negative over-budget count should not add an audit segment');
assert.equal(formatDecodeAudit(null, 10), '', 'Missing decode time should hide the audit line');
assert.equal(formatDecodeAudit(100, NaN), '', 'Missing slowest-chunk time should hide the audit line');
assert.equal(formatDecodeAudit(-5, 10), '', 'Negative decode time should hide the audit line');
assert.equal(formatDecodeAudit(undefined, undefined), '', 'Tracks decoded before the audit should show no audit line');
assert.ok(appCode.includes('track.dsdDecodeMs = message.decodeMs'), 'DSD worker completion should store the measured decode time on the track');
assert.ok(appCode.includes('track.dsdMaxChunkMs = message.maxChunkMs'), 'DSD worker completion should store the slowest chunk time on the track');
assert.ok(appCode.includes('track.dsdChunksOverBudget = message.chunksOverBudget'), 'DSD worker completion should store the over-budget chunk count on the track');
assert.ok(appCode.includes('track.dsdChunkCount = message.chunkCount'), 'DSD worker completion should store the decoded chunk count on the track');
assert.ok(appCode.includes('track.dsdFinalChunkBytes = message.finalChunkBytes'), 'DSD worker completion should store the final adapted chunk size on the track');
assert.ok(appCode.includes('track.dsdThroughputMBps = message.decodeThroughputMBps'), 'DSD worker completion should store the measured decode throughput on the track');
assert.ok(appCode.includes('track.dsdInitialChunkBytes = message.initialChunkBytes'), 'DSD worker completion should store the first chunk size on the track');
assert.ok(appCode.includes('track.dsdMaxConsecutiveOverBudget = message.maxConsecutiveOverBudget'), 'DSD worker completion should store the longest over-budget streak on the track');
assert.ok(appCode.includes('track.dsdMinSliceThroughputMBps = message.minSliceThroughputMBps'), 'DSD worker completion should store the slowest-slice throughput on the track');
assert.ok(appCode.includes('formatDecodeAudit(track.dsdDecodeMs, track.dsdMaxChunkMs, track.dsdChunksOverBudget, track.dsdThroughputMBps, track.dsdInitialChunkBytes, track.dsdMaxConsecutiveOverBudget, track.dsdMinSliceThroughputMBps)'), 'Track detail should show the DSD decode audit with streak warning and slowest-slice throughput when available');
assert.ok(appCode.includes('track.dsdMaxConsecutiveOverBudget) && track.dsdMaxConsecutiveOverBudget >= 3'), 'A sustained slow DSD streak should produce device advice in the track detail');
assert.ok(appCode.includes('thử giảm tần số PCM đích trong cài đặt DSD'), 'Device advice should suggest lowering the DSD target PCM rate');
assert.ok(appCode.includes('room.advice ? ` · ${room.advice}` : '), 'Listening room should show the DSD device advice when present');

const rebuildStart = appCode.indexOf('function rebuildAudioRoutes() {');
assert.ok(rebuildStart >= 0, 'rebuildAudioRoutes implementation should exist for regression checks');
const rebuildEnd = appCode.indexOf('function setupAudio() {', rebuildStart);
assert.ok(rebuildEnd > rebuildStart, 'rebuildAudioRoutes implementation should be extractable for regression checks');
const rebuildSource = appCode.slice(rebuildStart, rebuildEnd);
assert.ok(!rebuildSource.includes('.frequency.value = band.frequency'), 'Rebuilding audio routes must not hard-set filter frequency while audio may be playing');
assert.ok(!rebuildSource.includes('.gain.value = band.gain'), 'Rebuilding audio routes must not hard-set filter gain while audio may be playing');
assert.ok(!rebuildSource.includes('deck.preamp.gain.value ='), 'Rebuilding audio routes must not hard-set preamp gain while audio may be playing');
assert.ok(!rebuildSource.includes('deck.direct.gain.value ='), 'Rebuilding audio routes must not hard-set direct gain while audio may be playing');
assert.ok(rebuildSource.includes('filter.frequency.setTargetAtTime(band.frequency, state.context.currentTime, .015)'), 'Rebuilding audio routes should smooth filter frequency like applyEq');
function exerciseRebuildAudioRoutes() {
  const params = [];
  const makeParam = initial => { const param = {value: initial, calls: [], setTargetAtTime(target, time, timeConstant) { param.calls.push([target, time, timeConstant]); }}; params.push(param); return param; };
  const makeDeck = () => {
    const filter = {type: '', frequency: makeParam(350), Q: makeParam(1), gain: makeParam(0)};
    return {filters: [filter], preamp: {gain: makeParam(1)}, direct: {gain: makeParam(0)}, router: {disconnect() {}}, _filter: filter};
  };
  const deckA = makeDeck(), deckB = makeDeck();
  const state = {context: {currentTime: 12.5}, deckA, deckB, bands: [{type: 'peaking', frequency: 1000, q: 2, gain: 3}], activeAnalyser: null};
  const $ = id => id === 'eq-preamp' ? {value: '0'} : {checked: true};
  const rebuildDeckRoute = deck => { deck.filters = [deck._filter]; };
  const factory = new Function('state', '$', 'rebuildDeckRoute', rebuildSource + '\nreturn rebuildAudioRoutes;');
  factory(state, $, rebuildDeckRoute)();
  return {params, deckA, deckB};
}
const rebuilt = exerciseRebuildAudioRoutes();
assert.ok(rebuilt.params.every(param => param.calls.length > 0), 'Every rebuilt audio param should be smoothed with setTargetAtTime');
assert.equal(rebuilt.deckA._filter.frequency.calls[0][0], 1000, 'Rebuilt filter frequency should ramp to the band frequency');
assert.equal(rebuilt.deckA._filter.frequency.value, 350, 'Rebuilt filter frequency must not jump to the band value instantly');
assert.equal(rebuilt.deckA._filter.gain.calls[0][0], 3, 'Rebuilt filter gain should ramp to the band gain');
assert.equal(rebuilt.deckA.direct.gain.calls[0][0], 0, 'Rebuilt direct gain should ramp to muted while EQ is enabled');
assert.ok(Math.abs(rebuilt.deckA.preamp.gain.calls[0][0] - Math.pow(10, -3 / 20)) < 1e-9, 'Rebuilt preamp gain should ramp to the headroom-compensated level');

// Pha A — soft limiter sau EQ: factory phải đặt đúng thông số limiter và
// rebuildDeckRoute phải nối preamp -> limiter (không nối thẳng analyser).
const limiterStart = appCode.indexOf('function createSoftLimiter(context) {');
assert.ok(limiterStart >= 0, 'Soft limiter factory should exist for regression checks');
const limiterEnd = appCode.indexOf('function rebuildDeckRoute(deck) {', limiterStart);
assert.ok(limiterEnd > limiterStart, 'Soft limiter factory should be extractable for regression checks');
const createSoftLimiter = new Function(appCode.slice(limiterStart, limiterEnd) + '\nreturn createSoftLimiter;')();
const limiterNode = {threshold: {value: 0}, knee: {value: 0}, ratio: {value: 1}, attack: {value: 0}, release: {value: 0}};
const limiterContext = {createDynamicsCompressor() { return limiterNode; }};
assert.equal(createSoftLimiter(limiterContext), limiterNode, 'Soft limiter factory should return the compressor created by the context');
assert.equal(limiterNode.threshold.value, -3, 'Soft limiter threshold should be -3 dB');
assert.equal(limiterNode.knee.value, 0, 'Soft limiter knee should be hard (0 dB)');
assert.equal(limiterNode.ratio.value, 20, 'Soft limiter ratio should be 20:1');
assert.equal(limiterNode.attack.value, 0.003, 'Soft limiter attack should be 3 ms');
assert.equal(limiterNode.release.value, 0.1, 'Soft limiter release should be 100 ms');
assert.ok(appCode.includes('limiter: null'), 'App state should hold the shared soft limiter node');
assert.ok(appCode.includes('state.limiter = createSoftLimiter(state.context)'), 'Audio setup should create the shared soft limiter');
assert.ok(appCode.includes('state.limiter.connect(state.analyser)'), 'Audio setup should route the soft limiter into the EQ analyser');
assert.ok(appCode.includes('deck.preamp.connect(state.preLimiterAnalyser)'), 'Deck rebuild should route the EQ preamp through the pre-limiter analyser into the soft limiter');
assert.ok(!appCode.includes('deck.preamp.connect(state.analyser)'), 'Deck rebuild should no longer route the EQ preamp straight into the analyser');
assert.ok(!appCode.includes('deck.preamp.connect(state.limiter)'), 'Deck rebuild should route the EQ preamp through the pre-limiter analyser, not straight into the limiter');
const deckRouteStart = appCode.indexOf('function rebuildDeckRoute(deck) {');
assert.ok(deckRouteStart >= 0, 'Deck route builder should exist for regression checks');
const deckRouteEnd = appCode.indexOf('function rebuildAudioRoutes() {', deckRouteStart);
assert.ok(deckRouteEnd > deckRouteStart, 'Deck route builder should be extractable for regression checks');
function exerciseRebuildDeckRoute() {
  const makeNode = name => ({name, connectedTo: [], disconnected: 0, connect(target) { this.connectedTo.push(target); }, disconnect() { this.disconnected++; }});
  const limiter = makeNode('limiter'), preLimiterAnalyser = makeNode('preLimiterAnalyser'), analyser = makeNode('analyser'), directAnalyser = makeNode('directAnalyser');
  const state = {bands: [{type: 'peaking'}], context: {createBiquadFilter: () => makeNode('filter')}, limiter, preLimiterAnalyser, analyser, directAnalyser};
  const oldFilter = makeNode('old-filter');
  const deck = {router: makeNode('router'), preamp: makeNode('preamp'), direct: makeNode('direct'), filters: [oldFilter]};
  // The extracted builder closes over the factory's `state` parameter, so
  // the factory must be invoked with the mock state for the closure to see it.
  const rebuildDeckRoute = new Function('deck', 'state', appCode.slice(deckRouteStart, deckRouteEnd) + '\nreturn rebuildDeckRoute;')(null, state);
  rebuildDeckRoute(deck, state);
  return {deck, state, oldFilter};
}
const routed = exerciseRebuildDeckRoute();
assert.equal(routed.oldFilter.disconnected, 1, 'Rebuilding a deck route should disconnect the old EQ filter');
assert.equal(routed.deck.preamp.disconnected, 1, 'Rebuilding a deck route should disconnect the preamp before rewiring it');
assert.ok(routed.deck.direct.connectedTo.includes(routed.state.directAnalyser), 'Direct path should still reach the direct analyser');
assert.ok(routed.deck.preamp.connectedTo.includes(routed.state.preLimiterAnalyser), 'EQ preamp should connect into the pre-limiter analyser');
assert.ok(!routed.deck.preamp.connectedTo.includes(routed.state.analyser), 'EQ preamp should not bypass the soft limiter into the analyser');
assert.ok(!routed.deck.preamp.connectedTo.includes(routed.state.limiter), 'EQ preamp should reach the limiter through the pre-limiter analyser, not directly');
assert.ok(routed.deck.router.connectedTo.includes(routed.deck.direct), 'Deck router should feed the direct path');
assert.equal(routed.deck.filters.length, 1, 'Rebuilding a deck route should recreate one filter per EQ band');

// Pha B — đo peak trước/sau limiter: mức giảm gain thực tế hiện ở readout.
const reductionStart = appCode.indexOf('function limiterReductionText(prePeakDb, postPeakDb) {');
assert.ok(reductionStart >= 0, 'Limiter reduction formatter should exist for regression checks');
const reductionEnd = appCode.indexOf('let visualizerFrame = 0, visualizerGeneration = 0;', reductionStart);
assert.ok(reductionEnd > reductionStart, 'Limiter reduction formatter should be extractable for regression checks');
const limiterReductionText = new Function(appCode.slice(reductionStart, reductionEnd) + '\nreturn limiterReductionText;')();
assert.equal(limiterReductionText(0, -3), ' · Lim -3.0 dB', 'A pre-limiter peak 3 dB above the post-limiter peak should report 3 dB of reduction');
assert.equal(limiterReductionText(-1.5, -3.25), ' · Lim -1.8 dB', 'A fractional reduction should round to one decimal');
assert.equal(limiterReductionText(-3, -3), '', 'Equal pre/post peaks should not report a reduction');
assert.equal(limiterReductionText(-3, -1), '', 'A post-limiter peak above the pre-limiter peak should not report a reduction');
assert.equal(limiterReductionText(-10, -10.04), '', 'A reduction within the 0.05 dB noise floor should not report');
assert.equal(limiterReductionText(NaN, -3), '', 'A missing pre-limiter peak should not report a reduction');
assert.equal(limiterReductionText(0, undefined), '', 'A missing post-limiter peak should not report a reduction');
assert.equal(limiterReductionText(-96, -96), '', 'Silence before and after the limiter should not report a reduction');
assert.ok(appCode.includes('preLimiterAnalyser: null'), 'App state should hold the pre-limiter analyser node');
assert.ok(appCode.includes('state.preLimiterAnalyser = state.context.createAnalyser()'), 'Audio setup should create the pre-limiter analyser');
assert.ok(appCode.includes('state.preLimiterAnalyser.connect(state.limiter)'), 'Audio setup should route the pre-limiter analyser into the soft limiter');
assert.ok(appCode.includes('state.preLimiterAnalyser.getByteTimeDomainData(preTimeData)'), 'Level readout should sample the pre-limiter analyser');
assert.ok(appCode.includes("if (preTimeData && $('eq-enabled').checked)"), 'Limiter reduction should only be measured while EQ is enabled');

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
const skipFailedStart = appCode.indexOf('function skipFailedTrack(generation, message) {');
assert.ok(skipFailedStart >= 0, 'skipFailedTrack implementation should exist for regression checks');
const skipFailedEnd = appCode.indexOf('async function playTrack(trackId) {', skipFailedStart);
assert.ok(skipFailedEnd > skipFailedStart, 'skipFailedTrack implementation should be extractable for regression checks');
const skipFailedSource = appCode.slice(skipFailedStart, skipFailedEnd);
function exerciseSkipFailed({generation = 3, playGeneration = 3, errorSkipCount = 0, tracks = [{id:'bad'}, {id:'next'}], message = 'Bài lỗi, chuyển sang bài tiếp theo.'} = {}) {
  const calls = {toasts: [], playedNext: []};
  const state = {tracks, errorSkipCount, playGeneration};
  const skipFailedTrack = new Function('state', 'toast', 'playNext', `${skipFailedSource}\nreturn skipFailedTrack;`)(
    state, text => calls.toasts.push(text), (direction, auto) => calls.playedNext.push([direction, auto]),
  );
  const skipped = skipFailedTrack(generation, message);
  return {calls, state, skipped};
}
const staleSkip = exerciseSkipFailed({generation: 2, playGeneration: 3});
assert.equal(staleSkip.skipped, false, 'A stale playback failure must not skip the track that is already playing');
assert.deepEqual(staleSkip.calls.playedNext, [], 'A stale playback failure must not advance to another track');
assert.deepEqual(staleSkip.calls.toasts, [], 'A stale playback failure must stay silent');
assert.equal(staleSkip.state.errorSkipCount, 0, 'A stale playback failure must not count toward the error-skip guard');
const freshSkip = exerciseSkipFailed();
assert.equal(freshSkip.skipped, true, 'A current-generation playback failure should skip to the next track');
assert.deepEqual(freshSkip.calls.playedNext, [[1, false]], 'Error skip should advance without the autoplay, sleep-timer or repeat-one gates');
assert.ok(freshSkip.calls.toasts[0].includes('chuyển sang bài tiếp theo'), 'Error skip should toast that playback moved to the next track');
assert.equal(freshSkip.state.errorSkipCount, 1, 'A playback failure should count toward the consecutive error-skip guard');
const loopingSkip = exerciseSkipFailed({errorSkipCount: 2, tracks: [{id:'only'}, {id:'last'}]});
assert.equal(loopingSkip.skipped, false, 'Skipping a fully broken list should stop instead of looping');
assert.deepEqual(loopingSkip.calls.playedNext, [], 'Skipping a fully broken list should not advance again');
assert.ok(loopingSkip.calls.toasts[0].includes('đã dừng phát'), 'Skipping a fully broken list should toast that playback stopped');
assert.equal(loopingSkip.state.errorSkipCount, 0, 'The error-skip guard should reset after stopping a fully broken list');
const silentSkip = exerciseSkipFailed({message: ''});
assert.equal(silentSkip.skipped, true, 'A failure without a message should still skip');
assert.deepEqual(silentSkip.calls.playedNext, [[1, false]], 'A failure without a message should still advance');
assert.deepEqual(silentSkip.calls.toasts, [], 'A failure without a message should not toast an empty message');
assert.equal((appCode.match(/skipFailedTrack\(generation, `/g) || []).length, 8, 'Every playback-failure path should route through skipFailedTrack');
assert.ok(appCode.includes("if (error.name === 'NotSupportedError' || target.error) skipFailedTrack(generation"), 'A play() rejection should only skip for load/decode failures, not autoplay blocks');
assert.ok(appCode.includes('else toast(mediaErrorMessage(error));'), 'A blocked autoplay attempt should still toast instead of skipping');
assert.ok(!appCode.includes('toast(`Không thể chuẩn bị phát DSD:'), 'A DSD setup failure should skip instead of only toasting');
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
const lyricsStart = appCode.indexOf('function renderLyrics(');
const lyricsEnd = appCode.indexOf('function displayTrack(', lyricsStart);
assert.ok(lyricsStart >= 0 && lyricsEnd > lyricsStart, 'Synced lyrics rendering should exist for regression checks');
const lyricsSource = appCode.slice(lyricsStart, lyricsEnd);
class FakeLyricElement {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.dataset = {}; this.className = ''; this.textContent = ''; this.listeners = {}; const classes = new Set(); this.classList = {add: name => classes.add(name), remove: name => classes.delete(name), toggle: (name, force) => { if (force) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name)}; this.scrolledIntoView = false; this._innerHTML = ''; }
  set innerHTML(value) { this.children = []; this._innerHTML = value; }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  querySelectorAll(selector) { return selector === '.lyric-line' ? this.children.filter(child => child.className.split(' ').includes('lyric-line')) : []; }
  scrollIntoView() { this.scrolledIntoView = true; }
}
function exerciseLyrics(lrcText, currentTime) {
  const container = new FakeLyricElement('div');
  const audioStub = {currentTime, duration: 300};
  const stateStub = {lyrics: [], lyricIndex: -1};
  const fns = new Function('state', '$', 'library', 'audio', 'document', 'updatePositionState', `${lyricsSource}\nreturn {renderLyrics, updateLyricsHighlight};`)(
    stateStub, id => id === 'room-lyrics' ? container : null, require('./library-utils.js'), audioStub, {createElement: tag => new FakeLyricElement(tag)}, () => {});
  fns.renderLyrics(lrcText);
  return {container, audioStub, stateStub, fns};
}
assert.match(html, /id="room-lyrics"/, 'Listening room should provide a lyrics panel');
assert.ok(appCode.includes("renderLyrics(track.lyricsText || '')"), 'Track display should render the track lyrics text');
assert.ok(appCode.includes('updateLyricsHighlight();'), 'Playback progress should highlight the current lyric line');
assert.ok(appCode.includes("lrcByBase") && appCode.includes("/\\.lrc$/i"), 'Local folders should match sibling .lrc files by audio basename');
assert.ok(appCode.includes('lyrics: tags.lyrics'), 'Embedded USLT lyrics should be read from local file tags');
const synced = exerciseLyrics('[00:01.00]Dòng một\n[00:05.50]Dòng hai\n[00:10.00]Dòng ba', 6);
assert.equal(synced.container.children.length, 3, 'Synced .lrc should render one row per timestamped line');
assert.deepEqual(synced.container.children.map(row => row.dataset.time), ['1', '5.5', '10'], 'Lyric rows should keep their timestamps for click-to-seek');
assert.ok(synced.container.children.every(row => row.classList.contains('lyric-line-seekable')), 'Timestamped lyric rows should be clickable to seek');
synced.fns.updateLyricsHighlight();
assert.equal(synced.stateStub.lyricIndex, 1, 'Lyric highlight should pick the last line at or before the playback time');
assert.ok(synced.container.children[1].classList.contains('lyric-line-active') && !synced.container.children[0].classList.contains('lyric-line-active'), 'Only the current lyric line should be highlighted');
assert.equal(synced.container.children[1].scrolledIntoView, true, 'The current lyric line should scroll into view');
synced.container.children[2].listeners.click[0]();
assert.equal(synced.audioStub.currentTime, 10, 'Clicking a lyric line should seek to its timestamp');
const plain = exerciseLyrics('Dòng không mốc\nDòng thứ hai', 0);
assert.equal(plain.container.children.length, 2, 'Plain embedded lyrics should render as untimed lines');
assert.ok(plain.container.children.every(row => !row.classList.contains('lyric-line-seekable')), 'Untimed lyric lines should not offer click-to-seek');
const empty = exerciseLyrics(null, 0);
assert.match(empty.container.innerHTML, /Chưa có lời đồng bộ/, 'A track without lyrics should show the empty lyrics state');
// Pha C — hủy bản preload cũ khi chuyển sang bài DSD (chống tràn RAM).
const releaseTrackUrlStart = appCode.indexOf('function releaseTrackUrl(url) {');
const releaseTrackUrlEnd = appCode.indexOf('function filteredTracks() {', releaseTrackUrlStart);
const releaseUnusedStart = appCode.indexOf('function releaseUnusedCloudUrl(track) {');
const clearStaleStart = appCode.indexOf('function clearStalePreload() {');
const clearStaleEnd = appCode.indexOf("window.addEventListener('beforeunload'", clearStaleStart);
assert.ok(releaseTrackUrlStart >= 0 && releaseTrackUrlEnd > releaseTrackUrlStart, 'releaseTrackUrl implementation should exist for regression checks');
assert.ok(releaseUnusedStart >= 0 && clearStaleStart > releaseUnusedStart && clearStaleEnd > clearStaleStart, 'clearStalePreload implementation should exist for regression checks');
const releaseSource = appCode.slice(releaseTrackUrlStart, releaseTrackUrlEnd) + appCode.slice(releaseUnusedStart, clearStaleEnd);
class FakePreloadAudio {
  constructor(src = '') { this.src = src; this.paused = false; this.loaded = 0; this.removed = []; }
  pause() { this.paused = true; }
  removeAttribute(name) { this.removed.push(name); if (name === 'src') this.src = ''; }
  load() { this.loaded++; }
}
function exerciseClearStalePreload({preloadTrack = null, audioSrc = '', standbySrc = ''} = {}) {
  const calls = {revoked: []};
  const tracks = preloadTrack ? [preloadTrack] : [];
  const state = {tracks, objectUrls: new Set(preloadTrack && preloadTrack.url ? [preloadTrack.url] : []), preloadTrackId: preloadTrack ? preloadTrack.id : null, preloadReadyUrl: preloadTrack ? preloadTrack.url : null, preloadBusyId: preloadTrack ? preloadTrack.id : null, preloadGeneration: 4};
  const audio = new FakePreloadAudio(audioSrc);
  const standbyAudio = new FakePreloadAudio(standbySrc);
  class FakeURL extends URL { static revokeObjectURL(url) { calls.revoked.push(url); } }
  const clearStalePreload = new Function('state', 'audio', 'standbyAudio', 'URL', 'location', `${releaseSource}\nreturn clearStalePreload;`)(
    state, audio, standbyAudio, FakeURL, {href: 'https://tranbienhao1.github.io/thiennguyen/'},
  );
  clearStalePreload();
  return {calls, state, audio, standbyAudio, track: preloadTrack};
}
const staleCloud = exerciseClearStalePreload({preloadTrack: {id: 'next', source: 'google', url: 'blob:https://example/abc'}, standbySrc: 'blob:https://example/abc'});
assert.equal(staleCloud.state.preloadTrackId, null, 'Switching to DSD should clear the stale preloaded track');
assert.equal(staleCloud.state.preloadReadyUrl, null, 'Switching to DSD should clear the stale preloaded URL');
assert.equal(staleCloud.state.preloadBusyId, null, 'Switching to DSD should clear the stale preload busy flag');
assert.equal(staleCloud.state.preloadGeneration, 5, 'Clearing a stale preload should invalidate in-flight preload work');
assert.equal(staleCloud.standbyAudio.paused, true, 'Clearing a stale preload should pause the standby deck');
assert.deepEqual(staleCloud.standbyAudio.removed, ['src'], 'Clearing a stale preload should detach the standby deck source');
assert.equal(staleCloud.standbyAudio.loaded, 1, 'Clearing a stale preload should reload the standby deck');
assert.deepEqual(staleCloud.calls.revoked, ['blob:https://example/abc'], 'A stale cloud preload blob URL should be revoked when switching to DSD');
assert.equal(staleCloud.state.objectUrls.has('blob:https://example/abc'), false, 'A revoked preload URL should leave the tracked object URL set');
assert.equal(staleCloud.track.url, '', 'A released preload track should forget its revoked URL');
const staleLocal = exerciseClearStalePreload({preloadTrack: {id: 'next', source: 'local', url: 'blob:https://example/local'}, standbySrc: 'blob:https://example/local'});
assert.equal(staleLocal.state.preloadTrackId, null, 'A stale local preload should still clear its preload state');
assert.deepEqual(staleLocal.calls.revoked, [], 'A local file preload URL should not be revoked so the file can play again');
assert.equal(staleLocal.track.url, 'blob:https://example/local', 'A local preload should keep its file URL');
const inUsePreload = exerciseClearStalePreload({preloadTrack: {id: 'next', source: 'onedrive', url: 'blob:https://example/live'}, audioSrc: 'blob:https://example/live'});
assert.deepEqual(inUsePreload.calls.revoked, [], 'A preload URL still playing on the active deck must not be revoked');
assert.equal(inUsePreload.track.url, 'blob:https://example/live', 'A preload URL still in use should stay cached on its track');
const noPreload = exerciseClearStalePreload();
assert.equal(noPreload.state.preloadTrackId, null, 'Clearing with no preload should stay a no-op for preload state');
assert.equal(noPreload.state.preloadGeneration, 5, 'Clearing with no preload should still invalidate in-flight preload work');
assert.deepEqual(noPreload.calls.revoked, [], 'Clearing with no preload should revoke nothing');
// Pha C — thu hồi blob URL file local của bài vừa phát xong khi đổi bài
// (chống giữ file nhạc trong RAM suốt phiên); bài local phát lại được nhờ
// playTrack tạo lại URL từ track.file.
function exerciseReleaseLocalUrl({track, currentId = 'other', audioSrc = '', standbySrc = ''} = {}) {
  const calls = {revoked: []};
  const state = {tracks: [track], currentId, objectUrls: new Set(track.url ? [track.url] : [])};
  const audio = new FakePreloadAudio(audioSrc);
  const standbyAudio = new FakePreloadAudio(standbySrc);
  class FakeURL extends URL { static revokeObjectURL(url) { calls.revoked.push(url); } }
  const releaseUnusedLocalUrl = new Function('state', 'audio', 'standbyAudio', 'URL', 'location', `${releaseSource}\nreturn releaseUnusedLocalUrl;`)(
    state, audio, standbyAudio, FakeURL, {href: 'https://tranbienhao1.github.io/thiennguyen/'},
  );
  releaseUnusedLocalUrl(track);
  return {calls, state, track};
}
const releasedLocal = exerciseReleaseLocalUrl({track: {id: 'old', source: 'local', url: 'blob:https://example/old'}});
assert.deepEqual(releasedLocal.calls.revoked, ['blob:https://example/old'], 'A finished local track URL should be revoked when switching tracks');
assert.equal(releasedLocal.state.objectUrls.has('blob:https://example/old'), false, 'A revoked local URL should leave the tracked object URL set');
assert.equal(releasedLocal.track.url, '', 'A released local track should forget its revoked URL');
const currentLocal = exerciseReleaseLocalUrl({track: {id: 'now', source: 'local', url: 'blob:https://example/now'}, currentId: 'now'});
assert.deepEqual(currentLocal.calls.revoked, [], 'The current track local URL must not be revoked when repeating the same track');
assert.equal(currentLocal.track.url, 'blob:https://example/now', 'The current track should keep its local URL');
const liveLocal = exerciseReleaseLocalUrl({track: {id: 'old', source: 'local', url: 'blob:https://example/live'}, audioSrc: 'blob:https://example/live'});
assert.deepEqual(liveLocal.calls.revoked, [], 'A local URL still attached to a deck must not be revoked');
assert.equal(liveLocal.track.url, 'blob:https://example/live', 'A local URL still in use should stay cached on its track');
const cloudNotLocal = exerciseReleaseLocalUrl({track: {id: 'c', source: 'google', url: 'blob:https://example/cloud'}});
assert.deepEqual(cloudNotLocal.calls.revoked, [], 'The local release helper should ignore cloud tracks');
assert.ok(appCode.includes('function releaseUnusedLocalUrl(track) {'), 'Switching tracks should release the previous local file URL');
assert.ok(appCode.includes('track.url = URL.createObjectURL(track.file);'), 'A replayed local track should recreate its blob URL from the kept file');
const localReleaseStart = appCode.indexOf('function releaseUnusedLocalUrl(track) {');
const localReleaseEnd = appCode.indexOf('function clearStalePreload() {', localReleaseStart);
assert.ok(localReleaseStart >= 0 && localReleaseEnd > localReleaseStart, 'releaseUnusedLocalUrl implementation should exist for regression checks');
const localReleaseSource = appCode.slice(localReleaseStart, localReleaseEnd);
assert.ok(localReleaseSource.includes("track.source !== 'local'"), 'Only local file URLs should be released by the local release helper');
assert.ok(localReleaseSource.includes('track.id === state.currentId'), 'The local release helper should keep the URL of the track still playing');
assert.ok(localReleaseSource.includes('element.src === absoluteUrl'), 'The local release helper should not revoke a URL still attached to a deck');
assert.ok(localReleaseSource.includes("track.url = '';"), 'A released local track should forget its revoked URL');
assert.equal(appCode.split('releaseUnusedLocalUrl(previousTrack);').length - 1, 2, 'Both DSD and regular track switches should release the previous local URL');
const dsdSwitchPlayTrackStart = appCode.indexOf('async function playTrack(trackId) {');
const dsdSwitchStopDsdStart = appCode.indexOf('function stopDsdWorker(', dsdSwitchPlayTrackStart);
assert.ok(dsdSwitchPlayTrackStart >= 0 && dsdSwitchStopDsdStart > dsdSwitchPlayTrackStart, 'playTrack implementation should exist for regression checks');
const dsdSwitchPlayTrackSource = appCode.slice(dsdSwitchPlayTrackStart, dsdSwitchStopDsdStart);
const dsdBranchStart = dsdSwitchPlayTrackSource.indexOf('if (track.isDsd) {');
const dsdBranchEnd = dsdSwitchPlayTrackSource.indexOf('setupAudio();', dsdBranchStart);
assert.ok(dsdBranchStart >= 0 && dsdBranchEnd > dsdBranchStart, 'playTrack should keep a dedicated DSD branch');
const dsdBranch = dsdSwitchPlayTrackSource.slice(dsdBranchStart, dsdBranchEnd);
assert.ok(dsdBranch.indexOf('clearStalePreload();') >= 0 && dsdBranch.indexOf('clearStalePreload();') < dsdBranch.indexOf('playDsdTrack(track, generation);'), 'Switching to a DSD track should clear the stale preload before decoding');
assert.ok(dsdBranch.indexOf('releaseUnusedCloudUrl(previousTrack);') > dsdBranch.indexOf('playDsdTrack(track, generation);'), 'Switching to a DSD track should release the previous track cloud URL after the decks are cleared');
const stalePreloadNextStart = appCode.indexOf('async function preloadNext(force = false) {');
const stalePreloadNextEnd = appCode.indexOf('function skipFailedTrack(', stalePreloadNextStart);
assert.ok(stalePreloadNextStart >= 0 && stalePreloadNextEnd > stalePreloadNextStart, 'preloadNext implementation should exist for regression checks');
const stalePreloadNextSource = appCode.slice(stalePreloadNextStart, stalePreloadNextEnd);
assert.ok(stalePreloadNextSource.includes('clearStalePreload();'), 'preloadNext should reuse the stale-preload cleanup when there is no next track');
assert.ok(!stalePreloadNextSource.includes('state.preloadTrackId = null; state.preloadReadyUrl = null; state.preloadBusyId = null; standbyAudio.pause();'), 'preloadNext should not keep a duplicate inline copy of the stale-preload cleanup');
assert.ok(appCode.includes("const seekByStep = delta =>"), 'Bracket/arrow seeking should share one seek helper');
assert.ok(appCode.includes('library.clampSeekTime(audio.currentTime, audio.duration, delta)'), 'Seeking should clamp through the shared library helper');
assert.ok(appCode.includes("toast(`Đã tua tới ${formatTime(next)} / ${formatTime(audio.duration)}.`);"), 'Seeking should toast the new position');
assert.ok(appCode.includes("event.key === '['"), 'The [ key should seek back 10 seconds');
assert.ok(appCode.includes("event.key === ']'"), 'The ] key should seek forward 10 seconds');
assert.ok(appCode.includes("seekByStep(-10);"), 'Backward seeking should step by 10 seconds');
assert.ok(appCode.includes("seekByStep(10);"), 'Forward seeking should step by 10 seconds');
assert.ok(!appCode.includes('audio.currentTime = Math.max(0, audio.currentTime - 10);'), 'Arrow seeking should reuse the shared helper instead of an inline clamp');
assert.match(html, /←\/→ hoặc \[ \] lùi\/tiến 10 giây/, 'The shortcuts hint should list the [ ] keys');
// Pha D — collection cards should skip off-screen rendering like track rows.
const collectionCardRule = html.match(/\.collection-card\{[^}]*\}/);
assert.ok(collectionCardRule, 'The collection card rule should exist');
assert.ok(collectionCardRule[0].includes('content-visibility:auto'), 'Collection cards should use content-visibility:auto for smooth scrolling');
assert.ok(collectionCardRule[0].includes('contain-intrinsic-size:auto 300px'), 'Collection cards should reserve intrinsic size so the scrollbar stays stable');
assert.ok(html.includes('content-visibility:auto;contain-intrinsic-size:auto 64px;'), 'Track rows should keep their content-visibility rule');
// Pha D — hàng đợi dài cũng bỏ qua render ngoài màn hình như hàng bài hát
// và thẻ bộ sưu tập: hàng đợi chứa ảnh bìa + nút di chuyển/xóa nên cuộn
// panel hàng trăm bài sẽ mượt 60fps; hàng đang phát (56px: p-2 + h-10)
// được giữ cùng quy tắc để scrollQueueToCurrent vẫn cuộn chính xác.
assert.ok(html.includes('#queue-list [data-queue-row],#queue-list [data-queue-current-row] { content-visibility:auto;contain-intrinsic-size:auto 56px; }'), 'Queue rows should skip off-screen rendering like track rows');
assert.equal((html.match(/content-visibility:auto;contain-intrinsic-size:auto \d+px;?/g) || []).length, 4, 'Exactly four content-visibility rules should exist: track rows, collection cards, queue rows and lyric lines');
// Pha D — lời .lrc dài hàng trăm dòng trong khung cuộn max-h-72 cũng bỏ
// qua render ngoài màn hình như hàng bài hát: dòng lời 28px (leading-6
// 24px + padding 2px mỗi bên) nên contain-intrinsic-size giữ thanh cuộn
// ổn định; scrollIntoView của dòng đang hát vẫn ép trình duyệt render.
assert.ok(html.includes('.lyric-line { border-radius:8px;padding:2px 8px;transition:color .2s,background-color .2s;content-visibility:auto;contain-intrinsic-size:auto 28px; }'), 'Lyric lines should skip off-screen rendering like track rows');
// Pha A — the footer should show a live Peak/RMS readout from the analyser.
assert.match(html, /id="level-readout"/, 'The footer should include a level readout next to the visualizer');
assert.ok(appCode.includes('analyser.getByteTimeDomainData(timeData)'), 'The visualizer should sample time-domain data for the level meter');
assert.ok(appCode.includes('library.peakRmsFromTimeDomain(timeData)'), 'The level meter should use the shared Peak/RMS helper');
assert.ok(appCode.includes("if (++frame % 30 === 0)"), 'The level readout should update about twice a second, not every animation frame');
// Pha B — mở panel hàng đợi phải cuộn tới bài đang phát (hàng ghim đầu danh sách).
assert.ok(appCode.includes('library.queueDisplayOrder(trackById(state.currentId), tracks)'), 'renderQueue should order the queue with the playing track first');
assert.ok(appCode.includes('data-queue-current-row'), 'The queue list should pin the playing track as its first row');
assert.ok(appCode.includes('function scrollQueueToCurrent()'), 'Opening the queue should scroll to the playing track');
assert.ok(appCode.includes("row.scrollIntoView({block: 'start'})"), 'The queue scroll should bring the playing track to the top of the list');
assert.ok(appCode.includes("typeof row.scrollIntoView === 'function'"), 'The queue scroll should be guarded when scrollIntoView is unavailable');
assert.ok(appCode.includes('renderQueue(); scrollQueueToCurrent();'), 'openQueue should render then scroll to the playing track');
// Pha B — bỏ phần "Nhạc sĩ" khỏi giao diện theo yêu cầu của Melissa:
// nút nav sidebar là link trùng tới trang Nghệ sĩ, thẻ thống kê Home là
// lối vào duy nhất tới trang Composers (số lượng ghi cứng 0). Chú thích log
// nội bộ cuối file được phép nhắc tên mục đã bỏ nên loại khỏi phần kiểm tra.
const uiHtml = html.replace(/<!-- \[AUTO-SCHEDULE LOG\][\s\S]*?-->/g, '');
assert.ok(!uiHtml.includes('Nhạc sĩ'), 'The sidebar and home stats should no longer offer a Nhạc sĩ entry');
assert.ok(!html.includes('data-view="composers"'), 'The home stats should no longer link to the Composers view');
assert.ok(html.includes('.roon-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))'), 'The home stat grid should fit its three remaining cards');
assert.ok(html.includes('Nghệ sĩ'), 'The Artists entry should stay available after removing the duplicate Nhạc sĩ link');
assert.equal((html.match(/data-view="artists"/g) || []).length, 2, 'Exactly one sidebar Artists link and one Artists stat card should remain');
// Pha B — ghi nhớ vị trí cuộn của danh sách bài hát khi chuyển view:
// lưu scrollTop của #content-col theo từng view, khôi phục khi quay lại.
assert.ok(appCode.includes('viewScroll: {}'), 'state should hold a per-view scroll memory');
assert.ok(appCode.includes('function saveViewScroll()'), 'View switching should save the scroll position before leaving a view');
assert.ok(appCode.includes('function restoreViewScroll()'), 'View switching should restore the saved scroll position');
assert.ok(appCode.includes('state.viewScroll[state.activeView] = Math.max(0, col.scrollTop || 0)'), 'Saving scroll should record a non-negative position per view');
assert.ok(appCode.includes('col.scrollTop = Math.max(0, state.viewScroll[state.activeView] || 0)'), 'Restoring scroll should fall back to the top on a first visit');
assert.ok(!appCode.includes("$('content-col').scrollTop = 0;"), 'View switching should no longer force the list back to the top');
// Pha A — crossfade đẳng công suất khi chuyển bài: chạy thật applyCrossfade
// với deck giả (AudioParam giả ghi lại mọi lệnh ramp).
const crossfadeStart = appCode.indexOf('function applyCrossfade(context, oldDeck, newDeck, seconds) {');
assert.ok(crossfadeStart >= 0, 'Equal-power crossfade helper should exist for regression checks');
const crossfadeEnd = appCode.indexOf('function rebuildDeckRoute(deck) {', crossfadeStart);
assert.ok(crossfadeEnd > crossfadeStart, 'Crossfade helper should be extractable for regression checks');
const applyCrossfade = new Function('library', appCode.slice(crossfadeStart, crossfadeEnd) + '\nreturn applyCrossfade;')(require('./library-utils.js'));
function exerciseCrossfade(seconds, startOut = 1) {
  const makeParam = value => ({value, calls: [], setTargetAtTime(target, time, timeConstant) { this.calls.push(['target', target, time, timeConstant]); }, cancelScheduledValues(time) { this.calls.push(['cancel', time]); }, setValueAtTime(value, time) { this.calls.push(['value', value, time]); }, setValueCurveAtTime(curve, time, duration) { this.calls.push(['curve', [...curve], time, duration]); }});
  const oldGain = makeParam(startOut), newGain = makeParam(0);
  const duration = applyCrossfade({currentTime: 10}, {router: {gain: oldGain}}, {router: {gain: newGain}}, seconds);
  return {duration, oldGain, newGain};
}
const faded = exerciseCrossfade(2);
assert.equal(faded.duration, 2, 'A 2-second crossfade should return its duration');
const outCurve = faded.oldGain.calls.find(call => call[0] === 'curve')[1];
const inCurve = faded.newGain.calls.find(call => call[0] === 'curve')[1];
assert.equal(outCurve.length, 33, 'The crossfade curve should sample 33 points');
assert.ok(Math.abs(outCurve[0] - 1) < 1e-6 && Math.abs(outCurve[32]) < 1e-6, 'The old deck curve should run from full gain to silence');
assert.ok(Math.abs(inCurve[0]) < 1e-6 && Math.abs(inCurve[32] - 1) < 1e-6, 'The new deck curve should run from silence to full gain');
assert.ok(Math.abs(outCurve[16] - Math.SQRT1_2) < 1e-6, 'Halfway through the fade the old deck should sit at -3 dB');
assert.ok(outCurve.every((value, index) => Math.abs(value ** 2 + inCurve[index] ** 2 - 1) < 1e-6), 'Old and new curves should keep total power constant');
assert.ok(Math.abs(exerciseCrossfade(2, 0.5).oldGain.calls.find(call => call[0] === 'curve')[1][0] - 0.5) < 1e-6, 'A deck interrupted mid-fade should resume from its current gain, not jump to full');
const instant = exerciseCrossfade(0);
assert.equal(instant.duration, 0, 'A zero-second crossfade should keep the old instant switch');
assert.deepEqual(instant.oldGain.calls, [['target', 0, 10, 0.018]], 'With crossfade off the old deck should ramp out fast');
assert.deepEqual(instant.newGain.calls, [['target', 1, 10, 0.018]], 'With crossfade off the new deck should ramp in fast');
assert.equal(exerciseCrossfade('abc').duration, 0, 'An unreadable crossfade setting should fall back to the instant switch');
assert.ok(appCode.includes('crossfadeSeconds: 0, crossfadeUntil: 0'), 'App state should hold the crossfade setting and fade deadline');
assert.ok(appCode.includes('applyCrossfade(state.context, oldDeck, newDeck, state.crossfadeSeconds)'), 'Track switching should crossfade through the two decks');
assert.ok(appCode.includes('state.crossfadeUntil = fadeSeconds > 0 ? state.context.currentTime + fadeSeconds : 0'), 'Track switching should record when the crossfade ends');
assert.ok(appCode.includes('if (state.crossfadeUntil && state.context.currentTime < state.crossfadeUntil) return;'), 'Preloading should not cut off a crossfade in progress');
assert.ok(appCode.includes('setTimeout(() => { if (generation !== state.playGeneration) return; previous.pause();'), 'The old deck should only stop after its fade finishes');
assert.ok(appCode.includes('fadeSeconds * 1000 + 50'), 'Old-deck cleanup should wait out the full fade');
assert.match(html, /id="crossfade-seconds"/, 'Settings should offer a crossfade duration control');
assert.ok(appCode.includes("localStorage.setItem('nocturne-crossfade-seconds'"), 'The crossfade setting should persist');
assert.ok(appCode.includes("localStorage.getItem('nocturne-crossfade-seconds')"), 'The crossfade setting should be restored on startup');
assert.ok(appCode.includes('if ([0,1,2,3,5].includes(savedCrossfade)) state.crossfadeSeconds = savedCrossfade;'), 'Only crossfade values offered by the settings control should be restored');

// Pha B — phím tắt X bật/tắt crossfade nhanh khi đang nghe.
const toggleStart = appCode.indexOf('function toggleCrossfade() {');
assert.ok(toggleStart >= 0, 'Crossfade toggle helper should exist for regression checks');
const toggleEnd = appCode.indexOf("    $('google-connect').addEventListener('click'", toggleStart);
assert.ok(toggleEnd > toggleStart, 'Crossfade toggle helper should be extractable for regression checks');
function exerciseToggleCrossfade(initialSeconds, initialBeforeOff = 0) {
  const state = {crossfadeSeconds: initialSeconds, crossfadeSecondsBeforeOff: initialBeforeOff};
  const select = {value: String(initialSeconds)};
  const saved = [], toasts = [];
  const toggleCrossfade = new Function('state', '$', 'toast', 'localStorage', appCode.slice(toggleStart, toggleEnd) + '\nreturn toggleCrossfade;')(state, () => select, message => toasts.push(message), {setItem(key, value) { saved.push([key, value]); }});
  return {state, select, saved, toasts, next: toggleCrossfade()};
}
const turnedOff = exerciseToggleCrossfade(3);
assert.equal(turnedOff.next, 0, 'Toggling crossfade on should turn it off');
assert.equal(turnedOff.state.crossfadeSecondsBeforeOff, 3, 'Turning crossfade off should remember the previous duration');
assert.equal(turnedOff.select.value, '0', 'Toggling crossfade should sync the settings control');
assert.deepEqual(turnedOff.saved, [['nocturne-crossfade-seconds', '0']], 'Toggling crossfade should persist the new setting');
assert.deepEqual(turnedOff.toasts, ['Đã tắt crossfade.'], 'Toggling crossfade off should toast');
const turnedOn = exerciseToggleCrossfade(0, 3);
assert.equal(turnedOn.next, 3, 'Toggling crossfade off should restore the remembered duration');
assert.deepEqual(turnedOn.toasts, ['Đã bật crossfade 3 giây.'], 'Toggling crossfade on should toast the restored duration');
assert.equal(exerciseToggleCrossfade(0).next, 2, 'Toggling crossfade with no remembered duration should default to 2 seconds');
assert.ok(appCode.includes("else if (event.key.toLowerCase() === 'x') toggleCrossfade();"), 'The X key should toggle crossfade');
assert.ok(appCode.includes('crossfadeSecondsBeforeOff: 0'), 'App state should remember the crossfade duration before turning it off');

console.log('Inline app syntax, persistence and recent playback/UI regression tests passed.');
