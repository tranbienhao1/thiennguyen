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

describe('Autonomy Tail-Chaining Cycle 3 — BUG-02 (Safe FLAC/WAV/RF64/AIFF/DSF/DFF Binary Header Parser & Fuzz Protection)', () => {
  function encodeIeee80(rate) {
    // Encode positive integer sample rates (e.g. 44100..384000) into 10-byte big-endian IEEE 754 extended
    const out = new Uint8Array(10);
    if (rate <= 0) return out;
    const exp = Math.floor(Math.log2(rate));
    const biased = 16383 + exp;
    const mantissa = Math.round((rate / Math.pow(2, exp)) * Math.pow(2, 31)) >>> 0;
    out[0] = (biased >> 8) & 0x7f;
    out[1] = biased & 0xff;
    out[2] = (mantissa >>> 24) & 0xff;
    out[3] = (mantissa >>> 16) & 0xff;
    out[4] = (mantissa >>> 8) & 0xff;
    out[5] = mantissa & 0xff;
    return out;
  }

  it('never throws RangeError on 0-byte, 1-byte, arbitrary byte-offset views, or exhaustive prefix truncations', () => {
    assert.equal(typeof lib.parseSafeAudioContainerMetadata, 'function');

    // 0-byte, 1-byte, null, primitive, and offset DataView edge cases
    assert.equal(lib.parseSafeAudioContainerMetadata(null).valid, false);
    assert.equal(lib.parseSafeAudioContainerMetadata(undefined).valid, false);
    assert.equal(lib.parseSafeAudioContainerMetadata(new ArrayBuffer(0)).byteLength, 0);
    assert.equal(lib.parseSafeAudioContainerMetadata(new ArrayBuffer(1)).truncated, true);
    assert.equal(lib.parseSafeAudioContainerMetadata(new Uint8Array([0xff])).truncated, true);

    const backing = new ArrayBuffer(32);
    const slicedView = new DataView(backing, 17, 5);
    assert.doesNotThrow(() => lib.parseSafeAudioContainerMetadata(slicedView));
  });

  it('parses FLAC STREAMINFO & safely skips oversized/truncated METADATA_BLOCK_PICTURE without RangeError', () => {
    // Build ID3v2 (20 bytes) + fLaC (4) + STREAMINFO (38) + truncated 8MB PICTURE block header (12 bytes)
    const buf = new Uint8Array(20 + 4 + 38 + 12);
    const dv = new DataView(buf.buffer);
    // 10-byte ID3 header with synchsafe size = 10 -> baseOffset = 20
    buf.set(Buffer.from('ID3'), 0);
    buf[3] = 4;
    buf[9] = 10;

    let p = 20;
    buf.set(Buffer.from('fLaC'), p);
    p += 4;
    buf[p] = 0x00; // STREAMINFO, not last
    buf[p + 1] = 0; buf[p + 2] = 0; buf[p + 3] = 34;
    const si = p + 4;
    // 96000 Hz = 0x17700, 2 channels, 24-bit, 960000 total samples (10.0s)
    buf[si + 10] = (96000 >> 12) & 0xff;
    buf[si + 11] = (96000 >> 4) & 0xff;
    buf[si + 12] = ((96000 & 0x0f) << 4) | ((2 - 1) << 1) | (((24 - 1) >> 4) & 0x01);
    buf[si + 13] = (((24 - 1) & 0x0f) << 4) | 0x00;
    dv.setUint32(si + 14, 960000, false);

    // Oversized PICTURE block (type 6, isLast=true) declaring 8MB inside a tiny 74-byte buffer!
    const pic = si + 34;
    buf[pic] = 0x80 | 6;
    buf[pic + 1] = 0x80; buf[pic + 2] = 0x00; buf[pic + 3] = 0x00; // ~8MB

    const meta = lib.parseSafeAudioContainerMetadata(buf.buffer);
    assert.equal(meta.valid, true);
    assert.equal(meta.format, 'FLAC');
    assert.equal(meta.sampleRate, 96000);
    assert.equal(meta.channels, 2);
    assert.equal(meta.bitDepth, 24);
    assert.ok(Math.abs(meta.durationSeconds - 10) < 1e-6);
    assert.equal(meta.truncated, true);
    assert.equal(meta.skippedPictureBlocks, 1);

    // Fuzz every prefix length 0..buf.length -> 0 RangeError throws!
    for (let len = 0; len <= buf.length; len++) {
      assert.doesNotThrow(() => lib.parseSafeAudioContainerMetadata(buf.subarray(0, len)));
    }
  });

  it('parses WAV with odd-byte-padded JUNK/bext/LIST chunks, RF64 64-bit ds64, and AIFF 80-bit IEEE float', () => {
    // 1. WAV with odd-sized JUNK (5 bytes + 1 pad) + odd-sized bext (7 bytes + 1 pad) + LIST (4 bytes) + fmt + data
    const wav = new Uint8Array(12 + (8 + 6) + (8 + 8) + (8 + 4) + (8 + 16) + 8);
    const wv = new DataView(wav.buffer);
    wav.set(Buffer.from('RIFF'), 0);
    wv.setUint32(4, wav.byteLength - 8, true);
    wav.set(Buffer.from('WAVE'), 8);

    let o = 12;
    wav.set(Buffer.from('JUNK'), o);
    wv.setUint32(o + 4, 5, true); // odd 5 bytes -> padded by +1 byte!
    o += 8 + 5 + 1;

    wav.set(Buffer.from('bext'), o);
    wv.setUint32(o + 4, 7, true); // odd 7 bytes -> padded by +1 byte!
    o += 8 + 7 + 1;

    wav.set(Buffer.from('LIST'), o);
    wv.setUint32(o + 4, 4, true);
    o += 8 + 4;

    wav.set(Buffer.from('fmt '), o);
    wv.setUint32(o + 4, 16, true);
    wv.setUint16(o + 8, 1, true); // PCM
    wv.setUint16(o + 10, 2, true); // 2ch
    wv.setUint32(o + 12, 192000, true); // 192kHz
    wv.setUint32(o + 16, 192000 * 6, true); // byteRate (2ch * 24-bit)
    wv.setUint16(o + 20, 6, true);
    wv.setUint16(o + 22, 24, true); // 24-bit
    o += 24;

    wav.set(Buffer.from('data'), o);
    wv.setUint32(o + 4, 192000 * 6 * 5, true); // 5.0 seconds declared, tail truncated in slice!

    const wavMeta = lib.parseSafeAudioContainerMetadata(wav);
    assert.equal(wavMeta.valid, true);
    assert.equal(wavMeta.format, 'WAV');
    assert.equal(wavMeta.sampleRate, 192000);
    assert.equal(wavMeta.channels, 2);
    assert.equal(wavMeta.bitDepth, 24);
    assert.ok(Math.abs(wavMeta.durationSeconds - 5) < 1e-6);
    assert.deepEqual(wavMeta.skippedChunks, ['JUNK', 'bext', 'LIST']);
    assert.equal(wavMeta.truncated, true);

    for (let len = 0; len <= wav.length; len++) {
      assert.doesNotThrow(() => lib.parseSafeAudioContainerMetadata(wav.subarray(0, len)));
    }

    // 2. RF64 container with ds64 64-bit dataSize (> 4GB = 5,760,000,000 bytes -> 5000s at 192kHz/24-bit/2ch)
    const rf64 = new Uint8Array(12 + 36 + 24 + 8);
    const rv = new DataView(rf64.buffer);
    rf64.set(Buffer.from('RF64'), 0);
    rv.setUint32(4, 0xffffffff, true);
    rf64.set(Buffer.from('WAVE'), 8);
    rf64.set(Buffer.from('ds64'), 12);
    rv.setUint32(16, 28, true);
    rv.setBigUint64(20 + 8, 5760000000n, true); // 64-bit dataSize
    rf64.set(Buffer.from('fmt '), 48);
    rv.setUint32(52, 16, true);
    rv.setUint16(56, 1, true);
    rv.setUint16(58, 2, true);
    rv.setUint32(60, 192000, true);
    rv.setUint32(64, 192000 * 6, true);
    rv.setUint16(70, 24, true);
    rf64.set(Buffer.from('data'), 72);
    rv.setUint32(76, 0xffffffff, true);

    const rfMeta = lib.parseSafeAudioContainerMetadata(rf64);
    assert.equal(rfMeta.valid, true);
    assert.equal(rfMeta.format, 'RF64');
    assert.equal(rfMeta.sampleRate, 192000);
    assert.ok(Math.abs(rfMeta.durationSeconds - 5000) < 1e-3);

    // 3. AIFF container (FORM....AIFF + COMM 192kHz/24-bit/2ch + SSND)
    const aiff = new Uint8Array(12 + 26 + 16);
    const av = new DataView(aiff.buffer);
    aiff.set(Buffer.from('FORM'), 0);
    av.setUint32(4, aiff.byteLength - 8, false);
    aiff.set(Buffer.from('AIFF'), 8);
    aiff.set(Buffer.from('COMM'), 12);
    av.setUint32(16, 18, false);
    av.setUint16(20, 2, false); // 2 channels
    av.setUint32(22, 192000 * 4, false); // 4.0s sample frames
    av.setUint16(26, 24, false); // 24-bit
    aiff.set(encodeIeee80(192000), 28);
    aiff.set(Buffer.from('SSND'), 38);
    av.setUint32(42, 8192, false);

    const aiffMeta = lib.parseSafeAudioContainerMetadata(aiff);
    assert.equal(aiffMeta.valid, true);
    assert.equal(aiffMeta.format, 'AIFF');
    assert.equal(aiffMeta.sampleRate, 192000);
    assert.equal(aiffMeta.channels, 2);
    assert.equal(aiffMeta.bitDepth, 24);
    assert.ok(Math.abs(aiffMeta.durationSeconds - 4) < 1e-6);
  });

  it('parses LSB-first .dsf (DSD64/128/256) & MSB-first .dff headers and handles truncated DSD tails safely', () => {
    // 1. LSB-first DSF across DSD64 (2.8224MHz), DSD128 (5.6448MHz), DSD256 (11.2896MHz)
    for (const [rate, expectedLabel] of [[2822400, 'DSD64'], [5644800, 'DSD128'], [11289600, 'DSD256']]) {
      const dsf = new Uint8Array(92);
      const dv = new DataView(dsf.buffer);
      dsf.set(Buffer.from('DSD '), 0);
      dv.setBigUint64(4, 28n, true);
      dv.setBigUint64(12, BigInt(92 + 65536), true); // declared larger than header slice
      dsf.set(Buffer.from('fmt '), 28);
      dv.setBigUint64(32, 52n, true);
      dv.setUint32(40, 1, true);
      dv.setUint32(52, 2, true); // stereo
      dv.setUint32(56, rate, true);
      dv.setUint32(60, 1, true); // LSB-first 1-bit
      dv.setBigUint64(64, BigInt(rate * 12), true); // 12.0s
      dv.setUint32(72, 4096, true);
      dsf.set(Buffer.from('data'), 80);
      dv.setBigUint64(84, BigInt(12 + 65536), true);

      const meta = lib.parseSafeAudioContainerMetadata(dsf);
      assert.equal(meta.valid, true);
      assert.equal(meta.format, 'DSF');
      assert.equal(meta.dsdRateLabel, expectedLabel);
      assert.equal(meta.bitOrder, 'lsb');
      assert.equal(meta.sampleRate, rate);
      assert.equal(meta.channels, 2);
      assert.equal(meta.bitDepth, 1);
      assert.ok(Math.abs(meta.durationSeconds - 12) < 1e-6);
      assert.equal(meta.truncated, true);

      for (let len = 0; len <= dsf.length; len++) {
        assert.doesNotThrow(() => lib.parseSafeAudioContainerMetadata(dsf.subarray(0, len)));
      }
    }

    // 2. MSB-first DFF (FRM8 ... DSD ) with odd-byte subchunk in PROP + truncated DSD data tail
    const dff = new Uint8Array(16 + 12 + (4 + 16 + 15 + 16) + 1 + 12);
    const fv = new DataView(dff.buffer);
    dff.set(Buffer.from('FRM8'), 0);
    fv.setBigUint64(4, 1000000n, false);
    dff.set(Buffer.from('DSD '), 12);

    // PROP chunk of odd size = 51 bytes (+ 1 pad byte)
    dff.set(Buffer.from('PROP'), 16);
    fv.setBigUint64(20, 51n, false);
    dff.set(Buffer.from('SND '), 28);
    let sp = 32;
    dff.set(Buffer.from('FS  '), sp); fv.setBigUint64(sp + 4, 4n, false); fv.setUint32(sp + 12, 5644800, false); sp += 16; // DSD128
    dff.set(Buffer.from('CHNL'), sp); fv.setBigUint64(sp + 4, 3n, false); fv.setUint16(sp + 12, 2, false); sp += 12 + 3 + 1; // odd 3-byte subchunk + 1 pad!
    dff.set(Buffer.from('CMPR'), sp - 1); // Wait: keep exact prop bounds clean:
    // Re-encode clean PROP with odd-length ID3/meta chunk before PROP to test top-level odd chunk padding too!
    const dffClean = new Uint8Array(16 + (12 + 5 + 1) + (12 + 50) + 12);
    const cv = new DataView(dffClean.buffer);
    dffClean.set(Buffer.from('FRM8'), 0);
    cv.setBigUint64(4, 2000000n, false);
    dffClean.set(Buffer.from('DSD '), 12);
    // Odd 5-byte FVER/meta chunk (+1 pad byte)
    dffClean.set(Buffer.from('COMT'), 16);
    cv.setBigUint64(20, 5n, false);
    let cp = 16 + 12 + 5 + 1;
    dffClean.set(Buffer.from('PROP'), cp);
    cv.setBigUint64(cp + 4, 50n, false);
    dffClean.set(Buffer.from('SND '), cp + 12);
    let sub = cp + 16;
    dffClean.set(Buffer.from('FS  '), sub); cv.setBigUint64(sub + 4, 4n, false); cv.setUint32(sub + 12, 5644800, false); sub += 16;
    dffClean.set(Buffer.from('CHNL'), sub); cv.setBigUint64(sub + 4, 2n, false); cv.setUint16(sub + 12, 2, false); sub += 14;
    dffClean.set(Buffer.from('CMPR'), sub); cv.setBigUint64(sub + 4, 4n, false); dffClean.set(Buffer.from('DSD '), sub + 12);
    cp += 12 + 50;
    dffClean.set(Buffer.from('DSD '), cp);
    // 10 seconds of stereo DSD128 = (5644800 * 2 / 8) * 10 = 14,112,000 bytes
    cv.setBigUint64(cp + 4, 14112000n, false);

    const dffMeta = lib.parseSafeAudioContainerMetadata(dffClean);
    assert.equal(dffMeta.valid, true);
    assert.equal(dffMeta.format, 'DFF');
    assert.equal(dffMeta.dsdRateLabel, 'DSD128');
    assert.equal(dffMeta.bitOrder, 'msb');
    assert.equal(dffMeta.sampleRate, 5644800);
    assert.equal(dffMeta.channels, 2);
    assert.equal(dffMeta.bitDepth, 1);
    assert.ok(Math.abs(dffMeta.durationSeconds - 10) < 1e-6);
    assert.equal(dffMeta.truncated, true);

    for (let len = 0; len <= dffClean.length; len++) {
      assert.doesNotThrow(() => lib.parseSafeAudioContainerMetadata(dffClean.subarray(0, len)));
    }
  });
});

