'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ── 1. buildBlackCandyAuthHeader ──

describe('buildBlackCandyAuthHeader — Black Candy API Token Header Builder', () => {
  it('constructs correct Authorization and Accept headers for valid token', () => {
    assert.equal(typeof library.buildBlackCandyAuthHeader, 'function', 'buildBlackCandyAuthHeader should be exported');
    const headers = library.buildBlackCandyAuthHeader('secret-api-token-12345');
    assert.deepEqual(headers, {
      'Authorization': 'Token token=secret-api-token-12345',
      'Accept': 'application/json'
    });
  });

  it('trims leading and trailing whitespace from token', () => {
    const headers = library.buildBlackCandyAuthHeader('   whitespace-token-xyz   ');
    assert.equal(headers['Authorization'], 'Token token=whitespace-token-xyz');
    assert.equal(headers['Accept'], 'application/json');
  });

  it('handles null, undefined, or empty token gracefully', () => {
    assert.equal(library.buildBlackCandyAuthHeader(null)['Authorization'], 'Token token=');
    assert.equal(library.buildBlackCandyAuthHeader(undefined)['Authorization'], 'Token token=');
    assert.equal(library.buildBlackCandyAuthHeader('')['Authorization'], 'Token token=');
  });
});

// ── 2. buildBlackCandyUrl ──

describe('buildBlackCandyUrl — Black Candy Endpoint and REST URL builder', () => {
  it('normalizes endpoint missing protocol, strips trailing slash, and appends path', () => {
    assert.equal(typeof library.buildBlackCandyUrl, 'function', 'buildBlackCandyUrl should be exported');
    const urlStr = library.buildBlackCandyUrl('localhost:3000/', '/songs');
    const url = new URL(urlStr);
    assert.equal(url.origin, 'http://localhost:3000');
    assert.equal(url.pathname, '/songs');
  });

  it('preserves https protocol and custom port', () => {
    const urlStr = library.buildBlackCandyUrl('https://music.blackcandy.org:8443', '/sessions');
    const url = new URL(urlStr);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.host, 'music.blackcandy.org:8443');
    assert.equal(url.pathname, '/sessions');
  });

  it('serializes query parameters properly for streaming and playlists', () => {
    const urlStr = library.buildBlackCandyUrl(
      'http://blackcandy.local:3000',
      'stream/new',
      { song_id: 42, format: 'raw' }
    );
    const url = new URL(urlStr);
    assert.equal(url.pathname, '/stream/new');
    assert.equal(url.searchParams.get('song_id'), '42');
    assert.equal(url.searchParams.get('format'), 'raw');
  });

  it('handles transcoded_stream/new URL builder', () => {
    const urlStr = library.buildBlackCandyUrl(
      'http://blackcandy.local:3000',
      '/transcoded_stream/new',
      { song_id: '99' }
    );
    const url = new URL(urlStr);
    assert.equal(url.pathname, '/transcoded_stream/new');
    assert.equal(url.searchParams.get('song_id'), '99');
  });

  it('safely returns empty string for empty, null, or invalid endpoint', () => {
    assert.equal(library.buildBlackCandyUrl('', '/songs'), '');
    assert.equal(library.buildBlackCandyUrl(null, '/songs'), '');
    assert.equal(library.buildBlackCandyUrl(undefined, '/songs'), '');
  });
});

// ── 3. parseBlackCandySong ──

