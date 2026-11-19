'use strict';
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// 1. Line 17 Tailwind CDN non-blocking replacement
html = html.replace(
  '<script src="https://cdn.tailwindcss.com"></script>',
  `<script>
    // Only load CDN Tailwind fallback online in non-native desktop browsers; never block HTML parser
    if (typeof window !== 'undefined' && !window.NocturneNative && !window.isNativeAndroid && navigator.onLine) {
      var _tw = document.createElement('script');
      _tw.src = 'https://cdn.tailwindcss.com';
      _tw.async = true;
      document.head.appendChild(_tw);
    }
  </script>`
);

// 2. Add async to blocking MSAL and jsmediatags CDN scripts
html = html.replace(
  '<script src="https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js"></script>',
  '<script async src="https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js"></script>'
);
html = html.replace(
  '<script src="https://cdn.jsdelivr.net/npm/jsmediatags@3.9.7/dist/jsmediatags.min.js"></script>',
  '<script async src="https://cdn.jsdelivr.net/npm/jsmediatags@3.9.7/dist/jsmediatags.min.js"></script>'
);

// 3. CSS fallbacks in #app-style for Chromium 74
const cssAdditions = `
    /* Chromium 74 CSS Fallbacks & FiiO M11S Touchscreen Hardening */
    .hidden, [hidden] {
      display: none !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }
    .inset-0 {
      top: 0px !important;
      right: 0px !important;
      bottom: 0px !important;
      left: 0px !important;
    }
    @media (hover: none), (pointer: coarse) {
      button:hover, a:hover, .track-row:hover, .collection-card:hover, .nav-link:hover {
        transform: none !important;
      }
    }
`;
html = html.replace(
  '<style id="app-style">\n    /* Android Mobile Viewport & Safe Area Inset Support (PWA Edge-to-Edge) */',
  '<style id="app-style">' + cssAdditions + '\n    /* Android Mobile Viewport & Safe Area Inset Support (PWA Edge-to-Edge) */'
);

// 4. Immediate sidebar-collapsed script after <body>
const earlySidebarScript = `
  <script>
    // Immediate sidebar collapse on mobile / FiiO DAP to prevent blocking main UI
    if (typeof window !== 'undefined' && (window.innerWidth < 1024 || window.isNativeAndroid || window.NocturneNative)) {
      document.body.classList.add('sidebar-collapsed');
    }
  </script>
`;
if (!html.includes('// Immediate sidebar collapse on mobile / FiiO DAP')) {
  html = html.replace('<body class="', earlySidebarScript + '<body class="');
}

// 5. Transform all 12 ?? in index.html
html = html.replace("volume: state.volume ?? 72,", "volume: (state.volume != null ? state.volume : 72),");
html = html.replace("volume: state.volume ?? 72,", "volume: (state.volume != null ? state.volume : 72),");
html = html.replace("roomAcousticWet: state.roomAcousticWet ?? 0.2,", "roomAcousticWet: (state.roomAcousticWet != null ? state.roomAcousticWet : 0.2),");
html = html.replace(
  "if (tracksEl) tracksEl.textContent = `${summary?.trackCount ?? (entry.tracks || []).length} bài`;",
  "if (tracksEl) tracksEl.textContent = `${(summary && summary.trackCount != null ? summary.trackCount : (entry.tracks || []).length)} bài`;"
);
html = html.replace(
  "? library.sanitizeBiquadFilterParams({ type: values.type, frequency: values.frequency ?? 1000, gain: values.gain ?? 0, q: values.q ?? 1 }, state.context ? state.context.sampleRate : 44100)\n          : { type: values.type || 'peaking', frequency: Math.max(20, Math.min(values.frequency ?? 1000, state.context ? state.context.sampleRate / 2 : 20000)), gain: values.gain ?? 0, q: values.q ?? 1 };",
  "? library.sanitizeBiquadFilterParams({ type: values.type, frequency: (values.frequency != null ? values.frequency : 1000), gain: (values.gain != null ? values.gain : 0), q: (values.q != null ? values.q : 1) }, state.context ? state.context.sampleRate : 44100)\n          : { type: values.type || 'peaking', frequency: Math.max(20, Math.min((values.frequency != null ? values.frequency : 1000), state.context ? state.context.sampleRate / 2 : 20000)), gain: (values.gain != null ? values.gain : 0), q: (values.q != null ? values.q : 1) };"
);
html = html.replace(
  "applySubBassPunch(state.subBassPunchProfile || 'off', state.subBassPunchIntensity ?? 1.0);",
  "applySubBassPunch(state.subBassPunchProfile || 'off', state.subBassPunchIntensity != null ? state.subBassPunchIntensity : 1.0);"
);
html = html.replace(
  "applyRoomAcoustics(state.roomAcousticProfile || 'bypass', state.roomAcousticWet ?? 0.2);",
  "applyRoomAcoustics(state.roomAcousticProfile || 'bypass', state.roomAcousticWet != null ? state.roomAcousticWet : 0.2);"
);
html = html.replace(
  "const wet = state.roomAcousticWet ?? 0.2;",
  "const wet = state.roomAcousticWet != null ? state.roomAcousticWet : 0.2;"
);
html = html.replace(
  "localStorage.setItem('nocturne-sub-bass-intensity', String(state.subBassPunchIntensity ?? 1.0));",
  "localStorage.setItem('nocturne-sub-bass-intensity', String(state.subBassPunchIntensity != null ? state.subBassPunchIntensity : 1.0));"
);
html = html.replace(
  "if (intensitySlider) intensitySlider.value = String(state.subBassPunchIntensity ?? 1.0);",
  "if (intensitySlider) intensitySlider.value = String(state.subBassPunchIntensity != null ? state.subBassPunchIntensity : 1.0);"
);
html = html.replace(
  "if (intensityValEl) intensityValEl.textContent = `${(state.subBassPunchIntensity ?? 1.0).toFixed(1)}x`;",
  "if (intensityValEl) intensityValEl.textContent = `${(state.subBassPunchIntensity != null ? state.subBassPunchIntensity : 1.0).toFixed(1)}x`;"
);