describe('Autonomy Tail-Chaining Cycle 4 — UPG-02 (SHA-256 64KB + file_size Fingerprint & Rename-Resilient Lyrics/Metadata Cache)', () => {
  const nodeCrypto = require('node:crypto');

  function createMockIndexedDB() {
    const dbs = new Map();
    return {
      open(name, version = 1) {
        const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
          let dbEntry = dbs.get(name);
          const isNew = !dbEntry || dbEntry.version < version;
          if (!dbEntry) {
            dbEntry = { version, stores: new Map() };
            dbs.set(name, dbEntry);
          } else {
            dbEntry.version = version;
          }
          const db = {
            objectStoreNames: {
              contains: s => dbEntry.stores.has(s)
            },
            createObjectStore(s, opts = {}) {
              const map = new Map();
              dbEntry.stores.set(s, { keyPath: opts.keyPath || 'fingerprintKey', map });
              return {};
            },
            transaction(s) {
              const storeRec = dbEntry.stores.get(s);
              const tx = { oncomplete: null, onerror: null, onabort: null };
              const objStore = {
                get(key) {
                  const r = { result: undefined, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    r.result = storeRec && storeRec.map.has(key) ? structuredClone(storeRec.map.get(key)) : undefined;
                    if (r.onsuccess) r.onsuccess();
                    if (tx.oncomplete) tx.oncomplete();
                  });
                  return r;
                },
                put(val) {
                  const k = val[storeRec.keyPath];
                  storeRec.map.set(k, structuredClone(val));
                  queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
                  return {};
                },
                delete(key) {
                  storeRec.map.delete(key);
                  queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
                  return {};
                },
                clear() {
                  storeRec.map.clear();
                  queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
                  return {};
                }
              };
              return Object.assign(tx, { objectStore: () => objStore });
            }
          };
          req.result = db;
          if (isNew && req.onupgradeneeded) req.onupgradeneeded();
          if (req.onsuccess) req.onsuccess();
        });
        return req;
      },
      _dbs: dbs
    };
  }

  it('exposes UPG-02 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.computeAudioFingerprint64k, 'function');
    assert.equal(typeof lib.computeAudioFingerprint64kAsync, 'function');
    assert.equal(typeof lib.computeFastFingerprintKey, 'function');
    assert.equal(typeof lib.createFingerprintLyricsCacheStore, 'function');

    const sandbox = { library: { keepExisting: 42 } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.computeAudioFingerprint64k, 'function');
    assert.equal(typeof sandbox.library.computeAudioFingerprint64kAsync, 'function');
    assert.equal(typeof sandbox.library.computeFastFingerprintKey, 'function');
    assert.equal(typeof sandbox.library.createFingerprintLyricsCacheStore, 'function');
    assert.equal(sandbox.library.keepExisting, 42);
  });

  it('computes exact SHA-256 64KB + :fileSize keys across 0-byte, <64KB, >64KB, and renamed files', async () => {
    // 1. 0-byte file
    const emptySync = lib.computeAudioFingerprint64k(new Uint8Array(0), 0);
    const emptyAsync = await lib.computeAudioFingerprint64kAsync(new Blob([]), 0);
    const expectedZeroHex = nodeCrypto.createHash('sha256').update(Buffer.from(':0')).digest('hex');
    assert.equal(emptySync.sampledBytes, 0);
    assert.equal(emptySync.fileSize, 0);
    assert.equal(emptySync.hashHex, expectedZeroHex);
    assert.equal(emptySync.fingerprintKey, `sha256-64k:${expectedZeroHex.slice(0, 16)}:0`);
    assert.deepEqual(emptyAsync, emptySync);

    // 2. <64KB file (12,345 bytes)
    const smallBytes = new Uint8Array(12345);
    for (let i = 0; i < smallBytes.length; i++) smallBytes[i] = (i * 31 + 7) & 0xff;
    const expectedSmallHex = nodeCrypto.createHash('sha256')
      .update(Buffer.concat([Buffer.from(smallBytes), Buffer.from(':12345')]))
      .digest('hex');
    const smallAsync = await lib.computeAudioFingerprint64kAsync(new Blob([smallBytes]));
    const smallSync = lib.computeAudioFingerprint64k(smallBytes);
    assert.equal(smallAsync.sampledBytes, 12345);
    assert.equal(smallAsync.fileSize, 12345);
    assert.equal(smallAsync.hashHex, expectedSmallHex);
    assert.deepEqual(smallSync, smallAsync);
    assert.equal(lib.computeFastFingerprintKey(smallBytes, 12345), smallAsync.fingerprintKey);

    // 3. >64KB file (140,000 bytes) + rename resilience
    const largeBytes = new Uint8Array(140000);
    for (let i = 0; i < largeBytes.length; i++) largeBytes[i] = (i * 131 + 17) & 0xff;

    const originalFile = Object.assign(new Blob([largeBytes], { type: 'audio/flac' }), {
      name: '01 - Original Track Name.flac',
      path: '/Music/Original/01 - Original Track Name.flac'
    });
    const renamedFile = Object.assign(new Blob([largeBytes], { type: 'audio/flac' }), {
      name: '99 - Completely Renamed Master Edition.flac',
      path: '/Archive/Lossless/99 - Completely Renamed Master Edition.flac'
    });

    const fpOriginal = await lib.computeAudioFingerprint64kAsync(originalFile);
    const fpRenamed = await lib.computeAudioFingerprint64kAsync(renamedFile);
    const fpSyncHead = lib.computeAudioFingerprint64k(largeBytes.subarray(0, 65536), largeBytes.byteLength);

    assert.equal(fpOriginal.sampledBytes, 65536);
    assert.equal(fpOriginal.fileSize, 140000);
    assert.deepEqual(fpRenamed, fpOriginal, 'Renaming a file MUST preserve exact 64KB SHA-256 + fileSize fingerprint');
    assert.deepEqual(fpSyncHead, fpOriginal);

    // Changing fileSize alters fingerprint even with identical 64KB head
    const fpDiffSize = lib.computeAudioFingerprint64k(largeBytes.subarray(0, 65536), 140001);
    assert.notEqual(fpDiffSize.fingerprintKey, fpOriginal.fingerprintKey);
  });

  it('stores rename-resilient lyrics/metadata with LRU eviction & IndexedDB persistence', async () => {
    // 1. In-memory LRU fallback in Node with maxEntries = 3
    let clock = 1700000000000;
    const memStore = lib.createFingerprintLyricsCacheStore({
      maxEntries: 3,
      indexedDB: null,
      nowFn: () => ++clock
    });
    assert.equal(memStore.getStats().backend, 'memory-lru');

    const audioA = new Uint8Array(80000).fill(0xaa);
    const audioB = new Uint8Array(80000).fill(0xbb);
    const audioC = new Uint8Array(80000).fill(0xcc);
    const audioD = new Uint8Array(80000).fill(0xdd);

    const { fingerprint: fpA } = await memStore.setByAudio(new Blob([audioA]), audioA.byteLength, {
      syncedLyrics: '[00:01.00] First line A',
      plainLyrics: 'First line A',
      instrumental: false,
      metadata: { title: 'Song A', artist: 'Artist A', sampleRate: 96000 }
    });
    const fpB = await lib.computeAudioFingerprint64kAsync(audioB, audioB.byteLength);
    const fpC = await lib.computeAudioFingerprint64kAsync(audioC, audioC.byteLength);
    const fpD = await lib.computeAudioFingerprint64kAsync(audioD, audioD.byteLength);

    await memStore.set(fpB.fingerprintKey, {
      syncedLyrics: '[00:02.00] Line B',
      plainLyrics: 'Line B',
      instrumental: false,
      metadata: { title: 'Song B' }
    });
    await memStore.set(fpC.fingerprintKey, {
      lyricsRaw: '',
      syncedLyrics: '',
      plainLyrics: '',
      instrumental: true,
      metadata: { title: 'Song C (Instrumental)' }
    });

    // Touch A (simulate lookup after file rename -> same binary audioA) so B becomes LRU victim!
    const renamedLookup = await memStore.getByAudio(new Blob([audioA]), audioA.byteLength);
    assert.ok(renamedLookup.entry);
    assert.equal(renamedLookup.entry.syncedLyrics, '[00:01.00] First line A');
    assert.equal(renamedLookup.entry.metadata.sampleRate, 96000);

    // Insert D -> maxEntries=3 must evict B while preserving C, A, D
    await memStore.set(fpD.fingerprintKey, {
      syncedLyrics: '[00:04.00] Line D',
      plainLyrics: 'Line D',
      instrumental: false,
      metadata: { title: 'Song D' }
    });

    assert.equal(await memStore.get(fpB.fingerprintKey), null, 'Least-recently-used entry B must be evicted');
    assert.ok(await memStore.get(fpA.fingerprintKey), 'Recently accessed entry A must survive LRU eviction');
    assert.equal((await memStore.get(fpC.fingerprintKey)).instrumental, true);
    assert.equal((await memStore.get(fpD.fingerprintKey)).metadata.title, 'Song D');
    assert.equal(memStore.getStats().evictions, 1);

    // 2. IndexedDB-backed persistence across cold reload
    const mockIdb = createMockIndexedDB();
    const idbStore1 = lib.createFingerprintLyricsCacheStore({
      indexedDB: mockIdb,
      maxEntries: 2
    });
    assert.equal(idbStore1.getStats().backend, 'indexeddb+lru');
    await idbStore1.set(fpA.fingerprintKey, {
      lyricsRaw: '[00:05.00] Persisted in IDB',
      syncedLyrics: '[00:05.00] Persisted in IDB',
      plainLyrics: 'Persisted in IDB',
      instrumental: false,
      metadata: { album: 'Hi-Res Vault' },
      updatedAt: 1700000123456
    });

    // Fresh store instance (empty memory map) reads seamlessly from IndexedDB
    const idbStore2 = lib.createFingerprintLyricsCacheStore({
      indexedDB: mockIdb,
      maxEntries: 2
    });
    const reloaded = await idbStore2.get(fpA.fingerprintKey);
    assert.ok(reloaded);
    assert.equal(reloaded.syncedLyrics, '[00:05.00] Persisted in IDB');
    assert.equal(reloaded.metadata.album, 'Hi-Res Vault');
    assert.equal(reloaded.updatedAt, 1700000123456);
  });
});

describe('Autonomy Tail-Chaining Cycle 5 — OPT-02 (Proactive OAuth Token Refresh Scheduler & Guarded Player Keyboard Shortcuts)', () => {
  it('exposes OPT-02 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createProactiveOAuthTokenRefreshScheduler, 'function');
    assert.equal(typeof lib.resolvePlayerKeyboardShortcut, 'function');
    assert.equal(typeof lib.isEditableKeyboardTarget, 'function');

    const sandbox = { library: { sentinel: 'ok' } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createProactiveOAuthTokenRefreshScheduler, 'function');
    assert.equal(typeof sandbox.library.createProactiveOAuthTokenRefreshScheduler, 'function');
    assert.equal(typeof sandbox.library.resolvePlayerKeyboardShortcut, 'function');
    assert.equal(sandbox.library.sentinel, 'ok');
  });

  it('computes 5-minute proactive refresh lead window, deduplicates concurrent in-flight refreshes, and pauses/resumes across offline/online', async () => {
    let now = 1_000_000;
    let online = true;
    let refreshCalls = 0;
    let scheduledTimer = null;
    const listeners = new Map();

    const mockEventTarget = {
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      emit(type) { const fn = listeners.get(type); if (fn) fn(); }
    };

    let releaseRefresh = null;
    const scheduler = lib.createProactiveOAuthTokenRefreshScheduler({
      leadTimeMs: 300_000, // 5 minutes
      nowFn: () => now,
      isOnlineFn: () => online,
      eventTarget: mockEventTarget,
      setTimer: (fn, delayMs) => {
        const handle = { id: Math.random(), fn, delayMs, cleared: false };
        scheduledTimer = handle;
        return handle;
      },
      clearTimer: handle => {
        if (handle) handle.cleared = true;
        if (scheduledTimer === handle) scheduledTimer = null;
      },
      refreshFn: () => {
        refreshCalls++;
        return new Promise(resolve => {
          releaseRefresh = resolve;
        });
      }
    });

    const expiresAt = now + 3600_000; // +60 minutes (4,600,000)

    // 1. shouldRefreshSoon checks 5-minute lead window accurately
    assert.equal(scheduler.shouldRefreshSoon(0, now), false);
    assert.equal(scheduler.shouldRefreshSoon(null, now), false);
    assert.equal(scheduler.shouldRefreshSoon(expiresAt, expiresAt - 300_001), false);
    assert.equal(scheduler.shouldRefreshSoon(expiresAt, expiresAt - 300_000), true);
    assert.equal(scheduler.shouldRefreshSoon(expiresAt, expiresAt - 10_000), true);
    assert.equal(scheduler.shouldRefreshSoon(expiresAt, expiresAt + 5_000), true);

    // 2. scheduleRefresh arms timer exactly (60m - 5m = 55m = 3,300,000ms) ahead
    const plan = scheduler.scheduleRefresh(expiresAt);
    assert.equal(plan.scheduled, true);
    assert.equal(plan.delayMs, 3_300_000);
    assert.ok(scheduledTimer && scheduledTimer.delayMs === 3_300_000);

    // 3. In-flight deduplication: 8 concurrent refreshNow() calls invoke refreshFn ONCE
    const concurrentPromises = Array.from({ length: 8 }, () => scheduler.refreshNow());
    assert.equal(refreshCalls, 1);
    assert.equal(scheduler.getState().inFlight, true);

    now = 4_300_000;
    releaseRefresh({ access_token: 'ya29.refreshed_1', expires_in: 3600 });
    const results = await Promise.all(concurrentPromises);
    assert.equal(refreshCalls, 1);
    for (const r of results) {
      assert.equal(r.access_token, 'ya29.refreshed_1');
    }
    assert.equal(scheduler.getState().inFlight, false);
    assert.equal(scheduler.getState().refreshCount, 1);
    // Auto-rescheduled for next token cycle (now + 3600s - 300s = 3,300,000ms)
    assert.equal(scheduler.getState().scheduledExpiresAt, 4_300_000 + 3_600_000);

    // 4. Offline pause & Online resume inside lead window
    const nearExpiry = now + 120_000; // only 2m remaining (< 5m lead)
    scheduler.scheduleRefresh(nearExpiry);
    online = false;
    mockEventTarget.emit('offline');
    assert.equal(scheduler.getState().pausedOffline, true);
    assert.equal(scheduler.getState().hasActiveTimer, false);

    // Calling refreshNow while offline defers without hitting network
    const offlineAttempt = await scheduler.refreshNow();
    assert.equal(offlineAttempt, null);
    assert.equal(refreshCalls, 1);

    // Coming back online immediately resumes deferred refresh!
    online = true;
    mockEventTarget.emit('online');
    assert.equal(refreshCalls, 2);
    releaseRefresh({ accessToken: 'ya29.after_online', expiresAt: now + 3_600_000 });
    await new Promise(r => setImmediate(r));
    assert.equal(scheduler.getState().refreshCount, 2);

    // 5. cancel() & dispose() clean up timers and listeners
    scheduler.cancel();
    assert.equal(scheduler.getState().hasActiveTimer, false);
    assert.equal(scheduler.getState().scheduledExpiresAt, 0);
    scheduler.dispose();
    assert.equal(listeners.size, 0);
  });

  it('resolves player keyboard shortcuts with zero allocation and strictly guards inputs, contenteditable & modifiers', () => {
    // 1. Valid shortcuts on neutral body/div target
    const bodyTarget = { tagName: 'BODY' };
    const rSpace = lib.resolvePlayerKeyboardShortcut({ key: ' ', code: 'Space', target: bodyTarget });
    assert.deepEqual(rSpace, { action: 'togglePlayPause', key: 'Space', deltaSeconds: 0, preventDefault: true });
    // Frozen singleton reference (zero per-keypress allocation)
    assert.strictEqual(
      lib.resolvePlayerKeyboardShortcut({ key: ' ', code: 'Space', target: bodyTarget }),
      rSpace
    );

    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'ArrowLeft', target: bodyTarget }),
      { action: 'seek', key: 'ArrowLeft', deltaSeconds: -5, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'ArrowRight', target: bodyTarget }),
      { action: 'seek', key: 'ArrowRight', deltaSeconds: 5, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'ArrowRight', shiftKey: true, target: bodyTarget }),
      { action: 'seek', key: 'ArrowRight', deltaSeconds: 10, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'j', target: bodyTarget }),
      { action: 'seek', key: 'j', deltaSeconds: -10, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'K', shiftKey: true, target: bodyTarget }),
      { action: 'seek', key: 'k', deltaSeconds: 10, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'M', target: bodyTarget }),
      { action: 'toggleMute', key: 'm', deltaSeconds: 0, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'l', target: bodyTarget }),
      { action: 'toggleLyrics', key: 'l', deltaSeconds: 0, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'f', target: bodyTarget }),
      { action: 'focusSearch', key: 'f', deltaSeconds: 0, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: '/', target: bodyTarget }),
      { action: 'focusSearch', key: '/', deltaSeconds: 0, preventDefault: true }
    );

    // 2. Strictly ignores <input>, <textarea>, <select>, and [contenteditable="true"] (including nested children!)
    const editableTargets = [
      { tagName: 'INPUT' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'DIV', getAttribute: attr => (attr === 'contenteditable' ? 'true' : null) },
      { tagName: 'SPAN', parentElement: { tagName: 'DIV', contentEditable: 'true' } },
      { tagName: 'DIV', role: 'textbox' }
    ];
    for (const target of editableTargets) {
      for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'j', 'k', 'm', 'l', 'f', '/']) {
        assert.equal(
          lib.resolvePlayerKeyboardShortcut({ key, code: key === ' ' ? 'Space' : '', target }),
          null,
          `Must ignore '${key}' when focused inside editable target ${target.tagName}`
        );
        assert.equal(
          lib.resolvePlayerKeyboardShortcut(
            { key, code: key === ' ' ? 'Space' : '', target: bodyTarget },
            { activeElement: target }
          ),
          null,
          `Must ignore '${key}' when context.activeElement is editable ${target.tagName}`
        );
      }
    }

    // 3. Strictly ignores Ctrl / Meta / Alt modifier combinations (browser shortcut protection)
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'j', 'k', 'm', 'l', 'f', '/']) {
        assert.equal(
          lib.resolvePlayerKeyboardShortcut({ key, target: bodyTarget, ...mod }),
          null,
          `Must ignore '${key}' when modifier ${JSON.stringify(mod)} is held`
        );
      }
    }

    // 4. Verify index.html wiring and audio graph invariant
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('library.createProactiveOAuthTokenRefreshScheduler('));
    assert.ok(indexHtml.includes('library.resolvePlayerKeyboardShortcut('));
    assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  });
});

