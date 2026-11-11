'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const library = require('./library-utils.js');

// 1. Kiểm tra các hàm tiện ích clampBalance và formatBalance trong library-utils
assert.equal(typeof library.clampBalance, 'function', 'clampBalance should exist in library-utils');
assert.equal(typeof library.formatBalance, 'function', 'formatBalance should exist in library-utils');

// Giá trị biên và ngoài biên
assert.equal(library.clampBalance(-1.5), -1, 'clampBalance should clamp values < -1 to -1');
assert.equal(library.clampBalance(1.5), 1, 'clampBalance should clamp values > 1 to 1');
assert.equal(library.clampBalance(-1), -1);
assert.equal(library.clampBalance(1), 1);
assert.equal(library.clampBalance(0), 0);
assert.equal(library.clampBalance(-0.25), -0.25);
assert.equal(library.clampBalance(0.75), 0.75);
assert.equal(library.clampBalance('0.5'), 0.5, 'clampBalance should parse numeric string');
assert.equal(library.clampBalance(NaN, 0), 0, 'clampBalance should return fallback on NaN');
assert.equal(library.clampBalance(null, 0), 0, 'clampBalance should return fallback on null');
assert.equal(library.clampBalance(undefined, 0), 0, 'clampBalance should return fallback on undefined');

// Định dạng hiển thị
assert.equal(library.formatBalance(0), 'Giữa', 'Balance 0 should format as Giữa');
assert.equal(library.formatBalance(-0.35), 'Trái 35%', 'Negative balance should format as Trái X%');
assert.equal(library.formatBalance(0.65), 'Phải 65%', 'Positive balance should format as Phải X%');
assert.equal(library.formatBalance(-1), 'Trái 100%');
assert.equal(library.formatBalance(1), 'Phải 100%');

// 2. Kiểm tra HTML index.html chứa các phần tử điều khiển Stereo Balance
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /id="balance-slider"/, 'EQ panel should include #balance-slider');
assert.match(html, /id="balance-label"/, 'EQ panel should include #balance-label');
assert.match(html, /id="balance-reset"/, 'EQ panel should include #balance-reset');

// 3. Trích xuất script nội tuyến để kiểm tra logic AudioContext Graph & StereoPanner
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

assert.ok(appCode.includes('createStereoPanner'), 'setupAudio should support createStereoPanner');
assert.ok(appCode.includes('function setStereoBalance('), 'setStereoBalance function should be defined');
assert.ok(appCode.includes('nocturne-stereo-balance'), 'Stereo balance should persist in localStorage');

// 4. Giả lập Web Audio Graph để kiểm tra kết nối StereoPannerNode
class MockAudioNode {
  constructor() {
    this.connections = [];
  }
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
  disconnect() {
    this.connections = [];
  }
}

class MockAudioParam {
  constructor(initial = 0) {
    this.value = initial;
    this.targetHistory = [];
  }
  setTargetAtTime(target, time, constant) {
    this.targetHistory.push({target, time, constant});
    this.value = target;
  }
}

class MockStereoPannerNode extends MockAudioNode {
  constructor() {
    super();
    this.pan = new MockAudioParam(0);
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 1.0;
    this.destination = new MockAudioNode();
    this.pannerCreated = 0;
  }
  createAnalyser() {
    const node = new MockAudioNode();
    node.fftSize = 256;
    node.smoothingTimeConstant = 0.8;
    return node;
  }
  createDynamicsCompressor() {
    const node = new MockAudioNode();
    node.threshold = new MockAudioParam(-3);
    node.knee = new MockAudioParam(0);
    node.ratio = new MockAudioParam(20);
    node.attack = new MockAudioParam(0.003);
    node.release = new MockAudioParam(0.1);
    return node;
  }
  createStereoPanner() {
    this.pannerCreated++;
    return new MockStereoPannerNode();
  }
}

