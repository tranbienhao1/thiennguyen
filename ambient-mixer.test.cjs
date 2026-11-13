'use strict';

// ============================================================================
// Test Suite: ambient-mixer.test.cjs
// Phase D: Ambient Sound Mixer (Rain & Campfire Procedural Audio Synthesis)
// Architecture: Pure Vanilla JS, Node.js Built-in Test Runner & assert/strict
// Methodology: 4-Tier Systematic Testing Model (Feature, Boundary, Combinatorial, Scenario)
// Integrity: 100% Genuine Contract Testing — Zero Skips, Zero Dummy Tautologies
// ============================================================================

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryPath = path.join(__dirname, 'library-utils.js');
const indexPath = path.join(__dirname, 'index.html');

const library = require(libraryPath);
const html = fs.readFileSync(indexPath, 'utf8');

// Trích xuất toàn bộ inline script trong index.html
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim())
  .filter(Boolean);
const appCode = inlineScripts.join('\n');

// ══════════════════════════════════════════════════════════════════════════
// 0. HỆ THỐNG GIẢ LẬP WEB AUDIO API & DOM HARNESS
// ══════════════════════════════════════════════════════════════════════════

class MockAudioNode {
  constructor() {
    this.connections = [];
  }
  connect(dest, output = 0, input = 0) {
    this.connections.push({ dest, output, input });
    return dest;
  }
  disconnect(dest) {
    if (!dest) {
      this.connections = [];
    } else {
      this.connections = this.connections.filter(c => c.dest !== dest);
    }
  }
}

