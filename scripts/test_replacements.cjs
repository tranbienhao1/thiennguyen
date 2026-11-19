'use strict';
const samples = [
  "if (typeof library?.savePlaybackSession === 'function')",
  "if (!raw || typeof library?.restorePlaybackSession !== 'function') return;",
  "const dur = curTrack?.duration || audio.duration || 0;",
  "const trackId = row?.dataset?.trackId;",
  "$('offline-banner')?.addEventListener('click', () => {",
  "$('album-hero')?.classList.add('hidden');",
  "if (typeof window !== 'undefined' && window.NocturneNative?.stopBitPerfectPlayback) {"
];

for (const s of samples) {
  let res = s;
  res = res.replace(/typeof library\?\.([a-zA-Z0-9_]+)/g, 'typeof (library && library.$1)');
  res = res.replace(/typeof lib\?\.([a-zA-Z0-9_]+)/g, 'typeof (lib && lib.$1)');
  res = res.replace(/row\?\.dataset\?\.trackId/g, '(row && row.dataset ? row.dataset.trackId : undefined)');
  res = res.replace(/curTrack\?\.duration/g, '(curTrack ? curTrack.duration : undefined)');
  res = res.replace(/window\.NocturneNative\?\.([a-zA-Z0-9_]+)/g, '(window.NocturneNative && window.NocturneNative.$1)');
  console.log('BEFORE:', s);
  console.log('AFTER : ', res);
}