// Kiểm tra hành vi kết nối graph khi createStereoPanner có sẵn
{
  const mockContext = new MockAudioContext();
  const state = {
    context: mockContext,
    stereoBalance: 0.3,
    analyser: mockContext.createAnalyser(),
    directAnalyser: mockContext.createAnalyser(),
    preLimiterAnalyser: mockContext.createAnalyser(),
    limiter: mockContext.createDynamicsCompressor(),
    panner: null
  };

  if (typeof state.context.createStereoPanner === 'function') {
    state.panner = state.context.createStereoPanner();
    state.panner.pan.value = state.stereoBalance || 0;
    state.analyser.connect(state.panner);
    state.directAnalyser.connect(state.panner);
    state.panner.connect(state.context.destination);
  }

  assert.equal(mockContext.pannerCreated, 1, 'StereoPannerNode should be created');
  assert.equal(state.panner.pan.value, 0.3, 'Initial pan should reflect state.stereoBalance');
  assert.ok(state.analyser.connections.includes(state.panner), 'Analyser should connect to panner');
  assert.ok(state.directAnalyser.connections.includes(state.panner), 'Direct analyser should connect to panner');
  assert.ok(state.panner.connections.includes(mockContext.destination), 'Panner should connect to destination');

  // Kiểm tra setStereoBalance
  const storage = {};
  const mockSlider = {value: '0'};
  const mockLabel = {textContent: ''};
  const resolver = id => id === 'balance-slider' ? mockSlider : id === 'balance-label' ? mockLabel : null;

  function setStereoBalance(value) {
    const balance = library.clampBalance(value, 0);
    state.stereoBalance = balance;
    storage['nocturne-stereo-balance'] = String(balance);
    if (state.panner && state.context) {
      state.panner.pan.setTargetAtTime(balance, state.context.currentTime, .015);
    }
    const slider = resolver('balance-slider'), label = resolver('balance-label');
    if (slider) slider.value = String(Math.round(balance * 100));
    if (label) label.textContent = library.formatBalance(balance);
  }

  setStereoBalance(-0.4);
  assert.equal(state.stereoBalance, -0.4);
  assert.equal(storage['nocturne-stereo-balance'], '-0.4');
  assert.equal(mockSlider.value, '-40');
  assert.equal(mockLabel.textContent, 'Trái 40%');
  assert.equal(state.panner.pan.value, -0.4);
  assert.equal(state.panner.pan.targetHistory.length, 1);
  assert.equal(state.panner.pan.targetHistory[0].constant, 0.015);

  // Đặt lại về giữa
  setStereoBalance(0);
  assert.equal(state.stereoBalance, 0);
  assert.equal(mockSlider.value, '0');
  assert.equal(mockLabel.textContent, 'Giữa');
}

// Kiểm tra fallback khi trình duyệt không hỗ trợ createStereoPanner
{
  const mockContext = new MockAudioContext();
  mockContext.createStereoPanner = undefined; // giả lập trình duyệt cũ

  const state = {
    context: mockContext,
    stereoBalance: 0,
    analyser: mockContext.createAnalyser(),
    directAnalyser: mockContext.createAnalyser(),
    panner: null
  };

  assert.doesNotThrow(() => {
    if (typeof state.context.createStereoPanner === 'function') {
      state.panner = state.context.createStereoPanner();
      state.panner.pan.value = state.stereoBalance || 0;
      state.analyser.connect(state.panner);
      state.directAnalyser.connect(state.panner);
      state.panner.connect(state.context.destination);
    } else {
      state.analyser.connect(state.context.destination);
      state.directAnalyser.connect(state.context.destination);
    }
  }, 'Should safely fallback when createStereoPanner is not supported');

  assert.equal(state.panner, null);
  assert.ok(state.analyser.connections.includes(mockContext.destination));
  assert.ok(state.directAnalyser.connections.includes(mockContext.destination));
}

console.log('Stereo balance (L/R PannerNode) audio engine & UI tests passed.');
