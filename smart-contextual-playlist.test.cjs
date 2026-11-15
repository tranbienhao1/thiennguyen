const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const library = require('./library-utils.js');

const indexHtmlPath = path.join(__dirname, 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

test('Pha C — Smart Contextual Playlist Engine & Acoustic Metadata Auto-Tagging', async t => {
  await t.test('autoTagTrackAcoustics accurately classifies quality tiers and dynamic range', () => {
    // DSD Direct Master
    const dsdTrack = { id: 't1', title: 'Hotel California', artist: 'Eagles', isDsd: true, format: 'dsd', sampleRate: 2822400 };
    const dsdTags = library.autoTagTrackAcoustics(dsdTrack);
    assert.ok(dsdTags.tags.includes('DSD Direct Master'), 'DSD track should have DSD Direct Master tag');
    assert.equal(dsdTags.dominantTag, 'DSD Direct Master');
    assert.ok(dsdTags.confidenceScore >= 0.6);

    // Hi-Res 24-bit 96kHz
    const hiResTrack = { id: 't2', title: 'Take Five', artist: 'Dave Brubeck', isHiRes: true, sampleRate: 96000, bitDepth: 24, genre: 'Jazz' };
    const hiResTags = library.autoTagTrackAcoustics(hiResTrack, { drScore: 14 });
    assert.ok(hiResTags.tags.includes('Hi-Res 24-bit'), 'Hi-Res track should have Hi-Res 24-bit tag');
    assert.ok(hiResTags.tags.includes('Dynamic Master (DR12+)'), 'High crest factor should have DR12+ tag');
    assert.ok(hiResTags.tags.includes('Vintage Jazz & Blues'), 'Jazz genre should have Vintage Jazz tag');

    // Compressed Loudness
    const popTrack = { id: 't3', title: 'Dance Club Hit', artist: 'DJ Spark', format: 'mp3', genre: 'EDM Dance', duration: 180 };
    const popTags = library.autoTagTrackAcoustics(popTrack, { drScore: 5 });
    assert.ok(popTags.tags.includes('Compressed Loudness'), 'Low crest factor should have Compressed tag');
    assert.ok(popTags.tags.includes('Sub-Bass EDM'), 'EDM genre should trigger Sub-Bass EDM tag');

    // Empty track fallback
    const emptyTags = library.autoTagTrackAcoustics(null);
    assert.ok(Array.isArray(emptyTags.tags));
    assert.equal(emptyTags.dominantTag, 'Audio');
  });

  await t.test('recommendContextualPlaylist handles daypart hour slots and presets', () => {
    const mockTracks = [
      { id: '1', title: 'Late Night Ballad', artist: 'Norah Jones', genre: 'Vocal Jazz', isHiRes: true, duration: 240 },
      { id: '2', title: 'Morning Run Techno', artist: 'Daft Punk', genre: 'Electronic Dance', duration: 210 },
      { id: '3', title: 'Deep Focus Ambient Piano', artist: 'Brian Eno', genre: 'Ambient Piano', duration: 320, rating: 5 },
      { id: '4', title: 'Master DSD Symphony', artist: 'Karajan', genre: 'Classical', isDsd: true, duration: 480 },
      { id: '5', title: 'Vintage 70s Soul', artist: 'Stevie Wonder', genre: 'Soul Funk', year: 1973, duration: 195 }
    ];

    // Late night context (hour 23)
    const lateNightRec = library.recommendContextualPlaylist(mockTracks, { hour: 23 });
    assert.equal(lateNightRec.id, 'late-night');
    assert.equal(lateNightRec.badge, 'LATE NIGHT');
    assert.ok(lateNightRec.tracks.length > 0);
    assert.ok(lateNightRec.tracks.some(t => t.id === '1' || t.id === '4'), 'Late night should prioritize Vocal/Jazz/DSD');

    // Morning high energy (hour 7)
    const morningRec = library.recommendContextualPlaylist(mockTracks, { hour: 7 });
    assert.equal(morningRec.id, 'high-energy');
    assert.equal(morningRec.badge, 'HIGH ENERGY');
    assert.ok(morningRec.tracks.some(t => t.id === '2'), 'Morning should prioritize dance/techno');

    // Afternoon deep focus (hour 14)
    const focusRec = library.recommendContextualPlaylist(mockTracks, { hour: 14 });
    assert.equal(focusRec.id, 'deep-focus');
    assert.equal(focusRec.badge, 'DEEP FOCUS');
    assert.ok(focusRec.tracks.some(t => t.id === '3'), 'Afternoon focus should prioritize ambient/piano');

    // Explicit hi-res-master preset
    const hiResRec = library.recommendContextualPlaylist(mockTracks, { context: 'hi-res-master' });
    assert.equal(hiResRec.id, 'hi-res-master');
    assert.ok(hiResRec.tracks.some(t => t.isDsd || t.isHiRes));

    // Seed track priority
    const seededRec = library.recommendContextualPlaylist(mockTracks, { context: 'late-night', seedTrackId: '1' });
    assert.equal(seededRec.tracks[0].id, '1', 'Seed track should rank at top');

    // Empty collection fallback
    const emptyRec = library.recommendContextualPlaylist([]);
    assert.equal(emptyRec.totalTracks, 0);
    assert.equal(emptyRec.formattedDuration, '0:00');
  });

  await t.test('formatContextualRecommendationBadge formats badge accurately', () => {
    const badgeText = library.formatContextualRecommendationBadge({
      icon: '🌙',
      title: 'Đêm Khuya Audiophile',
      totalTracks: 12,
      formattedDuration: '52 phút'
    });
    assert.ok(badgeText.includes('🌙'));
    assert.ok(badgeText.includes('Đêm Khuya Audiophile'));
    assert.ok(badgeText.includes('12 bài'));
    assert.ok(badgeText.includes('52 phút'));

    assert.equal(library.formatContextualRecommendationBadge(null), 'Gợi ý Ngữ cảnh');
  });

  await t.test('index.html contains smart contextual section and interactive controls', () => {
    assert.ok(indexHtml.includes('id="smart-contextual-section"'), 'Smart contextual section must exist in index.html');
    assert.ok(indexHtml.includes('id="contextual-heading"'), 'Contextual heading must exist');
    assert.ok(indexHtml.includes('id="contextual-time-badge"'), 'Contextual time badge must exist');
    assert.ok(indexHtml.includes('id="contextual-play-btn"'), 'Contextual play button must exist');
    assert.ok(indexHtml.includes('id="contextual-queue-btn"'), 'Contextual queue button must exist');
    assert.ok(indexHtml.includes('id="contextual-tracks-preview"'), 'Contextual tracks preview container must exist');
    assert.ok(indexHtml.includes('contextual-preset-pill'), 'Contextual preset pills must exist');
  });

  await t.test('Strict Invariant: Web Audio graph destination connection remains unaltered', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL: Web Audio crossfeed to destination connection must never be broken'
    );
  });
});
