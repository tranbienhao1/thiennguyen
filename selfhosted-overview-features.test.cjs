'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ── 1. buildSubsonicUrl ──

describe('buildSubsonicUrl — Subsonic REST API URL builder', () => {
  it('constructs correct URL with endpoint, action, and default parameters', () => {
    assert.equal(typeof library.buildSubsonicUrl, 'function', 'buildSubsonicUrl should be exported');
    const urlStr = library.buildSubsonicUrl('http://localhost:4533', 'ping.view', {}, { user: 'admin', pass: 'secret' });
    const url = new URL(urlStr);
    assert.equal(url.origin, 'http://localhost:4533');
    assert.ok(url.pathname.endsWith('/ping.view'));
    assert.equal(url.searchParams.get('u'), 'admin');
    assert.equal(url.searchParams.get('p'), 'secret');
    assert.equal(url.searchParams.get('v'), '1.16.1');
    assert.equal(url.searchParams.get('c'), 'nocturne');
    assert.equal(url.searchParams.get('f'), 'json');
  });

  it('handles endpoints without protocol and with trailing slashes', () => {
    const urlStr = library.buildSubsonicUrl('music.example.com:4533/rest/', 'getRandomSongs.view', { size: 50 }, { user: 'alice', pass: 'pw123' });
    const url = new URL(urlStr);
    assert.ok(url.protocol === 'http:' || url.protocol === 'https:');
    assert.ok(url.pathname.includes('/rest/getRandomSongs.view') || url.pathname.endsWith('/getRandomSongs.view'));
    assert.ok(!url.pathname.includes('//getRandomSongs.view'), 'No double slashes in path');
    assert.equal(url.searchParams.get('u'), 'alice');
    assert.equal(url.searchParams.get('size'), '50');
  });

  it('supports token and salt authentication (OpenSubsonic standard)', () => {
    const urlStr = library.buildSubsonicUrl('https://demo.navidrome.org', 'stream.view', { id: 'track-42' }, { user: 'user1', token: 'd41d8cd98f00b204e9800998ecf8427e', salt: 'c157a790d925' });
    const url = new URL(urlStr);
    assert.equal(url.searchParams.get('u'), 'user1');
    assert.equal(url.searchParams.get('t'), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(url.searchParams.get('s'), 'c157a790d925');
    assert.equal(url.searchParams.get('id'), 'track-42');
    assert.equal(url.searchParams.get('p'), null, 'Password param p must not be set when token auth is used');
  });

  it('returns empty string for null or empty endpoint', () => {
    assert.equal(library.buildSubsonicUrl('', 'ping.view'), '');
    assert.equal(library.buildSubsonicUrl(null, 'ping.view'), '');
    assert.equal(library.buildSubsonicUrl(undefined, 'ping.view'), '');
  });
});

// ── 2. parseSubsonicSong ──

describe('parseSubsonicSong — Convert Subsonic entry to Nocturne track', () => {
  it('parses typical Subsonic song entry with stream and cover URLs', () => {
    assert.equal(typeof library.parseSubsonicSong, 'function', 'parseSubsonicSong should be exported');
    const authConfig = { user: 'thien', pass: 'mypass' };
    const rawSong = {
      id: 'song-101',
      title: 'Time',
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      duration: 425,
      suffix: 'flac',
      bitDepth: 24,
      samplingRate: 96000,
      year: 1973,
      genre: 'Progressive Rock',
      coverArt: 'al-50'
    };
    const track = library.parseSubsonicSong(rawSong, 'https://subsonic.local:4040', authConfig);

    assert.equal(track.id, 'subsonic-song-101');
    assert.equal(track.title, 'Time');
    assert.equal(track.artist, 'Pink Floyd');
    assert.equal(track.album, 'The Dark Side of the Moon');
    assert.equal(track.duration, 425);
    assert.equal(track.format, 'FLAC');
    assert.equal(track.bitDepth, 24);
    assert.equal(track.sampleRate, 96000);
    assert.equal(track.year, 1973);
    assert.equal(track.genre, 'Progressive Rock');
    assert.equal(track.source, 'Subsonic');

    assert.ok(track.src.includes('stream.view'), 'src should be stream.view URL');
    assert.ok(track.src.includes('id=song-101'), 'src should include track id');
    assert.ok(track.cover.includes('getCoverArt.view'), 'cover should be getCoverArt.view URL');
    assert.ok(track.cover.includes('id=al-50') || track.cover.includes('id=song-101'), 'cover should include coverArt id');
  });

  it('provides safe defaults for missing optional fields', () => {
    const rawSong = { id: '999', title: 'Unknown Audio' };
    const track = library.parseSubsonicSong(rawSong, 'http://localhost:4533', { user: 'test' });
    assert.equal(track.id, 'subsonic-999');
    assert.equal(track.title, 'Unknown Audio');
    assert.equal(track.duration, 0);
    assert.equal(track.format, 'FLAC');
    assert.equal(track.bitDepth, 16);
    assert.equal(track.sampleRate, 44100);
    assert.equal(track.source, 'Subsonic');
  });

  it('safely handles null or undefined entries', () => {
    assert.equal(library.parseSubsonicSong(null, 'http://localhost:4533'), null);
    assert.equal(library.parseSubsonicSong(undefined, 'http://localhost:4533'), null);
  });
});

// ── 3. extractDecade & filterTracksByDecade ──

describe('extractDecade & filterTracksByDecade — Decade browsing', () => {
  it('extracts decade strings correctly from various year formats', () => {
    assert.equal(typeof library.extractDecade, 'function', 'extractDecade should be exported');
    assert.equal(library.extractDecade(1978), '1970s');
    assert.equal(library.extractDecade('1984'), '1980s');
    assert.equal(library.extractDecade(1999), '1990s');
    assert.equal(library.extractDecade(2005), '2000s');
    assert.equal(library.extractDecade(2014), '2010s');
    assert.equal(library.extractDecade(2023), '2020s');
    assert.equal(library.extractDecade(null), null);
    assert.equal(library.extractDecade('invalid'), null);
    assert.equal(library.extractDecade(-50), null);
    assert.equal(library.extractDecade(''), null);
  });

  it('filters track collections accurately by decade', () => {
    assert.equal(typeof library.filterTracksByDecade, 'function', 'filterTracksByDecade should be exported');
    const tracks = [
      { id: 't1', title: 'Track 1', year: 1975 },
      { id: 't2', title: 'Track 2', year: 1982 },
      { id: 't3', title: 'Track 3', year: '1989' },
      { id: 't4', title: 'Track 4', year: 2004 },
      { id: 't5', title: 'Track 5', year: 2021 },
      { id: 't6', title: 'Track 6', year: null }
    ];

    const eightees = library.filterTracksByDecade(tracks, '1980s');
    assert.equal(eightees.length, 2);
    assert.deepEqual(eightees.map(t => t.id), ['t2', 't3']);

    const seventies = library.filterTracksByDecade(tracks, '1970s');
    assert.equal(seventies.length, 1);
    assert.equal(seventies[0].id, 't1');

    const twenties = library.filterTracksByDecade(tracks, '2020s');
    assert.equal(twenties.length, 1);
    assert.equal(twenties[0].id, 't5');

    const empty = library.filterTracksByDecade(tracks, '1960s');
    assert.equal(empty.length, 0);
  });

  it('returns all tracks if decade is empty, null, or "all"', () => {
    const tracks = [{ id: 't1', year: 1980 }, { id: 't2', year: 1990 }];
    assert.equal(library.filterTracksByDecade(tracks, 'all').length, 2);
    assert.equal(library.filterTracksByDecade(tracks, null).length, 2);
    assert.equal(library.filterTracksByDecade(tracks, '').length, 2);
  });
});

// ── 4. isScrobbleEligible & buildListenBrainzPayload ──

describe('isScrobbleEligible & buildListenBrainzPayload — ListenBrainz scrobbling', () => {
  it('determines scrobble eligibility according to half-duration / 4-minute rule and 30s minimum', () => {
    assert.equal(typeof library.isScrobbleEligible, 'function', 'isScrobbleEligible should be exported');
    // Track < 30s is never eligible
    assert.equal(library.isScrobbleEligible(25, 25), false);
    assert.equal(library.isScrobbleEligible(15, 20), false);

    // Track = 60s: eligible at >= 30s
    assert.equal(library.isScrobbleEligible(29, 60), false);
    assert.equal(library.isScrobbleEligible(30, 60), true);
    assert.equal(library.isScrobbleEligible(50, 60), true);

    // Long track = 600s (10 min): threshold is Math.min(240, 300) = 240s
    assert.equal(library.isScrobbleEligible(200, 600), false);
    assert.equal(library.isScrobbleEligible(239, 600), false);
    assert.equal(library.isScrobbleEligible(240, 600), true);
    assert.equal(library.isScrobbleEligible(500, 600), true);

    // Edge cases
    assert.equal(library.isScrobbleEligible(0, 100), false);
    assert.equal(library.isScrobbleEligible(-5, 100), false);
    assert.equal(library.isScrobbleEligible(NaN, 100), false);
    assert.equal(library.isScrobbleEligible(50, NaN), false);
  });

  it('builds standard ListenBrainz JSON payloads for playing_now and single_listen', () => {
    assert.equal(typeof library.buildListenBrainzPayload, 'function', 'buildListenBrainzPayload should be exported');
    const track = {
      title: 'Comfortably Numb',
      artist: 'Pink Floyd',
      album: 'The Wall',
      duration: 382
    };

    const playingPayload = library.buildListenBrainzPayload(track, 'playing_now');
    assert.equal(playingPayload.listen_type, 'playing_now');
    assert.ok(Array.isArray(playingPayload.payload));
    assert.equal(playingPayload.payload.length, 1);
    assert.equal(playingPayload.payload[0].track_metadata.track_name, 'Comfortably Numb');
    assert.equal(playingPayload.payload[0].track_metadata.artist_name, 'Pink Floyd');
    assert.equal(playingPayload.payload[0].track_metadata.release_name, 'The Wall');
    assert.equal(playingPayload.payload[0].listened_at, undefined);

    const now = Math.floor(Date.now() / 1000);
    const listenPayload = library.buildListenBrainzPayload(track, 'single_listen', now);
    assert.equal(listenPayload.listen_type, 'single_listen');
    assert.equal(listenPayload.payload[0].listened_at, now);
    assert.equal(listenPayload.payload[0].track_metadata.track_name, 'Comfortably Numb');
  });
});

// ── 5. index.html DOM Elements & Configuration Integration ──

describe('index.html DOM & self-hosted features integration', () => {
  it('contains Subsonic connection controls in settings', () => {
    assert.ok(html.includes('id="subsonic-endpoint"'), '#subsonic-endpoint input must exist');
    assert.ok(html.includes('id="subsonic-user"'), '#subsonic-user input must exist');
    assert.ok(html.includes('id="subsonic-pass"'), '#subsonic-pass input must exist');
    assert.ok(html.includes('id="subsonic-connect-btn"'), '#subsonic-connect-btn button must exist');
    assert.ok(html.includes('id="subsonic-status"'), '#subsonic-status indicator must exist');
  });

  it('contains decade focus buttons in #roon-focus-bar', () => {
    assert.ok(html.includes('data-focus="decade-1980s"'), 'Decade 1980s button must exist');
    assert.ok(html.includes('data-focus="decade-1990s"'), 'Decade 1990s button must exist');
    assert.ok(html.includes('data-focus="decade-2000s"'), 'Decade 2000s button must exist');
    assert.ok(html.includes('data-focus="decade-2010s"'), 'Decade 2010s button must exist');
    assert.ok(html.includes('data-focus="decade-2020s"'), 'Decade 2020s button must exist');
  });

  it('contains ListenBrainz scrobble token input in settings', () => {
    assert.ok(html.includes('id="listenbrainz-token"'), '#listenbrainz-token input must exist');
    assert.ok(html.includes('id="listenbrainz-state"'), '#listenbrainz-state indicator must exist');
  });

  it('contains Subsonic config persistence identifier', () => {
    assert.ok(html.includes('nocturne-subsonic-config'), 'localStorage nocturne-subsonic-config must be referenced');
  });

  it('contains connectSubsonicServer and checkScrobbleEligibility functions in script', () => {
    assert.ok(html.includes('async function connectSubsonicServer(') || html.includes('connectSubsonicServer ='), 'connectSubsonicServer function must be defined');
    assert.ok(html.includes('function checkScrobbleEligibility(') || html.includes('checkScrobbleEligibility ='), 'checkScrobbleEligibility function must be defined');
  });

  it('includes Subsonic source option in source filter', () => {
    assert.ok(html.includes('<option value="Subsonic">Subsonic</option>'), 'Subsonic source filter option must exist');
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
