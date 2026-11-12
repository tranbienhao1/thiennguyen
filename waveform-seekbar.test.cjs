'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim())
  .filter(Boolean);
const appCode = inlineScripts.join('\n');

// ── 1. library-utils waveform helpers ──

describe('library-utils waveform helpers', () => {
  it('generateWaveformPeaks is a function', () => {
    assert.equal(typeof library.generateWaveformPeaks, 'function');
  });

  it('generateWaveformPeaks returns Float32Array of correct length with positive values', () => {
    const result = library.generateWaveformPeaks(new Float32Array([0.5, -0.8, 0.3]), 2);
    assert.ok(result instanceof Float32Array, 'result should be Float32Array');
    assert.equal(result.length, 2);
    assert.ok(result[0] > 0, 'first bucket peak should be > 0');
    assert.ok(result[1] > 0, 'second bucket peak should be > 0');
  });

  it('generateWaveformPeaks returns Float32Array of length 0 for empty input', () => {
    const result = library.generateWaveformPeaks(new Float32Array(0), 10);
    assert.ok(result instanceof Float32Array);
    assert.equal(result.length, 0);
  });

  it('generateWaveformPeaks returns Float32Array of length 0 when numBuckets is 0', () => {
    const result = library.generateWaveformPeaks(new Float32Array([0.5]), 0);
    assert.ok(result instanceof Float32Array);
    assert.equal(result.length, 0);
  });

  it('renderWaveformCanvas is a function', () => {
    assert.equal(typeof library.renderWaveformCanvas, 'function');
  });

  it('renderWaveformCanvas with empty peaks returns without error', () => {
    const mockCtx = {
      clearRect: () => {},
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
    };
    const mockCanvas = {
      width: 300,
      height: 64,
      getContext: () => mockCtx,
    };
    // Should not throw
    assert.doesNotThrow(() => {
      library.renderWaveformCanvas(mockCanvas, new Float32Array(0), 0.5);
    });
  });

  it('formatWaveformStatus is a function', () => {
    assert.equal(typeof library.formatWaveformStatus, 'function');
  });

  it('formatWaveformStatus(200, true) returns string containing "200"', () => {
    const result = library.formatWaveformStatus(200, true);
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('200'), `Expected "200" in "${result}"`);
  });

  it('formatWaveformStatus(0, false) returns string containing "đang tải"', () => {
    const result = library.formatWaveformStatus(0, false);
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('đang tải'), `Expected "đang tải" in "${result}"`);
  });
});

// ── 2. index.html waveform DOM ──

describe('index.html waveform DOM', () => {
  it('canvas element with id="waveform-canvas" exists', () => {
    assert.match(html, /id="waveform-canvas"/);
  });

  it('waveform-canvas has cursor-pointer class', () => {
    assert.match(html, /waveform-canvas.*cursor-pointer|cursor-pointer.*waveform-canvas/);
  });

  it('waveform-canvas has Vietnamese aria-label', () => {
    assert.match(html, /aria-label="Dạng sóng bài hát/);
  });
});

// ── 3. index.html waveform script ──

describe('index.html waveform script', () => {
  it('function generateTrackWaveform( is declared', () => {
    assert.ok(
      appCode.includes('function generateTrackWaveform('),
      'Missing: function generateTrackWaveform('
    );
  });

  it('function renderWaveformSeekbar( is declared', () => {
    assert.ok(
      appCode.includes('function renderWaveformSeekbar('),
      'Missing: function renderWaveformSeekbar('
    );
  });

  it('state references waveformPeaks', () => {
    assert.ok(
      appCode.includes('waveformPeaks'),
      'Missing: waveformPeaks state field'
    );
  });

  it('state references waveformTrackId', () => {
    assert.ok(
      appCode.includes('waveformTrackId'),
      'Missing: waveformTrackId state field'
    );
  });

  it('generateTrackWaveform( is called somewhere', () => {
    assert.ok(
      appCode.includes('generateTrackWaveform('),
      'Missing: call to generateTrackWaveform('
    );
  });

  it('renderWaveformSeekbar() is called somewhere', () => {
    assert.ok(
      appCode.includes('renderWaveformSeekbar()'),
      'Missing: call to renderWaveformSeekbar()'
    );
  });
});
