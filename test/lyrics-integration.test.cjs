'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LyricsUtils = require('../lyrics-utils.js');
const LrclibClient = require('../lrclib-client.js');

describe('Lyrics Integration Test Suite (End-to-End)', () => {
  const rootDir = path.resolve(__dirname, '..');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const assetsIndexPath = path.join(rootDir, 'android/app/src/main/assets/index.html');
  const lyricsUiPath = path.join(rootDir, 'lyrics-editor-ui.js');

  // Helper for mock fetch responses
  function createMockResponse(status, data, headers = {}) {
    const headerMap = new Map();
    for (const [k, v] of Object.entries(headers)) {
      headerMap.set(k.toLowerCase(), String(v));
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get: (name) => headerMap.get(name.toLowerCase()) || null
      },
      json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
      text: async () => (typeof data === 'string' ? data : JSON.stringify(data))
    };
  }

  // =========================================================================
  // 1. Full LRC & Lyricsfile YAML parse/serialize roundtrip
  // =========================================================================
  describe('1. Full LRC & Lyricsfile YAML Parse / Serialize Roundtrip', () => {
    it('roundtrips standard LRC with metadata and timestamps', () => {
      const sourceLrc = [
        '[ti:Nocturne Audiophile Symphony]',
        '[ar:FiiO Master Artist]',
        '[al:High-Res Studio Master]',
        '[length:04:15]',
        '[offset:250]',
        '[00:12.50]Opening overture begins with warmth',
        '[00:24.00]Bassline enters through crossfeed circuit',
        '[00:36.75]Midrange vocal clarity shines',
        '[01:05.10]Dynamic peak reaches full resolution'
      ].join('\n');

      const parsed = LyricsUtils.parseLrc(sourceLrc);
      assert.equal(parsed.metadata.title, 'Nocturne Audiophile Symphony');
      assert.equal(parsed.metadata.artist, 'FiiO Master Artist');
      assert.equal(parsed.metadata.album, 'High-Res Studio Master');
      assert.equal(parsed.metadata.offset, 250);
      assert.equal(parsed.lines.length, 4);

      const serialized = LyricsUtils.serializeLrc(parsed);
      const reParsed = LyricsUtils.parseLrc(serialized);

      assert.equal(reParsed.metadata.title, parsed.metadata.title);
      assert.equal(reParsed.metadata.artist, parsed.metadata.artist);
      assert.equal(reParsed.metadata.offset, parsed.metadata.offset);
      assert.equal(reParsed.lines.length, parsed.lines.length);
      for (let i = 0; i < parsed.lines.length; i++) {
        assert.equal(reParsed.lines[i].start_ms, parsed.lines[i].start_ms);
        assert.equal(reParsed.lines[i].text, parsed.lines[i].text);
      }
    });

    it('roundtrips Enhanced LRC with word-level karaoke timestamps', () => {
      const enhancedLrc = [
        '[ti:Karaoke Synchrony]',
        '[ar:Audiophile Vocalist]',
        '[00:10.00]<00:10.00>Listen <00:10.80>to <00:11.20>the <00:11.90>pure <00:12.50>sound <00:13.50>',
        '[00:14.00]<00:14.00>Every <00:14.50>word <00:15.10>timed <00:15.80>precisely <00:16.80>'
      ].join('\n');

      const parsed = LyricsUtils.parseLrc(enhancedLrc);
      assert.equal(parsed.lines.length, 2);
      assert.equal(parsed.lines[0].text, 'Listen to the pure sound');
      assert.equal(parsed.lines[0].words.length, 5);
      assert.equal(parsed.lines[0].words[0].text, 'Listen ');
      assert.equal(parsed.lines[0].words[0].start_ms, 10000);
      assert.equal(parsed.lines[0].words[0].end_ms, 10800);

      const serialized = LyricsUtils.serializeLrc(parsed);
      const reParsed = LyricsUtils.parseLrc(serialized);

      assert.equal(reParsed.lines.length, 2);
      assert.equal(reParsed.lines[0].words.length, 5);
      assert.equal(reParsed.lines[0].text, parsed.lines[0].text);
      assert.equal(reParsed.lines[1].words.length, 4);
      assert.equal(reParsed.lines[1].text, parsed.lines[1].text);
    });

    it('roundtrips Lyricsfile YAML 1.0 schema with full fidelity', () => {
      const lyricsfileData = {
        version: '1.0',
        metadata: {
          title: 'Acoustic Reverie',
          artist: 'Soundstage Ensemble',
          album: 'Pure DSD Session',
          duration_ms: 245000,
          instrumental: false
        },
        lines: [
          {
            text: 'First verse in acoustic stage',
            start_ms: 8500,
            end_ms: 12000,
            words: [
              { text: 'First ', start_ms: 8500 },
              { text: 'verse ', start_ms: 9200 },
              { text: 'in ', start_ms: 10000 },
              { text: 'acoustic ', start_ms: 10500 },
              { text: 'stage', start_ms: 11400 }
            ]
          },
          {
            text: 'Echoes fading into silence',
            start_ms: 13500,
            end_ms: 18000,
            words: [
              { text: 'Echoes ', start_ms: 13500 },
              { text: 'fading ', start_ms: 14500 },
              { text: 'into ', start_ms: 15600 },
              { text: 'silence', start_ms: 16800 }
            ]
          }
        ],
        plain: 'First verse in acoustic stage\nEchoes fading into silence'
      };

      const yaml = LyricsUtils.serializeLyricsfile(lyricsfileData);
      assert.ok(yaml.includes("version: '1.0'"));
      assert.ok(yaml.includes("title: 'Acoustic Reverie'"));
      assert.ok(yaml.includes("instrumental: false"));

      const parsed = LyricsUtils.parseLyricsfile(yaml);
      assert.equal(parsed.version, '1.0');
      assert.equal(parsed.metadata.title, 'Acoustic Reverie');
      assert.equal(parsed.metadata.duration_ms, 245000);
      assert.equal(parsed.metadata.instrumental, false);
      assert.equal(parsed.lines.length, 2);
      assert.equal(parsed.lines[0].words.length, 5);
      assert.equal(parsed.lines[1].words.length, 4);
      assert.equal(parsed.plain.trim(), lyricsfileData.plain.trim());
    });

    it('correctly handles CJK lyrics without artificial whitespace insertion', () => {
      const cjkInput = {
        version: '1.0',
        metadata: {
          title: '夜想曲 (Nocturne)',
          artist: '青葉市子',
          album: 'アダンの風',
          instrumental: false
        },
        lines: [
          {
            text: '星の降る夜に静けさを聴く',
            start_ms: 5000,
            end_ms: 9500,
            words: [
              { text: '星', start_ms: 5000 },
              { text: 'の', start_ms: 5400 },
              { text: '降', start_ms: 5800 },
              { text: 'る', start_ms: 6200 },
              { text: '夜', start_ms: 6600 },
              { text: 'に', start_ms: 7000 },
              { text: '静', start_ms: 7400 },
              { text: 'け', start_ms: 7800 },
              { text: 'さ', start_ms: 8200 },
              { text: 'を', start_ms: 8600 },
              { text: '聴', start_ms: 9000 },
              { text: 'く', start_ms: 9300 }
            ]
          }
        ]
      };

      const serialized = LyricsUtils.serializeLyricsfile(cjkInput);
      const parsed = LyricsUtils.parseLyricsfile(serialized);
      assert.equal(parsed.lines[0].text, '星の降る夜に静けさを聴く');
      const joined = parsed.lines[0].words.map(w => w.text).join('');
      assert.equal(joined, '星の降る夜に静けさを聴く');
      assert.ok(!joined.includes(' '));
    });

    it('clears lines and plain text when instrumental is true', () => {
      const instrumentalData = {
        version: '1.0',
        metadata: {
          title: 'Clair de Lune (DSD256 Master)',
          artist: 'Claude Debussy',
          instrumental: true
        },
        lines: [
          { text: 'Stray text that must be removed', start_ms: 1000, end_ms: 3000 }
        ],
        plain: 'Stray plain lyrics'
      };

      const yaml = LyricsUtils.serializeLyricsfile(instrumentalData);
      assert.ok(yaml.includes('instrumental: true'));
      assert.ok(yaml.includes('lines: []'));

      const parsed = LyricsUtils.parseLyricsfile(yaml);
      assert.equal(parsed.metadata.instrumental, true);
      assert.equal(parsed.lines.length, 0);
      assert.equal(parsed.plain, '');
    });

    it('handles overlapping vocal lines gracefully via cross-format roundtrip', () => {
      const overlapLrc = [
        '[00:10.00]Lead Vocal: Melodic line in front',
        '[00:12.00]Harmony: Counter-melody underneath',
        '[00:18.00]Chorus: All voices uniting together'
      ].join('\n');

      const parsedLrc = LyricsUtils.parseLrc(overlapLrc);
      assert.equal(parsedLrc.lines.length, 3);
      assert.equal(parsedLrc.lines[0].start_ms, 10000);
      assert.equal(parsedLrc.lines[1].start_ms, 12000);

      const yamlString = LyricsUtils.lrcToLyricsfile(overlapLrc);
      assert.ok(yamlString.includes('Lead Vocal: Melodic line in front'));

      const backToLrc = LyricsUtils.lyricsfileToLrc(yamlString);
      assert.ok(backToLrc.includes('[00:10.00]Lead Vocal: Melodic line in front'));
      assert.ok(backToLrc.includes('[00:12.00]Harmony: Counter-melody underneath'));
      assert.ok(backToLrc.includes('[00:18.00]Chorus: All voices uniting together'));
    });
  });

  // =========================================================================
  // 2. Binary search line/word sync & anomaly detection
  // =========================================================================
  describe('2. Binary Search Line & Word Sync, Timeline Shifts & Anomalies', () => {
    const testLines = [
      { start_ms: 2000, end_ms: 5000, text: 'Opening phrase' },
      { start_ms: 6000, end_ms: 9000, text: 'Second phrase' },
      { start_ms: 15000, end_ms: 19000, text: 'Third phrase after a gap' },
      { start_ms: 20000, end_ms: 24000, text: 'Final concluding phrase' }
    ];

    it('findActiveLineIndex locates active line index in O(log N)', () => {
      // Prior to song lyrics start
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 500), -1);
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 1999), -1);

      // Exact start of phrase 0
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 2000), 0);
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 3500), 0);

      // In the gap between phrase 1 and 2 (6s gap between 9000 and 15000)
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 12000), 1);
      // Strict mode returns -1 during gaps
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 12000, { strict: true }), -1);

      // Active inside phrase 2
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 16000), 2);

      // Active inside final phrase
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 22000), 3);

      // Beyond track end: default holds last line, strict drops it
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 30000), 3);
      assert.equal(LyricsUtils.findActiveLineIndex(testLines, 30000, { strict: true }), -1);
    });

    it('findActiveWordIndex locates active word index in O(log N)', () => {
      const words = [
        { start_ms: 2000, end_ms: 2600, text: 'High ' },
        { start_ms: 2600, end_ms: 3400, text: 'resolution ' },
        { start_ms: 3400, end_ms: 4200, text: 'audio ' },
        { start_ms: 4200, end_ms: 5000, text: 'playback' }
      ];

      assert.equal(LyricsUtils.findActiveWordIndex(words, 1500), -1);
      assert.equal(LyricsUtils.findActiveWordIndex(words, 2000), 0);
      assert.equal(LyricsUtils.findActiveWordIndex(words, 2599), 0);
      assert.equal(LyricsUtils.findActiveWordIndex(words, 2600), 1);
      assert.equal(LyricsUtils.findActiveWordIndex(words, 3800), 2);
      assert.equal(LyricsUtils.findActiveWordIndex(words, 4900), 3);
      assert.equal(LyricsUtils.findActiveWordIndex(words, 6000, { strict: true }), -1);
    });

    it('detectTimelineAnomalies detects gaps > 5s, overlaps, and negative times', () => {
      const problematicLines = [
        { start_ms: -500, end_ms: 2000, text: 'Negative timestamp line' },
        { start_ms: 1500, end_ms: 3000, text: 'Overlapping with previous line' },
        { start_ms: 12000, end_ms: 15000, text: 'Line after 9-second gap' }
      ];

      // Pass gapThresholdMs: 5000 as configured in Lyric Syncer V2
      const anomalies = LyricsUtils.detectTimelineAnomalies(problematicLines, { gapThresholdMs: 5000 });
      assert.ok(Array.isArray(anomalies));

      const types = anomalies.map(a => a.type);
      assert.ok(types.includes('negative'), 'Must detect negative timestamp');
      assert.ok(types.includes('overlap'), 'Must detect line overlap');
      assert.ok(types.includes('gap'), 'Must detect gap > 5s');
    });

    it('shiftLyrics adjusts timestamps and clamps negative results to 0', () => {
      const lines = [
        {
          start_ms: 1000,
          end_ms: 3000,
          text: 'Shift test line',
          words: [
            { start_ms: 1000, end_ms: 1800, text: 'Shift ' },
            { start_ms: 1800, end_ms: 3000, text: 'test' }
          ]
        }
      ];

      // Forward shift (+500ms)
      const forwardShifted = LyricsUtils.shiftLyrics(lines, 500);
      assert.equal(forwardShifted[0].start_ms, 1500);
      assert.equal(forwardShifted[0].end_ms, 3500);
      assert.equal(forwardShifted[0].words[0].start_ms, 1500);

      // Backward shift beyond 0 (-2000ms) clamps to 0
      const backwardClamped = LyricsUtils.shiftLyrics(lines, -2000);
      assert.equal(backwardClamped[0].start_ms, 0);
      assert.equal(backwardClamped[0].words[0].start_ms, 0);
    });
  });

  // =========================================================================
  // 3. LRCLIB client request mock & PoW challenge solver
  // =========================================================================
  describe('3. LRCLIB Client Request Mock & PoW Challenge Solver', () => {
    it('queries GET /api/get with mandatory User-Agent and handles album fallback', async () => {
      const calls = [];
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url, opts) => {
          calls.push({ url, opts });
          if (url.includes('album_name=Special+Master')) {
            // First call with album fails (404)
            return createMockResponse(404, { error: 'Not Found' });
          }
          // Fallback call without album succeeds
          return createMockResponse(200, {
            id: 9999,
            trackName: 'Audiophile Track',
            artistName: 'Mastering Engineer',
            plainLyrics: 'Pure sound experience',
            syncedLyrics: '[00:05.00]Pure sound experience'
          });
        }
      });

      const lyrics = await client.getLyrics({
        trackName: 'Audiophile Track',
        artistName: 'Mastering Engineer',
        albumName: 'Special Master',
        duration: 180
      });

      assert.equal(calls.length, 2, 'Must perform primary search and fallback without album_name');
      assert.equal(
        calls[0].opts.headers['Lrclib-Client'],
        'Nocturne-HiRes-Player (https://github.com/tranbienhao1/thiennguyen)'
      );
      assert.ok(calls[0].url.includes('album_name='));
      assert.ok(!calls[1].url.includes('album_name='));

      assert.equal(lyrics.id, 9999);
      assert.equal(lyrics.trackName, 'Audiophile Track');
      assert.equal(lyrics.syncedLyrics, '[00:05.00]Pure sound experience');
    });

    it('searches lyrics and classifies word-synced karaoke badges', async () => {
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async () => {
          return createMockResponse(200, [
            {
              id: 1,
              trackName: 'Song A',
              artistName: 'Artist A',
              syncedLyrics: '[00:01.00]<00:01.00>Word <00:01.50>sync',
              plainLyrics: 'Word sync'
            },
            {
              id: 2,
              trackName: 'Song B',
              artistName: 'Artist B',
              syncedLyrics: '[00:02.00]Line synced only',
              plainLyrics: 'Line synced only'
            },
            {
              id: 3,
              trackName: 'Song C',
              artistName: 'Artist C',
              syncedLyrics: null,
              plainLyrics: 'Plain text only'
            },
            {
              id: 4,
              trackName: 'Song D',
              artistName: 'Artist D',
              instrumental: true,
              syncedLyrics: null,
              plainLyrics: null
            }
          ]);
        }
      });

      const results = await client.searchLyrics('Song');
      assert.equal(results.length, 4);

      assert.equal(results[0].hasWordSync, true);
      assert.equal(results[0].hasSyncedLyrics, true);

      assert.equal(results[1].hasWordSync, false);
      assert.equal(results[1].hasSyncedLyrics, true);

      assert.equal(results[2].hasWordSync, false);
      assert.equal(results[2].hasPlainLyrics, true);

      assert.equal(results[3].instrumental, true);
    });

    it('integrates real SHA-256 PoW challenge solver with publishLyrics', async () => {
      const recorded = [];
      const testPrefix = 'nocturne_publish_challenge_';
      // High target starting with 000f to solve within reasonable test time
      const testTarget = '000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url, opts) => {
          recorded.push({ url, opts });
          if (url.includes('/api/request-challenge')) {
            return createMockResponse(200, {
              prefix: testPrefix,
              target: testTarget
            });
          }
          if (url.includes('/api/publish')) {
            return createMockResponse(201, { success: true });
          }
          return createMockResponse(404, {});
        }
      });

      const publishResult = await client.publishLyrics({
        trackName: 'Integration Song',
        artistName: 'Integration Artist',
        albumName: 'Integration Album',
        duration: 210,
        plainLyrics: 'Plain test lyrics',
        syncedLyrics: '[00:10.00]Plain test lyrics'
      });

      assert.equal(publishResult.success, true);
      assert.equal(recorded.length, 2);

      const challengeReq = recorded[0];
      assert.ok(challengeReq.url.includes('/api/request-challenge'));

      const publishReq = recorded[1];
      assert.ok(publishReq.url.includes('/api/publish'));
      const token = publishReq.opts.headers['X-Publish-Token'];
      assert.ok(token.startsWith(testPrefix));

      // Token format: ${prefix}:${nonce}
      const colonIdx = token.indexOf(':');
      assert.ok(colonIdx !== -1, 'Token must contain colon separator between prefix and nonce');
      const parsedPrefix = token.slice(0, colonIdx);
      const parsedNonce = token.slice(colonIdx + 1);

      assert.equal(parsedPrefix, testPrefix);
      const computedHash = crypto.createHash('sha256').update(parsedPrefix + parsedNonce).digest('hex');
      assert.ok(computedHash < testTarget, `Hash ${computedHash} must be < target ${testTarget}`);
    });

    it('caches and retrieves lyrics from offline vault using fingerprint', async () => {
      const client = new LrclibClient.LrclibClient();
      const testFingerprint = '64k_a1b2c3d4e5f67890_sz52428800';

      const sampleLyrics = {
        title: 'Master Track Vault Test',
        artist: 'HiRes Band',
        lrc: '[00:05.00]Vault lyrics retrieved successfully'
      };

      await client.saveLyricsToVault(testFingerprint, sampleLyrics);
      const cached = await client.getLyricsFromVault(testFingerprint);

      assert.ok(cached !== null, 'Must retrieve cached vault entry');
      assert.equal(cached.key, testFingerprint);
      assert.equal(cached.lrc, sampleLyrics.lrc);
    });
  });

  // =========================================================================
  // 4. 64KB audio fingerprint hashing
  // =========================================================================
  describe('4. 64KB Audio Fingerprint Hashing', () => {
    it('produces exact 64k_${hashHex.slice(0, 16)}_sz${fileSize} for 64KB+ files', async () => {
      const totalSize = 256 * 1024; // 256 KB
      const buffer = Buffer.alloc(totalSize);
      for (let i = 0; i < totalSize; i++) {
        buffer[i] = (i * 31 + 17) & 0xff;
      }

      const fingerprint = await LyricsUtils.computeAudioFingerprint(buffer);
      const first64K = buffer.subarray(0, 65536);
      const expectedHash = crypto.createHash('sha256').update(first64K).digest('hex');
      const expected = `64k_${expectedHash.slice(0, 16)}_sz${totalSize}`;

      assert.equal(fingerprint, expected);
    });

    it('hashes full content when audio file size is strictly less than 64KB', async () => {
      const totalSize = 1024; // 1 KB
      const buffer = Buffer.alloc(totalSize);
      for (let i = 0; i < totalSize; i++) {
        buffer[i] = (i * 13) & 0xff;
      }

      const fingerprint = await LyricsUtils.computeAudioFingerprint(buffer);
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const expected = `64k_${expectedHash.slice(0, 16)}_sz${totalSize}`;

      assert.equal(fingerprint, expected);
    });

    it('hashes mock Blob / File object with slice() arrayBuffer correctly', async () => {
      const totalSize = 128 * 1024;
      const fullBuffer = Buffer.alloc(totalSize);
      for (let i = 0; i < 65536; i++) {
        fullBuffer[i] = (i ^ 0xaa) & 0xff;
      }

      const mockBlob = {
        size: totalSize,
        slice: (start, end) => {
          const sliceBuf = fullBuffer.subarray(start, end);
          return {
            arrayBuffer: async () => sliceBuf.buffer.slice(sliceBuf.byteOffset, sliceBuf.byteOffset + sliceBuf.byteLength)
          };
        }
      };

      const fingerprint = await LyricsUtils.computeAudioFingerprint(mockBlob);
      const expectedHash = crypto.createHash('sha256').update(fullBuffer.subarray(0, 65536)).digest('hex');
      assert.equal(fingerprint, `64k_${expectedHash.slice(0, 16)}_sz${totalSize}`);
    });
  });

  // =========================================================================
  // 5. Web Audio Invariant & App Wiring Integrity
  // =========================================================================
  describe('5. Web Audio Invariant & App Wiring Integrity', () => {
    it('strictly preserves critical Web Audio invariant in index.html', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      const invariant = 'state.crossfeedNodes.output.connect(state.context.destination)';
      assert.ok(
        html.includes(invariant),
        `CRITICAL INVARIANT VIOLATION: index.html must preserve '${invariant}'`
      );
    });

    it('includes all lyrics scripts in index.html in correct order', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      const utilsIdx = html.indexOf('<script src="lyrics-utils.js"></script>');
      const clientIdx = html.indexOf('<script src="lrclib-client.js"></script>');
      const uiIdx = html.indexOf('<script src="lyrics-editor-ui.js"></script>');

      assert.ok(utilsIdx !== -1, 'Must include lyrics-utils.js');
      assert.ok(clientIdx !== -1, 'Must include lrclib-client.js');
      assert.ok(uiIdx !== -1, 'Must include lyrics-editor-ui.js');
      assert.ok(utilsIdx < clientIdx, 'lyrics-utils.js must be loaded before lrclib-client.js');
      assert.ok(clientIdx < uiIdx, 'lrclib-client.js must be loaded before lyrics-editor-ui.js');
    });

    it('contains Listening Room and Fullscreen lyrics action buttons in index.html', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      assert.ok(html.includes('id="room-lyrics-search-btn"'), 'Must have #room-lyrics-search-btn');
      assert.ok(html.includes('id="room-lyrics-edit-btn"'), 'Must have #room-lyrics-edit-btn');
      assert.ok(html.includes('id="fs-lyrics-search-btn"'), 'Must have #fs-lyrics-search-btn');
      assert.ok(html.includes('id="fs-lyrics-edit-btn"'), 'Must have #fs-lyrics-edit-btn');
    });

    it('defines lyrics-editor-modal and lyrics-search-modal in lyrics-editor-ui.js', () => {
      const uiScript = fs.readFileSync(lyricsUiPath, 'utf8');
      assert.ok(uiScript.includes('lyrics-editor-modal'), 'lyrics-editor-ui.js must define lyrics-editor-modal');
      assert.ok(uiScript.includes('lyrics-search-modal'), 'lyrics-editor-ui.js must define lyrics-search-modal');
    });

    it('strictly preserves critical Web Audio invariant in android assets index.html', () => {
      if (fs.existsSync(assetsIndexPath)) {
        const assetHtml = fs.readFileSync(assetsIndexPath, 'utf8');
        const invariant = 'state.crossfeedNodes.output.connect(state.context.destination)';
        assert.ok(
          assetHtml.includes(invariant),
          `CRITICAL INVARIANT VIOLATION: android assets index.html must preserve '${invariant}'`
        );
      }
    });
  });
});