describe('Autonomy Tail-Chaining Cycle 6 — BUG-03 (Nyquist Biquad Clamping & AudioNode Graph sampleRate Reconciliation)', () => {
  it('exposes BUG-03 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.validateAndClampAudioGraphParams, 'function');
    assert.equal(typeof lib.reconcileAudioNodeGraphForSampleRate, 'function');

    const sandbox = { library: { keepRef: 'intact' } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.validateAndClampAudioGraphParams, 'function');
    assert.equal(typeof sandbox.library.validateAndClampAudioGraphParams, 'function');
    assert.equal(typeof sandbox.library.reconcileAudioNodeGraphForSampleRate, 'function');
    assert.equal(sandbox.library.keepRef, 'intact');
  });

  it('clamps Parametric EQ, Crossfeed, Tone & Ultrasonic frequencies strictly below Nyquist across 44.1kHz, 48kHz, 88.2kHz, 176.4kHz & 384kHz', () => {
    const sampleRates = [
      [44100, 22050, 21829],
      [48000, 24000, 23760],
      [88200, 44100, 43659],
      [176400, 88200, 87318],
      [384000, 192000, 190080]
    ];

    for (const [sr, expectedNyquist, expectedMaxSafe] of sampleRates) {
      const res = lib.validateAndClampAudioGraphParams({
        type: 'highshelf',
        frequency: 250000,
        gain: 9,
        q: 0.707,
        bands: [
          { id: 1, type: 'lowshelf', frequency: 60, gain: 4, q: 0.707 },
          { id: 2, type: 'highshelf', frequency: 22050, gain: 6, q: 0.707 },
          { id: 3, type: 'peaking', frequency: 40000, gain: 3, q: 1.4 },
          { id: 4, type: 'lowpass', frequency: 96000, gain: 0, q: 0.707 },
          { id: 5, type: 'highshelf', frequency: 220000, gain: 5, q: 0.8 }
        ],
        crossfeed: { cutoffHz: 30000, delaySeconds: 0.0003, crossGain: 0.25 },
        tone: { bassFreqHz: 100, trebleFreqHz: 25000, bassGainDb: 3, trebleGainDb: 4 },
        ultrasonicCutoffHz: 96000
      }, sr);

      assert.equal(res.sampleRate, sr);
      assert.equal(res.nyquistHz, expectedNyquist);
      assert.equal(res.maxSafeFreqHz, expectedMaxSafe);
      assert.ok(res.maxSafeFreqHz < res.nyquistHz, `Max safe ${res.maxSafeFreqHz} must be strictly < Nyquist ${res.nyquistHz}`);
      assert.equal(res.frequency, expectedMaxSafe);
      assert.equal(res.polesStable, true, `All biquad poles must satisfy Jury stability criterion at ${sr} Hz`);

      for (const band of res.bands) {
        assert.ok(band.frequency <= expectedMaxSafe && band.frequency < expectedNyquist);
        assert.equal(band.polesStable, true);
      }

      // Verify exact frequency preservation when below maxSafeFreqHz vs clamped when above
      if (sr === 44100) {
        assert.equal(res.bands[1].frequency, 21829); // 22050 clamped to 21829!
        assert.equal(res.bands[2].frequency, 21829); // 40000 clamped to 21829!
        assert.equal(res.ultrasonicCutoffHz, 21829); // 96000 clamped to 21829!
        assert.equal(res.tone.trebleFreqHz, 21829);  // 25000 clamped to 21829!
      } else if (sr === 88200) {
        assert.equal(res.bands[1].frequency, 22050); // valid on 88.2kHz!
        assert.equal(res.bands[2].frequency, 40000); // valid on 88.2kHz!
        assert.equal(res.bands[3].frequency, 43659); // 96000 clamped to 43659!
      } else if (sr === 176400) {
        assert.equal(res.bands[3].frequency, 87318); // 96000 clamped to 87318!
      } else if (sr === 384000) {
        assert.equal(res.bands[3].frequency, 96000);  // 96kHz preserved on 384kHz!
        assert.equal(res.bands[4].frequency, 190080); // 220kHz clamped to 190080!
      }
    }
  });

  it('reconciles live AudioNode graphs across 176.4kHz -> 44.1kHz transitions, prevents InvalidAccessError, and detects cross-context nodes', () => {
    function createStrictMockBiquad(ctx, initialHz, initialQ = 0.707, initialGain = 0) {
      const nyquist = ctx.sampleRate / 2;
      const makeFreqParam = init => {
        let val = init;
        return {
          get value() { return val; },
          set value(next) {
            if (next >= nyquist || next <= 0) {
              const err = new Error(`InvalidAccessError: frequency ${next} >= Nyquist ${nyquist}`);
              err.name = 'InvalidAccessError';
              throw err;
            }
            val = next;
          },
          setTargetAtTime(next) {
            if (next >= nyquist || next <= 0) {
              const err = new Error(`InvalidAccessError: setTargetAtTime ${next} >= Nyquist ${nyquist}`);
              err.name = 'InvalidAccessError';
              throw err;
            }
            val = next;
          },
          cancelScheduledValues() {}
        };
      };
      return {
        context: ctx,
        type: 'highshelf',
        disconnected: false,
        frequency: makeFreqParam(Math.min(initialHz, Math.floor(nyquist - 1))),
        Q: { value: initialQ, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} },
        gain: { value: initialGain, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} },
        disconnect() { this.disconnected = true; }
      };
    }

    // 1. Active 44.1kHz AudioContext receiving Hi-Res 32kHz / 96kHz band & ultrasonic configs -> 0 throws!
    const ctx44k = { sampleRate: 44100, currentTime: 1.25, destination: { id: 'dest44k' } };
    const eqHighShelf = createStrictMockBiquad(ctx44k, 12000, 0.707, 4);
    const cfFilterL = createStrictMockBiquad(ctx44k, 700, 0.707, 0);
    const cfFilterR = createStrictMockBiquad(ctx44k, 700, 0.707, 0);
    const ultraFilter = createStrictMockBiquad(ctx44k, 20000, 0.707, 0);
    // Simulate stale high cutoff stored before context downshift
    ultraFilter.frequency = {
      _val: 96000,
      get value() { return this._val; },
      set value(v) {
        if (v >= 22050) throw Object.assign(new Error('InvalidAccessError'), { name: 'InvalidAccessError' });
        this._val = v;
      },
      setTargetAtTime(v) {
        if (v >= 22050) throw Object.assign(new Error('InvalidAccessError'), { name: 'InvalidAccessError' });
        this._val = v;
      },
      cancelScheduledValues() {}
    };

    const graphHealthy = {
      context: ctx44k,
      bands: [{ id: 1, type: 'highshelf', frequency: 32000, gain: 4, q: 0.707 }],
      deckA: { filters: [eqHighShelf], router: { context: ctx44k }, preamp: { context: ctx44k }, direct: { context: ctx44k } },
      crossfeedNodes: {
        input: { context: ctx44k },
        output: { context: ctx44k },
        filterL: cfFilterL,
        filterR: cfFilterR
      },
      dsdUltrasonicNodes: {
        input: { context: ctx44k },
        output: { context: ctx44k },
        filter: ultraFilter
      }
    };

    const report44k = lib.reconcileAudioNodeGraphForSampleRate(graphHealthy, 44100);
    assert.equal(report44k.valid, true);
    assert.equal(report44k.needsRebuild, false);
    assert.equal(report44k.contextMismatchCount, 0);
    assert.equal(eqHighShelf.frequency.value, 21829);
    assert.equal(ultraFilter.frequency.value, 21829);
    assert.ok(report44k.clampedNodeCount >= 2);

    // 2. Cross-context node mismatch detection (stale 176.4kHz DSD context nodes inside new 44.1kHz context)
    const oldCtx176k = { sampleRate: 176400, currentTime: 42.0 };
    const staleLimiter = { context: oldCtx176k, disconnected: false, disconnect() { this.disconnected = true; } };
    const staleFilter = createStrictMockBiquad(oldCtx176k, 40000);

    const mixedGraph = {
      context: ctx44k,
      limiter: staleLimiter,
      filters: [staleFilter],
      bands: [{ id: 1, type: 'peaking', frequency: 40000, gain: 3, q: 1 }]
    };

    const mismatchReport = lib.reconcileAudioNodeGraphForSampleRate(mixedGraph, 44100);
    assert.equal(mismatchReport.valid, false);
    assert.equal(mismatchReport.needsRebuild, true);
    assert.equal(mismatchReport.contextMismatchCount, 2);
    assert.equal(staleLimiter.disconnected, true);
    assert.equal(staleFilter.disconnected, true);
    assert.equal(mismatchReport.mismatchedNodes[0].nodeSampleRate, 176400);
    assert.equal(mismatchReport.mismatchedNodes[0].activeSampleRate, 44100);

    // 3. CRITICAL INVARIANT strictly preserved in index.html
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('library.reconcileAudioNodeGraphForSampleRate('));
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must remain 100% intact'
    );
  });
});

describe('Autonomy Tail-Chaining Cycle 7 — UPG-03 (LRCLIB SHA-256 Proof-of-Work Solver & Publish Payload Builder)', () => {
  const nodeCrypto = require('node:crypto');

  it('exposes UPG-03 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.verifyLrclibPowTarget, 'function');
    assert.equal(typeof lib.solveLrclibChallengeAsync, 'function');
    assert.equal(typeof lib.solveLrclibChallengeSync, 'function');
    assert.equal(typeof lib.buildLrclibPublishPayload, 'function');

    const sandbox = { library: { preserveFlag: 'upg03' } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.verifyLrclibPowTarget, 'function');
    assert.equal(typeof sandbox.library.verifyLrclibPowTarget, 'function');
    assert.equal(typeof sandbox.library.solveLrclibChallengeAsync, 'function');
    assert.equal(typeof sandbox.library.solveLrclibChallengeSync, 'function');
    assert.equal(typeof sandbox.library.buildLrclibPublishPayload, 'function');
    assert.equal(sandbox.library.preserveFlag, 'upg03');
  });

  it('verifyLrclibPowTarget performs exact 32-byte big-endian comparison (hash <= target) and rejects malformed inputs', () => {
    const targetHex = '0000ff8000000000000000000000000000000000000000000000000000000010';
    const exactBytes = Uint8Array.from(Buffer.from(targetHex, 'hex'));

    // 1. Exact equality (hash === target) satisfies hash <= target
    assert.equal(lib.verifyLrclibPowTarget(exactBytes, targetHex), true);
    assert.equal(lib.verifyLrclibPowTarget(exactBytes.buffer, '0x' + targetHex.toUpperCase()), true);

    // 2. Strictly smaller at MSB, middle byte, and final LSB (-1)
    const smallerLsb = new Uint8Array(exactBytes);
    smallerLsb[31] = 0x0f;
    assert.equal(lib.verifyLrclibPowTarget(smallerLsb, targetHex), true);

    const smallerMid = new Uint8Array(exactBytes);
    smallerMid[2] = 0xfe;
    smallerMid[31] = 0xff; // trailing byte larger, but earlier big-endian byte 2 is smaller
    assert.equal(lib.verifyLrclibPowTarget(smallerMid, targetHex), true);

    // 3. Strictly larger at final LSB (+1) or MSB
    const largerLsb = new Uint8Array(exactBytes);
    largerLsb[31] = 0x11;
    assert.equal(lib.verifyLrclibPowTarget(largerLsb, targetHex), false);

    const largerMsb = new Uint8Array(exactBytes);
    largerMsb[0] = 0x01;
    assert.equal(lib.verifyLrclibPowTarget(largerMsb, targetHex), false);

    // 4. Offset DataView view into larger backing buffer
    const backing = new Uint8Array(64);
    backing.set(smallerLsb, 12);
    assert.equal(lib.verifyLrclibPowTarget(new DataView(backing.buffer, 12, 32), targetHex), true);

    // 5. Malformed inputs return false safely without throwing
    assert.equal(lib.verifyLrclibPowTarget(null, targetHex), false);
    assert.equal(lib.verifyLrclibPowTarget(new Uint8Array(31), targetHex), false);
    assert.equal(lib.verifyLrclibPowTarget(exactBytes, ''), false);
    assert.equal(lib.verifyLrclibPowTarget(exactBytes, '00ff'), false);
    assert.equal(lib.verifyLrclibPowTarget(exactBytes, 'zz' + targetHex.slice(2)), false);
  });

  it('solveLrclibChallengeAsync & solveLrclibChallengeSync solve realistic targets, cancel mid-solve via AbortController, and reject invalid targets', async () => {
    const easyTarget = '00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const prefix = 'lrclib-upg03-challenge-';

    // 1. Web Crypto async solver + pure-JS sync solver find exact lowest valid nonce
    const asyncSolved = await lib.solveLrclibChallengeAsync(prefix, easyTarget, { batchSize: 64 });
    const syncSolved = lib.solveLrclibChallengeSync(prefix, easyTarget);
    const fallbackAsyncSolved = await lib.solveLrclibChallengeAsync(
      { prefix, target: easyTarget },
      { forceSyncFallback: true, batchSize: 32 }
    );

    assert.equal(Number.isInteger(asyncSolved.nonce), true);
    assert.equal(asyncSolved.publishToken, `${prefix}:${asyncSolved.nonce}`);
    assert.equal(asyncSolved.iterations, asyncSolved.nonce + 1);
    assert.ok(asyncSolved.elapsedMs >= 0);

    const expectedDigest = nodeCrypto.createHash('sha256').update(`${prefix}${asyncSolved.nonce}`).digest();
    assert.equal(asyncSolved.hashHex, expectedDigest.toString('hex'));
    assert.equal(lib.verifyLrclibPowTarget(expectedDigest, easyTarget), true);

    assert.equal(syncSolved.nonce, asyncSolved.nonce);
    assert.equal(syncSolved.publishToken, asyncSolved.publishToken);
    assert.equal(syncSolved.hashHex, asyncSolved.hashHex);
    assert.equal(fallbackAsyncSolved.nonce, asyncSolved.nonce);
    assert.equal(fallbackAsyncSolved.publishToken, asyncSolved.publishToken);

    // Verify all prior nonces [0 .. nonce - 1] indeed did NOT satisfy target
    for (let n = 0; n < asyncSolved.nonce; n++) {
      const prevDigest = nodeCrypto.createHash('sha256').update(`${prefix}${n}`).digest();
      assert.equal(lib.verifyLrclibPowTarget(prevDigest, easyTarget), false);
    }

    // 2. Pre-aborted AbortController rejects immediately
    const preAborted = new AbortController();
    preAborted.abort('already_cancelled');
    await assert.rejects(
      () => lib.solveLrclibChallengeAsync(prefix, easyTarget, { signal: preAborted.signal }),
      err => err && err.name === 'AbortError'
    );

    // 3. Mid-solve AbortController cancellation during batched solve
    const midAbortController = new AbortController();
    const impossibleTarget = '0000000000000000000000000000000000000000000000000000000000000000';
    let progressBatches = 0;
    const t0 = performance.now();
    await assert.rejects(
      () => lib.solveLrclibChallengeAsync(prefix, impossibleTarget, {
        batchSize: 16,
        concurrency: 8,
        maxIterations: 500000,
        signal: midAbortController.signal,
        onProgress() {
          progressBatches++;
          if (progressBatches >= 2) {
            midAbortController.abort('user_closed_editor');
          }
        }
      }),
      err => err && err.name === 'AbortError'
    );
    const abortElapsed = performance.now() - t0;
    assert.ok(progressBatches >= 2, 'Solver must have executed at least 2 batches before mid-solve abort');
    assert.ok(abortElapsed < 500, `Mid-solve AbortController cancellation must complete rapidly, took ${abortElapsed.toFixed(1)}ms`);

    // 4. Invalid prefix / invalid targetHex / maxIterations exhaustion reject cleanly
    await assert.rejects(
      () => lib.solveLrclibChallengeAsync('', easyTarget),
      /Invalid LRCLIB PoW prefix/
    );
    await assert.rejects(
      () => lib.solveLrclibChallengeAsync(prefix, 'not-a-64-char-hex-target'),
      /Invalid LRCLIB PoW targetHex/
    );
    await assert.rejects(
      () => lib.solveLrclibChallengeAsync(prefix, 'zzzz' + easyTarget.slice(4)),
      /Invalid LRCLIB PoW targetHex/
    );
    await assert.rejects(
      () => lib.solveLrclibChallengeAsync(prefix, impossibleTarget, { maxIterations: 32, batchSize: 16 }),
      err => err && err.code === 'POW_MAX_ITERATIONS_EXCEEDED'
    );
  });

  it('buildLrclibPublishPayload normalizes metadata & lyrics, derives plainLyrics, and constructs X-Publish-Token POST /api/publish spec', async () => {
    const challenge = await lib.solveLrclibChallengeAsync(
      'pub-tok-99-',
      '0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    );

    const spec = lib.buildLrclibPublishPayload(
      {
        title: '  Clair   de Lune (Hi-Res Master)  ',
        artist: ' Claude Debussy ',
        album: ' Suite Bergamasque ',
        duration_ms: 302400
      },
      {
        syncedLyrics: '[ti:Clair de Lune]\r\n[ar:Claude Debussy]\r\n[00:05.00]<00:05.00>Soft <00:06.20>moonlight   \r\n[00:10.50]Over still water\r\n'
      },
      { publishToken: challenge.publishToken }
    );

    assert.equal(spec.url, 'https://lrclib.net/api/publish');
    assert.equal(spec.method, 'POST');
    assert.equal(spec.headers['Content-Type'], 'application/json');
    assert.equal(spec.headers['X-Publish-Token'], challenge.publishToken);
    assert.ok(spec.headers['Lrclib-Client'].includes('Nocturne-HiRes-Player'));

    assert.deepEqual(spec.body, {
      trackName: 'Clair de Lune (Hi-Res Master)',
      artistName: 'Claude Debussy',
      albumName: 'Suite Bergamasque',
      duration: 302,
      plainLyrics: 'Soft moonlight\nOver still water',
      syncedLyrics: '[ti:Clair de Lune]\n[ar:Claude Debussy]\n[00:05.00]<00:05.00>Soft <00:06.20>moonlight\n[00:10.50]Over still water'
    });
    assert.deepEqual(JSON.parse(spec.jsonBody), spec.body);

    // Deferred token attachment via withPublishToken() + placeholder album cleanup + instrumental track
    const instDraft = lib.buildLrclibPublishPayload(
      { trackName: 'Orion', artistName: 'Metallica', albumName: '—', duration: 507 },
      { instrumental: true, syncedLyrics: '[00:01.00]should be cleared' }
    );
    assert.equal(instDraft.albumName, '');
    assert.equal(instDraft.plainLyrics, '');
    assert.equal(instDraft.syncedLyrics, '');
    assert.equal(instDraft.headers['X-Publish-Token'], undefined);

    const signedInst = instDraft.withPublishToken(challenge);
    assert.equal(signedInst.headers['X-Publish-Token'], challenge.publishToken);

    // Validation rejections
    assert.throws(
      () => lib.buildLrclibPublishPayload({ artistName: 'A', duration: 180 }, { plainLyrics: 'Hi' }),
      /trackName is required/
    );
    assert.throws(
      () => lib.buildLrclibPublishPayload({ trackName: 'T', duration: 180 }, { plainLyrics: 'Hi' }),
      /artistName is required/
    );
    assert.throws(
      () => lib.buildLrclibPublishPayload({ trackName: 'T', artistName: 'A', duration: 0 }, { plainLyrics: 'Hi' }),
      /duration must be a positive number/
    );
    assert.throws(
      () => lib.buildLrclibPublishPayload({ trackName: 'T', artistName: 'A', duration: 180 }, {}),
      /Lyrics content/
    );
    assert.throws(
      () => lib.buildLrclibPublishPayload({ trackName: 'T', artistName: 'A', duration: 180 }, { plainLyrics: 'Hi' }, { publishToken: 'malformed_no_colon' }),
      /Invalid X-Publish-Token/
    );
  });
});

