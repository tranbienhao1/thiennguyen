const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const LyricsUtils = require('../lyrics-utils.js');

test('LyricsUtils export & API presence', () => {
  assert.strictEqual(typeof LyricsUtils.parseLrc, 'function');
  assert.strictEqual(typeof LyricsUtils.serializeLrc, 'function');
  assert.strictEqual(typeof LyricsUtils.parseLyricsfile, 'function');
  assert.strictEqual(typeof LyricsUtils.serializeLyricsfile, 'function');
  assert.strictEqual(typeof LyricsUtils.findActiveLineIndex, 'function');
  assert.strictEqual(typeof LyricsUtils.findActiveWordIndex, 'function');
  assert.strictEqual(typeof LyricsUtils.computeAudioFingerprint, 'function');
  assert.strictEqual(typeof LyricsUtils.solveLrclibPoW, 'function');
  assert.strictEqual(typeof LyricsUtils.shiftLyrics, 'function');
  assert.strictEqual(typeof LyricsUtils.detectTimelineAnomalies, 'function');
  assert.strictEqual(typeof LyricsUtils.lrcToLyricsfile, 'function');
  assert.strictEqual(typeof LyricsUtils.lyricsfileToLrc, 'function');
  assert.strictEqual(typeof LyricsUtils.isCjkChar, 'function');
});

// =========================================================================
// 1. Standard & Enhanced LRC Parser / Serializer
// =========================================================================

test('parseLrc: parses metadata, tags, and standard timestamps', () => {
  const lrc = [
    '[ti:Synthetic Test Title]',
    '[ar:Synthetic Test Artist]',
    '[al:Synthetic Test Album]',
    '[length:03:30]',
    '[offset:500]',
    '[00:10.00]First line of synthetic lyrics',
    '[00:20.50]Second line with hundredths',
    '[00:30.123]Third line with milliseconds'
  ].join('\n');

  const parsed = LyricsUtils.parseLrc(lrc);
  assert.strictEqual(parsed.metadata.title, 'Synthetic Test Title');
  assert.strictEqual(parsed.metadata.artist, 'Synthetic Test Artist');
  assert.strictEqual(parsed.metadata.album, 'Synthetic Test Album');
  assert.strictEqual(parsed.metadata.length, '03:30');
  assert.strictEqual(parsed.metadata.duration_ms, 210000);
  assert.strictEqual(parsed.metadata.offset, 500);

  assert.strictEqual(parsed.lines.length, 3);
  assert.strictEqual(parsed.lines[0].start_ms, 10000);
  assert.strictEqual(parsed.lines[0].text, 'First line of synthetic lyrics');
  assert.strictEqual(parsed.lines[1].start_ms, 20500);
  assert.strictEqual(parsed.lines[1].text, 'Second line with hundredths');
  assert.strictEqual(parsed.lines[2].start_ms, 30123);
  assert.strictEqual(parsed.lines[2].text, 'Third line with milliseconds');
});

test('parseLrc: handles out-of-order timestamps and multiple timestamps per line', () => {
  const lrc = [
    '[00:30.00]Line happening at 30 seconds',
    '[00:10.00][00:50.00]Repeated synthetic chorus line',
    '[00:20.00]Line happening at 20 seconds'
  ].join('\n');

  const parsed = LyricsUtils.parseLrc(lrc);
  assert.strictEqual(parsed.lines.length, 4);

  // Verifies sorted ascending by start_ms
  assert.strictEqual(parsed.lines[0].start_ms, 10000);
  assert.strictEqual(parsed.lines[0].text, 'Repeated synthetic chorus line');

  assert.strictEqual(parsed.lines[1].start_ms, 20000);
  assert.strictEqual(parsed.lines[1].text, 'Line happening at 20 seconds');

  assert.strictEqual(parsed.lines[2].start_ms, 30000);
  assert.strictEqual(parsed.lines[2].text, 'Line happening at 30 seconds');

  assert.strictEqual(parsed.lines[3].start_ms, 50000);
  assert.strictEqual(parsed.lines[3].text, 'Repeated synthetic chorus line');
});

