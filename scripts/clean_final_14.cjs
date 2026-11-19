'use strict';
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
let code = fs.readFileSync(indexPath, 'utf8');

code = code.replace(
  "try { window.NocturneNative?.stopBitPerfectPlayback?.(); } catch (_) {}",
  "try { if (window.NocturneNative && typeof window.NocturneNative.stopBitPerfectPlayback === 'function') window.NocturneNative.stopBitPerfectPlayback(); } catch (_) {}"
);
code = code.replace(
  "try { window.NocturneNative?.stopBitPerfectPlayback?.(); } catch (_) {}",
  "try { if (window.NocturneNative && typeof window.NocturneNative.stopBitPerfectPlayback === 'function') window.NocturneNative.stopBitPerfectPlayback(); } catch (_) {}"
);

code = code.replace(
  "if (window.NocturneNative?.openAuthInBrowser) {",
  "/* window.NocturneNative?.openAuthInBrowser */ if (window.NocturneNative && window.NocturneNative.openAuthInBrowser) {"
);

code = code.replace(
  "const customId = safeVal($(provider === 'microsoft' ? 'microsoft-client-id' : 'google-client-id'))?.trim();",
  "const customId = safeVal($(provider === 'microsoft' ? 'microsoft-client-id' : 'google-client-id')).trim();"
);

code = code.replace(
  "const inputVal = safeVal($('google-client-id'))?.trim();",
  "const inputVal = safeVal($('google-client-id')).trim();"
);

code = code.replace(
  "else if (window.UIOverlay?.toggleCommandPalette) window.UIOverlay.toggleCommandPalette();",
  "else if (window.UIOverlay && typeof window.UIOverlay.toggleCommandPalette === 'function') window.UIOverlay.toggleCommandPalette();"
);
code = code.replace(
  "else if (window.UIOverlay?.openCommandPalette) window.UIOverlay.openCommandPalette();",
  "else if (window.UIOverlay && typeof window.UIOverlay.openCommandPalette === 'function') window.UIOverlay.openCommandPalette();"
);
code = code.replace(
  "else if (window.UIOverlay?.closeCommandPalette) window.UIOverlay.closeCommandPalette();",
  "else if (window.UIOverlay && typeof window.UIOverlay.closeCommandPalette === 'function') window.UIOverlay.closeCommandPalette();"
);
code = code.replace(
  "else if (window.UIOverlay?.closeCommandPalette) window.UIOverlay.closeCommandPalette();",
  "else if (window.UIOverlay && typeof window.UIOverlay.closeCommandPalette === 'function') window.UIOverlay.closeCommandPalette();"
);

code = code.replace(
  "if (!sleepP.contains(targetEl) && !targetEl.closest?.('#sleep-button') && !targetEl.closest?.('#sleep-button-mobile')) {",
  "if (!sleepP.contains(targetEl) && !(targetEl && typeof targetEl.closest === 'function' && targetEl.closest('#sleep-button')) && !(targetEl && typeof targetEl.closest === 'function' && targetEl.closest('#sleep-button-mobile'))) {"
);

code = code.replace(
  "if (!eqP.contains(targetEl) && !targetEl.closest?.('#eq-button') && !targetEl.closest?.('#header-eq-btn') && !targetEl.closest?.('#room-eq-button') && !targetEl.closest?.('#fs-room-eq-btn')) {",
  "const isEqBtn = Boolean(targetEl && typeof targetEl.closest === 'function' && (targetEl.closest('#eq-button') || targetEl.closest('#header-eq-btn') || targetEl.closest('#room-eq-button') || targetEl.closest('#fs-room-eq-btn')));\n        if (!eqP.contains(targetEl) && !isEqBtn) {"
);

code = code.replace(
  "if (!ambP.contains(targetEl) && !targetEl.closest?.('#ambient-button') && !targetEl.closest?.('#ambient-button-mobile')) {",
  "if (!ambP.contains(targetEl) && !(targetEl && typeof targetEl.closest === 'function' && targetEl.closest('#ambient-button')) && !(targetEl && typeof targetEl.closest === 'function' && targetEl.closest('#ambient-button-mobile'))) {"
);

code = code.replace(
  "document.exitFullscreen?.();",
  "if (typeof document.exitFullscreen === 'function') document.exitFullscreen();"
);
code = code.replace(
  "document.documentElement.requestFullscreen?.();",
  "if (typeof document.documentElement.requestFullscreen === 'function') document.documentElement.requestFullscreen();"
);

fs.writeFileSync(indexPath, code, 'utf8');
console.log('Finished final 14 cleanup');
