'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ── 1. buildJellyfinUrl ──

describe('buildJellyfinUrl — Jellyfin REST API URL builder', () => {
  it('constructs correct URL with endpoint, path, query parameters, and api_key', () => {
    assert.equal(typeof library.buildJellyfinUrl, 'function', 'buildJellyfinUrl should be exported');
    const urlStr = library.buildJellyfinUrl(
      'http://localhost:8096',
      '/Audio/item-123/stream',
      { static: true },
      'my-secret-token'
    );
    const url = new URL(urlStr);
    assert.equal(url.origin, 'http://localhost:8096');
    assert.equal(url.pathname, '/Audio/item-123/stream');
    assert.equal(url.searchParams.get('static'), 'true');
    assert.equal(url.searchParams.get('api_key'), 'my-secret-token');
  });

  it('normalizes endpoints missing protocol and strips trailing slashes', () => {
    const urlStr = library.buildJellyfinUrl(
      'jellyfin.local:8096/',
      'Items/album-99/Images/Primary',
      { maxWidth: 500, quality: 90 },
      'api-token-xyz'
    );
    const url = new URL(urlStr);
    assert.equal(url.protocol, 'http:');
    assert.equal(url.host, 'jellyfin.local:8096');
    assert.equal(url.pathname, '/Items/album-99/Images/Primary');
    assert.equal(url.searchParams.get('maxWidth'), '500');
    assert.equal(url.searchParams.get('quality'), '90');
    assert.equal(url.searchParams.get('api_key'), 'api-token-xyz');
  });

  it('preserves https endpoints and handles api_key passed in params', () => {
    const urlStr = library.buildJellyfinUrl(
      'https://music.home-server.org:8443',
      '/Users/user-1/Items',
      { includeItemTypes: 'Audio', recursive: true, apiKey: 'token-in-params' }
    );
    const url = new URL(urlStr);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.host, 'music.home-server.org:8443');
    assert.equal(url.pathname, '/Users/user-1/Items');
    assert.equal(url.searchParams.get('includeItemTypes'), 'Audio');
    assert.equal(url.searchParams.get('recursive'), 'true');
    assert.equal(url.searchParams.get('api_key'), 'token-in-params');
  });

  it('returns empty string for empty, null, or invalid endpoints', () => {
    assert.equal(library.buildJellyfinUrl('', '/Audio/1/stream'), '');
    assert.equal(library.buildJellyfinUrl(null, '/Audio/1/stream'), '');
    assert.equal(library.buildJellyfinUrl(undefined, '/Audio/1/stream'), '');
  });
});

// ── 2. parseJellyfinItem ──

describe('parseJellyfinItem — Convert Jellyfin Item to Nocturne Track', () => {
  it('parses full Jellyfin Audio item with streaming & cover art URLs', () => {
    assert.equal(typeof library.parseJellyfinItem, 'function', 'parseJellyfinItem should be exported');
    const rawItem = {
      Id: 'jf-item-404',
      AlbumId: 'jf-album-505',
      Name: 'Starman',
      Artists: ['David Bowie'],
      AlbumArtist: 'David Bowie',
      Album: 'The Rise and Fall of Ziggy Stardust',
      RunTimeTicks: 2540000000, // 254 seconds
      Container: 'flac',
      MediaStreams: [
        {
          BitDepth: 24,
          SampleRate: 96000
        }
      ],
      ProductionYear: 1972,
      Genres: ['Glam Rock', 'Classic Rock'],
      IndexNumber: 4,
      ParentIndexNumber: 1
    };

    const track = library.parseJellyfinItem(rawItem, 'http://192.168.1.50:8096', 'jf-token-abc');

    assert.equal(track.id, 'jellyfin-jf-item-404');
    assert.equal(track.title, 'Starman');
    assert.equal(track.artist, 'David Bowie');
    assert.equal(track.albumArtist, 'David Bowie');
    assert.equal(track.album, 'The Rise and Fall of Ziggy Stardust');
    assert.equal(track.duration, 254);
    assert.equal(track.format, 'FLAC');
    assert.equal(track.bitDepth, 24);
    assert.equal(track.sampleRate, 96000);
    assert.equal(track.year, 1972);
    assert.equal(track.genre, 'Glam Rock');
    assert.equal(track.source, 'Jellyfin');
    assert.equal(track.trackNumber, 4);
    assert.equal(track.discNumber, 1);

    assert.ok(track.src.includes('/Audio/jf-item-404/stream'));
    assert.ok(track.src.includes('static=true'));
    assert.ok(track.src.includes('api_key=jf-token-abc'));

    assert.ok(track.cover.includes('/Items/jf-album-505/Images/Primary'));
    assert.ok(track.cover.includes('maxWidth=500'));
    assert.ok(track.cover.includes('api_key=jf-token-abc'));
  });

  it('joins multiple artists with commas', () => {
    const rawItem = {
      Id: 'feat-1',
      Name: 'Get Lucky',
      Artists: ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'],
      AlbumArtist: 'Daft Punk',
      Album: 'Random Access Memories',
      RunTimeTicks: 3690000000,
      Container: 'm4a'
    };
    const track = library.parseJellyfinItem(rawItem, 'http://localhost:8096', 'token');
    assert.equal(track.artist, 'Daft Punk, Pharrell Williams, Nile Rodgers');
    assert.equal(track.albumArtist, 'Daft Punk');
    assert.equal(track.format, 'M4A');
    assert.equal(track.duration, 369);
  });

  it('provides safe fallback values for missing optional fields', () => {
    const minimalItem = {
      Id: 'min-1'
    };
    const track = library.parseJellyfinItem(minimalItem, 'http://localhost:8096', 'token');
    assert.equal(track.id, 'jellyfin-min-1');
    assert.equal(track.title, 'Unknown Title');
    assert.equal(track.artist, 'Unknown Artist');
    assert.equal(track.albumArtist, 'Unknown Artist');
    assert.equal(track.album, '');
    assert.equal(track.duration, 0);
    assert.equal(track.format, 'FLAC');
    assert.equal(track.bitDepth, 16);
    assert.equal(track.sampleRate, 44100);
    assert.equal(track.source, 'Jellyfin');
    assert.ok(track.cover.includes('/Items/min-1/Images/Primary'), 'Uses itemId as cover fallback when AlbumId missing');
  });

  it('returns null for null or non-object item', () => {
    assert.equal(library.parseJellyfinItem(null, 'http://localhost:8096'), null);
    assert.equal(library.parseJellyfinItem(undefined, 'http://localhost:8096'), null);
    assert.equal(library.parseJellyfinItem('string', 'http://localhost:8096'), null);
  });
});

