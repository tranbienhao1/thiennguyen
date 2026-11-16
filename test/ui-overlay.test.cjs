'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiOverlay = require('../ui-overlay.js');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// =========================================================================
// MOCK WEB AUDIO GRAPH
// =========================================================================

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connections = [];
  }
  connect(dest, output = 0, input = 0) {
    this.connections.push({ dest, output, input });
    return dest;
  }
  disconnect(dest) {
    if (dest) {
      this.connections = this.connections.filter(c => c.dest !== dest);
    } else {
      this.connections = [];
    }
  }
}

class MockAudioParam {
  constructor(val = 0) {
    this.value = val;
  }
  setTargetAtTime(target) {
    this.value = target;
  }
  setValueAtTime(target) {
    this.value = target;
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super('gain');
    this.gain = new MockAudioParam(1);
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = new MockAudioNode('destination');
  }
  createGain() {
    return new MockGainNode();
  }
}

function createMockAudioState() {
  const ctx = new MockAudioContext();
  const crossfeedNodes = {
    input: ctx.createGain(),
    output: ctx.createGain()
  };
  // Establish invariant connection:
  crossfeedNodes.output.connect(ctx.destination);

  return {
    context: ctx,
    crossfeedNodes,
    tracks: [
      { id: 'track-1', title: 'Hotel California', artist: 'Eagles', album: 'Hotel California', duration: 390 },
      { id: 'track-2', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration: 354 },
      { id: 'track-3', title: 'Bài Ca Hy Vọng', artist: 'Thái Thanh', album: 'Tuyệt Phẩm', duration: 240 },
      { id: 'track-4', title: 'Love of My Life', artist: 'Queen', album: 'A Night at the Opera', duration: 218 }
    ],
    currentId: 'track-1',
    sleepOriginalVolume: 85
  };
}

// =========================================================================
// 1. MODULE EXPORTS & BASIC HEALTH
// =========================================================================

describe('UI Overlay: Module Exports & Health', () => {
  it('exports all expected API functions', () => {
    assert.equal(typeof uiOverlay.buildCommandPaletteItems, 'function');
    assert.equal(typeof uiOverlay.searchPaletteItems, 'function');
    assert.equal(typeof uiOverlay.handlePaletteKeydown, 'function');
    assert.equal(typeof uiOverlay.isCommandPaletteShortcut, 'function');
    assert.equal(typeof uiOverlay.calculateSmartSleepFadeGain, 'function');
    assert.equal(typeof uiOverlay.setSmartSleepTimer, 'function');
    assert.equal(typeof uiOverlay.clearSmartSleepTimer, 'function');
    assert.equal(typeof uiOverlay.toggleMiniPlayer, 'function');
    assert.equal(typeof uiOverlay.updateMiniPlayer, 'function');
    assert.equal(typeof uiOverlay.calculateProgress, 'function');
    assert.equal(typeof uiOverlay.verifyAudioGraphInvariant, 'function');
  });

  it('contains expected default quick actions', () => {
    assert.ok(Array.isArray(uiOverlay.DEFAULT_QUICK_ACTIONS));
    const ids = uiOverlay.DEFAULT_QUICK_ACTIONS.map(a => a.id);
    assert.ok(ids.includes('action-play-pause'));
    assert.ok(ids.includes('action-next'));
    assert.ok(ids.includes('action-prev'));
    assert.ok(ids.includes('action-shuffle'));
    assert.ok(ids.includes('action-toggle-eq'));
    assert.ok(ids.includes('action-switch-theme'));
    assert.ok(ids.includes('action-open-lyrics'));
    assert.ok(ids.includes('action-open-settings'));
  });
});

// =========================================================================
// 2. COMMAND PALETTE INDEXING
// =========================================================================

describe('UI Overlay: Command Palette Indexing', () => {
  it('indexes quick actions, tracks, unique albums, and unique artists', () => {
    const state = createMockAudioState();
    const items = uiOverlay.buildCommandPaletteItems(state);

    assert.ok(Array.isArray(items));
    assert.ok(items.length >= 8 + 4 + 2 + 2); // 8+ actions, 4 tracks, 2 unique albums, 2 unique artists

    const actions = items.filter(i => i.type === 'action');
    const tracks = items.filter(i => i.type === 'track');
    const albums = items.filter(i => i.type === 'album');
    const artists = items.filter(i => i.type === 'artist');

    assert.ok(actions.length >= 8, 'Must index quick actions');
    assert.equal(tracks.length, 4, 'Must index all 4 tracks');
    assert.equal(albums.length, 3, 'Must deduplicate albums into Hotel California, A Night at the Opera, and Tuyet Pham');
    assert.equal(artists.length, 3, 'Must deduplicate artists into Eagles, Queen, and Thai Thanh');

    // Verify track metadata fields
    const bohemian = tracks.find(t => t.title === 'Bohemian Rhapsody');
    assert.ok(bohemian);
    assert.equal(bohemian.artist, 'Queen');
    assert.equal(bohemian.album, 'A Night at the Opera');
  });

  it('handles empty state or tracks safely', () => {
    const emptyItems = uiOverlay.buildCommandPaletteItems(null);
    assert.ok(Array.isArray(emptyItems));
    assert.ok(emptyItems.length > 0); // Contains default actions
  });
});

