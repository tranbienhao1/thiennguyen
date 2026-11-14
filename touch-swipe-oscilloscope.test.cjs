const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryPath = path.join(__dirname, 'library-utils.js');
const library = require(libraryPath);

test('Pha B: calculateSwipeGesture detects accurate swipe direction and velocity', () => {
  // 1. Horizontal swipe left (Next track)
  const leftSwipe = library.calculateSwipeGesture(200, 100, 80, 105, 180);
  assert.equal(leftSwipe.direction, 'swipe_left');
  assert.equal(leftSwipe.isValidSwipe, true);
  assert.equal(leftSwipe.deltaX, -120);
  assert.ok(leftSwipe.velocity > 0.5);

  // 2. Horizontal swipe right (Previous track)
  const rightSwipe = library.calculateSwipeGesture(50, 120, 190, 125, 200);
  assert.equal(rightSwipe.direction, 'swipe_right');
  assert.equal(rightSwipe.isValidSwipe, true);
  assert.equal(rightSwipe.deltaX, 140);

  // 3. Vertical pull down (Dismiss modal)
  const downSwipe = library.calculateSwipeGesture(100, 50, 105, 180, 220);
  assert.equal(downSwipe.direction, 'swipe_down');
  assert.equal(downSwipe.isValidSwipe, true);
  assert.equal(downSwipe.deltaY, 130);

  // 4. Vertical swipe up
  const upSwipe = library.calculateSwipeGesture(100, 200, 102, 70, 200);
  assert.equal(upSwipe.direction, 'swipe_up');
  assert.equal(upSwipe.isValidSwipe, true);
  assert.equal(upSwipe.deltaY, -130);

  // 5. Ineffective / jitter / tap gesture below threshold
  const tap = library.calculateSwipeGesture(100, 100, 105, 102, 100);
  assert.equal(tap.direction, 'none');
  assert.equal(tap.isValidSwipe, false);

  // 6. Conflicting diagonal gesture exceeding cross-axis allowance
  const diagonal = library.calculateSwipeGesture(50, 50, 150, 160, 200);
  assert.equal(diagonal.direction, 'none');
  assert.equal(diagonal.isValidSwipe, false);
});

test('Pha B: calculateSpringTransform generates smooth damped physics values', () => {
  // Horizontal drag
  const springX = library.calculateSpringTransform(-80, 10, true, 160);
  assert.ok(springX.translateX < 0);
  assert.ok(springX.scale < 1.0 && springX.scale >= 0.9);
  assert.ok(springX.opacity < 1.0 && springX.opacity >= 0.4);
  assert.ok(springX.rotateDeg < 0);
  assert.ok(springX.cssTransform.includes('translate3d('));
  assert.ok(springX.cssTransform.includes('scale('));
  assert.ok(springX.cssTransform.includes('rotate('));

  // Vertical drag
  const springY = library.calculateSpringTransform(5, 75, false, 160);
  assert.equal(springY.translateX, 0);
  assert.ok(springY.translateY > 0);
  assert.ok(springY.scale < 1.0);
  assert.ok(springY.opacity < 1.0);
  assert.ok(springY.cssTransform.includes('translate3d(0,'));
});

test('Pha B: formatSwipeHint renders descriptive audiophile feedback strings', () => {
  assert.equal(library.formatSwipeHint('swipe_left'), 'Chuyển sang bài tiếp theo ➔');
  assert.equal(library.formatSwipeHint('swipe_right'), 'Quay lại bài trước ‹');
  assert.equal(library.formatSwipeHint('swipe_down'), 'Đóng màn hình ✕');
  assert.equal(library.formatSwipeHint('swipe_up'), 'Mở toàn màn hình ⛶');
  assert.equal(library.formatSwipeHint('none'), '');
  assert.equal(library.formatSwipeHint(null), '');
});

test('Pha B: renderVisualizerOscilloscope renders time-domain audio wave onto canvas', () => {
  const drawCalls = { moveTo: 0, lineTo: 0, stroke: 0, beginPath: 0 };
  const mockContext = {
    lineWidth: 1,
    strokeStyle: '',
    lineCap: '',
    lineJoin: '',
    shadowBlur: 0,
    shadowColor: '',
    beginPath() { drawCalls.beginPath++; },
    moveTo(x, y) { drawCalls.moveTo++; },
    lineTo(x, y) { drawCalls.lineTo++; },
    stroke() { drawCalls.stroke++; },
    createLinearGradient() {
      return { addColorStop() {} };
    }
  };

  const sampleTimeData = new Uint8Array([128, 140, 160, 200, 128, 80, 50, 128]);
  const rendered = library.renderVisualizerOscilloscope(mockContext, {
    data: sampleTimeData,
    width: 200,
    height: 80,
    theme: 'cyber',
    showCenterLine: true,
    strokeWidth: 2
  });

  assert.equal(rendered, true);
  assert.ok(drawCalls.beginPath >= 1);
  assert.ok(drawCalls.moveTo >= 1);
  assert.ok(drawCalls.lineTo >= 7);
  assert.ok(drawCalls.stroke >= 1);

  // Invalid cases
  assert.equal(library.renderVisualizerOscilloscope(null), false);
  assert.equal(library.renderVisualizerOscilloscope(mockContext, { width: 0, height: 80 }), false);
  assert.equal(library.renderVisualizerOscilloscope(mockContext, { width: 200, height: 80, data: [] }), false);
});

test('Pha B & Audio Engine Invariant: AudioContext Graph Invariant Preservation', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL: AudioContext Graph invariant must remain intact!'
  );
  assert.ok(
    indexHtml.includes('calculateSwipeGesture') || indexHtml.includes('attachTouchSwipe'),
    'Touch swipe integration must be present in index.html'
  );
  assert.ok(
    indexHtml.includes('renderVisualizerOscilloscope'),
    'Oscilloscope visualizer mode must be wired in index.html'
  );
});
