const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const libraryPath = path.join(__dirname, 'library-utils.js');
const library = require(libraryPath);

test('Pha A: ROOM_ACOUSTIC_PROFILES defines expected acoustic spaces', () => {
  const profiles = library.ROOM_ACOUSTIC_PROFILES;
  assert.ok(profiles);
  assert.ok(profiles.bypass);
  assert.ok(profiles.studio);
  assert.ok(profiles.jazz_club);
  assert.ok(profiles.concert_hall);
  assert.ok(profiles.cathedral);

  assert.equal(profiles.bypass.rt60, 0);
  assert.equal(profiles.bypass.badge, 'BIT-PERFECT');

  assert.ok(profiles.studio.rt60 > 0);
  assert.ok(profiles.jazz_club.rt60 > profiles.studio.rt60);
  assert.ok(profiles.concert_hall.rt60 > profiles.jazz_club.rt60);
  assert.ok(profiles.cathedral.rt60 > profiles.concert_hall.rt60);

  const list = library.listRoomAcousticProfiles();
  assert.ok(list.length >= 5);
  assert.equal(list[0].id, 'bypass');
});

test('Pha A: getRoomAcousticProfile returns profile or fallback to bypass', () => {
  assert.equal(library.getRoomAcousticProfile('studio').id, 'studio');
  assert.equal(library.getRoomAcousticProfile('concert_hall').name, 'Symphony Concert Hall');
  assert.equal(library.getRoomAcousticProfile('unknown_id').id, 'bypass');
  assert.equal(library.getRoomAcousticProfile(null).id, 'bypass');
});

test('Pha A: clampAcousticWet clamps values between 0 and 1', () => {
  assert.equal(library.clampAcousticWet(0.35), 0.35);
  assert.equal(library.clampAcousticWet(-0.5), 0);
  assert.equal(library.clampAcousticWet(1.5), 1);
  assert.equal(library.clampAcousticWet('invalid'), 0.2);
});

test('Pha A: calculateAcousticWetDry adheres to equal-power energy preservation', () => {
  // Bypass
  const bypass = library.calculateAcousticWetDry('bypass', 0.5);
  assert.equal(bypass.wetGain, 0);
  assert.equal(bypass.dryGain, 1);

  // Studio at 0.25 wet
  const studio = library.calculateAcousticWetDry('studio', 0.25);
  assert.ok(studio.wetGain > 0);
  assert.ok(studio.dryGain < 1);
  // Equal power check: wet^2 + dry^2 ≈ 1
  const energy = Math.pow(studio.wetGain, 2) + Math.pow(studio.dryGain, 2);
  assert.ok(Math.abs(energy - 1) < 0.001, `Energy should be preserved (~1.0), got ${energy}`);

  // Concert Hall at 0.5 wet
  const hall = library.calculateAcousticWetDry('concert_hall', 0.5);
  const hallEnergy = Math.pow(hall.wetGain, 2) + Math.pow(hall.dryGain, 2);
  assert.ok(Math.abs(hallEnergy - 1) < 0.001);
});

test('Pha A: formatAcousticSummary creates readable UI badges and descriptions', () => {
  assert.equal(library.formatAcousticSummary('bypass', 0.2), 'Trực tiếp (Bit-Perfect)');
  assert.equal(library.formatAcousticSummary('studio', 0.2), 'Studio Control Room · 20% Ướt · RT60 0.28s');
  assert.equal(library.formatAcousticSummary('cathedral', 0.45), 'Sacred Cathedral · 45% Ướt · RT60 3.2s');
});