describe('parseBlackCandySong — Black Candy Song Payload Parser', () => {
  const sampleRawSong = {
    id: 101,
    name: 'Dancing In The Moonlight',
    artist_name: 'King Harvest',
    album_name: 'Dancing in the Moonlight',
    duration: 178,
    format: 'flac',
    album_image_urls: {
      small: 'http://localhost:3000/media/small.jpg',
      medium: 'http://localhost:3000/media/medium.jpg',
      large: 'http://localhost:3000/media/large.jpg'
    },
    is_favorited: true,
    lyrics_url: 'http://localhost:3000/songs/101/lyrics'
  };

  it('parses raw song in Direct Lossless Stream mode', () => {
    assert.equal(typeof library.parseBlackCandySong, 'function', 'parseBlackCandySong should be exported');
    const track = library.parseBlackCandySong(sampleRawSong, 'http://localhost:3000', { transcode: false });

    assert.equal(track.id, 'blackcandy-101');
    assert.equal(track.title, 'Dancing In The Moonlight');
    assert.equal(track.artist, 'King Harvest');
    assert.equal(track.album, 'Dancing in the Moonlight');
    assert.equal(track.duration, 178);
    assert.equal(track.format, 'FLAC');
    assert.equal(track.src, 'http://localhost:3000/stream/new?song_id=101');
    assert.equal(track.cover, 'http://localhost:3000/media/large.jpg');
    assert.equal(track.isFavorited, true);
    assert.equal(track.lyricsUrl, 'http://localhost:3000/songs/101/lyrics');
    assert.equal(track.source, 'Black Candy');
  });

  it('parses raw song in Transcoded Stream mode (mp3)', () => {
    const track = library.parseBlackCandySong(sampleRawSong, 'http://localhost:3000', { transcode: true });

    assert.equal(track.id, 'blackcandy-101');
    assert.equal(track.format, 'FLAC'); // rawSong has format 'flac', transcode mode retains or uppercases format
    assert.equal(track.src, 'http://localhost:3000/transcoded_stream/new?song_id=101');
    assert.equal(track.source, 'Black Candy');
  });

  it('handles fallback to MP3 when rawSong format is missing during transcode', () => {
    const songNoFormat = { ...sampleRawSong, format: null };
    const track = library.parseBlackCandySong(songNoFormat, 'http://localhost:3000', { transcode: true });
    assert.equal(track.format, 'MP3');
  });

  it('handles fallbacks for missing cover art sizes, artist, and album', () => {
    const sparseSong = {
      id: 202,
      name: 'Unknown Gems',
      album_image_urls: {
        medium: 'http://localhost:3000/media/medium.jpg'
      }
    };
    const track = library.parseBlackCandySong(sparseSong, 'http://localhost:3000');
    assert.equal(track.artist, 'Unknown Artist');
    assert.equal(track.album, 'Unknown Album');
    assert.equal(track.duration, 0);
    assert.equal(track.cover, 'http://localhost:3000/media/medium.jpg');
    assert.equal(track.isFavorited, false);
  });

  it('returns null for null or invalid song payload', () => {
    assert.equal(library.parseBlackCandySong(null, 'http://localhost:3000'), null);
    assert.equal(library.parseBlackCandySong(undefined, 'http://localhost:3000'), null);
  });
});

// ── 4. parseLrcWithOffsetAndTags ──

describe('parseLrcWithOffsetAndTags — Black Candy LRC Parser with Offset & Word Tag Stripping', () => {
  it('parses standard LRC lines with timestamps and texts', () => {
    assert.equal(typeof library.parseLrcWithOffsetAndTags, 'function', 'parseLrcWithOffsetAndTags should be exported');
    const lrc = `
[00:01.00]First line
[00:05.50]Second line
[00:10.00]Third line
    `;
    const lines = library.parseLrcWithOffsetAndTags(lrc);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].time, 1.0);
    assert.equal(lines[0].text, 'First line');
    assert.equal(lines[1].time, 5.5);
    assert.equal(lines[1].text, 'Second line');
    assert.equal(lines[2].time, 10.0);
    assert.equal(lines[2].text, 'Third line');
  });

  it('supports [offset: +/-ms] tag to adjust timestamps', () => {
    const lrcPositiveOffset = `
[offset: 500]
[00:02.00]Adjusted forward by 0.5s
    `;
    const linesPos = library.parseLrcWithOffsetAndTags(lrcPositiveOffset);
    assert.equal(linesPos.length, 1);
    assert.equal(linesPos[0].time, 2.5);
    assert.equal(linesPos[0].text, 'Adjusted forward by 0.5s');

    const lrcNegativeOffset = `
[offset: -1000]
[00:05.00]Adjusted back by 1s
    `;
    const linesNeg = library.parseLrcWithOffsetAndTags(lrcNegativeOffset);
    assert.equal(linesNeg.length, 1);
    assert.equal(linesNeg[0].time, 4.0);
    assert.equal(linesNeg[0].text, 'Adjusted back by 1s');
  });

  it('strips inline karaoke word tags <mm:ss.xx> while retaining clean lyric text', () => {
    const karaokeLrc = `
[00:12.30]<00:12.30>We <00:12.50>are <00:12.80>the <00:13.10>champions
    `;
    const lines = library.parseLrcWithOffsetAndTags(karaokeLrc);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].time, 12.3);
    assert.equal(lines[0].text, 'We are the champions');
  });

  it('skips metadata tags like [ar:], [ti:], [al:], [by:], [offset:], [length:]', () => {
    const metaLrc = `
[ti: Bohemian Rhapsody]
[ar: Queen]
[al: A Night at the Opera]
[by: AudioFan]
[length: 05:55]
[offset: 200]
[00:01.00]Is this the real life?
[00:05.00]Is this just fantasy?
    `;
    const lines = library.parseLrcWithOffsetAndTags(metaLrc);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].time, 1.2); // 1.00 + 0.2s offset
    assert.equal(lines[0].text, 'Is this the real life?');
    assert.equal(lines[1].time, 5.2); // 5.00 + 0.2s offset
    assert.equal(lines[1].text, 'Is this just fantasy?');
  });

  it('handles multi-timestamp lines by expanding and chronologically sorting entries', () => {
    const multiLrc = `
[00:10.00][00:25.00] Repeated chorus hook
[00:05.00] Intro verse
    `;
    const lines = library.parseLrcWithOffsetAndTags(multiLrc);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].time, 5.0);
    assert.equal(lines[0].text, 'Intro verse');
    assert.equal(lines[1].time, 10.0);
    assert.equal(lines[1].text, 'Repeated chorus hook');
    assert.equal(lines[2].time, 25.0);
    assert.equal(lines[2].text, 'Repeated chorus hook');
  });

  it('returns empty array for empty, non-string, or invalid lrc input', () => {
    assert.deepEqual(library.parseLrcWithOffsetAndTags(''), []);
    assert.deepEqual(library.parseLrcWithOffsetAndTags(null), []);
    assert.deepEqual(library.parseLrcWithOffsetAndTags(undefined), []);
  });
});

