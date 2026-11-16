// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const autoeqCue = require('../autoeq-cue.js');

test('AutoEQ Headphone Database - 50+ Audiophile Profiles & 10-Band PEQ', async t => {
  const profiles = autoeqCue.getAutoEqProfiles();

  await t.test('database embeds at least 50 headphone profiles', () => {
    assert.ok(Array.isArray(profiles), 'Profiles must be an array');
    assert.ok(profiles.length >= 50, `Expected at least 50 profiles, got ${profiles.length}`);
  });

  await t.test('contains all specified flagship audiophile models', () => {
    const requiredModels = [
      // Sennheiser
      'sennheiser-hd600', 'sennheiser-hd650', 'sennheiser-hd800s',
      // Sony
      'sony-wh1000xm4', 'sony-wh1000xm5',
      // Moondrop
      'moondrop-aria', 'moondrop-kato', 'moondrop-blessing2',
      // FiiO
      'fiio-fh9', 'fiio-fd5', 'fiio-fa7s',
      // Apple
      'apple-airpods-pro', 'apple-airpods-max',
      // Hifiman
      'hifiman-sundara', 'hifiman-ananda',
      // Beyerdynamic
      'beyer-dt770', 'beyer-dt990',
      // Audio-Technica
      'ath-m50x',
      // Shure
      'shure-se215', 'shure-se846',
      // Focal
      'focal-clear', 'focal-utopia'
    ];

    const ids = profiles.map(p => p.id);
    for (const modelId of requiredModels) {
      assert.ok(ids.includes(modelId), `Database must contain model profile: ${modelId}`);
      const p = autoeqCue.getAutoEqProfile(modelId);
      assert.ok(p, `getAutoEqProfile must return profile for ${modelId}`);
      assert.equal(p.id, modelId);
    }
  });

  await t.test('every profile contains exactly 10 valid PEQ bands and safe headroom', () => {
    for (const profile of profiles) {
      assert.ok(profile.id, 'Profile must have an id');
      assert.ok(profile.name, 'Profile must have a name');
      assert.ok(profile.brand, 'Profile must have a brand');
      assert.ok(profile.category, 'Profile must have a category');
      assert.ok(Array.isArray(profile.bands), `Profile ${profile.id} must have bands array`);
      assert.equal(profile.bands.length, 10, `Profile ${profile.id} must have exactly 10 PEQ bands`);
      assert.ok(profile.preamp <= 0, `Profile ${profile.id} preamp must be <= 0 dB to avoid clipping (got ${profile.preamp})`);

      for (let i = 0; i < profile.bands.length; i++) {
        const band = profile.bands[i];
        assert.ok(
          ['peaking', 'lowshelf', 'highshelf'].includes(band.type),
          `Profile ${profile.id} band ${i} has invalid filter type: ${band.type}`
        );
        assert.ok(
          band.frequency >= 20 && band.frequency <= 20000,
          `Profile ${profile.id} band ${i} frequency must be within 20Hz - 20kHz (got ${band.frequency})`
        );
        assert.ok(
          band.gain >= -24 && band.gain <= 24,
          `Profile ${profile.id} band ${i} gain must be within ±24 dB (got ${band.gain})`
        );
        assert.ok(
          band.q >= 0.1 && band.q <= 18,
          `Profile ${profile.id} band ${i} Q factor must be within 0.1 - 18 (got ${band.q})`
        );
      }
    }
  });
});

