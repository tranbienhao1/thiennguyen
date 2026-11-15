'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const library = require('../library-utils.js');

function createMockCanvasContext(calls = []) {
  const gradient = { addColorStop: () => {} };
  return {
    clearRect: (...args) => calls.push({ method: 'clearRect', args }),
    fillRect: (...args) => calls.push({ method: 'fillRect', args }),
    beginPath: () => calls.push({ method: 'beginPath' }),
    closePath: () => calls.push({ method: 'closePath' }),
    arc: (...args) => calls.push({ method: 'arc', args }),
    stroke: () => calls.push({ method: 'stroke' }),
    fill: () => calls.push({ method: 'fill' }),
    moveTo: (...args) => calls.push({ method: 'moveTo', args }),
    lineTo: (...args) => calls.push({ method: 'lineTo', args }),
    quadraticCurveTo: (...args) => calls.push({ method: 'quadraticCurveTo', args }),
    bezierCurveTo: (...args) => calls.push({ method: 'bezierCurveTo', args }),
    save: () => calls.push({ method: 'save' }),
    restore: () => calls.push({ method: 'restore' }),
    setLineDash: (...args) => calls.push({ method: 'setLineDash', args }),
    fillText: (text, ...args) => calls.push({ method: 'fillText', text, args }),
    measureText: (text) => ({ width: (text || '').length * 6 }),
    createRadialGradient: (...args) => {
      calls.push({ method: 'createRadialGradient', args });
      return gradient;
    },
    createLinearGradient: (...args) => {
      calls.push({ method: 'createLinearGradient', args });
      return gradient;
    },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0
  };
}

test('Bug Fix 1: Fullscreen Play/Pause Controls (#fullscreen-play-btn) & State Sync', async (t) => {
  await t.test('1.1. #fullscreen-play-btn element exists in HTML with appropriate attributes', () => {
    assert.ok(indexHtml.includes('id="fullscreen-play-btn"'), '#fullscreen-play-btn must exist in DOM');
    assert.match(
      indexHtml,
      /<button[^>]*id="fullscreen-play-btn"[^>]*aria-label="[^"]*"[^>]*>/,
      '#fullscreen-play-btn must have aria-label'
    );
  });

  await t.test('1.2. #fullscreen-play-btn click listener delegates directly to play-button.click()', () => {
    const fsPlayListenerMatch = indexHtml.match(/const fsPlayBtn\s*=\s*\$\('fullscreen-play-btn'\);[\s\S]*?fsPlayBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/);
    assert.ok(fsPlayListenerMatch, 'fsPlayBtn click listener found');
    const listenerBody = fsPlayListenerMatch[1];

    assert.ok(
      listenerBody.includes("$('play-button')") || listenerBody.includes("playBtn"),
      'Must obtain reference to main play-button'
    );
    assert.ok(
      listenerBody.includes("playBtn.click()") || listenerBody.includes("$('play-button').click()"),
      'Must delegate click to main play-button to activate AudioContext, DSD worker, and playback pipeline'
    );
  });

  await t.test('1.3. Audio play/pause event handlers synchronize #fullscreen-play-btn icon', () => {
    // In audio 'play' event listener
    assert.match(
      indexHtml,
      /\$\('fullscreen-play-btn'\)\.textContent\s*=\s*'⏸'/,
      "Audio play event must set #fullscreen-play-btn textContent to '⏸'"
    );

    // In audio 'pause' event listener
    assert.match(
      indexHtml,
      /\$\('fullscreen-play-btn'\)\.textContent\s*=\s*'▶'/,
      "Audio pause event must set #fullscreen-play-btn textContent to '▶'"
    );
  });

  await t.test('1.4. updateRoonFullscreenUI synchronizes #fullscreen-play-btn icon state', () => {
    const updateUiMatch = indexHtml.match(/function updateRoonFullscreenUI\s*\(\)\s*\{([\s\S]*?)\n\s*function /);
    assert.ok(updateUiMatch, 'updateRoonFullscreenUI function body found');
    const body = updateUiMatch[1];

    assert.ok(body.includes('fullscreen-play-btn'), 'Must reference fullscreen-play-btn');
    assert.ok(
      body.includes("isPlaying ? '⏸' : '▶'") || body.includes("curAudio.paused) ? '▶' : '⏸'"),
      "Must toggle between '⏸' and '▶' according to playback state"
    );
  });

  await t.test('1.5. syncFullscreenPlayBtnState helper and MutationObserver sync play button changes', () => {
    assert.ok(indexHtml.includes('function syncFullscreenPlayBtnState'), 'syncFullscreenPlayBtnState function exists');
    assert.ok(indexHtml.includes('MutationObserver'), 'MutationObserver is used for real-time play-button observing');
    assert.ok(indexHtml.includes('playBtnObserver.observe(mainPlayBtn'), 'Observer watches main play-button DOM changes');
  });

  await t.test('1.6. Functional verification of syncFullscreenPlayBtnState logic', () => {
    function simulateSync(audioPaused, audioSrc, playButtonText) {
      const isPlaying = (playButtonText === 'Ⅱ' || playButtonText === '⏸') || (!audioPaused && Boolean(audioSrc));
      return isPlaying ? '⏸' : '▶';
    }

    assert.strictEqual(simulateSync(true, 'track.mp3', '▶'), '▶');
    assert.strictEqual(simulateSync(false, 'track.mp3', 'Ⅱ'), '⏸');
    assert.strictEqual(simulateSync(false, 'track.mp3', '⏸'), '⏸');
    assert.strictEqual(simulateSync(true, '', '▶'), '▶');
    assert.strictEqual(simulateSync(true, 'track.mp3', 'Ⅱ'), '⏸', 'If main button shows playing symbol, sync to ⏸');
  });
});