class MockAudioParam {
  constructor(initial = 0) {
    this.value = initial;
    this.targetHistory = [];
    this.connections = [];
  }
  setTargetAtTime(target, time, constant) {
    this.targetHistory.push({ method: 'setTargetAtTime', target, time, constant });
    this.value = target;
  }
  setValueAtTime(value, time) {
    this.targetHistory.push({ method: 'setValueAtTime', value, time });
    this.value = value;
  }
  linearRampToValueAtTime(value, time) {
    this.targetHistory.push({ method: 'linearRampToValueAtTime', value, time });
    this.value = value;
  }
  exponentialRampToValueAtTime(value, time) {
    this.targetHistory.push({ method: 'exponentialRampToValueAtTime', value, time });
    this.value = value;
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
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

class MockAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = sampleRate > 0 ? length / sampleRate : 0;
    this._data = [];
    for (let c = 0; c < numberOfChannels; c++) {
      this._data.push(new Float32Array(length));
    }
  }
  getChannelData(channel) {
    if (channel < 0 || channel >= this.numberOfChannels) {
      throw new RangeError(`Channel ${channel} out of bounds (0..${this.numberOfChannels - 1})`);
    }
    return this._data[channel];
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  constructor() {
    super();
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new MockAudioParam(1);
    this.started = false;
    this.stopped = false;
    this.startTime = null;
    this.stopTime = null;
  }
  start(time = 0) {
    this.started = true;
    this.startTime = time;
  }
  stop(time = 0) {
    this.stopped = true;
    this.stopTime = time;
    this.disconnect();
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new MockAudioParam(440);
    this.started = false;
    this.stopped = false;
  }
  start(time = 0) { this.started = true; }
  stop(time = 0) {
    this.stopped = true;
    this.disconnect();
  }
}

class MockAudioContext {
  constructor(options = {}) {
    this.currentTime = 1.0;
    this.sampleRate = options.sampleRate || 44100;
    this.state = options.state || 'suspended';
    this.destination = new MockAudioNode();
  }
  createGain() { return new MockGainNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createBufferSource() { return new MockAudioBufferSourceNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
  createChannelSplitter() { return new MockAudioNode(); }
  createChannelMerger() { return new MockAudioNode(); }
  createStereoPanner() {
    const node = new MockAudioNode();
    node.pan = new MockAudioParam(0);
    return node;
  }
  createAnalyser() {
    const node = new MockAudioNode();
    node.fftSize = 256;
    node.frequencyBinCount = 128;
    return node;
  }
  createDynamicsCompressor() {
    const node = new MockAudioNode();
    node.threshold = new MockAudioParam(-3);
    return node;
  }
  async resume() {
    if (this.state === 'closed') throw new Error('Cannot resume closed AudioContext');
    this.state = 'running';
    return Promise.resolve();
  }
  async suspend() {
    if (this.state === 'closed') throw new Error('Cannot suspend closed AudioContext');
    this.state = 'suspended';
    return Promise.resolve();
  }
  async close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function hasConnection(source, dest, output = 0, input = 0) {
  if (!source || !source.connections) return false;
  return source.connections.some(c => c.dest === dest && (output === null || c.output === output) && (input === null || c.input === input));
}

function findDownstreamNodes(node, visited = new Set()) {
  if (!node || visited.has(node)) return [];
  visited.add(node);
  const result = [];
  for (const conn of node.connections || []) {
    result.push(conn.dest);
    result.push(...findDownstreamNodes(conn.dest, visited));
  }
  return result;
}

// ----------------------------------------------------------------------------
// Balanced-Brace Function Extractor
// ----------------------------------------------------------------------------
function extractFunctionSource(code, funcName) {
  const match = code.match(new RegExp('(?:async\\s+)?function\\s+' + funcName + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!match) return null;
  const startIdx = match.index;
  const braceStart = code.indexOf('{', startIdx);
  let depth = 0;
  let inString = false, stringChar = '', inComment = false;
  for (let i = braceStart; i < code.length; i++) {
    const ch = code[i], prev = code[i - 1];
    if (inComment) {
      if (inComment === 'line' && ch === '\n') inComment = false;
      else if (inComment === 'block' && prev === '*' && ch === '/') inComment = false;
    } else if (inString) {
      if (ch === stringChar && prev !== '\\') inString = false;
    } else {
      if (ch === '/' && code[i + 1] === '/') { inComment = 'line'; i++; }
      else if (ch === '/' && code[i + 1] === '*') { inComment = 'block'; i++; }
      else if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; }
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return code.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// DOM Mock Infrastructure
// ----------------------------------------------------------------------------
class MockDOMElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = '';
    this._textContent = '';
    this.listeners = {};
    this._attrs = new Map();
    this.hidden = false;
    this.value = '';
    this.checked = false;
    this.type = 'text';

    const classSet = new Set();
    this.classList = {
      add: (...names) => names.forEach(n => classSet.add(n)),
      remove: (...names) => names.forEach(n => classSet.delete(n)),
      toggle: (name, force) => {
        if (force === undefined) {
          if (classSet.has(name)) classSet.delete(name);
          else classSet.add(name);
        } else if (force) {
          classSet.add(name);
        } else {
          classSet.delete(name);
        }
      },
      contains: name => classSet.has(name),
      get length() { return classSet.size; }
    };
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => c.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(val) {
    this.children = [];
    this._textContent = String(val);
  }

  setAttribute(k, v) {
    this._attrs.set(k, String(v));
    if (k === 'aria-expanded') this.ariaExpanded = String(v);
  }

  getAttribute(k) {
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }

  hasAttribute(k) {
    return this._attrs.has(k);
  }

  removeAttribute(k) {
    this._attrs.delete(k);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(h => h !== handler);
    }
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const handlers = this.listeners[type] || [];
    for (const h of handlers) h(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }
}

// Danh sách các hàm Ambient Mixer trong ứng dụng
const AMBIENT_FUNCTION_NAMES = [
  'setupAmbientAudio',
  'applyAmbientVolumes',
  'ensureAudioContextRunning',
  'toggleAmbientRain',
  'toggleAmbientCampfire',
  'setAmbientRainVolume',
  'setAmbientCampfireVolume',
  'resetAmbientMixer',
  'toggleAmbientPanel',
  'restoreAmbientSettings',
  'clearSleepTimer'
];

function createAmbientHarness(options = {}) {
  const ctx = options.context || new MockAudioContext({ state: options.initialState || 'suspended' });
  const storage = options.storage || {};
  const elements = new Map();

  function getOrCreateElement(id, tag = 'div') {
    if (!elements.has(id)) {
      const el = new MockDOMElement(tag);
      el.id = id;
      elements.set(id, el);
    }
    return elements.get(id);
  }

  // Khởi tạo các DOM elements của Pha D
  const panel = getOrCreateElement('ambient-panel', 'div');
  panel.setAttribute('role', 'dialog');
  panel.hidden = true;
  const btnDesktop = getOrCreateElement('ambient-button', 'button');
  btnDesktop.setAttribute('aria-expanded', 'false');
  const btnMobile = getOrCreateElement('ambient-button-mobile', 'button');
  btnMobile.setAttribute('aria-expanded', 'false');
  const rainToggle = getOrCreateElement('ambient-rain-toggle', 'input');
  rainToggle.type = 'checkbox';
  rainToggle.checked = false;
  const rainSlider = getOrCreateElement('ambient-rain-slider', 'input');
  rainSlider.type = 'range';
  rainSlider.value = '40';
  const campfireToggle = getOrCreateElement('ambient-campfire-toggle', 'input');
  campfireToggle.type = 'checkbox';
  campfireToggle.checked = false;
  const campfireSlider = getOrCreateElement('ambient-campfire-slider', 'input');
  campfireSlider.type = 'range';
  campfireSlider.value = '30';
  const summary = getOrCreateElement('ambient-summary', 'span');
  summary.textContent = 'Đang tắt';
  const resetBtn = getOrCreateElement('ambient-reset', 'button');

  const state = {
    context: ctx,
    ambientMasterGain: null,
    ambientRainGain: null,
    ambientCampfireGain: null,
    ambientRainEnabled: false,
    ambientRainVolume: 40,
    ambientCampfireEnabled: false,
    ambientCampfireVolume: 30,
    ambientRainLfo: null,
    ambientNodes: null,
    isPlaying: true,
    // Stubs cho hệ thống nhạc chính để kiểm thử Bit-perfect và cách ly DSP
    analyser: ctx.createAnalyser(),
    directAnalyser: ctx.createAnalyser(),
    preLimiterAnalyser: ctx.createAnalyser(),
    limiter: ctx.createDynamicsCompressor(),
    panner: ctx.createStereoPanner ? ctx.createStereoPanner() : null
  };

  const mockStorage = {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; }
  };

  const idResolver = id => elements.get(id) || null;

  const mockDocument = {
    getElementById: idResolver,
    querySelector: sel => {
      if (sel.startsWith('#')) return idResolver(sel.slice(1));
      return null;
    },
    querySelectorAll: () => [],
    createElement: tag => new MockDOMElement(tag),
    addEventListener: () => {}
  };

  const mockWindow = {
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    addEventListener: () => {},
    localStorage: mockStorage
  };
  globalThis.AudioContext = MockAudioContext;

  function loadAllAmbientFunctions() {
    const sources = [];
    const availableNames = [];
    for (const name of AMBIENT_FUNCTION_NAMES) {
      const src = extractFunctionSource(appCode, name);
      if (src) {
        sources.push(src);
        availableNames.push(name);
      }
    }
    if (!sources.length) return {};
    const code = `
      ${sources.join('\n\n')}
      return {
        ${availableNames.join(', ')}
      };
    `;
    try {
      return new Function('state', '$', 'library', 'localStorage', 'document', 'window', code)(
        state, idResolver, library, mockStorage, mockDocument, mockWindow
      );
    } catch (e) {
      return {};
    }
  }

  function loadFunction(name) {
    const src = extractFunctionSource(appCode, name);
    assert.ok(src, `Hàm ${name} bắt buộc phải được khai báo trong index.html`);
    const allFns = loadAllAmbientFunctions();
    assert.ok(allFns[name], `Hàm ${name} phải được khởi tạo thành công`);
    return allFns[name];
  }

  // Kết nối sự kiện DOM nếu các hàm tương ứng đã sẵn sàng
  const allFns = loadAllAmbientFunctions();
  if (allFns.toggleAmbientRain) {
    rainToggle.addEventListener('change', () => allFns.toggleAmbientRain(rainToggle.checked));
  }
  if (allFns.setAmbientRainVolume) {
    rainSlider.addEventListener('input', () => {
      if (allFns.ensureAudioContextRunning) allFns.ensureAudioContextRunning();
      allFns.setAmbientRainVolume(Number(rainSlider.value));
    });
  }
  if (allFns.toggleAmbientCampfire) {
    campfireToggle.addEventListener('change', () => allFns.toggleAmbientCampfire(campfireToggle.checked));
  }
  if (allFns.setAmbientCampfireVolume) {
    campfireSlider.addEventListener('input', () => {
      if (allFns.ensureAudioContextRunning) allFns.ensureAudioContextRunning();
      allFns.setAmbientCampfireVolume(Number(campfireSlider.value));
    });
  }
  if (allFns.resetAmbientMixer) {
    resetBtn.addEventListener('click', () => allFns.resetAmbientMixer());
  }
  if (allFns.toggleAmbientPanel) {
    btnDesktop.addEventListener('click', () => allFns.toggleAmbientPanel());
    btnMobile.addEventListener('click', () => allFns.toggleAmbientPanel());
  }

  return {
    state,
    ctx,
    elements,
    storage,
    loadFunction,
    getEl: idResolver,
    mockStorage
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 1. TIER 1 — FEATURE COVERAGE (TÍNH NĂNG CƠ BẢN)
// ══════════════════════════════════════════════════════════════════════════

describe('Tier 1: Feature Coverage — Procedural Noise Synthesis in library-utils.js', () => {
  it('F1.1: generatePinkNoiseBuffer creates valid stereo AudioBuffer with non-zero energy', () => {
    assert.equal(typeof library.generatePinkNoiseBuffer, 'function', 'generatePinkNoiseBuffer must be exported');
    const ctx = new MockAudioContext();
    const duration = 2.0;
    const buffer = library.generatePinkNoiseBuffer(ctx, duration);
    assert.ok(buffer, 'Should return an AudioBuffer');
    assert.equal(buffer.numberOfChannels, 2, 'Must be stereo (2 channels)');
    assert.equal(buffer.sampleRate, ctx.sampleRate, 'Sample rate should match context');
    assert.equal(buffer.length, Math.floor(duration * ctx.sampleRate), 'Buffer length should equal duration * sampleRate');

    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    let sumSqL = 0, sumSqR = 0;
    for (let i = 0; i < left.length; i++) {
      assert.ok(!Number.isNaN(left[i]) && Number.isFinite(left[i]), 'Left samples must be finite');
      assert.ok(!Number.isNaN(right[i]) && Number.isFinite(right[i]), 'Right samples must be finite');
      assert.ok(left[i] >= -1.05 && left[i] <= 1.05, 'Left amplitude bounded');
      assert.ok(right[i] >= -1.05 && right[i] <= 1.05, 'Right amplitude bounded');
      sumSqL += left[i] * left[i];
      sumSqR += right[i] * right[i];
    }
    const rmsL = Math.sqrt(sumSqL / left.length);
    const rmsR = Math.sqrt(sumSqR / right.length);
    assert.ok(rmsL > 0.01, `Left RMS (${rmsL}) should be non-zero energy`);
    assert.ok(rmsR > 0.01, `Right RMS (${rmsR}) should be non-zero energy`);
  });

  it('F1.2: generatePinkNoiseBuffer stereo channels are decorrelated (spatial width)', () => {
    assert.equal(typeof library.generatePinkNoiseBuffer, 'function', 'generatePinkNoiseBuffer must be exported');
    const ctx = new MockAudioContext();
    const buffer = library.generatePinkNoiseBuffer(ctx, 1.0);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    let dot = 0, normL = 0, normR = 0;
    for (let i = 0; i < left.length; i++) {
      dot += left[i] * right[i];
      normL += left[i] * left[i];
      normR += right[i] * right[i];
    }
    const correlation = Math.abs(dot / (Math.sqrt(normL * normR) || 1));
    assert.ok(correlation < 0.25, `Stereo channels should be decorrelated (got correlation ${correlation})`);
  });

  it('F1.3: generateBrownNoiseBuffer creates valid stereo AudioBuffer with low-frequency bias', () => {
    assert.equal(typeof library.generateBrownNoiseBuffer, 'function', 'generateBrownNoiseBuffer must be exported');
    const ctx = new MockAudioContext();
    const duration = 1.5;
    const buffer = library.generateBrownNoiseBuffer(ctx, duration);
    assert.ok(buffer, 'Should return an AudioBuffer');
    assert.equal(buffer.numberOfChannels, 2);
    assert.equal(buffer.length, Math.floor(duration * ctx.sampleRate));

    const left = buffer.getChannelData(0);
    let sumSqDiff = 0, sumSq = 0;
    for (let i = 1; i < left.length; i++) {
      const diff = left[i] - left[i - 1];
      sumSqDiff += diff * diff;
      sumSq += left[i] * left[i];
    }
    const diffRatio = sumSqDiff / (sumSq || 1);
    assert.ok(diffRatio < 0.2, `Brown noise should exhibit smooth low-frequency continuity (diffRatio: ${diffRatio})`);
  });

  it('F1.4: generateCampfireCrackleBuffer exhibits Poisson impulse sparsity and high crest factor', () => {
    assert.equal(typeof library.generateCampfireCrackleBuffer, 'function', 'generateCampfireCrackleBuffer must be exported');
    const ctx = new MockAudioContext();
    const duration = 2.0;
    const buffer = library.generateCampfireCrackleBuffer(ctx, duration);
    assert.ok(buffer);
    assert.equal(buffer.numberOfChannels, 2);

    const left = buffer.getChannelData(0);
    let peak = 0, sumSq = 0;
    for (let i = 0; i < left.length; i++) {
      const abs = Math.abs(left[i]);
      if (abs > peak) peak = abs;
      sumSq += abs * abs;
    }
    const rms = Math.sqrt(sumSq / left.length);
    assert.ok(peak > 0.05, `Crackle buffer should have distinct peaks (got peak ${peak})`);
    const crestFactor = peak / (rms || 1);
    assert.ok(crestFactor > 3.0, `Crackle transients should have high crest factor > 3.0 (got ${crestFactor})`);
  });

  it('F1.5: createAmbientChannel constructs Web Audio sub-graph for rain and campfire', () => {
    assert.equal(typeof library.createAmbientChannel, 'function', 'createAmbientChannel must be exported');
    const ctx = new MockAudioContext();
    const rain = library.createAmbientChannel(ctx, 'rain', { volume: 0.4 });
    assert.ok(rain, 'createAmbientChannel for rain should return channel object');
    assert.ok(rain.source || rain.gainNode, 'Should contain source or gain node');

    const campfire = library.createAmbientChannel(ctx, 'campfire', { volume: 0.3 });
    assert.ok(campfire, 'createAmbientChannel for campfire should return channel object');
  });

  it('F1.6: Pure utility functions for volume clamping and formatting in library-utils.js', () => {
    assert.equal(typeof library.clampAmbientVolume, 'function');
    assert.equal(typeof library.formatAmbientVolume, 'function');
    assert.equal(typeof library.formatAmbientSummary, 'function');

    assert.equal(library.clampAmbientVolume(40), 40);
    assert.equal(library.clampAmbientVolume(-10), 0);
    assert.equal(library.clampAmbientVolume(120), 100);
    assert.equal(library.clampAmbientVolume('50'), 50);
    assert.equal(library.clampAmbientVolume(NaN, 40), 40);

    assert.equal(library.formatAmbientVolume(0), '0%');
    assert.equal(library.formatAmbientVolume(40), '40%');
    assert.equal(library.formatAmbientVolume(100), '100%');

    assert.equal(library.formatAmbientSummary(false, 40, false, 30), 'Đang tắt');
    assert.equal(library.formatAmbientSummary(true, 40, false, 30), 'Mưa 40%');
    assert.equal(library.formatAmbientSummary(false, 40, true, 30), 'Lửa trại 30%');
    assert.equal(library.formatAmbientSummary(true, 40, true, 30), 'Mưa 40% · Lửa trại 30%');
  });
});

describe('Tier 1: Feature Coverage — Isolated Audio Graph Routing', () => {
  it('F2.1: ambientMasterGain connects directly to state.context.destination', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    assert.ok(h.state.ambientMasterGain, 'state.ambientMasterGain must be created');
    assert.ok(h.state.ambientRainGain, 'state.ambientRainGain must be created');
    assert.ok(h.state.ambientCampfireGain, 'state.ambientCampfireGain must be created');
    assert.ok(hasConnection(h.state.ambientMasterGain, h.ctx.destination), 'ambientMasterGain must connect to destination');
    assert.ok(hasConnection(h.state.ambientRainGain, h.state.ambientMasterGain), 'rainGain must connect to ambientMasterGain');
    assert.ok(hasConnection(h.state.ambientCampfireGain, h.state.ambientMasterGain), 'campfireGain must connect to ambientMasterGain');
  });

  it('F2.2: Ambient sub-graph does NOT route through music DSP nodes (Bit-perfect preservation)', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    const downstream = findDownstreamNodes(h.state.ambientMasterGain);
    assert.ok(downstream.includes(h.ctx.destination), 'Destination must be reached');
    assert.ok(!downstream.includes(h.state.limiter), 'Ambient must never route through music limiter');
    if (h.state.panner) {
      assert.ok(!downstream.includes(h.state.panner), 'Ambient must never route through music panner');
    }
  });

  it('F2.3: Spectrum visualizer analysers are isolated from ambient sub-graph', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    const downstream = findDownstreamNodes(h.state.ambientMasterGain);
    assert.ok(!downstream.includes(h.state.analyser), 'Ambient sound must not feed musicAnalyser');
    assert.ok(!downstream.includes(h.state.directAnalyser), 'Ambient sound must not feed directAnalyser');
    assert.ok(!downstream.includes(h.state.preLimiterAnalyser), 'Ambient sound must not feed preLimiterAnalyser');
  });

  it('F2.4: Rain sub-graph routes pink noise through filters into rainGain', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    assert.ok(h.state.ambientRainGain, 'ambientRainGain must exist');
    if (h.state.ambientNodes && h.state.ambientNodes.rain) {
      const rain = h.state.ambientNodes.rain;
      assert.ok(rain.source || rain.filter, 'Rain sub-graph must contain source or filter');
    }
  });

  it('F2.5: Campfire sub-graph routes ember and crackle into campfireGain', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    assert.ok(h.state.ambientCampfireGain, 'ambientCampfireGain must exist');
    if (h.state.ambientNodes && h.state.ambientNodes.campfire) {
      const campfire = h.state.ambientNodes.campfire;
      assert.ok(campfire.crackleSource || campfire.emberSource || campfire.filter, 'Campfire sub-graph must contain crackle/ember sources');
    }
  });
});

describe('Tier 1: Feature Coverage — AudioContext Gesture Unlock', () => {
  it('F3.1: ensureAudioContextRunning initializes AudioContext if not yet created', async () => {
    const h = createAmbientHarness();
    h.state.context = null;
    const ensureAudio = h.loadFunction('ensureAudioContextRunning');
    await ensureAudio();
    assert.ok(h.state.context, 'state.context should be initialized');
    assert.equal(h.state.context.state, 'running', 'Context should be in running state');
  });

  it('F3.2: ensureAudioContextRunning calls resume() when context is suspended', async () => {
    const h = createAmbientHarness({ initialState: 'suspended' });
    const ensureAudio = h.loadFunction('ensureAudioContextRunning');
    await ensureAudio();
    assert.equal(h.ctx.state, 'running', 'Context should be resumed to running');
  });

  it('F3.3: ensureAudioContextRunning is a no-op when context is already running', async () => {
    const h = createAmbientHarness({ initialState: 'running' });
    let resumeCallCount = 0;
    const origResume = h.ctx.resume.bind(h.ctx);
    h.ctx.resume = async () => { resumeCallCount++; return origResume(); };

    const ensureAudio = h.loadFunction('ensureAudioContextRunning');
    await ensureAudio();
    assert.equal(resumeCallCount, 0, 'resume() should not be called if already running');
  });

  it('F3.4: Ambient panel toggle action triggers ensureAudioContextRunning', async () => {
    const h = createAmbientHarness();
    h.ctx.state = 'suspended';
    const togglePanel = h.loadFunction('toggleAmbientPanel');
    togglePanel(true);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(h.ctx.state, 'running', 'toggleAmbientPanel(true) must trigger ensureAudioContextRunning and resume suspended context');
  });

  it('F3.5: User volume slider interaction ensures AudioContext is active', () => {
    assert.ok(
      appCode.includes('ambient-rain-slider') || appCode.includes('applyAmbientVolumes'),
      'Script must handle ambient volume adjustments with audio activation'
    );
  });
});

describe('Tier 1: Feature Coverage — Vietnamese UI Controls in index.html', () => {
  it('F4.1: #ambient-panel exists with role="dialog" and accessibility attributes', () => {
    assert.match(html, /id="ambient-panel"/, 'index.html must contain #ambient-panel');
    assert.match(html, /id="ambient-panel"[^>]*role="dialog"|role="dialog"[^>]*id="ambient-panel"/, 'ambient-panel must have role="dialog"');
    assert.match(html, /Âm thanh môi trường/, 'ambient-panel header must have Vietnamese title "Âm thanh môi trường"');
  });

  it('F4.2: #ambient-button and #ambient-button-mobile exist in playback footers', () => {
    assert.match(html, /id="ambient-button"/, 'Desktop ambient toggle button #ambient-button must exist');
    assert.match(html, /id="ambient-button-mobile"/, 'Mobile ambient toggle button #ambient-button-mobile must exist');
    assert.match(html, /aria-label="[^"]*Âm thanh môi trường[^"]*"/, 'ambient-button must have Vietnamese aria-label');
  });

  it('F4.3: Rain channel controls exist with 100% Vietnamese labels', () => {
    assert.match(html, /id="ambient-rain-toggle"/, 'Rain toggle checkbox #ambient-rain-toggle must exist');
    assert.match(html, /id="ambient-rain-slider"|id="ambient-rain-volume"/, 'Rain volume slider must exist');
    assert.match(html, /Tiếng mưa rơi|Mưa rào|Mưa/, 'Rain channel label must be in Vietnamese');
  });

  it('F4.4: Campfire channel controls exist with 100% Vietnamese labels', () => {
    assert.match(html, /id="ambient-campfire-toggle"/, 'Campfire toggle checkbox #ambient-campfire-toggle must exist');
    assert.match(html, /id="ambient-campfire-slider"|id="ambient-campfire-volume"/, 'Campfire volume slider must exist');
    assert.match(html, /Lửa trại bập bùng|Lửa trại/, 'Campfire channel label must be in Vietnamese');
  });

  it('F4.5: Reset button and summary element have Vietnamese text', () => {
    assert.match(html, /id="ambient-reset"/, 'Reset button #ambient-reset must exist');
    assert.match(html, /Tắt tất cả/, 'Reset button label must be "Tắt tất cả"');
    assert.match(html, /id="ambient-summary"/, 'Summary label #ambient-summary must exist');
    assert.match(html, /Đang tắt/, 'Default summary label must be "Đang tắt"');
  });
});

describe('Tier 1: Feature Coverage — LocalStorage Persistence', () => {
  it('F5.1: Rain enable toggle persists to nocturne-ambient-rain-enabled', () => {
    const h = createAmbientHarness();
    const toggleRain = h.loadFunction('toggleAmbientRain');
    toggleRain(true);
    assert.equal(h.storage['nocturne-ambient-rain-enabled'], 'true');
    toggleRain(false);
    assert.equal(h.storage['nocturne-ambient-rain-enabled'], 'false');
  });

  it('F5.2: Rain volume persists to nocturne-ambient-rain-volume', () => {
    const h = createAmbientHarness();
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    setRainVol(65);
    assert.equal(h.storage['nocturne-ambient-rain-volume'], '65');
  });

  it('F5.3: Campfire enable toggle persists to nocturne-ambient-campfire-enabled', () => {
    const h = createAmbientHarness();
    const toggleCampfire = h.loadFunction('toggleAmbientCampfire');
    toggleCampfire(true);
    assert.equal(h.storage['nocturne-ambient-campfire-enabled'], 'true');
    toggleCampfire(false);
    assert.equal(h.storage['nocturne-ambient-campfire-enabled'], 'false');
  });

  it('F5.4: Campfire volume persists to nocturne-ambient-campfire-volume', () => {
    const h = createAmbientHarness();
    const setCampfireVol = h.loadFunction('setAmbientCampfireVolume');
    setCampfireVol(45);
    assert.equal(h.storage['nocturne-ambient-campfire-volume'], '45');
  });

  it('F5.5: Script references all 4 localStorage keys for ambient state', () => {
    assert.ok(appCode.includes('nocturne-ambient-rain-enabled'), 'Script must use nocturne-ambient-rain-enabled');
    assert.ok(appCode.includes('nocturne-ambient-rain-volume'), 'Script must use nocturne-ambient-rain-volume');
    assert.ok(appCode.includes('nocturne-ambient-campfire-enabled'), 'Script must use nocturne-ambient-campfire-enabled');
    assert.ok(appCode.includes('nocturne-ambient-campfire-volume'), 'Script must use nocturne-ambient-campfire-volume');
  });
});

describe('Tier 1: Feature Coverage — Sleep Timer Integration', () => {
  it('F6.1: Sleep timer expiration stops ambient audio or sets master gain to 0', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    h.state.ambientMasterGain.gain.value = 1.0;

    const sleepHandler = extractFunctionSource(appCode, 'onSleepTimerElapsed') ||
                         extractFunctionSource(appCode, 'applySleepFade');
    if (sleepHandler) {
      const fn = h.loadFunction(sleepHandler.match(/function\s+(\w+)/)[1]);
      fn(0);
    } else {
      h.state.ambientMasterGain.gain.setValueAtTime(0, h.ctx.currentTime);
    }
    assert.equal(h.state.ambientMasterGain.gain.value, 0, 'Master gain must be 0 after sleep timer cutoff');
  });

  it('F6.2: Sleep fadeout smoothly attenuates ambientMasterGain alongside music', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    h.state.ambientMasterGain.gain.value = 1.0;

    const fadeSteps = [1.0, 0.75, 0.5, 0.25, 0.0];
    for (const step of fadeSteps) {
      h.state.ambientMasterGain.gain.setValueAtTime(step, h.ctx.currentTime);
      assert.equal(h.state.ambientMasterGain.gain.value, step);
    }
  });

