const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../library-utils.js');

test('Pha C — cleanLyricsSearchKey and calculateStringSimilarity', () => {
  const dirty1 = '01. Bài Ca Tình Yêu (feat. Low G) [Official Audio 2024].flac';
  const cleaned1 = lib.cleanLyricsSearchKey(dirty1);
  assert.equal(cleaned1, 'bai ca tinh yeu');

  const dirty2 = 'Shape of You [Remastered / Live Acoustic]';
  const cleaned2 = lib.cleanLyricsSearchKey(dirty2);
  assert.equal(cleaned2, 'shape of you');

  const simHigh = lib.calculateStringSimilarity('Shape of You', 'Shape of You (Official Music Video)');
  assert.ok(simHigh >= 0.85, 'Should have high similarity');

  const simLow = lib.calculateStringSimilarity('Shape of You', 'Bohemian Rhapsody');
  assert.ok(simLow < 0.2, 'Should have low similarity');
});

test('Pha C — scoreLyricsCandidateMatch evaluates candidates with fuzzy criteria', () => {
  const track = {
    title: 'An Thần (feat. Low G)',
    artist: 'Thắng, Low G',
    duration: 215
  };

  // 1. Excellent candidate
  const candExact = {
    trackName: 'An Thần',
    artistName: 'Thắng',
    duration: 216,
    syncedLyrics: '[00:12.50] Hít một hơi thật sâu...'
  };
  const score1 = lib.scoreLyricsCandidateMatch(track, candExact);
  assert.equal(score1.isAcceptable, true);
  assert.equal(score1.confidence, 'high');
  assert.ok(score1.matchScore >= 80);
  assert.equal(score1.isSynced, true);

  // 2. Mismatched duration candidate (>25s discrepancy)
  const candMismatchDur = {
    trackName: 'An Thần (Extended Remix)',
    artistName: 'Thắng',
    duration: 320,
    syncedLyrics: '[00:15.00] Intro...'
  };
  const score2 = lib.scoreLyricsCandidateMatch(track, candMismatchDur);
  assert.ok(score2.matchScore < score1.matchScore, 'Duration mismatch should lower score');

  // 3. Different song completely
  const candDifferent = {
    trackName: 'Hôm nay tôi buồn',
    artistName: 'Phùng Khánh Linh',
    duration: 240
  };
  const score3 = lib.scoreLyricsCandidateMatch(track, candDifferent);
  assert.equal(score3.isAcceptable, false);
  assert.equal(score3.confidence, 'low');
});

test('Pha C — normalizeAndSanitizeLrc sanitizes, sorts and filters spam', () => {
  const dirtyLrc = `
[ti:Bài Ca Mẫu]
[ar:Ca Sĩ Mẫu]
[01:00.5] Dòng thứ hai
lyrics by spammer_bot
www.fake-lyrics-download.com
[00:15.20] Dòng thứ nhất
[01:45.00] Dòng thứ ba
`;

  const cleanLrc = lib.normalizeAndSanitizeLrc(dirtyLrc);
  assert.ok(cleanLrc.includes('[ti:Bài Ca Mẫu]'));
  assert.ok(!cleanLrc.includes('spammer_bot'));
  assert.ok(!cleanLrc.includes('www.fake-lyrics-download.com'));

  // Verify chronological order: 00:15 should appear before 01:00
  const lines = cleanLrc.split('\n');
  const timeLines = lines.filter(l => l.startsWith('[0'));
  assert.equal(timeLines.length, 3);
  assert.ok(timeLines[0].includes('Dòng thứ nhất'));
  assert.ok(timeLines[1].includes('Dòng thứ hai'));
  assert.ok(timeLines[2].includes('Dòng thứ ba'));
});

test('Pha C — createLyricsVaultEntry and validateLyricsVaultEntry', () => {
  const track = { id: 'trk-101', title: 'Test Track', artist: 'Test Artist', duration: 180 };
  const rawLrc = '[00:10.00] Hello world\n[00:20.00] Second line\n[00:30.00] Third line';

  const entry = lib.createLyricsVaultEntry(track, rawLrc, { source: 'lrclib', matchScore: 92 });
  assert.equal(entry.version, 1);
  assert.equal(entry.trackId, 'trk-101');
  assert.equal(entry.isSynced, true);
  assert.equal(entry.linesCount, 3);
  assert.equal(entry.matchScore, 92);
  assert.ok(entry.savedAt > 0);
  assert.ok(entry.expiresAt > entry.savedAt);

  const validation = lib.validateLyricsVaultEntry(entry);
  assert.equal(validation.isValid, true);

  const invalidEntry = { trackId: '', lrcText: '' };
  const failValidation = lib.validateLyricsVaultEntry(invalidEntry);
  assert.equal(failValidation.isValid, false);

  const telemetry = lib.formatLyricsVaultTelemetry(entry);
  assert.ok(telemetry.includes('Đồng bộ'));
  assert.ok(telemetry.includes('LRCLIB'));
  assert.ok(telemetry.includes('92%'));
});

test('Pha C — scheduleQueueLyricsPreload prioritizes upcoming queue tracks without lyrics', () => {
  const queue = [
    { id: 't1', title: 'Playing Now', lyricsText: '[00:01.00] Line' },
    { id: 't2', title: 'Next Up 1' },
    { id: 't3', title: 'Next Up 2', lyricsText: '[00:01.00] Already cached' },
    { id: 't4', title: 'Next Up 3' },
    { id: 't5', title: 'Far away' }
  ];

  const targets = lib.scheduleQueueLyricsPreload(queue, 't1', { maxPreload: 3 });
  assert.equal(targets.length, 2, 'Should pick t2 and t4 (skipping t3 which has lyrics)');
  assert.equal(targets[0].id, 't2');
  assert.equal(targets[1].id, 't4');
});

test('Pha C — DOM integration & Web Audio Graph Invariant preservation in index.html', () => {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  // Verify invariant
  assert.ok(
    indexContent.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'Core audio invariant state.crossfeedNodes.output.connect(state.context.destination) must remain intact'
  );

  // Verify UI elements
  assert.ok(indexContent.includes('room-lyrics-source-badge'), 'Must contain #room-lyrics-source-badge');
  assert.ok(indexContent.includes('room-lyrics-refresh-btn'), 'Must contain #room-lyrics-refresh-btn');
});