test('Pha A: generateImpulseResponse synthesizes stereo impulse responses', () => {
  // Bypass returns null
  const bypassIr = library.generateImpulseResponse('bypass', 44100);
  assert.equal(bypassIr, null);

  // Studio IR at 44100 Hz
  const studioIr = library.generateImpulseResponse('studio', 44100);
  assert.equal(studioIr.sampleRate, 44100);
  assert.equal(studioIr.channels, 2);
  assert.ok(studioIr.length > 0);
  assert.ok(studioIr.left instanceof Float32Array);
  assert.ok(studioIr.right instanceof Float32Array);
  assert.equal(studioIr.left.length, studioIr.length);
  assert.equal(studioIr.right.length, studioIr.length);

  // Peak amplitude normalized to <= 1.0
  let maxAmp = 0;
  for (let i = 0; i < studioIr.length; i++) {
    maxAmp = Math.max(maxAmp, Math.abs(studioIr.left[i]), Math.abs(studioIr.right[i]));
  }
  assert.ok(maxAmp <= 1.0, `Peak amplitude should be <= 1.0, got ${maxAmp}`);
  assert.ok(maxAmp > 0.5, `Peak amplitude should be reasonably scaled, got ${maxAmp}`);
});

test('Pha A: computeSignalPath includes Room Acoustics in DSP stage when active', () => {
  const dummyTrack = {
    title: 'Test Symphony',
    format: 'FLAC',
    sampleRate: 96000,
    bitsPerSample: 24,
    channels: 2
  };

  // When bypass, no room acoustics in DSP
  const pathBypass = library.computeSignalPath(dummyTrack, {
    roomAcousticProfile: 'bypass',
    roomAcousticWet: 0.2
  });
  assert.equal(pathBypass.qualityTier, 'highres');
  assert.equal(pathBypass.hasDsp, false);
  const dspBypassStep = pathBypass.steps.find(s => s.stage === 'dsp');
  assert.ok(dspBypassStep);
  assert.ok(!dspBypassStep.description.includes('Không gian phòng'));

  // When active (e.g. concert_hall)
  const pathActive = library.computeSignalPath(dummyTrack, {
    roomAcousticProfile: 'concert_hall',
    roomAcousticWet: 0.35
  });
  assert.ok(pathActive.hasDsp);
  const dspActiveStep = pathActive.steps.find(s => s.stage === 'dsp');
  assert.ok(dspActiveStep);
  assert.ok(dspActiveStep.description.includes('Không gian phòng: Symphony Concert Hall (35% wet)'));
});

test('Pha A: HTML markup & Audio Graph Invariant in index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

  // Verify UI controls
  assert.ok(html.includes('id="room-acoustics-section"'), '#room-acoustics-section must exist');
  assert.ok(html.includes('id="room-acoustics-select"'), '#room-acoustics-select must exist');
  assert.ok(html.includes('id="room-acoustics-wet"'), '#room-acoustics-wet must exist');
  assert.ok(html.includes('id="room-acoustics-wet-val"'), '#room-acoustics-wet-val must exist');
  assert.ok(html.includes('id="room-acoustics-badge"'), '#room-acoustics-badge must exist');
  assert.ok(html.includes('id="room-acoustics-desc"'), '#room-acoustics-desc must exist');

  // Verify options
  assert.ok(html.includes('value="bypass"'));
  assert.ok(html.includes('value="studio"'));
  assert.ok(html.includes('value="jazz_club"'));
  assert.ok(html.includes('value="concert_hall"'));
  assert.ok(html.includes('value="cathedral"'));

  // Audio Engine Invariant Check
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'CRITICAL: state.crossfeedNodes.output.connect(state.context.destination) must remain intact!'
  );
  assert.ok(
    html.includes('state.directAnalyser.connect(state.panner)') || html.includes('state.directAnalyser.connect(crossfeedInput)'),
    'Direct path must bypass DSP nodes for Bit-Perfect reproduction'
  );
});

test('Pha A: Backup & Restore handles room acoustics settings', () => {
  const config = library.exportAppConfiguration({
    roomAcousticProfile: 'jazz_club',
    roomAcousticWet: 0.4
  });
  assert.equal(config.settings.roomAcousticProfile, 'jazz_club');
  assert.equal(config.settings.roomAcousticWet, 0.4);

  const mockState = { roomAcousticProfile: 'bypass', roomAcousticWet: 0.2 };
  const res = library.mergeRestoredConfiguration(mockState, config);
  assert.equal(mockState.roomAcousticProfile, 'jazz_club');
  assert.equal(mockState.roomAcousticWet, 0.4);
  assert.ok(res.appliedSettingsCount >= 2);
});
