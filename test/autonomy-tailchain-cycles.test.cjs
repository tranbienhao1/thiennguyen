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

describe('Autonomy Tail-Chaining Cycle 16 — UPG-06 (Custom Keymap Export/Import & MediaSession Seek Step Sync)', () => {
  it('exposes UPG-06 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.normalizeCustomKeymapConfig, 'function');
    assert.equal(typeof lib.exportCustomKeymapBundle, 'function');
    assert.equal(typeof lib.importCustomKeymapBundle, 'function');
    assert.equal(typeof lib.computeMediaSessionSeekOffset, 'function');

    const sandbox = { library: { keepRefUpg06: 'ok' } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    for (const fnName of [
      'normalizeCustomKeymapConfig',
      'exportCustomKeymapBundle',
      'importCustomKeymapBundle',
      'computeMediaSessionSeekOffset'
    ]) {
      assert.equal(typeof sandbox.NocturneLibrary[fnName], 'function');
      assert.equal(typeof sandbox.library[fnName], 'function');
    }
    assert.equal(sandbox.library.keepRefUpg06, 'ok');
  });

  it('exports & imports signed custom keymap bundles, clamps seekStepFineSec (1..30) & seekStepCoarseSec (5..120), and rejects reserved/conflicting keys', () => {
    // 1. Default & boundary clamping for seekStepFineSec (1..30, default 5) and seekStepCoarseSec (5..120, default 10)
    const defaults = lib.normalizeCustomKeymapConfig(null);
    assert.equal(defaults.valid, true);
    assert.equal(defaults.isDefault, true);
    assert.equal(defaults.seekStepFineSec, 5);
    assert.equal(defaults.seekStepCoarseSec, 10);

    const clampedLow = lib.normalizeCustomKeymapConfig({
      seekSteps: { seekStepFineSec: -5, seekStepCoarseSec: 1 }
    });
    assert.equal(clampedLow.valid, true);
    assert.equal(clampedLow.seekStepFineSec, 1);
    assert.equal(clampedLow.seekStepCoarseSec, 5);

    const clampedHigh = lib.normalizeCustomKeymapConfig({
      seekSteps: { seekStepFineSec: 999, seekStepCoarseSec: 500 }
    });
    assert.equal(clampedHigh.valid, true);
    assert.equal(clampedHigh.seekStepFineSec, 30);
    assert.equal(clampedHigh.seekStepCoarseSec, 120);

    const clampedNaN = lib.normalizeCustomKeymapConfig({
      seekSteps: { seekStepFineSec: NaN, seekStepCoarseSec: true }
    });
    assert.equal(clampedNaN.seekStepFineSec, 5);
    assert.equal(clampedNaN.seekStepCoarseSec, 10);

    // 2. Clean export -> JSON round-trip import with CRC32+SHA-256 signature
    const bundle = lib.exportCustomKeymapBundle(
      {
        togglePlayPause: 'p',
        seekBackwardFine: '[',
        seekForwardFine: ']',
        seekBackwardCoarse: 'a',
        seekForwardCoarse: 'd',
        toggleMute: 'u',
        toggleLyrics: 'y',
        focusSearch: 's',
        nextTrack: 'n'
      },
      { seekStepFineSec: 3, seekStepCoarseSec: 15, exportedAt: '2026-11-18T00:50:00.000Z' }
    );

    assert.equal(bundle.schema, 'nocturne.custom-keymap.v1');
    assert.equal(bundle.integrity.algorithm, 'crc32+sha256');
    assert.deepEqual(bundle.seekSteps, { seekStepFineSec: 3, seekStepCoarseSec: 15 });

    const importedJson = lib.importCustomKeymapBundle(JSON.stringify(bundle, null, 2));
    assert.equal(importedJson.valid, true);
    assert.equal(importedJson.signed, true);
    assert.equal(importedJson.reason, null);
    assert.equal(importedJson.seekStepFineSec, 3);
    assert.equal(importedJson.seekStepCoarseSec, 15);
    assert.equal(importedJson.bindings.togglePlayPause, 'p');
    assert.equal(importedJson.bindings.seekBackwardFine, '[');
    assert.equal(importedJson.bindings.nextTrack, 'n');

    const importedBytes = lib.importCustomKeymapBundle(Buffer.from(JSON.stringify(bundle), 'utf8'));
    assert.equal(importedBytes.valid, true);
    assert.deepEqual(importedBytes.bindings, importedJson.bindings);

    // Tampered signed bundle -> checksum_mismatch
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.bindings.toggleMute = 'z';
    const tamperedRes = lib.importCustomKeymapBundle(JSON.stringify(tampered));
    assert.equal(tamperedRes.valid, false);
    assert.equal(tamperedRes.reason, 'checksum_mismatch');

    // Corrupted JSON -> corrupted_json
    assert.equal(lib.importCustomKeymapBundle('{broken json').reason, 'corrupted_json');
    assert.equal(lib.importCustomKeymapBundle('').reason, 'corrupted_json');

    // 3. Reject dangerous browser/OS reserved keys (Tab, Escape, F5, F12, Enter, Backspace, Meta, Ctrl+W, Alt+F4)
    for (const reserved of ['Tab', 'Escape', 'F5', 'F12', 'f1', 'Enter', 'Backspace', 'Delete', 'Meta', 'Ctrl+W', 'Alt+F4', '\t', '\x1b']) {
      const normRes = lib.normalizeCustomKeymapConfig({ toggleMute: reserved });
      assert.equal(normRes.valid, false, `Reserved key ${JSON.stringify(reserved)} must be rejected`);
      assert.equal(normRes.rejectedReservedKeys.length, 1);

      assert.throws(
        () => lib.exportCustomKeymapBundle({ toggleMute: reserved }),
        err => err && err.code === 'RESERVED_KEY_REJECTED'
      );

      const impRes = lib.importCustomKeymapBundle({ bindings: { toggleMute: reserved } });
      assert.equal(impRes.valid, false);
      assert.equal(impRes.reason, 'reserved_key');
    }

    // 4. Reject duplicate / conflicting key assignments (including case-insensitive 'X' vs 'x' and ' ' vs 'Space')
    const dupLetter = lib.normalizeCustomKeymapConfig({ toggleMute: 'x', toggleLyrics: 'X' });
    assert.equal(dupLetter.valid, false);
    assert.equal(dupLetter.conflicts.length, 1);
    assert.equal(dupLetter.conflicts[0].key, 'x');

    assert.throws(
      () => lib.exportCustomKeymapBundle({ togglePlayPause: 'Space', toggleMute: ' ' }),
      err => err && err.code === 'KEYMAP_CONFLICT'
    );

    const dupImport = lib.importCustomKeymapBundle(
      JSON.stringify({
        bindings: {
          togglePlayPause: 'Space',
          seekBackwardFine: 'ArrowLeft',
          seekForwardFine: 'ArrowLeft'
        }
      })
    );
    assert.equal(dupImport.valid, false);
    assert.equal(dupImport.reason, 'duplicate_key');
    assert.equal(dupImport.conflicts.length, 1);
  });

  it('extends resolvePlayerKeyboardShortcut with customKeymap & seekSteps while preserving zero-allocation singletons on default keymaps', () => {
    const bodyTarget = { tagName: 'BODY' };

    // 1. Default keymap returns exact frozen singleton references (zero allocation)
    const defSpaceA = lib.resolvePlayerKeyboardShortcut({ key: ' ', code: 'Space', target: bodyTarget });
    const defSpaceB = lib.resolvePlayerKeyboardShortcut({ key: ' ', code: 'Space', target: bodyTarget });
    assert.strictEqual(defSpaceA, defSpaceB);
    assert.equal(Object.isFrozen(defSpaceA), true);

    const defLeftA = lib.resolvePlayerKeyboardShortcut({ key: 'ArrowLeft', target: bodyTarget });
    const defLeftB = lib.resolvePlayerKeyboardShortcut({ key: 'ArrowLeft', target: bodyTarget });
    assert.strictEqual(defLeftA, defLeftB);
    assert.equal(defLeftA.deltaSeconds, -5);

    // 2. Custom keymap + custom seekSteps (clamped & Shift-promoted) + WeakMap cached frozen descriptors
    const customConfig = {
      bindings: {
        togglePlayPause: 'p',
        seekBackwardFine: 'a',
        seekForwardFine: 'd',
        seekBackwardCoarse: '[',
        seekForwardCoarse: ']',
        toggleMute: 'u',
        nextTrack: 'n'
      },
      seekSteps: {
        seekStepFineSec: 3,
        seekStepCoarseSec: 20
      }
    };

    const p1 = lib.resolvePlayerKeyboardShortcut({ key: 'P', target: bodyTarget }, { customKeymap: customConfig });
    const p2 = lib.resolvePlayerKeyboardShortcut({ key: 'p', target: bodyTarget }, { customKeymap: customConfig });
    assert.deepEqual(p1, { action: 'togglePlayPause', key: 'p', deltaSeconds: 0, preventDefault: true });
    assert.strictEqual(p1, p2, 'Repeated custom keymap lookups must reuse WeakMap-cached frozen descriptor');

    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'a', target: bodyTarget }, { customKeymap: customConfig }),
      { action: 'seek', key: 'a', deltaSeconds: -3, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'd', shiftKey: true, target: bodyTarget }, { customKeymap: customConfig }),
      { action: 'seek', key: 'd', deltaSeconds: 20, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: '[', target: bodyTarget }, { customKeymap: customConfig }),
      { action: 'seek', key: '[', deltaSeconds: -20, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut({ key: 'n', target: bodyTarget }, { customKeymap: customConfig }),
      { action: 'nextTrack', key: 'n', deltaSeconds: 0, preventDefault: true }
    );

    // Context-level seekSteps override with clamping (0.2 -> 1s fine, 999 -> 120s coarse)
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut(
        { key: 'ArrowLeft', target: bodyTarget },
        { seekSteps: { seekStepFineSec: 0.2, seekStepCoarseSec: 999 } }
      ),
      { action: 'seek', key: 'ArrowLeft', deltaSeconds: -1, preventDefault: true }
    );
    assert.deepEqual(
      lib.resolvePlayerKeyboardShortcut(
        { key: 'j', target: bodyTarget },
        { seekSteps: { seekStepFineSec: 0.2, seekStepCoarseSec: 999 } }
      ),
      { action: 'seek', key: 'j', deltaSeconds: -120, preventDefault: true }
    );

    // Editable input & interactive button guards still apply strictly
    assert.equal(
      lib.resolvePlayerKeyboardShortcut({ key: 'p', target: { tagName: 'INPUT' } }, { customKeymap: customConfig }),
      null
    );
  });

  it('computeMediaSessionSeekOffset prefers explicit OS seekOffset, falls back to configured seekStepSec, and clamps strictly within [0, duration]', () => {
    // 1. OS explicitly supplies details.seekOffset -> overrides user configured step
    const osForward = lib.computeMediaSessionSeekOffset(
      { action: 'seekforward', seekOffset: 30 },
      10,
      45,
      240
    );
    assert.equal(osForward.usedOsSeekOffset, true);
    assert.equal(osForward.source, 'os_seek_offset');
    assert.equal(osForward.stepSec, 30);
    assert.equal(osForward.targetTime, 75);
    assert.equal(osForward.appliedDeltaSec, 30);
    assert.equal(osForward.clamped, false);

    // 2. OS omits seekOffset -> falls back to user configured seekStepSec (or seekSteps object)
    const cfgBack = lib.computeMediaSessionSeekOffset(
      { action: 'seekbackward' },
      15,
      45,
      240
    );
    assert.equal(cfgBack.usedOsSeekOffset, false);
    assert.equal(cfgBack.source, 'configured_seek_step');
    assert.equal(cfgBack.stepSec, 15);
    assert.equal(cfgBack.signedOffsetSec, -15);
    assert.equal(cfgBack.targetTime, 30);
    assert.equal(cfgBack.clamped, false);

    const cfgObjForward = lib.computeMediaSessionSeekOffset(
      { action: 'seekforward', seekOffset: 0 },
      { seekStepCoarseSec: 25, seekStepFineSec: 5 },
      100,
      240
    );
    assert.equal(cfgObjForward.usedOsSeekOffset, false);
    assert.equal(cfgObjForward.stepSec, 25);
    assert.equal(cfgObjForward.targetTime, 125);

    // 3. Clamping at 0s boundary
    const clampZero = lib.computeMediaSessionSeekOffset(
      { action: 'seekbackward' },
      15,
      4.2,
      180
    );
    assert.equal(clampZero.targetTime, 0);
    assert.ok(Math.abs(clampZero.appliedDeltaSec - (-4.2)) < 1e-9);
    assert.equal(clampZero.clamped, true);
    assert.equal(clampZero.clampedAtZero, true);
    assert.equal(clampZero.clampedAtDuration, false);

    // 4. Clamping at duration boundary
    const clampEnd = lib.computeMediaSessionSeekOffset(
      { action: 'seekforward', seekOffset: 20 },
      10,
      172.5,
      180
    );
    assert.equal(clampEnd.targetTime, 180);
    assert.ok(Math.abs(clampEnd.appliedDeltaSec - 7.5) < 1e-9);
    assert.equal(clampEnd.clamped, true);
    assert.equal(clampEnd.clampedAtZero, false);
    assert.equal(clampEnd.clampedAtDuration, true);

    // 5. Edge cases: duration = 0, currentTime > duration, and live stream Infinity duration
    const zeroDur = lib.computeMediaSessionSeekOffset({ action: 'seekforward' }, 10, 0, 0);
    assert.equal(zeroDur.targetTime, 0);
    assert.equal(zeroDur.clampedAtDuration, true);

    const liveStream = lib.computeMediaSessionSeekOffset({ action: 'seekforward' }, 12, 50, Infinity);
    assert.equal(liveStream.targetTime, 62);
    assert.equal(liveStream.duration, null);
  });
});

