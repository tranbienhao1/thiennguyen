const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const indexPath = path.join(__dirname, 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

test('cleanSearchQuery - chuẩn hóa tên bài hát và nghệ sĩ để tìm kiếm lời chính xác', () => {
  assert.equal(typeof library.cleanSearchQuery, 'function');

  const res1 = library.cleanSearchQuery('01. An Thần (Official Music Video).flac', 'Low G (ft. Thắng)');
  assert.equal(res1.title, 'An Thần');
  assert.equal(res1.artist, 'Low G');

  const res2 = library.cleanSearchQuery('Bad Guy [Lyrics].mp3', 'Billie Eilish');
  assert.equal(res2.title, 'Bad Guy');
  assert.equal(res2.artist, 'Billie Eilish');

  const res3 = library.cleanSearchQuery('02 - Hotel California (Live / Remastered).wav', 'Eagles');
  assert.equal(res3.title, 'Hotel California');
  assert.equal(res3.artist, 'Eagles');
});

test('generateDeterministicWaveform - sinh hình bao sóng âm sống động và xác định theo seed', () => {
  assert.equal(typeof library.generateDeterministicWaveform, 'function');

  const peaks1 = library.generateDeterministicWaveform('An Thần Low G', 200);
  assert.equal(peaks1 instanceof Float32Array, true);
  assert.equal(peaks1.length, 200);

  // Tính chất xác định (deterministic)
  const peaks2 = library.generateDeterministicWaveform('An Thần Low G', 200);
  assert.deepEqual(Array.from(peaks1), Array.from(peaks2));

  // Kiểm tra biên độ luôn nằm trong ngưỡng hiển thị đẹp mắt [0.12, 1.0]
  for (let i = 0; i < peaks1.length; i++) {
    assert.ok(peaks1[i] >= 0.1, `Peak at ${i} must be >= 0.1, got ${peaks1[i]}`);
    assert.ok(peaks1[i] <= 1.0, `Peak at ${i} must be <= 1.0, got ${peaks1[i]}`);
  }

  // Khác seed phải sinh ra dạng sóng khác biệt
  const peaksOther = library.generateDeterministicWaveform('Billie Eilish Bad Guy', 200);
  assert.notDeepEqual(Array.from(peaks1), Array.from(peaksOther));
});

test('index.html - Tự động tìm nạp lời bài hát qua LRCLIB và dán lời thủ công', () => {
  assert.ok(indexHtml.includes('async function triggerLyricsFetch(track)'), 'Phải có triggerLyricsFetch');
  assert.ok(indexHtml.includes('https://lrclib.net/api/get'), 'Phải kết nối tới LRCLIB API');
  assert.ok(indexHtml.includes('id="lyrics-retry-btn"'), 'Phải có nút tìm lời trực tuyến lại');
  assert.ok(indexHtml.includes('id="lyrics-paste-btn"'), 'Phải có nút dán lời .lrc');
  assert.ok(indexHtml.includes('triggerLyricsFetch(track)'), 'displayTrack phải kích hoạt triggerLyricsFetch khi chưa có lời');
});

test('index.html - High-DPI Waveform Seekbar và click tua nhạy bén', () => {
  assert.ok(indexHtml.includes('function syncCanvasDimensions(canvas)'), 'Phải có hàm syncCanvasDimensions theo DPR');
  assert.ok(indexHtml.includes('generateDeterministicWaveform'), 'generateTrackWaveform phải dùng fallback sóng xác định');
  assert.ok(indexHtml.includes('currentAudio.currentTime = targetTime'), 'Click waveform-canvas phải gán currentTime');
  assert.ok(indexHtml.includes('toast(`Đã tua dạng sóng tới'), 'Phải có toast thông báo khi tua dạng sóng');
});

test('Web Audio Graph - Bảo toàn tuyệt đối bất biến chuỗi âm thanh', () => {
  assert.ok(indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'Bất biến chuỗi crossfeed/audio context không được đổi');
});
