'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const {
  resolveAlbumPlaybackQueue,
  resolveNextSequentialTrack,
  shouldEnforceSequentialPlayback,
  formatPlaybackContextSummary
} = library;

describe('Album Sequential Playback vs Songs Random Shuffle — Pure Utilities', () => {

  const sampleAlbumTracks = [
    { id: 'track-01', title: 'Come Together', album: 'Abbey Road', trackNumber: 1, duration: 259 },
    { id: 'track-02', title: 'Something', album: 'Abbey Road', trackNumber: 2, duration: 182 },
    { id: 'track-03', title: "Maxwell's Silver Hammer", album: 'Abbey Road', trackNumber: 3, duration: 207 },
    { id: 'track-04', title: 'Oh! Darling', album: 'Abbey Road', trackNumber: 4, duration: 207 },
    { id: 'track-05', title: "Octopus's Garden", album: 'Abbey Road', trackNumber: 5, duration: 170 }
  ];

  describe('resolveAlbumPlaybackQueue', () => {
    it('returns clickedTrack, clickedIndex, and remainingTracks strictly after clickedIndex from top to bottom', () => {
      const result = resolveAlbumPlaybackQueue('track-02', sampleAlbumTracks);

      assert.equal(result.clickedIndex, 1);
      assert.deepEqual(result.currentTrack, sampleAlbumTracks[1]);
      assert.equal(result.remainingTracks.length, 3);
      assert.deepEqual(result.remainingTracks, [
        sampleAlbumTracks[2],
        sampleAlbumTracks[3],
        sampleAlbumTracks[4]
      ]);
      assert.deepEqual(result.remainingTrackIds, ['track-03', 'track-04', 'track-05']);
    });

    it('clicking the first track (index 0) queues all other album tracks in order', () => {
      const result = resolveAlbumPlaybackQueue('track-01', sampleAlbumTracks);

      assert.equal(result.clickedIndex, 0);
      assert.deepEqual(result.currentTrack, sampleAlbumTracks[0]);
      assert.equal(result.remainingTracks.length, 4);
      assert.deepEqual(result.remainingTrackIds, ['track-02', 'track-03', 'track-04', 'track-05']);
    });

    it('clicking the last track returns empty remainingTracks and remainingTrackIds', () => {
      const result = resolveAlbumPlaybackQueue('track-05', sampleAlbumTracks);

      assert.equal(result.clickedIndex, 4);
      assert.deepEqual(result.currentTrack, sampleAlbumTracks[4]);
      assert.deepEqual(result.remainingTracks, []);
      assert.deepEqual(result.remainingTrackIds, []);
    });

    it('handles clickedTrackId passed as track object', () => {
      const result = resolveAlbumPlaybackQueue({ id: 'track-03' }, sampleAlbumTracks);

      assert.equal(result.clickedIndex, 2);
      assert.equal(result.currentTrack.id, 'track-03');
      assert.deepEqual(result.remainingTrackIds, ['track-04', 'track-05']);
    });

    it('handles numeric IDs matching string track IDs gracefully', () => {
      const numericTracks = [
        { id: 101, title: 'Track 1' },
        { id: 102, title: 'Track 2' },
        { id: 103, title: 'Track 3' }
      ];
      const result = resolveAlbumPlaybackQueue('102', numericTracks);

      assert.equal(result.clickedIndex, 1);
      assert.equal(result.currentTrack.id, 102);
      assert.deepEqual(result.remainingTrackIds, [103]);
    });

    it('returns safe fallback when clickedTrackId is not found', () => {
      const result = resolveAlbumPlaybackQueue('non-existent', sampleAlbumTracks);

      assert.equal(result.clickedIndex, -1);
      assert.equal(result.currentTrack, null);
      assert.deepEqual(result.remainingTracks, []);
      assert.deepEqual(result.remainingTrackIds, []);
    });

    it('returns safe fallback for empty, null or invalid albumTracks', () => {
      assert.deepEqual(resolveAlbumPlaybackQueue('track-01', []), {
        currentTrack: null,
        clickedIndex: -1,
        remainingTracks: [],
        remainingTrackIds: []
      });
      assert.deepEqual(resolveAlbumPlaybackQueue('track-01', null), {
        currentTrack: null,
        clickedIndex: -1,
        remainingTracks: [],
        remainingTrackIds: []
      });
      assert.deepEqual(resolveAlbumPlaybackQueue('track-01', undefined), {
        currentTrack: null,
        clickedIndex: -1,
        remainingTracks: [],
        remainingTrackIds: []
      });
    });

    it('supports tracks with _id or trackId identifiers', () => {
      const customTracks = [
        { _id: 'mongo-1', title: 'Intro' },
        { trackId: 'sub-2', title: 'Main' },
        { id: 'std-3', title: 'Outro' }
      ];
      const res1 = resolveAlbumPlaybackQueue('mongo-1', customTracks);
      assert.equal(res1.clickedIndex, 0);
      assert.deepEqual(res1.remainingTrackIds, ['sub-2', 'std-3']);

      const res2 = resolveAlbumPlaybackQueue('sub-2', customTracks);
      assert.equal(res2.clickedIndex, 1);
      assert.deepEqual(res2.remainingTrackIds, ['std-3']);
    });
  });

  describe('resolveNextSequentialTrack', () => {
    it('moves downwards sequentially when direction > 0', () => {
      const res = resolveNextSequentialTrack('track-01', sampleAlbumTracks, 1);

      assert.equal(res.index, 1);
      assert.deepEqual(res.track, sampleAlbumTracks[1]);
      assert.equal(res.isEnd, false);
      assert.equal(res.isStart, false);
    });

    it('moves upwards sequentially when direction < 0', () => {
      const res = resolveNextSequentialTrack('track-03', sampleAlbumTracks, -1);

      assert.equal(res.index, 1);
      assert.deepEqual(res.track, sampleAlbumTracks[1]);
      assert.equal(res.isEnd, false);
      assert.equal(res.isStart, false);
    });

    it('repeat: 0 stops at end boundary when moving forward past the last track', () => {
      const res = resolveNextSequentialTrack('track-05', sampleAlbumTracks, 1, { repeat: 0 });

      assert.equal(res.track, null);
      assert.equal(res.index, -1);
      assert.equal(res.isEnd, true);
      assert.equal(res.isStart, false);
    });

    it('repeat: 0 stops at start boundary when moving backward before the first track', () => {
      const res = resolveNextSequentialTrack('track-01', sampleAlbumTracks, -1, { repeat: 0 });

      assert.equal(res.track, null);
      assert.equal(res.index, -1);
      assert.equal(res.isEnd, false);
      assert.equal(res.isStart, true);
    });

    it('repeat: 0 with clamp: true clamps to boundary track instead of null', () => {
      const resEnd = resolveNextSequentialTrack('track-05', sampleAlbumTracks, 1, { repeat: 0, clamp: true });
      assert.deepEqual(resEnd.track, sampleAlbumTracks[4]);
      assert.equal(resEnd.index, 4);
      assert.equal(resEnd.isEnd, true);

      const resStart = resolveNextSequentialTrack('track-01', sampleAlbumTracks, -1, { repeat: 0, clamp: true });
      assert.deepEqual(resStart.track, sampleAlbumTracks[0]);
      assert.equal(resStart.index, 0);
      assert.equal(resStart.isStart, true);
    });

    it('repeat: 1 loops album forward (from last track back to track 0)', () => {
      const res = resolveNextSequentialTrack('track-05', sampleAlbumTracks, 1, { repeat: 1 });

      assert.deepEqual(res.track, sampleAlbumTracks[0]);
      assert.equal(res.index, 0);
      assert.equal(res.isEnd, false);
      assert.equal(res.isStart, false);
    });

    it('repeat: 1 loops album backward (from track 0 to last track)', () => {
      const res = resolveNextSequentialTrack('track-01', sampleAlbumTracks, -1, { repeat: 1 });

      assert.deepEqual(res.track, sampleAlbumTracks[4]);
      assert.equal(res.index, 4);
      assert.equal(res.isEnd, false);
      assert.equal(res.isStart, false);
    });

    it('repeat: 2 repeats the current track without advancing', () => {
      const resForward = resolveNextSequentialTrack('track-03', sampleAlbumTracks, 1, { repeat: 2 });
      assert.deepEqual(resForward.track, sampleAlbumTracks[2]);
      assert.equal(resForward.index, 2);
      assert.equal(resForward.isEnd, false);
      assert.equal(resForward.isStart, false);

      const resBackward = resolveNextSequentialTrack('track-03', sampleAlbumTracks, -1, { repeat: 2 });
      assert.deepEqual(resBackward.track, sampleAlbumTracks[2]);
      assert.equal(resBackward.index, 2);
    });

    it('handles numeric options shorthand e.g. options = 1 for repeat mode', () => {
      const res = resolveNextSequentialTrack('track-05', sampleAlbumTracks, 1, 1);
      assert.deepEqual(res.track, sampleAlbumTracks[0]);
      assert.equal(res.index, 0);
    });

    it('handles current track not found in album tracks list', () => {
      const forwardStart = resolveNextSequentialTrack('unknown-id', sampleAlbumTracks, 1);
      assert.deepEqual(forwardStart.track, sampleAlbumTracks[0]);
      assert.equal(forwardStart.index, 0);

      const backwardStart = resolveNextSequentialTrack('unknown-id', sampleAlbumTracks, -1);
      assert.deepEqual(backwardStart.track, sampleAlbumTracks[4]);
      assert.equal(backwardStart.index, 4);
    });

    it('handles single-track album', () => {
      const single = [sampleAlbumTracks[0]];

      const stopEnd = resolveNextSequentialTrack('track-01', single, 1, { repeat: 0 });
      assert.equal(stopEnd.track, null);
      assert.equal(stopEnd.isEnd, true);

      const loop = resolveNextSequentialTrack('track-01', single, 1, { repeat: 1 });
      assert.deepEqual(loop.track, single[0]);
      assert.equal(loop.index, 0);

      const repeatOne = resolveNextSequentialTrack('track-01', single, 1, { repeat: 2 });
      assert.deepEqual(repeatOne.track, single[0]);
      assert.equal(repeatOne.index, 0);
    });

    it('safely handles empty or invalid tracks list', () => {
      const resEmpty = resolveNextSequentialTrack('track-01', [], 1);
      assert.deepEqual(resEmpty, { track: null, index: -1, isEnd: true, isStart: true });

      const resNull = resolveNextSequentialTrack('track-01', null, 1);
      assert.deepEqual(resNull, { track: null, index: -1, isEnd: true, isStart: true });
    });
  });

  describe('shouldEnforceSequentialPlayback', () => {
    it('returns true when playbackContext.type is album', () => {
      assert.equal(shouldEnforceSequentialPlayback({ type: 'album' }), true);
      assert.equal(shouldEnforceSequentialPlayback({ type: 'Album' }), true);
      assert.equal(shouldEnforceSequentialPlayback({ type: 'ALBUM' }), true);
      assert.equal(shouldEnforceSequentialPlayback({ type: ' album ' }), true);
    });

    it('returns false for non-album contexts (songs list, playlist, artist, queue)', () => {
      assert.equal(shouldEnforceSequentialPlayback({ type: 'songs' }), false);
      assert.equal(shouldEnforceSequentialPlayback({ type: 'playlist' }), false);
      assert.equal(shouldEnforceSequentialPlayback({ type: 'artist' }), false);
      assert.equal(shouldEnforceSequentialPlayback({ type: 'queue' }), false);
      assert.equal(shouldEnforceSequentialPlayback({}), false);
    });

    it('returns false for null, undefined, primitive or non-object values', () => {
      assert.equal(shouldEnforceSequentialPlayback(null), false);
      assert.equal(shouldEnforceSequentialPlayback(undefined), false);
      assert.equal(shouldEnforceSequentialPlayback('album'), false);
      assert.equal(shouldEnforceSequentialPlayback(123), false);
      assert.equal(shouldEnforceSequentialPlayback(true), false);
    });
  });

  describe('formatPlaybackContextSummary', () => {
    it('formats album context with track progression e.g. Album [Name] · Phát tuần tự bài 2/10', () => {
      const summary1 = formatPlaybackContextSummary({
        type: 'album',
        name: 'Abbey Road',
        currentIndex: 1,
        totalTracks: 10
      });
      assert.equal(summary1, 'Album Abbey Road · Phát tuần tự bài 2/10');

      const summaryPlaceholder = formatPlaybackContextSummary({
        type: 'album',
        name: '[Name]',
        currentIndex: 1,
        totalTracks: 10
      });
      assert.equal(summaryPlaceholder, 'Album [Name] · Phát tuần tự bài 2/10');
    });

    it('formats album context dynamically using tracks array and currentTrack', () => {
      const context = {
        type: 'album',
        name: 'The Dark Side of the Moon',
        tracks: sampleAlbumTracks
      };
      const summary = formatPlaybackContextSummary(context, sampleAlbumTracks[2]);
      assert.equal(summary, 'Album The Dark Side of the Moon · Phát tuần tự bài 3/5');
    });

    it('formats album context without track index as total count e.g. Album [Name] · Phát tuần tự (5 bài)', () => {
      const summary = formatPlaybackContextSummary({
        type: 'album',
        name: 'Random Access Memories',
        totalTracks: 13
      });
      assert.equal(summary, 'Album Random Access Memories · Phát tuần tự (13 bài)');
    });

    it('supports useBrackets option for explicit brackets formatting', () => {
      const summary = formatPlaybackContextSummary({
        type: 'album',
        name: 'Abbey Road',
        currentIndex: 0,
        totalTracks: 5
      }, null, { useBrackets: true });
      assert.equal(summary, 'Album [Abbey Road] · Phát tuần tự bài 1/5');
    });

    it('formats non-album contexts as Danh sách bài hát · Tự do', () => {
      assert.equal(formatPlaybackContextSummary(null), 'Danh sách bài hát · Tự do');
      assert.equal(formatPlaybackContextSummary(undefined), 'Danh sách bài hát · Tự do');
      assert.equal(formatPlaybackContextSummary({}), 'Danh sách bài hát · Tự do');
      assert.equal(formatPlaybackContextSummary({ type: 'songs' }), 'Danh sách bài hát · Tự do');
    });

    it('formats custom playlist or artist contexts with Tự do label', () => {
      const playlistSummary = formatPlaybackContextSummary({
        type: 'playlist',
        name: 'Tuyển tập Audiophile'
      });
      assert.equal(playlistSummary, 'Tuyển tập Audiophile · Tự do');
    });
  });

  describe('Web Audio Graph & Invariant Verification', () => {
    it('strictly preserves state.crossfeedNodes.output.connect(state.context.destination)', () => {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      assert.ok(
        html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
        'Web Audio API graph invariant must be strictly preserved'
      );
    });
  });

});