describe('Autonomy Tail-Chaining Cycle 17 — OPT-06 (Multi-Provider Cold-Start Session Expiry Vault & Zero-Waste Wakeup)', () => {
  function createMockLocalStorage(initialEntries = {}) {
    const map = new Map(Object.entries(initialEntries));
    let getCount = 0;
    let setCount = 0;
    let removeCount = 0;
    return {
      getItem(k) {
        getCount++;
        return map.has(k) ? map.get(k) : null;
      },
      setItem(k, v) {
        setCount++;
        map.set(k, String(v));
      },
      removeItem(k) {
        removeCount++;
        map.delete(k);
      },
      rawMap: map,
      counts() {
        return { getCount, setCount, removeCount };
      }
    };
  }

  it('exposes OPT-06 createMultiProviderSessionVault on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createMultiProviderSessionVault, 'function');

    const sandbox = { library: { keepRefOpt06: 42 } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createMultiProviderSessionVault, 'function');
    assert.equal(typeof sandbox.library.createMultiProviderSessionVault, 'function');
    assert.equal(sandbox.library.keepRefOpt06, 42);
  });

  it('persists all 5 providers in 1 compact JSON entry and evaluates cold-start matrix in 1 storage read & 1 parse', () => {
    const t0 = 1_763_424_000_000;
    const storage = createMockLocalStorage();

    // Populate session ledger prior to simulated cold restart
    const writer = lib.createMultiProviderSessionVault(storage, { nowFn: () => t0 });
    writer.recordSession('google', {
      accessTokenPresent: true,
      expiresAt: t0 + 45 * 60_000, // 45 min remaining (> 5m margin)
      verifiedAt: t0,
      accountHint: 'audiophile@gmail.com',
      lastStatus: 'connected'
    });
    writer.recordSession('microsoft', {
      accessTokenPresent: true,
      expiresAt: t0 + 4 * 60_000, // 4 min remaining (<= 5m lead window)
      verifiedAt: t0,
      accountHint: 'hi-res@outlook.com',
      lastStatus: 'connected'
    });
    writer.recordSession('subsonic', {
      accessTokenPresent: true,
      verifiedAt: t0,
      accountHint: 'navidrome.local',
      lastStatus: 'connected'
    });
    writer.recordSession('jellyfin', {
      accessTokenPresent: true,
      verifiedAt: t0,
      accountHint: 'jellyfin.lan',
      lastStatus: 'connected'
    });
    // blackcandy intentionally left never connected!

    // Verify single compact JSON entry with exact persisted fields
    assert.equal(storage.rawMap.size, 1);
    const rawJson = storage.rawMap.get(writer.storageKey);
    const rawParsed = JSON.parse(rawJson);
    assert.deepEqual(Object.keys(rawParsed.providers).sort(), ['google', 'jellyfin', 'microsoft', 'subsonic']);
    for (const field of ['accessTokenPresent', 'expiresAt', 'verifiedAt', 'accountHint', 'lastStatus']) {
      assert.equal(Object.prototype.hasOwnProperty.call(rawParsed.providers.google, field), true);
    }

    // Simulate cold launch with a fresh vault instance over persisted storage
    const beforeColdCounts = storage.counts();
    const coldVault = lib.createMultiProviderSessionVault(storage, { nowFn: () => t0 });

    assert.equal(coldVault.evaluateColdStartAction('google', t0), 'reuse_cached_token');
    assert.equal(coldVault.evaluateColdStartAction('microsoft', t0), 'silent_refresh');
    assert.equal(coldVault.evaluateColdStartAction('subsonic', t0), 'static_credentials_ready');
    assert.equal(coldVault.evaluateColdStartAction('jellyfin', t0), 'static_credentials_ready');
    assert.equal(coldVault.evaluateColdStartAction('blackcandy', t0), 'skip_unconfigured');

    // BlackCandy connected later -> static_credentials_ready; expired Microsoft -> silent_refresh
    const allAtExpiredMs = coldVault.evaluateAllColdStartActions(t0 + 20 * 60_000);
    assert.deepEqual(allAtExpiredMs, {
      google: 'reuse_cached_token',
      microsoft: 'silent_refresh',
      subsonic: 'static_credentials_ready',
      jellyfin: 'static_credentials_ready',
      blackcandy: 'skip_unconfigured'
    });

    const afterColdCounts = storage.counts();
    assert.equal(afterColdCounts.getCount - beforeColdCounts.getCount, 1, 'Cold launch across all 5 providers must perform exactly 1 storage getItem');
    assert.equal(coldVault.getStats().storageReads, 1);
    assert.equal(coldVault.getStats().storageParses, 1);

    // Connect BlackCandy, then disconnect Subsonic, and test expired non-refreshable OAuth token
    coldVault.recordSession('blackcandy', {
      accessTokenPresent: true,
      accountHint: 'blackcandy.home',
      lastStatus: 'connected'
    }, t0);
    assert.equal(coldVault.evaluateColdStartAction('blackcandy', t0), 'static_credentials_ready');

    coldVault.clearProvider('subsonic', t0);
    assert.equal(coldVault.evaluateColdStartAction('subsonic', t0), 'skip_unconfigured');

    coldVault.recordSession('google', {
      accessTokenPresent: true,
      expiresAt: t0 - 1000,
      verifiedAt: t0 - 3600_000,
      refreshCapable: false,
      lastStatus: 'expired'
    }, t0);
    assert.equal(coldVault.evaluateColdStartAction('google', t0), 'skip_unconfigured');
  });

  it('recovers cleanly from corrupted JSON entries and enforces clock-skew safety on rewound or runaway system clocks', () => {
    const key = 'nocturne-multi-provider-session-vault-v1';

    // 1. Corrupted JSON payloads never crash cold start and self-heal to skip_unconfigured
    for (const badPayload of ['{"v":1,"providers":{broken', 'null', '[]', '42', '{"v":1,"providers":[]}', 12345]) {
      const corruptStorage = createMockLocalStorage({ [key]: badPayload });
      const vault = lib.createMultiProviderSessionVault(corruptStorage);
      assert.equal(vault.getStats().corruptRecoveries, 1);
      for (const p of ['google', 'microsoft', 'subsonic', 'jellyfin', 'blackcandy']) {
        assert.equal(vault.evaluateColdStartAction(p, 1_763_424_000_000), 'skip_unconfigured');
      }
      assert.equal(corruptStorage.rawMap.has(key), false, 'Corrupted storage entry should be cleaned up automatically');
    }

    // 2. Clock-skew safety: backward system clock jump (verifiedAt is 30 min ahead of current system clock)
    const verifiedTime = 1_763_424_000_000;
    const skewStorage = createMockLocalStorage();
    const skewVault = lib.createMultiProviderSessionVault(skewStorage, {
      clockSkewToleranceMs: 60_000,
      clockSkewMs: 30_000 // extra 30s explicit clock-skew safety buffer
    });

    skewVault.recordSession('google', {
      accessTokenPresent: true,
      verifiedAt: verifiedTime,
      expiresAt: verifiedTime + 60 * 60_000, // 1 hour after verifiedAt
      accountHint: 'ntp-skew@gmail.com',
      lastStatus: 'connected'
    }, verifiedTime);

    // Small jitter within 60s tolerance (e.g. 15s behind verifiedAt) still reuses cached token safely
    assert.equal(skewVault.evaluateColdStartAction('google', verifiedTime - 15_000), 'reuse_cached_token');

    // System clock rewound by 30 minutes (< verifiedAt - 60s tolerance) -> distrusts cached expiry and forces silent_refresh!
    const rewoundDetail = skewVault.evaluateColdStartDetail('google', verifiedTime - 30 * 60_000);
    assert.equal(rewoundDetail.clockSkewDetected, true);
    assert.equal(rewoundDetail.action, 'silent_refresh');
    assert.equal(skewVault.evaluateColdStartAction('google', verifiedTime - 30 * 60_000), 'silent_refresh');

    // Explicit clockSkewMs (30s) + 5m safetyMarginMs = 330s effective lead window:
    // At 5m 15s remaining (315s <= 330s), triggers proactive silent_refresh!
    assert.equal(
      skewVault.evaluateColdStartAction('google', verifiedTime + 60 * 60_000 - 315_000),
      'silent_refresh'
    );
    // At 6m remaining (360s > 330s), reuses cached token!
    assert.equal(
      skewVault.evaluateColdStartAction('google', verifiedTime + 60 * 60_000 - 360_000),
      'reuse_cached_token'
    );

    // Absurd >1-year future OAuth expiry caused by runaway forward clock at issue time -> clockSkewDetected: true -> silent_refresh
    skewVault.recordSession('microsoft', {
      accessTokenPresent: true,
      verifiedAt: verifiedTime,
      expiresAt: verifiedTime + 5 * 365 * 24 * 3600 * 1000,
      accountHint: 'runaway-clock@live.com',
      lastStatus: 'connected'
    }, verifiedTime);
    const runawayDetail = skewVault.evaluateColdStartDetail('microsoft', verifiedTime + 1000);
    assert.equal(runawayDetail.clockSkewDetected, true);
    assert.equal(runawayDetail.action, 'silent_refresh');

    // Unix-seconds expiresAt (e.g. 1763427600 instead of ms) auto-normalizes to ms cleanly
    skewVault.recordSession('google', {
      accessTokenPresent: true,
      verifiedAt: 1_763_424_000,
      expiresAt: 1_763_427_600,
      accountHint: 'seconds-epoch@gmail.com'
    }, verifiedTime);
    assert.equal(skewVault.getProviderSession('google').expiresAt, 1_763_427_600_000);
    assert.equal(skewVault.evaluateColdStartAction('google', verifiedTime + 10 * 60_000), 'reuse_cached_token');
  });
});

describe('Autonomy Tail-Chaining Cycle 18 — BUG-07 (SampleRate-Invariant RT60 Impulse Synthesis & ConvolverNode Reconciler)', () => {
  it('exposes BUG-07 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.synthesizeSampleRateInvariantImpulseResponse, 'function');
    assert.equal(typeof lib.reconcileConvolverImpulseForSampleRate, 'function');

    const sandbox = { library: { keepRefBug07: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.synthesizeSampleRateInvariantImpulseResponse, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.reconcileConvolverImpulseForSampleRate, 'function');
    assert.equal(typeof sandbox.library.synthesizeSampleRateInvariantImpulseResponse, 'function');
    assert.equal(typeof sandbox.library.reconcileConvolverImpulseForSampleRate, 'function');
    assert.equal(sandbox.library.keepRefBug07, true);
  });

  it('preserves exact physical duration (frames / sampleRate === durationSec) and exact millisecond early reflection tap indices across 44.1kHz..384kHz', () => {
    assert.equal(lib.synthesizeSampleRateInvariantImpulseResponse('bypass', 44100), null);

    const customRoom = {
      id: 'reference_hall',
      rt60Sec: 1.8,
      preDelayMs: 20,
      durationSec: 1.8,
      tailGain: 0.05,
      earlyReflections: [
        { tapMs: 20.0, gainL: 0.55, gainR: 0.48 },
        { tapMs: 32.5, gainL: -0.40, gainR: 0.36 },
        { tapMs: 51.2, gainL: 0.31, gainR: -0.34 }
      ]
    };

    const sampleRates = [44100, 48000, 88200, 96000, 176400, 192000, 384000];
    const resultsBySr = new Map();

    for (const sr of sampleRates) {
      const ir = lib.synthesizeSampleRateInvariantImpulseResponse(customRoom, sr, 0x9e3779b9);
      resultsBySr.set(sr, ir);

      // 1. Exact physical duration invariant: frames / sampleRate === durationSec
      assert.equal(ir.sampleRate, sr);
      assert.equal(ir.frames, Math.round(1.8 * sr));
      assert.equal(ir.frames / ir.sampleRate, 1.8);
      assert.equal(ir.durationSec, 1.8);
      assert.ok(ir.maxPeak <= 1.0);

      // 2. Exact millisecond early reflection tap indices: Math.round(tapMs * 0.001 * sampleRate)
      assert.equal(ir.earlyReflections.length, 3);
      for (let t = 0; t < customRoom.earlyReflections.length; t++) {
        const expectedTap = customRoom.earlyReflections[t];
        const actualTap = ir.earlyReflections[t];
        const expectedIndex = Math.round(expectedTap.tapMs * 0.001 * sr);
        assert.equal(actualTap.frameIndex, expectedIndex);
        // Verify deterministic reflection impulse dominates at exact millisecond frame index
        assert.ok(Math.abs(ir.left[expectedIndex] - expectedTap.gainL) < 0.08);
        assert.ok(Math.abs(ir.right[expectedIndex] - expectedTap.gainR) < 0.08);
      }
    }

    // Specifically compare 44.1kHz (79,380 frames) vs 192kHz (345,600 frames) tap timing in ms
    const ir44k = resultsBySr.get(44100);
    const ir192k = resultsBySr.get(192000);
    assert.equal(ir44k.frames, 79380);
    assert.equal(ir192k.frames, 345600);
    for (let t = 0; t < 3; t++) {
      const ms44k = (ir44k.earlyReflections[t].frameIndex / 44100) * 1000;
      const ms192k = (ir192k.earlyReflections[t].frameIndex / 192000) * 1000;
      assert.ok(
        Math.abs(ms44k - ms192k) < 0.02,
        `Early reflection ${t} physical delay must match within 0.02ms across 44.1kHz (${ms44k}ms) vs 192kHz (${ms192k}ms)`
      );
    }

    // Deterministic PRNG: identical seed produces 100% bit-identical Float32Arrays
    const ir44kRepeat = lib.synthesizeSampleRateInvariantImpulseResponse(customRoom, 44100, 0x9e3779b9);
    assert.deepEqual(ir44k.left, ir44kRepeat.left);
    assert.deepEqual(ir44k.right, ir44kRepeat.right);
  });

  it('maintains -60dB RT60 exponential decay accuracy and sample-rate energy invariance (1 / Math.sqrt(sr / 48000)) across 44.1kHz, 96kHz, 192kHz, and 384kHz', () => {
    const pureTailPreset = {
      id: 'diffuse_rt60_lab',
      rt60Sec: 1.8,
      preDelayMs: 0,
      durationSec: 2.0,
      tailGain: 0.12,
      earlyReflections: []
    };

    function measureWindowRms(ir, centerSec, windowSec = 0.05) {
      const halfSpan = Math.max(1, Math.floor((windowSec * 0.5) * ir.sampleRate));
      const centerIdx = Math.round(centerSec * ir.sampleRate);
      const start = Math.max(0, centerIdx - halfSpan);
      const end = Math.min(ir.frames, centerIdx + halfSpan);
      let sumSq = 0;
      let count = 0;
      for (let i = start; i < end; i++) {
        sumSq += ir.left[i] * ir.left[i] + ir.right[i] * ir.right[i];
        count += 2;
      }
      return Math.sqrt(sumSq / count);
    }

    const rates = [44100, 96000, 192000, 384000];
    const energies = [];

    for (const sr of rates) {
      const ir = lib.synthesizeSampleRateInvariantImpulseResponse(pureTailPreset, sr, 0x12345678);
      assert.ok(Math.abs(ir.gainCompensation - (1 / Math.sqrt(sr / 48000))) < 1e-12);

      // Measure RMS at t1 = 0.05s and t2 = 1.85s (delta_t = 1.80s === exact RT60!)
      const rmsStart = measureWindowRms(ir, 0.05, 0.06);
      const rmsEnd = measureWindowRms(ir, 1.85, 0.06);
      const decayDb = 20 * Math.log10(rmsEnd / rmsStart);

      assert.ok(
        Math.abs(decayDb - (-60.0)) < 0.8,
        `Expected -60.0dB decay over 1.8s RT60 at ${sr}Hz, got ${decayDb.toFixed(3)}dB`
      );

      energies.push({ sr, totalEnergy: ir.totalEnergy });
    }

    // Verify energy invariance across 44.1kHz, 96kHz, 192kHz, and 384kHz (8.7x sampleRate span -> < 0.25dB loudness spread!)
    const refEnergy = energies[0].totalEnergy;
    for (const item of energies) {
      const diffDb = Math.abs(10 * Math.log10(item.totalEnergy / refEnergy));
      assert.ok(
        diffDb < 0.25,
        `Impulse total L2 energy at ${item.sr}Hz must remain invariant within 0.25dB of 44.1kHz, got ${diffDb.toFixed(4)}dB`
      );
    }
  });

  it('reconcileConvolverImpulseForSampleRate regenerates ConvolverNode AudioBuffer on sampleRate transitions and prevents NotSupportedError', () => {
    function createStrictMockAudioContext(sampleRate) {
      const ctx = {
        sampleRate,
        currentTime: 0,
        createBuffer(channels, length, sr) {
          const chData = Array.from({ length: channels }, () => new Float32Array(length));
          return {
            numberOfChannels: channels,
            length,
            sampleRate: sr,
            duration: length / sr,
            getChannelData(c) { return chData[c]; },
            copyToChannel(src, c) { chData[c].set(src); }
          };
        },
        createConvolver() {
          let currentBuf = null;
          return {
            context: ctx,
            normalize: true,
            disconnected: false,
            connectedTo: null,
            get buffer() { return currentBuf; },
            set buffer(buf) {
              if (buf !== null && buf.sampleRate !== ctx.sampleRate) {
                const err = new Error(`NotSupportedError: AudioBuffer sampleRate (${buf.sampleRate}) does not match AudioContext sampleRate (${ctx.sampleRate})`);
                err.name = 'NotSupportedError';
                throw err;
              }
              currentBuf = buf;
            },
            connect(dest) { this.connectedTo = dest; },
            disconnect() { this.disconnected = true; }
          };
        }
      };
      return ctx;
    }

    const ctx44k = createStrictMockAudioContext(44100);
    const inputGain = { connectedConvolver: null, connect(node) { this.connectedConvolver = node; } };
    const wetGain = { id: 'wetGain' };
    const convolver44k = ctx44k.createConvolver();
    const roomState = {
      input: inputGain,
      wetGain,
      convolver: convolver44k,
      bufferSampleRate: null,
      activeProfile: 'concert_hall'
    };

    // 1. Initial 44.1kHz synthesis for Symphony Concert Hall (RT60 1.85s, preDelay 24ms -> 1.88s)
    const r1 = lib.reconcileConvolverImpulseForSampleRate(roomState, ctx44k, 'concert_hall');
    assert.equal(r1.valid, true);
    assert.equal(r1.regenerated, true);
    assert.equal(r1.recreatedNode, false);
    assert.equal(roomState.convolver.normalize, false);
    assert.equal(roomState.convolver.buffer.sampleRate, 44100);
    assert.equal(roomState.bufferSampleRate, 44100);
    const dur44k = roomState.convolver.buffer.duration;

    // 2. Calling again at identical 44.1kHz & preset performs zero redundant regeneration
    const prevBufRef = roomState.convolver.buffer;
    const rIdempotent = lib.reconcileConvolverImpulseForSampleRate(roomState, ctx44k, 'concert_hall');
    assert.equal(rIdempotent.valid, true);
    assert.equal(rIdempotent.regenerated, false);
    assert.strictEqual(roomState.convolver.buffer, prevBufRef);

    // 3. Transition to 176.4kHz Hi-Res / DSD128 AudioContext -> recreates ConvolverNode & regenerates 176.4kHz AudioBuffer with identical physical duration!
    const ctx176k = createStrictMockAudioContext(176400);
    const r176k = lib.reconcileConvolverImpulseForSampleRate(roomState, ctx176k, 'concert_hall');
    assert.equal(r176k.valid, true);
    assert.equal(r176k.regenerated, true);
    assert.equal(r176k.recreatedNode, true);
    assert.equal(convolver44k.disconnected, true);
    assert.strictEqual(inputGain.connectedConvolver, roomState.convolver);
    assert.strictEqual(roomState.convolver.connectedTo, wetGain);
    assert.equal(roomState.convolver.buffer.sampleRate, 176400);
    assert.equal(roomState.convolver.buffer.length, prevBufRef.length * 4);
    assert.equal(roomState.convolver.buffer.duration, dur44k);

    // 4. Bypass clears buffer cleanly
    const rBypass = lib.reconcileConvolverImpulseForSampleRate(roomState, ctx176k, 'bypass');
    assert.equal(rBypass.valid, true);
    assert.equal(rBypass.bypassed, true);
    assert.equal(roomState.convolver.buffer, null);

    // 5. Verify index.html wiring & Web Audio graph invariant
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('library.reconcileConvolverImpulseForSampleRate('));
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must remain 100% intact'
    );
  });
});