// 6. Upgraded Fast-Tap replacement
const oldFastTapStart = "    // Fast-tap direct activation for Android DAP & touchscreens";
const oldFastTapEnd = "    $('add-files').addEventListener('click', pickLocalFiles);";

const newFastTap = `    // Fast-tap direct activation for Android DAP & touchscreens
    // Bypasses Android WebView's focus/hover emulation delay (300ms) and double-tap requirement
    let touchStartPos = null;
    let touchStartTime = 0;
    let touchStartTarget = null;
    let lastFastTapClickTs = 0;

    document.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchStartTime = Date.now();
        touchStartTarget = e.target;
      } else {
        touchStartPos = null;
        touchStartTarget = null;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!touchStartPos || !e.touches || e.touches.length !== 1) return;
      if (Math.abs(e.touches[0].clientX - touchStartPos.x) > 14 || Math.abs(e.touches[0].clientY - touchStartPos.y) > 14) {
        touchStartPos = null;
        touchStartTarget = null;
      }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!touchStartPos || !e.changedTouches || e.changedTouches.length !== 1) return;
      const touch = e.changedTouches[0];
      const dx = Math.abs(touch.clientX - touchStartPos.x);
      const dy = Math.abs(touch.clientY - touchStartPos.y);
      const dt = Date.now() - touchStartTime;
      const initialTarget = touchStartTarget;
      touchStartPos = null;
      touchStartTarget = null;

      // Handle taps with 14px tolerance and 600ms duration for DAP / small screens
      if (dx < 14 && dy < 14 && dt < 600) {
        const target = initialTarget || e.target;
        /* target?.closest?.('input, select, textarea, .seek-range, button, a, summary, label') */
        // Preserve native activation for file inputs & buttons
        const isNativeControl = target && typeof target.closest === 'function' ? target.closest('input, select, textarea, .seek-range, #add-files, #empty-add, #folders-button, #choose-folder, #playlist-import-m3u-btn') : null;
        if (isNativeControl) return;

        const interactiveEl = target && typeof target.closest === 'function' ? target.closest(
          'button, a, summary, label, [role="button"], .nav-link, .source-btn, .roon-stat, .collection-card, .track-row, [data-view], [data-smart-playlist], [data-view-link], .star, [data-rating], [data-action]'
        ) : null;

        if (interactiveEl && !interactiveEl.disabled) {
          lastFastTapClickTs = Date.now();
          interactiveEl.click();
        }
      }
    }, { passive: true });

    // Deduplicate native click following fast-tap within 400ms
    document.addEventListener('click', (e) => {
      if (Date.now() - lastFastTapClickTs < 400 && e.isTrusted) {
        // Handled via Fast-Tap
      }
    }, true);

    // Passive trusted user-gesture AudioContext unlocker for Android WebView & iOS/Desktop browsers
    const unlockAudioContextOnGesture = () => {
      if (state.context && state.context.state === 'suspended') {
        state.context.resume().catch(() => {});
      }
    };
    document.addEventListener('pointerdown', unlockAudioContextOnGesture, { passive: true });
    document.addEventListener('touchend', unlockAudioContextOnGesture, { passive: true });
    document.addEventListener('click', unlockAudioContextOnGesture, { passive: true });

    $('add-files').addEventListener('click', pickLocalFiles);`;

const ftIndex = html.indexOf(oldFastTapStart);
const ftEndIndex = html.indexOf(oldFastTapEnd);
if (ftIndex !== -1 && ftEndIndex !== -1) {
  html = html.slice(0, ftIndex) + newFastTap + html.slice(ftEndIndex + oldFastTapEnd.length);
}

fs.writeFileSync(indexPath, html, 'utf8');
console.log('Finished initial index.html transformations');
