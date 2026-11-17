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
