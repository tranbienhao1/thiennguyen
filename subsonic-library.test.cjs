'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const library = require('./library-utils.js');

describe('buildSubsonicUrl unit tests', () => {
  it('handles empty or null endpoint gracefully', () => {
    assert.equal(library.buildSubsonicUrl('', 'ping.view'), '');
    assert.equal(library.buildSubsonicUrl(null, 'ping.view'), '');
    assert.equal(library.buildSubsonicUrl(undefined, 'ping.view'), '');
  });

  it('prefixes http:// if protocol is missing', () => {
    const url = new URL(library.buildSubsonicUrl('localhost:4040', 'ping.view'));
    assert.equal(url.protocol, 'http:');
    assert.equal(url.hostname, 'localhost');
    assert.equal(url.port, '4040');
  });

  it('preserves https:// if provided', () => {
    const url = new URL(library.buildSubsonicUrl('https://myserver.cloud:8443', 'ping.view'));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'myserver.cloud');
    assert.equal(url.port, '8443');
  });

  it('correctly handles trailing slashes and /rest pathing', () => {
    const u1 = new URL(library.buildSubsonicUrl('http://myserver.org/', 'ping.view'));
    assert.equal(u1.pathname, '/rest/ping.view');

    const u2 = new URL(library.buildSubsonicUrl('http://myserver.org/rest/', 'ping.view'));
    assert.equal(u2.pathname, '/rest/ping.view');

    const u3 = new URL(library.buildSubsonicUrl('http://myserver.org', 'rest/ping.view'));
    assert.equal(u3.pathname, '/rest/ping.view');
  });

  it('supports username/password across different key conventions', () => {
    const url1 = new URL(library.buildSubsonicUrl('http://demo', 'ping.view', {}, { u: 'user_u', p: 'pass_p' }));
    assert.equal(url1.searchParams.get('u'), 'user_u');
    assert.equal(url1.searchParams.get('p'), 'pass_p');

    const url2 = new URL(library.buildSubsonicUrl('http://demo', 'ping.view', {}, { username: 'user_uname', password: 'pass_pword' }));
    assert.equal(url2.searchParams.get('u'), 'user_uname');
    assert.equal(url2.searchParams.get('p'), 'pass_pword');

    const url3 = new URL(library.buildSubsonicUrl('http://demo', 'ping.view', {}, { user: 'user_usr', pass: 'pass_pss' }));
    assert.equal(url3.searchParams.get('u'), 'user_usr');
    assert.equal(url3.searchParams.get('p'), 'pass_pss');
  });

  it('supports token and salt auth over password', () => {
    const url = new URL(library.buildSubsonicUrl('http://demo', 'ping.view', {}, { u: 'usr', token: 'tok123', salt: 'salt456', pass: 'ignored' }));
    assert.equal(url.searchParams.get('u'), 'usr');
    assert.equal(url.searchParams.get('t'), 'tok123');
    assert.equal(url.searchParams.get('s'), 'salt456');
    assert.equal(url.searchParams.get('p'), null);
  });

  it('combines custom params with default v, c, f params', () => {
    const url = new URL(library.buildSubsonicUrl('http://demo', 'stream.view', { id: 'tr-99', format: 'raw' }));
    assert.equal(url.searchParams.get('v'), '1.16.1');
    assert.equal(url.searchParams.get('c'), 'nocturne');
    assert.equal(url.searchParams.get('f'), 'json');
    assert.equal(url.searchParams.get('id'), 'tr-99');
    assert.equal(url.searchParams.get('format'), 'raw');
  });
});

describe('parseSubsonicSong unit tests', () => {
  it('returns null for non-object inputs', () => {
    assert.equal(library.parseSubsonicSong(null, 'http://demo'), null);
    assert.equal(library.parseSubsonicSong(undefined, 'http://demo'), null);
    assert.equal(library.parseSubsonicSong('string', 'http://demo'), null);
  });

  it('uses song id for cover if coverArt is omitted', () => {
    const track = library.parseSubsonicSong({ id: 'song-55', title: 'Song 55' }, 'http://demo:4533', { u: 'u1', p: 'p1' });
    assert.equal(track.id, 'subsonic-song-55');
    assert.ok(track.cover.includes('getCoverArt.view'));
    assert.ok(track.cover.includes('id=song-55'));
    assert.equal(track.format, 'FLAC');
    assert.equal(track.bitDepth, 16);
    assert.equal(track.sampleRate, 44100);
    assert.equal(track.source, 'Subsonic');
  });

  it('handles sampleRate when samplingRate is not specified', () => {
    const track = library.parseSubsonicSong({ id: 's1', title: 'Hi-Res', sampleRate: 192000, bitDepth: 24, suffix: 'wav' }, 'http://demo');
    assert.equal(track.format, 'WAV');
    assert.equal(track.bitDepth, 24);
    assert.equal(track.sampleRate, 192000);
  });
});

describe('extractDecade unit tests', () => {
  it('converts numbers to decades', () => {
    assert.equal(library.extractDecade(1965), '1960s');
    assert.equal(library.extractDecade(1970), '1970s');
    assert.equal(library.extractDecade(1989), '1980s');
    assert.equal(library.extractDecade(1990), '1990s');
    assert.equal(library.extractDecade(2000), '2000s');
    assert.equal(library.extractDecade(2018), '2010s');
    assert.equal(library.extractDecade(2025), '2020s');
  });

  it('converts date strings and 4-digit strings to decades', () => {
    assert.equal(library.extractDecade('1984'), '1980s');
    assert.equal(library.extractDecade('1973-03-01'), '1970s');
    assert.equal(library.extractDecade('Released in 2004'), '2000s');
  });

  it('returns null for invalid or out-of-range inputs', () => {
    assert.equal(library.extractDecade(null), null);
    assert.equal(library.extractDecade(undefined), null);
    assert.equal(library.extractDecade(''), null);
    assert.equal(library.extractDecade('unknown'), null);
    assert.equal(library.extractDecade(0), null);
    assert.equal(library.extractDecade(-1980), null);
    assert.equal(library.extractDecade(999), null);
    assert.equal(library.extractDecade(10000), null);
  });
});