test('AutoEQ Preset Engine - Search & State Application', async t => {
  await t.test('searchAutoEqProfiles matches by brand, model, and category', () => {
    const sennheiser = autoeqCue.searchAutoEqProfiles('sennheiser');
    assert.ok(sennheiser.length >= 6, 'Should find all Sennheiser models');
    assert.ok(sennheiser.every(p => p.brand.toLowerCase() === 'sennheiser'));

    const sonyXm5 = autoeqCue.searchAutoEqProfiles('1000xm5');
    assert.ok(sonyXm5.length >= 2, 'Should find WH-1000XM5 and WF-1000XM5');

    const moondropKato = autoeqCue.searchAutoEqProfiles('kato');
    assert.equal(moondropKato.length, 1);
    assert.equal(moondropKato[0].id, 'moondrop-kato');

    const aria = autoeqCue.searchAutoEqProfiles('aria');
    assert.ok(aria.some(p => p.id === 'moondrop-aria'));

    const fiio = autoeqCue.searchAutoEqProfiles('fiio');
    assert.ok(fiio.length >= 7, 'Should find FiiO models');

    const empty = autoeqCue.searchAutoEqProfiles('');
    assert.equal(empty.length, autoeqCue.getAutoEqProfiles().length, 'Empty search returns all profiles');
  });

  await t.test('applyAutoEqProfile correctly applies 10 PEQ bands and preamp to player state', () => {
    let eqApplied = false;
    const mockState = {
      autoEqProfile: 'none',
      preamp: 0,
      bandSerial: 0,
      bands: [],
      applyEq() {
        eqApplied = true;
      }
    };

    const res = autoeqCue.applyAutoEqProfile('sennheiser-hd800s', mockState);
    assert.equal(res.success, true);
    assert.equal(mockState.autoEqProfile, 'sennheiser-hd800s');
    assert.equal(mockState.preamp, -5.5);
    assert.equal(mockState.bands.length, 10);
    assert.equal(eqApplied, true);

    // Verify band IDs are assigned and sequential
    assert.equal(mockState.bands[0].id, 1);
    assert.equal(mockState.bands[9].id, 10);
    assert.equal(mockState.bands[0].type, 'lowshelf');
    assert.equal(mockState.bands[0].frequency, 35);
  });

  await t.test('applyAutoEqProfile handles bypass (none) and invalid profiles cleanly', () => {
    const mockState = {
      autoEqProfile: 'sennheiser-hd600',
      preamp: -4.5,
      bands: [{ id: 1, type: 'peaking', frequency: 1000, gain: 2, q: 1 }]
    };

    const bypassRes = autoeqCue.applyAutoEqProfile('none', mockState);
    assert.equal(bypassRes.success, true);
    assert.equal(mockState.autoEqProfile, 'none');
    assert.equal(mockState.bands.length, 0);
    assert.equal(mockState.preamp, 0);

    const invalidRes = autoeqCue.applyAutoEqProfile('unknown-headphone-id', mockState);
    assert.equal(invalidRes.success, false);
    assert.ok(invalidRes.error.includes('not found'));
  });
});

test('CUE Sheet Virtual Track Parser - Syntax & Time Calculation', async t => {
  const sampleCue = `
REM GENRE "Progressive Rock"
REM DATE 1973
PERFORMER "Pink Floyd"
TITLE "The Dark Side of the Moon"
FILE "Pink Floyd - The Dark Side of the Moon.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Speak to Me"
    PERFORMER "Pink Floyd"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Breathe (In the Air)"
    PERFORMER "Pink Floyd"
    INDEX 00 01:08:00
    INDEX 01 01:08:73
  TRACK 03 AUDIO
    TITLE "On the Run"
    PERFORMER "Pink Floyd"
    INDEX 01 03:32:45
  TRACK 04 AUDIO
    TITLE "Time"
    PERFORMER "Pink Floyd"
    INDEX 01 07:05:00
`;

  await t.test('parses CUE metadata and creates virtual tracks with isVirtualCue', () => {
    const tracks = autoeqCue.parseCueSheet(sampleCue, 600);

    assert.ok(Array.isArray(tracks));
    assert.equal(tracks.length, 4);
    assert.equal(tracks.album, 'The Dark Side of the Moon');
    assert.equal(tracks.artist, 'Pink Floyd');
    assert.equal(tracks.file, 'Pink Floyd - The Dark Side of the Moon.flac');

    // Track 1
    assert.equal(tracks[0].trackNumber, 1);
    assert.equal(tracks[0].title, 'Speak to Me');
    assert.equal(tracks[0].artist, 'Pink Floyd');
    assert.equal(tracks[0].startTime, 0);
    assert.equal(tracks[0].cueOffset, 0);
    assert.equal(tracks[0].isVirtualCue, true);

    // Track 2 with 73/75 frame calculation
    const expectedTrack2Start = 1 * 60 + 8 + 73 / 75;
    assert.equal(tracks[1].trackNumber, 2);
    assert.equal(tracks[1].title, 'Breathe (In the Air)');
    assert.equal(tracks[1].startTime, expectedTrack2Start);
    assert.equal(tracks[1].cueOffset, expectedTrack2Start);
    assert.equal(tracks[1].isVirtualCue, true);

    // Duration of Track 1 should equal startTime of Track 2
    assert.equal(tracks[0].duration, expectedTrack2Start);
    assert.equal(tracks[0].endTime, expectedTrack2Start);

    // Track 3 with 45/75 frame calculation
    const expectedTrack3Start = 3 * 60 + 32 + 45 / 75;
    assert.equal(tracks[2].trackNumber, 3);
    assert.equal(tracks[2].startTime, expectedTrack3Start);
    assert.equal(tracks[1].duration, expectedTrack3Start - expectedTrack2Start);
    assert.equal(tracks[1].endTime, expectedTrack3Start);

    // Track 4 (last track) with totalDuration = 600s
    const expectedTrack4Start = 7 * 60 + 5;
    assert.equal(tracks[3].trackNumber, 4);
    assert.equal(tracks[3].startTime, expectedTrack4Start);
    assert.equal(tracks[3].endTime, 600);
    assert.equal(tracks[3].duration, 600 - expectedTrack4Start);
  });

  await t.test('handles audioFile object parameter with duration and name', () => {
    const audioFileObj = {
      name: 'album-master.wav',
      duration: 500,
      url: 'blob:nocturne-master'
    };
    const tracks = autoeqCue.parseCueSheet(sampleCue, audioFileObj);
    assert.equal(tracks.length, 4);
    assert.equal(tracks[3].endTime, 500);
    assert.equal(tracks[3].duration, 500 - (7 * 60 + 5));
    assert.equal(tracks[0].isVirtualCue, true);
  });

  await t.test('handles empty or malformed inputs safely', () => {
    const empty = autoeqCue.parseCueSheet('');
    assert.ok(Array.isArray(empty));
    assert.equal(empty.length, 0);

    const nonString = autoeqCue.parseCueSheet(null);
    assert.ok(Array.isArray(nonString));
    assert.equal(nonString.length, 0);
  });
});

