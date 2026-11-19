'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const swCode = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
const library = require('../library-utils.js');

function extractFunctionSource(code, name) {
  const marker = `function ${name}(`;
  const start = code.indexOf(marker);
  assert.ok(start >= 0, `Expected ${name} to be defined in index.html`);
  const openBrace = code.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

function extractElementTag(html, id) {
  const match = html.match(new RegExp(`<([a-z0-9-]+)\\b[^>]*\\bid="${id}"[^>]*>`, 'i'));
  assert.ok(match, `Element #${id} must exist in index.html`);
  return match[0];
}

function parseTailwindZIndex(tagMarkup) {
  const bracketMatch = tagMarkup.match(/\bz-\[(\d+)\]/);
  if (bracketMatch) return Number(bracketMatch[1]);
  const plainMatch = tagMarkup.match(/\bz-(\d+)\b/);
  if (plainMatch) return Number(plainMatch[1]);
  return null;
}

test('Fullscreen & Listening Room Unification Suite (v2.1.0)', async (t) => {

  await t.test('1. Footer toolbar hides redundant #room-button and exposes unified Fullscreen & Listening Room trigger', () => {
    const roomBtnTag = extractElementTag(indexHtml, 'room-button');
    assert.match(roomBtnTag, /\bhidden\b/, '#room-button must carry native hidden attribute');
    assert.ok(roomBtnTag.includes('!hidden'), '#room-button must carry !hidden utility class');
    assert.match(
      indexHtml,
      /#room-button\s*\{\s*display:\s*none\s*!important;\s*\}/i,
      'CSS must enforce #room-button { display: none !important; }'
    );

    const fsToggleTag = extractElementTag(indexHtml, 'fullscreen-toggle-btn');
    assert.ok(
      fsToggleTag.includes('Toàn màn hình Roon') && fsToggleTag.includes('Phòng nghe'),
      '#fullscreen-toggle-btn aria-label/title must describe unified Fullscreen & Listening Room'
    );

    assert.ok(
      indexHtml.includes("const openListeningRoom = (preferredMode) =>") &&
      indexHtml.includes("toggleRoonFullscreen(true)"),
      'openListeningRoom must route into unified #roon-fullscreen-view while keeping #listening-room hidden'
    );
  });

  await t.test('2. #roon-fullscreen-view provides all 4 mode tabs + Browser Fullscreen button + mobile 360px layout', () => {
    for (const btnId of [
      'fullscreen-view-art-btn',
      'fullscreen-view-lyrics-btn',
      'fullscreen-view-stage-btn',
      'fullscreen-view-room-btn',
      'fullscreen-browser-btn',
      'fullscreen-settings-btn'
    ]) {
      assert.ok(indexHtml.includes(`id="${btnId}"`), `#${btnId} must exist inside #roon-fullscreen-view`);
    }

    for (const stageId of [
      'fullscreen-stage-art',
      'fullscreen-stage-lyrics',
      'fullscreen-stage-visualizer',
      'fullscreen-stage-room'
    ]) {
      assert.ok(indexHtml.includes(`id="${stageId}"`), `#${stageId} stage panel must exist inside #roon-fullscreen-view`);
    }

    const pillsTag = extractElementTag(indexHtml, 'fullscreen-mode-pills');
    assert.ok(pillsTag.includes('flex-wrap'), '#fullscreen-mode-pills must allow responsive flex-wrap on 360px phones');
    assert.match(
      indexHtml,
      /@media\s*\(\s*max-width:\s*390px\s*\)[\s\S]*?#fullscreen-mode-pills\s+button/i,
      'Compact mobile rule must optimize 4 mode pills for <=390px screens'
    );
    assert.ok(
      indexHtml.includes('document.fullscreenElement') && indexHtml.includes('requestFullscreen'),
      '#fullscreen-browser-btn must toggle native Browser Fullscreen API'
    );
  });

  await t.test('3. #fullscreen-stage-room includes EQ & DSP, 5-star rating, Signal Path, Zone picker, Liner Notes & Telemetry', () => {
    const requiredRoomIds = [
      'fs-room-quality-badge',
      'fs-room-eq-btn',
      'fs-room-rating',
      'fs-room-engagement-badge',
      'fs-room-lrc-paste-btn',
      'fs-room-lrc-export-btn',
      'fs-room-lrc-refresh-btn',
      'fs-signal-path-badge',
      'fs-signal-detail-btn',
      'fs-room-signal',
      'fs-room-output',
      'fs-zone-current-name',
      'fs-zone-current-desc',
      'fs-zone-picker-btn',
      'fs-liner-notes-card',
      'fs-liner-score-badge',
      'fs-edit-liner-notes-btn',
      'fs-liner-notes-content',
      'fs-liner-gear-tag',
      'fs-liner-mastering-tag',
      'fs-liner-mood-tags',
      'fs-room-dr-badge',
      'fs-room-crest-detail',
      'fs-room-phase-badge',
      'fs-room-thermal-badge',
      'fs-room-bpm-badge',
      'fs-room-tp-badge',
      'fs-room-buffer-status',
      'fs-room-buffer-dot'
    ];
    for (const id of requiredRoomIds) {
      assert.ok(indexHtml.includes(`id="${id}"`), `#${id} must exist in #fullscreen-stage-room`);
    }

    // Lyrics toolbar also includes quick refresh / paste / export LRC controls
    for (const lrcId of ['fs-lyrics-refresh-btn', 'fs-lyrics-paste-btn', 'fs-lyrics-export-btn']) {
      assert.ok(indexHtml.includes(`id="${lrcId}"`), `#${lrcId} must exist in #fullscreen-stage-lyrics toolbar`);
    }

    // Vertical touch scroll enabled on #fullscreen-stage-room
    const stageRoomTag = extractElementTag(indexHtml, 'fullscreen-stage-room');
    assert.ok(stageRoomTag.includes('overflow-y-auto'), '#fullscreen-stage-room must be vertically scrollable');
    assert.match(
      indexHtml,
      /#fullscreen-stage-room\s*\{[^}]*touch-action:\s*pan-y\s*!important/i,
      '#fullscreen-stage-room must explicitly allow vertical touch panning'
    );
  });

  await t.test('4. #fullscreen-repeat-btn is present in bottom transport controls and synced with repeat state', () => {
    const repeatTag = extractElementTag(indexHtml, 'fullscreen-repeat-btn');
    assert.ok(repeatTag.includes('aria-label="Lặp lại"'), '#fullscreen-repeat-btn must have Vietnamese aria-label');
    assert.ok(indexHtml.includes("const fsRepeatBtn = $('fullscreen-repeat-btn')"), '#fullscreen-repeat-btn click handler must be wired');
    assert.ok(indexHtml.includes('function syncTransportModesUI()'), 'syncTransportModesUI helper must synchronize Shuffle & Repeat states');
  });

  await t.test('5. All modals, drawers, and popovers layer cleanly ABOVE #roon-fullscreen-view', () => {
    const fsZ = parseTailwindZIndex(extractElementTag(indexHtml, 'roon-fullscreen-view'));
    const footerZ = parseTailwindZIndex(extractElementTag(indexHtml, 'player-footer'));
    assert.ok(Number.isFinite(fsZ) && fsZ > footerZ, `#roon-fullscreen-view z-index (${fsZ}) must sit above #player-footer (${footerZ})`);

    const overlayIds = [
      'queue-panel',
      'sleep-panel',
      'ambient-panel',
      'eq-panel',
      'zone-modal',
      'signal-path-popover',
      'metadata-modal',
      'command-palette-modal',
      'context-menu',
      'toast',
      'autoeq-modal'
    ];
    for (const id of overlayIds) {
      const z = parseTailwindZIndex(extractElementTag(indexHtml, id));
      assert.ok(
        Number.isFinite(z) && z > fsZ,
        `Overlay #${id} z-index (${z}) must be strictly greater than #roon-fullscreen-view (${fsZ})`
      );
    }

    // Native <dialog id="settings-modal"> also enforces z-index: 100 !important (> fsZ)
    assert.match(indexHtml, /#settings-modal\s*\{\s*z-index:100!important/, '#settings-modal CSS z-index:100!important must exceed #roon-fullscreen-view');
    assert.ok(100 > fsZ, '#settings-modal z-index (100) must exceed #roon-fullscreen-view');
  });

  await t.test('6. Behavioral verification: setFullscreenViewMode("room"), Liner Notes sync, Rating sync & Transport Repeat sync', () => {
    const makeEl = (initialHidden = false) => {
      const classes = new Set(initialHidden ? ['hidden'] : []);
      const stars = [1, 2, 3, 4, 5].map((n) => ({ dataset: { rating: String(n) }, textContent: '☆', className: 'star' }));
      const valSpan = { textContent: '' };
      return {
        textContent: '',
        title: '',
        className: '',
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        classList: {
          add: (...c) => c.forEach((x) => classes.add(x)),
          remove: (...c) => c.forEach((x) => classes.delete(x)),
          toggle: (c, force) => {
            const next = force !== undefined ? !!force : !classes.has(c);
            if (next) classes.add(c); else classes.delete(c);
            return next;
          },
          contains: (c) => classes.has(c)
        },
        querySelectorAll: (sel) => (sel === '.star' ? stars : []),
        querySelector: (sel) => (sel === '.val' ? valSpan : null),
        _stars: stars,
        _val: valSpan
      };
    };

    const dom = {
      'fullscreen-stage-art': makeEl(false),
      'fullscreen-stage-lyrics': makeEl(true),
      'fullscreen-stage-visualizer': makeEl(true),
      'fullscreen-stage-room': makeEl(true),
      'fullscreen-view-art-btn': makeEl(false),
      'fullscreen-view-lyrics-btn': makeEl(false),
      'fullscreen-view-stage-btn': makeEl(false),
      'fullscreen-view-room-btn': makeEl(false),
      'shuffle-button': makeEl(false),
      'fullscreen-shuffle-btn': makeEl(false),
      'repeat-button': makeEl(false),
      'fullscreen-repeat-btn': makeEl(false),
      'room-rating': makeEl(false),
      'fs-room-rating': makeEl(false),
      'room-engagement-badge': makeEl(false),
      'fs-room-engagement-badge': makeEl(false),
      'room-liner-notes-card': makeEl(false),
      'fs-liner-notes-card': makeEl(false),
      'room-liner-score-badge': makeEl(true),
      'fs-liner-score-badge': makeEl(true),
      'room-liner-notes-content': makeEl(false),
      'fs-liner-notes-content': makeEl(false),
      'room-liner-gear-tag': makeEl(true),
      'fs-liner-gear-tag': makeEl(true),
      'room-liner-mastering-tag': makeEl(true),
      'fs-liner-mastering-tag': makeEl(true),
      'room-liner-mood-tags': makeEl(true),
      'fs-liner-mood-tags': makeEl(true),
    };

    const state = {
      fullscreenViewMode: 'art',
      shuffle: true,
      repeat: 2,
      activeDeck: null,
      trackAnnotations: {
        t1: {
          audiophileScore: 96,
          notes: 'Âm trường rộng, dải trung mượt',
          gearRecommendation: 'FiiO M11S + HD650',
          masteringDetails: '24-bit/96kHz Original Master',
          moodTags: ['Audiophile', 'Late Night']
        }
      }
    };

    const setModeFn = new Function(
      '$', 'state', 'audio', 'renderFullscreenLyrics', 'updateLyricsHighlight', 'resizeFullscreenStageCanvas', 'setVisualizerRunning', 'updateRoonFullscreenUI',
      `${extractFunctionSource(indexHtml, 'setFullscreenViewMode')}\nreturn setFullscreenViewMode;`
    )((id) => dom[id] || null, state, { paused: true, src: '' }, () => {}, () => {}, () => {}, () => {}, () => {});

    setModeFn('room');
    assert.equal(state.fullscreenViewMode, 'room');
    assert.equal(dom['fullscreen-stage-room'].classList.contains('hidden'), false, '#fullscreen-stage-room must unhide when mode="room"');
    assert.equal(dom['fullscreen-stage-room'].classList.contains('flex'), true, '#fullscreen-stage-room must display flex when mode="room"');
    assert.equal(dom['fullscreen-stage-art'].classList.contains('hidden'), true, '#fullscreen-stage-art must hide when mode="room"');
    assert.ok(dom['fullscreen-view-room-btn'].className.includes('bg-white/15'), '#fullscreen-view-room-btn must receive active pill styling');

    const syncTransportFn = new Function(
      '$', 'state',
      `${extractFunctionSource(indexHtml, 'syncTransportModesUI')}\nreturn syncTransportModesUI;`
    )((id) => dom[id] || null, state);

    syncTransportFn();
    assert.equal(dom['fullscreen-repeat-btn'].textContent, '↻¹', 'Repeat-one state must render ↻¹ on #fullscreen-repeat-btn');
    assert.equal(dom['fullscreen-repeat-btn'].attrs['aria-pressed'], 'true');
    assert.equal(dom['fullscreen-shuffle-btn'].attrs['aria-pressed'], 'true');

    const updateRatingFn = new Function(
      '$', 'library', 'getTrackRating', 'isFavorite',
      `${extractFunctionSource(indexHtml, 'updateRoomRating')}\nreturn updateRoomRating;`
    )((id) => dom[id] || null, library, () => 4, () => true);

    updateRatingFn({ id: 't1', playCount: 5, skipCount: 0 });
    assert.deepEqual(
      dom['fs-room-rating']._stars.map((s) => s.textContent),
      ['★', '★', '★', '★', '☆'],
      '4-star rating must render 4 filled stars inside #fs-room-rating'
    );

    const updateAnnotationsFn = new Function(
      '$', 'getTrackAnnotation',
      `${extractFunctionSource(indexHtml, 'updateListeningRoomAnnotations')}\nreturn updateListeningRoomAnnotations;`
    )((id) => dom[id] || null, (tr) => state.trackAnnotations[tr.id]);

    updateAnnotationsFn({ id: 't1' });
    assert.equal(dom['fs-liner-score-badge'].textContent, '🎯 96/100');
    assert.equal(dom['fs-liner-notes-content'].textContent, 'Âm trường rộng, dải trung mượt');
    assert.equal(dom['fs-liner-gear-tag']._val.textContent, 'FiiO M11S + HD650');
    assert.equal(dom['fs-liner-mastering-tag']._val.textContent, '24-bit/96kHz Original Master');
    assert.equal(dom['fs-liner-mood-tags']._val.textContent, 'Audiophile, Late Night');
  });

  await t.test('7. Service Worker cache version bumped to v2.6.2 & Web Audio Graph Invariant preserved', () => {
    assert.ok(swCode.includes("CACHE_VERSION = 'v2.6.2'"), 'sw.js CACHE_VERSION must be v2.6.2');
    assert.ok(swCode.includes("CACHE_NAME = 'nocturne-v2.6.2'"), 'sw.js CACHE_NAME must be v2.6.2');
    assert.equal(library.buildServiceWorkerCacheManifest(['./', 'index.html']).version, 'nocturne-v2.6.2');

    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must remain strictly intact'
    );
  });
});