test('parseLrc: handles enhanced word-synced karaoke tags', () => {
  const lrc = [
    '[01:00.00]<01:00.00>Alpha <01:00.50>Beta <01:01.00>Gamma <01:02.00>'
  ].join('\n');

  const parsed = LyricsUtils.parseLrc(lrc);
  assert.strictEqual(parsed.lines.length, 1);
  const line = parsed.lines[0];
  assert.strictEqual(line.start_ms, 60000);
  assert.strictEqual(line.end_ms, 62000);
  assert.strictEqual(line.text, 'Alpha Beta Gamma');
  assert.strictEqual(line.words.length, 3);

  assert.strictEqual(line.words[0].text, 'Alpha ');
  assert.strictEqual(line.words[0].start_ms, 60000);
  assert.strictEqual(line.words[0].end_ms, 60500);

  assert.strictEqual(line.words[1].text, 'Beta ');
  assert.strictEqual(line.words[1].start_ms, 60500);
  assert.strictEqual(line.words[1].end_ms, 61000);

  assert.strictEqual(line.words[2].text, 'Gamma');
  assert.strictEqual(line.words[2].start_ms, 61000);
  assert.strictEqual(line.words[2].end_ms, 62000);
});

test('serializeLrc: converts lines and metadata back to clean LRC', () => {
  const data = {
    metadata: {
      title: 'Generated Track',
      artist: 'Generated Artist',
      offset: -150
    },
    lines: [
      { text: 'First line', start_ms: 5000, end_ms: 8000 },
      {
        text: 'Second line',
        start_ms: 10000,
        end_ms: 13000,
        words: [
          { text: 'Second ', start_ms: 10000 },
          { text: 'line', start_ms: 11500 }
        ]
      }
    ]
  };

  const serialized = LyricsUtils.serializeLrc(data);
  assert.ok(serialized.includes('[ti:Generated Track]'));
  assert.ok(serialized.includes('[ar:Generated Artist]'));
  assert.ok(serialized.includes('[offset:-150]'));
  assert.ok(serialized.includes('[00:05.00]First line'));
  assert.ok(serialized.includes('[00:10.00]<00:10.00>Second <00:11.50>line'));
});

// =========================================================================
// 2. Lyricsfile (YAML 1.0) Parser & Serializer
// =========================================================================

test('Lyricsfile YAML 1.0: parseLyricsfile & serializeLyricsfile round-trip', () => {
  const yaml = [
    "version: '1.0'",
    'metadata:',
    "  title: 'Synthetic Melody'",
    "  artist: 'Synthetic Group'",
    "  album: 'Test EP'",
    '  duration_ms: 180000',
    '  instrumental: false',
    'lines:',
    "  - text: 'A synchronized test line'",
    '    start_ms: 12000',
    '    end_ms: 15500',
    '    words:',
    "      - text: 'A '",
    '        start_ms: 12000',
    "      - text: 'synchronized '",
    '        start_ms: 12800',
    "      - text: 'test '",
    '        start_ms: 14000',
    "      - text: 'line'",
    '        start_ms: 14800',
    'plain: |',
    '  A synchronized test line'
  ].join('\n');

  const parsed = LyricsUtils.parseLyricsfile(yaml);
  assert.strictEqual(parsed.version, '1.0');
  assert.strictEqual(parsed.metadata.title, 'Synthetic Melody');
  assert.strictEqual(parsed.metadata.artist, 'Synthetic Group');
  assert.strictEqual(parsed.metadata.album, 'Test EP');
  assert.strictEqual(parsed.metadata.duration_ms, 180000);
  assert.strictEqual(parsed.metadata.instrumental, false);

  assert.strictEqual(parsed.lines.length, 1);
  assert.strictEqual(parsed.lines[0].text, 'A synchronized test line');
  assert.strictEqual(parsed.lines[0].start_ms, 12000);
  assert.strictEqual(parsed.lines[0].end_ms, 15500);

  // Verifies word trailing spaces preserved except line end
  assert.strictEqual(parsed.lines[0].words.length, 4);
  assert.strictEqual(parsed.lines[0].words[0].text, 'A ');
  assert.strictEqual(parsed.lines[0].words[1].text, 'synchronized ');
  assert.strictEqual(parsed.lines[0].words[2].text, 'test ');
  assert.strictEqual(parsed.lines[0].words[3].text, 'line');

  assert.strictEqual(parsed.plain.trim(), 'A synchronized test line');

  // Serialization test
  const serialized = LyricsUtils.serializeLyricsfile(parsed);
  assert.ok(serialized.includes("version: '1.0'"));
  assert.ok(serialized.includes("title: 'Synthetic Melody'"));
  assert.ok(serialized.includes("start_ms: 12000"));
  assert.ok(serialized.includes("text: 'A '"));
  assert.ok(serialized.includes("text: 'line'"));
  assert.ok(serialized.includes("plain: |"));

  // Re-parse serialized output
  const reParsed = LyricsUtils.parseLyricsfile(serialized);
  assert.deepStrictEqual(reParsed.lines, parsed.lines);
});

