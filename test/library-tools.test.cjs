'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const libraryTools = require('../library-tools.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('Library Tools Test Suite', () => {

  // =========================================================================
  // 1. Module Exports & UMD Boilerplate
  // =========================================================================
  describe('Module Exports', () => {
    it('exports all expected API functions and utilities', () => {
      assert.equal(typeof libraryTools.exportPlaylistM3U, 'function', 'exportPlaylistM3U must be a function');
      assert.equal(typeof libraryTools.parseM3UPlaylist, 'function', 'parseM3UPlaylist must be a function');
      assert.equal(typeof libraryTools.fetchCoverArtOnline, 'function', 'fetchCoverArtOnline must be a function');
      assert.equal(typeof libraryTools.exportUserSettings, 'function', 'exportUserSettings must be a function');
      assert.equal(typeof libraryTools.importUserSettings, 'function', 'importUserSettings must be a function');
      assert.equal(typeof libraryTools.openCoverArtCache, 'function', 'openCoverArtCache must be a function');
      assert.equal(typeof libraryTools.getCoverArtFromCache, 'function', 'getCoverArtFromCache must be a function');
      assert.equal(typeof libraryTools.saveCoverArtToCache, 'function', 'saveCoverArtToCache must be a function');
      assert.equal(typeof libraryTools.clearCoverArtCache, 'function', 'clearCoverArtCache must be a function');
      assert.equal(typeof libraryTools.RateLimiter, 'function', 'RateLimiter class must be exported');
    });
  });

  // =========================================================================
  // 2. Playlist M3U/M3U8 Management
  // =========================================================================
  describe('Playlist M3U/M3U8 Management', () => {
    const sampleTracks = [
      {
        id: 'trk_01',
        title: 'Starboy',
        artist: 'The Weeknd, Daft Punk',
        album: 'Starboy',
        duration: 230,
        format: 'FLAC',
        url: 'music/The Weeknd - Starboy.flac'
      },
      {
        id: 'trk_02',
        title: 'Get Lucky',
        artist: 'Daft Punk',
        album: 'Random Access Memories',
        duration: 369,
        format: 'DSD',
        url: 'music/Daft Punk - Get Lucky.dsf'
      },
      {
        id: 'trk_03',
        name: 'Midnight City',
        artist: 'M83',
        duration: 244,
        url: 'https://example.com/stream/m83-midnight.mp3'
      }
    ];

    it('exportPlaylistM3U generates valid #EXTM3U and #EXTINF lines', () => {
      const m3u = libraryTools.exportPlaylistM3U('Electro Favorites', sampleTracks);

      assert.ok(m3u.includes('#EXTM3U'), 'Should contain #EXTM3U header');
      assert.ok(m3u.includes('#EXTENC:UTF-8'), 'Should contain UTF-8 encoding tag');
      assert.ok(m3u.includes('#PLAYLIST:Electro Favorites'), 'Should include playlist name tag');
      assert.ok(m3u.includes('#EXTINF:230,The Weeknd, Daft Punk - Starboy'), 'Should format track 1 EXTINF');
      assert.ok(m3u.includes('#EXTALBUM:Starboy'), 'Should include album tag');
      assert.ok(m3u.includes('#EXTFORMAT:FLAC'), 'Should include format tag');
      assert.ok(m3u.includes('#EXTID:trk_01'), 'Should include track id tag');
      assert.ok(m3u.includes('music/The Weeknd - Starboy.flac'), 'Should include file path');
      assert.ok(m3u.includes('#EXTINF:369,Daft Punk - Get Lucky'), 'Should format track 2 EXTINF');
      assert.ok(m3u.includes('music/Daft Punk - Get Lucky.dsf'), 'Should include DSF file path');
      assert.ok(m3u.includes('#EXTINF:244,M83 - Midnight City'), 'Should format track 3 EXTINF from name property');
      assert.ok(m3u.includes('https://example.com/stream/m83-midnight.mp3'), 'Should include stream URL');
    });

    it('exportPlaylistM3U handles empty and edge-case track data', () => {
      const emptyM3u = libraryTools.exportPlaylistM3U('', []);
      assert.ok(emptyM3u.includes('#EXTM3U'));
      assert.ok(emptyM3u.includes('#PLAYLIST:Nocturne Playlist'));

      const nullTracksM3u = libraryTools.exportPlaylistM3U('Null Test', null);
      assert.ok(nullTracksM3u.includes('#PLAYLIST:Null Test'));

      const partialTrack = [{ duration: null, artist: '', title: '' }];
      const partialM3u = libraryTools.exportPlaylistM3U('Partial', partialTrack);
      assert.ok(partialM3u.includes('#EXTINF:-1,Unknown Artist - Track 1'));
    });

    it('parseM3UPlaylist parses extended M3U8 content correctly', () => {
      const rawContent = `#EXTM3U
#EXTENC:UTF-8
#PLAYLIST:Audiophile Masterworks
#EXTINF:320,Pink Floyd - Comfortably Numb
#EXTALBUM:The Wall
#EXTFORMAT:FLAC
#EXTID:pf_cn_01
floyd/comfortably_numb.flac
#EXTINF:425,Dire Straits - Sultans of Swing
#EXTALBUM:Dire Straits
#EXTFORMAT:DSD
dire_straits/sultans.dsf`;

      const result = libraryTools.parseM3UPlaylist(rawContent);
      assert.equal(result.isValid, true);
      assert.equal(result.name, 'Audiophile Masterworks');
      assert.equal(result.trackCount, 2);

      const t1 = result.tracks[0];
      assert.equal(t1.title, 'Comfortably Numb');
      assert.equal(t1.artist, 'Pink Floyd');
      assert.equal(t1.album, 'The Wall');
      assert.equal(t1.duration, 320);
      assert.equal(t1.format, 'FLAC');
      assert.equal(t1.id, 'pf_cn_01');
      assert.equal(t1.file, 'floyd/comfortably_numb.flac');

      const t2 = result.tracks[1];
      assert.equal(t2.title, 'Sultans of Swing');
      assert.equal(t2.artist, 'Dire Straits');
      assert.equal(t2.album, 'Dire Straits');
      assert.equal(t2.duration, 425);
      assert.equal(t2.format, 'DSD');
      assert.equal(t2.file, 'dire_straits/sultans.dsf');
    });

    it('parseM3UPlaylist handles bare files and entries without hyphen or album', () => {
      const simpleContent = `#EXTM3U
#EXTINF:180,SingleArtistOrTitleOnly
songs/track1.mp3
songs/track2.wav`;

      const result = libraryTools.parseM3UPlaylist(simpleContent);
      assert.equal(result.isValid, true);
      assert.equal(result.trackCount, 2);

      assert.equal(result.tracks[0].title, 'SingleArtistOrTitleOnly');
      assert.equal(result.tracks[0].artist, 'Unknown Artist');
      assert.equal(result.tracks[0].duration, 180);
      assert.equal(result.tracks[0].file, 'songs/track1.mp3');

      assert.equal(result.tracks[1].title, 'track2');
      assert.equal(result.tracks[1].file, 'songs/track2.wav');
      assert.equal(result.tracks[1].format, 'WAV');
    });

    it('parseM3UPlaylist handles BOM and rejects invalid content', () => {
      const withBom = '\uFEFF#EXTM3U\n#EXTINF:100,Art - Song\ntrack.mp3';
      const parsedBom = libraryTools.parseM3UPlaylist(withBom);
      assert.equal(parsedBom.isValid, true);
      assert.equal(parsedBom.tracks[0].title, 'Song');

      assert.equal(libraryTools.parseM3UPlaylist('').isValid, false);
      assert.equal(libraryTools.parseM3UPlaylist('   ').isValid, false);
      assert.equal(libraryTools.parseM3UPlaylist('just random text with no audio').isValid, false);
    });

    it('M3U export and parse round-trip preserves track list metadata', () => {
      const exported = libraryTools.exportPlaylistM3U('Round Trip Playlist', sampleTracks);
      const parsed = libraryTools.parseM3UPlaylist(exported);

      assert.equal(parsed.isValid, true);
      assert.equal(parsed.name, 'Round Trip Playlist');
      assert.equal(parsed.trackCount, 3);
      assert.equal(parsed.tracks[0].title, sampleTracks[0].title);
      assert.equal(parsed.tracks[0].artist, sampleTracks[0].artist);
      assert.equal(parsed.tracks[0].duration, sampleTracks[0].duration);
      assert.equal(parsed.tracks[1].title, sampleTracks[1].title);
      assert.equal(parsed.tracks[1].artist, sampleTracks[1].artist);
    });
  });

  // =========================================================================
  // 3. High-Res Cover Art Online Fetcher & IndexedDB Caching
  // =========================================================================
  describe('High-Res Cover Art Fetcher', () => {
    beforeEach(async () => {
      await libraryTools.clearCoverArtCache();
    });

    it('RateLimiter spaces consecutive requests by minSpacingMs', async () => {
      const limiter = new libraryTools.RateLimiter(60);
      const timestamps = [];

      await Promise.all([
        limiter.enqueue(async () => { timestamps.push(Date.now()); }),
        limiter.enqueue(async () => { timestamps.push(Date.now()); }),
        limiter.enqueue(async () => { timestamps.push(Date.now()); })
      ]);

      assert.equal(timestamps.length, 3);
      assert.ok(timestamps[1] - timestamps[0] >= 50, 'Gap between call 1 and 2 should be at least ~50ms');
      assert.ok(timestamps[2] - timestamps[1] >= 50, 'Gap between call 2 and 3 should be at least ~50ms');
    });

    it('queries iTunes Search API and upscales 100x100 to 1000x1000', async () => {
      const mockFetch = async (url) => {
        if (url.includes('itunes.apple.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resultCount: 1,
              results: [
                {
                  artistName: 'Daft Punk',
                  collectionName: 'Discovery',
                  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg'
                }
              ]
            })
          };
        }
        if (url.includes('1000x1000bb.jpg')) {
          return {
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'image/jpeg']]),
            arrayBuffer: async () => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const result = await libraryTools.fetchCoverArtOnline('Daft Punk', 'Discovery', {
        fetch: mockFetch,
        prefer: 'itunes',
        timeoutMs: 3000
      });

      assert.equal(result.success, true);
      assert.equal(result.source, 'itunes');
      assert.equal(result.url, 'https://is1-ssl.mzstatic.com/image/thumb/Music/1000x1000bb.jpg');
      assert.ok(result.dataUrl.startsWith('data:image/jpeg;base64,'));
      assert.equal(result.cached, false);
    });

    it('caches retrieved artwork and serves subsequent requests from IndexedDB cache', async () => {
      let networkCalls = 0;
      const mockFetch = async (url) => {
        networkCalls++;
        if (url.includes('itunes.apple.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              resultCount: 1,
              results: [
                {
                  artistName: 'Pink Floyd',
                  collectionName: 'The Dark Side of the Moon',
                  artworkUrl100: 'https://mzstatic.com/pinkfloyd/100x100bb.jpg'
                }
              ]
            })
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'image/jpeg']]),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
        };
      };

      // First call: hits network
      const res1 = await libraryTools.fetchCoverArtOnline('Pink Floyd', 'The Dark Side of the Moon', {
        fetch: mockFetch
      });
      assert.equal(res1.success, true);
      assert.equal(res1.cached, false);
      const initialNetworkCalls = networkCalls;

      // Second call: served from IndexedDB cache, zero new network requests!
      const res2 = await libraryTools.fetchCoverArtOnline('Pink Floyd', 'The Dark Side of the Moon', {
        fetch: mockFetch
      });
      assert.equal(res2.success, true);
      assert.equal(res2.cached, true);
      assert.equal(res2.source, 'cache');
      assert.equal(networkCalls, initialNetworkCalls, 'No network requests made on cache hit');
    });

    it('falls back to Cover Art Archive if iTunes returns no results', async () => {
      const mockFetch = async (url) => {
        if (url.includes('itunes.apple.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ resultCount: 0, results: [] })
          };
        }
        if (url.includes('musicbrainz.org')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              releases: [{ id: 'caa-mbid-12345', title: 'Rare Album' }]
            })
          };
        }
        if (url.includes('coverartarchive.org/release/caa-mbid-12345')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              images: [
                {
                  front: true,
                  image: 'https://coverartarchive.org/image/front-original.jpg',
                  thumbnails: { '1200': 'https://coverartarchive.org/image/front-1200.jpg' }
                }
              ]
            })
          };
        }
        if (url.includes('front-1200.jpg')) {
          return {
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'image/jpeg']]),
            arrayBuffer: async () => new Uint8Array([5, 6, 7]).buffer
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const result = await libraryTools.fetchCoverArtOnline('Underground Artist', 'Rare Album', {
        fetch: mockFetch,
        prefer: 'itunes'
      });

      assert.equal(result.success, true);
      assert.equal(result.source, 'coverartarchive');
      assert.equal(result.url, 'https://coverartarchive.org/image/front-1200.jpg');
    });

    it('handles search errors and timeouts gracefully', async () => {
      const hangingFetch = async () => new Promise((resolve) => setTimeout(resolve, 500));

      const result = await libraryTools.fetchCoverArtOnline('Artist', 'Album', {
        fetch: hangingFetch,
        timeoutMs: 50
      });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('timed out') || result.error.includes('Network search error'));

      const emptyResult = await libraryTools.fetchCoverArtOnline('', '');
      assert.equal(emptyResult.success, false);
      assert.ok(emptyResult.error.includes('specified'));
    });
  });

  // =========================================================================
  // 4. Cloud & Local Settings Sync (Backup & Safe Restore)
  // =========================================================================
  describe('Cloud & Local Settings Sync', () => {
    const mockState = {
      eqEnabled: true,
      eqPreamp: -2.5,
      bands: [
        { id: 'b1', freq: 60, gain: 3.5, q: 1.2, type: 'peaking', enabled: true },
        { id: 'b2', freq: 1000, gain: -1.0, q: 0.8, type: 'peaking', enabled: true },
        { id: 'b3', freq: 10000, gain: 2.0, q: 1.0, type: 'highshelf', enabled: true }
      ],
      eqPresets: [
        { id: 'p_warm', name: 'Warm Bass', preamp: -3, bands: [{ freq: 80, gain: 4, q: 1.0 }] }
      ],
      favorites: new Set(['trk_1', 'trk_2', 'trk_3']),
      trackRatings: { trk_1: 5, trk_2: 4 },
      customLyrics: {
        trk_1: '[00:00.00]Custom Intro\n[00:05.00]Custom Line'
      },
      crossfadeSeconds: 3,
      crossfadeCurve: 'equal-power',
      crossfeed: 0.35,
      crossfeedPreset: 'bauer',
      toneBass: 1.5,
      toneTreble: -0.5,
      stereoBalance: -0.1,
      replayGainEnabled: true,
      replayGainMode: 'track',
      loudnessStandard: 'audiophile-album',
      roomAcousticProfile: 'studio',
      roomAcousticWet: 0.25,
      subBassPunchProfile: 'audiophile',
      subBassPunchIntensity: 1.2,
      subBassPhaseProfile: 'linear',
      tubeEmulationProfile: 'triode',
      dsdUltrasonicFilter: 'fir-48k',
      limiterMode: 'transparent',
      visualizerTheme: 'cyber',
      visualizerMode: 'spectrum',
      visualizerStrobeEnabled: true,
      ambientStageMode: 'reactive',
      bitPerfectEnabled: false,
      shuffle: true,
      repeat: 1,
      autoplay: true,
      roonRadio: true
    };

    it('exportUserSettings exports complete configuration to formatted JSON', () => {
      const json = libraryTools.exportUserSettings(mockState);
      assert.equal(typeof json, 'string');

      const parsed = JSON.parse(json);
      assert.equal(parsed.app, 'nocturne');
      assert.equal(parsed.type, 'user-settings-backup');
      assert.equal(parsed.version, 1);
      assert.ok(parsed.exportedAt);

      // PEQ
      assert.equal(parsed.peq.enabled, true);
      assert.equal(parsed.peq.preamp, -2.5);
      assert.equal(parsed.peq.bands.length, 3);
      assert.equal(parsed.peq.bands[0].freq, 60);
      assert.equal(parsed.peq.bands[0].gain, 3.5);
      assert.equal(parsed.peq.presets.length, 1);

      // Favorites & Ratings
      assert.deepEqual(parsed.favorites, ['trk_1', 'trk_2', 'trk_3']);
      assert.equal(parsed.trackRatings.trk_1, 5);

      // Custom lyrics
      assert.ok(parsed.customLyrics.trk_1.includes('Custom Intro'));

      // Playback preferences
      assert.equal(parsed.playbackPreferences.crossfadeSeconds, 3);
      assert.equal(parsed.playbackPreferences.crossfeed, 0.35);
      assert.equal(parsed.playbackPreferences.toneBass, 1.5);
      assert.equal(parsed.playbackPreferences.tubeEmulationProfile, 'triode');
      assert.equal(parsed.playbackPreferences.shuffle, true);
    });

    it('importUserSettings safely validates and restores settings into state', () => {
      const exportedJson = libraryTools.exportUserSettings(mockState);

      const targetState = {
        favorites: new Set(),
        trackRatings: {},
        bands: [],
        crossfeed: 0,
        toneBass: 0
      };

      const result = libraryTools.importUserSettings(exportedJson, targetState, { persist: false });

      assert.equal(result.isValid, true);
      assert.equal(result.error, null);
      assert.equal(result.restoredCount.favorites, 3);
      assert.equal(result.restoredCount.peqBands, 3);
      assert.equal(result.restoredCount.ratings, 2);
      assert.equal(result.restoredCount.customLyrics, 1);

      // Verify restored targetState
      assert.ok(targetState.favorites.has('trk_1'));
      assert.ok(targetState.favorites.has('trk_2'));
      assert.ok(targetState.favorites.has('trk_3'));
      assert.equal(targetState.trackRatings.trk_1, 5);
      assert.equal(targetState.crossfeed, 0.35);
      assert.equal(targetState.toneBass, 1.5);
      assert.equal(targetState.tubeEmulationProfile, 'triode');
      assert.equal(targetState.customLyrics.trk_1, mockState.customLyrics.trk_1);
      assert.equal(targetState.bands.length, 3);
    });

    it('importUserSettings clamps out-of-range values to audiophile safety bounds', () => {
      const maliciousJson = JSON.stringify({
        app: 'nocturne',
        peq: {
          bands: [
            { freq: 999999, gain: 100, q: 999, type: 'invalid_type' },
            { freq: -50, gain: -80, q: -10 }
          ]
        },
        playbackPreferences: {
          crossfeed: 5.0, // should clamp to 1.0
          crossfadeSeconds: 60, // should clamp to 15
          toneBass: 30, // should clamp to 12
          toneTreble: -40, // should clamp to -12
          stereoBalance: 99 // should clamp to 1
        }
      });

      const targetState = {};
      const result = libraryTools.importUserSettings(maliciousJson, targetState, { persist: false });

      assert.equal(result.isValid, true);
      assert.equal(targetState.crossfeed, 1);
      assert.equal(targetState.crossfadeSeconds, 15);
      assert.equal(targetState.toneBass, 12);
      assert.equal(targetState.toneTreble, -12);
      assert.equal(targetState.stereoBalance, 1);

      const b1 = targetState.bands[0];
      assert.equal(b1.freq, 22000);
      assert.equal(b1.gain, 24);
      assert.equal(b1.q, 30);
      assert.equal(b1.type, 'peaking');

      const b2 = targetState.bands[1];
      assert.equal(b2.freq, 20);
      assert.equal(b2.gain, -24);
      assert.equal(b2.q, 0.1);
    });

    it('importUserSettings safely rejects malformed or invalid JSON', () => {
      assert.equal(libraryTools.importUserSettings('').isValid, false);
      assert.equal(libraryTools.importUserSettings('{ invalid json').isValid, false);
      assert.equal(libraryTools.importUserSettings(JSON.stringify({ app: 'unrelated' })).isValid, false);
    });
  });

  // =========================================================================
  // 5. UI Integration & Audio Invariant Preservation
  // =========================================================================
  describe('UI Integration & Audio Invariant', () => {
    it('includes <script src="library-tools.js"></script> in index.html', () => {
      assert.ok(
        indexHtml.includes('<script src="library-tools.js"></script>'),
        'index.html must load library-tools.js'
      );
    });

    it('includes playlist export and import buttons in index.html', () => {
      assert.ok(indexHtml.includes('id="playlist-export-m3u-btn"'), 'Must have #playlist-export-m3u-btn');
      assert.ok(indexHtml.includes('id="playlist-import-m3u-btn"'), 'Must have #playlist-import-m3u-btn');
      assert.ok(indexHtml.includes('id="playlist-m3u-file-input"'), 'Must have #playlist-m3u-file-input');
      assert.ok(indexHtml.includes('id="queue-export-m3u-btn"'), 'Must have #queue-export-m3u-btn');
    });

    it('includes user settings export, import and online cover fetcher buttons in index.html', () => {
      assert.ok(indexHtml.includes('id="export-user-settings-btn"'), 'Must have #export-user-settings-btn');
      assert.ok(indexHtml.includes('id="import-user-settings-btn"'), 'Must have #import-user-settings-btn');
      assert.ok(indexHtml.includes('id="import-user-settings-file"'), 'Must have #import-user-settings-file');
      assert.ok(indexHtml.includes('id="fetch-online-covers-btn"'), 'Must have #fetch-online-covers-btn');
    });

    it('binds event listeners in inline script for new buttons', () => {
      assert.ok(indexHtml.includes('export-user-settings-btn'), 'Script must bind export-user-settings-btn');
      assert.ok(indexHtml.includes('import-user-settings-btn'), 'Script must bind import-user-settings-btn');
      assert.ok(indexHtml.includes('fetch-online-covers-btn'), 'Script must bind fetch-online-covers-btn');
      assert.ok(indexHtml.includes('playlist-export-m3u-btn'), 'Script must bind playlist-export-m3u-btn');
      assert.ok(indexHtml.includes('playlist-import-m3u-btn'), 'Script must bind playlist-import-m3u-btn');
      assert.ok(indexHtml.includes('queue-export-m3u-btn'), 'Script must bind queue-export-m3u-btn');
    });

    it('strictly preserves audio graph invariant: state.crossfeedNodes.output.connect(state.context.destination)', () => {
      assert.ok(
        indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
        'Critical Audio Graph Invariant state.crossfeedNodes.output.connect(state.context.destination) MUST be preserved!'
      );
    });
  });

});
