const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

test('Roon Luxe UI — Library Utils Focus & Signal LED Helpers', async (t) => {
  await t.test('filterTracksByFocus handles empty/null filter correctly', () => {
    const tracks = [
      { id: '1', title: 'Song 1', sampleRate: 44100, bitDepth: 16 },
      { id: '2', title: 'Song 2', sampleRate: 96000, bitDepth: 24 }
    ];
    assert.deepStrictEqual(library.filterTracksByFocus(tracks, null), tracks);
    assert.deepStrictEqual(library.filterTracksByFocus(tracks, 'all'), tracks);
    assert.deepStrictEqual(library.filterTracksByFocus(tracks, []), tracks);
  });

  await t.test('filterTracksByFocus filters DSD tracks', () => {
    const tracks = [
      { id: '1', title: 'PCM Hi-Res', isDsd: false, sampleRate: 96000 },
      { id: '2', title: 'DSD Track', isDsd: true, sampleRate: 2822400 },
      { id: '3', title: 'DFF Track', isDsd: false, path: 'music/track.dff' }
    ];
    const res = library.filterTracksByFocus(tracks, 'dsd');
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].id, '2');
    assert.strictEqual(res[1].id, '3');
  });

  await t.test('filterTracksByFocus filters Hi-Res and Lossless CD tracks', () => {
    const tracks = [
      { id: '1', title: 'CD 16/44.1', sampleRate: 44100, bitDepth: 16, isDsd: false, format: 'FLAC' },
      { id: '2', title: 'Hi-Res 24/96', sampleRate: 96000, bitDepth: 24, isDsd: false, format: 'FLAC' },
      { id: '3', title: 'Hi-Res 24/48', sampleRate: 48000, bitDepth: 24, isDsd: false, format: 'FLAC' },
      { id: '4', title: 'DSD', isDsd: true, sampleRate: 2822400 }
    ];
    const hires = library.filterTracksByFocus(tracks, 'hires');
    assert.strictEqual(hires.length, 2);
    assert.ok(hires.some(t => t.id === '2'));
    assert.ok(hires.some(t => t.id === '3'));

    const lossless = library.filterTracksByFocus(tracks, 'lossless');
    assert.strictEqual(lossless.length, 1);
    assert.strictEqual(lossless[0].id, '1');
  });

  await t.test('filterTracksByFocus filters favorites and cloud sources', () => {
    const favs = new Set(['1', '3']);
    const tracks = [
      { id: '1', title: 'Cloud Song', source: 'google' },
      { id: '2', title: 'Local Song', source: 'local' },
      { id: '3', title: 'OneDrive Song', source: 'microsoft' }
    ];
    const favTracks = library.filterTracksByFocus(tracks, 'favorite', { favorites: favs });
    assert.strictEqual(favTracks.length, 2);

    const cloudTracks = library.filterTracksByFocus(tracks, 'cloud');
    assert.strictEqual(cloudTracks.length, 2);
    assert.strictEqual(cloudTracks[0].id, '1');
    assert.strictEqual(cloudTracks[1].id, '3');
  });

  await t.test('countFocusCategories accurately tallies library metrics', () => {
    const favs = new Set(['2']);
    const tracks = [
      { id: '1', sampleRate: 44100, bitDepth: 16, source: 'local', format: 'FLAC' },
      { id: '2', sampleRate: 96000, bitDepth: 24, source: 'google', format: 'FLAC' },
      { id: '3', isDsd: true, source: 'local' }
    ];
    const counts = library.countFocusCategories(tracks, favs);
    assert.strictEqual(counts.all, 3);
    assert.strictEqual(counts.hires, 1);
    assert.strictEqual(counts.dsd, 1);
    assert.strictEqual(counts.lossless, 1);
    assert.strictEqual(counts.favorite, 1);
    assert.strictEqual(counts.cloud, 1);
    assert.strictEqual(counts.local, 2);
  });

  await t.test('formatFocusBadge returns localized Vietnamese labels', () => {
    assert.strictEqual(library.formatFocusBadge('all'), 'Tất cả');
    assert.strictEqual(library.formatFocusBadge('dsd'), 'DSD Audiophile');
    assert.strictEqual(library.formatFocusBadge('hires'), 'Hi-Res Lossless');
    assert.strictEqual(library.formatFocusBadge('lossless'), 'Lossless CD');
    assert.strictEqual(library.formatFocusBadge('favorite'), 'Yêu thích');
    assert.strictEqual(library.formatFocusBadge('cloud'), 'Đám mây');
  });

  await t.test('computeRoonSignalLed returns correct LED colors and star ratings', () => {
    const bitperfect = library.computeRoonSignalLed('BIT-PERFECT', true);
    assert.strictEqual(bitperfect.color, 'purple');
    assert.strictEqual(bitperfect.stars, 5);

    const hires = library.computeRoonSignalLed('HI-RES', false);
    assert.strictEqual(hires.color, 'green');
    assert.strictEqual(hires.stars, 4);

    const enhanced = library.computeRoonSignalLed('ENHANCED', false);
    assert.strictEqual(enhanced.color, 'blue');
    assert.strictEqual(enhanced.stars, 4);
  });

  await t.test('buildRoonSignalPathStages generates 4-stage pipeline structure', () => {
    const track = {
      title: 'Hotel California',
      sampleRate: 192000,
      bitDepth: 24,
      format: 'FLAC',
      channels: 2
    };
    const stages = library.buildRoonSignalPathStages(track, {
      isDspBypassed: true,
      zoneName: 'Direct DAC Zone',
      outputSampleRate: 192000
    });
    assert.strictEqual(stages.length, 4);
    assert.strictEqual(stages[0].stage, 'source');
    assert.strictEqual(stages[1].stage, 'decoder');
    assert.strictEqual(stages[2].stage, 'dsp');
    assert.strictEqual(stages[3].stage, 'output');
    assert.ok(stages[0].description.includes('192.0kHz'));
    assert.ok(stages[2].description.includes('Bypass'));
  });
});