describe('Autonomy Tail-Chaining Cycle 8 — OPT-03 (TypedArray Segment Max-Tree Index for 5000+ Multi-Voice Karaoke Lines)', () => {
  function buildSixThousandMultiVoiceFixture() {
    // 6,000 lines total:
    // - Lines 0..5996: sequential + periodic overlapping duet/backing harmonies (4 words each)
    // - Lines 5997..5999: explicit 3-voice overlapping duet/harmony chorus at [1500000ms .. 1508000ms], placed at tail (out-of-order!)
    const lines = new Array(6000);
    for (let i = 0; i < 5997; i++) {
      const baseStart = 1000 + i * 500;
      const isHarmony = i % 10 === 5;
      const lineStart = isHarmony ? baseStart - 250 : baseStart;
      const lineEnd = isHarmony ? lineStart + 900 : lineStart + 480;
      const step = (lineEnd - lineStart) / 4;
      lines[i] = {
        start_ms: lineStart,
        end_ms: lineEnd,
        text: isHarmony ? `(Backing ${i})` : `Lead line ${i}`,
        voice: isHarmony ? 'backing' : 'lead',
        backing: isHarmony,
        words: [
          { start_ms: lineStart, end_ms: lineStart + step, text: 'w0 ' },
          { start_ms: lineStart + step, end_ms: lineStart + step * 2, text: 'w1 ' },
          { start_ms: lineStart + step * 2, end_ms: lineStart + step * 3, text: 'w2 ' },
          { start_ms: lineStart + step * 3, end_ms: lineEnd, text: 'w3' }
        ]
      };
    }

    // Explicit out-of-order 3-part duet + harmony chorus spanning t = 1,503,500ms:
    // Note: sequential line around 1,503,500ms may also overlap; these 3 have exact known indices 5997, 5998, 5999!
    lines[5997] = {
      start_ms: 4000000, // Chorale Finale lead [4,000,000 .. 4,008,000]
      end_ms: 4008000,
      text: 'Duet Lead Finale',
      voice: 'lead',
      words: [
        { start_ms: 4000000, end_ms: 4002000, text: 'Duet ' },
        { start_ms: 4002000, end_ms: 4005000, text: 'Lead ' },
        { start_ms: 4005000, end_ms: 4008000, text: 'Finale' }
      ]
    };
    lines[5998] = {
      start_ms: 4001000, // Duet Counter-Melody backing 1 [4,001,000 .. 4,006,000]
      end_ms: 4006000,
      text: '(Counter-Melody Harmony 1)',
      voice: 'backing',
      backing: true,
      words: [
        { start_ms: 4001000, end_ms: 4003000, text: '(Counter ' },
        { start_ms: 4003000, end_ms: 4006000, text: 'Harmony)' }
      ]
    };
    lines[5999] = {
      start_ms: 4002500, // Choir Soprano backing 2 [4,002,500 .. 4,007,500]
      end_ms: 4007500,
      text: '(Soprano Descant 2)',
      voice: 'harmony',
      words: [
        { start_ms: 4002500, end_ms: 4004000, text: '(Soprano ' },
        { start_ms: 4004000, end_ms: 4007500, text: 'Descant)' }
      ]
    };

    return { lines, durationMs: 4020000 };
  }

  it('exposes OPT-03 TypedArray Segment Max-Tree APIs on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createTypedLyricSegmentIndex, 'function');
    assert.equal(typeof lib.createTypedLyricBufferPool, 'function');

    const sandbox = { library: { keepOpt03: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createTypedLyricSegmentIndex, 'function');
    assert.equal(typeof sandbox.library.createTypedLyricSegmentIndex, 'function');
    assert.equal(typeof sandbox.library.createTypedLyricBufferPool, 'function');
    assert.equal(sandbox.library.keepOpt03, true);
  });

  it('compiles 6,000 multi-voice karaoke lines into flat TypedArrays and resolves 0ms, overlapping duet chorus & duration_ms in O(log N) with zero allocations', () => {
    const { lines, durationMs } = buildSixThousandMultiVoiceFixture();
    const pool = lib.createTypedLyricBufferPool(128, 512);
    const idx = lib.createTypedLyricSegmentIndex(lines, pool);

    // 1. Verify flat Float64Array / Int32Array typed buffers
    assert.equal(idx.lineCount, 6000);
    assert.ok(idx.startMs instanceof Float64Array && idx.startMs.length === 6000);
    assert.ok(idx.endMs instanceof Float64Array && idx.endMs.length === 6000);
    assert.ok(idx.maxEndSubtreeMs instanceof Float64Array && idx.maxEndSubtreeMs.length === 16384); // 2 * 8192
    assert.ok(idx.sortedOrder instanceof Int32Array && idx.sortedOrder.length === 6000);
    assert.ok(idx.wordOffsets instanceof Int32Array && idx.wordOffsets.length === 6001);
    assert.ok(idx.wordStartMs instanceof Float64Array && idx.wordStartMs.length === idx.wordCount);
    assert.ok(idx.wordEndMs instanceof Float64Array && idx.wordEndMs.length === idx.wordCount);
    assert.equal(idx.wordCount, 5997 * 4 + 3 + 2 + 2);

    // 2. Reusable outResult struct with zero per-query object allocations
    const out = idx.createQueryResult();
    const origActiveLinesRef = out.activeLineIndices;
    const origActiveWordsRef = out.activeWordIndices;
    const origActiveVoicesRef = out.activeVoiceFlags;
    const origActiveProgRef = out.activeProgress;

    // Boundary 1: 0ms (before first line at 1000ms)
    const rZero = idx.queryActiveAt(0, out);
    assert.strictEqual(rZero, out);
    assert.equal(out.activeCount, 0);
    assert.equal(out.lineIndex, -1);
    assert.equal(out.wordIndex, -1);
    assert.equal(out.leadLineIndex, -1);
    assert.equal(out.backingLineIndex, -1);
    assert.equal(out.progress, 0);

    // Boundary 2: Overlapping 3-voice duet + harmony chorus at t = 4,003,500ms
    // Lead 5997: word 1 ('Lead ' [4002000..4005000], progress 0.5)
    // Backing 5998: word 1 ('Harmony)' [4003000..4006000], progress 500/3000)
    // Backing 5999: word 0 ('(Soprano ' [4002500..4004000], progress 1000/1500)
    const rChorus = idx.queryActiveAt(4003500, out);
    assert.strictEqual(rChorus, out);
    assert.equal(out.activeCount, 3);
    assert.equal(out.leadCount, 1);
    assert.equal(out.backingCount, 2);
    assert.deepEqual(Array.from(out.activeLineIndices.subarray(0, out.activeCount)), [5997, 5998, 5999]);
    assert.deepEqual(Array.from(out.activeWordIndices.subarray(0, out.activeCount)), [1, 1, 0]);
    assert.equal(out.leadLineIndex, 5997);
    assert.equal(out.leadWordIndex, 1);
    assert.equal(out.backingLineIndex, 5999);
    assert.equal(out.backingWordIndex, 0);
    assert.ok(Math.abs(out.activeProgress[0] - 0.5) < 1e-6);

    // After backing 5998 (end 4006000) & 5999 (end 4007500) finish, Lead 5997 [4000000..4008000] still active at 4,007,750ms!
    idx.queryActiveAt(4007750, out);
    assert.equal(out.activeCount, 1);
    assert.equal(out.activeLineIndices[0], 5997);
    assert.equal(out.activeWordIndices[0], 2);

    // Boundary 3: At track duration_ms (4,020,000ms, past all end_ms)
    idx.queryActiveAt(durationMs, out);
    assert.equal(out.activeCount, 0);
    assert.equal(out.strictLineIndex, -1);
    assert.equal(out.heldLineIndex, 5999);
    assert.equal(out.lineIndex, 5999);
    assert.equal(out.progress, 1);

    idx.queryActiveAt(durationMs, out, true); // strict = true
    assert.equal(out.activeCount, 0);
    assert.equal(out.lineIndex, -1);
    assert.equal(out.wordIndex, -1);

    // Integration with findActiveLyricStateBinary(typedIndex, t)
    const stateFromTyped = lib.findActiveLyricStateBinary(idx, 4007750);
    assert.equal(stateFromTyped.lineIndex, 5997);
    assert.equal(stateFromTyped.activeLine.text, 'Duet Lead Finale');
    assert.equal(stateFromTyped.wordIndex, 2);
    assert.equal(stateFromTyped.activeWord.text, 'Finale');

    // 3. Benchmark 5,000 O(log N) queries over 6,000 multi-voice lines + verify identical TypedArray references
    const startNs = process.hrtime.bigint();
    for (let q = 0; q < 5000; q++) {
      const queryMs = (q * 803) % durationMs;
      const res = idx.queryActiveAt(queryMs, out);
      assert.strictEqual(res, out);
    }
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    assert.ok(elapsedMs < 250, `Expected 5,000 zero-alloc queries over 6,000 lines < 250ms, took ${elapsedMs.toFixed(2)}ms`);
    assert.strictEqual(out.activeLineIndices, origActiveLinesRef);
    assert.strictEqual(out.activeWordIndices, origActiveWordsRef);
    assert.strictEqual(out.activeVoiceFlags, origActiveVoicesRef);
    assert.strictEqual(out.activeProgress, origActiveProgRef);
  });

  it('reuses underlying ArrayBuffers across track switches via reusablePool and grows cleanly when needed', () => {
    const { lines: track6k } = buildSixThousandMultiVoiceFixture();
    const pool = lib.createTypedLyricBufferPool(8192, 32768);

    // Track 1: 6,000 lines
    const idx1 = lib.createTypedLyricSegmentIndex(track6k, pool);
    const bufStart1 = idx1.startMs.buffer;
    const bufEnd1 = idx1.endMs.buffer;
    const bufTree1 = idx1.maxEndSubtreeMs.buffer;
    const bufOrder1 = idx1.sortedOrder.buffer;
    const bufWordOff1 = idx1.wordOffsets.buffer;
    const bufWordStart1 = idx1.wordStartMs.buffer;
    const bufWordEnd1 = idx1.wordEndMs.buffer;
    const allocsAfter1 = pool.allocationCount;

    // Track 2: Switch to 2,400-line track -> 100% zero ArrayBuffer reallocation!
    const track2400 = track6k.slice(0, 2400);
    const idx2 = lib.createTypedLyricSegmentIndex(track2400, pool);
    assert.equal(idx2.lineCount, 2400);
    assert.strictEqual(idx2.startMs.buffer, bufStart1);
    assert.strictEqual(idx2.endMs.buffer, bufEnd1);
    assert.strictEqual(idx2.maxEndSubtreeMs.buffer, bufTree1);
    assert.strictEqual(idx2.sortedOrder.buffer, bufOrder1);
    assert.strictEqual(idx2.wordOffsets.buffer, bufWordOff1);
    assert.strictEqual(idx2.wordStartMs.buffer, bufWordStart1);
    assert.strictEqual(idx2.wordEndMs.buffer, bufWordEnd1);
    assert.equal(pool.allocationCount, allocsAfter1);
    assert.ok(pool.reuseCount >= 1);

    // Track 3: Switch to 5,500-line track passing idx2 directly as reusablePool -> still zero reallocation!
    const track5500 = track6k.slice(0, 5500);
    const idx3 = lib.createTypedLyricSegmentIndex(track5500, idx2);
    assert.equal(idx3.lineCount, 5500);
    assert.strictEqual(idx3.startMs.buffer, bufStart1);
    assert.strictEqual(idx3.wordStartMs.buffer, bufWordStart1);
    assert.equal(pool.allocationCount, allocsAfter1);

    // Track 4: Switch to 9,000-line mega-track (> 8,192 capacity) -> grows geometrically cleanly
    const track9000 = Array.from({ length: 9000 }, (_, i) => ({
      start_ms: i * 250,
      end_ms: i * 250 + 220,
      text: `Opera line ${i}`,
      words: [{ start_ms: i * 250, end_ms: i * 250 + 220, text: 'Aria' }]
    }));
    const idx4 = lib.createTypedLyricSegmentIndex(track9000, pool);
    assert.equal(idx4.lineCount, 9000);
    assert.equal(pool.lineCapacity, 16384);
    assert.equal(pool.allocationCount, allocsAfter1 + 1);
    const q = idx4.queryActiveAt(8999 * 250 + 50);
    assert.equal(q.activeCount, 1);
    assert.equal(q.lineIndex, 8999);
    assert.equal(q.wordIndex, 0);
  });
});

describe('Autonomy Tail-Chaining Cycle 9 — BUG-04 (Abortable Sequential LRCLIB Queue & Instant 429 Retry-After Cancellation)', () => {
  const LrclibClient = require(path.join(ROOT, 'lrclib-client.js'));

  it('exposes BUG-04 createAbortableSequentialRequestQueue on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createAbortableSequentialRequestQueue, 'function');

    const sandbox = { library: { keepBug04: 'ok' } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createAbortableSequentialRequestQueue, 'function');
    assert.equal(typeof sandbox.library.createAbortableSequentialRequestQueue, 'function');
    assert.equal(sandbox.library.keepBug04, 'ok');
  });

  it('aborts a 60-second 429 Retry-After sleep in <20ms, evicts queued tasks, and leaves 0 dangling timers', async () => {
    const liveTimers = new Set();
    let clearedCount = 0;

    const queue = lib.createAbortableSequentialRequestQueue({
      minSpacingMs: 0,
      setTimer(fn, ms) {
        const handle = setTimeout(() => {
          liveTimers.delete(handle);
          fn();
        }, ms);
        liveTimers.add(handle);
        return handle;
      },
      clearTimer(handle) {
        if (liveTimers.delete(handle)) {
          clearedCount++;
        }
        clearTimeout(handle);
      }
    });

    let enteredSixtySecSleep = null;
    const sleepEnteredPromise = new Promise(resolve => { enteredSixtySecSleep = resolve; });
    const executedTracks = [];

    // Track 1 enters a 60-second (60,000ms) Retry-After sleep
    const pTrack1 = queue.enqueue(async ctx => {
      executedTracks.push(1);
      enteredSixtySecSleep();
      await ctx.waitRetryAfter(60000);
      return 'track-1-should-never-finish';
    });

    // Tracks 2..9 queue behind Track 1 while Track 1 is sleeping
    const queuedPromises = [];
    for (let t = 2; t <= 9; t++) {
      queuedPromises.push(
        queue.enqueue(async () => {
          executedTracks.push(t);
          return `track-${t}`;
        })
      );
    }

    await sleepEnteredPromise;
    assert.equal(liveTimers.size, 1, '60-second Retry-After timer must be armed before abort');
    assert.equal(queue.getStats().activeTimerCount, 1);
    assert.equal(queue.getStats().pendingCount, 8);

    // Measure exact cancellation & eviction latency when Track 10 supersedes Tracks 1..9!
    const abortStartMs = performance.now();
    const pTrack10 = queue.enqueue(
      async ctx => {
        ctx.throwIfAborted();
        executedTracks.push(10);
        return 'track-10-lyrics-ready';
      },
      { supersedePrevious: true }
    );

    const [r1, ...rQueued] = await Promise.allSettled([pTrack1, ...queuedPromises]);
    const abortElapsedMs = performance.now() - abortStartMs;

    assert.ok(
      abortElapsedMs < 20,
      `Expected 60-second Retry-After sleep + 8 queued tasks to abort in <20ms, took ${abortElapsedMs.toFixed(2)}ms`
    );
    assert.equal(r1.status, 'rejected');
    assert.equal(r1.reason.name, 'AbortError');
    for (const rq of rQueued) {
      assert.equal(rq.status, 'rejected');
      assert.equal(rq.reason.name, 'AbortError');
    }

    const track10Result = await pTrack10;
    assert.equal(track10Result, 'track-10-lyrics-ready');

    // Tracks 2..9 were evicted before ever executing, and 0 timers remain dangling!
    assert.deepEqual(executedTracks, [1, 10]);
    assert.equal(liveTimers.size, 0, 'Must leave 0 dangling timers in JS event loop');
    assert.equal(queue.getStats().activeTimerCount, 0);
    assert.equal(queue.getStats().pendingCount, 0);
    assert.equal(queue.getStats().inFlightCount, 0);
    assert.equal(queue.getStats().evictedCount, 8);
    assert.ok(clearedCount >= 1, 'clearTimeout must be called on cancelled Retry-After timer');

    // Individual AbortSignal cancellation on a queued task also evicts in <20ms without disturbing other tasks
    let releaseBlocker = null;
    const blockerStarted = new Promise(r => {
      queue.enqueue(async () => {
        r();
        await new Promise(res => { releaseBlocker = res; });
        return 'blocker-done';
      });
    });
    await blockerStarted;

    const singleAc = new AbortController();
    const tSingleStart = performance.now();
    const pAbortedQueued = queue.enqueue(async () => 'never', { signal: singleAc.signal });
    const pSurvivingQueued = queue.enqueue(async () => 'survivor-ok');

    singleAc.abort('skip_single');
    await assert.rejects(() => pAbortedQueued, err => err && err.name === 'AbortError');
    const singleAbortMs = performance.now() - tSingleStart;
    assert.ok(singleAbortMs < 20, `Queued AbortSignal cancellation must settle in <20ms, took ${singleAbortMs.toFixed(2)}ms`);

    releaseBlocker();
    assert.equal(await pSurvivingQueued, 'survivor-ok');
    assert.equal(liveTimers.size, 0);
  });

  it('prevents head-of-line blocking in LrclibClient when skipping 10 tracks during HTTP 429 Retry-After: 60', async () => {
    const liveClientTimers = new Set();
    let entered429Backoff = null;
    const on429BackoffArmed = new Promise(resolve => { entered429Backoff = resolve; });
    const outboundTrackCalls = [];

    const client = new LrclibClient.LrclibClient({
      minSpacingMs: 0,
      maxRetries: 3,
      jitterRatio: 0,
      setTimer(fn, ms) {
        const id = setTimeout(() => {
          liveClientTimers.delete(id);
          fn();
        }, ms);
        liveClientTimers.add(id);
        if (ms >= 60000 && entered429Backoff) {
          const cb = entered429Backoff;
          entered429Backoff = null;
          queueMicrotask(cb);
        }
        return id;
      },
      clearTimer(id) {
        liveClientTimers.delete(id);
        clearTimeout(id);
      },
      fetch: async url => {
        const parsed = new URL(url);
        const trackName = parsed.searchParams.get('track_name');
        outboundTrackCalls.push(trackName);

        if (trackName === 'Track 1') {
          return {
            status: 429,
            ok: false,
            headers: { get: h => (h.toLowerCase() === 'retry-after' ? '60' : null) },
            json: async () => ({ error: 'Too Many Requests' }),
            text: async () => 'Too Many Requests'
          };
        }
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            id: 1010,
            trackName,
            artistName: 'Nocturne Artist',
            syncedLyrics: `[00:01.00] Synced lyrics for ${trackName}`,
            plainLyrics: `Synced lyrics for ${trackName}`,
            instrumental: false
          }),
          text: async () => ''
        };
      }
    });

    // Track 1 hits 429 Retry-After: 60s
    const p1 = client.getLyrics({ trackName: 'Track 1', artistName: 'Nocturne Artist', supersedePrevious: true });
    await on429BackoffArmed;
    assert.equal(liveClientTimers.size, 1, '60s Retry-After timer should be active for Track 1');

    // Rapidly skip Tracks 2..10 while Track 1 was sleeping 60s!
    const tSkipStart = performance.now();
    const skippedPromises = [p1];
    for (let i = 2; i <= 9; i++) {
      skippedPromises.push(
        client.getLyrics({ trackName: `Track ${i}`, artistName: 'Nocturne Artist', supersedePrevious: true })
      );
    }
    const p10 = client.getLyrics({ trackName: 'Track 10', artistName: 'Nocturne Artist', supersedePrevious: true });

    const settledSkipped = await Promise.allSettled(skippedPromises);
    const skipAbortElapsedMs = performance.now() - tSkipStart;
    assert.ok(
      skipAbortElapsedMs < 20,
      `Skipping Tracks 1..9 during 60s Retry-After must abort all stale requests in <20ms, took ${skipAbortElapsedMs.toFixed(2)}ms`
    );
    for (const s of settledSkipped) {
      assert.equal(s.status, 'rejected');
      assert.equal(s.reason.name, 'AbortError');
    }

    const finalLyrics = await p10;
    assert.ok(finalLyrics);
    assert.equal(finalLyrics.trackName, 'Track 10');
    assert.equal(finalLyrics.syncedLyrics, '[00:01.00] Synced lyrics for Track 10');
    assert.equal(liveClientTimers.size, 0, '0 dangling Retry-After timers may remain');
    assert.equal(client.queue.getStats().activeTimerCount, 0);

    // Verify index.html wiring & Web Audio destination invariant
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('supersedePrevious: isForegroundTrack'));
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT must remain intact'
    );
  });
});