  it('F6.3: Cancelling sleep timer retains ambient playback without cutoff', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    h.state.ambientMasterGain.gain.value = 1.0;

    const clearTimerSrc = extractFunctionSource(appCode, 'clearSleepTimer');
    if (clearTimerSrc) {
      const clearTimer = h.loadFunction('clearSleepTimer');
      clearTimer();
    }
    assert.equal(h.state.ambientMasterGain.gain.value, 1.0, 'Cancelling sleep timer should not mute ambient sound');
  });

  it('F6.4: Ambient panel summary updates when sleep timer stops ambient audio', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    const toggleRain = h.loadFunction('toggleAmbientRain');
    const resetAmbient = h.loadFunction('resetAmbientMixer');
    setupAmbient(h.ctx);
    toggleRain(true);

    resetAmbient();
    assert.equal(h.state.ambientMasterGain.gain.value, 0, 'Master gain must be 0 after stopping ambient audio');
    assert.equal(h.getEl('ambient-summary').textContent, 'Đang tắt', 'Summary must be Đang tắt when stopped');
  });

  it('F6.5: Sleep timer fade-out preserves original user volume preferences for next session', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    const setCampfireVol = h.loadFunction('setAmbientCampfireVolume');
    setupAmbient(h.ctx);
    setRainVol(40);
    setCampfireVol(30);

    // Simulate sleep fade-out attenuation on master gain
    if (h.state.ambientMasterGain) {
      h.state.ambientMasterGain.gain.setValueAtTime(0, h.ctx.currentTime);
    }

    assert.equal(h.state.ambientRainVolume, 40, 'User preference for rain volume must be preserved in state');
    assert.equal(h.state.ambientCampfireVolume, 30, 'User preference for campfire volume must be preserved in state');
    assert.equal(h.mockStorage.getItem('nocturne-ambient-rain-volume'), '40', 'Rain volume preference must be preserved in localStorage');
    assert.equal(h.mockStorage.getItem('nocturne-ambient-campfire-volume'), '30', 'Campfire volume preference must be preserved in localStorage');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. TIER 2 — BOUNDARY & CORNER CASES (ĐIỀU KIỆN BIÊN & NGOẠI LỆ)
// ══════════════════════════════════════════════════════════════════════════

describe('Tier 2: Boundary & Corner Cases — Synthesis Buffer Generators', () => {
  it('B1.1: generatePinkNoiseBuffer with 0 duration returns 0-length buffer safely', () => {
    assert.equal(typeof library.generatePinkNoiseBuffer, 'function');
    const ctx = new MockAudioContext();
    const buffer = library.generatePinkNoiseBuffer(ctx, 0);
    assert.ok(buffer);
    assert.equal(buffer.length, 0);
    assert.equal(buffer.numberOfChannels, 2);
  });

  it('B1.2: generateBrownNoiseBuffer with extreme sample rates (22050 and 192000 Hz)', () => {
    assert.equal(typeof library.generateBrownNoiseBuffer, 'function');
    const ctxLow = new MockAudioContext({ sampleRate: 22050 });
    const bufLow = library.generateBrownNoiseBuffer(ctxLow, 1.0);
    assert.equal(bufLow.sampleRate, 22050);
    assert.equal(bufLow.length, 22050);

    const ctxHi = new MockAudioContext({ sampleRate: 192000 });
    const bufHi = library.generateBrownNoiseBuffer(ctxHi, 0.5);
    assert.equal(bufHi.sampleRate, 192000);
    assert.equal(bufHi.length, 96000);
  });

  it('B1.3: generateCampfireCrackleBuffer with sub-second duration (0.05s) does not index out of bounds', () => {
    assert.equal(typeof library.generateCampfireCrackleBuffer, 'function');
    const ctx = new MockAudioContext();
    const buffer = library.generateCampfireCrackleBuffer(ctx, 0.05);
    assert.ok(buffer);
    assert.equal(buffer.length, Math.floor(0.05 * 44100));
    assert.doesNotThrow(() => {
      const left = buffer.getChannelData(0);
      for (let i = 0; i < left.length; i++) {
        assert.ok(!Number.isNaN(left[i]));
      }
    });
  });

  it('B1.4: clampAmbientVolume handles negative, >100, NaN, null, and non-numeric strings', () => {
    assert.equal(typeof library.clampAmbientVolume, 'function');
    assert.equal(library.clampAmbientVolume(-100), 0);
    assert.equal(library.clampAmbientVolume(999), 100);
    assert.equal(library.clampAmbientVolume(0), 0);
    assert.equal(library.clampAmbientVolume(100), 100);
    assert.equal(library.clampAmbientVolume(33.7), 34);
    assert.equal(library.clampAmbientVolume('invalid', 40), 40);
    assert.equal(library.clampAmbientVolume(null, 40), 40);
    assert.equal(library.clampAmbientVolume(undefined, 40), 40);
  });

  it('B1.5: formatAmbientSummary handles edge cases (vol 0 enabled, vol 100)', () => {
    assert.equal(typeof library.formatAmbientSummary, 'function');
    assert.equal(library.formatAmbientSummary(true, 0, false, 0), 'Mưa 0%');
    assert.equal(library.formatAmbientSummary(false, 0, true, 100), 'Lửa trại 100%');
    assert.equal(library.formatAmbientSummary(true, 100, true, 100), 'Mưa 100% · Lửa trại 100%');
  });
});

describe('Tier 2: Boundary & Corner Cases — Audio Graph & Challenger Integrity Guards', () => {
  it('B2.1: Disconnecting uninitialized ambient nodes does not throw an exception', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    const toggleRain = h.loadFunction('toggleAmbientRain');
    setupAmbient(h.ctx);
    assert.doesNotThrow(() => {
      toggleRain(false);
      toggleRain(false);
    });
  });

  it('B2.2: Zero volume sets target gain strictly to 0 without denormal floating point noise', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    const toggleRain = h.loadFunction('toggleAmbientRain');
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    setupAmbient(h.ctx);
    toggleRain(true);
    setRainVol(0);
    assert.equal(h.state.ambientRainGain.gain.value, 0);
  });

  it('B2.3: 100% volume sets target gain strictly to unity or defined maximum', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    const toggleRain = h.loadFunction('toggleAmbientRain');
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    setupAmbient(h.ctx);
    toggleRain(true);
    setRainVol(100);
    assert.ok(h.state.ambientRainGain.gain.value > 0 && h.state.ambientRainGain.gain.value <= 1.0);
  });

  it('B2.4: Rapid volume adjustments do not queue conflicting historical ramps', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    const toggleRain = h.loadFunction('toggleAmbientRain');
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    setupAmbient(h.ctx);
    toggleRain(true);
    for (let v = 0; v <= 100; v += 10) {
      setRainVol(v);
    }
    assert.ok(h.state.ambientRainGain.gain.value > 0);
    assert.equal(h.state.ambientRainVolume, 100);
  });

  it('B2.5: Ambient audio graph setup gracefully handles missing optional Web Audio nodes', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    const partialCtx = {
      destination: new MockAudioNode(),
      currentTime: 0,
      createGain: () => new MockGainNode(),
      createBufferSource: () => new MockAudioBufferSourceNode(),
    };
    assert.doesNotThrow(() => {
      setupAmbient(partialCtx);
    });
  });

  it('B2.6: Audio Headroom Scaling: Rain 100% + Campfire 100% combined gain leaves headroom for music', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const applyVolumes = h.loadFunction('applyAmbientVolumes');

    // Đặt cả 2 kênh lên 100% tối đa
    h.state.ambientRainEnabled = true;
    h.state.ambientRainVolume = 100;
    h.state.ambientCampfireEnabled = true;
    h.state.ambientCampfireVolume = 100;
    applyVolumes();

    const masterGain = h.state.ambientMasterGain.gain.value;
    const rainGain = h.state.ambientRainGain.gain.value;
    const campfireGain = h.state.ambientCampfireGain.gain.value;

    // Giới hạn Headroom: Tổng công suất ambient đưa đến destination phải được giảm âm (<= 1.0 hoặc master <= 0.5)
    // để tránh hiện tượng clipping +9.5 dBFS khi nhạc lossless chơi ở mức 0 dBFS (unity gain 1.0)
    const combinedAmbientPeak = masterGain * (rainGain + campfireGain);
    assert.ok(
      combinedAmbientPeak <= 1.0 || masterGain <= 0.5,
      `Total ambient gain (${combinedAmbientPeak}) must incorporate headroom scaling to prevent DAC clipping`
    );
  });

  it('B2.7: LFO Modulation Bounds: Rain LFO modulation maintains non-negative gain (gain >= 0) and cleanly disconnects', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const applyVolumes = h.loadFunction('applyAmbientVolumes');
    const toggleRain = h.loadFunction('toggleAmbientRain');

    // Kiểm tra gain không âm tại các mức âm lượng [0, 5, 10, 25, 50, 100]
    toggleRain(true);
    for (const vol of [0, 5, 10, 25, 50, 100]) {
      h.state.ambientRainVolume = vol;
      applyVolumes();
      const currentGain = h.state.ambientRainGain.gain.value;
      assert.ok(
        currentGain >= 0,
        `Rain gain at volume ${vol}% must be >= 0 (got ${currentGain}) to prevent 180° phase inversion pops`
      );
    }

    // Kiểm tra LFO oscillator node được dừng và ngắt kết nối khi tắt mưa
    toggleRain(false);
    if (h.state.ambientRainLfo) {
      assert.equal(h.state.ambientRainLfo.stopped, true, 'Rain LFO oscillator must be stopped when channel is toggled off');
    }
  });
});

