'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pha C — Per-Track Audiophile Liner Notes & Annotations: buildTrackAnnotationKey', () => {
  assert.equal(typeof library.buildTrackAnnotationKey, 'function');
  
  // By string
  assert.equal(library.buildTrackAnnotationKey('track_123'), 'track_123');

  // By track ID
  const trackWithId = { id: 'flac-99', title: 'Hotel California', artist: 'Eagles' };
  assert.equal(library.buildTrackAnnotationKey(trackWithId), 'flac-99');

  // By metadata without ID
  const trackWithoutId = { title: 'Time', artist: 'Pink Floyd', album: 'The Dark Side of the Moon' };
  assert.equal(library.buildTrackAnnotationKey(trackWithoutId), 'pink floyd - the dark side of the moon - time');

  // Empty fallback
  assert.equal(library.buildTrackAnnotationKey(null), 'unknown-track');
  assert.equal(library.buildTrackAnnotationKey({}), 'unknown-track');
});

test('Pha C — Per-Track Audiophile Liner Notes & Annotations: normalizeTrackAnnotation', () => {
  assert.equal(typeof library.normalizeTrackAnnotation, 'function');

  // Empty input fallback
  const empty = library.normalizeTrackAnnotation(null);
  assert.equal(empty.notes, '');
  assert.equal(empty.audiophileScore, 0);
  assert.equal(empty.personalRating, 0);
  assert.deepEqual(empty.moodTags, []);
  assert.ok(typeof empty.updatedAt === 'string');

  // Value clamping and normalization
  const raw = {
    notes: '  Superb soundstage and dynamic acoustic transients.  ',
    gearRecommendation: ' Sennheiser HD600 + OTL Tube DAC ',
    masteringDetails: ' MFSL Gold CD 24-bit ',
    audiophileScore: 145, // Should clamp to 100
    personalRating: 9,    // Should clamp to 5
    moodTags: 'Acoustic, Warm, intimate, warm', // String tags with duplicate
    venueYear: ' Abbey Road Studios 1969 ',
    updatedAt: '2026-11-17T05:00:00.000Z'
  };

  const norm = library.normalizeTrackAnnotation(raw);
  assert.equal(norm.notes, 'Superb soundstage and dynamic acoustic transients.');
  assert.equal(norm.gearRecommendation, 'Sennheiser HD600 + OTL Tube DAC');
  assert.equal(norm.masteringDetails, 'MFSL Gold CD 24-bit');
  assert.equal(norm.audiophileScore, 100);
  assert.equal(norm.personalRating, 5);
  assert.deepEqual(norm.moodTags, ['acoustic', 'warm', 'intimate']);
  assert.equal(norm.venueYear, 'Abbey Road Studios 1969');
  assert.equal(norm.updatedAt, '2026-11-17T05:00:00.000Z');
});

test('Pha C — Per-Track Audiophile Liner Notes & Annotations: formatAnnotationSummary', () => {
  assert.equal(typeof library.formatAnnotationSummary, 'function');

  // Empty
  assert.equal(library.formatAnnotationSummary(null), 'Chưa có ghi chú');
  assert.equal(library.formatAnnotationSummary({}), 'Chưa có ghi chú');

  // Populated
  const summary = library.formatAnnotationSummary({
    personalRating: 5,
    audiophileScore: 98,
    gearRecommendation: 'FiiO M11S',
    masteringDetails: 'DSD256 Master',
    moodTags: ['audiophile', 'lossless'],
    venueYear: '1975'
  });

  assert.ok(summary.includes('⭐ 5/5'));
  assert.ok(summary.includes('🎯 98/100'));
  assert.ok(summary.includes('🎧 FiiO M11S'));
  assert.ok(summary.includes('💽 DSD256 Master'));
  assert.ok(summary.includes('🏷️ audiophile, lossless'));
  assert.ok(summary.includes('🏛️ 1975'));
});

test('Pha C — Per-Track Audiophile Liner Notes & Annotations: mergeTrackAnnotations', () => {
  assert.equal(typeof library.mergeTrackAnnotations, 'function');

  const existing = {
    'track-1': { notes: 'Older note', audiophileScore: 80, updatedAt: '2026-11-10T00:00:00.000Z' },
    'track-2': { notes: 'Keep this note', audiophileScore: 90, updatedAt: '2026-11-12T00:00:00.000Z' }
  };

  const incoming = {
    'track-1': { notes: 'Updated note', audiophileScore: 95, updatedAt: '2026-11-16T00:00:00.000Z' },
    'track-3': { notes: 'Brand new note', audiophileScore: 88, updatedAt: '2026-11-16T00:00:00.000Z' }
  };

  const result = library.mergeTrackAnnotations(existing, incoming);
  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.totalCount, 3);
  assert.equal(result.merged['track-1'].notes, 'Updated note');
  assert.equal(result.merged['track-1'].audiophileScore, 95);
  assert.equal(result.merged['track-2'].notes, 'Keep this note');
  assert.equal(result.merged['track-3'].notes, 'Brand new note');
});

