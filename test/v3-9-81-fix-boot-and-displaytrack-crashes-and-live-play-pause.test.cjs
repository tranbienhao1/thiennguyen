'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
const libraryUtils = require(path.join(ROOT, 'library-utils.js'));

function extractFn(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Expected to find ${signature}`);
  let braceStart = source.indexOf('{', start);
  let depth = 0;
  let inSingle = false, inDouble = false, inTpl = false, escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (!inDouble && !inTpl && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTpl && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`') { inTpl = !inTpl; continue; }
    if (inSingle || inDouble || inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated function ${signature}`);
}

test('v3.9.81: Fix 1 — displayTrack never dereferences null state.context.sampleRate', () => {
  const snippet = extractFn(html, 'function displayTrack(track)');
  assert.equal(
    snippet.includes('(state.context ? state.context.sampleRate : 48000)'),
    false,
    'Broken truthy fallback ternary must be removed from displayTrack'
  );
  const matches = snippet.match(/state\.context && state\.context\.sampleRate/g) || [];
  assert.ok(matches.length >= 2, 'Both bitPerfect and normal displayTrack branches must guard state.context && state.context.sampleRate');
});

test('v3.9.81: Fix 2 & 3 — applySubBassPunch and applySubBassPhaseProfile pass strictly finite numbers to setTargetAtTime', () => {
  const strictParam = () => ({
    calls: [],
    setTargetAtTime(val, t, tc) {
      if (!Number.isFinite(val) || !Number.isFinite(t) || !Number.isFinite(tc)) {
        throw new TypeError(`Non-finite AudioParam argument: (${val}, ${t}, ${tc})`);
      }
      this.calls.push([val, t, tc]);
    }
  });

  const punchFnSrc = extractFn(html, 'function applySubBassPunch(profileKey, intensity)');
  const phaseFnSrc = extractFn(html, 'function applySubBassPhaseProfile(profileKey)');

  const punchFilter = { frequency: strictParam(), Q: strictParam(), gain: strictParam() };
  const punchPreamp = { gain: strictParam() };
  const phaseNodes = {
    lowpass: { frequency: strictParam() },
    allpass: { frequency: strictParam() },
    shaper: { curve: null },
    wetGain: { gain: strictParam() },
    dryGain: { gain: strictParam() }
  };

  const sandbox = {
    library: libraryUtils,
    NocturneLibrary: libraryUtils,
    localStorage: { setItem() {}, getItem() { return null; } },
    updateSubBassPunchUi() {},
    updateSubBassPhaseUi() {},
    renderRoomSignal() {},
    renderSignalPathChain() {},
    state: {
      context: { currentTime: 1.5, sampleRate: 48000 },
      tracks: [],
      currentId: null,
      subBassPunchProfile: 'off',
      subBassPunchIntensity: 1.0,
      subBassPunchNodes: { filter: punchFilter, safetyPreamp: punchPreamp },
      subBassPhaseProfile: 'bypass',
      subBassPhaseNodes: phaseNodes
    }
  };
  vm.runInNewContext(`${punchFnSrc}\n${phaseFnSrc}`, sandbox);

  // Test default off + active profile for Sub-Bass Punch
  assert.doesNotThrow(() => sandbox.applySubBassPunch('off', 1.0));
  assert.doesNotThrow(() => sandbox.applySubBassPunch('punchy_45', 1.2));
  assert.ok(punchFilter.frequency.calls.length >= 2);
  assert.ok(punchFilter.gain.calls.every(c => Number.isFinite(c[0])));

  // Test default bypass + active profile for Sub-Bass Phase
  assert.doesNotThrow(() => sandbox.applySubBassPhaseProfile('bypass'));
  assert.doesNotThrow(() => sandbox.applySubBassPhaseProfile('tight_45'));
  assert.ok(phaseNodes.wetGain.gain.calls.length >= 2);
  assert.equal(phaseNodes.wetGain.gain.calls[0][0], 0);
  assert.equal(phaseNodes.dryGain.gain.calls[0][0], 1.0);
});

test('v3.9.81: Fix 4 & 5 — syncQuickSleepPill quotes all strings & sidebar-collapsed script runs after <body>', () => {
  assert.equal(html.includes('$(quick-sleep-btn)'), false, 'Unquoted $(quick-sleep-btn) must not exist');
  assert.ok(html.includes("const btn = $('quick-sleep-btn');"), 'syncQuickSleepPill must quote quick-sleep-btn');
  assert.ok(html.includes("safeOn($('quick-sleep-btn'), 'click'"), 'quick-sleep-btn click listener must quote ID');
  assert.ok(html.includes("btn.classList.toggle('text-indigo-300', active)"), 'text-indigo-300 must be quoted');
  assert.ok(html.includes("btn.classList.toggle('border-indigo-400/50', active)"), 'border-indigo-400/50 must be quoted');
  assert.ok(html.includes("btn.setAttribute('aria-pressed'"), 'aria-pressed must be quoted');

  const bodyIdx = html.indexOf('<body ');
  const sidebarScriptIdx = html.indexOf("document.body.classList.add('sidebar-collapsed')");
  assert.ok(bodyIdx > 0 && sidebarScriptIdx > bodyIdx, 'sidebar-collapsed inline script must execute after <body>');
});

test('v3.9.81: Fix 6 — attachReliableTransportTap clears ghost flag on mouse pointerdown & restores unexpired Cloud tokens', () => {
  const tapFnSrc = extractFn(html, 'function attachReliableTransportTap(el)');
  const listeners = {};
  let clickCount = 0;
  const fakeBtn = {
    disabled: false,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    click() { clickCount++; }
  };
  const sandbox = { Date };
  vm.runInNewContext(tapFnSrc, sandbox);
  sandbox.attachReliableTransportTap(fakeBtn);

  // Simulate touch tap
  listeners.touchstart.forEach(fn => fn({ touches: [{ clientX: 50, clientY: 50 }] }));
  listeners.touchend.forEach(fn => fn({ cancelable: true, preventDefault() {}, changedTouches: [{ clientX: 50, clientY: 50 }] }));
  assert.equal(clickCount, 1);
  assert.equal(fakeBtn._touchTapGhostPending, true);

  // Immediately followed by real mouse pointerdown -> clears ghost flag so mouse click is NOT swallowed
  listeners.pointerdown.forEach(fn => fn({ pointerType: 'mouse' }));
  assert.equal(fakeBtn._touchTapGhostPending, false);
  let stopped = false;
  listeners.click.forEach(fn => fn({
    isTrusted: true,
    preventDefault() { stopped = true; },
    stopPropagation() { stopped = true; },
    stopImmediatePropagation() { stopped = true; }
  }));
  assert.equal(stopped, false, 'Real mouse click after touch must not be swallowed');

  // Verify Cloud token expiry save & startup restore
  assert.ok(html.includes("localStorage.setItem('nocturne-google-token-expires'"));
  assert.ok(html.includes("localStorage.setItem('nocturne-microsoft-token-expires'"));
  assert.ok(html.includes("const savedGoogleExp = Number(localStorage.getItem('nocturne-google-token-expires')) || 0;"));
  assert.ok(html.includes("const savedMsExp = Number(localStorage.getItem('nocturne-microsoft-token-expires')) || 0;"));
});

test('v3.9.81: Version bump parity across sw.js, index.html, and build.gradle.kts', () => {
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.81';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.81';"));
  const htmlVer = html.match(/FiiO M11S · v(\d+)\.(\d+)\.(\d+)/);
  assert.ok(htmlVer && Number(htmlVer[1]) * 10000 + Number(htmlVer[2]) * 100 + Number(htmlVer[3]) >= 30981);
  const vcMatch = gradle.match(/versionCode\s*=\s*(\d+)/);
  assert.ok(vcMatch && Number(vcMatch[1]) >= 135);
  assert.ok(gradle.includes('versionName = "3.9.81"'));
});