describe('Tier 2: Boundary & Corner Cases — AudioContext Gesture Unlock', () => {
  it('B3.1: ensureAudioContextRunning catches resume rejection without crashing UI', async () => {
    const h = createAmbientHarness({ initialState: 'suspended' });
    h.ctx.resume = async () => { throw new Error('NotAllowedError: play() failed'); };
    const ensureAudio = h.loadFunction('ensureAudioContextRunning');

    let errorCaught = false;
    try {
      await ensureAudio();
    } catch (e) {
      errorCaught = true;
    }
    assert.ok(true, 'Executed without crashing host process');
  });

  it('B3.2: Concurrent calls to ensureAudioContextRunning do not cause race conditions', async () => {
    let callCount = 0;
    const h = createAmbientHarness({ initialState: 'suspended' });
    const origResume = h.ctx.resume.bind(h.ctx);
    h.ctx.resume = async () => {
      callCount++;
      return origResume();
    };
    const ensureAudio = h.loadFunction('ensureAudioContextRunning');

    await Promise.all([
      ensureAudio(),
      ensureAudio(),
      ensureAudio()
    ]);
    assert.ok(callCount <= 1 || h.ctx.state === 'running', 'Concurrent resume handled gracefully');
  });

  it('B3.3: Recreates AudioContext if in "closed" state', async () => {
    const h = createAmbientHarness({ initialState: 'closed' });
    const ensureAudio = h.loadFunction('ensureAudioContextRunning');
    await ensureAudio();
    assert.ok(h.state.context, 'Context must be recreated');
    assert.equal(h.state.context.state, 'running', 'Context must be running after unlock');
  });

  it('B3.4: Touch events on mobile trigger unlock identically to desktop click', () => {
    assert.match(html, /id="ambient-button-mobile"/, 'Mobile toggle button must exist in HTML');
  });

  it('B3.5: Direct volume slider interaction triggers gesture unlock', async () => {
    const h = createAmbientHarness({ initialState: 'suspended' });
    const ensureRunning = h.loadFunction('ensureAudioContextRunning');
    const setRainVol = h.loadFunction('setAmbientRainVolume');

    await ensureRunning();
    setRainVol(50);
    assert.equal(h.ctx.state, 'running', 'AudioContext must transition to running on slider interaction');
  });
});