describe('Autonomy Tail-Chaining Cycle 19 — UPG-07 (SampleRate-Aware RBJ Cookbook Biquad & Parametric EQ Magnitude/Phase Response Analyzer)', () => {
  it('exposes UPG-07 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.computeBiquadCoefficientsCookbook, 'function');
    assert.equal(typeof lib.evaluateParametricEqResponseCurve, 'function');

    const sandbox = { library: { keepRefUpg07: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.computeBiquadCoefficientsCookbook, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.evaluateParametricEqResponseCurve, 'function');
    assert.equal(typeof sandbox.library.computeBiquadCoefficientsCookbook, 'function');
    assert.equal(typeof sandbox.library.evaluateParametricEqResponseCurve, 'function');
    assert.equal(sandbox.library.keepRefUpg07, true);
  });

  it('computeBiquadCoefficientsCookbook computes exact normalized RBJ coefficients across all 8 filter types and clamps safely below Nyquist (0.495 * sampleRate)', () => {
    function evalSingleBiquadAt(coeffs, freqHz) {
      const w = (2 * Math.PI * freqHz) / coeffs.sampleRate;
      const c1 = Math.cos(w);
      const s1 = Math.sin(w);
      const c2 = Math.cos(2 * w);
      const s2 = Math.sin(2 * w);
      const nr = coeffs.b0 + coeffs.b1 * c1 + coeffs.b2 * c2;
      const ni = -(coeffs.b1 * s1 + coeffs.b2 * s2);
      const dr = coeffs.a0 + coeffs.a1 * c1 + coeffs.a2 * c2;
      const di = -(coeffs.a1 * s1 + coeffs.a2 * s2);
      const den2 = dr * dr + di * di;
      const hRe = (nr * dr + ni * di) / den2;
      const hIm = (ni * dr - nr * di) / den2;
      const mag2 = hRe * hRe + hIm * hIm;
      return {
        db: mag2 > 1e-24 ? 10 * Math.log10(mag2) : -240,
        phaseDeg: (Math.atan2(hIm, hRe) * 180) / Math.PI
      };
    }

    // 1. Peaking filter (+6.0 dB at 1000 Hz, Q = 1.5, 48 kHz): 0 dB at DC & Nyquist, exact +6.0 dB & 0 deg at f0
    const peak = lib.computeBiquadCoefficientsCookbook({ type: 'peaking', frequency: 1000, gain: 6, q: 1.5 }, 48000);
    assert.equal(peak.a0, 1);
    assert.equal(peak.polesStable, true);
    assert.equal(peak.clampedToNyquist, false);
    assert.ok(Math.abs(evalSingleBiquadAt(peak, 0).db) < 1e-9);
    assert.ok(Math.abs(evalSingleBiquadAt(peak, 1000).db - 6.0) < 1e-9);
    assert.ok(Math.abs(evalSingleBiquadAt(peak, 1000).phaseDeg) < 1e-9);
    assert.ok(Math.abs(evalSingleBiquadAt(peak, 24000).db) < 1e-9);

    // 2. Lowshelf (+6.0 dB at 120 Hz, Q = SQRT1_2, 48 kHz): +6.0 dB at DC, +3.0 dB at f0, 0.0 dB at Nyquist
    const lowshelf = lib.computeBiquadCoefficientsCookbook({ type: 'lowshelf', frequency: 120, gain: 6, q: Math.SQRT1_2 }, 48000);
    assert.equal(lowshelf.polesStable, true);
    assert.ok(Math.abs(evalSingleBiquadAt(lowshelf, 0).db - 6.0) < 1e-9);
    assert.ok(Math.abs(evalSingleBiquadAt(lowshelf, 120).db - 3.0) < 1e-6);
    assert.ok(Math.abs(evalSingleBiquadAt(lowshelf, 24000).db) < 1e-9);

    // 3. Highshelf (+6.0 dB at 8000 Hz, Q = SQRT1_2, 96 kHz): 0.0 dB at DC, +3.0 dB at f0, +6.0 dB at Nyquist
    const highshelf = lib.computeBiquadCoefficientsCookbook({ type: 'highshelf', frequency: 8000, gain: 6, q: Math.SQRT1_2 }, 96000);
    assert.equal(highshelf.polesStable, true);
    assert.ok(Math.abs(evalSingleBiquadAt(highshelf, 0).db) < 1e-9);
    assert.ok(Math.abs(evalSingleBiquadAt(highshelf, 8000).db - 3.0) < 1e-6);
    assert.ok(Math.abs(evalSingleBiquadAt(highshelf, 48000).db - 6.0) < 1e-9);

    // 4. Lowpass, Highpass, Bandpass, Notch, Allpass at 96 kHz
    const lp = lib.computeBiquadCoefficientsCookbook({ type: 'lowpass', frequency: 2000, q: Math.SQRT1_2 }, 96000);
    assert.ok(Math.abs(evalSingleBiquadAt(lp, 0).db) < 1e-9);
    assert.ok(Math.abs(evalSingleBiquadAt(lp, 2000).db - (-3.0103)) < 0.05);
    assert.ok(evalSingleBiquadAt(lp, 48000).db < -100);

    const hp = lib.computeBiquadCoefficientsCookbook({ type: 'highpass', frequency: 2000, q: Math.SQRT1_2 }, 96000);
    assert.ok(evalSingleBiquadAt(hp, 0).db < -100);
    assert.ok(Math.abs(evalSingleBiquadAt(hp, 2000).db - (-3.0103)) < 0.05);
    assert.ok(Math.abs(evalSingleBiquadAt(hp, 48000).db) < 1e-9);

    const bp = lib.computeBiquadCoefficientsCookbook({ type: 'bandpass', frequency: 1500, q: 2.0 }, 96000);
    assert.ok(Math.abs(evalSingleBiquadAt(bp, 1500).db) < 1e-9);
    assert.ok(Math.abs(evalSingleBiquadAt(bp, 1500).phaseDeg) < 1e-9);

    const notch = lib.computeBiquadCoefficientsCookbook({ type: 'notch', frequency: 1500, q: 4.0 }, 96000);
    assert.ok(Math.abs(evalSingleBiquadAt(notch, 0).db) < 1e-9);
    assert.ok(evalSingleBiquadAt(notch, 1500).db < -120);
    assert.ok(Math.abs(evalSingleBiquadAt(notch, 48000).db) < 1e-9);

    const ap = lib.computeBiquadCoefficientsCookbook({ type: 'allpass', frequency: 1500, q: 1.2 }, 96000);
    for (const f of [20, 300, 1500, 10000, 40000]) {
      assert.ok(Math.abs(evalSingleBiquadAt(ap, f).db) < 1e-9, `Allpass magnitude must be 0 dB at ${f} Hz`);
    }
    assert.ok(Math.abs(Math.abs(evalSingleBiquadAt(ap, 1500).phaseDeg) - 180) < 1e-6);

    // 5. Nyquist clamping across 44.1kHz vs 192kHz vs 384kHz (0.495 * sampleRate)
    const clamped44k = lib.computeBiquadCoefficientsCookbook({ type: 'peaking', frequency: 28000, gain: 4, q: 1 }, 44100);
    assert.equal(clamped44k.clampedToNyquist, true);
    assert.equal(clamped44k.frequency, 44100 * 0.495);
    assert.equal(clamped44k.polesStable, true);

    const unclamped192k = lib.computeBiquadCoefficientsCookbook({ type: 'peaking', frequency: 28000, gain: 4, q: 1 }, 192000);
    assert.equal(unclamped192k.clampedToNyquist, false);
    assert.equal(unclamped192k.frequency, 28000);
    assert.equal(unclamped192k.polesStable, true);

    const unclamped384k = lib.computeBiquadCoefficientsCookbook({ type: 'peaking', frequency: 60000, gain: -3, q: 1.5 }, 384000);
    assert.equal(unclamped384k.clampedToNyquist, false);
    assert.equal(unclamped384k.frequency, 60000);
    assert.equal(unclamped384k.polesStable, true);
  });

  it('evaluateParametricEqResponseCurve computes cascade magnitude & phase, 44.1kHz vs 192kHz near-20kHz cramping divergence, anti-clipping recommendedPreampDb, and zero-alloc outBuffers reuse', () => {
    // 1. Symmetric peaking filter phase response: +lead below f0, exact 0 deg at f0, -lag above f0
    const singlePeakCurve = lib.evaluateParametricEqResponseCurve(
      [{ type: 'peaking', frequency: 1000, gain: 6, q: 1.5 }],
      { sampleRate: 96000, frequencies: [500, 1000, 2000] }
    );
    assert.ok(singlePeakCurve.frequenciesHz instanceof Float32Array);
    assert.ok(singlePeakCurve.magnitudeDb instanceof Float32Array);
    assert.ok(singlePeakCurve.phaseDeg instanceof Float32Array);
    assert.ok(Math.abs(singlePeakCurve.magnitudeDb[1] - 6.0) < 1e-5);
    assert.equal(singlePeakCurve.phaseDeg[1], 0);
    assert.ok(singlePeakCurve.phaseDeg[0] > 10 && singlePeakCurve.phaseDeg[0] <= 180, 'Boost peaking filter must exhibit positive phase lead below f0');
    assert.ok(singlePeakCurve.phaseDeg[2] < -10 && singlePeakCurve.phaseDeg[2] >= -180, 'Boost peaking filter must exhibit negative phase lag above f0');

    // 2. Complementary +8dB and -8dB peaking cascade cancels to 0.0 dB and 0.0 deg everywhere
    const cancelCurve = lib.evaluateParametricEqResponseCurve(
      [
        { type: 'peaking', frequency: 2500, gain: 8, q: 1.4 },
        { type: 'peaking', frequency: 2500, gain: -8, q: 1.4 }
      ],
      { sampleRate: 96000, pointCount: 64 }
    );
    for (let i = 0; i < cancelCurve.magnitudeDb.length; i++) {
      assert.ok(Math.abs(cancelCurve.magnitudeDb[i]) < 1e-5);
      assert.ok(Math.abs(cancelCurve.phaseDeg[i]) < 1e-5);
      assert.ok(cancelCurve.phaseDeg[i] >= -180 && cancelCurve.phaseDeg[i] <= 180);
    }

    // 3. Real digital frequency cramping near Nyquist at 44.1kHz vs 192kHz & 384kHz!
    // At 44.1kHz (Nyquist = 22.05kHz), a peaking filter at 16kHz (+6dB, Q=0.8) is forced down toward 0dB at 22.05kHz,
    // severely cramping its 20kHz gain compared to 192kHz / 384kHz!
    const airBoostBands = [{ type: 'peaking', frequency: 16000, gain: 6.0, q: 0.8 }];
    const curve44k = lib.evaluateParametricEqResponseCurve(airBoostBands, {
      sampleRate: 44100,
      pointCount: 128,
      minFreqHz: 20,
      maxFreqHz: 20000
    });
    const curve192k = lib.evaluateParametricEqResponseCurve(airBoostBands, {
      sampleRate: 192000,
      pointCount: 128,
      minFreqHz: 20,
      maxFreqHz: 20000
    });
    const curve384k = lib.evaluateParametricEqResponseCurve(airBoostBands, {
      sampleRate: 384000,
      pointCount: 128,
      minFreqHz: 20,
      maxFreqHz: 20000
    });

    assert.equal(curve44k.nyquistHz, 22050);
    assert.equal(curve192k.nyquistHz, 96000);
    assert.equal(curve384k.nyquistHz, 192000);
    assert.equal(curve44k.frequenciesHz[127], 20000);
    assert.equal(curve192k.frequenciesHz[127], 20000);

    const gain20kAt44k = curve44k.magnitudeDb[127];
    const gain20kAt192k = curve192k.magnitudeDb[127];
    const gain20kAt384k = curve384k.magnitudeDb[127];
    assert.ok(gain20kAt44k < 2.2, `Expected severe Nyquist cramping at 20kHz on 44.1kHz stream, got ${gain20kAt44k.toFixed(2)} dB`);
    assert.ok(gain20kAt192k > 5.0, `Expected uncramped upper skirt at 20kHz on 192kHz stream, got ${gain20kAt192k.toFixed(2)} dB`);
    assert.ok(gain20kAt384k > gain20kAt192k, '384kHz response at 20kHz should be even closer to analog prototype than 192kHz');
    assert.ok(gain20kAt192k - gain20kAt44k > 3.0, `Expected >3.0dB cramping divergence at 20kHz between 192kHz and 44.1kHz, got ${(gain20kAt192k - gain20kAt44k).toFixed(2)} dB`);

    // Verify maxFreqHz safety clamp when maxFreqHz > 0.495 * sampleRate
    const clampedGrid = lib.evaluateParametricEqResponseCurve(airBoostBands, {
      sampleRate: 44100,
      pointCount: 64,
      maxFreqHz: 40000
    });
    assert.ok(Math.abs(clampedGrid.frequenciesHz[63] - 44100 * 0.495) < 0.01);

    // 4. Cascade magnitude summation & anti-clipping recommendedPreampDb calculation + zero-allocation outBuffers reuse
    const outBuffers = {
      frequenciesHz: new Float32Array(256),
      magnitudeDb: new Float32Array(256),
      phaseDeg: new Float32Array(256)
    };
    const multiBand = [
      { type: 'lowshelf', frequency: 80, gain: 4.5, q: 0.71 },
      { type: 'peaking', frequency: 1000, gain: 3.5, q: 1.0 },
      { type: 'peaking', frequency: 1050, gain: 3.0, q: 1.0 },
      { type: 'peaking', frequency: 6000, gain: -5.0, q: 2.5 }
    ];
    const reusedRes = lib.evaluateParametricEqResponseCurve(multiBand, {
      sampleRate: 96000,
      pointCount: 256,
      outBuffers
    });

    assert.strictEqual(reusedRes.frequenciesHz, outBuffers.frequenciesHz);
    assert.strictEqual(reusedRes.magnitudeDb, outBuffers.magnitudeDb);
    assert.strictEqual(reusedRes.phaseDeg, outBuffers.phaseDeg);
    assert.ok(reusedRes.peakBoostDb > 6.2 && reusedRes.peakBoostDb < 6.7, `Overlapping 1kHz bands must compound boost to ~6.5 dB, got ${reusedRes.peakBoostDb}`);
    assert.ok(reusedRes.maxCutDb < -4.5, `Expected maxCutDb < -4.5 dB, got ${reusedRes.maxCutDb}`);
    assert.equal(reusedRes.recommendedPreampDb, -reusedRes.peakBoostDb);

    // Cut-only EQ needs 0 dB preamp (never boosts above 0 dB)
    const cutOnlyRes = lib.evaluateParametricEqResponseCurve(
      [{ type: 'peaking', frequency: 3000, gain: -4.0, q: 2.0 }],
      { sampleRate: 48000, outBuffers }
    );
    assert.equal(cutOnlyRes.peakBoostDb, 0);
    assert.ok(cutOnlyRes.maxCutDb < -3.8);
    assert.equal(cutOnlyRes.recommendedPreampDb, 0);
  });
});

describe('Autonomy Tail-Chaining Cycle 20 — OPT-07 (In-Place Odometer ASCII PoW Scratchpad & Web Worker Offloading)', () => {
  it('exposes OPT-07 functions on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createPreallocatedPowAsciiScratchpad, 'function');
    assert.equal(typeof lib.createLrclibPowWorkerRunner, 'function');

    const sandbox = { library: { keepRefOpt07: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createPreallocatedPowAsciiScratchpad, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.createLrclibPowWorkerRunner, 'function');
    assert.equal(typeof sandbox.library.createPreallocatedPowAsciiScratchpad, 'function');
    assert.equal(typeof sandbox.library.createLrclibPowWorkerRunner, 'function');
    assert.equal(sandbox.library.keepRefOpt07, true);
  });

  it('createPreallocatedPowAsciiScratchpad maintains exact byte-for-byte parity with Buffer.from("${prefix}:${nonce}") across all carry boundaries (9->10, 99->100, 9999->10000) with zero subarray allocations', () => {
    const prefix = 'lrclib-opt07-pow-token';
    const scratchpad = lib.createPreallocatedPowAsciiScratchpad(prefix);

    assert.equal(scratchpad.nonce, 0);
    assert.equal(scratchpad.digitCount, 1);
    assert.deepEqual(Buffer.from(scratchpad.view), Buffer.from(`${prefix}:0`));

    // Verify zero-allocation view reuse across same-digit-width increments (0..9 share identical Uint8Array view reference!)
    const singleDigitViewRef = scratchpad.view;
    assert.strictEqual(singleDigitViewRef.buffer, scratchpad.buffer.buffer);

    // Sweep continuously from 0 through 10,050 covering 9->10, 99->100, 199->200, 999->1000, and 9999->10000
    const explicitBoundaries = new Set([0, 1, 8, 9, 10, 11, 98, 99, 100, 101, 199, 200, 998, 999, 1000, 9998, 9999, 10000, 10001, 10050]);
    let twoDigitViewRef = null;

    for (let expectedNonce = 0; expectedNonce <= 10050; expectedNonce++) {
      assert.equal(scratchpad.nonce, expectedNonce);
      if (expectedNonce === 5) {
        assert.strictEqual(scratchpad.view, singleDigitViewRef, 'Same-width odometer step must reuse identical Uint8Array subarray view');
      }
      if (expectedNonce === 10) {
        twoDigitViewRef = scratchpad.view;
        assert.equal(scratchpad.digitCount, 2);
      }
      if (expectedNonce === 99) {
        assert.strictEqual(scratchpad.view, twoDigitViewRef);
      }
      if (expectedNonce <= 150 || explicitBoundaries.has(expectedNonce) || expectedNonce >= 9995) {
        const expectedBuf = Buffer.from(`${prefix}:${expectedNonce}`, 'utf8');
        assert.equal(scratchpad.byteLength, expectedBuf.length);
        assert.equal(Buffer.compare(Buffer.from(scratchpad.view), expectedBuf), 0, `Byte mismatch at nonce=${expectedNonce}`);
      }
      scratchpad.increment();
    }

    // Also test setNonce jump to 999,998 -> 999,999 -> 1,000,000 with UTF-8 multi-byte prefix
    const utf8Prefix = 'nhạc-hi-res-λ';
    const utf8Pad = lib.createPreallocatedPowAsciiScratchpad(utf8Prefix, { startNonce: 999998 });
    for (const targetNonce of [999998, 999999, 1000000, 1000001]) {
      assert.equal(utf8Pad.nonce, targetNonce);
      assert.equal(Buffer.compare(Buffer.from(utf8Pad.view), Buffer.from(`${utf8Prefix}:${targetNonce}`, 'utf8')), 0);
      utf8Pad.increment();
    }

    assert.throws(() => lib.createPreallocatedPowAsciiScratchpad(''), TypeError);
    assert.throws(() => scratchpad.setNonce(-1), RangeError);
  });

  it('createLrclibPowWorkerRunner offloads PoW to inline Blob Web Worker with immediate Blob URL revocation, terminates on AbortController, and falls back seamlessly to solveLrclibChallengeAsync', async () => {
    const prefix = 'worker-pow-opt07-';
    const targetHex = '00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    // 1. Build a VM-backed MockWorker + MockBlob + MockURL harness that executes the real generated Worker JS source!
    function createVmWorkerEnv() {
      const blobStore = new Map();
      const revokedUrls = [];
      const createdWorkers = [];
      let urlSeq = 0;

      class MockBlob {
        constructor(parts, opts) {
          this.source = parts.map(p => String(p)).join('');
          this.type = (opts && opts.type) || '';
        }
      }

      const MockURL = {
        createObjectURL(blob) {
          const url = `blob:https://nocturne.local/pow-worker-${++urlSeq}`;
          blobStore.set(url, blob.source);
          return url;
        },
        revokeObjectURL(url) {
          revokedUrls.push(url);
          blobStore.delete(url);
        }
      };

      class MockWorker {
        constructor(scriptUrl) {
          // Capture script source at instantiation BEFORE revokeObjectURL runs in finally!
          const code = blobStore.get(scriptUrl);
          if (!code) {
            throw new Error(`Blob URL already revoked or missing: ${scriptUrl}`);
          }
          this.scriptUrl = scriptUrl;
          this.terminated = false;
          this._listeners = { message: [], error: [] };
          this.onmessage = null;
          this.onerror = null;

          const selfGlobal = {
            onmessage: null,
            Uint8Array,
            Uint32Array,
            DataView,
            ArrayBuffer,
            Math,
            Date,
            Number,
            String,
            Boolean,
            Array,
            Error,
            setTimeout: (fn, ms) => setTimeout(() => {
              if (!this.terminated) fn();
            }, ms),
            clearTimeout,
            postMessage: (data) => {
              if (this.terminated) return;
              const ev = { data };
              setImmediate(() => {
                if (this.terminated) return;
                if (typeof this.onmessage === 'function') this.onmessage(ev);
                for (const fn of this._listeners.message) fn(ev);
              });
            }
          };
          selfGlobal.self = selfGlobal;
          this._selfGlobal = selfGlobal;
          vm.runInNewContext(code, selfGlobal);
          createdWorkers.push(this);
        }

        addEventListener(type, fn) {
          if (this._listeners[type]) this._listeners[type].push(fn);
        }

        postMessage(data) {
          if (this.terminated) return;
          setImmediate(() => {
            if (this.terminated) return;
            if (typeof this._selfGlobal.onmessage === 'function') {
              this._selfGlobal.onmessage({ data });
            }
          });
        }

        terminate() {
          this.terminated = true;
          if (typeof this._selfGlobal.onmessage === 'function') {
            try { this._selfGlobal.onmessage({ data: { type: 'abort' } }); } catch (_) {}
          }
        }
      }

      return { MockWorker, MockBlob, MockURL, blobStore, revokedUrls, createdWorkers };
    }

    const env = createVmWorkerEnv();
    const runner = lib.createLrclibPowWorkerRunner({
      Worker: env.MockWorker,
      Blob: env.MockBlob,
      URL: env.MockURL
    });
    assert.equal(runner.isWorkerSupported(), true);

    // Solve via inline Blob Web Worker
    const workerPromise = runner.solve(prefix, targetHex, { batchSize: 64 });
    // Blob URL MUST already be revoked synchronously right after Worker instantiation (while worker is still running!)
    assert.equal(env.revokedUrls.length, 1);
    assert.equal(env.blobStore.size, 0, 'Worker Blob URL must be revoked immediately after instantiation');

    const workerSolved = await workerPromise;
    const syncRef = lib.solveLrclibChallengeSync(prefix, targetHex);

    assert.equal(workerSolved.usedWorker, true);
    assert.equal(workerSolved.mode, 'worker');
    assert.equal(workerSolved.nonce, syncRef.nonce);
    assert.equal(workerSolved.publishToken, syncRef.publishToken);
    assert.equal(workerSolved.hashHex, syncRef.hashHex);
    assert.equal(env.createdWorkers[0].terminated, true, 'Completed worker must be terminated cleanly');
    assert.equal(runner.getTelemetry().workerRuns, 1);
    assert.equal(runner.getTelemetry().revokedBlobUrls, 1);

    // 2. AbortController mid-solve immediately calls worker.terminate() and rejects with AbortError
    const abortCtrl = new AbortController();
    const impossibleTarget = '0000000000000000000000000000000000000000000000000000000000000000';
    let progressEvents = 0;
    await assert.rejects(
      () => runner.solve(prefix, impossibleTarget, {
        batchSize: 32,
        maxIterations: 500000,
        signal: abortCtrl.signal,
        onProgress() {
          progressEvents++;
          if (progressEvents >= 2) {
            abortCtrl.abort('cancelled_by_editor_close');
          }
        }
      }),
      err => err && err.name === 'AbortError'
    );
    assert.ok(progressEvents >= 2);
    assert.equal(env.createdWorkers[1].terminated, true, 'Aborted worker must have worker.terminate() invoked immediately');
    assert.equal(runner.getTelemetry().terminatedRuns, 1);

    // 3. Automatic seamless fallback when Worker is unavailable (Node.js default)
    const nodeFallbackRunner = lib.createLrclibPowWorkerRunner({ Worker: null });
    assert.equal(nodeFallbackRunner.isWorkerSupported(), false);
    const fallbackSolved = await nodeFallbackRunner.solve(prefix, targetHex, { batchSize: 64 });
    assert.equal(fallbackSolved.usedWorker, false);
    assert.equal(fallbackSolved.mode, 'fallback');
    assert.equal(fallbackSolved.nonce, syncRef.nonce);
    assert.equal(fallbackSolved.publishToken, syncRef.publishToken);
    assert.equal(nodeFallbackRunner.getTelemetry().fallbackRuns, 1);

    // 4. Restricted CSP WebView where new Worker(blobUrl) throws SecurityError -> still revokes Blob URL & falls back seamlessly!
    let cspRevokedCount = 0;
    const cspRunner = lib.createLrclibPowWorkerRunner({
      Blob: env.MockBlob,
      URL: {
        createObjectURL: () => 'blob:https://restricted.webview/csp-blocked',
        revokeObjectURL: () => { cspRevokedCount++; }
      },
      Worker: function CspBlockedWorker() {
        const err = new Error("SecurityError: Failed to construct 'Worker': Access to blob script is denied by CSP");
        err.name = 'SecurityError';
        throw err;
      }
    });
    const cspSolved = await cspRunner.solve({ prefix, target: targetHex }, { batchSize: 64 });
    assert.equal(cspRevokedCount, 1, 'Blob URL must still be revoked even when Worker constructor throws CSP SecurityError');
    assert.equal(cspSolved.usedWorker, false);
    assert.equal(cspSolved.mode, 'fallback');
    assert.equal(cspSolved.nonce, syncRef.nonce);
    assert.equal(cspSolved.hashHex, syncRef.hashHex);
  });
});

