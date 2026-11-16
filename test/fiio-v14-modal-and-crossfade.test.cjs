'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mainActivityJava = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java'), 'utf8');

test('1. Offline CSS Resilience: Modals and panels guaranteed hidden without Tailwind CDN', () => {
  assert.ok(
    indexHtml.includes('#sleep-panel.hidden, #sleep-panel[hidden]') && indexHtml.includes('#eq-panel.hidden, #eq-panel[hidden]'),
    'index.html must define authoritative modal rules in <style id="app-style">'
  );
  assert.ok(
    indexHtml.includes('id="sleep-panel"') && indexHtml.includes('role="dialog" aria-labelledby="sleep-title" hidden>'),
    '#sleep-panel must include native hidden attribute to prevent FOUC / open-by-default'
  );
  assert.ok(
    indexHtml.includes('id="eq-panel"') && indexHtml.includes('shadow-2xl backdrop-blur-xl" hidden>'),
    '#eq-panel must include native hidden attribute to prevent FOUC / open-by-default'
  );
});

test('2. Touch Ergonomics on FiiO M11S / Mobile: 44px touch targets and dismiss button', () => {
  // Mobile styles for close buttons
  assert.ok(
    indexHtml.includes('#sleep-close, #ambient-close, #eq-close-btn'),
    'Mobile CSS must target #sleep-close, #ambient-close, #eq-close-btn'
  );
  assert.ok(
    indexHtml.includes('min-width: 44px !important;') && indexHtml.includes('min-height: 44px !important;'),
    'Mobile close buttons must have minimum 44px touch target'
  );
  // Dedicated dismiss button in #sleep-panel
  assert.ok(
    indexHtml.includes('id="sleep-dismiss"'),
    '#sleep-panel must provide a clear, visible #sleep-dismiss button for one-tap dismissal'
  );
});

test('3. Android Hardware Back Navigation Integration', () => {
  // JavaScript side
  assert.ok(
    indexHtml.includes('window.onAndroidBackPressed = function()'),
    'index.html must expose window.onAndroidBackPressed to close open panels/modals on Back press'
  );
  // Android Java side
  assert.ok(
    mainActivityJava.includes('window.onAndroidBackPressed && window.onAndroidBackPressed()'),
    'MainActivity.java setupBackNavigation must invoke window.onAndroidBackPressed before popping activity'
  );
});

test('4. Offline Crossfade Lookahead & queueIndex Index Fix', () => {
  assert.ok(
    indexHtml.includes('if (nextPlayable && nextPlayable.track) {') &&
    indexHtml.includes('return nextPlayable.index >= 0 ? nextPlayable.index : state.tracks.indexOf(nextPlayable.track);'),
    'queueIndex must extract the numeric track index from getNextPlayableTrack rather than calling indexOf on the object'
  );
});

test('5. Tap-outside listener for floating dialogs', () => {
  assert.ok(
    indexHtml.includes("document.addEventListener('pointerdown',"),
    'index.html must listen for outside pointer events to dismiss floating panels'
  );
});

test('6. Audio Graph Invariant Preservation', () => {
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'STRICT AUDIOPHILE INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must never be broken'
  );
});