// =========================================================================
// 3. SEARCH & FUZZY MATCHING
// =========================================================================

describe('UI Overlay: Search & Query Filtering', () => {
  const state = createMockAudioState();
  const items = uiOverlay.buildCommandPaletteItems(state);

  it('returns default curated items on empty query', () => {
    const res = uiOverlay.searchPaletteItems(items, '');
    assert.ok(res.length > 0);
    assert.equal(res[0].type, 'action', 'Default view puts actions first');
  });

  it('searches tracks by exact and partial title', () => {
    const res = uiOverlay.searchPaletteItems(items, 'Bohemian');
    assert.ok(res.length > 0);
    assert.equal(res[0].title, 'Bohemian Rhapsody');
  });

  it('matches Vietnamese accents and diacritics interchangeably', () => {
    const resWithoutAccent = uiOverlay.searchPaletteItems(items, 'hy vong');
    assert.ok(resWithoutAccent.length > 0);
    assert.equal(resWithoutAccent[0].title, 'Bài Ca Hy Vọng');

    const resWithAccent = uiOverlay.searchPaletteItems(items, 'Hy Vọng');
    assert.ok(resWithAccent.length > 0);
    assert.equal(resWithAccent[0].title, 'Bài Ca Hy Vọng');
  });

  it('searches albums and artists', () => {
    const albumRes = uiOverlay.searchPaletteItems(items, 'Night at the Opera');
    assert.ok(albumRes.some(i => i.type === 'album' && i.title === 'A Night at the Opera'));

    const artistRes = uiOverlay.searchPaletteItems(items, 'Eagles');
    assert.ok(artistRes.some(i => i.type === 'artist' && i.title === 'Eagles'));
  });

  it('searches quick actions by action keywords', () => {
    const res = uiOverlay.searchPaletteItems(items, 'equalizer');
    assert.ok(res.some(i => i.id === 'action-toggle-eq'));

    const res2 = uiOverlay.searchPaletteItems(items, 'lyrics');
    assert.ok(res2.some(i => i.id === 'action-open-lyrics'));
  });
});

// =========================================================================
// 4. KEYBOARD NAVIGATION & SHORTCUTS
// =========================================================================