describe('Autonomy Tail-Chaining Cycle 21 — BUG-08 (LRC [length:] vs Decoded AudioBuffer Duration Drift Reconciliation)', () => {
  it('exposes BUG-08 reconcileLyricDurationWithAudio on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.reconcileLyricDurationWithAudio, 'function');

    const sandbox = { library: { keepRefBug08: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.reconcileLyricDurationWithAudio, 'function');
    assert.equal(typeof sandbox.library.reconcileLyricDurationWithAudio, 'function');
    assert.equal(sandbox.library.keepRefBug08, true);
  });

  it('reconciles [length: 04:10.00] album LRC against 215.4s radio-edit decoded AudioBuffer, flags >2s drift, and rewrites [length: 03:35.40]', () => {
    const staleAlbumLrc = [
      '[ti:Midnight City]',
      '[ar:M83]',
      '[length: 04:10.00]',
      '[00:12.40]Waiting in a car',
      '[01:45.80]Waiting for a ride in the dark',
      '[03:30.15]<03:30.15>The <03:31.50>city <03:33.20>is my church'
    ].join('\n');

    // Pass AudioBuffer-like object { duration: 215.4, length: 20678400, sampleRate: 96000 }
    const mockAudioBuffer = { duration: 215.4, length: 20678400, sampleRate: 96000 };
    const rec = lib.reconcileLyricDurationWithAudio(staleAlbumLrc, mockAudioBuffer);

    assert.equal(rec.hasAuthoritativeAudio, true);
    assert.equal(rec.declaredLengthMs, 250000);
    assert.equal(rec.declaredLengthSec, 250);
    assert.equal(rec.authoritativeDurationMs, 215400);
    assert.equal(rec.authoritativeDurationSec, 215.4);
    assert.equal(rec.lrclibDurationSec, 215);
    assert.equal(rec.driftMs, 34600);
    assert.equal(rec.absDriftMs, 34600);
    assert.equal(rec.hasSignificantDrift, true);
    assert.equal(rec.maxTimestampMs, 213200);
    assert.equal(rec.hasTimestampOverrun, false);
    assert.equal(rec.rewroteLengthHeader, true);
    assert.equal(rec.formattedLengthTag, '[length: 03:35.40]');
    assert.ok(rec.warnings.includes('lrc_length_drift_exceeds_lrclib_tolerance'));
    assert.ok(rec.syncedLyrics.includes('[length: 03:35.40]'));
    assert.ok(!rec.syncedLyrics.includes('04:10.00'), 'Stale [length: 04:10.00] must be eliminated');

    // Minor <2s rounding difference (e.g. [length: 03:36] = 216s vs 215.4s) is normalized without false-positive >2s drift warning
    const minorLrc = '[ti:Midnight City]\n[length: 03:36]\n[00:12.40]Waiting in a car';
    const minorRec = lib.reconcileLyricDurationWithAudio(minorLrc, 215.4);
    assert.equal(minorRec.declaredLengthMs, 216000);
    assert.equal(minorRec.driftMs, 600);
    assert.equal(minorRec.hasSignificantDrift, false);
    assert.ok(minorRec.syncedLyrics.includes('[length: 03:35.40]'));
  });

  it('supports hh:mm:ss(.xx) long mixes (>1 hour) and detects/clamps out-of-bounds trailing timestamps', () => {
    // 1. >1 hour symphony / DJ mix (01:15:20.50 = 4520.5s vs 4524.8s decoded stream)
    const longMixLrc = [
      '[ti:Mahler Symphony No. 2 (Hi-Res Live)]',
      '[length: 01:15:20.50]',
      '[00:05:10.00]Allegro maestoso',
      '[01:14:58.25]Aufersteh\'n, ja aufersteh\'n wirst du'
    ].join('\n');

    const longRec = lib.reconcileLyricDurationWithAudio(longMixLrc, 4524.8, {
      preserveHhMmSs: true
    });
    assert.equal(longRec.declaredLengthMs, 4520500);
    assert.equal(longRec.authoritativeDurationMs, 4524800);
    assert.equal(longRec.lrclibDurationSec, 4525);
    assert.equal(longRec.driftMs, -4300);
    assert.equal(longRec.hasSignificantDrift, true);
    assert.equal(longRec.maxTimestampMs, 4498250);
    assert.equal(longRec.hasTimestampOverrun, false);
    assert.ok(longRec.syncedLyrics.includes('[length: 01:15:24.80]'));

    // Standard mm:ss.xx formatting for >1 hour (75:24.80) also parses back identically
    const longStdRec = lib.reconcileLyricDurationWithAudio(longMixLrc, 4524.8);
    assert.ok(longStdRec.syncedLyrics.includes('[length: 75:24.80]'));
    const reparsed = lib.reconcileLyricDurationWithAudio(longStdRec.syncedLyrics, 4524.8);
    assert.equal(reparsed.declaredLengthMs, 4524800);
    assert.equal(reparsed.driftMs, 0);

    // 2. Trailing timestamp overrun detection & optional clamping (maxTimestampMs > authoritativeDurationMs + toleranceMs)
    const overrunLrc = [
      '[ti:Track With Out-Of-Bounds Outro]',
      '[length: 03:35.40]',
      '[00:15.00]First verse',
      '[03:34.00]Final vocal note',
      '[03:42.50]<03:43.80>Trailing editor spam after track end'
    ].join('\n');

    const warnOnly = lib.reconcileLyricDurationWithAudio(overrunLrc, 215.4, { toleranceMs: 500 });
    assert.equal(warnOnly.maxTimestampMs, 223800);
    assert.equal(warnOnly.overrunMs, 8400);
    assert.equal(warnOnly.hasTimestampOverrun, true);
    assert.equal(warnOnly.clampedTimestampCount, 0);
    assert.ok(warnOnly.warnings.includes('trailing_timestamp_exceeds_audio_duration'));

    const clamped = lib.reconcileLyricDurationWithAudio(overrunLrc, 215.4, {
      toleranceMs: 500,
      clampTimestamps: true
    });
    assert.equal(clamped.hasTimestampOverrun, true);
    assert.equal(clamped.clampedTimestampCount, 2);
    assert.equal(clamped.effectiveMaxTimestampMs, 215400);
    assert.ok(clamped.syncedLyrics.includes('[03:35.40]<03:35.40>Trailing editor spam after track end'));
    assert.ok(!clamped.syncedLyrics.includes('03:42.50'));
  });

  it('integrates duration reconciliation into buildLrclibPublishPayload while preserving 100% backward compatibility', () => {
    const mismatchedLrc = [
      '[ti:Starlight]',
      '[ar:Muse]',
      '[length: 04:10.00]',
      '[00:14.20]Far away',
      '[03:32.00]Our hopes and expectations',
      '[03:40.00]Out-of-bounds tag'
    ].join('\n');

    // Authoritative decoded AudioBuffer (215.4s -> 215s) overrides stale metadata duration (250s) & rewrites [length:] in syncedLyrics!
    const spec = lib.buildLrclibPublishPayload(
      {
        trackName: 'Starlight',
        artistName: 'Muse',
        albumName: 'Black Holes and Revelations',
        duration: 250,
        audioBuffer: { duration: 215.4 }
      },
      { syncedLyrics: mismatchedLrc },
      { clampTimestamps: true, publishToken: 'bug08-prefix:42' }
    );

    assert.equal(spec.duration, 215);
    assert.equal(spec.body.duration, 215);
    assert.ok(spec.body.syncedLyrics.includes('[length: 03:35.40]'));
    assert.ok(!spec.body.syncedLyrics.includes('04:10.00'));
    assert.ok(spec.body.syncedLyrics.includes('[03:35.40]Out-of-bounds tag'));
    assert.equal(spec.durationReconciliation.hasSignificantDrift, true);
    assert.equal(spec.durationReconciliation.driftMs, 34600);
    assert.equal(spec.durationReconciliation.clampedTimestampCount, 1);

    // Optional strict rejection when rejectOnTimestampOverrun: true
    assert.throws(
      () => lib.buildLrclibPublishPayload(
        { trackName: 'Starlight', artistName: 'Muse', decodedDurationSec: 215.4 },
        { syncedLyrics: mismatchedLrc },
        { rejectOnTimestampOverrun: true }
      ),
      /exceeds decoded audio duration/
    );

    // Fallback to [length:] when trackMeta omits duration completely
    const fromLrcLengthSpec = lib.buildLrclibPublishPayload(
      { trackName: 'Long Mix', artistName: 'Artist' },
      '[length: 01:02:05.00]\n[01:01:50.00]Closing theme'
    );
    assert.equal(fromLrcLengthSpec.duration, 3725);
    assert.equal(fromLrcLengthSpec.plainLyrics, 'Closing theme');
  });
});

