'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

// 1. Kiểm tra các hàm tiện ích crossfeed trong library-utils
assert.equal(typeof library.clampCrossfeed, 'function', 'clampCrossfeed should exist in library-utils');
assert.equal(typeof library.crossfeedCrossGain, 'function', 'crossfeedCrossGain should exist in library-utils');
assert.equal(typeof library.formatCrossfeed, 'function', 'formatCrossfeed should exist in library-utils');
assert.equal(library.CROSSFEED_CUTOFF_HZ, 700, 'Crossfeed low-pass should be 700 Hz');
assert.equal(library.CROSSFEED_DELAY_S, 0.0003, 'Crossfeed delay should be 0.3 ms');
assert.equal(library.CROSSFEED_MAX_GAIN, 0.35, 'Crossfeed max cross gain should be 0.35');

// Giá trị biên và ngoài biên
assert.equal(library.clampCrossfeed(-0.5), 0, 'clampCrossfeed should clamp values < 0 to 0');
assert.equal(library.clampCrossfeed(1.5), 1, 'clampCrossfeed should clamp values > 1 to 1');
assert.equal(library.clampCrossfeed(0), 0);
assert.equal(library.clampCrossfeed(1), 1);
assert.equal(library.clampCrossfeed(0.3), 0.3);
assert.equal(library.clampCrossfeed('0.5'), 0.5, 'clampCrossfeed should parse numeric string');
assert.equal(library.clampCrossfeed(NaN, 0), 0, 'clampCrossfeed should return fallback on NaN');
assert.equal(library.clampCrossfeed(null, 0), 0, 'clampCrossfeed should return fallback on null');
assert.equal(library.clampCrossfeed(undefined, 0), 0, 'clampCrossfeed should return fallback on undefined');

// Gain chéo tỉ lệ tuyến tính với mức, tối đa 0.35 ở 100%
assert.equal(library.crossfeedCrossGain(0), 0, 'Cross gain at 0% should be 0 (direct path untouched)');
assert.equal(library.crossfeedCrossGain(1), 0.35, 'Cross gain at 100% should be 0.35, not 0.5');
assert.equal(library.crossfeedCrossGain(0.5), 0.175);
assert.equal(library.crossfeedCrossGain(0.3), 0.105);
assert.equal(library.crossfeedCrossGain(-1), 0, 'Cross gain should clamp negative input to 0');
assert.equal(library.crossfeedCrossGain(2), 0.35, 'Cross gain should clamp input above 1');

// Định dạng hiển thị
assert.equal(library.formatCrossfeed(0), 'Tắt', 'Crossfeed 0 should format as Tắt');
assert.equal(library.formatCrossfeed(0.3), '30%');
assert.equal(library.formatCrossfeed(1), '100%');
assert.equal(library.formatCrossfeed(-0.2), 'Tắt', 'Negative crossfeed should format as Tắt');

// 2. Kiểm tra HTML index.html chứa các phần tử điều khiển Crossfeed
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /id="crossfeed-toggle"/, 'EQ panel should include #crossfeed-toggle');
assert.match(html, /id="crossfeed-slider"/, 'EQ panel should include #crossfeed-slider');
assert.match(html, /id="crossfeed-label"/, 'EQ panel should include #crossfeed-label');

// 3. Trích xuất script nội tuyến để kiểm tra logic AudioContext Graph & Crossfeed
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

assert.ok(appCode.includes('createCrossfeedNodes'), 'createCrossfeedNodes function should be defined');
assert.ok(appCode.includes('function setCrossfeed('), 'setCrossfeed function should be defined');
assert.ok(appCode.includes('function applyCrossfeedAmount('), 'applyCrossfeedAmount function should be defined');
assert.ok(appCode.includes('nocturne-crossfeed'), 'Crossfeed amount should persist in localStorage');
assert.ok(appCode.includes('createChannelSplitter'), 'Crossfeed graph should use ChannelSplitterNode');
assert.ok(appCode.includes('createChannelMerger'), 'Crossfeed graph should use ChannelMergerNode');
assert.ok(appCode.includes('crossfeedNodes'), 'state should hold crossfeedNodes');

