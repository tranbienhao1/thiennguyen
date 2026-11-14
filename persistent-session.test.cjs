'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: savePlaybackSession ──

describe('savePlaybackSession', () => {
  it('trả về null khi trackId không hợp lệ hoặc rỗng', () => {
    assert.equal(library.savePlaybackSession(null, 10), null);
    assert.equal(library.savePlaybackSession(undefined, 10), null);
    assert.equal(library.savePlaybackSession('', 10), null);
  });

  it('chuẩn hóa và serialize đúng cấu trúc phiên phát nhạc', () => {
    const raw = library.savePlaybackSession('trk-1', 45.678, ['trk-2', 'trk-3'], {
      wasPlaying: true,
      volume: 0.8,
      updatedAt: 1700000000000
    });
    assert.ok(typeof raw === 'string');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.trackId, 'trk-1');
    assert.equal(parsed.currentTime, 45.68);
    assert.deepEqual(parsed.queueTrackIds, ['trk-2', 'trk-3']);
    assert.equal(parsed.wasPlaying, true);
    assert.equal(parsed.volume, 0.8);
    assert.equal(parsed.updatedAt, 1700000000000);
  });

  it('xử lý an toàn khi các tham số không hợp lệ hoặc thiếu', () => {
    const raw = library.savePlaybackSession('trk-abc', -5, null);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.trackId, 'trk-abc');
    assert.equal(parsed.currentTime, 0);
    assert.deepEqual(parsed.queueTrackIds, []);
    assert.equal(parsed.wasPlaying, false);
  });
});

// ── 2. Unit tests: restorePlaybackSession ──

describe('restorePlaybackSession', () => {
  const tracks = [
    { id: 'trk-1', title: 'Bài hát 1', duration: 180 },
    { id: 'trk-2', title: 'Bài hát 2', duration: 240 },
    { id: 'trk-3', title: 'Bài hát 3', duration: 200 }
  ];

  it('trả về isValid: false khi session rỗng hoặc sai cú pháp', () => {
    assert.equal(library.restorePlaybackSession(null, tracks).isValid, false);
    assert.equal(library.restorePlaybackSession('', tracks).isValid, false);
    assert.equal(library.restorePlaybackSession('invalid json{', tracks).isValid, false);
  });

  it('trả về isValid: false khi trackId không có trong danh sách tracks', () => {
    const raw = JSON.stringify({ trackId: 'non-existent', currentTime: 30 });
    const res = library.restorePlaybackSession(raw, tracks);
    assert.equal(res.isValid, false);
    assert.equal(res.track, null);
  });

  it('khôi phục phiên phát hợp lệ và khớp với bài trong thư viện', () => {
    const raw = JSON.stringify({
      trackId: 'trk-2',
      currentTime: 65,
      queueTrackIds: ['trk-3', 'unknown-trk'],
      wasPlaying: true
    });
    const res = library.restorePlaybackSession(raw, tracks);
    assert.equal(res.isValid, true);
    assert.equal(res.track.id, 'trk-2');
    assert.equal(res.currentTime, 65);
    // Lọc bỏ bài không tồn tại khỏi hàng đợi
    assert.deepEqual(res.queueTrackIds, ['trk-3']);
    assert.equal(res.wasPlaying, true);
  });

  it('tự động reset currentTime về 0 nếu bài cũ đã nghe gần sát cuối bài (còn < 2s)', () => {
    // trk-1 duration 180s, vị trí 179s -> reset về 0
    const raw = JSON.stringify({ trackId: 'trk-1', currentTime: 179 });
    const res = library.restorePlaybackSession(raw, tracks);
    assert.equal(res.isValid, true);
    assert.equal(res.currentTime, 0);
  });
});

// ── 3. Unit tests: formatResumePrompt ──

describe('formatResumePrompt', () => {
  it('trả về câu hỏi tiếp tục nghe kèm mốc thời gian mm:ss', () => {
    const prompt = library.formatResumePrompt({ title: 'Nắng Có Mang Em Về' }, 125);
    assert.equal(prompt, 'Tiếp tục nghe "Nắng Có Mang Em Về" tại 2:05?');
  });

  it('trả về câu hỏi tiếp tục phát khi vị trí là 0', () => {
    const prompt = library.formatResumePrompt({ title: 'Nắng Có Mang Em Về' }, 0);
    assert.equal(prompt, 'Tiếp tục phát "Nắng Có Mang Em Về"?');
  });

  it('xử lý an toàn khi thiếu tiêu đề hoặc track không hợp lệ', () => {
    assert.equal(library.formatResumePrompt(null, 10), '');
    assert.equal(library.formatResumePrompt({}, 0), 'Tiếp tục phát "bài hát"?');
  });
});

// ── 4. DOM & Script Integration Tests ──

describe('DOM & Script Integration: Persistent Playback Session', () => {
  it('banner #resume-session-banner và các nút điều khiển tồn tại trong DOM', () => {
    assert.match(html, /id=["']resume-session-banner["']/);
    assert.match(html, /id=["']resume-session-text["']/);
    assert.match(html, /id=["']resume-session-play["']/);
    assert.match(html, /id=["']resume-session-dismiss["']/);
  });

  it('các hàm lưu và khôi phục phiên phát nhạc được khai báo trong script', () => {
    assert.match(html, /function savePlaybackSession\(/);
    assert.match(html, /function checkAndPromptResumeSession\(/);
    assert.match(html, /localStorage\.setItem\(['"]nocturne-playback-session['"]/);
  });

  it('state khởi tạo các biến lưu trữ phiên phát', () => {
    assert.match(html, /lastSessionSaveTime:\s*0/);
    assert.match(html, /pendingResumePosition:\s*null/);
  });

  it('bảo toàn tuyệt đối bất biến đồ thị âm thanh (Audio Invariant)', () => {
    assert.match(html, /state\.crossfeedNodes\.output\.connect\(state\.context\.destination\)/);
  });
});
