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
const updateCheckBody = appCode.slice(appCode.indexOf('async function checkForAppUpdate'));
assert.ok(!updateCheckBody.slice(0, updateCheckBody.indexOf('function applyAppUpdate')).includes('location.reload()'), 'Background version checks must never reload automatically');
console.log('Inline app script syntax and cloud persistence/sync wiring tests passed.');