describe('Autonomy Tail-Chaining Cycle 22 — UPG-08 (Simultaneous Lead / Duet / Backing Multi-Voice Lyric Lanes via TypedLyricSegmentIndex)', () => {
  it('exposes UPG-08 resolveMultiVoiceLyricLanes & classifyLyricVocalRole on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.resolveMultiVoiceLyricLanes, 'function');
    assert.equal(typeof lib.classifyLyricVocalRole, 'function');

    const sandbox = { library: { keepRefUpg08: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.resolveMultiVoiceLyricLanes, 'function');
    assert.equal(typeof sandbox.library.resolveMultiVoiceLyricLanes, 'function');
    assert.equal(typeof sandbox.library.classifyLyricVocalRole, 'function');
    assert.equal(sandbox.library.keepRefUpg08, true);
  });

  it('resolves simultaneous Lead (v1/lead/default), Duet (v2/duet), and Backing (bg/backing/parenthesized) vocal lanes with per-lane word progress', () => {
    const multiVoiceLines = [
      {
        start_ms: 1000,
        end_ms: 7000,
        voice: 'v1',
        text: 'We rise into the neon night',
        words: [
          { start_ms: 1000, end_ms: 3000, text: 'We rise ' },
          { start_ms: 3000, end_ms: 5000, text: 'into the ' },
          { start_ms: 5000, end_ms: 7000, text: 'neon night' }
        ]
      },
      {
        start_ms: 2500,
        end_ms: 5500,
        voice: 'v2',
        text: 'Side by side in harmony',
        words: [
          { start_ms: 2500, end_ms: 4000, text: 'Side by side ' },
          { start_ms: 4000, end_ms: 5500, text: 'in harmony' }
        ]
      },
      {
        start_ms: 3000,
        end_ms: 5000,
        voice: 'bg',
        text: 'Ooh-ahh choir',
        words: [
          { start_ms: 3000, end_ms: 3800, text: 'Ooh-ahh ' },
          { start_ms: 3800, end_ms: 5000, text: 'choir' }
        ]
      },
      {
        start_ms: 3500,
        end_ms: 6000,
        text: '(ooh... shimmering echo)'
      },
      {
        start_ms: 8000,
        end_ms: 10000,
        text: '(Verse 2) Default lead vocal without explicit voice'
      }
    ];

    assert.equal(lib.classifyLyricVocalRole(multiVoiceLines[0]), 'lead');
    assert.equal(lib.classifyLyricVocalRole(multiVoiceLines[1]), 'duet');
    assert.equal(lib.classifyLyricVocalRole(multiVoiceLines[2]), 'backing');
    assert.equal(lib.classifyLyricVocalRole(multiVoiceLines[3]), 'backing');
    assert.equal(lib.classifyLyricVocalRole(multiVoiceLines[4]), 'lead');

    // 1. Before first line (t = 200ms)
    const before = lib.resolveMultiVoiceLyricLanes(multiVoiceLines, 200);
    assert.equal(before.leadLane, null);
    assert.deepEqual(before.duetLanes, []);
    assert.deepEqual(before.backingLanes, []);
    assert.deepEqual(before.activeLineIndices, []);
    assert.equal(before.hasOverlappingVocals, false);

    // 2. Solo Lead (t = 2000ms -> word 0 [1000..3000], progress 0.5)
    const soloLead = lib.resolveMultiVoiceLyricLanes(multiVoiceLines, 2000);
    assert.equal(soloLead.hasOverlappingVocals, false);
    assert.deepEqual(soloLead.activeLineIndices, [0]);
    assert.ok(soloLead.leadLane);
    assert.equal(soloLead.leadLane.lineIndex, 0);
    assert.equal(soloLead.leadLane.wordIndex, 0);
    assert.ok(Math.abs(soloLead.leadLane.wordProgress - 0.5) < 1e-6);
    assert.deepEqual(soloLead.duetLanes, []);
    assert.deepEqual(soloLead.backingLanes, []);

    // 3. 4-Way Simultaneous Overlap at t = 4400ms:
    // - Lead (idx 0): word 1 ('into the ' [3000..5000]) -> wordProgress = (4400-3000)/2000 = 0.7
    // - Duet (idx 1): word 1 ('in harmony' [4000..5500]) -> wordProgress = (4400-4000)/1500 = 4/15
    // - Backing bg (idx 2): word 1 ('choir' [3800..5000]) -> wordProgress = (4400-3800)/1200 = 0.5
    // - Backing parenthesized (idx 3): no words [3500..6000] -> wordIndex = -1, wordProgress = (4400-3500)/2500 = 0.36
    const overlap = lib.resolveMultiVoiceLyricLanes(multiVoiceLines, 4400);
    assert.equal(overlap.hasOverlappingVocals, true);
    assert.deepEqual(overlap.activeLineIndices, [0, 1, 2, 3]);

    assert.ok(overlap.leadLane);
    assert.equal(overlap.leadLane.role, 'lead');
    assert.equal(overlap.leadLane.lineIndex, 0);
    assert.equal(overlap.leadLane.wordIndex, 1);
    assert.ok(Math.abs(overlap.leadLane.wordProgress - 0.7) < 1e-6);

    assert.equal(overlap.duetLanes.length, 1);
    assert.equal(overlap.duetLanes[0].role, 'duet');
    assert.equal(overlap.duetLanes[0].lineIndex, 1);
    assert.equal(overlap.duetLanes[0].wordIndex, 1);
    assert.ok(Math.abs(overlap.duetLanes[0].wordProgress - (400 / 1500)) < 1e-6);

    assert.equal(overlap.backingLanes.length, 2);
    assert.equal(overlap.backingLanes[0].lineIndex, 2);
    assert.equal(overlap.backingLanes[0].wordIndex, 1);
    assert.ok(Math.abs(overlap.backingLanes[0].wordProgress - 0.5) < 1e-6);
    assert.equal(overlap.backingLanes[1].lineIndex, 3);
    assert.equal(overlap.backingLanes[1].wordIndex, -1);
    assert.ok(Math.abs(overlap.backingLanes[1].wordProgress - 0.36) < 1e-6);
  });

  it('reuses outLanes in-place with zero array/slot reallocation and enriches Listening Room & Fullscreen Karaoke DOM safely', () => {
    const segIdx = lib.createTypedLyricSegmentIndex([
      { start_ms: 1000, end_ms: 5000, voice: 'lead', text: 'Lead vocal' },
      { start_ms: 1500, end_ms: 4500, voice: 'duet', text: 'Duet vocal' },
      { start_ms: 2000, end_ms: 4000, text: '(ooh backing)' }
    ]);

    const outLanes = {};
    const first = lib.resolveMultiVoiceLyricLanes(segIdx, 2500, outLanes);
    assert.strictEqual(first, outLanes);
    const backingArrRef = outLanes.backingLanes;
    const duetArrRef = outLanes.duetLanes;
    const activeIdxArrRef = outLanes.activeLineIndices;
    const leadObjRef = outLanes.leadLane;

    for (let step = 0; step < 500; step++) {
      const t = 1000 + ((step * 37) % 4500);
      const res = lib.resolveMultiVoiceLyricLanes(segIdx, t, outLanes);
      assert.strictEqual(res, outLanes);
      assert.strictEqual(res.backingLanes, backingArrRef);
      assert.strictEqual(res.duetLanes, duetArrRef);
      assert.strictEqual(res.activeLineIndices, activeIdxArrRef);
    }
    const checkAgain = lib.resolveMultiVoiceLyricLanes(segIdx, 2600, outLanes);
    assert.strictEqual(checkAgain.leadLane, leadObjRef);

    // Verify index.html Listening Room & Fullscreen Karaoke lane enrichment preserves single .lyric-line-active
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const renderStart = html.indexOf('function renderLyrics(');
    const displayStart = html.indexOf('function displayTrack(', renderStart);
    assert.ok(renderStart > 0 && displayStart > renderStart);
    const snippet = html.slice(renderStart, displayStart);

    const makeEl = tag => {
      const classes = new Set();
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        dataset: {},
        style: {},
        children: [],
        listeners: {},
        classList: {
          add: c => classes.add(c),
          remove: c => classes.delete(c),
          toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
          contains: c => classes.has(c)
        },
        appendChild(ch) { this.children.push(ch); return ch; },
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
        querySelectorAll(sel) {
          if (sel === '.lyric-line') return this.children.filter(c => c.classList.contains('lyric-line'));
          if (sel === '.fs-lyric-line') return this.children.filter(c => String(c.className).includes('fs-lyric-line'));
          return [];
        },
        getBoundingClientRect() { return { top: 10, bottom: 38, left: 0, right: 200, width: 200, height: 28 }; },
        scrollIntoView() {}
      };
    };

    const roomContainer = makeEl('div');
    const fsContainer = makeEl('div');
    const stateStub = { lyrics: [], lyricIndex: -1 };
    const audioStub = { currentTime: 12.5, duration: 180 };
    const fns = new Function(
      'state', '$', 'library', 'audio', 'document', 'updatePositionState',
      `${snippet}\nreturn { renderLyrics, renderFullscreenLyrics, updateLyricsHighlight };`
    )(
      stateStub,
      id => (id === 'room-lyrics' ? roomContainer : (id === 'fullscreen-lyrics-scroll' ? fsContainer : null)),
      lib,
      audioStub,
      { createElement: makeEl, createTextNode: txt => ({ textContent: txt }) },
      () => {}
    );

    // Same-timestamp lead + parenthesized backing vocal in LRC
    fns.renderLyrics('[00:10.00]Lead chorus vocal\n[00:10.00](ooh backing harmony)\n[00:16.00]Next verse');
    assert.equal(roomContainer.children.length, 3);
    assert.equal(fsContainer.children.length, 3);
    assert.equal(roomContainer.children[0].dataset.vocalLane, 'lead');
    assert.equal(roomContainer.children[1].dataset.vocalLane, 'backing');

    fns.updateLyricsHighlight();
    // Exactly 1 row has .lyric-line-active (index 1), while overlapping rows carry vocal lane classes/attributes!
    const activeRows = roomContainer.children.filter(r => r.classList.contains('lyric-line-active'));
    assert.equal(activeRows.length, 1);
    assert.equal(roomContainer.children[1].classList.contains('lyric-line-backing'), true);
    assert.equal(roomContainer.children[0].classList.contains('lyric-line-overlap-active'), true);
    assert.equal(roomContainer.children[0].dataset.vocalOverlap, 'true');
    assert.equal(roomContainer.children[1].dataset.vocalOverlap, 'true');
    assert.equal(fsContainer.children[1].classList.contains('lyric-line-backing'), true);
    assert.equal(fsContainer.children[0].style.opacity, '0.88');
  });
});

describe('Autonomy Tail-Chaining Cycle 23 — OPT-08 (Shared Global TypedLyricBufferPool Coordinator across Lyric Reader & 60fps Visualizer)', () => {
  it('exposes OPT-08 getSharedLyricSegmentCoordinator on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.getSharedLyricSegmentCoordinator, 'function');

    const c1 = lib.getSharedLyricSegmentCoordinator();
    const c2 = lib.getSharedLyricSegmentCoordinator();
    assert.strictEqual(c1, c2, 'Default coordinator must be a singleton shared across modules');

    const sandbox = { library: { keepRefOpt08: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.getSharedLyricSegmentCoordinator, 'function');
    assert.equal(typeof sandbox.library.getSharedLyricSegmentCoordinator, 'function');
    assert.equal(sandbox.library.keepRefOpt08, true);
  });

  it('guarantees compileCount === 1 across 500 interleaved 60fps Visualizer + rapid-seek Lyric Reader queries on the same track', () => {
    const coord = lib.getSharedLyricSegmentCoordinator({ reset: true });
    const scratchpad = lib.createZeroAllocFrameScratchpad(256);
    assert.strictEqual(scratchpad.lyricCoordinator, coord);

    const trackLines = Array.from({ length: 420 }, (_, i) => {
      const start = i * 600;
      const end = start + (i % 7 === 0 ? 1100 : 540);
      return {
        start_ms: start,
        end_ms: end,
        voice: i % 7 === 0 ? 'backing' : (i % 11 === 0 ? 'duet' : 'lead'),
        text: i % 7 === 0 ? `(Harmony ${i})` : `Verse line ${i}`,
        words: [
          { start_ms: start, end_ms: start + 250, text: 'Alpha ' },
          { start_ms: start + 250, end_ms: end, text: 'Beta' }
        ]
      };
    });

    const outLanes = {};
    for (let i = 0; i < 500; i++) {
      // Simulate rapid arbitrary seek scrubbing + 60fps Visualizer + Multi-Voice lane sync on the exact same trackLines
      const seekTimeMs = ((i * 7919) % 250000);
      if (i % 3 === 0) {
        const tel = scratchpad.syncLyricsInPlace(trackLines, seekTimeMs);
        assert.ok(tel.activeLyricLine >= 0 && tel.activeLyricLine < 420);
      } else if (i % 3 === 1) {
        const bin = lib.findActiveLyricStateBinary(trackLines, seekTimeMs);
        assert.ok(bin.lineIndex >= 0 && bin.lineIndex < 420);
      } else {
        const lanes = lib.resolveMultiVoiceLyricLanes(trackLines, seekTimeMs, outLanes);
        assert.strictEqual(lanes, outLanes);
      }
    }

    const stats = coord.getStats();
    assert.equal(stats.compileCount, 1, 'Track must compile TypedLyricSegmentIndex exactly once across 500 interleaved queries');
    assert.equal(stats.hitCount, 499, 'Remaining 499 queries must hit the pre-compiled segment index in O(1)');
    assert.equal(coord.getTrackCompileCount(trackLines), 1);
  });

  it('reuses identical backing ArrayBuffers when switching to smaller/equal-size tracks and preserves accuracy on revisit', () => {
    const coord = lib.getSharedLyricSegmentCoordinator({ isolated: true, initialLineCapacity: 512, initialWordCapacity: 2048 });
    const pad = lib.createZeroAllocFrameScratchpad(128, { lyricCoordinator: coord });

    const trackLarge = Array.from({ length: 480 }, (_, i) => ({
      start_ms: 1000 + i * 500,
      end_ms: 1000 + i * 500 + 450,
      voice: 'lead',
      text: `Large track line ${i}`,
      words: [
        { start_ms: 1000 + i * 500, end_ms: 1000 + i * 500 + 220, text: 'One ' },
        { start_ms: 1000 + i * 500 + 220, end_ms: 1000 + i * 500 + 450, text: 'Two' }
      ]
    }));

    const trackSmaller = Array.from({ length: 180 }, (_, i) => ({
      start_ms: 5000 + i * 1000,
      end_ms: 5000 + i * 1000 + 900,
      voice: i % 5 === 0 ? 'v2' : 'v1',
      text: `Smaller track line ${i}`,
      words: [
        { start_ms: 5000 + i * 1000, end_ms: 5000 + i * 1000 + 900, text: 'Solo' }
      ]
    }));

    const trackEqual = Array.from({ length: 480 }, (_, i) => ({
      start_ms: 2000 + i * 400,
      end_ms: 2000 + i * 400 + 380,
      text: `Equal track line ${i}`,
      words: [
        { start_ms: 2000 + i * 400, end_ms: 2000 + i * 400 + 190, text: 'Left ' },
        { start_ms: 2000 + i * 400 + 190, end_ms: 2000 + i * 400 + 380, text: 'Right' }
      ]
    }));

    // 1. Compile Track 1 (480 lines, 960 words <= initial 512/2048 pool)
    const idx1 = coord.acquireIndex(trackLarge);
    const startBufRef = idx1.startMs.buffer;
    const endBufRef = idx1.endMs.buffer;
    const treeBufRef = idx1.maxEndSubtreeMs.buffer;
    const orderBufRef = idx1.sortedOrder.buffer;
    const wordStartBufRef = idx1.wordStartMs.buffer;
    const wordEndBufRef = idx1.wordEndMs.buffer;
    const allocCount1 = coord.pool.allocationCount;

    assert.equal(pad.syncLyricsInPlace(trackLarge, 1000 + 10 * 500 + 100).activeLyricLine, 10);
    assert.equal(coord.compileCount, 1);

    // 2. Switch to smaller Track 2 (180 lines) -> zero ArrayBuffer allocations, exact same backing buffers!
    const idx2 = coord.acquireIndex(trackSmaller);
    assert.equal(idx2.lineCount, 180);
    assert.strictEqual(idx2.startMs.buffer, startBufRef);
    assert.strictEqual(idx2.endMs.buffer, endBufRef);
    assert.strictEqual(idx2.maxEndSubtreeMs.buffer, treeBufRef);
    assert.strictEqual(idx2.sortedOrder.buffer, orderBufRef);
    assert.strictEqual(idx2.wordStartMs.buffer, wordStartBufRef);
    assert.strictEqual(idx2.wordEndMs.buffer, wordEndBufRef);
    assert.equal(coord.pool.allocationCount, allocCount1);
    assert.equal(coord.trackSwitchCount, 1);
    assert.equal(lib.findActiveLyricStateBinary(trackSmaller, 5000 + 25 * 1000 + 200, { coordinator: coord }).lineIndex, 25);

    // 3. Switch to equal-size Track 3 (480 lines) -> still zero ArrayBuffer allocations!
    const idx3 = coord.acquireIndex(trackEqual);
    assert.equal(idx3.lineCount, 480);
    assert.strictEqual(idx3.startMs.buffer, startBufRef);
    assert.strictEqual(idx3.wordStartMs.buffer, wordStartBufRef);
    assert.equal(coord.pool.allocationCount, allocCount1);
    assert.equal(coord.trackSwitchCount, 2);

    // 4. Switch back to Track 1 -> cleanly re-hydrates shared pool without stale Track 3 timestamps or new ArrayBuffers!
    const revisitState = lib.findActiveLyricStateBinary(trackLarge, 1000 + 100 * 500 + 300, { coordinator: coord });
    assert.equal(revisitState.lineIndex, 100);
    assert.equal(revisitState.activeLine.text, 'Large track line 100');
    assert.equal(revisitState.wordIndex, 1);
    assert.equal(coord.pool.allocationCount, allocCount1);
  });
});

describe('Autonomy Tail-Chaining Cycle 24 — BUG-09 (Queue Lyrics Preload Lifecycle Controller: Offline & Queue-Clear Cancellation)', () => {
  it('exposes BUG-09 createPreloadLifecycleController on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createPreloadLifecycleController, 'function');

    const sandbox = { library: { keepRefBug09: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createPreloadLifecycleController, 'function');
    assert.equal(typeof sandbox.library.createPreloadLifecycleController, 'function');
    assert.equal(sandbox.library.keepRefBug09, true);
  });

  it('cancels pending stagger/debounce timers & aborts in-flight AbortControllers immediately on offline and queue_cleared with 0 dangling timers', async () => {
    let nextTimerId = 1;
    const liveTimers = new Map();
    const setTimeoutFake = (fn, ms) => {
      const id = nextTimerId++;
      liveTimers.set(id, { fn, ms });
      return id;
    };
    const clearTimeoutFake = (id) => {
      liveTimers.delete(id);
    };

    const eventListeners = {};
    const mockWindow = {
      addEventListener(type, fn) { (eventListeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) {
        if (!eventListeners[type]) return;
        eventListeners[type] = eventListeners[type].filter(f => f !== fn);
      },
      emit(type) { (eventListeners[type] || []).forEach(fn => fn({ type })); }
    };

    const ctrl = lib.createPreloadLifecycleController({
      setTimeout: setTimeoutFake,
      clearTimeout: clearTimeoutFake,
      eventTarget: mockWindow,
      delayMs: 3000,
      staggerMs: 400
    });

    const queue = [
      { id: 'cur', title: 'Now Playing', lyricsText: '[00:01.00]Current' },
      { id: 'q1', title: 'Upcoming One' },
      { id: 'q2', title: 'Upcoming Two' }
    ];

    let executedIds = [];
    const targets = lib.scheduleQueueLyricsPreload(queue, 'cur', {
      maxPreload: 2,
      lifecycleController: ctrl,
      staggerMs: 400,
      onPreloadTrack: (track) => { executedIds.push(track.id); }
    });
    assert.equal(targets.length, 2);
    assert.equal(ctrl.pendingTimerCount, 2);
    assert.equal(liveTimers.size, 2);

    // 1. User clears playback queue BEFORE 3000ms timer fires -> instant clearTimeout, 0 dangling timers!
    const clearRes = ctrl.cancelAll('queue_cleared');
    assert.equal(clearRes.reason, 'queue_cleared');
    assert.equal(clearRes.cancelledTimers, 2);
    assert.equal(clearRes.abortedControllers, 1);
    assert.equal(ctrl.pendingTimerCount, 0);
    assert.equal(ctrl.activeControllerCount, 0);
    assert.equal(liveTimers.size, 0, 'Must leave 0 dangling timers after queue_cleared');
    assert.deepEqual(executedIds, []);

    // 2. Schedule another preload batch, fire first staggered timer so an async fetch is in-flight, then transition OFFLINE!
    let inFlightSignal = null;
    let resolveInFlight = null;
    const batch2 = ctrl.scheduleBatch(
      [{ id: 'q3', title: 'Track Three' }, { id: 'q4', title: 'Track Four' }],
      (track, ctx) => {
        executedIds.push(track.id);
        inFlightSignal = ctx.signal;
        return new Promise((resolve) => { resolveInFlight = resolve; });
      },
      { delayMs: 3000, staggerMs: 500 }
    );
    assert.equal(batch2.scheduled, true);
    assert.equal(liveTimers.size, 2);

    // Fire only the first timer (q3 enters in-flight network request; q4 timer is still pending!)
    const [firstTimerId, firstTimerObj] = liveTimers.entries().next().value;
    liveTimers.delete(firstTimerId);
    firstTimerObj.fn();

    assert.deepEqual(executedIds, ['q3']);
    assert.equal(liveTimers.size, 1, 'Second staggered timer is still waiting');
    assert.ok(inFlightSignal && inFlightSignal.aborted === false);

    // Browser transitions offline -> cancels remaining timer AND aborts in-flight fetch immediately!
    mockWindow.emit('offline');
    assert.equal(ctrl.isOnline(), false);
    assert.equal(liveTimers.size, 0, 'Remaining stagger timer must be cancelled immediately on offline');
    assert.equal(ctrl.pendingTimerCount, 0);
    assert.equal(ctrl.activeControllerCount, 0);
    assert.equal(inFlightSignal.aborted, true, 'In-flight preload AbortSignal must abort immediately on offline');
    assert.equal(inFlightSignal.reason, 'offline');
    if (resolveInFlight) resolveInFlight();
  });

  it('enforces offline guard (skips scheduling while offline) and automatically resumes when online returns + verifies index.html wiring', async () => {
    let nextId = 100;
    const timers = new Map();
    const ctrl = lib.createPreloadLifecycleController({
      setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, fn); return id; },
      clearTimeout: (id) => { timers.delete(id); },
      delayMs: 1000
    });

    const queue = [
      { id: 'now', title: 'Playing', lyricsText: '[00:01.00]Lyrics' },
      { id: 'next1', title: 'Offline Candidate' }
    ];

    // Switch offline
    ctrl.onOffline('offline');
    assert.equal(ctrl.isOnline(), false);

    let networkCalls = 0;
    const skippedTargets = lib.scheduleQueueLyricsPreload(queue, 'now', {
      lifecycleController: ctrl,
      onPreloadTrack: () => { networkCalls++; }
    });
    assert.deepEqual(skippedTargets, []);
    assert.equal(timers.size, 0, 'Must create 0 timers while offline');
    assert.equal(networkCalls, 0);

    const directSkipped = ctrl.scheduleBatch([{ id: 'next1' }], () => { networkCalls++; });
    assert.equal(directSkipped.scheduled, false);
    assert.equal(directSkipped.skippedReason, 'offline');
    assert.equal(timers.size, 0);

    // Return online -> automatically resumes eligibility!
    ctrl.onOnline();
    assert.equal(ctrl.isOnline(), true);

    const resumedTargets = lib.scheduleQueueLyricsPreload(queue, 'now', {
      lifecycleController: ctrl,
      onPreloadTrack: () => { networkCalls++; }
    });
    assert.equal(resumedTargets.length, 1);
    assert.equal(resumedTargets[0].id, 'next1');
    assert.equal(timers.size, 1);

    // Run scheduled timer to completion -> 0 dangling timers & 0 active controllers afterward
    const [tid, tfn] = timers.entries().next().value;
    timers.delete(tid);
    tfn();
    assert.equal(networkCalls, 1);
    assert.equal(ctrl.pendingTimerCount, 0);
    assert.equal(ctrl.activeControllerCount, 0);

    // Verify index.html wiring for queue-clear, offline, online & audio graph invariant
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.includes('createPreloadLifecycleController'), 'index.html must wire createPreloadLifecycleController');
    assert.ok(html.includes("lyricsPreloadLifecycle.cancelAll('queue_cleared')"), 'index.html must cancel preload on queue_cleared');
    assert.ok(html.includes("lyricsPreloadLifecycle.onOffline('offline')"), 'index.html must cancel preload on offline');
    assert.ok(html.includes('lyricsPreloadLifecycle.onOnline()'), 'index.html must resume preload eligibility on online');
    assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  });
});