test('Roon Luxe UI — DOM Elements in index.html', async (t) => {
  await t.test('Roon Focus bar element exists with category buttons', () => {
    assert.ok(indexHtml.includes('id="roon-focus-bar"'), 'Focus bar exists');
    assert.ok(indexHtml.includes('data-focus="all"'), 'Focus all button exists');
    assert.ok(indexHtml.includes('data-focus="dsd"'), 'Focus DSD button exists');
    assert.ok(indexHtml.includes('data-focus="hires"'), 'Focus Hi-Res button exists');
    assert.ok(indexHtml.includes('data-focus="lossless"'), 'Focus Lossless button exists');
  });

  await t.test('Roon Signal Path popover modal exists with LED and stages container', () => {
    assert.ok(indexHtml.includes('id="signal-path-popover"'), 'Signal path popover exists');
    assert.ok(indexHtml.includes('id="signal-path-led"'), 'Signal path LED exists');
    assert.ok(indexHtml.includes('id="signal-path-stars"'), 'Signal path star rating exists');
    assert.ok(indexHtml.includes('id="signal-path-stages"'), 'Signal path stages container exists');
    assert.ok(indexHtml.includes('id="signal-path-close"'), 'Signal path close button exists');
  });

  await t.test('Roon Immersive Fullscreen view exists with required controls', () => {
    assert.ok(indexHtml.includes('id="roon-fullscreen-view"'), 'Fullscreen view container exists');
    assert.ok(indexHtml.includes('id="fullscreen-exit-btn"'), 'Fullscreen exit button exists');
    assert.ok(indexHtml.includes('id="fullscreen-toggle-btn"'), 'Fullscreen trigger button exists');
    assert.ok(indexHtml.includes('id="fullscreen-ambient-glow"'), 'Fullscreen ambient glow layer exists');
    assert.ok(indexHtml.includes('id="fullscreen-waveform"'), 'Fullscreen waveform canvas exists');
  });
});

test('Roon Luxe UI — Script Integration & Behavior', async (t) => {
  await t.test('State initializes activeFocus and fullscreenState', () => {
    assert.ok(indexHtml.includes('activeFocus:'), 'State has activeFocus');
    assert.ok(indexHtml.includes('isFullscreen:'), 'State has isFullscreen');
  });

  await t.test('setFocusFilter and renderFocusBar functions are declared', () => {
    assert.ok(indexHtml.includes('function setFocusFilter('), 'setFocusFilter declared');
    assert.ok(indexHtml.includes('function renderFocusBar('), 'renderFocusBar declared');
  });

  await t.test('toggleSignalPathPopover and toggleRoonFullscreen functions are declared', () => {
    assert.ok(indexHtml.includes('function toggleSignalPathPopover('), 'toggleSignalPathPopover declared');
    assert.ok(indexHtml.includes('function toggleRoonFullscreen('), 'toggleRoonFullscreen declared');
  });

  await t.test('Audio routing invariant remains strictly untouched', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Strict invariant for crossfeed to destination connection preserved'
    );
  });
});