test('Lyricsfile: instrumental true leaves lines & plain empty', () => {
  const data = {
    version: '1.0',
    metadata: {
      title: 'Instrumental Ambient Soundscape',
      artist: 'Ambient Collective',
      duration_ms: 240000,
      instrumental: true
    },
    lines: [
      { text: 'Should be cleared', start_ms: 1000, end_ms: 2000 }
    ],
    plain: 'Should be cleared'
  };

  const serialized = LyricsUtils.serializeLyricsfile(data);
  assert.ok(serialized.includes('instrumental: true'));
  assert.ok(serialized.includes('lines: []'));
  assert.ok(serialized.includes("plain: ''"));

  const parsed = LyricsUtils.parseLyricsfile(serialized);
  assert.strictEqual(parsed.metadata.instrumental, true);
  assert.strictEqual(parsed.lines.length, 0);
  assert.strictEqual(parsed.plain, '');
});

test('Lyricsfile: CJK text handling without extra spaces', () => {
  const cjkData = {
    version: '1.0',
    metadata: {
      title: 'テスト楽曲',
      artist: 'テスト歌手',
      instrumental: false
    },
    lines: [
      {
        text: 'テスト歌詞です',
        start_ms: 1000,
        end_ms: 3000,
        words: [
          { text: 'テ', start_ms: 1000 },
          { text: 'ス', start_ms: 1400 },
          { text: 'ト', start_ms: 1800 },
          { text: '歌', start_ms: 2200 },
          { text: '詞', start_ms: 2500 },
          { text: 'で', start_ms: 2700 },
          { text: 'す', start_ms: 2850 }
        ]
      }
    ]
  };

  const serialized = LyricsUtils.serializeLyricsfile(cjkData);
  const parsed = LyricsUtils.parseLyricsfile(serialized);
  assert.strictEqual(parsed.lines[0].text, 'テスト歌詞です');
  const reconstructed = parsed.lines[0].words.map(w => w.text).join('');
  assert.strictEqual(reconstructed, 'テスト歌詞です');
  assert.ok(LyricsUtils.isCjkChar('テ'));
  assert.ok(LyricsUtils.isCjkChar('歌'));
  assert.ok(!LyricsUtils.isCjkChar('A'));
});

test('Lyricsfile: supports overlapping vocals', () => {
  const overlapData = {
    version: '1.0',
    metadata: { title: 'Overlapping Duet', instrumental: false },
    lines: [
      { text: 'Lead vocal singer part', start_ms: 10000, end_ms: 16000 },
      { text: 'Backing harmony voice part', start_ms: 12000, end_ms: 17000 }
    ]
  };

  const serialized = LyricsUtils.serializeLyricsfile(overlapData);
  const parsed = LyricsUtils.parseLyricsfile(serialized);
  assert.strictEqual(parsed.lines.length, 2);
  assert.strictEqual(parsed.lines[0].start_ms, 10000);
  assert.strictEqual(parsed.lines[0].end_ms, 16000);
  assert.strictEqual(parsed.lines[1].start_ms, 12000);
  assert.strictEqual(parsed.lines[1].end_ms, 17000);
});

// =========================================================================
// 3. Binary Search Synchronization
// =========================================================================

test('findActiveLineIndex: binary search returns active line index', () => {
  const lines = [
    { start_ms: 1000, end_ms: 3000, text: 'Line 0' },
    { start_ms: 5000, end_ms: 8000, text: 'Line 1' },
    { start_ms: 10000, end_ms: 14000, text: 'Line 2' },
    { start_ms: 15000, end_ms: 20000, text: 'Line 3' }
  ];

  // Before first line
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 500), -1);

  // Exact start of line 0
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 1000), 0);
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 2500), 0);

  // In between lines (default karaoke mode retains previous line)
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 4000), 0);
  // Strict mode returns -1 during gaps
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 4000, { strict: true }), -1);

  // Line 1
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 5000), 1);
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 7999), 1);

  // Line 3 (final line)
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 15000), 3);
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 25000), 3);
  assert.strictEqual(LyricsUtils.findActiveLineIndex(lines, 25000, { strict: true }), -1);

  // Empty or invalid
  assert.strictEqual(LyricsUtils.findActiveLineIndex([], 5000), -1);
  assert.strictEqual(LyricsUtils.findActiveLineIndex(null, 5000), -1);
});

