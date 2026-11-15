const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const library = require('../library-utils.js');

test('EQ Relocation, Mini Player HUD Drag Optimization & Playback Hang Prevention Suite', async (t) => {
  await t.test('1. EQ button is relocated to .footer-left-col with unobstructed clickability', () => {
    // 1.1 Left column contains eq-button
    const leftMatch = indexHtml.match(/<div class="footer-left-col[\s\S]*?<\/div>/);
    assert.ok(leftMatch, 'Left column must exist');
    assert.ok(leftMatch[0].includes('id="eq-button"'), 'EQ button must be placed in footer-left-col');
    assert.ok(leftMatch[0].includes('id="player-cover"'), 'Left column must retain player-cover');
    assert.ok(leftMatch[0].includes('id="now-title"'), 'Left column must retain now-title');
    assert.ok(leftMatch[0].includes('id="favorite-button"'), 'Left column must retain favorite-button');

    // 1.2 Right column no longer has eq-button crowding tools
    const rightMatch = indexHtml.match(/<div class="footer-right-tools[\s\S]*?<\/div>/);
    assert.ok(rightMatch, 'Right column must exist');
    assert.ok(!rightMatch[0].includes('id="eq-button"'), 'Right column must no longer contain eq-button');

    // 1.3 Center controls have pointer-events: none to avoid blocking adjacent tools
    assert.match(indexHtml, /\.footer-center-controls\s*\{[^}]*pointer-events:\s*none/i, 'Center controls container must have pointer-events: none');
    assert.match(indexHtml, /\.footer-center-controls\s*>\s*\*\{[^}]*pointer-events:\s*auto/i, 'Center controls children must have pointer-events: auto');

    // 1.4 Header contains header-eq-btn
    assert.ok(indexHtml.includes('id="header-eq-btn"'), 'Header must contain header-eq-btn for quick EQ access');
    assert.ok(indexHtml.includes("hdrEq.addEventListener('click'") || indexHtml.includes("$('header-eq-btn').addEventListener('click'"), 'Header EQ button must delegate click to eq-button');
  });

  await t.test('2. Mini Player HUD drag performance is optimized for 120fps with zero transition stutter', () => {
    // 2.1 #mini-player-hud does not have transition-all on drag
    assert.ok(!indexHtml.includes('id="mini-player-hud" class="fixed bottom-[140px] right-6 z-50 flex items-center gap-3 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-[#14161a]/95 p-2.5 shadow-[0_16px_50px_rgba(0,0,0,0.85)] backdrop-blur-2xl hidden select-none transition-all duration-200"'),
      '#mini-player-hud must not have transition-all duration-200');

    // 2.2 is-dragging class disables transitions
    assert.match(indexHtml, /#mini-player-hud\.is-dragging\s*\{[^}]*transition:\s*none\s*!important/i,
      'is-dragging must enforce transition: none !important');

    // 2.3 Drag uses requestAnimationFrame
    assert.ok(indexHtml.includes('requestAnimationFrame'), 'Mini player drag must use requestAnimationFrame');
    assert.ok(indexHtml.includes('hudWidth = rect.width') || indexHtml.includes('hudWidth ='), 'Mini player drag must cache dimensions');

    // 2.4 Touch drag listeners exist
    assert.ok(indexHtml.includes("hudContainer.addEventListener('touchstart'"), 'Touch drag start must be supported');
    assert.ok(indexHtml.includes("window.addEventListener('touchmove'"), 'Touch drag move must be supported');
    assert.ok(indexHtml.includes("window.addEventListener('touchend'"), 'Touch drag end must be supported');
  });

  await t.test('3. Self-hosted audio track parsers populate track.url from track.src', () => {
    // 3.1 Subsonic
    const subTrack = library.parseSubsonicSong({ id: 'song-101', title: 'Test Subsonic', suffix: 'flac' }, 'http://localhost:4040', { user: 'u', pass: 'p' });
    assert.ok(subTrack, 'Subsonic track parsed');
    assert.ok(subTrack.src, 'Subsonic track has src');
    assert.equal(subTrack.url, subTrack.src, 'Subsonic track url must equal src');

    // 3.2 Jellyfin
    const jellyTrack = library.parseJellyfinItem({ Id: 'item-202', Name: 'Test Jellyfin', Container: 'flac' }, 'http://localhost:8096', 'token123');
    assert.ok(jellyTrack, 'Jellyfin track parsed');
    assert.ok(jellyTrack.src, 'Jellyfin track has src');
    assert.equal(jellyTrack.url, jellyTrack.src, 'Jellyfin track url must equal src');

    // 3.3 Black Candy
    const bcTrack = library.parseBlackCandySong({ id: 'bc-303', name: 'Test BC', format: 'flac' }, 'http://localhost:3000');
    assert.ok(bcTrack, 'Black Candy track parsed');
    assert.ok(bcTrack.src, 'Black Candy track has src');
    assert.equal(bcTrack.url, bcTrack.src, 'Black Candy track url must equal src');
  });

  await t.test('4. Playback optimistic UI handles timeouts and connection load errors gracefully', () => {
    // 4.1 playTrack fallback for track.src
    assert.ok(indexHtml.includes('if (!track.url && track.src) track.url = track.src;'),
      'playTrack must fallback to track.src if track.url is missing');

    // 4.2 applyOptimisticPlaybackUi safety timeout
    assert.ok(indexHtml.includes('applyOptimisticPlaybackUi._safetyTimer'),
      'applyOptimisticPlaybackUi must implement a safety guard timer');

    // 4.3 clearOptimisticLoadingUi restores playBtn text
    assert.ok(indexHtml.includes("if (playBtn.textContent === '…') playBtn.textContent = defaultIcon;"),
      'clearOptimisticLoadingUi must restore play-button text from …');

    // 4.4 Target error/stalled listeners attached
    assert.ok(indexHtml.includes("target.addEventListener('error', onPlaybackLoadError"),
      'playTrack target must listen for error events');
    assert.ok(indexHtml.includes("target.addEventListener('stalled', onPlaybackLoadError"),
      'playTrack target must listen for stalled events');
  });

  await t.test('5. Web Audio API Graph Invariant Preserved', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output must connect directly to state.context.destination'
    );
  });
});