test('CUE Sheet Virtual Seek & Playback Integration', async t => {
  const virtualTrack = {
    trackNumber: 2,
    title: 'Breathe',
    startTime: 68.973,
    endTime: 212.6,
    duration: 143.627,
    isVirtualCue: true
  };

  const mockAudio = {
    currentTime: 68.973
  };

  await t.test('seekVirtualTrack offsets relative seconds into absolute audio position', () => {
    // Seek 30 seconds into virtual track
    const newPos = autoeqCue.seekVirtualTrack(mockAudio, virtualTrack, 30);
    assert.equal(newPos, 68.973 + 30);
    assert.equal(mockAudio.currentTime, 98.973);

    // Seek beyond duration clamps to track duration
    const clampedPos = autoeqCue.seekVirtualTrack(mockAudio, virtualTrack, 200);
    assert.equal(clampedPos, 68.973 + 143.627);
  });

  await t.test('getVirtualPlaybackProgress calculates relative position and progress fraction', () => {
    mockAudio.currentTime = 68.973 + 71.8135; // halfway through
    const progress = autoeqCue.getVirtualPlaybackProgress(mockAudio, virtualTrack);

    assert.ok(Math.abs(progress.current - 71.8135) < 0.001);
    assert.ok(Math.abs(progress.fraction - 0.5) < 0.01);
    assert.equal(progress.isEnded, false);

    // Track reached end
    mockAudio.currentTime = 212.6;
    const endProgress = autoeqCue.getVirtualPlaybackProgress(mockAudio, virtualTrack);
    assert.equal(endProgress.isEnded, true);
  });

  await t.test('shouldAdvanceVirtualTrack detects track transition point', () => {
    mockAudio.currentTime = 100;
    assert.equal(autoeqCue.shouldAdvanceVirtualTrack(mockAudio, virtualTrack), false);

    mockAudio.currentTime = 212.56;
    assert.equal(autoeqCue.shouldAdvanceVirtualTrack(mockAudio, virtualTrack), true);
  });
});

test('UI Integration & Audio Invariant in index.html', async t => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  await t.test('index.html loads autoeq-cue.js script tag', () => {
    assert.ok(
      html.includes('<script src="autoeq-cue.js"></script>'),
      'index.html must include <script src="autoeq-cue.js"></script>'
    );
  });

  await t.test('index.html contains AutoEQ modal and enhanced select elements', () => {
    assert.ok(html.includes('id="autoeq-select"'), 'Dropdown #autoeq-select must exist');
    assert.ok(html.includes('id="autoeq-modal"'), 'Modal #autoeq-modal must exist');
    assert.ok(html.includes('id="autoeq-modal-btn"'), 'Modal trigger button #autoeq-modal-btn must exist');
    assert.ok(html.includes('id="autoeq-modal-search"'), 'Search input #autoeq-modal-search must exist');
    assert.ok(html.includes('id="autoeq-modal-list"'), 'List container #autoeq-modal-list must exist');

    // Confirm key models are in #autoeq-select
    assert.ok(html.includes('value="sennheiser-hd800s"'), 'Option sennheiser-hd800s must exist');
    assert.ok(html.includes('value="sony-wh1000xm5"'), 'Option sony-wh1000xm5 must exist');
    assert.ok(html.includes('value="moondrop-aria"'), 'Option moondrop-aria must exist');
    assert.ok(html.includes('value="fiio-fh9"'), 'Option fiio-fh9 must exist');
    assert.ok(html.includes('value="apple-airpods-max"'), 'Option apple-airpods-max must exist');
    assert.ok(html.includes('value="focal-utopia"'), 'Option focal-utopia must exist');
  });

  await t.test('CRITICAL AUDIO INVARIANT: strictly preserves Web Audio destination routing', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL: Web Audio routing invariant state.crossfeedNodes.output.connect(state.context.destination) must be strictly preserved'
    );
  });
});