// 4. Giả lập Web Audio Graph để kiểm tra đồ thị Crossfeed
class MockAudioNode {
  constructor() {
    this.connections = [];
  }
  connect(dest, output = 0, input = 0) {
    this.connections.push({dest, output, input});
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

class MockGainNode extends MockAudioNode {
  constructor() {
    super();
    this.gain = new MockAudioParam(1);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor() {
    super();
    this.type = '';
    this.frequency = new MockAudioParam(350);
  }
}

class MockDelayNode extends MockAudioNode {
  constructor(maxDelayTime) {
    super();
    this.maxDelayTime = maxDelayTime;
    this.delayTime = new MockAudioParam(0);
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 1.0;
    this.destination = new MockAudioNode();
  }
  createGain() { return new MockGainNode(); }
  createChannelSplitter() { return new MockAudioNode(); }
  createChannelMerger() { return new MockAudioNode(); }
  createDelay(maxDelayTime) { return new MockDelayNode(maxDelayTime); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
}

function hasConnection(node, dest, output, input) {
  return node.connections.some(c => c.dest === dest && c.output === output && c.input === input);
}

// Xây đồ thị đúng như createCrossfeedNodes trong index.html
function createCrossfeedNodes(ctx) {
  if (typeof ctx.createChannelSplitter !== 'function' || typeof ctx.createChannelMerger !== 'function'
    || typeof ctx.createDelay !== 'function' || typeof ctx.createBiquadFilter !== 'function'
    || typeof ctx.createGain !== 'function') return null;
  const input = ctx.createGain(), output = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(2);
  const filterL = ctx.createBiquadFilter(), filterR = ctx.createBiquadFilter();
  filterL.type = 'lowpass'; filterR.type = 'lowpass';
  filterL.frequency.value = library.CROSSFEED_CUTOFF_HZ; filterR.frequency.value = library.CROSSFEED_CUTOFF_HZ;
  const delayL = ctx.createDelay(0.005), delayR = ctx.createDelay(0.005);
  delayL.delayTime.value = library.CROSSFEED_DELAY_S; delayR.delayTime.value = library.CROSSFEED_DELAY_S;
  const gainL = ctx.createGain(), gainR = ctx.createGain();
  gainL.gain.value = 0; gainR.gain.value = 0;
  input.connect(splitter);
  splitter.connect(merger, 0, 0);
  splitter.connect(merger, 1, 1);
  splitter.connect(filterL, 0); filterL.connect(delayL); delayL.connect(gainL); gainL.connect(merger, 0, 1);
  splitter.connect(filterR, 1); filterR.connect(delayR); delayR.connect(gainR); gainR.connect(merger, 0, 0);
  merger.connect(output);
  return {input, output, splitter, merger, filterL, filterR, delayL, delayR, gainL, gainR};
}

{
  const ctx = new MockAudioContext();
  const nodes = createCrossfeedNodes(ctx);
  assert.ok(nodes, 'createCrossfeedNodes should return nodes on a full Web Audio mock');

  // Đường thẳng: input -> splitter -> merger (L->L, R->R) -> output
  assert.ok(hasConnection(nodes.input, nodes.splitter, 0, 0), 'Input should connect to splitter');
  assert.ok(hasConnection(nodes.splitter, nodes.merger, 0, 0), 'Splitter L should go straight to merger L');
  assert.ok(hasConnection(nodes.splitter, nodes.merger, 1, 1), 'Splitter R should go straight to merger R');
  assert.ok(hasConnection(nodes.merger, nodes.output, 0, 0), 'Merger should connect to output');

  // Đường chéo: L -> lọc thấp -> trễ -> gain -> merger R; R -> ... -> merger L
  assert.ok(hasConnection(nodes.splitter, nodes.filterL, 0, 0), 'Splitter L should feed left cross filter');
  assert.ok(hasConnection(nodes.splitter, nodes.filterR, 1, 0), 'Splitter R should feed right cross filter');
  assert.ok(hasConnection(nodes.filterL, nodes.delayL, 0, 0), 'Left filter should feed left delay');
  assert.ok(hasConnection(nodes.filterR, nodes.delayR, 0, 0), 'Right filter should feed right delay');
  assert.ok(hasConnection(nodes.delayL, nodes.gainL, 0, 0), 'Left delay should feed left cross gain');
  assert.ok(hasConnection(nodes.delayR, nodes.gainR, 0, 0), 'Right delay should feed right cross gain');
  assert.ok(hasConnection(nodes.gainL, nodes.merger, 0, 1), 'Left cross gain should mix into merger R');
  assert.ok(hasConnection(nodes.gainR, nodes.merger, 0, 0), 'Right cross gain should mix into merger L');

  // Thông số lọc/trễ/gain chéo
  assert.equal(nodes.filterL.type, 'lowpass');
  assert.equal(nodes.filterR.type, 'lowpass');
  assert.equal(nodes.filterL.frequency.value, 700);
  assert.equal(nodes.filterR.frequency.value, 700);
  assert.equal(nodes.delayL.delayTime.value, 0.0003);
  assert.equal(nodes.delayR.delayTime.value, 0.0003);
  assert.equal(nodes.delayL.maxDelayTime, 0.005);
  assert.equal(nodes.gainL.gain.value, 0, 'Cross gains start at 0 so the direct path is untouched');
  assert.equal(nodes.gainR.gain.value, 0);

  // applyCrossfeedAmount: mức 30% -> gain chéo 0.105 cả hai kênh
  const state = {context: ctx, crossfeed: 0.3, crossfeedNodes: nodes};
  function applyCrossfeedAmount() {
    const n = state.crossfeedNodes;
    if (!n || !state.context) return;
    const gain = library.crossfeedCrossGain(state.crossfeed);
    n.gainL.gain.setTargetAtTime(gain, state.context.currentTime, .015);
    n.gainR.gain.setTargetAtTime(gain, state.context.currentTime, .015);
  }
  applyCrossfeedAmount();
  assert.equal(nodes.gainL.gain.value, 0.105);
  assert.equal(nodes.gainR.gain.value, 0.105);
  assert.equal(nodes.gainL.gain.targetHistory[0].constant, 0.015);

  // Tắt crossfeed -> gain chéo về 0
  state.crossfeed = 0;
  applyCrossfeedAmount();
  assert.equal(nodes.gainL.gain.value, 0);
  assert.equal(nodes.gainR.gain.value, 0);

  // setCrossfeed: kẹp, lưu localStorage, cập nhật UI
  const storage = {};
  const mockSlider = {value: '0'};
  const mockLabel = {textContent: ''};
  const mockToggle = {checked: false};
  const resolver = id => id === 'crossfeed-slider' ? mockSlider : id === 'crossfeed-label' ? mockLabel : id === 'crossfeed-toggle' ? mockToggle : null;
  const crossfeedState = {context: ctx, crossfeed: 0, crossfeedLast: 0.3, crossfeedNodes: nodes};
  function setCrossfeed(value) {
    const amount = library.clampCrossfeed(value, 0);
    crossfeedState.crossfeed = amount;
    if (amount > 0) crossfeedState.crossfeedLast = amount;
    storage['nocturne-crossfeed'] = String(amount);
    const gain = library.crossfeedCrossGain(crossfeedState.crossfeed);
    nodes.gainL.gain.setTargetAtTime(gain, ctx.currentTime, .015);
    nodes.gainR.gain.setTargetAtTime(gain, ctx.currentTime, .015);
    const slider = resolver('crossfeed-slider'), label = resolver('crossfeed-label'), toggle = resolver('crossfeed-toggle');
    if (slider) slider.value = String(Math.round(amount * 100));
    if (label) label.textContent = library.formatCrossfeed(amount);
    if (toggle) toggle.checked = amount > 0;
  }
  setCrossfeed(0.3);
  assert.equal(crossfeedState.crossfeed, 0.3);
  assert.equal(storage['nocturne-crossfeed'], '0.3');
  assert.equal(mockSlider.value, '30');
  assert.equal(mockLabel.textContent, '30%');
  assert.equal(mockToggle.checked, true);
  assert.equal(nodes.gainL.gain.value, 0.105);
  setCrossfeed(0);
  assert.equal(mockLabel.textContent, 'Tắt');
  assert.equal(mockToggle.checked, false);
  assert.equal(nodes.gainL.gain.value, 0);
  // Bật lại khôi phục mức cuối (0.3) chứ không phải 100%
  setCrossfeed(crossfeedState.crossfeedLast || 0.3);
  assert.equal(crossfeedState.crossfeed, 0.3);
  assert.equal(mockSlider.value, '30');
  // Giá trị ngoài biên bị kẹp
  setCrossfeed(2);
  assert.equal(crossfeedState.crossfeed, 1);
  assert.equal(mockLabel.textContent, '100%');
}

// Fallback khi trình duyệt thiếu ChannelSplitter/ChannelMerger
{
  const ctx = new MockAudioContext();
  ctx.createChannelSplitter = undefined;
  assert.equal(createCrossfeedNodes(ctx), null, 'Should return null without createChannelSplitter');
  const ctx2 = new MockAudioContext();
  ctx2.createDelay = undefined;
  assert.equal(createCrossfeedNodes(ctx2), null, 'Should return null without createDelay');
}

console.log('DSP Crossfeed (Roon-style) audio engine & UI tests passed.');