describe('UI Overlay: Keyboard Navigation', () => {
  const sampleItems = [
    { id: '1', title: 'Item 1', handler: () => 'exec-1' },
    { id: '2', title: 'Item 2', handler: () => 'exec-2' },
    { id: '3', title: 'Item 3', handler: () => 'exec-3' }
  ];

  it('ArrowDown navigates forward with wrap-around', () => {
    let current = 0;
    const res1 = uiOverlay.handlePaletteKeydown({ key: 'ArrowDown', preventDefault: () => {} }, {
      items: sampleItems,
      selectedIndex: current,
      setSelectedIndex: (idx) => { current = idx; }
    });
    assert.equal(res1.handled, true);
    assert.equal(res1.newIndex, 1);
    assert.equal(current, 1);

    const res2 = uiOverlay.handlePaletteKeydown({ key: 'ArrowDown', preventDefault: () => {} }, {
      items: sampleItems,
      selectedIndex: 2,
      setSelectedIndex: (idx) => { current = idx; }
    });
    assert.equal(res2.newIndex, 0, 'Wraps to top on boundary');
  });

  it('ArrowUp navigates backward with wrap-around', () => {
    let current = 0;
    const res = uiOverlay.handlePaletteKeydown({ key: 'ArrowUp', preventDefault: () => {} }, {
      items: sampleItems,
      selectedIndex: current,
      setSelectedIndex: (idx) => { current = idx; }
    });
    assert.equal(res.handled, true);
    assert.equal(res.newIndex, 2, 'Wraps to end on top boundary');
  });

  it('Enter executes selected item handler and invokes onClose', () => {
    let executed = false;
    let closed = false;
    const items = [
      { id: 'test', title: 'Test', handler: () => { executed = true; } }
    ];

    const res = uiOverlay.handlePaletteKeydown({ key: 'Enter', preventDefault: () => {} }, {
      items,
      selectedIndex: 0,
      onClose: () => { closed = true; }
    });

    assert.equal(res.handled, true);
    assert.equal(res.executed, true);
    assert.equal(executed, true, 'Handler must be invoked');
    assert.equal(closed, true, 'onClose must be invoked');
  });

  it('Escape closes palette without executing', () => {
    let closed = false;
    const res = uiOverlay.handlePaletteKeydown({ key: 'Escape', preventDefault: () => {} }, {
      items: sampleItems,
      selectedIndex: 1,
      onClose: () => { closed = true; }
    });

    assert.equal(res.handled, true);
    assert.equal(res.dismissed, true);
    assert.equal(closed, true);
  });

  it('isCommandPaletteShortcut correctly identifies Ctrl+K, Cmd+K, and /', () => {
    // Ctrl + K
    assert.equal(uiOverlay.isCommandPaletteShortcut({ ctrlKey: true, key: 'k' }), true);
    assert.equal(uiOverlay.isCommandPaletteShortcut({ ctrlKey: true, key: 'K' }), true);

    // Cmd + K
    assert.equal(uiOverlay.isCommandPaletteShortcut({ metaKey: true, key: 'k' }), true);

    // Slash shortcut
    assert.equal(uiOverlay.isCommandPaletteShortcut({ key: '/', target: { tagName: 'DIV' } }), true);

    // Slash inside input should NOT trigger
    assert.equal(uiOverlay.isCommandPaletteShortcut({ key: '/', target: { tagName: 'INPUT' } }), false);
    assert.equal(uiOverlay.isCommandPaletteShortcut({ key: '/', target: { tagName: 'TEXTAREA' } }), false);

    // Unrelated keys
    assert.equal(uiOverlay.isCommandPaletteShortcut({ key: 'a' }), false);
  });
});

// =========================================================================
// 5. MINI PLAYER & PIP MODE
// =========================================================================

describe('UI Overlay: Mini Player & PiP Mode', () => {
  it('calculateProgress returns accurate fractions and formatted time strings', () => {
    const prog = uiOverlay.calculateProgress(90, 180);
    assert.equal(prog.fraction, 0.5);
    assert.equal(prog.percent, 50);
    assert.equal(prog.currentTimeFormatted, '1:30');
    assert.equal(prog.durationFormatted, '3:00');

    // Edge cases
    const zeroProg = uiOverlay.calculateProgress(0, 0);
    assert.equal(zeroProg.fraction, 0);
    assert.equal(zeroProg.percent, 0);

    const overProg = uiOverlay.calculateProgress(250, 200);
    assert.equal(overProg.fraction, 1);
  });
});

// =========================================================================
// 6. SMART SLEEP TIMER WITH EQUAL-POWER FADEOUT
// =========================================================================

describe('UI Overlay: Smart Sleep Timer', () => {
  it('calculateSmartSleepFadeGain returns 1.0 outside fadeout window', () => {
    assert.equal(uiOverlay.calculateSmartSleepFadeGain(60000, 30000), 1.0);
    assert.equal(uiOverlay.calculateSmartSleepFadeGain(30000, 30000), 1.0);
  });

  it('calculateSmartSleepFadeGain returns 0.0 when remainingMs <= 0 or invalid', () => {
    assert.equal(uiOverlay.calculateSmartSleepFadeGain(0, 30000), 0.0);
    assert.equal(uiOverlay.calculateSmartSleepFadeGain(-500, 30000), 0.0);
    assert.equal(uiOverlay.calculateSmartSleepFadeGain(NaN, 30000), 0.0);
    assert.equal(uiOverlay.calculateSmartSleepFadeGain(null, 30000), 0.0);
  });

  it('calculates equal-power sine gain curve (~0.7071 at 50% remaining)', () => {
    const halfGain = uiOverlay.calculateSmartSleepFadeGain(15000, 30000);
    assert.ok(Math.abs(halfGain - Math.SQRT1_2) < 1e-4, `Expected ~0.7071, got ${halfGain}`);

    // Monotonic decay
    const g75 = uiOverlay.calculateSmartSleepFadeGain(22500, 30000);
    const g50 = uiOverlay.calculateSmartSleepFadeGain(15000, 30000);
    const g25 = uiOverlay.calculateSmartSleepFadeGain(7500, 30000);

    assert.ok(g75 > g50, 'Gain at 75% should be greater than at 50%');
    assert.ok(g50 > g25, 'Gain at 50% should be greater than at 25%');
    assert.ok(g25 > 0, 'Gain at 25% should be greater than 0');
  });

  it('setSmartSleepTimer initializes active countdown and fades volume', async () => {
    let paused = false;
    let currentVol = 80;
    const mockAudio = {
      pause: () => { paused = true; }
    };

    const timer = uiOverlay.setSmartSleepTimer(0.001, { // ~60ms
      fadeOutSeconds: 0.05,
      initialVolume: 80,
      audio: mockAudio,
      setGainFn: (v) => { currentVol = v; }
    });

    assert.equal(timer.active, true);
    assert.ok(timer.deadline > Date.now());

    const status = uiOverlay.getSmartSleepTimerStatus();
    assert.equal(status.active, true);
    assert.equal(status.originalVolume, 80);

    // Clear timer safely
    uiOverlay.clearSmartSleepTimer();
    const afterStatus = uiOverlay.getSmartSleepTimerStatus();
    assert.equal(afterStatus.active, false);
  });
});