describe('Autonomy Tail-Chaining Cycle 25 — UPG-09 (Batch PoW SHA-256 Progress Telemetry & Instant Abort in Lyric Editor V2)', () => {
  it('exposes UPG-09 PoW progress & abort helpers on module.exports, window.NocturneLibrary, window.library, and LyricsEditorUI', () => {
    assert.equal(typeof lib.estimatePowTargetExpectedHashes, 'function');
    assert.equal(typeof lib.formatPowProgressStatus, 'function');
    assert.equal(typeof lib.createPowProgressController, 'function');

    const sandbox = { library: { keepRefUpg09: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.estimatePowTargetExpectedHashes, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.formatPowProgressStatus, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.createPowProgressController, 'function');
    assert.equal(typeof sandbox.library.createPowProgressController, 'function');
    assert.equal(sandbox.library.keepRefUpg09, true);

    const LyricsEditorUI = require(path.join(ROOT, 'lyrics-editor-ui.js'));
    assert.equal(typeof LyricsEditorUI.editorPublishToLrclib, 'function');
    assert.equal(typeof LyricsEditorUI.editorCancelPowSolve, 'function');
    assert.equal(typeof LyricsEditorUI.ensureEditorPowController, 'function');
  });

  it('computes accurate expected PoW hashes and formats live batch hash-rate/nonce telemetry across stages', () => {
    // 000fffff... -> probability ~ 1/4096 -> expectedHashes ~ 4096
    const target4k = '000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const est4k = lib.estimatePowTargetExpectedHashes(target4k);
    assert.ok(est4k >= 4000 && est4k <= 4200, `Expected ~4096 hashes for 000fffff..., got ${est4k}`);

    const reqStatus = lib.formatPowProgressStatus({ stage: 'requesting_challenge' });
    assert.equal(reqStatus.percent, 8);
    assert.equal(reqStatus.canCancel, true);
    assert.ok(reqStatus.statusText.includes('LRCLIB'));

    const solveKh = lib.formatPowProgressStatus({
      stage: 'solving',
      nonce: 12480,
      iterations: 12480,
      hashRateHps: 85400,
      elapsedMs: 146,
      batchIndex: 12,
      expectedHashes: 16384
    });
    assert.equal(solveKh.canCancel, true);
    assert.ok(solveKh.percent > 10 && solveKh.percent <= 92);
    assert.equal(solveKh.nonceFormatted, '12,480');
    assert.equal(solveKh.hashRateFormatted, '85.4 kH/s');
    assert.ok(solveKh.statusText.includes('lô #12'));
    assert.ok(solveKh.metricsText.includes('Nonce #12,480'));
    assert.ok(solveKh.metricsText.includes('85.4 kH/s'));

    const solveMh = lib.formatPowProgressStatus({
      stage: 'solving',
      nonce: 1500000,
      iterations: 1500000,
      hashRateHps: 2450000,
      elapsedMs: 612,
      batchIndex: 30
    });
    assert.equal(solveMh.hashRateFormatted, '2.45 MH/s');

    const pubStatus = lib.formatPowProgressStatus({ stage: 'publishing', nonce: 19000, elapsedMs: 210 });
    assert.equal(pubStatus.percent, 96);
    assert.equal(pubStatus.canCancel, true);

    const doneStatus = lib.formatPowProgressStatus({ stage: 'completed', nonce: 19000, elapsedMs: 250 });
    assert.equal(doneStatus.percent, 100);
    assert.equal(doneStatus.canCancel, false);

    const abortStatus = lib.formatPowProgressStatus({ stage: 'aborted', lastPercent: 48 });
    assert.equal(abortStatus.percent, 48);
    assert.equal(abortStatus.canCancel, false);
    assert.ok(abortStatus.statusText.includes('hủy'));
  });

  it('aborts PoW mid-solve instantaneously with 0 dangling Workers/timers and prevents /api/publish call', async () => {
    const LrclibClient = require(path.join(ROOT, 'lrclib-client.js'));
    const impossibleTarget = '0000000000000000000000000000000000000000000000000000000000000000';
    const updates = [];

    // 1. Test createPowProgressController + inline Blob Worker instant termination
    const createdWorkers = [];
    class FakePowWorker {
      constructor(url) {
        this.url = url;
        this.terminated = false;
        this.onmessage = null;
        this.onerror = null;
        this._listeners = {};
        this._timer = null;
        createdWorkers.push(this);
      }
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
      postMessage(msg) {
        if (msg && msg.type === 'abort') {
          if (this._timer) { clearTimeout(this._timer); this._timer = null; }
          return;
        }
        if (msg && msg.type === 'solve') {
          let batch = 0;
          const step = () => {
            if (this.terminated) return;
            batch++;
            const ev = {
              data: {
                type: 'progress',
                iterations: batch * 512,
                nonce: batch * 512,
                elapsedMs: batch * 6,
                hashRateHps: 85333,
                batchIndex: batch,
                maxIterations: msg.maxIterations
              }
            };
            if (this.onmessage) this.onmessage(ev);
            (this._listeners.message || []).forEach(fn => fn(ev));
            if (!this.terminated) {
              this._timer = setTimeout(step, 1);
            }
          };
          this._timer = setTimeout(step, 1);
        }
      }
      terminate() {
        this.terminated = true;
        if (this._timer) {
          clearTimeout(this._timer);
          this._timer = null;
        }
      }
    }

    const revokedUrls = [];
    const runner = lib.createLrclibPowWorkerRunner({
      Worker: FakePowWorker,
      Blob: class FakeBlob { constructor(parts) { this.parts = parts; } },
      URL: {
        createObjectURL: () => 'blob:nocturne-pow-upg09',
        revokeObjectURL: (u) => revokedUrls.push(u)
      }
    });

    const powCtrl = lib.createPowProgressController({
      workerRunner: runner,
      onUpdate(snap) { updates.push(snap); }
    });

    await assert.rejects(
      () => powCtrl.solveChallenge('upg09_prefix_', impossibleTarget, {
        batchSize: 512,
        maxIterations: 500000,
        onProgress(snap) {
          if (snap.batchIndex >= 3) {
            powCtrl.abort('instant_cancel_btn');
          }
        }
      }),
      err => err && err.name === 'AbortError'
    );

    assert.equal(revokedUrls.length, 1, 'Worker Blob URL must be revoked immediately');
    assert.equal(createdWorkers.length, 1);
    assert.equal(createdWorkers[0].terminated, true, 'Worker must be terminated immediately on abort');
    assert.equal(createdWorkers[0]._timer, null, 'Must leave 0 dangling timers inside terminated worker');
    assert.equal(runner.getActiveWorkerCount(), 0, 'Active worker count must drop to 0 immediately');
    assert.equal(powCtrl.isRunning(), false);
    assert.equal(powCtrl.getSnapshot().stage, 'aborted');
    assert.ok(updates.some(u => u.stage === 'solving' && u.batchIndex >= 3 && u.hashRateHps > 0));

    // 2. Test LrclibClient.publishLyrics end-to-end with onProgress + mid-solve AbortSignal
    const outboundUrls = [];
    const clientAbort = new AbortController();
    let publishProgressCount = 0;
    const client = new LrclibClient.LrclibClient({
      minSpacingMs: 0,
      fetch: async (url) => {
        outboundUrls.push(url);
        if (url.includes('/api/request-challenge')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ prefix: 'lrclib_live_abort_', target: impossibleTarget })
          };
        }
        if (url.includes('/api/publish')) {
          return {
            ok: true,
            status: 201,
            headers: { get: () => null },
            json: async () => ({ success: true })
          };
        }
        return { ok: false, status: 404, headers: { get: () => null } };
      }
    });

    await assert.rejects(
      () => client.publishLyrics(
        {
          trackName: 'Abort Test Track',
          artistName: 'Nocturne Artist',
          duration: 200,
          syncedLyrics: '[00:01.00]Line'
        },
        {
          signal: clientAbort.signal,
          batchSize: 64,
          maxIterations: 500000,
          onProgress(p) {
            publishProgressCount++;
            assert.equal(typeof p.nonce, 'number');
            assert.equal(typeof p.hashRateHps, 'number');
            assert.equal(typeof p.elapsedMs, 'number');
            if (publishProgressCount >= 2) {
              clientAbort.abort('user_aborted_publish');
            }
          }
        }
      ),
      err => err && err.name === 'AbortError'
    );

    assert.ok(publishProgressCount >= 2, 'publishLyrics must emit batch onProgress telemetry before abort');
    assert.equal(outboundUrls.length, 1, 'Must call /api/request-challenge only and NEVER call /api/publish after abort');
    assert.ok(outboundUrls[0].includes('/api/request-challenge'));
  });

  it('wires live PoW progress bar & instant Hủy giải PoW button in LyricsEditorUI modal DOM', async () => {
    // Isolated minimal DOM sandbox for LyricsEditorUI
    const byId = new Map();
    class SimpleEl {
      constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.id = '';
        this.children = [];
        this.dataset = {};
        this.listeners = {};
        this.disabled = false;
        this.value = '';
        this._text = '';
        this._html = '';
        this._attrs = new Map();
        const cls = new Set();
        this.classList = {
          add: (...n) => n.forEach(x => x && x.split(/\s+/).forEach(p => p && cls.add(p))),
          remove: (...n) => n.forEach(x => x && x.split(/\s+/).forEach(p => p && cls.delete(p))),
          toggle: (n, f) => {
            const on = f === undefined ? !cls.has(n) : Boolean(f);
            if (on) cls.add(n); else cls.delete(n);
          },
          contains: n => cls.has(n)
        };
        this.style = {
          width: '0%',
          _m: new Map(),
          setProperty(k, v) { this._m.set(k, String(v)); if (k === 'width') this.width = String(v); },
          removeProperty(k) { this._m.delete(k); },
          getPropertyValue(k) { return this._m.get(k) || ''; }
        };
      }
      set className(v) {
        String(v || '').split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      }
      get textContent() { return this.children.length ? this.children.map(c => c.textContent || '').join('') : this._text; }
      set textContent(v) { this.children = []; this._text = String(v); }
      get innerHTML() { return this._html; }
      set innerHTML(v) {
        this._html = String(v);
        this.children = [];
        const tagRe = /<([a-zA-Z0-9_-]+)((?:\s+[a-zA-Z0-9_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
        let m;
        while ((m = tagRe.exec(String(v))) !== null) {
          const child = new SimpleEl(m[1]);
          const attrRe = /([a-zA-Z0-9_-]+)(?:\s*=\s*"([^"]*)")?/g;
          let am;
          while ((am = attrRe.exec(m[2] || '')) !== null) {
            child.setAttribute(am[1], am[2] || '');
          }
          this.appendChild(child);
        }
      }
      setAttribute(k, v) {
        this._attrs.set(k, String(v));
        if (k === 'id') { this.id = String(v); byId.set(this.id, this); }
        else if (k === 'class') this.className = v;
      }
      getAttribute(k) { return this._attrs.get(k) ?? null; }
      appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c; }
      removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
      addEventListener(t, h) { (this.listeners[t] ||= []).push(h); }
      removeEventListener(t, h) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter(x => x !== h); }
      click() { (this.listeners.click || []).forEach(h => h({ type: 'click', target: this, stopPropagation() {} })); }
      querySelector(sel) { return sel.startsWith('#') ? (byId.get(sel.slice(1)) || null) : null; }
      querySelectorAll() { return []; }
    }

    const bodyEl = new SimpleEl('body');
    const uiSandbox = {
      NocturneLibrary: lib,
      LrclibClient: require(path.join(ROOT, 'lrclib-client.js')),
      AbortController,
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
      clearInterval: () => {},
      console,
      document: {
        readyState: 'complete',
        body: bodyEl,
        createElement: tag => new SimpleEl(tag),
        createTextNode: txt => { const t = new SimpleEl('text'); t.textContent = txt; return t; },
        getElementById: id => byId.get(id) || null,
        querySelector: sel => (sel.startsWith('#') ? (byId.get(sel.slice(1)) || null) : null),
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
      }
    };
    uiSandbox.window = uiSandbox;
    uiSandbox.globalThis = uiSandbox;

    const uiCode = fs.readFileSync(path.join(ROOT, 'lyrics-editor-ui.js'), 'utf8');
    vm.runInNewContext(uiCode, uiSandbox);
    const UI = uiSandbox.LyricsEditorUI;

    UI.openEditor(
      { id: 'upg09_t1', title: 'Hi-Res Ballad', artist: 'Nocturne Ensemble', duration: 240 },
      { lines: [{ text: 'First synced line', start_ms: 1000, end_ms: 4000 }] }
    );

    const powPanel = byId.get('lyrics-editor-pow-panel');
    const powStatus = byId.get('lyrics-editor-pow-status');
    const powMetrics = byId.get('lyrics-editor-pow-metrics');
    const powBar = byId.get('lyrics-editor-pow-progress-bar');
    const powCancelBtn = byId.get('lyrics-editor-pow-cancel-btn');
    const publishBtn = byId.get('lyrics-editor-publish-btn');

    assert.ok(powPanel && powStatus && powMetrics && powBar && powCancelBtn && publishBtn);
    assert.equal(powPanel.classList.contains('hidden'), true, 'PoW progress bar starts hidden when idle');

    const impossibleTarget = '0000000000000000000000000000000000000000000000000000000000000000';
    const mockClient = new uiSandbox.LrclibClient.LrclibClient({
      minSpacingMs: 0,
      fetch: async (url) => {
        if (url.includes('/api/request-challenge')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ prefix: 'ui_modal_pow_', target: impossibleTarget })
          };
        }
        return { ok: true, status: 201, headers: { get: () => null }, json: async () => ({ success: true }) };
      }
    });

    let clickedCancel = false;
    const publishPromise = UI.editorPublishToLrclib({
      client: mockClient,
      batchSize: 64,
      maxIterations: 500000,
      onProgress(snap) {
        if (!clickedCancel && snap.batchIndex >= 2) {
          clickedCancel = true;
          assert.equal(powPanel.classList.contains('hidden'), false, 'PoW panel must be visible while solving');
          assert.equal(publishBtn.disabled, true, 'Publish button must be disabled while solving');
          assert.ok(Number(powBar.getAttribute('aria-valuenow')) >= 10, 'Progress bar aria-valuenow must advance');
          assert.ok(powMetrics.textContent.includes('Nonce #'), 'Metrics readout must display live Nonce counter');
          // Click the instant "Hủy giải PoW" button in the modal!
          powCancelBtn.click();
        }
      }
    });

    const publishRes = await publishPromise;
    assert.equal(clickedCancel, true);
    assert.equal(Boolean(publishRes && publishRes.aborted), true);
    assert.equal(publishBtn.disabled, false, 'Publish button must re-enable immediately after abort');
    assert.equal(UI.editorState.lastPowSnapshot.stage, 'aborted');
    assert.ok(powStatus.textContent.includes('hủy'));
    UI.closeEditor();
  });
});