// ── 5. Smart Queue utilities ──

describe('Smart Queue Utilities — smartQueuePlayNext, smartQueueAppend, smartQueueReorder', () => {
  it('smartQueuePlayNext inserts song immediately after currentIndex', () => {
    assert.equal(typeof library.smartQueuePlayNext, 'function', 'smartQueuePlayNext should be exported');
    const queue = [
      { id: 'track-1', title: 'Track 1' },
      { id: 'track-2', title: 'Track 2' },
      { id: 'track-3', title: 'Track 3' }
    ];
    const newSong = { id: 'track-next', title: 'Track Next' };

    const result = library.smartQueuePlayNext(queue, 0, newSong);
    assert.equal(result.length, 4);
    assert.equal(result[1].id, 'track-next');
    assert.equal(result[0].id, 'track-1');
    assert.equal(result[2].id, 'track-2');
    assert.equal(result[3].id, 'track-3');
  });

  it('smartQueuePlayNext moves existing song to currentIndex + 1 without duplication', () => {
    const queue = [
      { id: 'track-1', title: 'Track 1' },
      { id: 'track-2', title: 'Track 2' },
      { id: 'track-3', title: 'Track 3' },
      { id: 'track-4', title: 'Track 4' }
    ];
    // Move track-4 to play next after track-1 (currentIndex = 0)
    const result = library.smartQueuePlayNext(queue, 0, { id: 'track-4' });
    assert.equal(result.length, 4, 'Queue length must not grow when moving existing song');
    assert.deepEqual(result.map(t => t.id), ['track-1', 'track-4', 'track-2', 'track-3']);
  });

  it('smartQueuePlayNext works with primitive values and empty initial queue', () => {
    const emptyResult = library.smartQueuePlayNext([], 0, 'solo-track');
    assert.deepEqual(emptyResult, ['solo-track']);

    const numQueue = [10, 20, 30];
    const numResult = library.smartQueuePlayNext(numQueue, 1, 30);
    assert.deepEqual(numResult, [10, 20, 30]);
  });

  it('smartQueueAppend adds song to end of queue if not present, leaves in place if exists', () => {
    assert.equal(typeof library.smartQueueAppend, 'function', 'smartQueueAppend should be exported');
    const queue = [
      { id: 'track-1', title: 'Track 1' },
      { id: 'track-2', title: 'Track 2' }
    ];

    const added = library.smartQueueAppend(queue, { id: 'track-3', title: 'Track 3' });
    assert.equal(added.length, 3);
    assert.equal(added[2].id, 'track-3');

    // Attempt appending existing track-1 -> should not duplicate
    const noDup = library.smartQueueAppend(added, { id: 'track-1' });
    assert.equal(noDup.length, 3, 'Queue length must remain unchanged when appending existing song');
    assert.deepEqual(noDup.map(t => t.id), ['track-1', 'track-2', 'track-3']);
  });

  it('smartQueueReorder moves item from fromIndex to toIndex with boundary clamping', () => {
    assert.equal(typeof library.smartQueueReorder, 'function', 'smartQueueReorder should be exported');
    const queue = ['A', 'B', 'C', 'D'];

    // Move D (index 3) to index 1
    const reordered1 = library.smartQueueReorder(queue, 3, 1);
    assert.deepEqual(reordered1, ['A', 'D', 'B', 'C']);

    // Move A (index 0) to end (index 3)
    const reordered2 = library.smartQueueReorder(reordered1, 0, 3);
    assert.deepEqual(reordered2, ['D', 'B', 'C', 'A']);

    // Out-of-bounds toIndex clamped to last index
    const reorderedClamped = library.smartQueueReorder(['X', 'Y', 'Z'], 0, 999);
    assert.deepEqual(reorderedClamped, ['Y', 'Z', 'X']);
  });
});