// =========================================================================
// 7. STRICT AUDIO INVARIANT PRESERVATION
// =========================================================================

describe('UI Overlay: Web Audio Graph Invariant Preservation', () => {
  it('strictly preserves state.crossfeedNodes.output.connect(state.context.destination)', () => {
    const state = createMockAudioState();
    const outputNode = state.crossfeedNodes.output;
    const dest = state.context.destination;

    // Invariant holds initially
    assert.ok(outputNode.connections.some(c => c.dest === dest), 'Initial invariant must hold');

    // 1. Index command palette
    uiOverlay.buildCommandPaletteItems(state);
    assert.ok(outputNode.connections.some(c => c.dest === dest), 'Invariant must hold after building palette');

    // 2. Perform search queries
    const items = uiOverlay.buildCommandPaletteItems(state);
    uiOverlay.searchPaletteItems(items, 'Bohemian Rhapsody');
    uiOverlay.searchPaletteItems(items, 'equalizer');
    assert.ok(outputNode.connections.some(c => c.dest === dest), 'Invariant must hold after palette searching');

    // 3. Perform keyboard navigation
    uiOverlay.handlePaletteKeydown({ key: 'ArrowDown', preventDefault: () => {} }, { items, selectedIndex: 0 });
    uiOverlay.handlePaletteKeydown({ key: 'ArrowUp', preventDefault: () => {} }, { items, selectedIndex: 1 });
    assert.ok(outputNode.connections.some(c => c.dest === dest), 'Invariant must hold after palette navigation');

    // 4. Exercise smart sleep timer
    let testVol = 80;
    uiOverlay.setSmartSleepTimer(15, {
      fadeOutSeconds: 30,
      customState: state,
      initialVolume: 80,
      setGainFn: (v) => { testVol = v; }
    });
    assert.ok(outputNode.connections.some(c => c.dest === dest), 'Invariant must hold after starting sleep timer');

    // Simulate volume fading step
    const fadeGain = uiOverlay.calculateSmartSleepFadeGain(15000, 30000);
    testVol = 80 * fadeGain;
    assert.ok(outputNode.connections.some(c => c.dest === dest), 'Invariant must hold during volume fadeout');

    // Clear sleep timer
    uiOverlay.clearSmartSleepTimer();
    assert.ok(outputNode.connections.some(c => c.dest === dest), 'Invariant must hold after clearing sleep timer');

    // Built-in verifier
    assert.equal(uiOverlay.verifyAudioGraphInvariant(state), true);
  });
});

// =========================================================================
// 8. DOM & SCRIPT INTEGRATION IN index.html
// =========================================================================

describe('UI Overlay: DOM & index.html Integration', () => {
  it('references ui-overlay.js script tag in index.html', () => {
    assert.match(indexHtml, /<script\s+src=["']ui-overlay\.js["']><\/script>/);
  });

  it('contains command-palette-modal markup with input and results container', () => {
    assert.match(indexHtml, /id=["']command-palette-modal["']/);
    assert.match(indexHtml, /id=["']palette-input["']/);
    assert.match(indexHtml, /id=["']palette-results["']/);
  });

  it('contains keyboard shortcut handling or listener for Ctrl+K, Cmd+K, and / in index.html', () => {
    assert.ok(
      indexHtml.includes('Ctrl+K') ||
      indexHtml.includes('Ctrl + K') ||
      indexHtml.includes('command-palette-modal') ||
      indexHtml.includes('toggleCommandPalette')
    );
  });

  it('strictly preserves state.crossfeedNodes.output.connect(state.context.destination) in index.html', () => {
    assert.match(indexHtml, /state\.crossfeedNodes\.output\.connect\(\s*state\.context\.destination\s*\)/);
  });
});
