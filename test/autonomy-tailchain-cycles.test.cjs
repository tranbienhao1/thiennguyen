'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'library-utils.js'));

describe('Autonomy Tail-Chaining Cycle 1 — UPG-01 (LRCLIB Retry-After Jitter, Lyricsfile YAML 1.0 & O(log N) Word Sync)', () => {
  it('exposes UPG-01 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.computeLrclibRetryDelayMs, 'function');
    assert.equal(typeof lib.parseLyricsfileYaml, 'function');
    assert.equal(typeof lib.serializeLyricsfileYaml, 'function');
    assert.equal(typeof lib.findActiveLyricStateBinary, 'function');

    const sandbox = { library: { existingHelper: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.computeLrclibRetryDelayMs, 'function');
    assert.equal(typeof sandbox.library.computeLrclibRetryDelayMs, 'function');
    assert.equal(typeof sandbox.library.parseLyricsfileYaml, 'function');
    assert.equal(typeof sandbox.library.serializeLyricsfileYaml, 'function');
    assert.equal(typeof sandbox.library.findActiveLyricStateBinary, 'function');
    assert.equal(sandbox.library.existingHelper, true);
  });

  it('computeLrclibRetryDelayMs parses 429/503 Retry-After seconds, HTTP-date, exponential backoff & bounded 0..30% jitter', () => {
    // 1. Integer Retry-After seconds with 0%, 50%, and 100% of max 30% jitter
    assert.equal(lib.computeLrclibRetryDelayMs('5', 0, () => 0), 5000);
    assert.equal(lib.computeLrclibRetryDelayMs('5', 0, () => 0.5), 5750); // +15%
    assert.equal(lib.computeLrclibRetryDelayMs('5', 0, () => 1), 6500);   // +30%

    // Bounded positive jitter even if randomFn returns out-of-range values
    assert.equal(lib.computeLrclibRetryDelayMs('4', 0, () => -5), 4000);
    assert.equal(lib.computeLrclibRetryDelayMs('4', 0, () => 99), 5200);

    // 2. Response-like object with Headers.get()
    const mockResponse = {
      status: 429,
      headers: {
        get: name => (name.toLowerCase() === 'retry-after' ? '10' : null)
      }
    };
    assert.equal(lib.computeLrclibRetryDelayMs(mockResponse, 2, () => 0.2), 10600);

    // 3. HTTP-date Retry-After (future vs past)
    const fixedNow = Date.parse('2026-11-18T12:00:00Z');
    const futureHttpDate = new Date(fixedNow + 12000).toUTCString();
    const pastHttpDate = new Date(fixedNow - 8000).toUTCString();
    assert.equal(
      lib.computeLrclibRetryDelayMs(futureHttpDate, 0, () => 0, { nowMs: fixedNow }),
      12000
    );
    assert.equal(
      lib.computeLrclibRetryDelayMs(futureHttpDate, 0, () => 1, { nowMs: fixedNow }),
      15600
    );
    assert.equal(
      lib.computeLrclibRetryDelayMs(pastHttpDate, 0, () => 0.5, { nowMs: fixedNow }),
      0
    );

    // 4. Missing or malformed Retry-After falls back to base * 2^attempt + jitter, capped safely
    assert.equal(lib.computeLrclibRetryDelayMs(null, 0, () => 0), 1000);
    assert.equal(lib.computeLrclibRetryDelayMs(undefined, 1, () => 0), 2000);
    assert.equal(lib.computeLrclibRetryDelayMs('', 3, () => 0.5), Math.round(8000 * 1.15));
    assert.equal(lib.computeLrclibRetryDelayMs('not-a-valid-date', 2, () => 1), Math.round(4000 * 1.30));

    // Safe upper cap (default 60,000 ms)
    assert.equal(lib.computeLrclibRetryDelayMs(null, 12, () => 1), 60000);
    assert.equal(lib.computeLrclibRetryDelayMs('3600', 0, () => 1), 60000);
  });

  it('parseLyricsfileYaml & serializeLyricsfileYaml support CJK/Unicode, instrumental, multi-word sync & voice overlap', () => {
    const yamlInput = [
      '---',
      '# Lyricsfile YAML 1.0 test document',
      'version: "1.0"',
      'metadata:',
      '  title: "夜に駆ける — Đêm Sao Rơi \\"Live\\""',
      '  artist: "YOASOBI"',
      '  album: "THE BOOK: Edition 1"',
      '  duration_ms: 261000',
      '  instrumental: false',
      'lines:',
      '  - start_ms: 1200',
      '    end_ms: 5200',
      '    text: "沈むように溶けてゆくように"',
      '    voice: "lead"',
      '    words:',
      '      - start_ms: 1200',
      '        end_ms: 2800',
      '        text: "沈むように"',
      '      - start_ms: 2800',
      '        end_ms: 5200',
      '        text: "溶けてゆくように"',
      '  - start_ms: 3000',
      '    end_ms: 6000',
      '    text: "(Ahh-ahh harmony)"',
      '    voice: "backing"',
      '    backing: true'
    ].join('\n');

    const parsed = lib.parseLyricsfileYaml(yamlInput);
    assert.equal(parsed.version, '1.0');
    assert.equal(parsed.metadata.title, '夜に駆ける — Đêm Sao Rơi "Live"');
    assert.equal(parsed.metadata.artist, 'YOASOBI');
    assert.equal(parsed.metadata.album, 'THE BOOK: Edition 1');
    assert.equal(parsed.metadata.duration_ms, 261000);
    assert.equal(parsed.metadata.instrumental, false);
    assert.equal(parsed.lines.length, 2);

    assert.equal(parsed.lines[0].start_ms, 1200);
    assert.equal(parsed.lines[0].end_ms, 5200); // Preserves explicit overlap > next line's 3000ms!
    assert.equal(parsed.lines[0].voice, 'lead');
    assert.equal(parsed.lines[0].words.length, 2);
    assert.equal(parsed.lines[0].words[0].text, '沈むように');
    assert.equal(parsed.lines[0].words[1].text, '溶けてゆくように');

    assert.equal(parsed.lines[1].start_ms, 3000);
    assert.equal(parsed.lines[1].end_ms, 6000);
    assert.equal(parsed.lines[1].voice, 'backing');
    assert.equal(parsed.lines[1].backing, true);

    // Round-trip serialization
    const serialized = lib.serializeLyricsfileYaml(parsed);
    const roundTripped = lib.parseLyricsfileYaml(serialized);
    assert.deepEqual(roundTripped, parsed);

    // Instrumental document clears lines cleanly
    const instDoc = {
      version: '1.0',
      metadata: {
        title: ' Orion (Instrumental) ',
        artist: 'Metallica',
        album: 'Master of Puppets',
        duration_ms: 507000,
        instrumental: true
      },
      lines: [{ start_ms: 1000, end_ms: 2000, text: 'ghost line' }]
    };
    const instYaml = lib.serializeLyricsfileYaml(instDoc);
    assert.match(instYaml, /instrumental:\s*true/);
    assert.match(instYaml, /lines:\s*\[\]/);
    const parsedInst = lib.parseLyricsfileYaml(instYaml);
    assert.equal(parsedInst.metadata.instrumental, true);
    assert.deepEqual(parsedInst.lines, []);
  });

  it('findActiveLyricStateBinary resolves 0ms, mid-word progress, duration_ms, out-of-order & overlapping vocals in O(log N)', () => {
    // Deliberately out-of-order lines with vocal overlap + word sync
    const outOfOrderLines = [
      {
        start_ms: 9000,
        end_ms: 12000,
        text: 'Final chorus line',
        words: [
          { start_ms: 9000, end_ms: 10000, text: 'Final ' },
          { start_ms: 10000, end_ms: 11000, text: 'chorus ' },
          { start_ms: 11000, end_ms: 12000, text: 'line' }
        ]
      },
      {
        start_ms: 1000,
        end_ms: 7000,
        text: 'Sustained lead vocal',
        voice: 'lead',
        words: [
          { start_ms: 1000, end_ms: 3000, text: 'Sustained ' },
          { start_ms: 3000, end_ms: 5000, text: 'lead ' },
          { start_ms: 5000, end_ms: 7000, text: 'vocal' }
        ]
      },
      {
        start_ms: 2500,
        end_ms: 4000,
        text: '(Short backing echo)',
        voice: 'backing',
        backing: true
      }
    ];

    // 1. At 0ms (before first line at 1000ms)
    const atZero = lib.findActiveLyricStateBinary(outOfOrderLines, 0);
    assert.equal(atZero.lineIndex, -1);
    assert.equal(atZero.wordIndex, -1);
    assert.equal(atZero.activeLine, null);
    assert.equal(atZero.activeWord, null);
    assert.equal(atZero.progress, 0);

    // 2. Mid-word on lead line before backing enters (t = 2000ms -> halfway through [1000..3000] 'Sustained ')
    const midWord = lib.findActiveLyricStateBinary(outOfOrderLines, 2000);
    assert.equal(midWord.lineIndex, 1); // original index in outOfOrderLines!
    assert.equal(midWord.activeLine.text, 'Sustained lead vocal');
    assert.equal(midWord.wordIndex, 0);
    assert.equal(midWord.activeWord.text, 'Sustained ');
    assert.ok(Math.abs(midWord.progress - 0.5) < 1e-6);

    // 3. During overlap [2500..4000] (t = 3200ms -> rightmost spanning line is backing echo at index 2)
    const duringOverlap = lib.findActiveLyricStateBinary(outOfOrderLines, 3200);
    assert.equal(duringOverlap.lineIndex, 2);
    assert.equal(duringOverlap.activeLine.text, '(Short backing echo)');

    // 4. After short backing line ends (4000ms) while sustained lead [1000..7000] is STILL active (t = 5500ms)!
    const afterShortOverlap = lib.findActiveLyricStateBinary(outOfOrderLines, 5500);
    assert.equal(afterShortOverlap.lineIndex, 1);
    assert.equal(afterShortOverlap.activeLine.text, 'Sustained lead vocal');
    assert.equal(afterShortOverlap.wordIndex, 2);
    assert.equal(afterShortOverlap.activeWord.text, 'vocal');
    assert.ok(Math.abs(afterShortOverlap.progress - 0.25) < 1e-6); // (5500 - 5000) / (7000 - 5000)

    // 5. At track duration_ms (e.g. 180000ms, past final line end_ms 12000ms)
    const atDuration = lib.findActiveLyricStateBinary(outOfOrderLines, 180000);
    assert.equal(atDuration.lineIndex, 0);
    assert.equal(atDuration.activeLine.text, 'Final chorus line');
    assert.equal(atDuration.wordIndex, 2);
    assert.equal(atDuration.progress, 1);

    // Strict mode at duration_ms returns inactive (-1)
    const atDurationStrict = lib.findActiveLyricStateBinary(outOfOrderLines, 180000, { strict: true });
    assert.equal(atDurationStrict.lineIndex, -1);

    // 6. Scale test: 10,000 lines binary search executes rapidly
    const manyLines = Array.from({ length: 10000 }, (_, i) => ({
      start_ms: i * 1000,
      end_ms: i * 1000 + 900,
      text: `Line ${i}`
    }));
    const startNs = process.hrtime.bigint();
    for (let q = 0; q < 1000; q++) {
      const state = lib.findActiveLyricStateBinary(manyLines, (q * 9973) % 10000000);
      assert.ok(state.lineIndex >= 0 && state.lineIndex < 10000);
    }
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    assert.ok(elapsedMs < 250, `Expected 1,000 binary lookups over 10k lines < 250ms, took ${elapsedMs.toFixed(2)}ms`);
  });
});