// ── 3. groupTracksByAlbumArtist ──

describe('groupTracksByAlbumArtist — Compilation & Album Artist Grouping', () => {
  it('groups tracks by albumArtist to prevent compilation fragmentation', () => {
    assert.equal(typeof library.groupTracksByAlbumArtist, 'function', 'groupTracksByAlbumArtist should be exported');
    const tracks = [
      { id: '1', title: 'Lose Yourself to Dance', artist: 'Daft Punk feat. Pharrell', albumArtist: 'Daft Punk' },
      { id: '2', title: 'Instant Crush', artist: 'Daft Punk feat. Julian Casablancas', albumArtist: 'Daft Punk' },
      { id: '3', title: 'Heroes', artist: 'David Bowie', albumArtist: 'David Bowie' },
      { id: '4', title: 'Life on Mars?', artist: 'David Bowie', albumArtist: 'David Bowie' },
      { id: '5', title: 'Solo Track', artist: 'Miles Davis' } // fallback artist
    ];

    const groups = library.groupTracksByAlbumArtist(tracks);
    assert.ok(Array.isArray(groups), 'Should return an array of groups');
    assert.equal(groups.length, 3);

    const daftPunkGroup = groups.find(g => g.albumArtist === 'Daft Punk');
    assert.ok(daftPunkGroup, 'Daft Punk group must exist');
    assert.equal(daftPunkGroup.tracks.length, 2);
    assert.deepEqual(daftPunkGroup.tracks.map(t => t.id), ['1', '2']);

    const bowieGroup = groups.find(g => g.albumArtist === 'David Bowie');
    assert.ok(bowieGroup, 'David Bowie group must exist');
    assert.equal(bowieGroup.tracks.length, 2);

    const milesGroup = groups.find(g => g.albumArtist === 'Miles Davis');
    assert.ok(milesGroup, 'Miles Davis group must exist');
    assert.equal(milesGroup.tracks.length, 1);
  });

  it('supports property and get/has method access on groups collection', () => {
    const tracks = [
      { id: '1', title: 'Track A', albumArtist: 'Pink Floyd' },
      { id: '2', title: 'Track B', albumArtist: 'Pink Floyd' }
    ];
    const groups = library.groupTracksByAlbumArtist(tracks);
    assert.equal(groups['Pink Floyd'].length, 2);
    assert.equal(groups.get('Pink Floyd').length, 2);
    assert.equal(groups.has('Pink Floyd'), true);
    assert.equal(groups.has('Non-existent'), false);
  });

  it('safely handles empty array or invalid inputs', () => {
    assert.deepEqual(library.groupTracksByAlbumArtist([]), []);
    assert.deepEqual(library.groupTracksByAlbumArtist(null), []);
    assert.deepEqual(library.groupTracksByAlbumArtist(undefined), []);
  });
});

// ── 4. calculatePlaybackRate ──