describe('Autonomy Tail-Chaining Cycle 26 — OPT-09 (Chunked Non-Blocking Streaming CRC32+SHA-256 for 50,000+ Track Offline PWA Backups)', () => {
  it('exposes OPT-09 streaming CRC32+SHA-256 & async backup integrity APIs on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.createStreamingCrc32Hasher, 'function');
    assert.equal(typeof lib.createStreamingSha256Hasher, 'function');
    assert.equal(typeof lib.createStreamingDualIntegrityHasher, 'function');
    assert.equal(typeof lib.computeChunkedBackupIntegrityAsync, 'function');
    assert.equal(typeof lib.signConfigurationBundleAsync, 'function');
    assert.equal(typeof lib.verifyConfigurationBundleAsync, 'function');

    const sandbox = { library: { keepRefOpt09: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.createStreamingCrc32Hasher, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.createStreamingSha256Hasher, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.createStreamingDualIntegrityHasher, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.computeChunkedBackupIntegrityAsync, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.signConfigurationBundleAsync, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.verifyConfigurationBundleAsync, 'function');
    assert.equal(typeof sandbox.library.computeChunkedBackupIntegrityAsync, 'function');
    assert.equal(sandbox.library.keepRefOpt09, true);
  });

  it('maintains 100% bit-identical CRC32 + SHA-256 parity across 0B, 55B/56B/64B FIPS block boundaries, 1-byte chunks, odd prime chunks & split astral UTF-16 surrogates', async () => {
    const nodeCrypto = require('node:crypto');
    // 1. Test critical FIPS 180-4 SHA-256 padding boundary lengths with 1-byte & odd-prime splits
    const boundaryLengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 4099];
    for (const len of boundaryLengths) {
      const buf = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buf[i] = (i * 131 + 17) & 0xff;
      }
      const expectedCrc32 = lib.computeCrc32Hex(buf);
      const expectedSha256 = nodeCrypto.createHash('sha256').update(buf).digest('hex');

      // 1-byte streaming up to 256 bytes, prime 7-byte / 13-byte alternating splits for all sizes
      if (len <= 256) {
        const oneByteDual = lib.createStreamingDualIntegrityHasher();
        for (let i = 0; i < len; i++) {
          oneByteDual.update(buf, i, 1);
        }
        const d1 = oneByteDual.digest();
        assert.equal(d1.crc32, expectedCrc32, `1-byte CRC32 mismatch at len=${len}`);
        assert.equal(d1.sha256, expectedSha256, `1-byte SHA-256 mismatch at len=${len}`);
        assert.equal(d1.byteLength, len);
      }

      // Alternating odd-sized prime chunks (7, 13, 61, 3 bytes)
      const primeSizes = [7, 13, 61, 3, 257];
      const chunks = [];
      let pos = 0;
      let pIdx = 0;
      while (pos < len) {
        const step = Math.min(len - pos, primeSizes[pIdx % primeSizes.length]);
        chunks.push(buf.subarray(pos, pos + step));
        pos += step;
        pIdx++;
      }

      const streamed = await lib.computeChunkedBackupIntegrityAsync(chunks, { frameBudgetMs: 4 });
      assert.equal(streamed.crc32, expectedCrc32, `Odd-chunk CRC32 mismatch at len=${len}`);
      assert.equal(streamed.sha256, expectedSha256, `Odd-chunk SHA-256 mismatch at len=${len}`);
      assert.equal(streamed.byteLength, len);
    }

    // 2. Test astral UTF-16 surrogate pairs (🎵🎧🔥) + Vietnamese + CJK sliced at odd UTF-16 code-unit boundaries
    const richUnicode = 'Nhạc Lossless Đêm Khuya 🎵🎧🔥 夜曲 DSD256 '.repeat(250);
    const expectedUtf8Bytes = Buffer.from(richUnicode, 'utf8');
    const expectedUnicodeCrc = lib.computeCrc32Hex(expectedUtf8Bytes);
    const expectedUnicodeSha = nodeCrypto.createHash('sha256').update(expectedUtf8Bytes).digest('hex');

    // chunkByteSize: 19 purposefully lands mid-surrogate-pair repeatedly unless guarded!
    const unicodeRes = await lib.computeChunkedBackupIntegrityAsync(richUnicode, {
      chunkByteSize: 19,
      frameBudgetMs: 2
    });
    assert.equal(unicodeRes.byteLength, expectedUtf8Bytes.byteLength);
    assert.equal(unicodeRes.crc32, expectedUnicodeCrc);
    assert.equal(unicodeRes.sha256, expectedUnicodeSha);
  });

  it('streams 52,000+ track Offline PWA backup bundles with exact single-shot signature parity and cooperative < 8ms frame-budget yielding', async () => {
    const TRACK_COUNT = 52000;
    const tracks = new Array(TRACK_COUNT);
    for (let i = 0; i < TRACK_COUNT; i++) {
      tracks[i] = {
        id: `trk_${i}`,
        title: `Nocturne Symphonic Track ${i}`,
        artist: i % 2 === 0 ? 'Vivaldi Hi-Res Ensemble' : 'FiiO Reference Orchestra',
        duration: 180 + (i % 300),
        format: i % 4 === 0 ? 'DSF' : 'FLAC'
      };
    }

    const largeBundle = {
      appName: 'Nocturne',
      version: 1,
      exportedAt: '2026-11-18T06:00:00.000Z',
      playlists: [
        {
          id: 'pl_audiophile_52k',
          name: '52K Offline Archive',
          tracks
        }
      ],
      settings: {
        limiterMode: 'transparent',
        replayGainEnabled: true,
        crossfeed: 0.25
      }
    };

    // Single-shot baseline signature
    const syncSigned = lib.signConfigurationBundle(largeBundle, {
      signedAt: '2026-11-18T06:00:00.000Z'
    });

    // Deterministic synthetic clock advancing 1.5ms per yield check so cooperative < 8ms frame-budget yielding is exercised deterministically AND fast!
    let fakeClockMs = 1000;
    let yieldInvocations = 0;
    const progressSnapshots = [];

    const asyncSigned = await lib.signConfigurationBundleAsync(largeBundle, {
      signedAt: '2026-11-18T06:00:00.000Z',
      frameBudgetMs: 6,
      flushThresholdChars: 8192,
      nowFn: () => {
        fakeClockMs += 0.35;
        return fakeClockMs;
      },
      yieldFn: async () => {
        yieldInvocations++;
      },
      onProgress(p) {
        progressSnapshots.push(p);
      }
    });

    assert.equal(asyncSigned.integrity.algorithm, 'crc32+sha256');
    assert.equal(asyncSigned.integrity.crc32, syncSigned.integrity.crc32, '52,000-track streaming CRC32 must match single-shot bundle CRC32');
    assert.equal(asyncSigned.integrity.sha256, syncSigned.integrity.sha256, '52,000-track streaming SHA-256 must match single-shot bundle SHA-256');
    assert.equal(asyncSigned.integrity.canonicalByteLength, syncSigned.integrity.canonicalByteLength);
    assert.ok(yieldInvocations > 10, `Must cooperatively yield across slices on 52,000 tracks (yielded ${yieldInvocations} times)`);
    assert.ok(progressSnapshots.length >= yieldInvocations);

    // Cross-verify: sync verifier accepts asyncSigned, and async verifier accepts syncSigned + detects 1-byte tampering!
    const syncVerifyOfAsync = lib.verifyConfigurationBundle(asyncSigned);
    assert.equal(syncVerifyOfAsync.valid, true);
    assert.equal(syncVerifyOfAsync.signed, true);

    const asyncVerifyOfSync = await lib.verifyConfigurationBundleAsync(syncSigned, { frameBudgetMs: 6 });
    assert.equal(asyncVerifyOfSync.valid, true);
    assert.equal(asyncVerifyOfSync.signed, true);

    // Tamper 1 character in track #51,999 -> must fail verification cleanly with checksum_mismatch!
    const origTitle = tracks[51999].title;
    tracks[51999].title = origTitle + '!';
    const tamperedCheck = await lib.verifyConfigurationBundleAsync(asyncSigned, { frameBudgetMs: 6 });
    assert.equal(tamperedCheck.valid, false);
    assert.equal(tamperedCheck.reason, 'checksum_mismatch');
    tracks[51999].title = origTitle;
  });

  it('aborts chunked 50,000+ stream immediately via AbortSignal with 0 dangling timers', async () => {
    // 1. Pre-aborted signal
    const preCtrl = new AbortController();
    preCtrl.abort('pre_aborted_backup');
    await assert.rejects(
      () => lib.computeChunkedBackupIntegrityAsync([new Uint8Array([1, 2, 3])], { signal: preCtrl.signal }),
      err => err && err.name === 'AbortError'
    );

    // 2. Mid-stream abort during async generator yielding 50,000 chunks
    const midCtrl = new AbortController();
    let yieldedChunks = 0;
    async function* generateLargeBackupChunks() {
      const sample = new Uint8Array(256).fill(0x61);
      for (let i = 0; i < 50000; i++) {
        yieldedChunks++;
        yield sample;
      }
    }

    let clock = 0;
    await assert.rejects(
      () => lib.computeChunkedBackupIntegrityAsync(generateLargeBackupChunks(), {
        signal: midCtrl.signal,
        frameBudgetMs: 5,
        nowFn: () => { clock += 2; return clock; },
        onProgress(p) {
          if (p.yieldCount >= 3) {
            midCtrl.abort('user_cancelled_backup_export');
          }
        }
      }),
      err => err && err.name === 'AbortError'
    );

    assert.ok(yieldedChunks < 500, `Stream must abort early right after signal fires (processed only ${yieldedChunks} of 50,000 chunks)`);
  });
});

describe('Autonomy Tail-Chaining Cycle 27 — BUG-10 (Cycle-Safe DAG-Preserving & IEEE-754 Canonical Config Signing)', () => {
  it('exposes BUG-10 canonicalizeConfigPayloadSafe & normalizeSpecialConfigNumber on module.exports, window.NocturneLibrary, and window.library', () => {
    assert.equal(typeof lib.canonicalizeConfigPayloadSafe, 'function');
    assert.equal(typeof lib.normalizeSpecialConfigNumber, 'function');

    const sandbox = { library: { keepRefBug10: true } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'library-utils.js'), 'utf8');
    vm.runInNewContext(code, sandbox);

    assert.equal(typeof sandbox.NocturneLibrary.canonicalizeConfigPayloadSafe, 'function');
    assert.equal(typeof sandbox.NocturneLibrary.normalizeSpecialConfigNumber, 'function');
    assert.equal(typeof sandbox.library.canonicalizeConfigPayloadSafe, 'function');
    assert.equal(sandbox.library.keepRefBug10, true);
  });

  it('prunes self-references, mutual cycles, array cycles & cyclic toJSON() while strictly preserving shared non-cyclic DAG diamond nodes', () => {
    // 1. Shared non-cyclic DAG diamond (must NOT be pruned as a cycle!)
    const sharedEqBand = { id: 'harman_sub', freq: 65, gain: -0, q: 0.707 };
    const dagBundle = {
      appName: 'Nocturne',
      leftChannelEq: sharedEqBand,
      rightChannelEq: sharedEqBand,
      backupStages: [sharedEqBand, { fallbackRef: sharedEqBand }]
    };

    const dagRes = lib.canonicalizeConfigPayloadSafe(dagBundle);
    assert.equal(dagRes.hasCycles, false, 'Shared DAG diamond must NOT be flagged as a cycle');
    assert.equal(dagRes.stats.prunedCycleCount, 0);
    assert.equal(dagRes.stats.sharedDagReuseCount, 3, '3 shared DAG sibling visits must be counted & preserved');
    assert.deepEqual(dagRes.value.leftChannelEq, { freq: 65, gain: 0, id: 'harman_sub', q: 0.707 });
    assert.deepEqual(dagRes.value.rightChannelEq, { freq: 65, gain: 0, id: 'harman_sub', q: 0.707 });
    assert.deepEqual(dagRes.value.backupStages[0], { freq: 65, gain: 0, id: 'harman_sub', q: 0.707 });
    assert.deepEqual(dagRes.value.backupStages[1].fallbackRef, { freq: 65, gain: 0, id: 'harman_sub', q: 0.707 });
    assert.equal(Object.is(dagRes.value.leftChannelEq.gain, 0), true);
    assert.equal(Object.is(dagRes.value.leftChannelEq.gain, -0), false);

    // 2. True cyclic graphs: self-reference + mutual A<->B cycle + array cycle + self-returning toJSON()
    const nodeA = { name: 'EQ Stage A', gainDb: 3.5 };
    const nodeB = { name: 'EQ Stage B', gainDb: -1.5, prev: nodeA };
    nodeA.next = nodeB; // Mutual cycle: nodeA.next.prev === nodeA
    nodeA.self = nodeA; // Direct self-reference

    const cyclicToJson = {
      label: 'rogue',
      toJSON() { return this; }
    };

    const cyclicPlaylist = { id: 'pl_cyclic', name: 'Cyclic Mix', tracks: [{ id: 't1', title: 'Track 1' }] };
    cyclicPlaylist.tracks.push(cyclicPlaylist); // Array back-edge cycle

    const cyclicRoot = {
      appName: 'Nocturne',
      eqGraph: nodeA,
      playlists: [cyclicPlaylist],
      rogue: cyclicToJson
    };

    const cycRes = lib.canonicalizeConfigPayloadSafe(cyclicRoot);
    assert.equal(cycRes.hasCycles, true);
    assert.ok(cycRes.stats.prunedCycleCount >= 4, `Expected >= 4 pruned cyclic back-edges, got ${cycRes.stats.prunedCycleCount}`);
    assert.equal('self' in cycRes.value.eqGraph, false, 'Cyclic object property must be omitted cleanly by default');
    assert.equal('prev' in cycRes.value.eqGraph.next, false, 'Mutual cyclic back-edge must be omitted cleanly');
    assert.equal(cycRes.value.eqGraph.next.name, 'EQ Stage B', 'Non-cyclic fields of nodeB must be preserved');
    assert.equal(cycRes.value.playlists[0].tracks[0].title, 'Track 1');
    assert.equal(cycRes.value.playlists[0].tracks[1], null, 'Cyclic array element must be replaced with null');
    assert.equal('rogue' in cycRes.value, false, 'Self-returning toJSON() cycle must be omitted safely');

    // Sentinel policy option
    const sentinelRes = lib.canonicalizeConfigPayloadSafe(nodeA, { cyclePolicy: 'sentinel' });
    assert.equal(sentinelRes.value.self, '[Circular]');
    assert.equal(sentinelRes.value.next.prev, '[Circular]');

    // Sign -> JSON.stringify -> Verify roundtrip on cyclic graph!
    const signedCyclic = lib.signConfigurationBundle(cyclicRoot, { signedAt: '2026-11-18T06:20:00.000Z' });
    const jsonText = JSON.stringify(signedCyclic, null, 2);
    const verifiedCyclic = lib.verifyConfigurationBundle(jsonText);
    assert.equal(verifiedCyclic.valid, true, 'Signed cyclic bundle must pass CRC32+SHA-256 verification after JSON roundtrip');
    assert.equal(verifiedCyclic.signed, true);
  });

  it('normalizes IEEE-754 -0 -> +0, NaN/±Infinity (null/zero/clamp), BigInt, Map, Set & TypedArray deterministically across library-utils and library-tools', async () => {
    const libraryTools = require(path.join(ROOT, 'library-tools.js'));

    // 1. Verify +0 vs -0 digest & Object.is parity + Map insertion-order independence
    const mapOrder1 = new Map([['zeta', 2.5], ['alpha', -0], ['beta', 100n]]);
    const mapOrder2 = new Map([['beta', 100n], ['zeta', 2.5], ['alpha', +0]]);

    const payloadNegZero = {
      preamp: -0,
      boxedZero: new Number(-0),
      curve: new Float32Array([-0, 1.5, NaN, Infinity, -Infinity]),
      tags: new Set(['audiophile', 'dsd']),
      counter: 9007199254740993n,
      routing: mapOrder1
    };

    const payloadPosZero = {
      routing: mapOrder2,
      counter: '9007199254740993',
      tags: ['audiophile', 'dsd'],
      curve: [0, 1.5, null, null, null],
      boxedZero: 0,
      preamp: +0
    };

    const canonNeg = lib.canonicalizeConfigPayloadSafe(payloadNegZero);
    const canonPos = lib.canonicalizeConfigPayloadSafe(payloadPosZero);

    assert.equal(canonNeg.canonicalJson, canonPos.canonicalJson, '-0, boxed -0, Float32Array, BigInt, Set & Map must canonicalize identically regardless of key order');
    assert.equal(canonNeg.crc32, canonPos.crc32);
    assert.equal(canonNeg.sha256, canonPos.sha256);
    assert.equal(Object.is(canonNeg.value.preamp, 0), true);
    assert.equal(Object.is(canonNeg.value.preamp, -0), false);
    assert.equal(Object.is(canonNeg.value.curve[0], 0), true);
    assert.equal(Object.is(canonNeg.value.curve[0], -0), false);
    assert.ok(canonNeg.stats.normalizedNegZeroCount >= 4);
    assert.equal(canonNeg.stats.normalizedNonFiniteCount, 3);
    assert.equal(canonNeg.stats.normalizedBigIntCount, 2);
    assert.equal(canonNeg.stats.convertedSetCount, 1);
    assert.equal(canonNeg.stats.convertedMapCount, 1);
    assert.equal(canonNeg.stats.convertedTypedArrayCount, 1);

    // 2. Verify nonFinitePolicy: 'clamp' and 'zero'
    const clamped = lib.canonicalizeConfigPayloadSafe(
      { nanVal: NaN, hiVal: Infinity, loVal: -Infinity, negZero: -0 },
      { nonFinitePolicy: 'clamp', clampNan: 0, clampMax: 24, clampMin: -24 }
    );
    assert.deepEqual(clamped.value, { hiVal: 24, loVal: -24, nanVal: 0, negZero: 0 });
    assert.equal(Object.is(clamped.value.negZero, 0), true);

    const zeroed = lib.canonicalizeConfigPayloadSafe(
      { a: NaN, b: Infinity, c: -Infinity },
      { nonFinitePolicy: 'zero' }
    );
    assert.deepEqual(zeroed.value, { a: 0, b: 0, c: 0 });

    // 3. Verify sync & async bundle signing roundtrip on exotic types (Set, Map, Float32Array, BigInt, -0)
    const syncSignedExotic = lib.signConfigurationBundle(payloadNegZero, { signedAt: '2026-11-18T06:22:00.000Z' });
    const asyncSignedExotic = await lib.signConfigurationBundleAsync(payloadNegZero, { signedAt: '2026-11-18T06:22:00.000Z' });
    assert.deepEqual(asyncSignedExotic.integrity, syncSignedExotic.integrity);
    const exoticJson = JSON.stringify(syncSignedExotic);
    const exoticVerify = lib.verifyConfigurationBundle(exoticJson);
    assert.equal(exoticVerify.valid, true, 'Set/Map/TypedArray/BigInt signed bundle must survive JSON.stringify -> verifyConfigurationBundle');

    // 4. Verify libraryTools.exportUserSettings & importUserSettings with cyclic EQ presets, -0, NaN/Infinity, BigInt, Map, Float32Array & optional signing
    const cyclicPreset = {
      id: 42n,
      name: 'Cyclic Harman Curve',
      gains: new Float32Array([-0, 3.5, NaN, Infinity]),
      extraMap: new Map([['headphone', 'HD800S']])
    };
    cyclicPreset.parentPreset = cyclicPreset;

    const sharedBand = { id: 'shared_1', freq: 100, gain: -0, q: 0.7 };
    const exoticState = {
      eqEnabled: true,
      eqPreamp: -0,
      bands: [sharedBand, { id: 2n, freq: NaN, gain: Infinity, q: -Infinity }],
      eqPresets: [cyclicPreset, { id: 'dag_copy', refA: sharedBand, refB: sharedBand }],
      favorites: new Set(['trk_a', 'trk_b']),
      trackRatings: new Map([['trk_a', 5], ['trk_b', 4]]),
      toneBass: -0,
      roomAcousticWet: NaN,
      subBassPunchIntensity: Infinity
    };

    const exportedJson = libraryTools.exportUserSettings(exoticState, {
      sign: true,
      exportedAt: '2026-11-18T06:25:00.000Z'
    });
    const parsedSettings = JSON.parse(exportedJson);
    assert.equal(parsedSettings.integrity.algorithm, 'crc32+sha256');
    assert.equal(lib.verifyConfigurationBundle(exportedJson).valid, true);
    assert.equal('parentPreset' in parsedSettings.peq.presets[0], false, 'Cyclic preset back-edge must be pruned');
    assert.equal(parsedSettings.peq.presets[0].id, '42');
    assert.deepEqual(parsedSettings.peq.presets[0].gains, [0, 3.5, null, null]);
    assert.deepEqual(parsedSettings.peq.presets[1].refA, parsedSettings.peq.presets[1].refB, 'Shared DAG nodes in presets must be preserved');

    const restoredTarget = {};
    const importOk = libraryTools.importUserSettings(exportedJson, restoredTarget, { persist: false });
    assert.equal(importOk.isValid, true);
    assert.equal(restoredTarget.trackRatings.trk_a, 5);

    // Tamper signed settings JSON -> importUserSettings rejects with checksum mismatch!
    parsedSettings.playbackPreferences.toneBass = 9;
    const importTampered = libraryTools.importUserSettings(JSON.stringify(parsedSettings), {}, { persist: false });
    assert.equal(importTampered.isValid, false);
    assert.equal(importTampered.reason, 'checksum_mismatch');
  });
});

