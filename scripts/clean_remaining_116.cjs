'use strict';
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
let code = fs.readFileSync(indexPath, 'utf8');

// Add helper getters: safeVal, safeChecked, safeText, safeHtml
const extraHelpers = `    const safeVal = el => (el && el.value != null ? el.value : '');
    const safeChecked = el => Boolean(el && el.checked);
    const safeText = el => (el && el.textContent != null ? el.textContent : '');
    const safeHtml = el => (el && el.innerHTML != null ? el.innerHTML : '');`;

code = code.replace(
  'const safeAttr = (el, attr, val) => {\n      if (el && typeof el.setAttribute === \'function\') el.setAttribute(attr, val);\n    };',
  'const safeAttr = (el, attr, val) => {\n      if (el && typeof el.setAttribute === \'function\') el.setAttribute(attr, val);\n    };\n' + extraHelpers
);

// 1. Google auth
code = code.replace(/window\.google\?\.accounts\?\.oauth2/g, '(window.google && window.google.accounts && window.google.accounts.oauth2)');
code = code.replace(/google\?\.accounts\?\.oauth2/g, '(window.google && window.google.accounts && window.google.accounts.oauth2)');
code = code.replace(/google\?\.accounts/g, '(window.google && window.google.accounts)');

// 2. NocturneNative
code = code.replace(
  /if \(typeof window !== 'undefined' && window\.NocturneNative\?\.stopBitPerfectPlayback\) \{/g,
  "/* window.NocturneNative?.stopBitPerfectPlayback */ if (typeof window !== 'undefined' && window.NocturneNative && window.NocturneNative.stopBitPerfectPlayback) {"
);
code = code.replace(
  /if \(typeof window !== 'undefined'\) window\.NocturneNative\?\.updateMediaNotification\(([^;]+)\);/g,
  "/* window.NocturneNative?.updateMediaNotification */ if (typeof window !== 'undefined' && window.NocturneNative && window.NocturneNative.updateMediaNotification) window.NocturneNative.updateMediaNotification($1);"
);
code = code.replace(
  /window\.NocturneNative\?\.seekBitPerfectPlayback/g,
  "/* window.NocturneNative?.seekBitPerfectPlayback */ (window.NocturneNative && window.NocturneNative.seekBitPerfectPlayback)"
);
code = code.replace(
  /window\.NocturneNative\?\.resumeBitPerfectPlayback/g,
  "/* window.NocturneNative?.resumeBitPerfectPlayback */ (window.NocturneNative && window.NocturneNative.resumeBitPerfectPlayback)"
);
code = code.replace(
  /window\.NocturneNative\?\.pauseBitPerfectPlayback/g,
  "/* window.NocturneNative?.pauseBitPerfectPlayback */ (window.NocturneNative && window.NocturneNative.pauseBitPerfectPlayback)"
);

// 3. state.context?.sampleRate
code = code.replace(/state\.context\?\.sampleRate/g, '(state.context ? state.context.sampleRate : 48000)');

// 4. row?.dataset?.trackId
code = code.replace(/row\?\.dataset\?\.trackId/g, '(row && row.dataset ? row.dataset.trackId : undefined)');

// 5. ambient
code = code.replace(/state\.ambientBuffers\?\.rain/g, '(state.ambientBuffers && state.ambientBuffers.rain)');
code = code.replace(/state\.ambientBuffers\?\.campfireBase/g, '(state.ambientBuffers && state.ambientBuffers.campfireBase)');
code = code.replace(/state\.ambientBuffers\?\.campfireCrackle/g, '(state.ambientBuffers && state.ambientBuffers.campfireCrackle)');
code = code.replace(/state\.ambientNodes\?\.rain\?\.lfoGain/g, '(state.ambientNodes && state.ambientNodes.rain && state.ambientNodes.rain.lfoGain)');
code = code.replace(/state\.ambientNodes\?\.rain/g, '(state.ambientNodes && state.ambientNodes.rain)');
code = code.replace(/state\.ambientNodes\?\.campfire/g, '(state.ambientNodes && state.ambientNodes.campfire)');

// 6. $('...')?.value / checked / textContent / innerHTML
code = code.replace(/\$\('([^']+)'\)\?\.value/g, "safeVal($$('$1'))");
code = code.replace(/\$\('([^']+)'\)\?\.checked/g, "safeChecked($$('$1'))");
code = code.replace(/\$\('([^']+)'\)\?\.textContent/g, "safeText($$('$1'))");
code = code.replace(/\$\('([^']+)'\)\?\.innerHTML/g, "safeHtml($$('$1'))");
code = code.replace(/\$\(provider === 'microsoft' \? 'microsoft-client-id' : 'google-client-id'\)\?\.value/g, "safeVal($(provider === 'microsoft' ? 'microsoft-client-id' : 'google-client-id'))");

// 7. curTrack?.
code = code.replace(/curTrack\?\.duration/g, '(curTrack ? curTrack.duration : 0)');
code = code.replace(/curTrack\?\.title/g, '(curTrack ? curTrack.title : "")');
code = code.replace(/curTrack\?\.name/g, '(curTrack ? curTrack.name : "")');
code = code.replace(/curTrack\?\.artist/g, '(curTrack ? curTrack.artist : "")');
code = code.replace(/curTrack\?\.album/g, '(curTrack ? curTrack.album : "")');

// 8. siblingTrack?.
code = code.replace(/siblingTrack\?\.url/g, '(siblingTrack ? siblingTrack.url : "")');
code = code.replace(/siblingTrack\?\.artist/g, '(siblingTrack ? siblingTrack.artist : "")');
code = code.replace(/siblingTrack\?\.album/g, '(siblingTrack ? siblingTrack.album : "")');
code = code.replace(/siblingTrack\?\.albumArtist/g, '(siblingTrack ? siblingTrack.albumArtist : "")');
code = code.replace(/siblingTrack\?\.format/g, '(siblingTrack ? siblingTrack.format : "")');
code = code.replace(/siblingTrack\?\.isDsd/g, '(siblingTrack ? siblingTrack.isDsd : false)');
code = code.replace(/siblingTrack\?\.sampleRate/g, '(siblingTrack ? siblingTrack.sampleRate : 44100)');
code = code.replace(/siblingTrack\?\.bitDepth/g, '(siblingTrack ? siblingTrack.bitDepth : 16)');
code = code.replace(/siblingTrack\?\.channels/g, '(siblingTrack ? siblingTrack.channels : 2)');
code = code.replace(/siblingTrack\?\.cover/g, '(siblingTrack ? siblingTrack.cover : "")');

// 9. error / errorInput / result
code = code.replace(/error\?\.message/g, '(error ? error.message : "")');
code = code.replace(/error\?\.type/g, '(error ? error.type : "")');
code = code.replace(/errorInput\?\.message/g, '(errorInput ? errorInput.message : "")');
code = code.replace(/errorInput\?\.error_description/g, '(errorInput ? errorInput.error_description : "")');
code = code.replace(/errorInput\?\.error/g, '(errorInput ? errorInput.error : "")');
code = code.replace(/result\?\.error_description/g, '(result ? result.error_description : "")');
code = code.replace(/result\?\.error/g, '(result ? result.error : "")');

// 10. clipboard / files / UIOverlay / fullScreen
code = code.replace(/navigator\.clipboard\?\.readText/g, '(navigator.clipboard && typeof navigator.clipboard.readText === "function")');
code = code.replace(/e\.target\.files\?\.\[0\]/g, '(e.target.files && e.target.files[0])');
code = code.replace(/window\.UIOverlay\?\.toggleCommandPalette\(\)/g, '(window.UIOverlay && typeof window.UIOverlay.toggleCommandPalette === "function" && window.UIOverlay.toggleCommandPalette())');
code = code.replace(/window\.UIOverlay\?\.openCommandPalette\(\)/g, '(window.UIOverlay && typeof window.UIOverlay.openCommandPalette === "function" && window.UIOverlay.openCommandPalette())');
code = code.replace(/window\.UIOverlay\?\.closeCommandPalette\(\)/g, '(window.UIOverlay && typeof window.UIOverlay.closeCommandPalette === "function" && window.UIOverlay.closeCommandPalette())');

// 11. activeElement / parentElement
code = code.replace(/document\.activeElement\?\.tagName/g, '(document.activeElement ? document.activeElement.tagName : "")');
code = code.replace(/document\.activeElement\?\.isContentEditable/g, '(document.activeElement ? document.activeElement.isContentEditable : false)');
code = code.replace(/e\.target\?\.parentElement/g, '(e.target ? e.target.parentElement : null)');
code = code.replace(/target\?\.parentElement/g, '(target ? target.parentElement : null)');

// 12. Miscellaneous
code = code.replace("if (session.paused) curAudio?.pause();", "if (session.paused && curAudio) curAudio.pause();");
code = code.replace("const currentTrack = Array.isArray(state?.tracks) ? state.tracks.find(t => t.id === state.currentId) : null;", "const currentTrack = Array.isArray(state && state.tracks) ? state.tracks.find(t => t.id === state.currentId) : null;");
code = code.replace("const coverSrc = track?.cover;", "const coverSrc = track ? track.cover : '';");
code = code.replace("const trackId = track?.id || '';", "const trackId = (track && track.id) || '';");
code = code.replace("if (durationEl) durationEl.textContent = summary?.formattedDuration || '—';", "if (durationEl) durationEl.textContent = (summary && summary.formattedDuration) || '—';");
code = code.replace("cover: albumTracks.find(t => t.cover)?.cover || '',", "cover: ((function () { const c = albumTracks.find(t => t.cover); return c ? c.cover : ''; })()),");
code = code.replace("cover: artistTracks.find(t => t.cover)?.cover || '',", "cover: ((function () { const c = artistTracks.find(t => t.cover); return c ? c.cover : ''; })()),");
code = code.replace("const selectedFadeMs = Number(fadeSelect?.value) || 30000;", "const selectedFadeMs = Number(fadeSelect ? fadeSelect.value : '') || 30000;");
code = code.replace("const ambientSceneEnabled = customOptions.ambientScene !== undefined ? customOptions.ambientScene : Boolean(ambientCheckbox?.checked);", "const ambientSceneEnabled = customOptions.ambientScene !== undefined ? customOptions.ambientScene : Boolean(ambientCheckbox ? ambientCheckbox.checked : false);");
code = code.replace("env?.isNativeAndroid", "(env && env.isNativeAndroid)");
code = code.replace("inputEl?.closest", "(inputEl && typeof inputEl.closest === 'function')");
code = code.replace("networkProfile?.tier", "(networkProfile ? networkProfile.tier : '')");
code = code.replace("cover: song.album_image_urls?.large || song.album_image_urls?.medium || song.album_image_urls?.small || '',", "cover: (song.album_image_urls ? (song.album_image_urls.large || song.album_image_urls.medium || song.album_image_urls.small) : '') || '',");
code = code.replace(/!\$\('ambient-button'\)\?\.contains\(event\.target\)/g, "!($('ambient-button') && $('ambient-button').contains(event.target))");
code = code.replace(/!\$\('ambient-button-mobile'\)\?\.contains\(event\.target\)/g, "!($('ambient-button-mobile') && $('ambient-button-mobile').contains(event.target))");
code = code.replace(/doc\.querySelector\('#app-style'\)\?\.textContent/g, "(doc.querySelector('#app-style') ? doc.querySelector('#app-style').textContent : '')");

fs.writeFileSync(indexPath, code, 'utf8');
console.log('Finished pass 2 index.html cleanup');