describe('calculatePlaybackRate — Audio Tempo & Playback Speed Control', () => {
  it('clamps playback rate within bounds [0.5, 2.0] and rounds to 2 decimal places', () => {
    assert.equal(typeof library.calculatePlaybackRate, 'function', 'calculatePlaybackRate should be exported');
    assert.equal(library.calculatePlaybackRate(1.0), 1.0);
    assert.equal(library.calculatePlaybackRate(0.75), 0.75);
    assert.equal(library.calculatePlaybackRate(1.25), 1.25);
    assert.equal(library.calculatePlaybackRate(1.5), 1.5);

    // Bounds clamping
    assert.equal(library.calculatePlaybackRate(0.2), 0.5, 'Clamps sub-0.5 to 0.5');
    assert.equal(library.calculatePlaybackRate(3.0), 2.0, 'Clamps above-2.0 to 2.0');
    assert.equal(library.calculatePlaybackRate(0.5), 0.5);
    assert.equal(library.calculatePlaybackRate(2.0), 2.0);

    // Rounding
    assert.equal(library.calculatePlaybackRate(1.1234), 1.12);
    assert.equal(library.calculatePlaybackRate(1.126), 1.13);
  });

  it('handles strings and invalid inputs with safe default 1.0', () => {
    assert.equal(library.calculatePlaybackRate('1.25'), 1.25);
    assert.equal(library.calculatePlaybackRate('0.85'), 0.85);
    assert.equal(library.calculatePlaybackRate(null), 1.0);
    assert.equal(library.calculatePlaybackRate(undefined), 1.0);
    assert.equal(library.calculatePlaybackRate(''), 1.0);
    assert.equal(library.calculatePlaybackRate('invalid'), 1.0);
    assert.equal(library.calculatePlaybackRate(NaN), 1.0);
  });
});

// ── 5. index.html DOM Elements & Integration ──

describe('index.html DOM & Self-Hosted Ecosystem Integration', () => {
  it('contains Jellyfin server connection inputs and button in Settings', () => {
    assert.ok(html.includes('id="jellyfin-endpoint"'), '#jellyfin-endpoint input must exist');
    assert.ok(html.includes('id="jellyfin-token"'), '#jellyfin-token input must exist');
    assert.ok(html.includes('id="jellyfin-user-id"'), '#jellyfin-user-id input must exist');
    assert.ok(html.includes('id="jellyfin-connect-btn"'), '#jellyfin-connect-btn button must exist');
    assert.ok(html.includes('id="jellyfin-status"'), '#jellyfin-status status feedback must exist');
  });

  it('contains Tauon Compact Mini Player HUD and toggle button', () => {
    assert.ok(html.includes('id="mini-player-hud"'), '#mini-player-hud container must exist');
    assert.ok(html.includes('id="mini-player-toggle"'), '#mini-player-toggle button must exist');
    assert.ok(html.includes('id="mini-cover"'), '#mini-cover element must exist inside HUD');
    assert.ok(html.includes('id="mini-title"'), '#mini-title element must exist inside HUD');
    assert.ok(html.includes('id="mini-artist"'), '#mini-artist element must exist inside HUD');
    assert.ok(html.includes('id="mini-waveform"'), '#mini-waveform canvas must exist inside HUD');
    assert.ok(html.includes('id="mini-play"'), '#mini-play control must exist inside HUD');
    assert.ok(html.includes('id="mini-next"'), '#mini-next control must exist inside HUD');
    assert.ok(html.includes('id="mini-expand"'), '#mini-expand control must exist inside HUD');
  });

  it('contains Playback Rate selector in EQ / audio settings panel', () => {
    assert.ok(html.includes('id="playback-rate-select"'), '#playback-rate-select dropdown must exist');
    assert.ok(html.includes('value="0.75"'), '0.75x rate option must exist');
    assert.ok(html.includes('value="1"'), '1.0x normal rate option must exist');
    assert.ok(html.includes('value="1.25"'), '1.25x rate option must exist');
    assert.ok(html.includes('value="1.5"'), '1.5x rate option must exist');
  });

  it('integrates Jellyfin option into #source-filter', () => {
    assert.ok(
      html.includes('<option value="Jellyfin">Jellyfin</option>'),
      'Jellyfin must be an option in #source-filter'
    );
  });

  it('persists Jellyfin configuration under nocturne-jellyfin-config in localStorage', () => {
    assert.ok(
      html.includes('nocturne-jellyfin-config'),
      'localStorage nocturne-jellyfin-config key must be referenced'
    );
  });

  it('defines connectJellyfinServer, toggleMiniPlayerHud, and updateMiniPlayerHud in script', () => {
    assert.ok(
      html.includes('async function connectJellyfinServer(') || html.includes('connectJellyfinServer ='),
      'connectJellyfinServer must be defined'
    );
    assert.ok(
      html.includes('function toggleMiniPlayerHud(') || html.includes('toggleMiniPlayerHud ='),
      'toggleMiniPlayerHud must be defined'
    );
    assert.ok(
      html.includes('function updateMiniPlayerHud(') || html.includes('updateMiniPlayerHud ='),
      'updateMiniPlayerHud must be defined'
    );
  });
});

// ── 6. Audio routing invariant ──

describe('Audio Graph Invariant Preservation', () => {
  it('strictly preserves state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'state.crossfeedNodes.output.connect(state.context.destination) must be literally preserved'
    );
  });
});
