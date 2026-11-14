'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Album Sequential Playback vs Songs Random Shuffle — UI Integration', async (t) => {
  await t.test('1. state initialization includes playbackContext: null', () => {
    assert.match(indexHtml, /playbackContext:\s*null/, 'state must initialize playbackContext to null');
  });

  await t.test('2. #album-hero-play sets album playback context and queues remaining tracks', () => {
    assert.ok(
      indexHtml.includes("state.playbackContext = { type: 'album', key: entry.key, name: entry.name, trackIds: entry.tracks.map(t => t.id) };"),
      '#album-hero-play must set state.playbackContext with type album'
    );
    assert.ok(
      indexHtml.includes('state.queueTrackIds = entry.tracks.slice(1).map(t => t.id);'),
      '#album-hero-play must queue remaining album tracks'
    );
    assert.ok(
      indexHtml.includes('Đang phát Album: ${entry.name} (Tuần tự bài 1 đến hết)'),
      '#album-hero-play toast must announce sequential album playback'
    );
  });

  await t.test('3. Track row click inside album view resolves album queue and sets playback context', () => {
    assert.ok(
      indexHtml.includes('handleTrackRowActivation'),
      'track row activation handler must exist'
    );
    assert.ok(
      indexHtml.includes('lib.resolveAlbumPlaybackQueue(rowTrackId, albumTracks)'),
      'track row click must call resolveAlbumPlaybackQueue for album view'
    );
    assert.ok(
      indexHtml.includes('state.queueTrackIds = queueResult.remainingTrackIds'),
      'track row click must set queueTrackIds to remainingTrackIds from resolveAlbumPlaybackQueue'
    );
  });

  await t.test('4. Playing from songs page sets playbackContext to songs', () => {
    assert.ok(
      indexHtml.includes("state.playbackContext = { type: 'songs' };"),
      'playing from songs page must set state.playbackContext to songs'
    );
  });

  await t.test('5. playNext and queueIndex enforce sequential progression and bypass shuffle for album context', () => {
    assert.ok(
      indexHtml.includes('lib.shouldEnforceSequentialPlayback(state.playbackContext)'),
      'playNext and queueIndex must query shouldEnforceSequentialPlayback'
    );
    assert.ok(
      indexHtml.includes('lib.resolveNextSequentialTrack(state.currentId, albumTracks, direction, { repeat: state.repeat })'),
      'playNext must advance via resolveNextSequentialTrack'
    );
    assert.ok(
      indexHtml.includes('lib.resolveNextSequentialTrack(state.currentId, albumTracks, 1, { repeat: state.repeat })'),
      'queueIndex must check next track via resolveNextSequentialTrack'
    );
  });

  await t.test('6. Strictly preserves Web Audio API graph invariant', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio API graph invariant must be strictly preserved'
    );
  });
});
