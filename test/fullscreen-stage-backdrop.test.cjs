'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Pha C: Ambient Blurred Backdrop Specifications', async (t) => {
  await t.test('1. #fullscreen-bg-cover has vivid blurred backdrop classes', () => {
    assert.ok(indexHtml.includes('id="fullscreen-bg-cover"'), 'fullscreen-bg-cover element must exist');
    assert.ok(indexHtml.includes('blur-[56px]'), 'Must include blur-[56px] filter');
    assert.ok(indexHtml.includes('scale-110'), 'Must include scale-110 for edge bleed coverage');
    assert.ok(indexHtml.includes('opacity-75'), 'Must include opacity-75 for vivid glow');
    assert.ok(indexHtml.includes('brightness-95'), 'Must include brightness-95');
    assert.ok(indexHtml.includes('saturate-150'), 'Must include saturate-150');
    assert.ok(indexHtml.includes('duration-700 ease-out'), 'Must include smooth transition duration-700 ease-out');
  });

  await t.test('2. #fullscreen-ambient-glow provides elegant subtle vignette', () => {
    assert.ok(indexHtml.includes('id="fullscreen-ambient-glow"'), 'fullscreen-ambient-glow element must exist');
    assert.ok(
      indexHtml.includes('from-black/40') && indexHtml.includes('via-transparent') && indexHtml.includes('to-black/80'),
      'Must include vignette gradient from-black/40 via-transparent to-black/80'
    );
  });

  await t.test('3. updateRoonFullscreenUI updates and displays backdrop for art and lyrics tabs', () => {
    assert.ok(indexHtml.includes('updateRoonFullscreenUI'), 'updateRoonFullscreenUI function must exist');
    const updateUiMatch = indexHtml.match(/function updateRoonFullscreenUI\s*\(\)\s*\{([\s\S]*?)\n\s*function /);
    assert.ok(updateUiMatch, 'updateRoonFullscreenUI function body found');
    const body = updateUiMatch[1];
    assert.ok(body.includes('fullscreen-bg-cover'), 'Must reference fullscreen-bg-cover');
    assert.ok(body.includes('bgCover.src = track.cover'), 'Must set bgCover.src when track.cover is present');
    assert.ok(body.includes("bgCover.classList.remove('hidden')"), 'Must reveal bgCover when cover is present');
    assert.ok(body.includes("bgCover.classList.add('hidden')"), 'Must hide bgCover when cover is absent');
  });
});

test('Pha C: Fullscreen 3D Stage Visualizers & Loop Independence', async (t) => {
  await t.test('1. setVisualizerRunning decouples fullscreen stage render loop from footer dimensions', () => {
    const setVisMatch = indexHtml.match(/function setVisualizerRunning\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*let volumeBeforeMute/);
    assert.ok(setVisMatch, 'setVisualizerRunning function body found');
    const visBody = setVisMatch[1];

    // Must not bail out early when in fullscreen stage mode even if footer visualizer has 0 width/height
    assert.ok(
      visBody.includes('isStageActive') || visBody.includes("state.fullscreenViewMode === 'stage'"),
      'setVisualizerRunning must evaluate whether stage mode is active'
    );
    assert.ok(
      visBody.includes('hasFooterVisualizer') || visBody.includes('canvas.clientWidth'),
      'setVisualizerRunning tracks footer visualizer dimensions without blocking stage loop'
    );
  });

  await t.test('2. All 3 stage modes (Radar 3D, VU Meter, Goniometer 3D) are supported in render loop', () => {
    assert.ok(indexHtml.includes('library.renderPolarRadarCanvas'), 'Radar 3D renders using library.renderPolarRadarCanvas');
    assert.ok(indexHtml.includes('library.renderVisualizerVuMeter'), 'VU Meter renders using library.renderVisualizerVuMeter');
    assert.ok(indexHtml.includes('library.renderSpatialVectorCanvas'), 'Goniometer 3D renders using library.renderSpatialVectorCanvas');
  });

  await t.test('3. setFullscreenViewMode(\'stage\') activates visualizer and handles canvas resizing with DPR', () => {
    const modeMatch = indexHtml.match(/function setFullscreenViewMode\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*function /);
    assert.ok(modeMatch, 'setFullscreenViewMode function body found');
    const modeBody = modeMatch[1];
    assert.ok(
      modeBody.includes('setVisualizerRunning'),
      'setFullscreenViewMode must invoke setVisualizerRunning'
    );
    assert.ok(
      modeBody.includes('resizeFullscreenStageCanvas'),
      'setFullscreenViewMode must invoke resizeFullscreenStageCanvas'
    );
  });

  await t.test('4. Fullscreen stage buttons switch mode and trigger visualizer via setFullscreenStageMode', () => {
    assert.ok(indexHtml.includes('fs-stage-mode-radar'), 'Radar 3D button exists');
    assert.ok(indexHtml.includes('fs-stage-mode-vu'), 'VU Meter button exists');
    assert.ok(indexHtml.includes('fs-stage-mode-vector'), 'Goniometer 3D button exists');
    assert.ok(indexHtml.includes('function setFullscreenStageMode'), 'setFullscreenStageMode function exists');
    assert.ok(indexHtml.includes('function resizeFullscreenStageCanvas'), 'resizeFullscreenStageCanvas helper exists');
    assert.ok(indexHtml.includes('window.setFullscreenStageMode = setFullscreenStageMode'), 'Exposed to window');
  });

  await t.test('5. resizeFullscreenStageCanvas correctly accounts for devicePixelRatio', () => {
    const resizeMatch = indexHtml.match(/function resizeFullscreenStageCanvas\s*\(\)\s*\{([\s\S]*?)\n\s*function /);
    assert.ok(resizeMatch, 'resizeFullscreenStageCanvas function body found');
    const resizeBody = resizeMatch[1];
    assert.ok(resizeBody.includes('devicePixelRatio'), 'Must use devicePixelRatio for sharp HiDPI rendering');
    assert.ok(resizeBody.includes('clientWidth'), 'Must read canvas clientWidth');
    assert.ok(resizeBody.includes('clientHeight'), 'Must read canvas clientHeight');
  });
});

test('Pha C: Web Audio Graph Invariant Preservation', () => {
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
  );
});
