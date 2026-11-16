const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

test('1. UI Integration: Bit-Perfect toggle switch exists in #settings-panel', () => {
  assert.match(indexHtml, /id="settings-panel"/, '#settings-panel must exist');
  assert.match(indexHtml, /id="bitperfect-section"/, '#bitperfect-section must exist in #settings-panel');
  assert.match(indexHtml, /id="bitperfect-mode-toggle"/, '#bitperfect-mode-toggle must exist');
  assert.match(
    indexHtml,
    /Chế độ Xuất Bit-Perfect \(PC \/ FiiO DAPS \/ USB DAC Direct\)/,
    'Toggle switch label "Chế độ Xuất Bit-Perfect (PC / FiiO DAPS / USB DAC Direct)" must be present'
  );
  assert.match(indexHtml, /id="bitperfect-mode-badge"/, '#bitperfect-mode-badge must exist');
});

test('2. State & Persistence: nocturne-bitperfect-enabled in localStorage', () => {
  assert.match(indexHtml, /bitPerfectEnabled:\s*\(typeof localStorage !== 'undefined' && localStorage\.getItem\('nocturne-bitperfect-enabled'\) === 'true'\)/, 'state.bitPerfectEnabled must be initialized from localStorage');
  assert.match(indexHtml, /localStorage\.setItem\('nocturne-bitperfect-enabled'/, 'Setting must be saved to localStorage');
  assert.match(indexHtml, /function applyBitPerfectMode/, 'applyBitPerfectMode function must exist');
  assert.match(indexHtml, /function setupBitPerfectIntegration/, 'setupBitPerfectIntegration function must exist');
});

test('3. PC Desktop Bit-Perfect mode: SampleRate adaptation & Pure Direct DSP Bypass', () => {
  // Dynamically adapt AudioContext sampleRate to match track sample rate
  assert.match(
    indexHtml,
    /state\.context\.sampleRate !== track\.sampleRate/,
    'AudioContext sampleRate adaptation must check state.context.sampleRate !== track.sampleRate'
  );
  assert.match(
    indexHtml,
    /new AudioContextClass\(\{\s*sampleRate:\s*track\.sampleRate\s*\}\)|new AudioContextClass\(\{\s*sampleRate:\s*targetRate\s*\}\)/,
    'AudioContext must be instantiated with target sampleRate in Bit-Perfect mode'
  );

  // Pure Direct DSP Bypass
  assert.match(
    indexHtml,
    /deck\.direct\.connect\(state\.context\.destination\)/,
    'Source direct path must connect directly to state.context.destination in Bit-Perfect mode'
  );
  assert.match(
    indexHtml,
    /deck\.direct\.gain\.setTargetAtTime\(1\.0,\s*state\.context\.currentTime,\s*\.015\)/,
    'Direct gain must be set to unity gain 1.0 in Bit-Perfect mode'
  );
  assert.match(
    indexHtml,
    /deck\.preamp\.gain\.setTargetAtTime\(0,\s*state\.context\.currentTime,\s*\.015\)/,
    'Preamp/EQ gain must be muted (0) in Bit-Perfect mode'
  );

  // Unity volume 1.0
  assert.match(
    indexHtml,
    /audio\.volume = 1\.0;\s*standbyAudio\.volume = 1\.0;/,
    'Software volume must maintain unity gain 1.0 (0 dB) in Bit-Perfect mode'
  );
});

test('4. Android Integration: Native bit-perfect playback delegation & sync', () => {
  assert.match(
    indexHtml,
    /window\.NocturneNative && window\.NocturneNative\.isBitPerfectSupported && state\.bitPerfectEnabled/,
    'playTrack must check window.NocturneNative && window.NocturneNative.isBitPerfectSupported && state.bitPerfectEnabled'
  );
  assert.match(
    indexHtml,
    /window\.NocturneNative\.startBitPerfectPlayback\(track\.url \|\| track\.src,\s*track\.sampleRate \|\| 44100,\s*track\.bitDepth \|\| 16\)/,
    'playTrack must delegate to window.NocturneNative.startBitPerfectPlayback with url, sampleRate, bitDepth'
  );
  assert.match(
    indexHtml,
    /window\.NocturneNative\?\.resumeBitPerfectPlayback/,
    'Play button must sync resume with native bridge'
  );
  assert.match(
    indexHtml,
    /window\.NocturneNative\?\.pauseBitPerfectPlayback/,
    'Pause button must sync pause with native bridge'
  );
  assert.match(
    indexHtml,
    /window\.NocturneNative\?\.seekBitPerfectPlayback/,
    'Seekbar change must sync seek with native bridge'
  );
  assert.match(
    indexHtml,
    /window\.onNativeBitPerfectPosition/,
    'Native bridge position callback must be exposed on window'
  );
});

test('5. UI Badge: #quality-badge displays ⚡ BIT-PERFECT DIRECT and native rate / depth', () => {
  assert.match(
    indexHtml,
    /⚡ BIT-PERFECT DIRECT/,
    '#quality-badge must include ⚡ BIT-PERFECT DIRECT when Bit-Perfect is active'
  );
  assert.match(
    indexHtml,
    /`⚡ BIT-PERFECT DIRECT · \$\{rateStr\} \/ \$\{depthStr\}`/,
    '#quality-badge must format ⚡ BIT-PERFECT DIRECT with sample rate and bit depth'
  );
});

test('6. CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) strictly preserved', () => {
  const matches = indexHtml.match(/state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/g);
  assert.ok(matches && matches.length >= 2, 'state.crossfeedNodes.output.connect(state.context.destination) must be preserved in code');
});