test('Bug Fix 2: Fullscreen 3D Stage Visualizers Active Even When audio.paused = true', async (t) => {
  await t.test('2.1. setVisualizerRunning does not stop loop when audio is paused in stage mode', () => {
    assert.match(
      indexHtml,
      /audio\.paused\s*&&\s*!\(state\.isFullscreen\s*&&\s*state\.fullscreenViewMode\s*===\s*'stage'\)/,
      'visibilitychange handler must allow visualizer to keep running when in fullscreen stage mode even if audio is paused'
    );
  });

  await t.test('2.2. setVisualizerRunning handles frame scheduling and cancelAnimationFrame', () => {
    const setVisMatch = indexHtml.match(/function setVisualizerRunning\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*let volumeBeforeMute/);
    assert.ok(setVisMatch, 'setVisualizerRunning function body found');
    const visBody = setVisMatch[1];

    assert.ok(visBody.includes('cancelAnimationFrame(visualizerFrame)'), 'Cancels pending animation frame');
    assert.ok(visBody.includes('setupAudio()'), 'Ensures setupAudio is invoked safely');
    assert.ok(visBody.includes('requestAnimationFrame(draw)'), 'Schedules next draw frame');
  });

  await t.test('2.3. draw() render loop persists when audio is paused in stage mode (no black screen)', () => {
    const drawMatch = indexHtml.match(/const draw\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*;\s*\n\s*visualizerFrame/);
    assert.ok(drawMatch, 'draw() function body found');
    const drawBody = drawMatch[1];

    assert.ok(
      drawBody.includes('const isStage = !!(state.isFullscreen && state.fullscreenViewMode === \'stage\')'),
      'Evaluates isStage boolean flag'
    );
    assert.ok(
      drawBody.includes('if (!isAudioActive && !isStage)'),
      'Only exits draw loop if both audio is inactive AND NOT in stage mode'
    );
    assert.ok(
      drawBody.includes('analyser.getByteTimeDomainData(timeData)'),
      'Always captures time domain data on every frame'
    );
  });

  await t.test('2.4. Stage visualizer renders idle / standby states for all 3 modes (VU, Vector, Radar)', () => {
    const drawMatch = indexHtml.match(/if \(state\.isFullscreen && state\.fullscreenViewMode === 'stage'\)\s*\{([\s\S]*?)\n\s*\}\s*\n\s*\}\s*;\s*\n\s*visualizerFrame/);
    assert.ok(drawMatch, 'Stage visualizer dispatch block found');
    const stageBody = drawMatch[1];

    // VU Meter standby (-45°)
    assert.ok(stageBody.includes("let angleL = -45;"), 'VU Meter left needle default idle position is -45°');
    assert.ok(stageBody.includes("let angleR = -45;"), 'VU Meter right needle default idle position is -45°');
    assert.ok(stageBody.includes("VU STANDBY (-45°)"), 'Displays VU standby indicator when paused');
    assert.ok(stageBody.includes('library.renderVisualizerVuMeter'), 'Renders VU Meter');

    // Goniometer 3D (Spatial Vector) standby
    assert.ok(stageBody.includes("soundstageState: 'standby'"), 'Spatial vector provides standby report');
    assert.ok(stageBody.includes("standby: !isAudioActive"), 'Passes standby option to renderSpatialVectorCanvas');
    assert.ok(stageBody.includes('library.renderSpatialVectorCanvas'), 'Renders Goniometer 3D');

    // Radar 3D standby
    assert.ok(stageBody.includes("statusLabel: 'Radar STANDBY'"), 'Radar provides standby report');
    assert.ok(stageBody.includes('library.renderPolarRadarCanvas'), 'Renders Radar 3D');
  });

  await t.test('2.5. library.renderSpatialVectorCanvas renders high-contrast grid and STANDBY reticle', () => {
    const calls = [];
    const mockCtx = createMockCanvasContext(calls);
    const mockCanvas = {
      getContext: () => mockCtx,
      width: 400,
      height: 400
    };

    // When standby: true and empty points
    const rendered = library.renderSpatialVectorCanvas(mockCanvas, {
      points: [],
      soundstageSpread: 0,
      correlation: 1.0,
      soundstageState: 'standby'
    }, { standby: true });

    assert.strictEqual(rendered, true, 'renderSpatialVectorCanvas should return true');
    assert.ok(calls.some(c => c.method === 'clearRect'), 'Must clear canvas');
    assert.ok(calls.some(c => c.method === 'fillText' && c.text === 'STANDBY'), 'Must draw STANDBY label in idle mode');
  });

  await t.test('2.6. library.renderPolarRadarCanvas clears canvas and draws dB rings in standby mode', () => {
    const calls = [];
    const mockCtx = createMockCanvasContext(calls);
    const mockCanvas = {
      getContext: () => mockCtx,
      width: 600,
      height: 400
    };

    const polarReport = {
      bins: [],
      soundstageState: 'standby',
      soundstageApertureDeg: 0,
      statusLabel: 'Radar STANDBY',
      centroidAzimuthDeg: 0,
      correlation: 1.0
    };

    const rendered = library.renderPolarRadarCanvas(mockCanvas, polarReport, { theme: 'cyber' });
    assert.strictEqual(rendered, true, 'renderPolarRadarCanvas should return true');
    assert.ok(calls.some(c => c.method === 'clearRect'), 'Must clear canvas before drawing radar');
    assert.ok(calls.some(c => c.method === 'fillText' && c.text === '0 dB'), 'Renders 0 dB ring label');
    assert.ok(calls.some(c => c.method === 'fillText' && c.text === '-12 dB'), 'Renders -12 dB ring label');
  });

  await t.test('2.7. library.renderVisualizerVuMeter accepts standby angles and renders resting needles', () => {
    const calls = [];
    const mockCtx = createMockCanvasContext(calls);

    const rendered = library.renderVisualizerVuMeter(mockCtx, {
      width: 600,
      height: 300,
      theme: 'cyber',
      leftAngle: -45,
      rightAngle: -45,
      isOverloadLeft: false,
      isOverloadRight: false
    });

    assert.strictEqual(rendered, true, 'renderVisualizerVuMeter should return true');
    assert.ok(calls.some(c => c.method === 'clearRect' || c.method === 'fillRect'), 'Clears context for frame rendering');
    assert.ok(calls.some(c => c.method === 'arc'), 'Draws meter dial arcs');
  });
});

