const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

test('1. CSS Responsive Hidden Rule & Modal Overlay Protection', () => {
  // 1.1 Check responsive .hidden:not(...) rule in <style id="app-style">
  assert.ok(
    indexHtml.includes('.hidden:not(.sm\\:block):not(.md\\:block):not(.lg\\:block):not(.sm\\:flex):not(.md\\:flex):not(.lg\\:flex):not(.sm\\:grid):not(.md\\:grid):not(.lg\\:grid)'),
    'Must define scoped .hidden rule excluding Tailwind responsive display utilities'
  );
  assert.ok(
    indexHtml.includes('[hidden]') && indexHtml.includes('display: none !important'),
    'Must keep display: none !important for [hidden]'
  );

  // 1.2 Desktop search bar must remain responsive
  assert.ok(
    indexHtml.includes('class="relative hidden sm:block"') && indexHtml.includes('id="search"'),
    '#search container must use relative hidden sm:block'
  );

  // 1.3 Full-screen overlay modals must have [hidden] attribute to prevent click-blocking
  const overlayIds = [
    'drop-target',
    'metadata-modal',
    'listening-room',
    'queue-panel',
    'zone-modal',
    'signal-path-popover',
    'roon-fullscreen-view'
  ];
  for (const id of overlayIds) {
    const re = new RegExp(`id="${id}"[^>]*\\bhidden\\b`, 'i');
    assert.ok(re.test(indexHtml), `#${id} must have HTML hidden attribute`);
  }
});

test('2. Playback AudioContext Unlocking and Error Handling', () => {
  // 2.1 playTrack must immediately call setupAudio and resume AudioContext in user gesture
  assert.ok(
    indexHtml.includes("if (typeof setupAudio === 'function') setupAudio();\n      if (state.context && state.context.state === 'suspended') {\n        state.context.resume().catch(e => console.debug('AudioContext resume in playTrack:', e));\n      }"),
    'playTrack must synchronously trigger AudioContext.resume() before awaiting track load'
  );

  // 2.2 #album-hero-play must also invoke setupAudio and state.context.resume()
  assert.ok(
    indexHtml.includes("if (typeof setupAudio === 'function') setupAudio();\n            if (state.context && state.context.state === 'suspended') {\n              state.context.resume().catch(e => console.debug('AudioContext resume in album-hero-play:', e));\n            }"),
    '#album-hero-play click must unlock AudioContext synchronously'
  );

  // 2.3 #play-button must catch audio.play() rejection and retry or toast
  assert.ok(
    indexHtml.includes("console.error('Play button audio.play() failed:', error);"),
    '#play-button must handle audio.play() failure without freezing'
  );

  // 2.4 Error notifications via toast and mediaErrorMessage
  assert.ok(
    indexHtml.includes('toast(mediaErrorMessage(error))'),
    'Must show informative toast error instead of leaving player frozen at 0:00'
  );
});

test('3. Google Drive 401 Token Refresh Retry and Shared Drives Support', () => {
  // 3.1 fetchCloudFile Google 401 retry
  assert.ok(
    indexHtml.includes("if (track.source === 'google') {\n          if (!options || !options._refreshedGoogleOnce) {\n            const newToken = await ensureGoogleToken(true);"),
    'fetchCloudFile must refresh Google token on 401 and retry once'
  );

  // 3.2 fetchCloudTrack Google 401 retry
  assert.ok(
    indexHtml.includes("if (track.source === 'google') {\n            if (!options || !options._refreshedGoogleOnce) {\n              const newToken = await ensureGoogleToken(true);"),
    'fetchCloudTrack must refresh Google token on 401 and retry once'
  );

  // 3.3 Google Drive audio & thumbnail URLs must include supportsAllDrives=true
  assert.ok(
    indexHtml.includes("https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true"),
    'loadGoogleAudio must append supportsAllDrives=true to alt=media URL'
  );
  assert.ok(
    indexHtml.includes("https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.remoteId)}?alt=media&supportsAllDrives=true"),
    'cloudTagRequest must append supportsAllDrives=true to alt=media URL'
  );
  assert.ok(
    indexHtml.includes("https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.remoteId)}?fields=thumbnailLink&supportsAllDrives=true"),
    'googleThumbnail must append supportsAllDrives=true to thumbnailLink URL'
  );
});

test('4. Network Bandwidth Prioritization During Track Loading', () => {
  // 4.1 state must have isPlaybackLoading
  assert.ok(
    indexHtml.includes('isPlaybackLoading: false'),
    'state must include isPlaybackLoading property'
  );

  // 4.2 setPlaybackLoading helper must exist with 8s safety timeout
  assert.ok(
    indexHtml.includes('function setPlaybackLoading(loading)'),
    'Must define setPlaybackLoading helper function'
  );
  assert.ok(
    indexHtml.includes('8000'),
    'setPlaybackLoading must provide safety timeout'
  );

  // 4.3 runCloudMetadataQueue must pause when isPlaybackLoading is true
  assert.ok(
    indexHtml.includes('if (state.isPlaybackLoading) return;') &&
    indexHtml.includes('if (state.isPlaybackLoading) break;'),
    'runCloudMetadataQueue must yield while audio is loading'
  );

  // 4.4 playTrack must set isPlaybackLoading to true and release on start / error
  assert.ok(
    indexHtml.includes('setPlaybackLoading(true);'),
    'playTrack must set playback loading to true'
  );
  assert.ok(
    indexHtml.includes('setPlaybackLoading(false);'),
    'playTrack must release playback loading flag'
  );
});