test('findActiveWordIndex: binary search returns active word index', () => {
  const words = [
    { start_ms: 1000, end_ms: 1500, text: 'First ' },
    { start_ms: 1500, end_ms: 2200, text: 'second ' },
    { start_ms: 2200, end_ms: 3000, text: 'third' }
  ];

  assert.strictEqual(LyricsUtils.findActiveWordIndex(words, 800), -1);
  assert.strictEqual(LyricsUtils.findActiveWordIndex(words, 1000), 0);
  assert.strictEqual(LyricsUtils.findActiveWordIndex(words, 1400), 0);
  assert.strictEqual(LyricsUtils.findActiveWordIndex(words, 1500), 1);
  assert.strictEqual(LyricsUtils.findActiveWordIndex(words, 2500), 2);
  assert.strictEqual(LyricsUtils.findActiveWordIndex(words, 3500), 2);
  assert.strictEqual(LyricsUtils.findActiveWordIndex(words, 3500, { strict: true }), -1);
});

// =========================================================================
// 4. 64KB Audio Fingerprint (lrcget smart song identity)
// =========================================================================

test('computeAudioFingerprint: generates 64k_${hashHex.slice(0, 16)}_sz${fileSize}', async () => {
  const totalSize = 100000;
  const buffer = Buffer.alloc(totalSize);
  for (let i = 0; i < 65536; i++) {
    buffer[i] = i % 256;
  }

  const fingerprint = await LyricsUtils.computeAudioFingerprint(buffer);
  assert.ok(fingerprint.startsWith('64k_'), 'Must start with 64k_');
  assert.ok(fingerprint.includes(`_sz${totalSize}`), `Must contain _sz${totalSize}`);

  // Validate the hash matches the first 64KB SHA-256
  const expectedHash = crypto.createHash('sha256').update(buffer.subarray(0, 65536)).digest('hex');
  const expectedFingerprint = `64k_${expectedHash.slice(0, 16)}_sz${totalSize}`;
  assert.strictEqual(fingerprint, expectedFingerprint);
});

test('computeAudioFingerprint: handles small buffer (< 64KB)', async () => {
  const smallBuffer = Buffer.from('Small synthetic audio test content');
  const fingerprint = await LyricsUtils.computeAudioFingerprint(smallBuffer);
  const expectedHash = crypto.createHash('sha256').update(smallBuffer).digest('hex');
  assert.strictEqual(fingerprint, `64k_${expectedHash.slice(0, 16)}_sz${smallBuffer.length}`);
});

test('computeAudioFingerprint: handles mock Blob / File structure', async () => {
  const size = 80000;
  const mockBlob = {
    size,
    slice: (start, end) => {
      const chunk = Buffer.alloc(Math.min(end - start, size));
      return {
        arrayBuffer: async () => chunk.buffer
      };
    }
  };

  const fingerprint = await LyricsUtils.computeAudioFingerprint(mockBlob);
  assert.ok(fingerprint.startsWith('64k_'));
  assert.ok(fingerprint.endsWith(`_sz${size}`));
});

// =========================================================================
// 5. LRCLIB Proof-of-Work Challenge Solver
// =========================================================================

test('solveLrclibPoW: solves challenge where sha256(prefix + nonce) < target', () => {
  const prefix = 'lrclib_pow_test_';
  // Target starting with 000f... ensures a quick solve within ~4000 iterations
  const target = '000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  const nonce = LyricsUtils.solveLrclibPoW(prefix, target);
  assert.strictEqual(typeof nonce, 'number');
  assert.ok(nonce >= 0);

  const hash = crypto.createHash('sha256').update(prefix + nonce).digest('hex');
  assert.ok(hash < target, `Hash ${hash} must be strictly < target ${target}`);

  // Test template string interpolation as expected by lrclib-client
  const publishToken = `${prefix}:${nonce}`;
  assert.strictEqual(publishToken, `lrclib_pow_test_:${nonce}`);
});

test('solveLrclibPoW: respects maxIterations limit', () => {
  const prefix = 'unsolvable_prefix_';
  const target = '0000000000000000000000000000000000000000000000000000000000000001';
  const result = LyricsUtils.solveLrclibPoW(prefix, target, { maxIterations: 10 });
  assert.strictEqual(result, null);
});

