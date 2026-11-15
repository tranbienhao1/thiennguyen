const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryUtilsPath = path.join(__dirname, '..', 'library-utils.js');
const indexHtmlPath = path.join(__dirname, '..', 'index.html');

test('Pha A: Dynamic Convolution Room Modeling & Headphone Crossfeed Balance Refinement', async (t) => {
  const lib = require(libraryUtilsPath);

  await t.test('1. CROSSFEED_PRESETS registry and lookups', () => {
    assert.ok(lib.CROSSFEED_PRESETS, 'CROSSFEED_PRESETS must exist');
    assert.ok(lib.CROSSFEED_PRESETS.bauer, 'Bauer preset must exist');
    assert.ok(lib.CROSSFEED_PRESETS.meier, 'Meier preset must exist');
    assert.ok(lib.CROSSFEED_PRESETS.chu_moy, 'Chu Moy preset must exist');
    assert.ok(lib.CROSSFEED_PRESETS.binaural_studio, 'Binaural studio preset must exist');

    assert.equal(lib.getCrossfeedPreset('bauer').cutoffHz, 700);
    assert.equal(lib.getCrossfeedPreset('meier').cutoffHz, 650);
    assert.equal(lib.getCrossfeedPreset('chu_moy').cutoffHz, 750);
    assert.equal(lib.getCrossfeedPreset('binaural_studio').cutoffHz, 850);

    // Fallback on invalid preset
    assert.equal(lib.getCrossfeedPreset('unknown-key').id, 'bauer');
    assert.equal(lib.getCrossfeedPreset(null).id, 'bauer');

    const list = lib.listCrossfeedPresets();
    assert.equal(list.length, 4);
  });

  await t.test('2. calculateCrossfeedMatrixParams equal-power balance calculations', () => {
    // Zero intensity
    const off = lib.calculateCrossfeedMatrixParams('bauer', 0);
    assert.equal(off.isActive, false);
    assert.equal(off.crossGain, 0);
    assert.equal(off.directGain, 1.0);

    // 50% intensity Bauer
    const half = lib.calculateCrossfeedMatrixParams('bauer', 0.5);
    assert.equal(half.isActive, true);
    assert.ok(half.crossGain > 0 && half.crossGain <= 0.35);
    assert.ok(half.directGain > 0.8 && half.directGain <= 1.0);

    // 100% intensity Meier
    const meierFull = lib.calculateCrossfeedMatrixParams('meier', 1.0);
    assert.equal(meierFull.isActive, true);
    assert.equal(meierFull.crossGain, 0.38);
    assert.equal(meierFull.cutoffHz, 650);
    assert.equal(meierFull.delaySeconds, 0.00025);

    // Format summary
    const summary = lib.formatCrossfeedMatrixSummary(half);
    assert.ok(summary.includes('Bauer Stereophonic'));
    assert.ok(summary.includes('700Hz'));
    assert.equal(lib.formatCrossfeedMatrixSummary(off), 'Crossfeed: Tắt');
  });

  await t.test('3. ROOM_ACOUSTIC_PROFILES extension: vinyl_lounge and chamber_music', () => {
    const vinyl = lib.getRoomAcousticProfile('vinyl_lounge');
    assert.ok(vinyl, 'Vinyl lounge profile must exist');
    assert.equal(vinyl.id, 'vinyl_lounge');
    assert.equal(vinyl.rt60, 0.45);
    assert.equal(vinyl.badge, 'VINYL');

    const chamber = lib.getRoomAcousticProfile('chamber_music');
    assert.ok(chamber, 'Chamber music profile must exist');
    assert.equal(chamber.id, 'chamber_music');
    assert.equal(chamber.rt60, 1.25);
    assert.equal(chamber.badge, 'CHAMBER');

    // IR synthesis for vinyl lounge
    const irVinyl = lib.generateImpulseResponse('vinyl_lounge', 44100);
    assert.ok(irVinyl && irVinyl.left && irVinyl.right, 'Impulse response must be synthesized');
    assert.equal(irVinyl.channels, 2);
    assert.ok(irVinyl.left.length > 0);
  });

  await t.test('4. calculateAdaptiveRoomWetDry dynamic energy adaptation', () => {
    // Normal track
    const normal = lib.calculateAdaptiveRoomWetDry('studio', { bass: 0.4, crestFactor: 11 }, 0.25);
    assert.ok(normal.wet > 0);
    assert.ok(normal.dry > 0);

    // Heavy bass track: should scale wet down slightly
    const heavyBass = lib.calculateAdaptiveRoomWetDry('studio', { bass: 0.9, crestFactor: 8 }, 0.25);
    assert.ok(heavyBass.rawWet < 0.25, 'Heavy bass should dampen room wetness to prevent muddiness');
    assert.equal(heavyBass.isAdapted, true);

    // High dynamic range acoustic track: allows fuller room breathe
    const acoustic = lib.calculateAdaptiveRoomWetDry('studio', { bass: 0.3, crestFactor: 16 }, 0.25);
    assert.ok(acoustic.rawWet > heavyBass.rawWet);

    // Bypass
    const bypass = lib.calculateAdaptiveRoomWetDry('bypass', {}, 0.25);
    assert.equal(bypass.wet, 0);
    assert.equal(bypass.dry, 1.0);
  });

  await t.test('5. index.html UI integration and Core Web Audio Graph Invariant', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');

    // Crossfeed preset UI
    assert.ok(html.includes('id="crossfeed-preset-select"'), 'Must have #crossfeed-preset-select');
    assert.ok(html.includes('id="crossfeed-preset-desc"'), 'Must have #crossfeed-preset-desc');
    assert.ok(html.includes('value="bauer"'), 'Must have bauer option');
    assert.ok(html.includes('value="meier"'), 'Must have meier option');

    // Room acoustics options
    assert.ok(html.includes('value="vinyl_lounge"'), 'Must have vinyl_lounge option');
    assert.ok(html.includes('value="chamber_music"'), 'Must have chamber_music option');

    // CRITICAL AUDIO GRAPH INVARIANT
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL: Web Audio crossfeed destination invariant must be strictly preserved'
    );
  });
});
