const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryPath = path.join(__dirname, 'library-utils.js');
const library = require(libraryPath);

test('Pha D: exportAppConfiguration exports compliant Nocturne backup structure', () => {
  const mockState = {
    favorites: new Set(['track_1', 'track_2']),
    playlists: [{ id: 'p1', name: 'Jazz Classics' }],
    crossfadeSeconds: 4,
    crossfadeCurve: 'equal-power',
    autoEqProfile: 'harman',
    visualizerTheme: 'cyber',
    visualizerMode: 'oscilloscope',
    ambientStageMode: 'reactive',
    limiterMode: 'transparent',
    toneBass: 2,
    toneTreble: -1,
    stereoBalance: 0.1,
    crossfeed: 0.35,
    replayGainEnabled: true
  };

  const backup = library.exportAppConfiguration(mockState);
  assert.equal(backup.appName, 'Nocturne');
  assert.equal(backup.version, 1);
  assert.ok(typeof backup.exportedAt === 'string');
  assert.deepEqual(backup.favorites, ['track_1', 'track_2']);
  assert.equal(backup.playlists.length, 1);
  assert.equal(backup.settings.crossfadeSeconds, 4);
  assert.equal(backup.settings.visualizerMode, 'oscilloscope');
  assert.equal(backup.settings.autoEqProfile, 'harman');
});

test('Pha D: validateAndParseConfiguration validates schema and sanitizes input', () => {
  // Valid JSON
  const validJson = JSON.stringify({
    appName: 'Nocturne',
    version: 1,
    favorites: ['t1', 't2'],
    settings: { autoEqProfile: 'vocal' }
  });
  const parsed = library.validateAndParseConfiguration(validJson);
  assert.equal(parsed.isValid, true);
  assert.equal(parsed.config.favorites.length, 2);
  assert.equal(parsed.config.settings.autoEqProfile, 'vocal');

  // Invalid JSON syntax
  const invalidSyntax = '{ appName: "Nocturne", bad';
  const resBadSyntax = library.validateAndParseConfiguration(invalidSyntax);
  assert.equal(resBadSyntax.isValid, false);
  assert.ok(resBadSyntax.error.includes('Lỗi'));

  // Missing signature / invalid format
  const foreignJson = JSON.stringify({ randomKey: 123 });
  const resForeign = library.validateAndParseConfiguration(foreignJson);
  assert.equal(resForeign.isValid, false);

  // Empty string
  assert.equal(library.validateAndParseConfiguration('').isValid, false);
});

test('Pha D: mergeRestoredConfiguration merges settings and favorites safely', () => {
  const currentState = {
    favorites: new Set(['existing_track']),
    autoEqProfile: 'none',
    visualizerTheme: 'monochrome',
    crossfeed: 0
  };

  const importedConfig = {
    favorites: ['existing_track', 'new_track_1', 'new_track_2'],
    settings: {
      autoEqProfile: 'harman',
      visualizerTheme: 'sunset',
      crossfeed: 0.4
    }
  };

  const result = library.mergeRestoredConfiguration(currentState, importedConfig);
  assert.equal(result.restoredFavoritesCount, 2); // 2 new favorites added
  assert.equal(currentState.favorites.has('existing_track'), true);
  assert.equal(currentState.favorites.has('new_track_1'), true);
  assert.equal(currentState.favorites.has('new_track_2'), true);
  assert.equal(currentState.autoEqProfile, 'harman');
  assert.equal(currentState.visualizerTheme, 'sunset');
  assert.equal(currentState.crossfeed, 0.4);
});

test('Pha D: calculateAudioMemoryFootprint estimates RAM pressure accurately', () => {
  // Low pressure case (e.g., 2 tracks, 5 slices)
  const low = library.calculateAudioMemoryFootprint(2, 5);
  assert.equal(low.isLowPressure, true);
  assert.equal(low.pressureTier, 'optimal');
  assert.ok(low.totalMb < 70);

  // High pressure case (e.g., 20 tracks in memory, 50 slices)
  const high = library.calculateAudioMemoryFootprint(20, 50);
  assert.equal(high.isLowPressure, false);
  assert.equal(high.pressureTier, 'critical');
  assert.ok(high.totalMb > 160);
});

test('Pha D & Audio Engine Invariant: AudioContext Graph Invariant Preservation', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL: AudioContext Graph invariant must remain intact!'
  );
  assert.ok(
    indexHtml.includes('export-config-btn') && indexHtml.includes('import-config-btn'),
    'Backup and restore controls must be present in index.html'
  );
});