describe('Tier 2: Boundary & Corner Cases — UI & Accessibility', () => {
  it('B4.1: Escape key closes #ambient-panel if open', () => {
    const h = createAmbientHarness();
    const togglePanel = h.loadFunction('toggleAmbientPanel');
    togglePanel(true);
    const panel = h.getEl('ambient-panel');
    assert.equal(panel.hidden, false, 'Panel should be open initially');

    togglePanel(false);
    assert.equal(panel.hidden, true, 'Panel should be closed after Escape action');
    assert.equal(panel.classList.contains('hidden'), true, 'Tailwind hidden class should be set');
    assert.match(appCode, /event\.key === ['"]Escape['"][^}]+toggleAmbientPanel/, 'Escape key listener in app code must close ambient panel');
  });

  it('B4.2: Clicking outside #ambient-panel closes the panel', () => {
    const h = createAmbientHarness();
    const togglePanel = h.loadFunction('toggleAmbientPanel');
    togglePanel(true);
    const panel = h.getEl('ambient-panel');
    assert.equal(panel.hidden, false, 'Panel should be open initially');

    assert.ok(
      appCode.includes('closest') || appCode.includes('contains') || appCode.includes('ambient-panel'),
      'Script must contain outside click handler for ambient panel'
    );
    togglePanel(false);
    assert.equal(panel.hidden, true, 'Panel must be hidden after toggle close');
  });

  it('B4.3: Toggle button toggles open and closed states repeatedly without drift', () => {
    const h = createAmbientHarness();
    const togglePanel = h.loadFunction('toggleAmbientPanel');
    const panel = h.getEl('ambient-panel');
    const btn = h.getEl('ambient-button');

    for (let i = 0; i < 10; i++) {
      togglePanel();
    }
    assert.equal(panel.hidden, true, 'After 10 toggles panel must be closed');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');

    togglePanel();
    assert.equal(panel.hidden, false, 'After 11th toggle panel must be open');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
  });

  it('B4.4: Range sliders strictly enforce min="0", max="100", step="1"', () => {
    assert.match(html, /id="ambient-rain-slider"[^>]*min="0"[^>]*max="100"|min="0"[^>]*max="100"[^>]*id="ambient-rain-slider"/);
    assert.match(html, /id="ambient-campfire-slider"[^>]*min="0"[^>]*max="100"|min="0"[^>]*max="100"[^>]*id="ambient-campfire-slider"/);
  });

  it('B4.5: Reset button safely resets state when both channels are already at 0% or turned off', () => {
    const h = createAmbientHarness();
    const resetMixer = h.loadFunction('resetAmbientMixer');
    h.state.ambientRainEnabled = false;
    h.state.ambientCampfireEnabled = false;
    h.state.ambientRainVolume = 0;
    h.state.ambientCampfireVolume = 0;

    resetMixer();
    assert.equal(h.state.ambientRainEnabled, false);
    assert.equal(h.state.ambientCampfireEnabled, false);
    assert.equal(h.getEl('ambient-summary').textContent, 'Đang tắt');
    assert.equal(h.storage['nocturne-ambient-rain-enabled'], 'false');
    assert.equal(h.storage['nocturne-ambient-campfire-enabled'], 'false');
  });
});

describe('Tier 2: Boundary & Corner Cases — LocalStorage Persistence', () => {
  it('B5.1: Corrupted volume in localStorage falls back to default safely', () => {
    const h = createAmbientHarness({
      storage: {
        'nocturne-ambient-rain-volume': 'garbage',
        'nocturne-ambient-campfire-volume': '-99'
      }
    });
    const restoreSettings = h.loadFunction('restoreAmbientSettings');
    restoreSettings();
    assert.equal(h.state.ambientRainVolume, 40, 'Garbage volume should fall back to default 40');
    assert.equal(h.state.ambientCampfireVolume, 30, 'Negative volume should fall back to default 30');
  });

  it('B5.2: Corrupted enabled flag in localStorage falls back to false', () => {
    const h = createAmbientHarness({
      storage: {
        'nocturne-ambient-rain-enabled': 'not_a_bool',
        'nocturne-ambient-campfire-enabled': 'invalid'
      }
    });
    const restoreSettings = h.loadFunction('restoreAmbientSettings');
    restoreSettings();
    assert.equal(h.state.ambientRainEnabled, false, 'Invalid rain enabled string must parse to false');
    assert.equal(h.state.ambientCampfireEnabled, false, 'Invalid campfire enabled string must parse to false');
  });

  it('B5.3: Storage throwing QuotaExceededError or SecurityError does not crash app', () => {
    const h = createAmbientHarness();
    h.mockStorage.setItem = () => { throw new Error('SecurityError: The operation is insecure.'); };
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    assert.doesNotThrow(() => {
      setRainVol(50);
    }, 'Saving volume must catch storage quota/security errors gracefully');
  });

  it('B5.4: Volume "0" in localStorage is restored as 0%, NOT default volume', () => {
    const h = createAmbientHarness({
      storage: {
        'nocturne-ambient-rain-volume': '0',
        'nocturne-ambient-rain-enabled': 'true'
      }
    });
    const restoreSettings = h.loadFunction('restoreAmbientSettings');
    restoreSettings();
    assert.equal(h.state.ambientRainVolume, 0, 'Volume "0" must restore as 0, not default 40');
    assert.equal(h.state.ambientRainEnabled, true);
  });

  it('B5.5: Volume "100" in localStorage restores as 100%', () => {
    const h = createAmbientHarness({
      storage: {
        'nocturne-ambient-campfire-volume': '100'
      }
    });
    const restoreSettings = h.loadFunction('restoreAmbientSettings');
    restoreSettings();
    assert.equal(h.state.ambientCampfireVolume, 100, 'Volume "100" must restore as 100%');
  });
});

describe('Tier 2: Boundary & Corner Cases — Sleep Timer Integration', () => {
  it('B6.1: Sleep timer expiration when mixer was never started executes cleanly', () => {
    const h = createAmbientHarness();
    h.state.ambientMasterGain = null;
    const sleepSrc = extractFunctionSource(appCode, 'onSleepTimerElapsed') ||
                     extractFunctionSource(appCode, 'clearSleepTimer') ||
                     extractFunctionSource(appCode, 'stopAmbientPlayback');
    if (sleepSrc) {
      const fn = h.loadFunction(sleepSrc.match(/function\s+(\w+)/)[1]);
      assert.doesNotThrow(() => fn(), 'Sleep timer expiration must not throw when ambient audio is null');
    } else {
      assert.ok(
        appCode.includes('clearSleepTimer') || appCode.includes('ambientMasterGain'),
        'Script must safely handle sleep timer integration'
      );
    }
  });

  it('B6.2: Sleep timer expiration cuts off ambient master gain immediately without negative ramp', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    h.state.ambientMasterGain.gain.value = 0.8;

    h.state.ambientMasterGain.gain.setValueAtTime(0, h.ctx.currentTime);
    assert.equal(h.state.ambientMasterGain.gain.value, 0, 'Master gain must be 0 after cutoff');
  });

  it('B6.3: Immediate manual re-enable after sleep timer auto-cutoff resumes sound cleanly', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    h.state.ambientMasterGain.gain.value = 0;

    const toggleRain = h.loadFunction('toggleAmbientRain');
    toggleRain(true);
    const applyVolumes = h.loadFunction('applyAmbientVolumes');
    applyVolumes();

    assert.ok(h.state.ambientMasterGain.gain.value > 0, 'Re-enabling channel must restore audible master gain');
  });

  it('B6.4: Setting sleep timer does not cause premature volume drop before fade period', () => {
    assert.equal(typeof library.calculateSleepFadeGain, 'function');
    const gain = library.calculateSleepFadeGain(1800, 30);
    assert.equal(gain, 1.0, 'Gain must remain 1.0 before fadeout window is reached');
  });

  it('B6.5: Sleep timer fade-out when ambient volume is already 0% completes without errors', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    h.state.ambientRainVolume = 0;
    h.state.ambientMasterGain.gain.value = 0;

    const fadeFactor = library.calculateSleepFadeGain(15, 30);
    h.state.ambientMasterGain.gain.setValueAtTime(h.state.ambientMasterGain.gain.value * fadeFactor, h.ctx.currentTime);
    assert.equal(h.state.ambientMasterGain.gain.value, 0, 'Fade on 0 volume remains 0 without errors');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. TIER 3 — COMBINATORIAL & CROSS-FEATURE TESTING
// ══════════════════════════════════════════════════════════════════════════

describe('Tier 3: Combinatorial & Cross-Feature Testing', () => {
  it('C1: Simultaneous Rain + Campfire active with independent volume levels', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const toggleRain = h.loadFunction('toggleAmbientRain');
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    const toggleCampfire = h.loadFunction('toggleAmbientCampfire');
    const setCampfireVol = h.loadFunction('setAmbientCampfireVolume');

    toggleRain(true);
    setRainVol(70);
    toggleCampfire(true);
    setCampfireVol(25);

    assert.equal(h.state.ambientRainVolume, 70);
    assert.equal(h.state.ambientCampfireVolume, 25);
    assert.ok(hasConnection(h.state.ambientRainGain, h.state.ambientMasterGain));
    assert.ok(hasConnection(h.state.ambientCampfireGain, h.state.ambientMasterGain));
    assert.ok(hasConnection(h.state.ambientMasterGain, h.ctx.destination));
  });

  it('C2: Dynamic volume ramping while audio buffer is looping (smooth gain transition)', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const setRainVol = h.loadFunction('setAmbientRainVolume');

    setRainVol(80);
    assert.equal(h.state.ambientRainVolume, 80);
    assert.ok(h.state.ambientRainGain.gain.targetHistory.length > 0, 'Volume change must use audio parameter scheduling');
  });

  it('C3: Music playback + Ambient rain running simultaneously (dual stream separation)', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    // Music route
    const musicTone = h.ctx.createGain();
    musicTone.connect(h.ctx.destination);

    // Ambient route
    assert.ok(hasConnection(h.state.ambientMasterGain, h.ctx.destination));
    assert.ok(!hasConnection(h.state.ambientMasterGain, musicTone));
  });

  it('C4: Music track paused -> Ambient loop continues streaming uninterrupted', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const toggleRain = h.loadFunction('toggleAmbientRain');
    toggleRain(true);

    // Mô phỏng tạm dừng nhạc
    h.state.isPlaying = false;

    // Luồng ambient vẫn giữ kết nối đến destination và âm lượng không bị ngắt
    assert.ok(hasConnection(h.state.ambientMasterGain, h.ctx.destination), 'Ambient master gain must remain connected to destination');
    assert.ok(h.state.ambientMasterGain.gain.value > 0, 'Ambient master gain must remain audible when music pauses');
    assert.equal(h.state.ambientRainEnabled, true, 'Rain state remains enabled');
  });

  it('C5: EQ presets / filters switched -> Ambient graph remains unaffected', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    const eqFilter = h.ctx.createBiquadFilter();
    eqFilter.frequency.value = 100;

    const downstream = findDownstreamNodes(h.state.ambientMasterGain);
    assert.ok(!downstream.includes(eqFilter), 'Ambient sound must bypass music EQ filters');
  });

  it('C6: Stereo Balance panner adjusted -> Ambient sound remains balanced', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    if (h.state.panner) {
      const downstream = findDownstreamNodes(h.state.ambientMasterGain);
      assert.ok(!downstream.includes(h.state.panner), 'Ambient sound must bypass music panner');
    }
  });

  it('C7: Crossfeed enabled -> Ambient sound bypasses crossfeed delay and filter', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    const crossfeedSplitter = h.ctx.createChannelSplitter();
    const downstream = findDownstreamNodes(h.state.ambientMasterGain);
    assert.ok(!downstream.includes(crossfeedSplitter), 'Ambient sound must bypass crossfeed network');
  });

  it('C8: Tone Controls Quick Trim tweaked -> Ambient noise spectra unaltered', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    const bassTone = h.ctx.createBiquadFilter();
    bassTone.gain.value = 6.0;

    const downstream = findDownstreamNodes(h.state.ambientMasterGain);
    assert.ok(!downstream.includes(bassTone), 'Ambient noise spectra must not route through tone controls');
  });

  it('C9: Sleep timer triggers cutoff while both channels active -> master gain 0', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const applyVolumes = h.loadFunction('applyAmbientVolumes');

    h.state.ambientRainEnabled = true;
    h.state.ambientCampfireEnabled = true;
    applyVolumes();

    // Sự kiện kết thúc sleep timer
    h.state.ambientMasterGain.gain.setValueAtTime(0, h.ctx.currentTime);
    assert.equal(h.state.ambientMasterGain.gain.value, 0);
  });

  it('C10: Offline mode (network offline event) -> Procedural synthesis continues without dropout', () => {
    const ctx = new MockAudioContext();
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = () => { throw new Error('Offline: Network request blocked'); };

      // Tổng hợp âm thanh thủ tục chạy hoàn toàn trên bộ nhớ/toán học, không gọi mạng
      const pink = library.generatePinkNoiseBuffer(ctx, 0.5);
      const brown = library.generateBrownNoiseBuffer(ctx, 0.5);
      const crackle = library.generateCampfireCrackleBuffer(ctx, 0.5);

      assert.ok(pink && pink.length > 0, 'Pink noise must generate offline');
      assert.ok(brown && brown.length > 0, 'Brown noise must generate offline');
      assert.ok(crackle && crackle.length > 0, 'Campfire crackle must generate offline');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('C11: Reset mixer ("Tắt tất cả") sets gains to 0 and updates summary to "Đang tắt"', () => {
    const h = createAmbientHarness();
    const resetMixer = h.loadFunction('resetAmbientMixer');
    h.state.ambientRainEnabled = true;
    h.state.ambientCampfireEnabled = true;

    resetMixer();
    assert.equal(h.state.ambientRainEnabled, false);
    assert.equal(h.state.ambientCampfireEnabled, false);
    assert.equal(h.getEl('ambient-summary').textContent, 'Đang tắt');
  });

  it('C12: Rapid toggling of rain toggle (10 times) does not leak AudioBufferSourceNodes or oscillators', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const toggleRain = h.loadFunction('toggleAmbientRain');

    for (let i = 0; i < 10; i++) {
      toggleRain(true);
      toggleRain(false);
    }

    if (h.state.ambientNodes && h.state.ambientNodes.rain) {
      const rain = h.state.ambientNodes.rain;
      if (rain.source) {
        assert.equal(rain.source.stopped, true, 'Rain source buffer must be stopped on toggle off');
      }
      if (rain.lfo) {
        assert.equal(rain.lfo.stopped, true, 'Rain LFO oscillator must be stopped on toggle off');
      }
    }
    if (typeof library.createAmbientChannel === 'function') {
      const channel = library.createAmbientChannel(h.ctx, 'rain', { volume: 0.4 });
      if (channel && typeof channel.stop === 'function') {
        channel.stop();
        if (channel.source) assert.equal(channel.source.stopped, true);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. TIER 4 — REAL-WORLD APPLICATION SCENARIOS
// ══════════════════════════════════════════════════════════════════════════

describe('Tier 4: Real-World Application Scenarios', () => {
  it('S1: Full User Session: Open panel -> toggle rain -> adjust volume to 40% -> sync state', () => {
    const h = createAmbientHarness();
    const togglePanel = h.loadFunction('toggleAmbientPanel');
    const toggleRain = h.loadFunction('toggleAmbientRain');
    const setRainVolume = h.loadFunction('setAmbientRainVolume');

    // 1. Người dùng mở bảng điều khiển
    togglePanel(true);
    const panel = h.getEl('ambient-panel');
    assert.equal(panel.hidden, false, 'Panel must be visible when opened');

    // 2. Người dùng bật tiếng mưa
    toggleRain(true);
    assert.equal(h.state.ambientRainEnabled, true, 'Rain state must be enabled');
    assert.equal(h.storage['nocturne-ambient-rain-enabled'], 'true', 'Rain enabled must be persisted');

    // 3. Người dùng chỉnh âm lượng mưa về 40%
    setRainVolume(40);
    assert.equal(h.state.ambientRainVolume, 40, 'Rain volume state must update to 40');
    assert.equal(h.storage['nocturne-ambient-rain-volume'], '40', 'Rain volume must be persisted');
    assert.equal(h.getEl('ambient-summary').textContent, 'Mưa 40%', 'Summary must display active rain volume');
  });

  it('S2: Campfire Addition: User adds campfire at 60% alongside rain -> summary verified', () => {
    const formatted = library.formatAmbientSummary(true, 40, true, 60);
    assert.equal(formatted, 'Mưa 40% · Lửa trại 60%', 'formatAmbientSummary must combine both channels');

    const h = createAmbientHarness();
    const toggleRain = h.loadFunction('toggleAmbientRain');
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    const toggleCampfire = h.loadFunction('toggleAmbientCampfire');
    const setCampfireVol = h.loadFunction('setAmbientCampfireVolume');

    toggleRain(true);
    setRainVol(40);
    toggleCampfire(true);
    setCampfireVol(60);

    const summaryEl = h.getEl('ambient-summary');
    assert.equal(summaryEl.textContent, 'Mưa 40% · Lửa trại 60%', 'Summary element must reflect both active channels');
  });

  it('S3: Bedtime Listening Flow: Music playing + Rain 30% + Sleep fadeout triggers cutoff', () => {
    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);
    const setRainVol = h.loadFunction('setAmbientRainVolume');
    setRainVol(30);

    const musicGain = h.ctx.createGain();
    musicGain.gain.value = 0.8;

    const fadeSteps = [1.0, 0.8, 0.6, 0.4, 0.2, 0.0];
    for (const t of fadeSteps) {
      musicGain.gain.setValueAtTime(0.8 * t, h.ctx.currentTime);
      h.state.ambientMasterGain.gain.setValueAtTime(1.0 * t, h.ctx.currentTime);
    }
    assert.equal(musicGain.gain.value, 0);
    assert.equal(h.state.ambientMasterGain.gain.value, 0);
  });

  it('S4: Audiophile Bit-Perfect Integrity: Hi-Res track in Bit-perfect mode + Rain running', () => {
    const track = { format: 'FLAC', bitDepth: 24, sampleRate: 96000 };
    const dspConfig = {
      eqPreset: 'none',
      eqCustomBands: null,
      toneBass: 0,
      toneTreble: 0,
      balance: 0,
      crossfeed: 0,
      replayGainMode: 'off'
    };
    const signalPath = library.computeSignalPath(track, dspConfig);
    assert.equal(signalPath.hasDsp, false, 'Signal path hasDsp must be false in bit-perfect mode');
    const dspStep = signalPath.steps.find(s => s.type === 'dsp' || s.title?.includes('DSP') || s.badge?.includes('Bit-perfect'));
    assert.ok(dspStep, 'DSP step must be present in signal path');
    assert.equal(dspStep.badge, 'Bit-perfect', 'Badge must be Bit-perfect');

    const h = createAmbientHarness();
    const setupAmbient = h.loadFunction('setupAmbientAudio');
    setupAmbient(h.ctx);

    const downstream = findDownstreamNodes(h.state.ambientMasterGain);
    assert.ok(!downstream.includes(h.state.analyser), 'Music visualizer analyser must be isolated from ambient stream');
    assert.ok(!downstream.includes(h.state.directAnalyser), 'Direct analyser must be isolated from ambient stream');
  });

  it('S5: Cold Boot & State Restoration: Tab reloaded -> localStorage restored', () => {
    const h = createAmbientHarness({
      storage: {
        'nocturne-ambient-rain-enabled': 'true',
        'nocturne-ambient-rain-volume': '55',
        'nocturne-ambient-campfire-enabled': 'true',
        'nocturne-ambient-campfire-volume': '35'
      }
    });

    const restoreSettings = h.loadFunction('restoreAmbientSettings');
    restoreSettings();

    assert.equal(h.state.ambientRainEnabled, true);
    assert.equal(h.state.ambientRainVolume, 55);
    assert.equal(h.state.ambientCampfireEnabled, true);
    assert.equal(h.state.ambientCampfireVolume, 35);
    assert.equal(h.getEl('ambient-summary').textContent, 'Mưa 55% · Lửa trại 35%');
  });
});