test('Pha C — Per-Track Audiophile Liner Notes & Annotations: filterTracksByAnnotationQuery', () => {
  assert.equal(typeof library.filterTracksByAnnotationQuery, 'function');

  const tracks = [
    { id: 't1', title: 'Song One' },
    { id: 't2', title: 'Song Two' },
    { id: 't3', title: 'Song Three' }
  ];

  const map = {
    't1': { notes: 'Acoustic guitar mastery', audiophileScore: 96, moodTags: ['acoustic', 'calm'] },
    't2': { notes: 'Heavy bass EDM', audiophileScore: 75, gearRecommendation: 'Warm Tube Amp' }
  };

  // Text match in notes
  const matchAcoustic = library.filterTracksByAnnotationQuery(tracks, map, 'acoustic');
  assert.equal(matchAcoustic.length, 1);
  assert.equal(matchAcoustic[0].id, 't1');

  // Text match in gear
  const matchGear = library.filterTracksByAnnotationQuery(tracks, map, 'tube amp');
  assert.equal(matchGear.length, 1);
  assert.equal(matchGear[0].id, 't2');

  // Score match >= 90
  const matchScore = library.filterTracksByAnnotationQuery(tracks, map, 'score>=90');
  assert.equal(matchScore.length, 1);
  assert.equal(matchScore[0].id, 't1');

  // Score match < 80
  const matchLowScore = library.filterTracksByAnnotationQuery(tracks, map, 'score<80');
  assert.equal(matchLowScore.length, 1);
  assert.equal(matchLowScore[0].id, 't2');

  // Empty query returns all
  assert.equal(library.filterTracksByAnnotationQuery(tracks, map, '').length, 3);
});

test('Pha C — Config Backup & Restore preserves trackAnnotations', () => {
  const mockState = {
    favorites: ['track_1'],
    trackRatings: { 'track_1': 5 },
    trackAnnotations: {
      'track_1': {
        notes: 'Masterpiece recording',
        audiophileScore: 99,
        gearRecommendation: 'HD600'
      }
    }
  };

  const backup = library.exportAppConfiguration(mockState);
  assert.ok(backup.trackAnnotations);
  assert.equal(backup.trackAnnotations['track_1'].audiophileScore, 99);

  const json = JSON.stringify(backup);
  const parsed = library.validateAndParseConfiguration(json);
  assert.equal(parsed.isValid, true);
  assert.equal(parsed.config.trackAnnotations['track_1'].gearRecommendation, 'HD600');

  const targetState = { trackAnnotations: {} };
  const restored = library.mergeRestoredConfiguration(targetState, parsed.config);
  assert.equal(restored.restoredAnnotationsCount, 1);
  assert.equal(targetState.trackAnnotations['track_1'].notes, 'Masterpiece recording');
});

test('Pha C — DOM & UI Integration in index.html for Liner Notes & Annotations', () => {
  // 1. Metadata Modal Annotation Tab & Panel
  assert.ok(indexHtml.includes('data-metadata-kind="annotation"'), 'Tab data-metadata-kind="annotation" must exist');
  assert.ok(indexHtml.includes('id="metadata-annotations-panel"'), 'Panel #metadata-annotations-panel must exist');
  assert.ok(indexHtml.includes('id="annotation-rating-input"'), '#annotation-rating-input must exist');
  assert.ok(indexHtml.includes('id="annotation-score-input"'), '#annotation-score-input must exist');
  assert.ok(indexHtml.includes('id="annotation-gear-input"'), '#annotation-gear-input must exist');
  assert.ok(indexHtml.includes('id="annotation-mastering-input"'), '#annotation-mastering-input must exist');
  assert.ok(indexHtml.includes('id="annotation-venue-input"'), '#annotation-venue-input must exist');
  assert.ok(indexHtml.includes('id="annotation-tags-input"'), '#annotation-tags-input must exist');
  assert.ok(indexHtml.includes('id="annotation-notes-input"'), '#annotation-notes-input must exist');
  assert.ok(indexHtml.includes('id="annotation-save-btn"'), '#annotation-save-btn must exist');
  assert.ok(indexHtml.includes('id="annotation-delete-btn"'), '#annotation-delete-btn must exist');

  // 2. Listening Room Liner Notes Card
  assert.ok(indexHtml.includes('id="room-liner-notes-card"'), '#room-liner-notes-card must exist');
  assert.ok(indexHtml.includes('id="room-edit-liner-notes-btn"'), '#room-edit-liner-notes-btn must exist');
  assert.ok(indexHtml.includes('id="room-liner-notes-content"'), '#room-liner-notes-content must exist');
  assert.ok(indexHtml.includes('id="room-liner-score-badge"'), '#room-liner-score-badge must exist');

  // 3. Track Rows Annotation Indicator
  assert.ok(indexHtml.includes('track-annotation-indicator'), 'track-annotation-indicator class must exist in index.html');
  assert.ok(indexHtml.includes('data-annotation-track-id'), 'data-annotation-track-id attribute must exist in index.html');

  // 4. State initializes trackAnnotations
  assert.ok(indexHtml.includes('trackAnnotations:'), 'state must initialize trackAnnotations');
});

test('CRITICAL AUDIO INVARIANT: Web Audio API Graph Invariant Preservation', () => {
  const invariantStatement = 'state.crossfeedNodes.output.connect(state.context.destination)';
  assert.ok(
    indexHtml.includes(invariantStatement),
    `Audio invariant violated! ${invariantStatement} must be strictly present.`
  );
});