describe('Autonomy Tail-Chaining Cycle 28 — UPG-10 (Live Zero-Alloc FPS, p99 Frame-Time & Render Backend Telemetry)', () => {
  it('exposes createVisualizerFpsMonitor & formatVisualizerRenderTelemetry on UMD exports and ZeroAllocFrameScratchpad', () => {
    assert.equal(typeof lib.createVisualizerFpsMonitor, 'function');
    assert.equal(typeof lib.formatVisualizerRenderTelemetry, 'function');

    const pad = lib.createZeroAllocFrameScratchpad(256);
    assert.ok(pad.fpsMonitor && typeof pad.fpsMonitor.recordFrame === 'function');
    assert.equal(
      lib.formatVisualizerRenderTelemetry(null),
      '-- FPS · MainThread2D · Chờ khung hình'
    );
  });

  it('tracks 60fps MainThread2D, 120fps OffscreenWorker, and 22fps DapEcoThrottled cadences with accurate p99Ms & droppedFrames', () => {
    // 1. 60fps MainThread2D desktop cadence
    const mon60 = lib.createVisualizerFpsMonitor({ windowSize: 120 });
    const dt60 = 1000 / 60;
    for (let i = 0; i <= 150; i++) {
      mon60.recordFrame(1000 + i * dt60);
    }
    const snap60 = mon60.getSnapshot();
    assert.equal(snap60.fps, 60);
    assert.equal(snap60.targetFps, 60);
    assert.equal(snap60.backend, 'MainThread2D');
    assert.equal(snap60.renderBackend, 'MainThread2D');
    assert.equal(snap60.droppedFrames, 0);
    assert.ok(Math.abs(snap60.p99Ms - 16.67) < 0.15, `Expected ~16.67ms p99, got ${snap60.p99Ms}`);
    assert.equal(
      lib.formatVisualizerRenderTelemetry(snap60),
      '60 FPS · MainThread2D · p99 16.7ms · Drop 0'
    );

    // 2. 120fps ProMotion / OffscreenWorker cadence
    const mon120 = lib.createVisualizerFpsMonitor({ windowSize: 120, backend: 'OffscreenWorker' });
    const dt120 = 1000 / 120;
    for (let i = 0; i <= 200; i++) {
      mon120.recordFrame(5000 + i * dt120);
    }
    const snap120 = mon120.getSnapshot();
    assert.equal(snap120.fps, 120);
    assert.equal(snap120.targetFps, 120);
    assert.equal(snap120.backend, 'OffscreenWorker');
    assert.equal(snap120.droppedFrames, 0);
    assert.ok(Math.abs(snap120.p99Ms - 8.33) < 0.15, `Expected ~8.33ms p99, got ${snap120.p99Ms}`);
    assert.equal(
      lib.formatVisualizerRenderTelemetry(snap120),
      '120 FPS · OffscreenWorker · p99 8.3ms · Drop 0'
    );

    // 3. 22fps FiiO DAP Eco-throttled cadence (~45.45ms per rendered frame, 0 false dropped frames)
    const monDap = lib.createVisualizerFpsMonitor({ windowSize: 60, dapTargetFps: 22 });
    monDap.updateBackendFlags(false, true);
    const dtDap = 1000 / 22;
    for (let i = 0; i <= 100; i++) {
      monDap.recordEcoSkip();
      monDap.recordEcoSkip();
      monDap.recordFrame(10000 + i * dtDap);
    }
    const snapDap = monDap.getSnapshot();
    assert.equal(snapDap.fps, 22);
    assert.equal(snapDap.targetFps, 22);
    assert.equal(snapDap.backend, 'DapEcoThrottled');
    assert.equal(snapDap.droppedFrames, 0, 'Intentional 45ms DAP Eco intervals must not trigger droppedFrames');
    assert.equal(snapDap.throttledFrames, 202);
    assert.ok(Math.abs(snapDap.p99Ms - 45.45) < 0.2);
    assert.equal(
      lib.formatVisualizerRenderTelemetry(snapDap),
      '22 FPS · DapEcoThrottled · p99 45.5ms · Drop 0'
    );
  });

  it('detects frame hitches in p99Ms & droppedFrames, ignores >2s pause gaps, and preserves zero-allocation references across 1,000 frames', () => {
    const mon = lib.createVisualizerFpsMonitor({ windowSize: 100 });
    const baseSnap = mon.getSnapshot();
    const baseRingBuffer = mon.ringDeltas.buffer;
    const baseSortedBuffer = mon.sortedDeltas.buffer;

    let now = 100;
    mon.recordFrame(now);

    for (let i = 1; i <= 1000; i++) {
      // Inject deterministic hitches near the tail of the 1,000-frame run:
      // frame 960: 50ms (2 missed 60Hz vblanks), frame 980: 66.67ms (3 missed 60Hz vblanks)
      if (i === 500) {
        now += 12000; // 12-second playback pause gap -> must reset cleanly without dropped frames
      } else if (i === 960) {
        now += 50;
      } else if (i === 980) {
        now += 66.67;
      } else {
        now += 16.6667;
      }
      const returned = mon.recordFrame(now);
      assert.equal(returned, baseSnap, 'recordFrame must mutate and return the identical pre-allocated snapshot object');
    }

    assert.equal(mon.getSnapshot(), baseSnap);
    assert.equal(mon.ringDeltas.buffer, baseRingBuffer, 'ringDeltas ArrayBuffer must never reallocate');
    assert.equal(mon.sortedDeltas.buffer, baseSortedBuffer, 'sortedDeltas ArrayBuffer must never reallocate');
    assert.equal(baseSnap.sampleCount, 100);
    assert.equal(baseSnap.droppedFrames, 5, '50ms (2 drops) + 66.67ms (3 drops) must total 5 dropped frames while 12s pause is ignored');
    assert.ok(baseSnap.p99Ms >= 50, `Expected p99Ms >= 50ms from tail hitches, got ${baseSnap.p99Ms}`);

    // Verify sortedDeltas invariant remains strictly non-decreasing after 1,000 ring-buffer wrap-arounds
    for (let k = 1; k < baseSnap.sampleCount; k++) {
      assert.ok(
        mon.sortedDeltas[k] >= mon.sortedDeltas[k - 1],
        `sortedDeltas[${k}] (${mon.sortedDeltas[k]}) must be >= sortedDeltas[${k - 1}] (${mon.sortedDeltas[k - 1]})`
      );
    }
  });

  it('wires #fs-room-fps-badge, #room-fps-badge, Signal Path renderTelemetry, and preserves audio destination invariant in index.html', () => {
    const flacTrack = { format: 'FLAC', sampleRate: 96000, bitDepth: 24, channels: 2, source: 'local', title: 'Nocturne' };
    const mon = lib.createVisualizerFpsMonitor({ backend: 'OffscreenWorker' });
    for (let i = 0; i <= 60; i++) mon.recordFrame(1000 + i * (1000 / 60));

    const sigPath = lib.computeSignalPath(flacTrack, {
      contextRate: 96000,
      renderTelemetry: mon.getSnapshot()
    });
    assert.equal(sigPath.steps.length, 4);
    assert.ok(sigPath.steps[3].detail.includes('60 FPS · OffscreenWorker'));
    assert.ok(sigPath.renderTelemetry.includes('OffscreenWorker'));

    const roonStages = lib.buildRoonSignalPathStages(flacTrack, {
      outputSampleRate: 96000,
      renderTelemetry: mon.getSnapshot()
    });
    assert.equal(roonStages.length, 4);
    assert.ok(roonStages[3].subtext.includes('60 FPS · OffscreenWorker'));

    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('id="fs-room-fps-badge"'), '#fullscreen-stage-room must include #fs-room-fps-badge');
    assert.ok(indexHtml.includes('id="room-fps-badge"'), '#listening-room must include #room-fps-badge');
    assert.ok(indexHtml.includes('id="signal-path-fps-badge"'), '#signal-path-popover must include #signal-path-fps-badge');
    assert.ok(indexHtml.includes('fpsMonitor.recordFrame(frameNowMs)'), 'setVisualizerRunning must record frame timestamps zero-alloc');
    assert.ok(indexHtml.includes('formatVisualizerRenderTelemetry(fpsSnap)'), 'setVisualizerRunning must format live FPS telemetry every 30 frames');
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Audio destination routing invariant must remain intact'
    );
  });
});

describe('Autonomy Tail-Chaining Cycle 29 — OPT-10 (Zero-Alloc Scratchpad Reuse in 3D Acoustic Soundstage Renderer)', () => {
  it('reuses identical outVectors, spatialReport, polarReport & TypedArray references across 1,000 60fps frames', () => {
    const pad = lib.createZeroAllocFrameScratchpad(128);
    assert.ok(pad.soundstageScratch && typeof pad.soundstageScratch === 'object');
    assert.equal(typeof pad.ensureStereoBuffers, 'function');

    const baseStageScratch = pad.soundstageScratch;
    const baseSpatialReport = baseStageScratch.spatialReport;
    const baseSpatialPoints = baseSpatialReport.points;
    const basePolarReport = baseStageScratch.polarReport;
    const basePolarBins = basePolarReport.bins;
    const basePolarBands = basePolarReport.spectralBands;
    const baseVuLeft = baseStageScratch.vuLeft;
    const baseLeftTimeBuf = pad.leftTimeBytes.buffer;
    const baseRightTimeBuf = pad.rightTimeBytes.buffer;
    const baseLeftFreqBuf = pad.leftFreqBytes.buffer;
    const baseRightFreqBuf = pad.rightFreqBytes.buffer;

    // Ensure matching stereo sizes is a no-op (zero reallocation)
    assert.equal(pad.ensureStereoBuffers(256, 128), false);

    for (let f = 0; f < 1000; f++) {
      const phase = f * 0.08;
      for (let i = 0; i < pad.leftTimeBytes.length; i++) {
        pad.leftTimeBytes[i] = Math.max(0, Math.min(255, Math.round(128 + 75 * Math.sin(i * 0.14 + phase))));
        pad.rightTimeBytes[i] = Math.max(0, Math.min(255, Math.round(128 + 75 * Math.cos(i * 0.14 + phase * 0.7))));
      }
      for (let k = 0; k < pad.leftFreqBytes.length; k++) {
        pad.leftFreqBytes[k] = (k * 2 + f) & 0xff;
        pad.rightFreqBytes[k] = (k * 3 + f) & 0xff;
      }

      const vecOut = lib.calculateSoundstageAcousticVectors(
        pad.leftTimeBytes,
        pad.rightTimeBytes,
        pad.leftFreqBytes,
        baseStageScratch
      );
      assert.equal(vecOut, baseStageScratch, 'calculateSoundstageAcousticVectors must mutate & return exact outVectors reference');

      const spatialOut = lib.calculateSpatialVectorSpectrogram(
        pad.leftTimeBytes,
        pad.rightTimeBytes,
        baseStageScratch.spatialOptions
      );
      assert.equal(spatialOut, baseSpatialReport);
      assert.equal(spatialOut.points, baseSpatialPoints);

      const polarOut = lib.calculatePolarRadarSoundstage(
        pad.leftTimeBytes,
        pad.rightTimeBytes,
        pad.leftFreqBytes,
        baseStageScratch.polarOptions
      );
      assert.equal(polarOut, basePolarReport);
      assert.equal(polarOut.bins, basePolarBins);
      assert.equal(polarOut.spectralBands, basePolarBands);

      const vuOut = lib.calculateVuBallistics((f % 100) / 100, baseVuLeft.level, null, baseVuLeft);
      assert.equal(vuOut, baseVuLeft);
    }

    assert.equal(pad.leftTimeBytes.buffer, baseLeftTimeBuf);
    assert.equal(pad.rightTimeBytes.buffer, baseRightTimeBuf);
    assert.equal(pad.leftFreqBytes.buffer, baseLeftFreqBuf);
    assert.equal(pad.rightFreqBytes.buffer, baseRightFreqBuf);
  });

  it('computes accurate mono, wide stereo, panned, and out-of-phase acoustic vectors with spectral airiness', () => {
    const out = {};
    const n = 256;
    const monoL = new Uint8Array(n);
    const monoR = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.round(128 + 70 * Math.sin(i * 0.2));
      monoL[i] = s;
      monoR[i] = s;
    }
    const resMono = lib.calculateSoundstageAcousticVectors(monoL, monoR, null, out);
    assert.equal(resMono, out);
    assert.equal(resMono.azimuth, 0);
    assert.equal(resMono.spread, 0);
    assert.equal(resMono.correlation, 1);
    assert.equal(resMono.soundstageType, 'intimate');

    // Quadrature stereo (90° phase shift -> decorrelated stereo)
    const stereoL = new Uint8Array(n);
    const stereoR = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      stereoL[i] = Math.round(128 + 70 * Math.sin((2 * Math.PI * 4 * i) / n));
      stereoR[i] = Math.round(128 + 70 * Math.cos((2 * Math.PI * 4 * i) / n));
    }
    const bassFreq = new Uint8Array(128);
    const airyFreq = new Uint8Array(128);
    for (let k = 0; k < 128; k++) {
      bassFreq[k] = k < 24 ? 220 : 4;
      airyFreq[k] = k >= 76 ? 240 : 20;
    }
    const resBassStereo = lib.calculateSoundstageAcousticVectors(stereoL, stereoR, bassFreq, out);
    const bassAiriness = resBassStereo.airiness;
    assert.ok(resBassStereo.spread >= 85, `Expected wide quadrature spread, got ${resBassStereo.spread}`);
    assert.ok(Math.abs(resBassStereo.correlation) <= 0.08, `Expected near-0 quadrature correlation, got ${resBassStereo.correlation}`);

    const resAiryStereo = lib.calculateSoundstageAcousticVectors(stereoL, stereoR, airyFreq, out);
    assert.ok(resAiryStereo.airiness > bassAiriness, `Treble-rich spectrum (${resAiryStereo.airiness}) must exceed bass-heavy airiness (${bassAiriness})`);

    // Inverted 180° out-of-phase stereo (L == -R around 128)
    const invL = new Uint8Array(n);
    const invR = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const d = Math.round(70 * Math.sin(i * 0.15));
      invL[i] = 128 + d;
      invR[i] = 128 - d;
    }
    const resInv = lib.calculateSoundstageAcousticVectors(invL, invR, null, out);
    assert.equal(resInv.spread, 100);
    assert.equal(resInv.correlation, -1);
    assert.equal(resInv.soundstageType, 'holographic');
  });

  it('eliminates per-frame Uint8Array allocations inside #fullscreen-stage-canvas render block in index.html', () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const stageStart = indexHtml.indexOf("const fsCanvas = $('fullscreen-stage-canvas');");
    const stageEnd = indexHtml.indexOf('window.setVisualizerRunning = setVisualizerRunning;', stageStart);
    assert.ok(stageStart > 0 && stageEnd > stageStart, 'Must locate #fullscreen-stage-canvas render block in index.html');

    const stageBlock = indexHtml.slice(stageStart, stageEnd);
    assert.equal(
      /new\s+Uint8Array\s*\(/.test(stageBlock),
      false,
      '#fullscreen-stage-canvas render block must contain ZERO per-frame new Uint8Array(...) allocations'
    );
    assert.ok(stageBlock.includes('scratchpad.leftTimeBytes'), 'Must reuse scratchpad.leftTimeBytes');
    assert.ok(stageBlock.includes('scratchpad.rightTimeBytes'), 'Must reuse scratchpad.rightTimeBytes');
    assert.ok(stageBlock.includes('scratchpad.leftFreqBytes'), 'Must reuse scratchpad.leftFreqBytes');
    assert.ok(stageBlock.includes('scratchpad.rightFreqBytes'), 'Must reuse scratchpad.rightFreqBytes');
    assert.ok(stageBlock.includes('scratchpad.soundstageScratch'), 'Must reuse scratchpad.soundstageScratch');
    assert.ok(
      stageBlock.includes('library.calculateSoundstageAcousticVectors(leftBuf, rightBuf, stageFreqBuf, stageScratch)'),
      'Must pass stageFreqBuf & stageScratch to calculateSoundstageAcousticVectors'
    );
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Audio destination routing invariant must remain intact'
    );
  });
});
