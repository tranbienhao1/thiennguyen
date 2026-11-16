'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const LrclibClient = require('../lrclib-client.js');

describe('LRCLIB API Client & Offline Vault Test Suite', () => {

  // --- Helper to create a mock Response ---
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

  describe('1. API Client Basics & Headers', () => {
    it('sends mandatory Lrclib-Client header on all outbound requests', async () => {
      const requests = [];
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url, opts) => {
          requests.push({ url, opts });
          return createMockResponse(200, {
            id: 101,
            trackName: 'Test Song',
            artistName: 'Test Artist',
            plainLyrics: 'La la la',
            syncedLyrics: '[00:01.00] La la la'
          });
        }
      });

      await client.getLyrics({ trackName: 'Test Song', artistName: 'Test Artist' });

      assert.equal(requests.length, 1);
      assert.equal(
        requests[0].opts.headers['Lrclib-Client'],
        'Nocturne-HiRes-Player (https://github.com/tranbienhao1/thiennguyen)'
      );
    });

    it('normalizes base URL by stripping trailing slashes', () => {
      const client = new LrclibClient.LrclibClient({ baseUrl: 'https://custom.lrclib.net///' });
      assert.equal(client.baseUrl, 'https://custom.lrclib.net');
    });

    it('exposes methods on both class instance and top-level module export', () => {
      assert.equal(typeof LrclibClient.getLyrics, 'function');
      assert.equal(typeof LrclibClient.searchLyrics, 'function');
      assert.equal(typeof LrclibClient.getLyricsById, 'function');
      assert.equal(typeof LrclibClient.publishLyrics, 'function');
      assert.equal(typeof LrclibClient.openLyricsVault, 'function');
      assert.equal(typeof LrclibClient.saveLyricsToVault, 'function');
      assert.equal(typeof LrclibClient.getLyricsFromVault, 'function');
      assert.equal(typeof LrclibClient.findLocalSidecarLyrics, 'function');
    });
  });

  describe('2. Rate Limiting Queue (Sequential & 250ms spacing)', () => {
    it('executes requests sequentially with at least 250ms spacing between outbound calls', async () => {
      const timestamps = [];
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 250,
        fetch: async (url) => {
          timestamps.push(Date.now());
          return createMockResponse(200, { id: 1, trackName: 'Spaced', syncedLyrics: '' });
        }
      });

      const p1 = client.getLyrics({ trackName: 'Song 1' });
      const p2 = client.getLyrics({ trackName: 'Song 2' });
      const p3 = client.getLyrics({ trackName: 'Song 3' });

      await Promise.all([p1, p2, p3]);

      assert.equal(timestamps.length, 3);
      const diff1 = timestamps[1] - timestamps[0];
      const diff2 = timestamps[2] - timestamps[1];

      // Allow 15ms tolerance for system timer resolution
      assert.ok(diff1 >= 235, `Expected >= 235ms spacing between req 1 and 2, got ${diff1}ms`);
      assert.ok(diff2 >= 235, `Expected >= 235ms spacing between req 2 and 3, got ${diff2}ms`);
    });

    it('recovers queue and processes subsequent requests even if a previous request fails', async () => {
      let callCount = 0;
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        maxRetries: 0,
        fetch: async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Network offline');
          }
          return createMockResponse(200, { id: 2, trackName: 'Success', syncedLyrics: '' });
        }
      });

      await assert.rejects(
        () => client.getLyrics({ trackName: 'Failed Song' }),
        /Network offline/
      );

      const successResult = await client.getLyrics({ trackName: 'Subsequent Song' });
      assert.ok(successResult);
      assert.equal(successResult.trackName, 'Success');
    });
  });

  describe('3. 429/503 Retry-After Handling with Jitter', () => {
    it('correctly parses Retry-After header as seconds and dates', () => {
      const resSeconds = createMockResponse(429, {}, { 'Retry-After': '5' });
      assert.equal(LrclibClient.parseRetryAfter(resSeconds), 5);

      const futureDate = new Date(Date.now() + 10000).toUTCString();
      const resDate = createMockResponse(503, {}, { 'Retry-After': futureDate });
      const parsedSec = LrclibClient.parseRetryAfter(resDate);
      assert.ok(parsedSec >= 8 && parsedSec <= 11);

      const resNone = createMockResponse(200, {});
      assert.equal(LrclibClient.parseRetryAfter(resNone), null);
    });

    it('calculates retry delay with Retry-After and 0-30% jitter', () => {
      const res = createMockResponse(429, {}, { 'Retry-After': '2' });
      // With fixed jitter ratio 0.20
      const delayFixed = LrclibClient.calculateRetryDelay(res, 0, { jitterRatio: 0.20 });
      assert.equal(delayFixed, 2400); // 2000 * 1.20

      // With random jitter (must be between 2000 and 2600)
      for (let i = 0; i < 20; i++) {
        const delayRand = LrclibClient.calculateRetryDelay(res, 0);
        assert.ok(delayRand >= 2000, `Delay ${delayRand} should be >= 2000`);
        assert.ok(delayRand <= 2600, `Delay ${delayRand} should be <= 2600`);
      }
    });

    it('retries up to 3 times on 429 then succeeds', async () => {
      let attempts = 0;
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        maxRetries: 3,
        jitterRatio: 0, // fast deterministic test
        fetch: async () => {
          attempts++;
          if (attempts < 3) {
            // Return 429 with 0 Retry-After to speed up test
            return createMockResponse(429, { error: 'Rate limited' }, { 'Retry-After': '0' });
          }
          return createMockResponse(200, {
            id: 42,
            trackName: 'Recovered',
            syncedLyrics: '[00:00.00] Done'
          });
        }
      });

      const res = await client.getLyrics({ trackName: 'Retry Song' });
      assert.equal(attempts, 3); // attempt 1 (429) -> attempt 2 (429) -> attempt 3 (200)
      assert.equal(res.trackName, 'Recovered');
    });

    it('throws error after exhausting 3 retries on 503', async () => {
      let attempts = 0;
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        maxRetries: 3,
        jitterRatio: 0,
        fetch: async () => {
          attempts++;
          return createMockResponse(503, { error: 'Unavailable' }, { 'Retry-After': '0' });
        }
      });

      await assert.rejects(
        () => client.getLyrics({ trackName: 'Down Song' }),
        /LRCLIB HTTP 503/
      );
      // Initial attempt (0) + 3 retries (1, 2, 3) = 4 calls total
      assert.equal(attempts, 4);
    });
  });

  describe('4. getLyrics & Fallback without albumName', () => {
    it('fetches lyrics successfully with all parameters provided', async () => {
      let requestedUrl = null;
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url) => {
          requestedUrl = url;
          return createMockResponse(200, {
            id: 999,
            trackName: 'Clair de Lune',
            artistName: 'Claude Debussy',
            albumName: 'Suite Bergamasque',
            duration: 300,
            syncedLyrics: '[00:05.00] Piano chords',
            plainLyrics: 'Piano chords',
            instrumental: false
          });
        }
      });

      const lyrics = await client.getLyrics({
        trackName: 'Clair de Lune',
        artistName: 'Claude Debussy',
        albumName: 'Suite Bergamasque',
        duration: 300
      });

      assert.ok(requestedUrl.includes('track_name=Clair+de+Lune'));
      assert.ok(requestedUrl.includes('artist_name=Claude+Debussy'));
      assert.ok(requestedUrl.includes('album_name=Suite+Bergamasque'));
      assert.ok(requestedUrl.includes('duration=300'));
      assert.equal(lyrics.id, 999);
      assert.equal(lyrics.hasSyncedLyrics, true);
      assert.equal(lyrics.hasPlainLyrics, true);
      assert.equal(lyrics.hasWordSync, false);
      assert.equal(lyrics.instrumental, false);
    });

    it('falls back to request WITHOUT albumName if first request returns 404', async () => {
      const calls = [];
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url) => {
          calls.push(url);
          if (url.includes('album_name=')) {
            return createMockResponse(404, { error: 'Not found with album' });
          }
          return createMockResponse(200, {
            id: 888,
            trackName: 'Hotel California',
            artistName: 'Eagles',
            albumName: '',
            syncedLyrics: '[00:10.00] Welcome to the Hotel California'
          });
        }
      });

      const lyrics = await client.getLyrics({
        trackName: 'Hotel California',
        artistName: 'Eagles',
        albumName: 'Wrong Album Name',
        duration: 390
      });

      assert.equal(calls.length, 2);
      assert.ok(calls[0].includes('album_name=Wrong+Album+Name'));
      assert.ok(!calls[1].includes('album_name'));
      assert.equal(lyrics.id, 888);
      assert.equal(lyrics.trackName, 'Hotel California');
    });

    it('returns null when song is not found on both initial and fallback requests', async () => {
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async () => createMockResponse(404, { error: 'Not found' })
      });

      const lyrics = await client.getLyrics({
        trackName: 'Non Existent Track',
        artistName: 'Unknown',
        albumName: 'Unknown Album'
      });

      assert.equal(lyrics, null);
    });

    it('returns null immediately on 404 if no albumName was supplied', async () => {
      let callCount = 0;
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async () => {
          callCount++;
          return createMockResponse(404, { error: 'Not found' });
        }
      });

      const lyrics = await client.getLyrics({
        trackName: 'Track Without Album',
        artistName: 'Artist'
      });

      assert.equal(callCount, 1);
      assert.equal(lyrics, null);
    });

    it('throws error if trackName is missing', async () => {
      const client = new LrclibClient.LrclibClient({ minSpacingMs: 0 });
      await assert.rejects(
        () => client.getLyrics({ artistName: 'Someone' }),
        /trackName is required/
      );
    });
  });

  describe('5. searchLyrics & Word-Sync Detection', () => {
    it('searches via /api/v2/search and accurately detects word-sync, synced, plain, instrumental', async () => {
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url) => {
          assert.ok(url.includes('/api/v2/search'));
          assert.ok(url.includes('q=Queen'));
          return createMockResponse(200, [
            {
              id: 1,
              trackName: 'Bohemian Rhapsody',
              artistName: 'Queen',
              syncedLyrics: '[00:10.00] <00:10.00> Is <00:10.50> this <00:11.00> the <00:11.50> real life?',
              plainLyrics: 'Is this the real life?',
              instrumental: false
            },
            {
              id: 2,
              trackName: 'We Will Rock You',
              artistName: 'Queen',
              syncedLyrics: '[00:05.00] Buddy, you\'re a boy, make a big noise',
              plainLyrics: 'Buddy, you\'re a boy',
              instrumental: false
            },
            {
              id: 3,
              trackName: 'Seven Seas of Rhye (Instrumental)',
              artistName: 'Queen',
              syncedLyrics: '',
              plainLyrics: null,
              instrumental: true
            },
            {
              id: 4,
              trackName: 'Plain Only',
              artistName: 'Queen',
              syncedLyrics: null,
              plainLyrics: 'Just plain words',
              instrumental: false
            }
          ]);
        }
      });

      const results = await client.searchLyrics('Queen');

      assert.equal(results.length, 4);

      // Item 1: Word-sync karaoke
      assert.equal(results[0].hasWordSync, true);
      assert.equal(results[0].hasSyncedLyrics, true);
      assert.equal(results[0].hasPlainLyrics, true);
      assert.equal(results[0].instrumental, false);

      // Item 2: Line-synced only
      assert.equal(results[1].hasWordSync, false);
      assert.equal(results[1].hasSyncedLyrics, true);
      assert.equal(results[1].hasPlainLyrics, true);
      assert.equal(results[1].instrumental, false);

      // Item 3: Instrumental
      assert.equal(results[2].hasWordSync, false);
      assert.equal(results[2].hasSyncedLyrics, false);
      assert.equal(results[2].hasPlainLyrics, false);
      assert.equal(results[2].instrumental, true);

      // Item 4: Plain lyrics only
      assert.equal(results[3].hasWordSync, false);
      assert.equal(results[3].hasSyncedLyrics, false);
      assert.equal(results[3].hasPlainLyrics, true);
      assert.equal(results[3].instrumental, false);
    });

    it('falls back to /api/search when /api/v2/search returns 404 or fails', async () => {
      const urls = [];
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url) => {
          urls.push(url);
          if (url.includes('/api/v2/search')) {
            return createMockResponse(404, { error: 'v2 endpoint not supported' });
          }
          return createMockResponse(200, [
            {
              id: 55,
              trackName: 'Fallback Track',
              syncedLyrics: '[00:01.00] Synced line'
            }
          ]);
        }
      });

      const results = await client.searchLyrics('Fallback Query');
      assert.equal(urls.length, 2);
      assert.ok(urls[0].includes('/api/v2/search'));
      assert.ok(urls[1].includes('/api/search'));
      assert.equal(results.length, 1);
      assert.equal(results[0].id, 55);
    });

    it('supports search query with filters (track_name, artist_name, album_name)', async () => {
      let capturedUrl = null;
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url) => {
          capturedUrl = url;
          return createMockResponse(200, []);
        }
      });

      await client.searchLyrics('Radioactive', {
        artistName: 'Imagine Dragons',
        albumName: 'Night Visions'
      });

      assert.ok(capturedUrl.includes('q=Radioactive'));
      assert.ok(capturedUrl.includes('artist_name=Imagine+Dragons'));
      assert.ok(capturedUrl.includes('album_name=Night+Visions'));
    });
  });

  describe('6. getLyricsById', () => {
    it('retrieves lyrics by numeric ID', async () => {
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url) => {
          assert.ok(url.endsWith('/api/get/12345'));
          return createMockResponse(200, {
            id: 12345,
            trackName: 'Starman',
            artistName: 'David Bowie',
            syncedLyrics: '[00:15.00] There\'s a starman waiting in the sky'
          });
        }
      });

      const item = await client.getLyricsById(12345);
      assert.equal(item.id, 12345);
      assert.equal(item.trackName, 'Starman');
      assert.equal(item.hasSyncedLyrics, true);
    });

    it('returns null when ID is not found (404)', async () => {
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async () => createMockResponse(404, { error: 'Not found' })
      });

      const item = await client.getLyricsById(999999);
      assert.equal(item, null);
    });
  });

  describe('7. publishLyrics with PoW Challenge Solver', () => {
    it('requests challenge, solves PoW, and posts to /api/publish with X-Publish-Token', async () => {
      const requests = [];
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        // Mock PoW solver for fast test
        solvePoW: async (prefix, target) => {
          assert.equal(prefix, 'challenge_prefix_123');
          assert.equal(target, '0000ffff');
          return '777';
        },
        fetch: async (url, opts) => {
          requests.push({ url, opts });
          if (url.includes('/api/request-challenge')) {
            return createMockResponse(200, {
              prefix: 'challenge_prefix_123',
              target: '0000ffff'
            });
          }
          if (url.includes('/api/publish')) {
            return createMockResponse(201, { success: true });
          }
          return createMockResponse(404, {});
        }
      });

      const payload = {
        trackName: 'New Song',
        artistName: 'Independent Artist',
        albumName: 'EP',
        duration: 180,
        plainLyrics: 'These are the words',
        syncedLyrics: '[00:01.00] These are the words'
      };

      const result = await client.publishLyrics(payload);

      assert.equal(requests.length, 2);
      // Challenge request
      assert.ok(requests[0].url.includes('/api/request-challenge'));
      assert.equal(requests[0].opts.method, 'POST');

      // Publish request
      assert.ok(requests[1].url.includes('/api/publish'));
      assert.equal(requests[1].opts.method, 'POST');
      assert.equal(requests[1].opts.headers['X-Publish-Token'], 'challenge_prefix_123:777');
      assert.equal(
        requests[1].opts.headers['Lrclib-Client'],
        'Nocturne-HiRes-Player (https://github.com/tranbienhao1/thiennguyen)'
      );
      assert.deepEqual(JSON.parse(requests[1].opts.body), payload);
      assert.equal(result.success, true);
    });

    it('uses globalThis.LyricsUtils.solveLrclibPoW when available', async () => {
      globalThis.LyricsUtils = {
        solveLrclibPoW: async (prefix, target) => 'global_pow_token_888'
      };

      const requests = [];
      const client = new LrclibClient.LrclibClient({
        minSpacingMs: 0,
        fetch: async (url, opts) => {
          requests.push({ url, opts });
          if (url.includes('/api/request-challenge')) {
            return createMockResponse(200, { prefix: 'pref_g', target: 'targ_g' });
          }
          if (url.includes('/api/publish')) {
            return createMockResponse(200, { success: true });
          }
          return createMockResponse(404, {});
        }
      });

      await client.publishLyrics({ trackName: 'Song' });
      assert.equal(requests[1].opts.headers['X-Publish-Token'], 'pref_g:global_pow_token_888');

      delete globalThis.LyricsUtils;
    });

    it('fallback PoW solver accurately finds valid nonce satisfying hash < target', async () => {
      // Test the built-in SHA256 PoW solver
      const prefix = 'nocturne_test_';
      // High target: starting with "0f..." so it takes very few iterations
      const target = '0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const nonce = await LrclibClient.solveLrclibPoWFallback(prefix, target);
      assert.ok(nonce !== undefined);

      const crypto = require('node:crypto');
      const hash = crypto.createHash('sha256').update(prefix + nonce).digest('hex');
      assert.ok(hash < target, `Hash ${hash} must be strictly less than target ${target}`);
    });
  });

  describe('8. Offline Vault & Local Caching', () => {
    it('saves and retrieves lyrics from vault by 64KB audio fingerprint or cloudId', async () => {
      const fingerprint = '64k_a1b2c3d4e5f67890_sz10485760';
      const lyricsData = {
        lrc: '[00:10.00] Cached lyric line',
        lyricsfile: 'version: "1.0"\nlines:\n  - text: Cached lyric line\n    start_ms: 10000',
        metadata: {
          title: 'Cached Song',
          artist: 'Cached Artist',
          album: 'Cached Album',
          duration: 210,
          instrumental: false
        },
        source: 'lrclib'
      };

      const saved = await LrclibClient.saveLyricsToVault(fingerprint, lyricsData);
      assert.equal(saved.key, fingerprint);
      assert.equal(saved.lrc, lyricsData.lrc);
      assert.equal(saved.source, 'lrclib');
      assert.ok(saved.updatedAt > 0);

      const retrieved = await LrclibClient.getLyricsFromVault(fingerprint);
      assert.ok(retrieved);
      assert.equal(retrieved.key, fingerprint);
      assert.equal(retrieved.lrc, lyricsData.lrc);
      assert.equal(retrieved.lyricsfile, lyricsData.lyricsfile);
      assert.equal(retrieved.metadata.title, 'Cached Song');
    });

    it('supports saving raw LRCLIB getLyrics output directly into vault', async () => {
      const cloudId = 'gdrive:1ABCXYZ999';
      const lrclibResponse = {
        id: 777,
        trackName: 'Direct LRCLIB Save',
        artistName: 'Artist A',
        albumName: 'Album B',
        duration: 195,
        syncedLyrics: '[00:12.34] Direct line',
        plainLyrics: 'Direct line',
        instrumental: false
      };

      await LrclibClient.saveLyricsToVault(cloudId, lrclibResponse);
      const cached = await LrclibClient.getLyricsFromVault(cloudId);

      assert.ok(cached);
      assert.equal(cached.key, cloudId);
      assert.equal(cached.lrc, '[00:12.34] Direct line');
      assert.equal(cached.metadata.title, 'Direct LRCLIB Save');
      assert.equal(cached.metadata.artist, 'Artist A');
      assert.equal(cached.metadata.duration, 195);
    });

    it('clears vault items with clearLyricsVault', async () => {
      await LrclibClient.saveLyricsToVault('to_be_cleared', { lrc: 'delete me' });
      const before = await LrclibClient.getLyricsFromVault('to_be_cleared');
      assert.ok(before);

      await LrclibClient.clearLyricsVault();
      const after = await LrclibClient.getLyricsFromVault('to_be_cleared');
      assert.equal(after, null);
    });

    it('returns null for non-existent vault key', async () => {
      const missing = await LrclibClient.getLyricsFromVault('non_existent_key_12345');
      assert.equal(missing, null);
    });

    it('works with custom / mocked IndexedDB factory', async () => {
      // Mock IndexedDB factory adhering to W3C IDB
      const mockStorage = new Map();
      const mockIdb = {
        open: (name, ver) => {
          const req = {
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
            result: {
              name,
              objectStoreNames: { contains: () => true },
              transaction: (storeName, mode) => ({
                objectStore: () => ({
                  put: (rec) => {
                    mockStorage.set(rec.key, rec);
                    const r = { onsuccess: null, onerror: null, result: rec.key };
                    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                    return r;
                  },
                  get: (key) => {
                    const r = { onsuccess: null, onerror: null, result: mockStorage.get(key) };
                    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                    return r;
                  }
                })
              })
            }
          };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }
      };

      const customKey = 'idb_test_key_01';
      await LrclibClient.saveLyricsToVault(customKey, { lrc: '[00:01.00] Mock IDB' }, mockIdb);
      const res = await LrclibClient.getLyricsFromVault(customKey, mockIdb);

      assert.ok(res);
      assert.equal(res.lrc, '[00:01.00] Mock IDB');
    });
  });

  describe('9. findLocalSidecarLyrics', () => {
    it('detects sibling .lrc file via FileSystemDirectoryHandle mock', async () => {
      const mockDirHandle = {
        getFileHandle: async (name) => {
          if (name === '01 - Hotel California.lrc') {
            return {
              name,
              getFile: async () => ({
                text: async () => '[00:15.00] On a dark desert highway'
              })
            };
          }
          throw new Error('Not found');
        }
      };

      const fileHandle = { name: '01 - Hotel California.flac' };
      const sidecar = await LrclibClient.findLocalSidecarLyrics(fileHandle, mockDirHandle);

      assert.ok(sidecar);
      assert.equal(sidecar.name, '01 - Hotel California.lrc');
      assert.equal(sidecar.extension, '.lrc');
      assert.equal(sidecar.type, 'lrc');
      assert.equal(sidecar.text, '[00:15.00] On a dark desert highway');
    });

    it('detects sibling .lyricsfile or .yaml file when .lrc is absent', async () => {
      const mockDirHandle = {
        getFileHandle: async (name) => {
          if (name === 'Track.lyricsfile') {
            return {
              name,
              getFile: async () => ({
                text: async () => 'version: "1.0"\nlines: []'
              })
            };
          }
          throw new Error('Not found');
        }
      };

      const sidecar = await LrclibClient.findLocalSidecarLyrics({ name: 'Track.wav' }, mockDirHandle);

      assert.ok(sidecar);
      assert.equal(sidecar.name, 'Track.lyricsfile');
      assert.equal(sidecar.extension, '.lyricsfile');
      assert.equal(sidecar.type, 'lyricsfile');
      assert.ok(sidecar.text.includes('version: "1.0"'));
    });

    it('falls back to .txt when other formats are absent', async () => {
      const mockDirHandle = {
        getFileHandle: async (name) => {
          if (name === 'Acoustic.txt') {
            return {
              name,
              getFile: async () => ({
                text: async () => 'Plain text lyrics without timestamps'
              })
            };
          }
          throw new Error('Not found');
        }
      };

      const sidecar = await LrclibClient.findLocalSidecarLyrics({ name: 'Acoustic.m4a' }, mockDirHandle);

      assert.ok(sidecar);
      assert.equal(sidecar.name, 'Acoustic.txt');
      assert.equal(sidecar.extension, '.txt');
      assert.equal(sidecar.type, 'txt');
    });

    it('works with Node.js filesystem paths', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sidecar-'));
      const audioPath = path.join(tempDir, 'MySong.mp3');
      const lrcPath = path.join(tempDir, 'MySong.lrc');

      fs.writeFileSync(audioPath, 'fake audio');
      fs.writeFileSync(lrcPath, '[00:02.00] Local Node Sidecar', 'utf8');

      return LrclibClient.findLocalSidecarLyrics('MySong.mp3', tempDir).then(sidecar => {
        assert.ok(sidecar);
        assert.equal(sidecar.name, 'MySong.lrc');
        assert.equal(sidecar.extension, '.lrc');
        assert.equal(sidecar.text, '[00:02.00] Local Node Sidecar');

        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });

    it('returns null when no sibling lyrics files exist', async () => {
      const mockDirHandle = {
        getFileHandle: async () => { throw new Error('Not found'); }
      };

      const sidecar = await LrclibClient.findLocalSidecarLyrics({ name: 'LoneSong.dsf' }, mockDirHandle);
      assert.equal(sidecar, null);
    });

    it('returns null on null or undefined arguments', async () => {
      assert.equal(await LrclibClient.findLocalSidecarLyrics(null, null), null);
      assert.equal(await LrclibClient.findLocalSidecarLyrics({ name: 'Track.mp3' }, null), null);
    });
  });

});