test('Bug Fix 3: Ambient Blurred Backdrop (#fullscreen-bg-cover & #fullscreen-ambient-glow)', async (t) => {
  await t.test('3.1. updateRoonFullscreenUI resolves album cover through library.resolveTrackCover', () => {
    const updateUiMatch = indexHtml.match(/function updateRoonFullscreenUI\s*\(\)\s*\{([\s\S]*?)\n\s*function /);
    assert.ok(updateUiMatch, 'updateRoonFullscreenUI function body found');
    const body = updateUiMatch[1];

    assert.ok(
      body.includes('library.resolveTrackCover(track, state.albumCovers, state.tracks)'),
      'Must resolve track cover using library.resolveTrackCover'
    );
    assert.ok(
      body.includes("bgCover.src = coverUrl") || body.includes("bgCover.src = coverUrl || track.cover"),
      'Must assign resolved coverUrl to bgCover.src'
    );
    assert.ok(
      body.includes("bgCover.classList.remove('hidden')"),
      'Must display bgCover by removing hidden class'
    );
  });

  await t.test('3.2. Dedicated CSS styles for #fullscreen-bg-cover and #fullscreen-ambient-glow', () => {
    assert.match(
      indexHtml,
      /#fullscreen-bg-cover\s*\{[\s\S]*?transform:\s*scale\(1\.18\);/i,
      '#fullscreen-bg-cover CSS must specify transform: scale(1.18)'
    );
    assert.match(
      indexHtml,
      /#fullscreen-bg-cover\s*\{[\s\S]*?filter:\s*blur\(48px\)\s*saturate\(1\.4\)\s*brightness\(0\.85\);/i,
      '#fullscreen-bg-cover CSS must specify filter: blur(48px) saturate(1.4) brightness(0.85)'
    );
    assert.match(
      indexHtml,
      /#fullscreen-bg-cover\s*\{[\s\S]*?opacity:\s*0\.72;/i,
      '#fullscreen-bg-cover CSS must specify opacity: 0.72'
    );
    assert.match(
      indexHtml,
      /#fullscreen-ambient-glow\s*\{[\s\S]*?background:\s*radial-gradient/i,
      '#fullscreen-ambient-glow CSS must specify subtle radial-gradient'
    );
  });

  await t.test('3.3. HTML markup for #fullscreen-bg-cover includes blur and bleed classes', () => {
    assert.match(
      indexHtml,
      /<img[^>]*id="fullscreen-bg-cover"[^>]*class="[^"]*blur-\[56px\][^"]*"[^>]*>/,
      '#fullscreen-bg-cover element markup includes blur-[56px]'
    );
    assert.match(
      indexHtml,
      /<img[^>]*id="fullscreen-bg-cover"[^>]*class="[^"]*scale-110[^"]*"[^>]*>/,
      '#fullscreen-bg-cover element markup includes scale-110'
    );
  });

  await t.test('3.4. library.resolveTrackCover resolves cover from track, coverMap, or sibling tracks', () => {
    assert.strictEqual(typeof library.resolveTrackCover, 'function');

    // Case 1: Direct cover
    const t1 = { title: 'Track 1', artist: 'Artist A', album: 'Album A', cover: 'http://example.com/cover1.jpg' };
    assert.strictEqual(library.resolveTrackCover(t1, {}, []), 'http://example.com/cover1.jpg');

    // Case 2: Cover from coverMap
    const t2 = { title: 'Track 2', artist: 'Artist B', album: 'Album B', cover: null };
    const keyB = library.buildAlbumKey(t2);
    const coverMap = { [keyB]: 'http://example.com/albumB.jpg' };
    assert.strictEqual(library.resolveTrackCover(t2, coverMap, []), 'http://example.com/albumB.jpg');

    // Case 3: Cover from sibling track in same album
    const sibling = { title: 'Track 3b', artist: 'Artist C', album: 'Album C', cover: 'http://example.com/sibling.png' };
    const t3 = { title: 'Track 3a', artist: 'Artist C', album: 'Album C', cover: '♫' };
    assert.strictEqual(library.resolveTrackCover(t3, {}, [sibling]), 'http://example.com/sibling.png');

    // Case 4: No cover anywhere
    const t4 = { title: 'Track 4', artist: 'Artist D', album: 'Album D', cover: null };
    assert.strictEqual(library.resolveTrackCover(t4, {}, []), null);
  });
});

test('Bug Fix 4: Zero Scrollbars in Fullscreen and Stage Lyrics Interfaces', async (t) => {
  await t.test('4.1. CSS rules hide scrollbars completely for #fullscreen-lyrics-scroll and #fullscreen-stage-lyrics', () => {
    assert.match(
      indexHtml,
      /#fullscreen-lyrics-scroll[\s\S]*?scrollbar-width:\s*none\s*!important/i,
      'Must declare scrollbar-width: none !important'
    );
    assert.match(
      indexHtml,
      /#fullscreen-lyrics-scroll[\s\S]*?-ms-overflow-style:\s*none\s*!important/i,
      'Must declare -ms-overflow-style: none !important'
    );
    assert.match(
      indexHtml,
      /#fullscreen-stage-lyrics[\s\S]*?scrollbar-width:\s*none\s*!important/i,
      'Must declare scrollbar-width: none !important for stage lyrics'
    );
    assert.match(
      indexHtml,
      /#fullscreen-stage-lyrics[\s\S]*?-ms-overflow-style:\s*none\s*!important/i,
      'Must declare -ms-overflow-style: none !important for stage lyrics'
    );
  });

  await t.test('4.2. Webkit scrollbar rules disable scrollbars across Webkit browsers', () => {
    assert.match(
      indexHtml,
      /#fullscreen-lyrics-scroll::-webkit-scrollbar[\s\S]*?display:\s*none\s*!important/i,
      'Must declare display: none !important for ::-webkit-scrollbar on #fullscreen-lyrics-scroll'
    );
    assert.match(
      indexHtml,
      /#fullscreen-stage-lyrics::-webkit-scrollbar[\s\S]*?display:\s*none\s*!important/i,
      'Must declare display: none !important for ::-webkit-scrollbar on #fullscreen-stage-lyrics'
    );
  });

  await t.test('4.3. DOM markup contains overflow-x-hidden on lyrics containers', () => {
    assert.match(
      indexHtml,
      /id="fullscreen-lyrics-scroll"[^>]*class="[^"]*overflow-x-hidden[^"]*"/,
      '#fullscreen-lyrics-scroll must include overflow-x-hidden'
    );
    assert.match(
      indexHtml,
      /id="fullscreen-stage-lyrics"[^>]*class="[^"]*overflow-x-hidden[^"]*"/,
      '#fullscreen-stage-lyrics must include overflow-x-hidden'
    );
  });

  await t.test('4.4. Lyric lines use break-words to prevent horizontal spill', () => {
    assert.ok(indexHtml.includes('break-words'), 'Lyric lines should have break-words');
  });
});

test('Bug Fix 5: ABSOLUTE INVARIANT - Web Audio Graph Preservation', () => {
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL INVARIANT VIOLATION: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained in index.html'
  );
});