describe('filterTracksByDecade unit tests', () => {
  const catalog = [
    { id: '1', title: 'Track 70s', year: 1978 },
    { id: '2', title: 'Track 80s A', year: '1982' },
    { id: '3', title: 'Track 80s B', decade: '1980s' },
    { id: '4', title: 'Track 90s date', date: '1994-05-01' },
    { id: '5', title: 'No date track' }
  ];

  it('filters accurately by year, decade, and date properties', () => {
    const d80 = library.filterTracksByDecade(catalog, '1980s');
    assert.equal(d80.length, 2);
    assert.deepEqual(d80.map(t => t.id), ['2', '3']);

    const d70 = library.filterTracksByDecade(catalog, '1970s');
    assert.equal(d70.length, 1);
    assert.equal(d70[0].id, '1');

    const d90 = library.filterTracksByDecade(catalog, '1990s');
    assert.equal(d90.length, 1);
    assert.equal(d90[0].id, '4');
  });

  it('returns all tracks when decade is empty or "all"', () => {
    assert.equal(library.filterTracksByDecade(catalog, 'all').length, 5);
    assert.equal(library.filterTracksByDecade(catalog, '').length, 5);
    assert.equal(library.filterTracksByDecade(catalog, null).length, 5);
  });

  it('returns empty array when tracks is not an array', () => {
    assert.deepEqual(library.filterTracksByDecade(null, '1980s'), []);
  });
});

describe('isScrobbleEligible unit tests', () => {
  it('rejects tracks under 30 seconds', () => {
    assert.equal(library.isScrobbleEligible(29, 29), false);
    assert.equal(library.isScrobbleEligible(15, 20), false);
    assert.equal(library.isScrobbleEligible(29.9, 29.9), false);
  });

  it('requires 50% for tracks under 480 seconds', () => {
    assert.equal(library.isScrobbleEligible(14.9, 30), false);
    assert.equal(library.isScrobbleEligible(15, 30), true);
    assert.equal(library.isScrobbleEligible(59.9, 120), false);
    assert.equal(library.isScrobbleEligible(60, 120), true);
  });

  it('caps requirement at 240 seconds for long tracks', () => {
    // 600s track: 50% is 300s, but cap is 240s
    assert.equal(library.isScrobbleEligible(239.9, 600), false);
    assert.equal(library.isScrobbleEligible(240, 600), true);
    assert.equal(library.isScrobbleEligible(300, 600), true);
  });

  it('handles invalid inputs safely', () => {
    assert.equal(library.isScrobbleEligible(NaN, 100), false);
    assert.equal(library.isScrobbleEligible(100, NaN), false);
    assert.equal(library.isScrobbleEligible(-10, 60), false);
    assert.equal(library.isScrobbleEligible(null, 60), false);
  });
});

describe('buildListenBrainzPayload unit tests', () => {
  const sampleTrack = {
    title: 'Echoes',
    artist: 'Pink Floyd',
    album: 'Meddle',
    duration: 1414,
    trackNumber: 6,
    source: 'Subsonic'
  };

  it('builds playing_now payload without listened_at', () => {
    const payload = library.buildListenBrainzPayload(sampleTrack, 'playing_now');
    assert.equal(payload.listen_type, 'playing_now');
    assert.equal(payload.payload.length, 1);
    assert.equal(payload.payload[0].listened_at, undefined);
    assert.equal(payload.payload[0].track_metadata.track_name, 'Echoes');
    assert.equal(payload.payload[0].track_metadata.artist_name, 'Pink Floyd');
    assert.equal(payload.payload[0].track_metadata.release_name, 'Meddle');
    assert.equal(payload.payload[0].track_metadata.additional_info.duration_ms, 1414000);
    assert.equal(payload.payload[0].track_metadata.additional_info.tracknumber, 6);
    assert.equal(payload.payload[0].track_metadata.additional_info.music_service, 'Subsonic');
  });

  it('builds single_listen payload with timestamp from seconds or ms or Date', () => {
    const payloadSec = library.buildListenBrainzPayload(sampleTrack, 'single_listen', 1690000000);
    assert.equal(payloadSec.listen_type, 'single_listen');
    assert.equal(payloadSec.payload[0].listened_at, 1690000000);

    const payloadMs = library.buildListenBrainzPayload(sampleTrack, 'single_listen', 1690000000000);
    assert.equal(payloadMs.payload[0].listened_at, 1690000000);

    const d = new Date(1690000000000);
    const payloadDate = library.buildListenBrainzPayload(sampleTrack, 'single_listen', d);
    assert.equal(payloadDate.payload[0].listened_at, 1690000000);
  });

  it('defaults to current timestamp if timestamp not supplied for single_listen', () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = library.buildListenBrainzPayload(sampleTrack);
    const after = Math.floor(Date.now() / 1000);
    assert.equal(payload.listen_type, 'single_listen');
    assert.ok(payload.payload[0].listened_at >= before && payload.payload[0].listened_at <= after);
  });
});