describe('Autonomy Tail-Chaining Cycle 2 — OPT-01 (Zero-Allocation 60fps Frame Scratchpad & Band Energy Analyzer)', () => {
  it('reuses identical TypedArray & telemetry object references across 1,000 simulated 60fps frames', () => {
    assert.equal(typeof lib.createZeroAllocFrameScratchpad, 'function');
    const pad = lib.createZeroAllocFrameScratchpad(256);

    assert.ok(pad.freqBytes instanceof Uint8Array && pad.freqBytes.length === 256);
    assert.ok(pad.timeBytes instanceof Uint8Array && pad.timeBytes.length === 512);
    assert.ok(pad.normalizedBins instanceof Float32Array && pad.normalizedBins.length === 256);
    assert.ok(pad.timeFloats instanceof Float32Array && pad.timeFloats.length === 512);

    const initialFreqRef = pad.freqBytes;
    const initialTimeRef = pad.timeBytes;
    const initialNormRef = pad.normalizedBins;
    const initialTimeFloatRef = pad.timeFloats;
    const initialLeftTimeRef = pad.leftTimeBytes;
    const initialRightTimeRef = pad.rightTimeBytes;
    const initialTelemetryRef = pad.telemetry;

    const sampleLyrics = [
      { start_ms: 0, end_ms: 5000, text: 'Intro', words: [{ start_ms: 0, end_ms: 2500, text: 'In' }, { start_ms: 2500, end_ms: 5000, text: 'tro' }] },
      { start_ms: 5000, end_ms: 18000, text: 'Main verse', words: [{ start_ms: 5000, end_ms: 11000, text: 'Main ' }, { start_ms: 11000, end_ms: 18000, text: 'verse' }] }
    ];

    for (let frame = 0; frame < 1000; frame++) {
      assert.equal(pad.resizeIfNeeded(256), false);
      for (let i = 0; i < 256; i++) {
        pad.freqBytes[i] = (i + frame) & 255;
      }
      for (let j = 0; j < 512; j++) {
        pad.timeBytes[j] = 128 + Math.round(100 * Math.sin((2 * Math.PI * (j + frame)) / 64));
      }
      const tel = pad.computeBandEnergies(pad.freqBytes, pad.timeBytes, 48000);
      const synced = pad.syncLyricsInPlace(sampleLyrics, frame * 16.6667);

      assert.strictEqual(tel, initialTelemetryRef);
      assert.strictEqual(synced, initialTelemetryRef);
      assert.strictEqual(pad.freqBytes, initialFreqRef);
      assert.strictEqual(pad.timeBytes, initialTimeRef);
      assert.strictEqual(pad.normalizedBins, initialNormRef);
      assert.strictEqual(pad.timeFloats, initialTimeFloatRef);
      assert.strictEqual(pad.leftTimeBytes, initialLeftTimeRef);
      assert.strictEqual(pad.rightTimeBytes, initialRightTimeRef);
    }

    assert.equal(pad.telemetry.frameCount, 1000);
    assert.equal(pad.telemetry.activeLyricLine, 1);
    assert.equal(pad.telemetry.activeLyricWord, 1);

    // Resize only reallocates when FFT bin count actually changes
    assert.equal(pad.resizeIfNeeded(512), true);
    assert.equal(pad.binCount, 512);
    assert.equal(pad.fftSize, 1024);
    assert.equal(pad.freqBytes.length, 512);
    assert.equal(pad.timeBytes.length, 1024);
    const resizedFreqRef = pad.freqBytes;
    assert.equal(pad.resizeIfNeeded(512), false);
    assert.strictEqual(pad.freqBytes, resizedFreqRef);

    // Verify computeBandEnergies source contains zero .map, .filter, spread, or new allocations
    const fnBody = pad.computeBandEnergies.toString();
    assert.equal(/\.map\s*\(|\.filter\s*\(|\.\.\.|new\s+(?:Uint8Array|Float32Array|Array|Object)/.test(fnBody), false);
  });

  it('computes accurate bass, mid, treble energies, RMS & peak, and wires state.zeroAllocScratchpad in index.html', () => {
    const pad = lib.createZeroAllocFrameScratchpad(256); // fftSize=512; at 44100Hz binHz ≈ 86.13Hz

    // Pure Bass (bins 1..3 -> ~86Hz..258Hz)
    pad.freqBytes.fill(0);
    pad.freqBytes[1] = 255;
    pad.freqBytes[2] = 255;
    pad.freqBytes[3] = 255;
    pad.computeBandEnergies(pad.freqBytes, null, 44100);
    assert.ok(pad.telemetry.bassEnergy > 0.99);
    assert.equal(pad.telemetry.midEnergy, 0);
    assert.equal(pad.telemetry.trebleEnergy, 0);

    // Pure Mid (bins 4..46 -> ~344Hz..3962Hz)
    pad.freqBytes.fill(0);
    for (let i = 4; i <= 46; i++) pad.freqBytes[i] = 255;
    pad.computeBandEnergies(pad.freqBytes, null, 44100);
    assert.equal(pad.telemetry.bassEnergy, 0);
    assert.ok(pad.telemetry.midEnergy > 0.99);
    assert.equal(pad.telemetry.trebleEnergy, 0);

    // Pure Treble (bins 47..255 -> >4000Hz)
    pad.freqBytes.fill(0);
    for (let i = 47; i < 256; i++) pad.freqBytes[i] = 255;
    pad.computeBandEnergies(pad.freqBytes, null, 44100);
    assert.equal(pad.telemetry.bassEnergy, 0);
    assert.equal(pad.telemetry.midEnergy, 0);
    assert.ok(pad.telemetry.trebleEnergy > 0.99);

    // Full-scale Float32 sine wave time-domain RMS (~0.7071) & Peak (~1.0)
    const sineTime = new Float32Array(512);
    for (let j = 0; j < 512; j++) {
      sineTime[j] = Math.sin((2 * Math.PI * 8 * j) / 512);
    }
    pad.computeBandEnergies(pad.freqBytes, sineTime, 44100);
    assert.ok(Math.abs(pad.telemetry.rms - Math.SQRT1_2) < 0.01);
    assert.ok(pad.telemetry.peak > 0.99);

    // Verify index.html wiring & audio graph invariant preservation
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('zeroAllocScratchpad:'), 'state.zeroAllocScratchpad must be initialized in index.html');
    assert.ok(indexHtml.includes('scratchpad.computeBandEnergies('), 'visualizer loop must compute band energies via scratchpad');
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT must remain intact'
    );
  });
});
