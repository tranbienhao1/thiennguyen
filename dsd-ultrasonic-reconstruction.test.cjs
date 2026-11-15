'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');

test('Pha A: DSD Ultrasonic Reconstruction Filter & Anti-Aliasing Cutoff Test Suite', async (t) => {
  await t.test('1. DSD_ULTRASONIC_FILTERS registry and profile lookups', () => {
    assert.ok(library.DSD_ULTRASONIC_FILTERS, 'DSD_ULTRASONIC_FILTERS must exist');
    assert.ok(library.DSD_ULTRASONIC_FILTERS.bypass);
    assert.ok(library.DSD_ULTRASONIC_FILTERS.sacd_standard);
    assert.ok(library.DSD_ULTRASONIC_FILTERS.hi_res_extended);
    assert.ok(library.DSD_ULTRASONIC_FILTERS.analog_smooth);

    assert.equal(library.getDsdUltrasonicFilter('sacd_standard').badge, 'SACD 30k');
    assert.equal(library.getDsdUltrasonicFilter('sacd_standard').cutoffHz, 30000);
    assert.equal(library.getDsdUltrasonicFilter('hi_res_extended').cutoffHz, 50000);
    assert.equal(library.getDsdUltrasonicFilter('analog_smooth').cutoffHz, 24000);
    assert.equal(library.getDsdUltrasonicFilter('invalid_name').id, 'bypass');

    const all = library.listDsdUltrasonicFilters();
    assert.equal(all.length, 4);
  });

  await t.test('2. calculateUltrasonicFilterResponse computes accurate Butterworth attenuation curve', () => {
    assert.equal(typeof library.calculateUltrasonicFilterResponse, 'function');

    // Bypass: zero attenuation
    const bypassResp = library.calculateUltrasonicFilterResponse('bypass', 50000);
    assert.equal(bypassResp.attenuationDb, 0);
    assert.equal(bypassResp.isFiltered, false);

    // SACD Standard 30 kHz cutoff
    // At audible 1 kHz: virtually 0 dB attenuation
    const audioPass = library.calculateUltrasonicFilterResponse('sacd_standard', 1000);
    assert.ok(Math.abs(audioPass.attenuationDb) < 0.1, 'Audible 1kHz must pass unattenuated');

    // At cutoff 30 kHz: standard -3 dB point
    const cutoffResp = library.calculateUltrasonicFilterResponse('sacd_standard', 30000);
    assert.ok(Math.abs(cutoffResp.attenuationDb - (-3.0)) <= 0.1, 'At cutoff frequency attenuation must be -3.0 dB');

    // At 1 octave above cutoff (60 kHz): -24 dB attenuation (4th order Butterworth)
    const octaveResp = library.calculateUltrasonicFilterResponse('sacd_standard', 60000);
    assert.ok(Math.abs(octaveResp.attenuationDb - (-24.1)) <= 0.5, 'At 1 octave above cutoff attenuation must be approx -24 dB');
  });

  await t.test('3. formatDsdUltrasonicFilterTelemetry generates descriptive localized readout', () => {
    assert.equal(typeof library.formatDsdUltrasonicFilterTelemetry, 'function');

    const bypassText = library.formatDsdUltrasonicFilterTelemetry('bypass');
    assert.ok(bypassText.includes('Bypass'));
    assert.ok(bypassText.includes('Bit-Perfect'));

    const sacdText = library.formatDsdUltrasonicFilterTelemetry('sacd_standard');
    assert.ok(sacdText.includes('SACD'));
    assert.ok(sacdText.includes('30 kHz'));
    assert.ok(sacdText.includes('-24 dB/oct'));
  });

  await t.test('4. computeSignalPath reflects DSD Ultrasonic Filter in Roon Signal Path', () => {
    const fakeTrack = { id: 'dsd_01', title: 'Mahler Symphony', format: 'DSF', isDsd: true, sampleRate: 2822400 };

    // When bypass: not listed in DSP active
    const directPath = library.computeSignalPath(fakeTrack, {
      activeZone: { id: 'zone_dsp' },
      isEnhanced: false,
      dsdUltrasonicFilter: 'bypass'
    });
    const dspDirect = directPath.steps.find(s => s.stage === 'dsp');
    assert.ok(!dspDirect.description.includes('Lọc DSD Siêu Âm'));

    // When active: appears in DSP stage
    const filterPath = library.computeSignalPath(fakeTrack, {
      activeZone: { id: 'zone_dsp' },
      isEnhanced: true,
      dsdUltrasonicFilter: 'sacd_standard'
    });
    const dspFiltered = filterPath.steps.find(s => s.stage === 'dsp');
    assert.ok(dspFiltered.description.includes('Lọc DSD Siêu Âm'));
    assert.ok(dspFiltered.description.includes('SACD 30k'));
  });

  await t.test('5. exportAppConfiguration & mergeRestoredConfiguration preserves dsdUltrasonicFilter', () => {
    const exported = library.exportAppConfiguration({
      dsdUltrasonicFilter: 'analog_smooth'
    });
    assert.equal(exported.settings.dsdUltrasonicFilter, 'analog_smooth');

    const targetState = {};
    const res = library.mergeRestoredConfiguration(targetState, exported);
    assert.equal(targetState.dsdUltrasonicFilter, 'analog_smooth');
    assert.ok(res.appliedSettingsCount > 0);
  });

  await t.test('6. DOM Integration & Web Audio Graph Invariant in index.html', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    assert.ok(indexHtml.includes('id="dsd-ultrasonic-section"'), '#dsd-ultrasonic-section must exist');
    assert.ok(indexHtml.includes('id="dsd-ultrasonic-select"'), '#dsd-ultrasonic-select must exist');
    assert.ok(indexHtml.includes('id="dsd-ultrasonic-badge"'), '#dsd-ultrasonic-badge must exist');
    assert.ok(indexHtml.includes('id="dsd-ultrasonic-desc"'), '#dsd-ultrasonic-desc must exist');
    assert.ok(indexHtml.includes('applyDsdUltrasonicFilter'), 'applyDsdUltrasonicFilter must be defined');

    // CRITICAL AUDIO GRAPH INVARIANT
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: crossfeedNodes.output must connect directly to context.destination'
    );
  });
});
