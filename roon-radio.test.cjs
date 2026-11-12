'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Roon Radio — selectRoonRadioTrack pure recommendation logic', () => {
  assert.equal(typeof lib.selectRoonRadioTrack, 'function', 'selectRoonRadioTrack should be exported by NocturneLibrary');

  // Test 1: Null/empty inputs
  assert.equal(lib.selectRoonRadioTrack(null, null), null);
  assert.equal(lib.selectRoonRadioTrack(null, []), null);
  assert.equal(lib.selectRoonRadioTrack({ id: 't1' }, [{ id: 't1' }]), null);

  // Test 2: Same artist recommendation
  const pool1 = [
    { id: '1', artist: 'Daft Punk', album: 'Discovery', title: 'One More Time' },
    { id: '2', artist: 'Daft Punk', album: 'Random Access Memories', title: 'Get Lucky' },
    { id: '3', artist: 'Justice', album: 'Cross', title: 'Genesis' },
    { id: '4', artist: 'Kraftwerk', album: 'Computer World', title: 'Computer Love' }
  ];
  const pickArtist = lib.selectRoonRadioTrack(pool1[0], pool1);
  assert.ok(pickArtist && pickArtist.track);
  assert.equal(pickArtist.track.id, '2', 'Should prioritize same artist track');
  assert.ok(pickArtist.reason.includes('Daft Punk'));

  // Test 3: Same album recommendation (compilation album with different artists)
  const pool2 = [
    { id: 'c1', artist: 'Miles Davis', album: 'Kind of Blue', title: 'So What' },
    { id: 'c2', artist: 'John Coltrane', album: 'Kind of Blue', title: 'Freddie Freeloader' },
    { id: 'c3', artist: 'Bill Evans', album: 'Portrait in Jazz', title: 'Autumn Leaves' }
  ];
  const pickAlbum = lib.selectRoonRadioTrack(pool2[0], pool2, { excludeIds: ['c1'] });
  assert.equal(pickAlbum.track.id, 'c2', 'Should pick track from same album if available');
  assert.ok(pickAlbum.reason.includes('Kind of Blue'));

  // Test 4: Favorites boost
  const pool3 = [
    { id: 'a1', artist: 'Artist A', title: 'Song 1' },
    { id: 'b1', artist: 'Artist B', title: 'Song 2' },
    { id: 'c1', artist: 'Artist C', title: 'Song 3' }
  ];
  const pickFav = lib.selectRoonRadioTrack(pool3[0], pool3, {
    favorites: new Set(['c1'])
  });
  assert.equal(pickFav.track.id, 'c1', 'Should pick favorite song when artists are all different');
  assert.equal(pickFav.reason, 'Từ bài hát yêu thích');

  // Test 5: Recent tracks penalty (avoid repeat loop)
  const pool4 = [
    { id: 'm1', artist: 'Muse', title: 'Uprising' },
    { id: 'm2', artist: 'Muse', title: 'Supermassive Black Hole' },
    { id: 'm3', artist: 'Radiohead', title: 'Creep' }
  ];
  const pickAvoidRecent = lib.selectRoonRadioTrack(pool4[0], pool4, {
    recentHistory: ['m2'] // m2 was just played
  });
  assert.equal(pickAvoidRecent.track.id, 'm3', 'Should choose m3 because m2 recently played despite being same artist');

  // Test 6: DSD/Hi-Res format affinity
  const pool5 = [
    { id: 'd1', isDsd: true, format: 'DSF', artist: 'Classical', title: 'Symphony 1' },
    { id: 'd2', isDsd: true, format: 'DSF', artist: 'Other', title: 'Concerto' },
    { id: 'mp3', isDsd: false, format: 'MP3', artist: 'Other', title: 'Pop' }
  ];
  const pickDsd = lib.selectRoonRadioTrack(pool5[0], pool5);
  assert.equal(pickDsd.track.id, 'd2', 'Should prioritize DSD candidate over MP3 when listening to DSD');
});

test('Roon Radio — UI markup and script integration tests', () => {
  // Check DOM elements exist in HTML
  assert.ok(html.includes('id="roon-radio-banner"'), 'HTML should define #roon-radio-banner');
  assert.ok(html.includes('id="roon-radio-badge"'), 'HTML should define #roon-radio-badge');
  assert.ok(html.includes('id="roon-radio-hint"'), 'HTML should define #roon-radio-hint');
  assert.ok(html.includes('id="roon-radio-toggle"'), 'HTML should define #roon-radio-toggle');

  // Check script wiring
  assert.ok(html.includes('updateRoonRadioStatus()'), 'index.html should define and call updateRoonRadioStatus');
  assert.ok(html.includes("$('roon-radio-toggle').addEventListener('click'"), 'roon-radio-toggle button should have click listener');
  assert.ok(html.includes('selectRoonRadioTrack'), 'queueIndex and playNext should integrate selectRoonRadioTrack');
  assert.ok(html.includes("localStorage.setItem('nocturne-roon-radio'"), 'Roon Radio setting should persist in localStorage');
});

console.log('Roon Radio unit & integration tests passed.');