// ── 6. index.html DOM Elements & Integration ──

describe('index.html DOM & Black Candy Integration', () => {
  it('contains Black Candy server connection inputs and buttons in Settings', () => {
    assert.ok(html.includes('id="blackcandy-endpoint"'), '#blackcandy-endpoint input must exist');
    assert.ok(html.includes('id="blackcandy-token"'), '#blackcandy-token input must exist');
    assert.ok(html.includes('id="blackcandy-connect-btn"'), '#blackcandy-connect-btn button must exist');
    assert.ok(html.includes('id="blackcandy-sync-btn"'), '#blackcandy-sync-btn button must exist');
    assert.ok(html.includes('id="blackcandy-transcode-mode"'), '#blackcandy-transcode-mode selector must exist');
    assert.ok(html.includes('id="blackcandy-status"'), '#blackcandy-status indicator must exist');
  });

  it('integrates Black Candy option into #source-filter dropdown', () => {
    assert.ok(
      html.includes('<option value="Black Candy">Black Candy</option>') ||
      html.includes('value="Black Candy"'),
      'Black Candy must be an option in #source-filter'
    );
  });

  it('persists Black Candy configuration in localStorage key nocturne-blackcandy-config', () => {
    assert.ok(
      html.includes('nocturne-blackcandy-config'),
      'localStorage nocturne-blackcandy-config key must be referenced'
    );
  });

  it('contains queue action controls for Play Next and Append', () => {
    assert.ok(
      html.includes('data-queue-action="play_next"'),
      'data-queue-action="play_next" button must exist'
    );
    assert.ok(
      html.includes('data-queue-action="append"'),
      'data-queue-action="append" button must exist'
    );
    assert.ok(
      html.includes('id="context-menu-play-next"'),
      '#context-menu-play-next must exist'
    );
    assert.ok(
      html.includes('id="context-menu-append-queue"'),
      '#context-menu-append-queue must exist'
    );
  });

  it('defines Black Candy client & queue management functions in script', () => {
    assert.ok(
      html.includes('connectBlackCandyServer'),
      'connectBlackCandyServer must be defined'
    );
    assert.ok(
      html.includes('syncBlackCandySongs'),
      'syncBlackCandySongs must be defined'
    );
    assert.ok(
      html.includes('handlePlayNext'),
      'handlePlayNext must be defined'
    );
    assert.ok(
      html.includes('handleAppendQueue'),
      'handleAppendQueue must be defined'
    );
  });

  it('implements 4-second auto-scroll suspension and resume delay for lyrics', () => {
    assert.ok(
      html.includes('suspendLyricsAutoScroll'),
      'suspendLyricsAutoScroll must be defined'
    );
    assert.ok(
      html.includes('resumeLyricsAutoScroll'),
      'resumeLyricsAutoScroll must be defined'
    );
    assert.ok(
      html.includes('4000'),
      '4000ms delay must be present for auto-scroll suspension'
    );
  });
});

// ── 7. Audio Graph Invariant Preservation ──

describe('Audio Graph Invariant Preservation', () => {
  it('strictly preserves state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'state.crossfeedNodes.output.connect(state.context.destination) must be literally preserved'
    );
  });
});