// =========================================================================
// 6. Timeline Shift & Validation
// =========================================================================

test('shiftLyrics: shifts all lines and word timestamps clamped to >= 0', () => {
  const lines = [
    {
      start_ms: 1000,
      end_ms: 3000,
      text: 'First line',
      words: [
        { text: 'First ', start_ms: 1000 },
        { text: 'line', start_ms: 2000 }
      ]
    },
    { start_ms: 5000, end_ms: 8000, text: 'Second line' }
  ];

  // Shift +1000ms
  LyricsUtils.shiftLyrics(lines, 1000);
  assert.strictEqual(lines[0].start_ms, 2000);
  assert.strictEqual(lines[0].end_ms, 4000);
  assert.strictEqual(lines[0].words[0].start_ms, 2000);
  assert.strictEqual(lines[0].words[1].start_ms, 3000);
  assert.strictEqual(lines[1].start_ms, 6000);
  assert.strictEqual(lines[1].end_ms, 9000);

  // Shift -5000ms (clamping to 0)
  LyricsUtils.shiftLyrics(lines, -5000);
  assert.strictEqual(lines[0].start_ms, 0);
  assert.strictEqual(lines[0].end_ms, 0);
  assert.strictEqual(lines[0].words[0].start_ms, 0);
  assert.strictEqual(lines[0].words[1].start_ms, 0);
  assert.strictEqual(lines[1].start_ms, 1000);
  assert.strictEqual(lines[1].end_ms, 4000);
});

test('shiftLyrics: shifts only specified line indices', () => {
  const lines = [
    { start_ms: 1000, end_ms: 3000, text: 'Line 0' },
    { start_ms: 5000, end_ms: 8000, text: 'Line 1' }
  ];

  LyricsUtils.shiftLyrics(lines, 500, [1]);
  assert.strictEqual(lines[0].start_ms, 1000); // Unchanged
  assert.strictEqual(lines[1].start_ms, 5500); // Shifted
});

test('detectTimelineAnomalies: flags negative, overlap, and gap anomalies', () => {
  const problematicLines = [
    { start_ms: -100, end_ms: 500, text: 'Negative start' },
    { start_ms: 1000, end_ms: 900, text: 'End earlier than start' },
    { start_ms: 5000, end_ms: 8000, text: 'Line A' },
    { start_ms: 6000, end_ms: 9000, text: 'Line B (overlaps with A)' },
    { start_ms: 60000, end_ms: 63000, text: 'Line C (large gap after B)' }
  ];

  const anomalies = LyricsUtils.detectTimelineAnomalies(problematicLines, { gapThresholdMs: 30000 });
  assert.ok(anomalies.length >= 4);

  const types = anomalies.map(a => a.type);
  assert.ok(types.includes('negative'));
  assert.ok(types.includes('overlap'));
  assert.ok(types.includes('gap'));

  // Clean lines check
  const cleanLines = [
    { start_ms: 1000, end_ms: 3000, text: 'One' },
    { start_ms: 3500, end_ms: 5000, text: 'Two' }
  ];
  const cleanAnomalies = LyricsUtils.detectTimelineAnomalies(cleanLines);
  assert.strictEqual(cleanAnomalies.length, 0);
});

// =========================================================================
// 7. Format Conversions
// =========================================================================

test('Format conversions: lrcToLyricsfile & lyricsfileToLrc', () => {
  const lrc = [
    '[ti:Conversion Test Song]',
    '[ar:Conversion Artist]',
    '[00:05.00]First converted lyric line',
    '[00:10.00]Second converted lyric line'
  ].join('\n');

  const yaml = LyricsUtils.lrcToLyricsfile(lrc);
  assert.ok(yaml.includes("title: 'Conversion Test Song'"));
  assert.ok(yaml.includes("artist: 'Conversion Artist'"));
  assert.ok(yaml.includes('start_ms: 5000'));
  assert.ok(yaml.includes('start_ms: 10000'));

  const backToLrc = LyricsUtils.lyricsfileToLrc(yaml);
  assert.ok(backToLrc.includes('[ti:Conversion Test Song]'));
  assert.ok(backToLrc.includes('[00:05.00]First converted lyric line'));
  assert.ok(backToLrc.includes('[00:10.00]Second converted lyric line'));
});