describe('Autonomy Tail-Chaining Cycle 10 — UPG-04 (CRC32 + SHA-256 Signed Offline PWA Configuration & Playlist Verifier)', () => {
  it('exposes UPG-04 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.computeCrc32Hex, 'function');
    assert.equal(typeof lib.signConfigurationBundle, 'function');
    assert.equal(typeof lib.verifyConfigurationBundle, 'function');

    const sandbox = { library: { keepRefUpg04: 7 } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.computeCrc32Hex, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.signConfigurationBundle, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.verifyConfigurationBundle, 'function');
    assert.equal(typeof sandbox.library.computeCrc32Hex, 'function');
    assert.equal(typeof sandbox.library.signConfigurationBundle, 'function');
    assert.equal(typeof sandbox.library.verifyConfigurationBundle, 'function');
    assert.equal(sandbox.library.keepRefUpg04, 7);
  });

  it('computes exact IEEE 802.3 CRC32 standard test vectors across strings, Uint8Array, ArrayBuffer, and DataView slices', () => {
    // Standard IEEE 802.3 CRC32 check value for ASCII "123456789" -> "cbf43926"
    assert.equal(lib.computeCrc32Hex('123456789'), 'cbf43926');
    assert.equal(lib.computeCrc32Hex(new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])), 'cbf43926');

    // Empty inputs -> "00000000"
    assert.equal(lib.computeCrc32Hex(''), '00000000');
    assert.equal(lib.computeCrc32Hex(new Uint8Array(0)), '00000000');
    assert.equal(lib.computeCrc32Hex(null), '00000000');
    assert.equal(lib.computeCrc32Hex(undefined), '00000000');

    // Offset DataView / subarray slice isolation
    const padded = new Uint8Array([0xff, 0xee, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0xaa]);
    const subView = new DataView(padded.buffer, 2, 9);
    assert.equal(lib.computeCrc32Hex(subView), 'cbf43926');
    assert.equal(lib.computeCrc32Hex(padded.subarray(2, 11).buffer.slice(2, 11)), 'cbf43926');

    // UTF-8 Vietnamese & CJK consistency between string and encoded Buffer
    const utf8Text = 'Nhạc Lossless Việt Nam — 夜の音楽 🎵';
    const utf8Buf = Buffer.from(utf8Text, 'utf8');
    const crcStr = lib.computeCrc32Hex(utf8Text);
    const crcBuf = lib.computeCrc32Hex(utf8Buf);
    assert.match(crcStr, /^[0-9a-f]{8}$/);
    assert.equal(crcStr, crcBuf);
  });

  it('produces identical canonical CRC32 + SHA-256 digests regardless of nested object key order', () => {
    const bundleOrderA = {
      version: 1,
      appName: 'Nocturne',
      playlists: [
        {
          name: 'Audiophile Reference',
          id: 'pl-1',
          tracks: [
            { sampleRate: 192000, bitDepth: 24, title: 'Take Five', id: 't-1' },
            { id: 't-2', title: 'Blue in Green', bitDepth: 24, sampleRate: 96000 }
          ]
        }
      ],
      settings: {
        toneTreble: -1.5,
        toneBass: 2.0,
        eqBands: [
          { q: 0.707, gain: 3.5, frequency: 60, type: 'lowshelf' },
          { type: 'peaking', frequency: 3500, gain: -2.0, q: 1.414 }
        ],
        autoEqProfile: 'harman'
      }
    };

    const bundleOrderB = {
      settings: {
        autoEqProfile: 'harman',
        eqBands: [
          { type: 'lowshelf', frequency: 60, gain: 3.5, q: 0.707 },
          { q: 1.414, gain: -2.0, frequency: 3500, type: 'peaking' }
        ],
        toneBass: 2.0,
        toneTreble: -1.5
      },
      appName: 'Nocturne',
      playlists: [
        {
          tracks: [
            { id: 't-1', title: 'Take Five', bitDepth: 24, sampleRate: 192000 },
            { sampleRate: 96000, id: 't-2', bitDepth: 24, title: 'Blue in Green' }
          ],
          id: 'pl-1',
          name: 'Audiophile Reference'
        }
      ],
      version: 1
    };

    const fixedTimestamp = '2026-11-17T22:55:00.000Z';
    const signedA = lib.signConfigurationBundle(bundleOrderA, { signedAt: fixedTimestamp });
    const signedB = lib.signConfigurationBundle(bundleOrderB, { signedAt: fixedTimestamp });

    assert.equal(signedA.integrity.algorithm, 'crc32+sha256');
    assert.equal(signedA.integrity.signedAt, fixedTimestamp);
    assert.match(signedA.integrity.crc32, /^[0-9a-f]{8}$/);
    assert.match(signedA.integrity.sha256, /^[0-9a-f]{64}$/);
    assert.ok(signedA.integrity.canonicalByteLength > 100);
    assert.deepEqual(signedA.integrity, signedB.integrity, 'Canonicalization must be 100% independent of key insertion order');

    // Re-signing an already signed bundle ignores old integrity field and yields identical digests
    const reSigned = lib.signConfigurationBundle(signedA, { signedAt: '2026-11-18T00:00:00.000Z' });
    assert.equal(reSigned.integrity.crc32, signedA.integrity.crc32);
    assert.equal(reSigned.integrity.sha256, signedA.integrity.sha256);
    assert.equal(reSigned.integrity.canonicalByteLength, signedA.integrity.canonicalByteLength);

    // Verify JSON round-trip with pretty-printed indentation
    const prettyJson = JSON.stringify(signedB, null, 4);
    const verified = lib.verifyConfigurationBundle(prettyJson);
    assert.equal(verified.valid, true);
    assert.equal(verified.signed, true);
    assert.equal(verified.legacy, false);
    assert.equal(verified.reason, null);
    assert.deepEqual(verified.integrity, signedA.integrity);
  });

  it('detects tampering in EQ bands, playlist items, or checksum headers and preserves legacy unsigned backups', () => {
    const exported = lib.exportAppConfiguration({
      favorites: new Set(['fav-1', 'fav-2']),
      playlists: [
        {
          id: 'pl-dsd',
          name: 'DSD128 Masters',
          tracks: [{ id: 'dsd-01', title: 'Kind of Blue', sampleRate: 5644800, bitDepth: 1 }]
        }
      ],
      autoEqProfile: 'harman',
      toneBass: 3.0,
      crossfeed: 0.35
    });
    exported.settings.eqBands = [
      { id: 1, type: 'lowshelf', frequency: 80, gain: 4.0, q: 0.707 },
      { id: 2, type: 'peaking', frequency: 2500, gain: -1.5, q: 1.2 }
    ];
    const signedBundle = lib.signConfigurationBundle(exported, { signedAt: '2026-11-17T22:56:00.000Z' });

    // 1. Untampered signed bundle passes both verifyConfigurationBundle & validateAndParseConfiguration
    const okVerify = lib.verifyConfigurationBundle(JSON.stringify(signedBundle));
    assert.equal(okVerify.valid, true);
    assert.equal(okVerify.signed, true);
    assert.equal(okVerify.legacy, false);

    const okParsed = lib.validateAndParseConfiguration(JSON.stringify(signedBundle));
    assert.equal(okParsed.isValid, true);
    assert.equal(okParsed.signed, true);
    assert.equal(okParsed.legacy, false);

    // 2. Minimal 1-bit / single-LSB mutation in EQ band gain (4.0 -> 4.0000001)
    const tamperedEq = JSON.parse(JSON.stringify(signedBundle));
    tamperedEq.settings.eqBands[0].gain = 4.0000001;
    const eqRes = lib.verifyConfigurationBundle(JSON.stringify(tamperedEq));
    assert.equal(eqRes.valid, false);
    assert.equal(eqRes.signed, true);
    assert.equal(eqRes.reason, 'checksum_mismatch');
    const eqValidated = lib.validateAndParseConfiguration(JSON.stringify(tamperedEq));
    assert.equal(eqValidated.isValid, false);
    assert.equal(eqValidated.reason, 'checksum_mismatch');

    // 3. Minimal mutation in playlist item (1-bit char flip 'Kind of Blue' -> 'Kind of Bluf')
    const tamperedPlaylist = JSON.parse(JSON.stringify(signedBundle));
    tamperedPlaylist.playlists[0].tracks[0].title = 'Kind of Bluf';
    const plRes = lib.verifyConfigurationBundle(tamperedPlaylist);
    assert.equal(plRes.valid, false);
    assert.equal(plRes.signed, true);
    assert.equal(plRes.reason, 'checksum_mismatch');

    // Also test signed standalone shareable playlist bundle tamper detection
    const sharePlaylist = lib.signConfigurationBundle(
      lib.buildShareablePlaylistPayload('Hi-Res Vocal', [{ id: 'v1', title: 'Mùa Thu Cho Em', artist: 'Khánh Ly', duration: 285 }])
    );
    assert.equal(lib.parseShareablePlaylistPayload(JSON.stringify(sharePlaylist)).isValid, true);
    const badSharePlaylist = JSON.parse(JSON.stringify(sharePlaylist));
    badSharePlaylist.tracks[0].duration = 284; // 1-bit flip in duration (285 ^ 1 = 284)
    const badShareRes = lib.parseShareablePlaylistPayload(JSON.stringify(badSharePlaylist));
    assert.equal(badShareRes.isValid, false);
    assert.equal(badShareRes.reason, 'checksum_mismatch');

    // 4. Corrupted JSON & malformed binary input -> reason: 'corrupted_json'
    for (const bad of ['', '   ', '{ "appName": "Nocturne", broken', '[]', 'null', '42', new Uint8Array([0xff, 0xfe, 0xfd])]) {
      const badRes = lib.verifyConfigurationBundle(bad);
      assert.equal(badRes.valid, false);
      assert.equal(badRes.signed, false);
      assert.equal(badRes.reason, 'corrupted_json');
    }

    // 5. Legacy unsigned backup (pre-UPG-04) remains 100% valid with { valid: true, signed: false, legacy: true }
    const legacyUnsignedJson = JSON.stringify({
      appName: 'Nocturne',
      version: 1,
      exportedAt: '2026-10-01T00:00:00.000Z',
      favorites: ['legacy-track-1'],
      playlists: [{ id: 'legacy-pl', name: 'Old Backup' }],
      settings: { autoEqProfile: 'vocal', crossfeed: 0.25 }
    });
    const legacyVer = lib.verifyConfigurationBundle(legacyUnsignedJson);
    assert.equal(legacyVer.valid, true);
    assert.equal(legacyVer.signed, false);
    assert.equal(legacyVer.legacy, true);
    assert.equal(legacyVer.reason, null);

    const legacyParsed = lib.validateAndParseConfiguration(legacyUnsignedJson);
    assert.equal(legacyParsed.isValid, true);
    assert.equal(legacyParsed.signed, false);
    assert.equal(legacyParsed.legacy, true);
    assert.deepEqual(legacyParsed.config.favorites, ['legacy-track-1']);
  });
});

describe('Autonomy Tail-Chaining Cycle 11 — OPT-04 (OffscreenCanvas Safe Fallback & Adaptive FiiO DAP Frame Governor)', () => {
  it('exposes OPT-04 createAdaptiveCanvasRenderGovernor on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createAdaptiveCanvasRenderGovernor, 'function');

    const sandbox = { library: { keepRefOpt04: 'dap' } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createAdaptiveCanvasRenderGovernor, 'function');
    assert.equal(typeof sandbox.library.createAdaptiveCanvasRenderGovernor, 'function');
    assert.equal(sandbox.library.keepRefOpt04, 'dap');
  });

  it('resolves OffscreenCanvas 2D when supported and safely falls back to HTMLCanvasElement when transferControlToOffscreen throws or is missing', () => {
    // 1. Supported transferControlToOffscreen + WeakMap deduplication (never calls transfer twice)
    let transferCount = 0;
    const mockOffscreenCtx = { kind: 'offscreen-2d', fillRect() {} };
    const goodCanvas = {
      width: 320,
      height: 160,
      transferControlToOffscreen() {
        transferCount += 1;
        if (transferCount > 1) {
          throw Object.assign(new Error('Cannot transfer control more than once'), { name: 'InvalidStateError' });
        }
        return {
          width: 320,
          height: 160,
          getContext(type) { return type === '2d' ? mockOffscreenCtx : null; }
        };
      },
      getContext() {
        throw new Error('Main-thread getContext should not be called when OffscreenCanvas succeeds');
      }
    };

    const govOk = lib.createAdaptiveCanvasRenderGovernor({ canvas: goodCanvas });
    const surf1 = govOk.getSurface();
    const surf2 = govOk.resolveCanvasSurface(goodCanvas);
    assert.equal(surf1.isOffscreen, true);
    assert.equal(surf1.mode, 'offscreen');
    assert.strictEqual(surf1.ctx, mockOffscreenCtx);
    assert.strictEqual(surf1, surf2, 'Surface must be cached per HTMLCanvasElement');
    assert.equal(transferCount, 1);
    assert.equal(surf1.resize(640, 240), true);
    assert.equal(surf1.targetCanvas.width, 640);
    assert.equal(surf1.targetCanvas.height, 240);

    // 2. Android WebView / already-bound canvas where transferControlToOffscreen throws InvalidStateError / NotSupportedError
    const fallback2dCtx = { kind: 'main-thread-2d', clearRect() {} };
    const throwingCanvas = {
      width: 280,
      height: 120,
      transferControlToOffscreen() {
        const err = new Error('OffscreenCanvas transfer unsupported in this WebView');
        err.name = 'InvalidStateError';
        throw err;
      },
      getContext(type) {
        return type === '2d' ? fallback2dCtx : null;
      }
    };

    const govFallback = lib.createAdaptiveCanvasRenderGovernor({ canvas: throwingCanvas });
    const fbSurface = govFallback.getSurface();
    assert.equal(fbSurface.isOffscreen, false);
    assert.equal(fbSurface.mode, 'main-thread-fallback');
    assert.equal(fbSurface.fallbackReason, 'InvalidStateError');
    assert.strictEqual(fbSurface.ctx, fallback2dCtx);
    assert.equal(govFallback.getState().isOffscreen, false);
    assert.equal(govFallback.getState().surfaceMode, 'main-thread-fallback');

    // 3. Legacy canvas with no transferControlToOffscreen method at all
    const legacyCtx = { kind: 'legacy-2d' };
    const legacyCanvas = {
      width: 200,
      height: 80,
      getContext(type) { return type === '2d' ? legacyCtx : null; }
    };
    const legacySurface = govFallback.resolveCanvasSurface(legacyCanvas);
    assert.equal(legacySurface.isOffscreen, false);
    assert.equal(legacySurface.mode, 'main-thread-fallback');
    assert.equal(legacySurface.fallbackReason, 'transferControlToOffscreen_unsupported');
    assert.strictEqual(legacySurface.ctx, legacyCtx);
  });

  it('gates frames accurately across 60fps desktop, 30fps fiioDapMode/lowPower, 15fps >1.5s silence, and 0fps documentHidden/modalOccluded with zero allocations', () => {
    const gov = lib.createAdaptiveCanvasRenderGovernor({
      fiioDapMode: false,
      idleSilenceThresholdMs: 1500
    });
    const stateRefBefore = gov.getState();

    // Simulate 120Hz rAF callback ticks (120 ticks * 8.3333ms = 1,000ms)
    // 1. Desktop active audio -> 60fps (renders 60 out of 120 ticks)
    const activeSignal = { rms: 0.18, peak: 0.62, overallEnergy: 0.35, documentHidden: false, modalOccluded: false };
    let desktopRendered = 0;
    for (let i = 0; i < 120; i++) {
      if (gov.shouldRenderFrame(i * (1000 / 120), activeSignal)) {
        desktopRendered += 1;
      }
    }
    assert.equal(gov.getState().targetFps, 60);
    assert.equal(desktopRendered, 60, `Expected 60 rendered frames on desktop in 1s, got ${desktopRendered}`);

    // 2. FiiO M11S DAP mode (fiioDapMode: true) -> 30fps (renders 30 out of 120 ticks)
    gov.reset();
    gov.setMode({ fiioDapMode: true });
    let dapRendered = 0;
    for (let i = 0; i < 120; i++) {
      if (gov.shouldRenderFrame(1000 + i * (1000 / 120), activeSignal)) {
        dapRendered += 1;
      }
    }
    assert.equal(gov.getState().targetFps, 30);
    assert.equal(gov.getState().tier, 'fiio_dap_30fps');
    assert.equal(dapRendered, 30, `Expected 30 rendered frames in fiioDapMode in 1s, got ${dapRendered}`);

    // Native FiiO window auto-detection also defaults to 30fps
    const autoFiioGov = lib.createAdaptiveCanvasRenderGovernor({
      window: { NocturneNative: {}, isNativeAndroid: true }
    });
    assert.equal(autoFiioGov.resolveTargetFps(0, activeSignal), 30);

    // 3. Idle silence (> 1,500ms) -> stays 60fps during decay (< 1.5s), drops to 15fps after 1.5s, recovers to 60fps immediately on audio
    gov.reset();
    gov.setMode({ fiioDapMode: false });
    const silentSignal = { rms: 0.00005, peak: 0.0001, overallEnergy: 0.0001, rmsDb: -86 };
    gov.shouldRenderFrame(0, silentSignal); // starts silence clock at t=0
    assert.equal(gov.resolveTargetFps(1400, silentSignal), 60, 'Decay window <= 1500ms must preserve full 60fps needle ballistics');
    assert.equal(gov.resolveTargetFps(1501, silentSignal), 15, 'Silence > 1500ms must throttle down to 15fps');

    let idleRendered = 0;
    for (let i = 0; i < 60; i++) {
      // 60Hz ticks from t=2000ms to t=2983.33ms while silent > 1.5s
      if (gov.shouldRenderFrame(2000 + i * (1000 / 60), silentSignal)) {
        idleRendered += 1;
      }
    }
    assert.equal(gov.getState().targetFps, 15);
    assert.equal(gov.getState().tier, 'idle_silence_15fps');
    assert.equal(idleRendered, 15, `Expected 15 rendered frames in 1s during idle silence, got ${idleRendered}`);

    // Instant wake back to 60fps when music transient hits
    assert.equal(gov.resolveTargetFps(3100, activeSignal), 60);
    assert.equal(gov.getState().silentDurationMs, 0);

    // 4. Immediate 0fps pause when documentHidden === true or modalOccluded === true
    let hiddenRendered = 0;
    for (let i = 0; i < 60; i++) {
      if (gov.shouldRenderFrame(4000 + i * 16.67, { rms: 0.25, documentHidden: true })) {
        hiddenRendered += 1;
      }
      if (gov.shouldRenderFrame(5000 + i * 16.67, { rms: 0.25, modalOccluded: true })) {
        hiddenRendered += 1;
      }
    }
    assert.equal(hiddenRendered, 0, 'Must render 0 frames when documentHidden or modalOccluded is true');
    assert.equal(gov.getState().targetFps, 0);
    assert.equal(gov.getState().tier, 'paused_0fps');

    // Immediate first-frame recovery when tab becomes visible again
    assert.equal(gov.shouldRenderFrame(6100, activeSignal), true);
    assert.equal(gov.getState().targetFps, 60);

    // Pre-allocated state reference invariant (zero heap churn)
    assert.strictEqual(gov.getState(), stateRefBefore);
  });
});

