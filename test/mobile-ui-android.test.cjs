'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const indexHtmlPath = path.join(rootDir, 'index.html');

test('Mobile UI & Android DAP Optimization Verification Suite', async (t) => {
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  await t.test('1. Viewport & Safe-Area Inset Ergonomics', () => {
    // Viewport meta
    assert.match(
      indexHtml,
      /<meta[^>]+name=["']viewport["'][^>]+viewport-fit\s*=\s*cover/i,
      'Viewport must include viewport-fit=cover for edge-to-edge Android display'
    );
    assert.match(
      indexHtml,
      /<meta[^>]+name=["']viewport["'][^>]+width\s*=\s*device-width/i,
      'Viewport must include width=device-width'
    );

    // Safe-area CSS custom properties supporting Android native bridge & Web standards
    assert.ok(
      indexHtml.includes('--safe-inset-top') && indexHtml.includes('--safe-inset-bottom'),
      'Root must define --safe-inset-top and --safe-inset-bottom for Android bridge injection'
    );
    assert.ok(
      indexHtml.includes('--safe-area-top') && indexHtml.includes('--safe-area-bottom'),
      'Root must define --safe-area-top and --safe-area-bottom fallbacks'
    );

    // Safe area docking on footer player and header
    assert.ok(
      indexHtml.includes('var(--safe-area-bottom') || indexHtml.includes('env(safe-area-inset-bottom'),
      'Footer player must dock with safe-area-bottom padding'
    );
    assert.ok(
      indexHtml.includes('var(--safe-area-top') || indexHtml.includes('env(safe-area-inset-top'),
      'Header must include safe-area-top padding'
    );
  });

  await t.test('2. Touch Ergonomics & Minimum 44-48px Touch Targets', () => {
    // Header controls touch target styles
    assert.ok(
      /#sidebar-toggle\s*\{[^}]*min-width:\s*44px/i.test(indexHtml) ||
      /#sidebar-toggle\s*\{[^}]*width:\s*44px/i.test(indexHtml),
      'Sidebar toggle must have at least 44px touch target on mobile'
    );
    assert.ok(
      /#back-button\s*\{[^}]*min-width:\s*44px/i.test(indexHtml) ||
      /#back-button\s*\{[^}]*width:\s*44px/i.test(indexHtml),
      'Back button must have at least 44px touch target on mobile'
    );
    assert.ok(
      /#header-favorites[^{]*\{[^}]*min-width:\s*4[0-4]px/i.test(indexHtml),
      'Header favorites button must have 40-44px touch target on mobile'
    );

    // Sidebar navigation touch targets
    assert.ok(
      /#sidebar\s+\.nav-link\s*\{[^}]*min-height:\s*48px/i.test(indexHtml),
      'Sidebar navigation links must have 48px touch target for thumb ergonomics'
    );

    // Playback control touch targets in footer
    assert.ok(
      /#play-button\s*\{[^}]*min-width:\s*44px/i.test(indexHtml) ||
      /#play-button\s*\{[^}]*width:\s*44px/i.test(indexHtml),
      'Play/Pause button must have at least 44px touch target on mobile'
    );
    assert.ok(
      /#previous-button[^{]*\{[^}]*min-width:\s*44px/i.test(indexHtml),
      'Previous button must have at least 44px touch target on mobile'
    );
    assert.ok(
      /#next-button[^{]*\{[^}]*min-width:\s*44px/i.test(indexHtml),
      'Next button must have at least 44px touch target on mobile'
    );

    // Room controls touch targets
    assert.ok(
      /#room-play\s*\{[^}]*min-width:\s*(?:5[0-9]|60)px/i.test(indexHtml) ||
      /#room-play\s*\{[^}]*width:\s*(?:5[0-9]|60)px/i.test(indexHtml),
      'Room play button must have 56-60px touch target'
    );
    assert.ok(
      /#room-previous[^{]*\{[^}]*min-width:\s*48px/i.test(indexHtml),
      'Room previous/next buttons must have at least 48px touch target'
    );
  });

  await t.test('3. Narrow Viewport Overflow Prevention (360px-412px)', () => {
    // Horizontal overflow protection
    assert.ok(
      indexHtml.includes('overflow-x: hidden !important') || indexHtml.includes('overflow-x:hidden!important'),
      'Body and shell must prevent horizontal overflow on narrow screens'
    );

    // Footer center controls flex override so it does not force 300px min-width on mobile
    assert.ok(
      /footer\.glass\s+\.footer-center-controls\s*\{[^}]*min-width:\s*0\s*!important/i.test(indexHtml) ||
      /\.footer-center-controls\s*\{[^}]*min-width:\s*0\s*!important/i.test(indexHtml),
      'Footer center controls must remove min-width 300px constraint on mobile screens'
    );

    // Footer left col flex override
    assert.ok(
      /\.footer-left-col\s*\{[^}]*width:\s*auto\s*!important/i.test(indexHtml) ||
      /\.footer-left-col\s*\{[^}]*flex:\s*1/i.test(indexHtml),
      'Footer left col must flex to fit available width on mobile'
    );
  });

  await t.test('4. Mobile Docked Footer Player & Scrubber', () => {
    // Docked styling
    assert.ok(
      /footer\.glass\s*\{[^}]*position:\s*fixed/i.test(indexHtml),
      'Footer player must be fixed docked at bottom on mobile'
    );

    // High contrast typography
    assert.ok(
      /#now-title\s*\{[^}]*color:\s*#ffffff/i.test(indexHtml),
      'Now playing title must have high-contrast white typography on mobile'
    );

    // Touch scrubbing seek bar
    assert.ok(
      /#seek-mobile::-webkit-slider-thumb\s*\{[^}]*width:\s*(?:1[6-9]|20)px/i.test(indexHtml),
      'Mobile seek scrubber must feature an enlarged 16-20px thumb for touch precision'
    );
  });

  await t.test('5. Fullscreen Room / Now Playing Modal Scaling & DSP Access', () => {
    // Cover art scales nicely: max 280-320px
    assert.ok(
      /#room-cover-wrap\s*\{[^}]*max-width:\s*min\([^)]*300px\)/i.test(indexHtml) ||
      /#room-cover-wrap\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/i.test(indexHtml),
      'Room cover art must scale square with max width ~300px'
    );

    // Lyrics thumb scrollable
    assert.ok(
      /#room-lyrics\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/i.test(indexHtml) ||
      /#room-lyrics\s*\{[^}]*touch-action:\s*pan-y/i.test(indexHtml),
      'Room lyrics must be smoothly thumb-scrollable with touch-action pan-y'
    );

    // DSP/EQ buttons accessible
    assert.ok(
      indexHtml.includes('id="room-eq-button"'),
      'Room Now Playing screen must feature a dedicated EQ / DSP button'
    );
    assert.ok(
      indexHtml.includes('id="eq-close-btn"'),
      'EQ panel must have a dedicated close button for mobile touch dismissal'
    );
  });

  await t.test('6. Track Rows & Library on Mobile', () => {
    // Track row min-height 58px (56-60px range)
    assert.ok(
      /#track-list\s+\.track-row\s*\{[^}]*min-height:\s*58px/i.test(indexHtml),
      'Mobile track rows must have 58px minimum touch height'
    );

    // Ellipsis truncation for title and artist
    assert.ok(
      /#track-list\s+\.track-row\s+\.track-title\s*\{[^}]*text-overflow:\s*ellipsis/i.test(indexHtml),
      'Track title must be cleanly truncated with text-overflow ellipsis'
    );
    assert.ok(
      /#track-list\s+\.track-row\s+\.artist-link\s*\{[^}]*text-overflow:\s*ellipsis/i.test(indexHtml),
      'Track artist must be cleanly truncated with text-overflow ellipsis'
    );

    // Active track highlight
    assert.ok(
      /#track-list\s+\.track-row\.active\s*\{[^}]*box-shadow/i.test(indexHtml),
      'Active track must have high-contrast visual accent highlight'
    );
  });

  await t.test('7. Modal Dialogs Scrollability & Constraints', () => {
    // Settings modal full-viewport overlay scrolling (avoids nested scroll traps on Android/FiiO WebView 74)
    assert.ok(
      /#settings-modal[^\{]*\{[^}]*max-height:\s*min\(90vh/i.test(indexHtml) ||
      /#settings-panel\s*\{[^}]*max-height:\s*min\(90vh/i.test(indexHtml) ||
      /#settings-modal\s*\{[^}]*overflow-y:\s*auto\s*!important[^}]*-webkit-overflow-scrolling:\s*touch\s*!important/i.test(indexHtml),
      'Settings modal must support smooth touch scrolling on mobile'
    );

    // EQ panel max-height & touch scrolling on mobile
    assert.ok(
      /#eq-panel\s*\{[^}]*max-height:\s*min\(85vh/i.test(indexHtml),
      'EQ panel must be constrained with touch scrolling on mobile'
    );

    // Zone & signal path popovers
    assert.ok(
      /#zone-modal[^\{]*\{[^}]*max-height:\s*min\(90vh/i.test(indexHtml),
      'Zone modal must be constrained with touch scrolling on mobile'
    );
  });

  await t.test('8. Web Audio API absolute invariant preservation', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );
  });

  await t.test('9. Mobile Vertical Touch Scroll Unblocking & Decluttered 2-Row Player Bar (v2.0.9)', () => {
    // Document-level vertical touch scrolling unblocked (no dual html+body overflow-x:hidden trap, no #app-shell overflow:hidden trap)
    assert.match(
      indexHtml,
      /html\s*\{[^}]*overflow-y:\s*auto\s*!important/i,
      'html must explicitly allow vertical scrolling on mobile viewports'
    );
    assert.match(
      indexHtml,
      /body:not\(\.settings-open\):not\(\.metadata-open\)\s*\{[^}]*overflow-x:\s*(?:clip|hidden)\s*!important[^}]*touch-action:\s*pan-y\s+pinch-zoom\s*!important/is,
      'body (when modals closed) must constrain horizontal overflow (clip or Chromium 74 hidden) and touch-action: pan-y pinch-zoom to avoid dual scroll container trapping'
    );
    assert.match(
      indexHtml,
      /#app-shell\s*\{[^}]*display:\s*block\s*!important[^}]*overflow:\s*visible\s*!important[^}]*overflow-y:\s*visible\s*!important/is,
      '#app-shell on mobile must reset overflow: hidden to overflow-y: visible so document scrolls smoothly'
    );
    assert.match(
      indexHtml,
      /#content-col\s*\{[^}]*overflow-y:\s*visible\s*!important[^}]*overscroll-behavior-y:\s*auto\s*!important/is,
      '#content-col on mobile must release internal scroll containment so touch pan chains naturally'
    );

    // Spacious 2-Row Mobile Player Bar decluttering
    assert.match(
      indexHtml,
      /footer\.glass\s+#shuffle-button,\s*footer\.glass\s+#repeat-button\s*\{[^}]*display:\s*none\s*!important/i,
      'Mobile footer must hide secondary shuffle/repeat buttons on <768px to give song title & primary transport breathing room'
    );
    assert.match(
      indexHtml,
      /#autoplay-button-mobile,\s*#sleep-button-mobile,\s*#ambient-button-mobile\s*\{[^}]*display:\s*none\s*!important/i,
      'Mobile seek row must hide secondary clutter buttons so #seek-mobile gets full thumb-scrubbing width'
    );

    // Android Native WebView vertical scroll readiness
    const mainActivityPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
    const mainActivityJava = fs.readFileSync(mainActivityPath, 'utf8');
    assert.ok(
      mainActivityJava.includes('mWebView.setVerticalScrollBarEnabled(true);') &&
      mainActivityJava.includes('mWebView.setScrollContainer(true);'),
      'MainActivity WebView must enable vertical scroll bar and scroll container'
    );
  });
});