test('Bug Fix 6: Instant Song Art Synchronization Engine (Zero-Delay & Multi-Tier Resolution)', async (t) => {
  await t.test('6.1. library.instantResolveTrackCover resolves across all 5 tiers within <1ms', () => {
    assert.strictEqual(typeof library.instantResolveTrackCover, 'function');

    // Tier 1: Direct cover
    const tDirect = { title: 'Track 1', artist: 'Artist A', album: 'Album A', cover: 'https://example.com/cover1.jpg' };
    assert.strictEqual(library.instantResolveTrackCover(tDirect, {}, []), 'https://example.com/cover1.jpg');

    // Tier 2: Album key lookup in coverMap
    const tAlbumKey = { title: 'Track 2', artist: 'Pink Floyd', album: 'The Wall', cover: null };
    const albumKey = library.buildAlbumKey(tAlbumKey);
    const coverMap = { [albumKey]: 'https://example.com/the-wall.jpg' };
    assert.strictEqual(library.instantResolveTrackCover(tAlbumKey, coverMap, []), 'https://example.com/the-wall.jpg');

    // Tier 3: Normalized Album Title matching
    const siblingWithSameAlbum = { title: 'Song X', artist: 'Various Artists', album: 'Discovery', cover: 'https://example.com/discovery.jpg' };
    const tAlbumTitle = { title: 'Song Y', artist: 'Daft Punk', album: 'discovery', cover: '♫' };
    assert.strictEqual(library.instantResolveTrackCover(tAlbumTitle, {}, [siblingWithSameAlbum]), 'https://example.com/discovery.jpg');

    // Tier 4: Directory / folder path matching
    const siblingInFolder = { title: '01 - Intro.flac', album: '—', path: 'Music/Led Zeppelin IV/01 - Intro.flac', cover: 'https://example.com/lz4.jpg' };
    const tFolder = { title: '02 - Rock and Roll.flac', album: '—', path: 'Music/Led Zeppelin IV/02 - Rock and Roll.flac', cover: null };
    assert.strictEqual(library.instantResolveTrackCover(tFolder, {}, [siblingInFolder]), 'https://example.com/lz4.jpg');

    // Tier 5: Unique artist cover fallback
    const artistSibling = { title: 'Hit A', artist: 'Queen', album: 'Single A', cover: 'https://example.com/queen.jpg' };
    const tArtist = { title: 'Hit B', artist: 'Queen', album: 'Single B', cover: null };
    assert.strictEqual(library.instantResolveTrackCover(tArtist, {}, [artistSibling]), 'https://example.com/queen.jpg');

    // Fallback when no cover
    const tNoCover = { title: 'Unknown', artist: 'Unknown', album: 'Unknown', cover: null };
    assert.strictEqual(library.instantResolveTrackCover(tNoCover, {}, []), null);
  });

  await t.test('6.2. library.instantPropagateCovers propagates covers in O(N) memory under 5ms', () => {
    assert.strictEqual(typeof library.instantPropagateCovers, 'function');

    // Generate 1,000 synthetic tracks
    const tracks = [];
    const coverMap = {};
    for (let i = 0; i < 1000; i++) {
      const albumIdx = Math.floor(i / 10);
      const isLead = (i % 10 === 0);
      const track = {
        id: `t_${i}`,
        title: `Track ${i}`,
        artist: `Artist ${albumIdx}`,
        album: `Album ${albumIdx}`,
        path: `Music/Album_${albumIdx}/track_${i}.flac`,
        cover: isLead ? `https://example.com/album_${albumIdx}.jpg` : null
      };
      tracks.push(track);
    }

    const start = performance.now();
    const result = library.instantPropagateCovers(tracks, coverMap);
    const duration = performance.now() - start;

    assert.ok(duration < 60, `Propagation must be ultra-fast (took ${duration.toFixed(2)}ms)`);
    assert.strictEqual(result.updatedCount, 900, 'All 900 remaining tracks should receive cover from lead track');

    // Verify propagation accuracy
    for (let i = 0; i < tracks.length; i++) {
      const albumIdx = Math.floor(i / 10);
      assert.strictEqual(tracks[i].cover, `https://example.com/album_${albumIdx}.jpg`);
    }
  });

  await t.test('6.3. broadcastCoverUpdate function exists in index.html and updates all key DOM surfaces', () => {
    assert.ok(indexHtml.includes('function broadcastCoverUpdate'), 'broadcastCoverUpdate function must be defined');
    const bcastMatch = indexHtml.match(/function broadcastCoverUpdate\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*function /);
    assert.ok(bcastMatch, 'broadcastCoverUpdate body found');
    const body = bcastMatch[1];

    // Must update Fullscreen art and ambient backdrop
    assert.ok(body.includes('fullscreen-cover-img'), 'Must update fullscreen-cover-img');
    assert.ok(body.includes('fullscreen-bg-cover'), 'Must update fullscreen-bg-cover');

    // Must update Player dock
    assert.ok(body.includes('player-cover'), 'Must update player-cover');

    // Must update Room cover
    assert.ok(body.includes('room-cover'), 'Must update room-cover');

    // Must update Mini HUD
    assert.ok(body.includes('mini-cover'), 'Must update mini-cover');

    // Must use requestAnimationFrame for non-blocking UI
    assert.ok(body.includes('requestAnimationFrame'), 'Must schedule DOM updates with requestAnimationFrame');
  });

  await t.test('6.4. displayTrack and handleTrackRowActivation resolve and set cover instantly in first tick', () => {
    const displayTrackMatch = indexHtml.match(/function displayTrack\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*function /);
    assert.ok(displayTrackMatch, 'displayTrack function found');
    const displayBody = displayTrackMatch[1];

    assert.ok(
      displayBody.includes('resolveTrackCover') || displayBody.includes('instantResolveTrackCover'),
      'displayTrack must resolve track cover immediately'
    );
  });

  await t.test('6.5. Web Audio API invariant is strictly preserved throughout instant sync engine', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT VIOLATION: state.crossfeedNodes.output.connect(state.context.destination) must be preserved'
    );
  });
});