describe('Autonomy Tail-Chaining Cycle 12 — BUG-05 (Safe ISO BMFF / MP4 / ALAC Atom Parser, 64-Bit Extended Boxes & Tail-moov Range 206 Detection)', () => {
  function makeBox(type, payloadBytes) {
    const body = payloadBytes instanceof Uint8Array ? payloadBytes : new Uint8Array(payloadBytes || 0);
    const out = new Uint8Array(8 + body.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, out.byteLength, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    return out;
  }

  function concatBytes(...arrays) {
    const total = arrays.reduce((acc, a) => acc + a.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
      out.set(a, off);
      off += a.byteLength;
    }
    return out;
  }

  function buildFtypBox(major = 'M4A ', compat = ['M4A ', 'mp42', 'isom']) {
    const body = new Uint8Array(8 + compat.length * 4);
    for (let i = 0; i < 4; i++) body[i] = major.charCodeAt(i);
    // minor_version = 0 at 4..7
    compat.forEach((brand, idx) => {
      for (let i = 0; i < 4; i++) body[8 + idx * 4 + i] = brand.charCodeAt(i);
    });
    return makeBox('ftyp', body);
  }

  function buildMdhdBoxV0(timescale, duration32) {
    const body = new Uint8Array(20);
    const dv = new DataView(body.buffer);
    body[0] = 0; // version 0
    dv.setUint32(12, timescale, false);
    dv.setUint32(16, duration32, false);
    return makeBox('mdhd', body);
  }

  function buildMdhdBoxV1(timescale, duration64) {
    const body = new Uint8Array(32);
    const dv = new DataView(body.buffer);
    body[0] = 1; // version 1 (64-bit duration)
    dv.setUint32(20, timescale, false);
    dv.setUint32(24, Math.floor(duration64 / 4294967296) >>> 0, false);
    dv.setUint32(28, (duration64 >>> 0), false);
    return makeBox('mdhd', body);
  }

  function buildAlacStsdBox({ sampleRate = 96000, bitDepth = 24, channels = 2, frameLength = 4096, avgBitRate = 2850000 } = {}) {
    // Inner 'alac' FullBox: 4B version/flags + 24B ALACSpecificConfig Magic Cookie = 28B body (36B box)
    const cookieBody = new Uint8Array(28);
    const cdv = new DataView(cookieBody.buffer);
    // cookieBody[0..3] = version 0 + flags 0
    cdv.setUint32(4 + 0, frameLength, false);
    cookieBody[4 + 4] = 0;        // compatibleVersion
    cookieBody[4 + 5] = bitDepth; // bitDepth (24)
    cookieBody[4 + 6] = 40;       // pb
    cookieBody[4 + 7] = 10;       // mb
    cookieBody[4 + 8] = 14;       // kb
    cookieBody[4 + 9] = channels; // numChannels (2)
    cdv.setUint16(4 + 10, 255, false);
    cdv.setUint32(4 + 12, 16384, false);
    cdv.setUint32(4 + 16, avgBitRate, false);
    cdv.setUint32(4 + 20, sampleRate, false); // True 32-bit sampleRate (e.g. 96000 Hz)
    const innerAlacBox = makeBox('alac', cookieBody);

    // Outer 'alac' AudioSampleEntry: 28B header + innerAlacBox
    // Intentionally set 16.16 fixed-point samplerate field to wrapped 30464 (96000 & 0xffff) to prove cookie wins!
    const aseHeader = new Uint8Array(28);
    const adv = new DataView(aseHeader.buffer);
    adv.setUint16(6, 1, false);  // data_reference_index = 1
    adv.setUint16(16, 2, false); // channelcount
    adv.setUint16(18, 16, false); // legacy placeholder 16 in outer header while cookie has 24-bit!
    adv.setUint32(24, ((sampleRate & 0xffff) << 16) >>> 0, false);
    const outerAlacEntry = makeBox('alac', concatBytes(aseHeader, innerAlacBox));

    // 'stsd' FullBox: 4B version/flags + 4B entry_count(1) + outerAlacEntry
    const stsdHeader = new Uint8Array(8);
    new DataView(stsdHeader.buffer).setUint32(4, 1, false);
    return makeBox('stsd', concatBytes(stsdHeader, outerAlacEntry));
  }

  function buildMoovWithAlac({ sampleRate = 96000, bitDepth = 24, channels = 2, durationSeconds = 180, mdhdV1 = false } = {}) {
    const totalSamples = Math.round(sampleRate * durationSeconds);
    const mdhd = mdhdV1 ? buildMdhdBoxV1(sampleRate, totalSamples) : buildMdhdBoxV0(sampleRate, totalSamples);
    const stsd = buildAlacStsdBox({ sampleRate, bitDepth, channels });
    const stbl = makeBox('stbl', stsd);
    const minf = makeBox('minf', stbl);
    const mdia = makeBox('mdia', concatBytes(mdhd, minf));
    const trak = makeBox('trak', mdia);
    const udta = makeBox('udta', makeBox('meta', new Uint8Array(8)));
    return makeBox('moov', concatBytes(trak, udta));
  }

  it('exposes BUG-05 parseSafeMp4AlacBoxMetadata on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.parseSafeMp4AlacBoxMetadata, 'function');

    const sandbox = { library: { keepRefBug05: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.parseSafeMp4AlacBoxMetadata, 'function');
    assert.equal(typeof sandbox.library.parseSafeMp4AlacBoxMetadata, 'function');
    assert.equal(sandbox.library.keepRefBug05, true);
  });

  it('parses valid ftyp+moov ALAC 24-bit/96kHz Magic Cookie, mdhd v0 & v1 64-bit durations, and delegates from parseSafeAudioContainerMetadata', () => {
    const ftyp = buildFtypBox('M4A ', ['M4A ', 'mp42', 'isom']);
    const free = makeBox('free', new Uint8Array(16));
    const moovV0 = buildMoovWithAlac({ sampleRate: 96000, bitDepth: 24, channels: 2, durationSeconds: 215.5, mdhdV1: false });
    const mdat = makeBox('mdat', new Uint8Array(64));
    const fastStartM4a = concatBytes(ftyp, free, moovV0, mdat);

    const parsedDirect = lib.parseSafeMp4AlacBoxMetadata(fastStartM4a, fastStartM4a.byteLength);
    assert.equal(parsedDirect.valid, true);
    assert.equal(parsedDirect.containerValid, true);
    assert.equal(parsedDirect.format, 'ALAC');
    assert.equal(parsedDirect.container, 'M4A');
    assert.equal(parsedDirect.codec, 'alac');
    assert.equal(parsedDirect.sampleRate, 96000);
    assert.equal(parsedDirect.bitDepth, 24);
    assert.equal(parsedDirect.channels, 2);
    assert.equal(parsedDirect.frameLength, 4096);
    assert.equal(parsedDirect.mdhdVersion, 0);
    assert.ok(Math.abs(parsedDirect.durationSeconds - 215.5) < 1e-6);
    assert.equal(parsedDirect.needsTailRange, false);
    assert.equal(parsedDirect.truncated, false);
    assert.equal(parsedDirect.error, null);
    assert.ok(parsedDirect.alacCookie && parsedDirect.alacCookie.sampleRate === 96000 && parsedDirect.alacCookie.bitDepth === 24);

    // Delegation via parseSafeAudioContainerMetadata (including after an ID3v2 header!)
    const delegated = lib.parseSafeAudioContainerMetadata(fastStartM4a);
    assert.equal(delegated.valid, true);
    assert.equal(delegated.format, 'ALAC');
    assert.equal(delegated.sampleRate, 96000);
    assert.equal(delegated.bitDepth, 24);
    assert.equal(delegated.channels, 2);

    // Verify mdhd v1 64-bit duration (> 2^32 sample units at 192kHz: 7 hours = 4,838,400,000 samples!)
    const moovV1 = buildMoovWithAlac({ sampleRate: 192000, bitDepth: 24, channels: 2, durationSeconds: 25200, mdhdV1: true });
    const hiResLongM4a = concatBytes(ftyp, moovV1, mdat);
    const parsedV1 = lib.parseSafeMp4AlacBoxMetadata(hiResLongM4a);
    assert.equal(parsedV1.valid, true);
    assert.equal(parsedV1.sampleRate, 192000);
    assert.equal(parsedV1.bitDepth, 24);
    assert.equal(parsedV1.mdhdVersion, 1);
    assert.equal(parsedV1.durationUnits, 192000 * 25200);
    assert.equal(parsedV1.durationSeconds, 25200);
  });

  it('detects 64-bit largesize=1 mdat before moov on HTTP 206 head slices and computes exact tail Range coordinates', () => {
    const ftyp = buildFtypBox('M4A ', ['M4A ', 'isom']); // 8 + 8 + 8 = 24 bytes
    assert.equal(ftyp.byteLength, 24);

    // Build 64-bit extended mdat header (size32 = 1, 16-byte header) declaring a 5,000,000,000-byte (>4 GiB) mdat payload!
    const largeMdatSize = 5_000_000_000;
    const mdatHeader64 = new Uint8Array(16 + 88); // only first 104 bytes of mdat included in HTTP 206 head slice
    const mdv = new DataView(mdatHeader64.buffer);
    mdv.setUint32(0, 1, false); // largesize === 1 indicator
    for (let i = 0; i < 4; i++) mdatHeader64[4 + i] = 'mdat'.charCodeAt(i);
    mdv.setUint32(8, Math.floor(largeMdatSize / 4294967296) >>> 0, false);
    mdv.setUint32(12, (largeMdatSize >>> 0), false);

    const headSlice206 = concatBytes(ftyp, mdatHeader64); // 128-byte HTTP 206 Partial Content head slice
    const tailMoov = buildMoovWithAlac({ sampleRate: 96000, bitDepth: 24, channels: 2, durationSeconds: 312.25 });
    const totalCloudFileSize = ftyp.byteLength + largeMdatSize + tailMoov.byteLength;

    // Step 1: Parse HTTP 206 head slice -> must NOT throw RangeError, must report needsTailRange: true & exact tail coordinates!
    const headRes = lib.parseSafeAudioContainerMetadata(headSlice206, totalCloudFileSize);
    assert.equal(headRes.valid, false);
    assert.equal(headRes.containerValid, true);
    assert.equal(headRes.hasFtyp, true);
    assert.equal(headRes.hasMdat, true);
    assert.equal(headRes.hasMoov, false);
    assert.equal(headRes.mdatBeforeMoov, true);
    assert.equal(headRes.used64BitBox, true);
    assert.equal(headRes.mdatOffset, 24);
    assert.equal(headRes.mdatSize, 5_000_000_000);
    assert.equal(headRes.needsTailRange, true);
    assert.equal(headRes.recommendedTailOffset, 5_000_000_024);
    assert.equal(headRes.recommendedTailLength, tailMoov.byteLength);
    assert.equal(
      headRes.recommendedRangeHeader,
      `bytes=${5_000_000_024}-${5_000_000_024 + tailMoov.byteLength - 1}`
    );

    // Step 2: Feed the fetched HTTP 206 tail slice (starting directly at moov!) back into parseSafeMp4AlacBoxMetadata
    const tailRes = lib.parseSafeMp4AlacBoxMetadata(tailMoov, totalCloudFileSize);
    assert.equal(tailRes.valid, true);
    assert.equal(tailRes.format, 'ALAC');
    assert.equal(tailRes.sampleRate, 96000);
    assert.equal(tailRes.bitDepth, 24);
    assert.equal(tailRes.channels, 2);
    assert.equal(tailRes.durationSeconds, 312.25);
    assert.equal(tailRes.needsTailRange, false);
  });

  it('enforces zero-loop protection on corrupted boxSize=0 / boxSize=3 / largesize<16 and never throws on 5-byte truncated slices', () => {
    const ftyp = buildFtypBox('M4A ', ['M4A ']);

    // 1. Corrupted boxSize = 0 after ftyp -> instant return (<10ms), 0 infinite loop!
    const zeroBox = new Uint8Array(16);
    for (let i = 0; i < 4; i++) zeroBox[4 + i] = 'free'.charCodeAt(i); // size = 0!
    const t0 = performance.now();
    const resZero = lib.parseSafeMp4AlacBoxMetadata(concatBytes(ftyp, zeroBox));
    assert.ok(performance.now() - t0 < 15, 'boxSize=0 must terminate immediately without looping');
    assert.equal(resZero.valid, false);
    assert.equal(resZero.corruptedBox, true);
    assert.equal(resZero.error, 'invalid_mp4_box_size');

    // 2. Corrupted boxSize = 3 (< 8 minimum header size) -> instant return, 0 infinite loop!
    const size3Box = new Uint8Array(16);
    new DataView(size3Box.buffer).setUint32(0, 3, false);
    for (let i = 0; i < 4; i++) size3Box[4 + i] = 'moov'.charCodeAt(i);
    const t3 = performance.now();
    const resSize3 = lib.parseSafeMp4AlacBoxMetadata(concatBytes(ftyp, size3Box));
    assert.ok(performance.now() - t3 < 15, 'boxSize=3 must terminate immediately without looping');
    assert.equal(resSize3.valid, false);
    assert.equal(resSize3.corruptedBox, true);
    assert.equal(resSize3.error, 'invalid_mp4_box_size');

    // 3. Corrupted 64-bit largesize = 8 (< 16 minimum extended header size)
    const badLarge = new Uint8Array(24);
    const bdv = new DataView(badLarge.buffer);
    bdv.setUint32(0, 1, false);
    for (let i = 0; i < 4; i++) badLarge[4 + i] = 'mdat'.charCodeAt(i);
    bdv.setUint32(8, 0, false);
    bdv.setUint32(12, 8, false); // < 16!
    const resBadLarge = lib.parseSafeMp4AlacBoxMetadata(concatBytes(ftyp, badLarge));
    assert.equal(resBadLarge.valid, false);
    assert.equal(resBadLarge.corruptedBox, true);
    assert.equal(resBadLarge.error, 'invalid_mp4_largesize');

    // 4. Truncated 5-byte slice & unaligned DataView slice
    const truncated5 = new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66]); // 5 bytes ('f' of 'ftyp')
    const res5 = lib.parseSafeMp4AlacBoxMetadata(truncated5, 1048576);
    assert.equal(res5.valid, false);
    assert.equal(res5.truncated, true);
    assert.equal(res5.needsTailRange, false);
    assert.equal(res5.byteLength, 5);
    assert.equal(res5.error, 'truncated_mp4_box_header');

    const res5Delegated = lib.parseSafeAudioContainerMetadata(truncated5, 1048576);
    assert.equal(res5Delegated.valid, false);
    assert.equal(res5Delegated.truncated, true);
    assert.equal(res5Delegated.byteLength, 5);

    // 5. Exhaustive byte-by-byte truncation fuzz across an entire valid ALAC M4A container -> 0 RangeError throws!
    const fullValid = concatBytes(
      ftyp,
      buildMoovWithAlac({ sampleRate: 88200, bitDepth: 24, channels: 2, durationSeconds: 45 }),
      makeBox('mdat', new Uint8Array(32))
    );
    const unalignedBacking = new Uint8Array(fullValid.byteLength + 11);
    unalignedBacking.set(fullValid, 7);
    for (let cut = 0; cut <= fullValid.byteLength; cut++) {
      const subView = new DataView(unalignedBacking.buffer, 7, cut);
      assert.doesNotThrow(() => {
        lib.parseSafeMp4AlacBoxMetadata(subView, fullValid.byteLength);
        lib.parseSafeAudioContainerMetadata(subView, fullValid.byteLength);
      }, `Must never throw RangeError at truncation length ${cut}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ATOMIC CYCLE 13 — UPG-05: Binary FLAC VORBIS_COMMENT & DSF ID3v2 ReplayGain/R128 Extractor
// ═════════════════════════════════════════════════════════════════════════════
describe('UPG-05 — Binary FLAC VORBIS_COMMENT & DSF ID3v2 ReplayGain 2.0 / EBU R128 Extractor', () => {
  function concatU8(...arrays) {
    const total = arrays.reduce((acc, a) => acc + a.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
      out.set(arr, offset);
      offset += arr.byteLength;
    }
    return out;
  }

  function encodeSyncsafe32(val) {
    return new Uint8Array([
      (val >>> 21) & 0x7f,
      (val >>> 14) & 0x7f,
      (val >>> 7) & 0x7f,
      val & 0x7f
    ]);
  }

  function buildFlacMetadataBlock(blockType, isLast, bodyBytes) {
    const header = new Uint8Array(4);
    header[0] = (isLast ? 0x80 : 0x00) | (blockType & 0x7f);
    header[1] = (bodyBytes.byteLength >>> 16) & 0xff;
    header[2] = (bodyBytes.byteLength >>> 8) & 0xff;
    header[3] = bodyBytes.byteLength & 0xff;
    return concatU8(header, bodyBytes);
  }

  function buildFlacStreamInfoBody({ sampleRate = 96000, channels = 2, bitDepth = 24, totalSamples = 96000 * 180 } = {}) {
    const b = new Uint8Array(34);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, 4096, false);
    dv.setUint16(2, 4096, false);
    b[10] = (sampleRate >>> 12) & 0xff;
    b[11] = (sampleRate >>> 4) & 0xff;
    b[12] = ((sampleRate & 0x0f) << 4) | (((channels - 1) & 0x07) << 1) | (((bitDepth - 1) >>> 4) & 0x01);
    b[13] = (((bitDepth - 1) & 0x0f) << 4) | (Math.floor(totalSamples / 4294967296) & 0x0f);
    dv.setUint32(14, totalSamples >>> 0, false);
    return b;
  }

  function buildVorbisCommentBody(vendorStr, commentList) {
    const te = new TextEncoder();
    const vendorBytes = te.encode(vendorStr);
    const encodedComments = commentList.map(c => te.encode(c));
    let totalLen = 4 + vendorBytes.byteLength + 4;
    for (const ec of encodedComments) totalLen += 4 + ec.byteLength;

    const out = new Uint8Array(totalLen);
    const dv = new DataView(out.buffer);
    let pos = 0;
    dv.setUint32(pos, vendorBytes.byteLength, true);
    pos += 4;
    out.set(vendorBytes, pos);
    pos += vendorBytes.byteLength;
    dv.setUint32(pos, encodedComments.length, true);
    pos += 4;
    for (const ec of encodedComments) {
      dv.setUint32(pos, ec.byteLength, true);
      pos += 4;
      out.set(ec, pos);
      pos += ec.byteLength;
    }
    return out;
  }

  function encodeUtf16String(str, littleEndian, withBom) {
    const out = new Uint8Array((withBom ? 2 : 0) + str.length * 2);
    let p = 0;
    if (withBom) {
      out[p++] = littleEndian ? 0xff : 0xfe;
      out[p++] = littleEndian ? 0xfe : 0xff;
    }
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (littleEndian) {
        out[p++] = code & 0xff;
        out[p++] = (code >>> 8) & 0xff;
      } else {
        out[p++] = (code >>> 8) & 0xff;
        out[p++] = code & 0xff;
      }
    }
    return out;
  }

  function buildId3v24TxxxFrame(key, val, encoding = 0x03, { littleEndian = true } = {}) {
    const te = new TextEncoder();
    let payload;
    if (encoding === 0x03 || encoding === 0x00) {
      const kBytes = te.encode(key);
      const vBytes = te.encode(val);
      payload = concatU8(new Uint8Array([encoding]), kBytes, new Uint8Array([0x00]), vBytes, new Uint8Array([0x00]));
    } else if (encoding === 0x01) {
      const kBytes = encodeUtf16String(key, littleEndian, true);
      const vBytes = encodeUtf16String(val, littleEndian, true);
      payload = concatU8(new Uint8Array([0x01]), kBytes, new Uint8Array([0x00, 0x00]), vBytes, new Uint8Array([0x00, 0x00]));
    } else {
      const kBytes = encodeUtf16String(key, false, false);
      const vBytes = encodeUtf16String(val, false, false);
      payload = concatU8(new Uint8Array([0x02]), kBytes, new Uint8Array([0x00, 0x00]), vBytes);
    }

    const header = new Uint8Array(10);
    for (let i = 0; i < 4; i++) header[i] = 'TXXX'.charCodeAt(i);
    header.set(encodeSyncsafe32(payload.byteLength), 4);
    return concatU8(header, payload);
  }

  function buildId3v24Tag(framesBytes, paddingBytes = 8) {
    const body = concatU8(...framesBytes, new Uint8Array(paddingBytes));
    const header = new Uint8Array(10);
    header[0] = 0x49; // 'I'
    header[1] = 0x44; // 'D'
    header[2] = 0x33; // '3'
    header[3] = 4;    // v2.4
    header[4] = 0;
    header[5] = 0;
    header.set(encodeSyncsafe32(body.byteLength), 6);
    return concatU8(header, body);
  }

  function buildDsfWithTrailingId3(id3TagBytes, audioPayloadBytes = 64) {
    // 28B 'DSD ' + 52B 'fmt ' + (12B + audioPayloadBytes) 'data' + trailing ID3v2
    const id3Offset = 28 + 52 + 12 + audioPayloadBytes;
    const totalSize = id3Offset + (id3TagBytes ? id3TagBytes.byteLength : 0);

    const dsdChunk = new Uint8Array(28);
    const dsdDv = new DataView(dsdChunk.buffer);
    for (let i = 0; i < 4; i++) dsdChunk[i] = 'DSD '.charCodeAt(i);
    dsdDv.setUint32(4, 28, true);
    dsdDv.setUint32(12, totalSize >>> 0, true);
    dsdDv.setUint32(20, id3TagBytes ? (id3Offset >>> 0) : 0, true);

    const fmtChunk = new Uint8Array(52);
    const fmtDv = new DataView(fmtChunk.buffer);
    for (let i = 0; i < 4; i++) fmtChunk[i] = 'fmt '.charCodeAt(i);
    fmtDv.setUint32(4, 52, true);
    fmtDv.setUint32(12, 1, true);
    fmtDv.setUint32(20, 2, true);
    fmtDv.setUint32(24, 2, true);
    fmtDv.setUint32(28, 2822400, true);
    fmtDv.setUint32(32, 1, true);
    fmtDv.setUint32(36, 2822400 * 60, true);
    fmtDv.setUint32(44, 4096, true);

    const dataChunk = new Uint8Array(12 + audioPayloadBytes);
    const dataDv = new DataView(dataChunk.buffer);
    for (let i = 0; i < 4; i++) dataChunk[i] = 'data'.charCodeAt(i);
    dataDv.setUint32(4, 12 + audioPayloadBytes, true);

    return id3TagBytes
      ? concatU8(dsdChunk, fmtChunk, dataChunk, id3TagBytes)
      : concatU8(dsdChunk, fmtChunk, dataChunk);
  }

  it('exposes extractBinaryReplayGainTags & computeAntiClippingLinearGain on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.extractBinaryReplayGainTags, 'function');
    assert.equal(typeof lib.computeAntiClippingLinearGain, 'function');

    const sandbox = { library: { keepRefUpg05: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.extractBinaryReplayGainTags, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.computeAntiClippingLinearGain, 'function');
    assert.equal(typeof sandbox.library.extractBinaryReplayGainTags, 'function');
    assert.equal(typeof sandbox.library.computeAntiClippingLinearGain, 'function');
    assert.equal(sandbox.library.keepRefUpg05, true);
  });

  it('computes exact anti-clipping peak limiter linear gain across boost, attenuation, preamp, and zero/overshoot peaks', () => {
    // 1. Attenuation (-6 dB, peak 0.98) -> unclipped 10^(-6/20)
    const gAtten = lib.computeAntiClippingLinearGain(-6, 0.98, 0);
    assert.ok(Math.abs(gAtten - Math.pow(10, -6 / 20)) < 1e-9);

    // 2. Positive boost (+6 dB ≈ 1.995x) with peak 0.8 -> clamped to 1 / 0.8 = 1.25
    const gClamped = lib.computeAntiClippingLinearGain(6, 0.8, 0);
    assert.ok(Math.abs(gClamped - 1.25) < 1e-9);

    // 3. Positive boost with preamp (+2 dB + +4 dB = +6 dB) with peak 0.75 -> clamped to 1 / 0.75 = 1.333333...
    const gPreampClamped = lib.computeAntiClippingLinearGain(2, 0.75, 4);
    assert.ok(Math.abs(gPreampClamped - (1 / 0.75)) < 1e-9);

    // 4. Inter-sample true peak overshoot > 1.0 (gain 0 dB, peakLinear 1.25) -> attenuated to 0.8!
    const gTruePeakOvershoot = lib.computeAntiClippingLinearGain(0, 1.25, 0);
    assert.ok(Math.abs(gTruePeakOvershoot - 0.8) < 1e-9);

    // 5. Degenerate zero / negative / undefined peakLinear never produces Infinity or NaN
    const gZeroPeak = lib.computeAntiClippingLinearGain(6, 0, 0);
    assert.ok(Number.isFinite(gZeroPeak) && Math.abs(gZeroPeak - Math.pow(10, 6 / 20)) < 1e-9);
    const gNegPeak = lib.computeAntiClippingLinearGain(6, -0.5, 0);
    assert.ok(Number.isFinite(gNegPeak) && Math.abs(gNegPeak - Math.pow(10, 6 / 20)) < 1e-9);
    const gUndefPeak = lib.computeAntiClippingLinearGain(6, undefined, 0);
    assert.equal(gUndefPeak, 1.0);
  });

  it('extracts ReplayGain 2.0 & EBU R128 Q7.8 (+5 dB reference shift) from FLAC VORBIS_COMMENT blocks', () => {
    const flacMagic = new TextEncoder().encode('fLaC');
    const streamInfo = buildFlacMetadataBlock(0, false, buildFlacStreamInfoBody());

    // Case A: Standard ReplayGain 2.0 Vorbis Comments + Unicode tags
    const vcBodyRg = buildVorbisCommentBody('reference libFLAC 1.4.3', [
      'TITLE=Đêm Huyền Diệu 夜曲',
      'ARTIST=Thiên Nguyễn',
      'REPLAYGAIN_TRACK_GAIN=-6.50 dB',
      'REPLAYGAIN_TRACK_PEAK=0.988553',
      'REPLAYGAIN_ALBUM_GAIN=+3.20 dB',
      'REPLAYGAIN_ALBUM_PEAK=0.800000'
    ]);
    const flacRg = concatU8(flacMagic, streamInfo, buildFlacMetadataBlock(4, true, vcBodyRg));

    const resRg = lib.extractBinaryReplayGainTags(flacRg);
    assert.equal(resRg.valid, true);
    assert.equal(resRg.format, 'FLAC');
    assert.equal(resRg.source, 'vorbis_comment');
    assert.equal(resRg.hasReplayGain, true);
    assert.equal(resRg.hasTrackGain, true);
    assert.equal(resRg.hasAlbumGain, true);
    assert.equal(resRg.hasTrackPeak, true);
    assert.equal(resRg.hasAlbumPeak, true);
    assert.equal(resRg.r128ReferenceAdjusted, false);
    assert.equal(resRg.trackGain, -6.5);
    assert.equal(resRg.trackPeak, 0.988553);
    assert.equal(resRg.albumGain, 3.2);
    assert.equal(resRg.albumPeak, 0.8);
    // Album gain +3.2 dB (1.4454x) * 0.8 peak = 1.156 > 1.0 -> anti-clipping clamps albumLinearGain to 1/0.8 = 1.25!
    assert.ok(Math.abs(resRg.albumLinearGain - 1.25) < 1e-9);
    assert.ok(Math.abs(resRg.trackLinearGain - Math.pow(10, -6.5 / 20)) < 1e-9);

    // Seamless compatibility with computeReplayGainMultiplier & calculateDynamicReplayGain
    const multRes = lib.computeReplayGainMultiplier(resRg, { enabled: true, mode: 'album', preventClipping: true });
    assert.equal(multRes.isClipped, true);
    assert.ok(Math.abs(multRes.multiplier - 1.25) < 1e-6);

    // Case B: EBU R128 Q7.8 fixed-point tags in FLAC VORBIS_COMMENT (R128_TRACK_GAIN=-1920 -> -7.5 dB @ -23 LUFS -> -2.5 dB @ -18 LUFS)
    const vcBodyR128 = buildVorbisCommentBody('Lavf60.16.100', [
      'R128_TRACK_GAIN=-1920',
      'R128_ALBUM_GAIN=512',
      'REPLAYGAIN_TRACK_PEAK=0.500000'
    ]);
    const flacR128 = concatU8(flacMagic, streamInfo, buildFlacMetadataBlock(4, true, vcBodyR128));

    const resR128 = lib.extractBinaryReplayGainTags(flacR128);
    assert.equal(resR128.valid, true);
    assert.equal(resR128.hasReplayGain, true);
    assert.equal(resR128.hasR128, true);
    assert.equal(resR128.hasR128TrackGain, true);
    assert.equal(resR128.hasR128AlbumGain, true);
    assert.equal(resR128.r128ReferenceAdjusted, true);
    assert.equal(resR128.r128TrackGainQ78, -1920);
    assert.equal(resR128.r128TrackGainDb, -7.5);
    assert.equal(resR128.trackGain, -2.5); // -7.5 dB + 5.0 dB Opus/FLAC R128 -> ReplayGain 2.0 adjustment
    assert.equal(resR128.r128AlbumGainQ78, 512);
    assert.equal(resR128.r128AlbumGainDb, 2.0);
    assert.equal(resR128.albumGain, 7.0); // +2.0 dB + 5.0 dB = +7.0 dB (clamped by peak 0.5 -> 2.0 linear)
    assert.ok(Math.abs(resR128.albumLinearGain - 2.0) < 1e-9);

    // Raw -23 LUFS opt-out check
    const resR128Raw = lib.extractBinaryReplayGainTags(flacR128, { applyR128Plus5Db: false });
    assert.equal(resR128Raw.r128ReferenceAdjusted, false);
    assert.equal(resR128Raw.trackGain, -7.5);
    assert.equal(resR128Raw.albumGain, 2.0);
  });

  it('extracts ReplayGain & R128 TXXX frames (UTF-8, UTF-16LE BOM, UTF-16BE BOM, ISO-8859-1) from DSF trailing ID3v2.4 pointer', () => {
    const id3Tag = buildId3v24Tag([
      // UTF-8 (0x03)
      buildId3v24TxxxFrame('REPLAYGAIN_TRACK_GAIN', '-4.75 dB', 0x03),
      // UTF-16LE with BOM (0x01, FF FE) — note 'R' (0x52 0x00) tests aligned 2-byte null scanning!
      buildId3v24TxxxFrame('REPLAYGAIN_TRACK_PEAK', '0.912500', 0x01, { littleEndian: true }),
      // UTF-16BE with BOM (0x01, FE FF)
      buildId3v24TxxxFrame('REPLAYGAIN_ALBUM_GAIN', '-8.25 dB', 0x01, { littleEndian: false }),
      // ISO-8859-1 (0x00)
      buildId3v24TxxxFrame('REPLAYGAIN_ALBUM_PEAK', '0.965000', 0x00),
      // UTF-16BE without BOM (0x02) for R128 Q7.8
      buildId3v24TxxxFrame('R128_TRACK_GAIN', '-2496', 0x02)
    ]);

    const dsfFull = buildDsfWithTrailingId3(id3Tag, 128);
    const resDsf = lib.extractBinaryReplayGainTags(dsfFull);
    assert.equal(resDsf.valid, true);
    assert.equal(resDsf.format, 'DSF');
    assert.equal(resDsf.source, 'dsf_id3v2');
    assert.equal(resDsf.id3Version, '2.4.0');
    assert.equal(resDsf.id3Offset, 28 + 52 + 12 + 128);
    assert.equal(resDsf.needsTailId3Range, false);
    assert.equal(resDsf.truncated, false);
    assert.equal(resDsf.hasReplayGain, true);
    assert.equal(resDsf.trackGain, -4.75);
    assert.equal(resDsf.trackPeak, 0.9125);
    assert.equal(resDsf.albumGain, -8.25);
    assert.equal(resDsf.albumPeak, 0.965);
    assert.equal(resDsf.r128TrackGainQ78, -2496);
    assert.equal(resDsf.r128TrackGainDb, -9.75);

    // Head-only 64B slice of DSF where ID3 pointer is past slice end -> flags needsTailId3Range cleanly!
    const headOnlyDsf = dsfFull.subarray(0, 80);
    const resHead = lib.extractBinaryReplayGainTags(headOnlyDsf);
    assert.equal(resHead.valid, true);
    assert.equal(resHead.format, 'DSF');
    assert.equal(resHead.truncated, true);
    assert.equal(resHead.needsTailId3Range, true);
    assert.equal(resHead.id3Offset, 28 + 52 + 12 + 128);
    assert.equal(resHead.hasReplayGain, false);

    // Passing the fetched trailing ID3v2 slice directly also parses cleanly!
    const resTailId3 = lib.extractBinaryReplayGainTags(id3Tag);
    assert.equal(resTailId3.valid, true);
    assert.equal(resTailId3.format, 'ID3');
    assert.equal(resTailId3.source, 'id3v2');
    assert.equal(resTailId3.trackGain, -4.75);
    assert.equal(resTailId3.albumGain, -8.25);
  });

  it('survives truncated VORBIS_COMMENT / ID3v2 TXXX frames and adversarial 0xffffffff counts with 0 RangeErrors', () => {
    const flacMagic = new TextEncoder().encode('fLaC');
    const vcBody = buildVorbisCommentBody('test-vendor', [
      'REPLAYGAIN_TRACK_GAIN=-5.25 dB',
      'REPLAYGAIN_TRACK_PEAK=0.950000',
      'REPLAYGAIN_ALBUM_GAIN=-6.00 dB'
    ]);
    const fullFlac = concatU8(flacMagic, buildFlacMetadataBlock(4, true, vcBody));

    const fullDsf = buildDsfWithTrailingId3(
      buildId3v24Tag([
        buildId3v24TxxxFrame('REPLAYGAIN_TRACK_GAIN', '-3.50 dB', 0x01, { littleEndian: true }),
        buildId3v24TxxxFrame('REPLAYGAIN_ALBUM_GAIN', '-4.00 dB', 0x03)
      ]),
      32
    );

    // Byte-by-byte truncation fuzz on unaligned DataView for both FLAC and DSF -> 0 RangeError!
    for (const sample of [fullFlac, fullDsf]) {
      const backing = new Uint8Array(sample.byteLength + 9);
      backing.set(sample, 5);
      for (let cut = 0; cut <= sample.byteLength; cut++) {
        const view = new DataView(backing.buffer, 5, cut);
        assert.doesNotThrow(() => {
          const r = lib.extractBinaryReplayGainTags(view);
          assert.equal(typeof r.trackLinearGain, 'number');
          assert.ok(Number.isFinite(r.trackLinearGain));
        }, `Must never throw RangeError at cut=${cut}`);
      }
    }

    // Partial FLAC VORBIS_COMMENT truncated right inside the 3rd comment still preserves the 1st and 2nd comments!
    const partialFlac = fullFlac.subarray(0, fullFlac.byteLength - 6);
    const partialRes = lib.extractBinaryReplayGainTags(partialFlac);
    assert.equal(partialRes.valid, true);
    assert.equal(partialRes.truncated, true);
    assert.equal(partialRes.hasTrackGain, true);
    assert.equal(partialRes.trackGain, -5.25);
    assert.equal(partialRes.trackPeak, 0.95);

    // Adversarial Vorbis commentCount = 0xffffffff must terminate in < 15ms without CPU hang
    const advBody = new Uint8Array(12);
    const advDv = new DataView(advBody.buffer);
    advDv.setUint32(0, 0, true);          // vendorLen = 0
    advDv.setUint32(4, 0xffffffff, true); // adversarial 4 billion comments!
    const advFlac = concatU8(flacMagic, buildFlacMetadataBlock(4, true, advBody));
    const t0 = performance.now();
    const advRes = lib.extractBinaryReplayGainTags(advFlac);
    assert.ok(performance.now() - t0 < 20);
    assert.equal(advRes.truncated, true);
    assert.equal(advRes.hasReplayGain, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ATOMIC CYCLE 14 — OPT-05: Zero-Copy 64KB Head Slice Reader & Unified Source Fingerprinter
// ═════════════════════════════════════════════════════════════════════════════
describe('OPT-05 — Zero-Copy 64KB Head Slice Reader for FileSystemFileHandle & Cloud Range 206', () => {
  function makeDeterministic64kHead() {
    const head = new Uint8Array(65536);
    for (let i = 0; i < head.length; i++) {
      head[i] = ((i * 73) ^ (i >>> 5)) & 0xff;
    }
    return head;
  }

  it('exposes readHeadSlice64kZeroCopy & computeSourceFingerprint64kAsync on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.readHeadSlice64kZeroCopy, 'function');
    assert.equal(typeof lib.computeSourceFingerprint64kAsync, 'function');

    const sandbox = { library: { keepRefOpt05: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.readHeadSlice64kZeroCopy, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.computeSourceFingerprint64kAsync, 'function');
    assert.equal(typeof sandbox.library.readHeadSlice64kZeroCopy, 'function');
    assert.equal(typeof sandbox.library.computeSourceFingerprint64kAsync, 'function');
    assert.equal(sandbox.library.keepRefOpt05, true);
  });

  it('preserves strict zero-copy ArrayBuffer & byteOffset view identity on Uint8Array, ArrayBuffer, and DataView', async () => {
    const rawAb = new ArrayBuffer(262144 + 128);
    const fullView = new Uint8Array(rawAb, 128, 262144);
    fullView[0] = 0x66; // 'f'
    fullView[1] = 0x4c; // 'L'
    fullView[2] = 0x61; // 'a'
    fullView[3] = 0x43; // 'C'

    const u8Res = await lib.readHeadSlice64kZeroCopy(fullView);
    assert.equal(u8Res.zeroCopy, true);
    assert.equal(u8Res.sourceType, 'typedarray');
    assert.equal(u8Res.bytes.buffer, rawAb, 'Must share exact underlying ArrayBuffer without copying');
    assert.equal(u8Res.bytes.byteOffset, 128, 'Must preserve original subarray byteOffset');
    assert.equal(u8Res.bytes.byteLength, 65536);
    assert.equal(u8Res.fileSize, 262144);

    // Mutating underlying buffer mutates returned subarray view directly (proof of zero copy)
    fullView[17] = 0xa5;
    assert.equal(u8Res.bytes[17], 0xa5);

    const abRes = await lib.readHeadSlice64kZeroCopy(rawAb);
    assert.equal(abRes.bytes.buffer, rawAb);
    assert.equal(abRes.bytes.byteOffset, 0);
    assert.equal(abRes.bytes.byteLength, 65536);
    assert.equal(abRes.fileSize, 262144 + 128);

    const dvSource = new DataView(rawAb, 64, 131072);
    const dvRes = await lib.readHeadSlice64kZeroCopy(dvSource);
    assert.equal(dvRes.bytes.buffer, rawAb);
    assert.equal(dvRes.bytes.byteOffset, 64);
    assert.equal(dvRes.bytes.byteLength, 65536);
    assert.equal(dvRes.fileSize, 131072);
  });

  it('slices only [0, 65536) from FileSystemFileHandle without ever materializing full multi-hundred-MB file', async () => {
    const head64k = makeDeterministic64kHead();
    const simulated512MbSize = 536_870_912;
    let sliceCalls = [];
    let getFileCalls = 0;

    const mockFileHandle = {
      kind: 'file',
      name: 'Mahler-Symphony2-24-192.flac',
      async getFile() {
        getFileCalls++;
        return {
          name: 'Mahler-Symphony2-24-192.flac',
          size: simulated512MbSize,
          arrayBuffer() {
            throw new Error('FORBIDDEN: Full 512MB file.arrayBuffer() must NEVER be called!');
          },
          slice(start, end) {
            sliceCalls.push([start, end]);
            const slicedBuf = head64k.buffer.slice(start, Math.min(end, head64k.byteLength));
            return {
              size: slicedBuf.byteLength,
              async arrayBuffer() {
                return slicedBuf;
              }
            };
          }
        };
      }
    };

    const sliceRes = await lib.readHeadSlice64kZeroCopy(mockFileHandle);
    assert.equal(getFileCalls, 1);
    assert.deepEqual(sliceCalls, [[0, 65536]]);
    assert.equal(sliceRes.sourceType, 'file_handle');
    assert.equal(sliceRes.byteLength, 65536);
    assert.equal(sliceRes.fileSize, simulated512MbSize);

    const fpFromHandle = await lib.computeSourceFingerprint64kAsync(mockFileHandle);
    const expectedSync = lib.computeAudioFingerprint64k(head64k, simulated512MbSize);
    assert.equal(fpFromHandle.fingerprintKey, expectedSync.fingerprintKey);
    assert.equal(fpFromHandle.fileSize, simulated512MbSize);
    assert.equal(fpFromHandle.sampledBytes, 65536);
  });

  it('issues Range: bytes=0-65535 on Cloud URLs, extracts total fileSize from 206 Content-Range, and matches local handle fingerprint', async () => {
    const head64k = makeDeterministic64kHead();
    const totalCloudSize = 536_870_912;
    let capturedUrl = null;
    let capturedInit = null;

    const mockFetch206 = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 206,
        headers: new Map([
          ['Content-Range', `bytes 0-65535/${totalCloudSize}`],
          ['Content-Length', '65536']
        ]),
        body: {
          getReader() {
            let sent = false;
            return {
              async read() {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: head64k };
              },
              async cancel() {},
              releaseLock() {}
            };
          }
        }
      };
    };

    const cloudFp = await lib.computeSourceFingerprint64kAsync({
      url: 'https://www.googleapis.com/drive/v3/files/abc123?alt=media',
      headers: { Authorization: 'Bearer ya29.test-token' },
      fetchFn: mockFetch206
    });

    assert.equal(capturedUrl, 'https://www.googleapis.com/drive/v3/files/abc123?alt=media');
    assert.equal(capturedInit.headers.Range, 'bytes=0-65535');
    assert.equal(capturedInit.headers.Authorization, 'Bearer ya29.test-token');
    assert.ok(capturedInit.signal, 'Must attach AbortSignal to Cloud Range fetch');

    const expectedSync = lib.computeAudioFingerprint64k(head64k, totalCloudSize);
    assert.equal(cloudFp.status, 206);
    assert.equal(cloudFp.rangeHonored, true);
    assert.equal(cloudFp.fileSize, totalCloudSize, 'Must extract exact total size from Content-Range even without knownSize');
    assert.equal(cloudFp.fingerprintKey, expectedSync.fingerprintKey);
  });

  it('cancels response stream reader immediately after 64KB when a rogue server returns 200 OK instead of 206 Partial Content', async () => {
    const head64k = makeDeterministic64kHead();
    const totalRogueSize = 314_572_800;
    let chunksPulled = 0;
    let cancelCalled = false;
    let signalAbortedAfter64k = false;

    const mockRogueFetch200 = async (_url, init) => {
      if (init && init.signal) {
        init.signal.addEventListener('abort', () => {
          signalAbortedAfter64k = true;
        });
      }
      return {
        ok: true,
        status: 200, // Rogue server ignored Range header and started streaming all 300MB!
        headers: {
          'content-length': String(totalRogueSize)
        },
        body: {
          getReader() {
            return {
              async read() {
                chunksPulled++;
                if (chunksPulled <= 4) {
                  const start = (chunksPulled - 1) * 16384;
                  return { done: false, value: head64k.subarray(start, start + 16384) };
                }
                throw new Error('FORBIDDEN: Stream reader must cancel after 64KB (4x16KB chunks) without pulling chunk #5!');
              },
              async cancel() {
                cancelCalled = true;
              },
              releaseLock() {}
            };
          }
        }
      };
    };

    const rogueFp = await lib.computeSourceFingerprint64kAsync(
      'https://cdn.example.org/lossless/dsd128-master.dsf',
      { fetchFn: mockRogueFetch200 }
    );

    assert.equal(chunksPulled, 4, 'Must stop reading immediately at 65,536 bytes (4 x 16KB chunks)');
    assert.equal(cancelCalled, true, 'Must call reader.cancel() immediately on rogue 200 OK stream');
    assert.equal(signalAbortedAfter64k, true, 'Must abort underlying fetch signal on rogue 200 OK stream');
    assert.equal(rogueFp.status, 200);
    assert.equal(rogueFp.rangeHonored, false);
    assert.equal(rogueFp.streamCancelled, true);
    assert.equal(rogueFp.sampledBytes, 65536);
    assert.equal(rogueFp.fileSize, totalRogueSize);
    assert.equal(rogueFp.fingerprintKey, lib.computeAudioFingerprint64k(head64k, totalRogueSize).fingerprintKey);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ATOMIC CYCLE 15 — BUG-06: Multi-Tab IndexedDB versionchange Auto-Close & Transparent Reconnect
// ═════════════════════════════════════════════════════════════════════════════
describe('BUG-06 — Multi-Tab IndexedDB versionchange Auto-Close & Transparent Reconnect', () => {
  function createMultiTabIndexedDBSimulator() {
    const databases = new Map();

    function ensureDbState(name) {
      if (!databases.has(name)) {
        databases.set(name, {
          version: 0,
          stores: new Map(),
          openConnections: new Set(),
          pendingUpgrades: []
        });
      }
      return databases.get(name);
    }

    function makeConnection(dbState, name, connVersion) {
      let closed = false;
      let forceClosingError = false;

      const conn = {
        name,
        version: connVersion,
        onversionchange: null,
        onclose: null,
        objectStoreNames: {
          contains: s => dbState.stores.has(s)
        },
        createObjectStore(storeName, opts = {}) {
          if (!dbState.stores.has(storeName)) {
            dbState.stores.set(storeName, { keyPath: opts.keyPath || 'id', map: new Map() });
          }
          return {};
        },
        _forceSilentClosingState() {
          // Simulates browser marking connection as closing right before transaction() without firing onclose yet
          forceClosingError = true;
        },
        close() {
          if (closed) return;
          closed = true;
          dbState.openConnections.delete(conn);
          flushPendingUpgrades(dbState, name);
        },
        get _isClosed() {
          return closed;
        },
        transaction(storeName) {
          if (closed || forceClosingError) {
            const err = new Error("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.");
            err.name = 'InvalidStateError';
            throw err;
          }
          const storeRec = dbState.stores.get(storeName);
          if (!storeRec) {
            const nf = new Error(`Store ${storeName} not found`);
            nf.name = 'NotFoundError';
            throw nf;
          }
          const tx = { oncomplete: null, onerror: null, onabort: null };
          const objStore = {
            get(key) {
              const r = { result: undefined, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                r.result = storeRec.map.has(key) ? structuredClone(storeRec.map.get(key)) : undefined;
                if (r.onsuccess) r.onsuccess();
                if (tx.oncomplete) tx.oncomplete();
              });
              return r;
            },
            put(val) {
              const k = val[storeRec.keyPath];
              storeRec.map.set(k, structuredClone(val));
              queueMicrotask(() => {
                if (tx.oncomplete) tx.oncomplete();
              });
              return {};
            },
            delete(key) {
              storeRec.map.delete(key);
              queueMicrotask(() => {
                if (tx.oncomplete) tx.oncomplete();
              });
              return {};
            },
            clear() {
              storeRec.map.clear();
              queueMicrotask(() => {
                if (tx.oncomplete) tx.oncomplete();
              });
              return {};
            }
          };
          return Object.assign(tx, { objectStore: () => objStore });
        }
      };

      dbState.openConnections.add(conn);
      return conn;
    }

    function flushPendingUpgrades(dbState, name) {
      if (dbState.openConnections.size > 0 || dbState.pendingUpgrades.length === 0) return;
      const next = dbState.pendingUpgrades.shift();
      queueMicrotask(() => {
        const oldVersion = dbState.version;
        dbState.version = next.requestedVersion;
        const conn = makeConnection(dbState, name, dbState.version);
        next.req.result = conn;
        if (next.req.onupgradeneeded) {
          next.req.onupgradeneeded({ oldVersion, newVersion: dbState.version, target: next.req });
        }
        if (next.req.onsuccess) {
          next.req.onsuccess({ target: next.req });
        }
      });
    }

    return {
      open(name, requestedVersion) {
        const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
        const dbState = ensureDbState(name);

        queueMicrotask(() => {
          const targetVer = requestedVersion === undefined
            ? Math.max(1, dbState.version || 1)
            : requestedVersion;

          if (dbState.version > 0 && requestedVersion !== undefined && requestedVersion < dbState.version) {
            const verErr = new Error(`The requested version (${requestedVersion}) is less than the existing version (${dbState.version}).`);
            verErr.name = 'VersionError';
            req.error = verErr;
            if (req.onerror) req.onerror({ target: req });
            return;
          }

          if (targetVer > dbState.version) {
            // Notify all currently open connections via versionchange!
            const existingConns = Array.from(dbState.openConnections);
            for (const c of existingConns) {
              if (typeof c.onversionchange === 'function') {
                c.onversionchange({ oldVersion: dbState.version, newVersion: targetVer });
              }
            }

            if (dbState.openConnections.size > 0) {
              // At least one sibling tab failed to close synchronously -> fire onblocked and park upgrade!
              dbState.pendingUpgrades.push({ req, requestedVersion: targetVer });
              if (req.onblocked) {
                req.onblocked({ oldVersion: dbState.version, newVersion: targetVer });
              }
              return;
            }

            const oldVersion = dbState.version;
            dbState.version = targetVer;
            const conn = makeConnection(dbState, name, targetVer);
            req.result = conn;
            if (req.onupgradeneeded) {
              req.onupgradeneeded({ oldVersion, newVersion: targetVer, target: req });
            }
            if (req.onsuccess) {
              req.onsuccess({ target: req });
            }
            return;
          }

          const conn = makeConnection(dbState, name, dbState.version);
          req.result = conn;
          if (req.onsuccess) req.onsuccess({ target: req });
        });

        return req;
      },
      _ensureDbState: ensureDbState,
      _makeRawUnmonitoredConnection(name, ver) {
        const st = ensureDbState(name);
        if (st.version < ver) st.version = ver;
        return makeConnection(st, name, st.version);
      }
    };
  }

  it('exposes createResilientIndexedDbManager on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createResilientIndexedDbManager, 'function');

    const sandbox = { library: { keepRefBug06: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createResilientIndexedDbManager, 'function');
    assert.equal(typeof sandbox.library.createResilientIndexedDbManager, 'function');
    assert.equal(sandbox.library.keepRefBug06, true);
  });

  it('auto-closes Tab 1 on multi-tab versionchange without blocking Tab 2 schema upgrade, and transparently reconnects Tab 1 to v2', async () => {
    const sharedIdb = createMultiTabIndexedDBSimulator();
    const versionChangeEvents = [];

    // Tab 1 opens v1 and writes initial record
    const tab1 = lib.createResilientIndexedDbManager({
      dbName: 'nocturne-player',
      version: 1,
      indexedDB: sharedIdb,
      onUpgradeNeeded(db) {
        db.createObjectStore('catalog', { keyPath: 'id' });
      },
      onVersionChange(ev) {
        versionChangeEvents.push({ oldVersion: ev.oldVersion, newVersion: ev.newVersion });
      }
    });

    await tab1.runTransaction('catalog', 'readwrite', tx => new Promise(resolve => {
      tx.objectStore('catalog').put({ id: 't1', title: 'Track From Tab 1' });
      tx.oncomplete = () => resolve(true);
    }));
    assert.equal(tab1.isOpen(), true);

    // Tab 2 opens v2 (schema upgrade!) while Tab 1 is still open!
    let tab2Blocked = false;
    const tab2 = lib.createResilientIndexedDbManager({
      dbName: 'nocturne-player',
      version: 2,
      indexedDB: sharedIdb,
      onBlocked() {
        tab2Blocked = true;
      },
      onUpgradeNeeded(db) {
        db.createObjectStore('catalog', { keyPath: 'id' });
        db.createObjectStore('sliceCache', { keyPath: 'key' });
      }
    });

    const db2 = await tab2.open();
    assert.equal(tab2Blocked, false, 'Tab 1 auto-close on versionchange must prevent Tab 2 from blocking');
    assert.equal(db2.version, 2);
    assert.equal(versionChangeEvents.length, 1);
    assert.deepEqual(versionChangeEvents[0], { oldVersion: 1, newVersion: 2 });
    assert.equal(tab1.isOpen(), false, 'Tab 1 must have closed its old connection and cleared cached promise');

    await tab2.runTransaction('catalog', 'readwrite', tx => new Promise(resolve => {
      tx.objectStore('catalog').put({ id: 't2', title: 'Upgraded Track From Tab 2' });
      tx.oncomplete = () => resolve(true);
    }));

    // Now Tab 1 (originally configured at version: 1!) performs a new transaction -> must transparently reconnect at v2 without VersionError!
    const readFromTab1AfterUpgrade = await tab1.runTransaction('catalog', 'readonly', tx => new Promise(resolve => {
      const req = tx.objectStore('catalog').get('t2');
      req.onsuccess = () => resolve(req.result);
    }));

    assert.ok(readFromTab1AfterUpgrade);
    assert.equal(readFromTab1AfterUpgrade.title, 'Upgraded Track From Tab 2');
    assert.equal(tab1.isOpen(), true);
    assert.equal(tab1.getStats().effectiveVersion, 2);
    assert.equal(tab1.getStats().versionChangeCount, 1);
  });

  it('handles delayed blocked upgrades, blockedTimeoutMs protection, and InvalidStateError auto-reopen recovery', async () => {
    const sharedIdb = createMultiTabIndexedDBSimulator();

    // 1. Legacy uncooperative connection delays closing by 15ms -> triggers onBlocked, then completes cleanly once closed!
    const legacyConn = sharedIdb._makeRawUnmonitoredConnection('nocturne-blocked-test', 1);
    legacyConn.createObjectStore('items', { keyPath: 'id' });
    legacyConn.onversionchange = () => {
      setTimeout(() => legacyConn.close(), 15);
    };

    let blockedEvents = 0;
    const upgrader = lib.createResilientIndexedDbManager({
      dbName: 'nocturne-blocked-test',
      version: 2,
      indexedDB: sharedIdb,
      onBlocked() {
        blockedEvents++;
      },
      onUpgradeNeeded(db) {
        db.createObjectStore('items', { keyPath: 'id' });
      }
    });

    const upgradedDb = await upgrader.open();
    assert.equal(blockedEvents, 1);
    assert.equal(upgradedDb.version, 2);
    assert.equal(upgrader.getStats().blockedCount, 1);

    // 2. Permanently frozen external tab with blockedTimeoutMs: 20 -> rejects cleanly with BlockedError instead of hanging forever
    const frozenConn = sharedIdb._makeRawUnmonitoredConnection('nocturne-frozen-test', 1);
    frozenConn.onversionchange = null; // Never closes!
    const guardedUpgrader = lib.createResilientIndexedDbManager({
      dbName: 'nocturne-frozen-test',
      version: 2,
      indexedDB: sharedIdb,
      blockedTimeoutMs: 20
    });
    await assert.rejects(() => guardedUpgrader.open(), err => err && err.name === 'BlockedError');
    frozenConn.close();

    // 3. InvalidStateError ("The database connection is closing") mid-flight auto-reopen recovery
    // Force upgradedDb into silent closing state without firing onclose first
    upgradedDb._forceSilentClosingState();

    await upgrader.runTransaction('items', 'readwrite', tx => new Promise(resolve => {
      tx.objectStore('items').put({ id: 'recovered-1', ok: true });
      tx.oncomplete = () => resolve(true);
    }));

    const verified = await upgrader.runTransaction('items', 'readonly', tx => new Promise(resolve => {
      const r = tx.objectStore('items').get('recovered-1');
      r.onsuccess = () => resolve(r.result);
    }));
    assert.deepEqual(verified, { id: 'recovered-1', ok: true });
    assert.equal(upgrader.getStats().reopenCount, 1);

    // 4. Verify createFingerprintLyricsCacheStore also survives multi-tab versionchange & InvalidStateError
    const storeTab1 = lib.createFingerprintLyricsCacheStore({
      dbName: 'nocturne-lyrics-multitab',
      dbVersion: 1,
      maxEntries: 1,
      indexedDB: sharedIdb
    });
    await storeTab1.set('sha256-64k:0011223344556677:1024', { syncedLyrics: '[00:01.00] Tab 1' });
    await storeTab1.set('sha256-64k:8899aabbccddeeff:2048', { syncedLyrics: '[00:02.00] Evicts first from RAM' });

    // Tab 2 upgrades nocturne-lyrics-multitab to v2
    const storeTab2 = lib.createFingerprintLyricsCacheStore({
      dbName: 'nocturne-lyrics-multitab',
      dbVersion: 2,
      maxEntries: 2,
      indexedDB: sharedIdb
    });
    await storeTab2.set('sha256-64k:fedcba9876543210:4096', { syncedLyrics: '[00:03.00] Written by Tab 2 v2' });

    assert.equal(storeTab1.getStats().idbVersionChanges, 1);
    const fromTab1Disk = await storeTab1.get('sha256-64k:fedcba9876543210:4096');
    assert.ok(fromTab1Disk);
    assert.equal(fromTab1Disk.syncedLyrics, '[00:03.00] Written by Tab 2 v2');
  });

  it('wires multi-tab versionchange & InvalidStateError guards in index.html, library-tools.js, and lrclib-client.js while preserving audio invariants', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const libTools = fs.readFileSync(path.join(ROOT, 'library-tools.js'), 'utf8');
    const lrclibClient = fs.readFileSync(path.join(ROOT, 'lrclib-client.js'), 'utf8');

    assert.ok(html.includes('db.onversionchange'), 'index.html openDatabase() must attach db.onversionchange');
    assert.ok(html.includes('db.onclose'), 'index.html openDatabase() must attach db.onclose');
    assert.ok(html.includes('request.onblocked'), 'index.html openDatabase() must attach request.onblocked');
    assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Critical Web Audio graph invariant must remain intact');

    assert.ok(libTools.includes('db.onversionchange'), 'library-tools.js openCoverArtCache() must attach db.onversionchange');
    assert.ok(lrclibClient.includes('db.onversionchange'), 'lrclib-client.js openLyricsVault() must attach db.onversionchange');
  });
});
