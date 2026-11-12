'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── 1. Unit tests: parseReplayGain ──

describe('parseReplayGain', () => {
  it('xử lý tốt đầu vào null, undefined hoặc rỗng', () => {
    const res1 = library.parseReplayGain(null);
    assert.equal(res1.hasReplayGain, false);
    assert.equal(res1.trackGain, 0);
    assert.equal(res1.trackPeak, 1);

    const res2 = library.parseReplayGain({});
    assert.equal(res2.hasReplayGain, false);
    assert.equal(res2.trackGain, 0);
  });

  it('phân tích đúng chuỗi dB có dấu âm, dương, khoảng trắng và đơn vị dB', () => {
    const track = {
      replayGainTrackGain: '-6.50 dB',
      replayGainTrackPeak: '0.9882',
      replayGainAlbumGain: '+1.2 dB',
      replayGainAlbumPeak: '0.95'
    };
    const res = library.parseReplayGain(track);
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.hasTrackGain, true);
    assert.equal(res.hasAlbumGain, true);
    assert.equal(res.trackGain, -6.5);
    assert.equal(res.trackPeak, 0.9882);
    assert.equal(res.albumGain, 1.2);
    assert.equal(res.albumPeak, 0.95);
  });

  it('đọc được từ đối tượng tags lồng nhau (snake_case và UPPERCASE)', () => {
    const track = {
      tags: {
        REPLAYGAIN_TRACK_GAIN: '-4.8 dB',
        REPLAYGAIN_TRACK_PEAK: '0.92'
      }
    };
    const res = library.parseReplayGain(track);
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.trackGain, -4.8);
    assert.equal(res.trackPeak, 0.92);
  });

  it('đọc được từ mảng khung ID3v2 TXXX', () => {
    const track = {
      tags: {
        TXXX: [
          { description: 'replaygain_track_gain', data: '-7.20 dB' },
          { description: 'replaygain_track_peak', data: '0.999' },
          { description: 'replaygain_album_gain', data: '-5.10 dB' }
        ]
      }
    };
    const res = library.parseReplayGain(track);
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.trackGain, -7.2);
    assert.equal(res.trackPeak, 0.999);
    assert.equal(res.albumGain, -5.1);
  });

  it('tự fallback giữa trackGain và albumGain nếu một trong hai bị khuyết', () => {
    const onlyAlbum = { replayGainAlbumGain: '-3.5 dB' };
    const res = library.parseReplayGain(onlyAlbum);
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.albumGain, -3.5);
    assert.equal(res.trackGain, -3.5); // Fallback sang album gain
  });
});

// ── 2. Unit tests: computeReplayGainMultiplier ──

describe('computeReplayGainMultiplier', () => {
  it('trả về multiplier = 1 khi ReplayGain bị tắt', () => {
    const res = library.computeReplayGainMultiplier({ trackGain: -6 }, { enabled: false });
    assert.equal(res.multiplier, 1);
    assert.equal(res.effectiveDb, 0);
  });

  it('tính đúng linear multiplier cho mức giảm dB (Track mode)', () => {
    // -6 dB ≈ 0.501187
    const res = library.computeReplayGainMultiplier({ trackGain: -6, trackPeak: 0.9, hasTrackGain: true }, { enabled: true, mode: 'track' });
    assert.ok(Math.abs(res.multiplier - Math.pow(10, -6 / 20)) < 0.001);
    assert.equal(res.effectiveDb, -6);
    assert.equal(res.isClipped, false);
  });

  it('áp dụng bù Preamp dB cộng dồn', () => {
    // -6 dB + preamp +2 dB = -4 dB
    const res = library.computeReplayGainMultiplier({ trackGain: -6, hasTrackGain: true }, { enabled: true, preampDb: 2 });
    assert.equal(res.totalGainDb, -4);
    assert.equal(res.effectiveDb, -4);
  });

  it('chống clipping (Anti-clip) khi multiplier * peak > 1.0', () => {
    // Gain +6 dB (multiplier ≈ 2.0). Peak = 0.8 -> 2.0 * 0.8 = 1.6 > 1.0
    // Phải kẹp multiplier xuống 1.0 / 0.8 = 1.25
    const res = library.computeReplayGainMultiplier(
      { trackGain: 6, trackPeak: 0.8, hasTrackGain: true },
      { enabled: true, preventClipping: true }
    );
    assert.equal(res.isClipped, true);
    assert.ok(Math.abs(res.multiplier - 1.25) < 0.001);
  });

  it('phân biệt chế độ Track mode và Album mode', () => {
    const parsed = {
      trackGain: -2,
      albumGain: -8,
      hasTrackGain: true,
      hasAlbumGain: true
    };
    const trackRes = library.computeReplayGainMultiplier(parsed, { enabled: true, mode: 'track' });
    const albumRes = library.computeReplayGainMultiplier(parsed, { enabled: true, mode: 'album' });
    assert.equal(trackRes.effectiveDb, -2);
    assert.equal(albumRes.effectiveDb, -8);
  });
});

// ── 3. Unit tests: formatReplayGain ──

describe('formatReplayGain', () => {
  it('định dạng đúng các chuỗi hiển thị', () => {
    assert.equal(library.formatReplayGain(null), 'Bypass');
    assert.equal(library.formatReplayGain({ hasReplayGain: false }), 'Không có tag');

    const res1 = { effectiveDb: -6.5, mode: 'track', isClipped: false, hasReplayGain: true };
    assert.equal(library.formatReplayGain(res1), '-6.5 dB · Track');

    const res2 = { effectiveDb: 2.3, mode: 'album', isClipped: true, hasReplayGain: true };
    assert.equal(library.formatReplayGain(res2), '+2.3 dB · Album (Anti-clip)');
  });
});

// ── 4. Integration: computeSignalPath với ReplayGain ──

describe('Signal Path với ReplayGain', () => {
  it('hiển thị thông tin ReplayGain trong tầng DSP và đánh dấu ENHANCED', () => {
    const track = { format: 'FLAC', sampleRate: 44100, bitDepth: 16, source: 'local' };
    const pathData = library.computeSignalPath(track, {
      contextRate: 44100,
      eqEnabled: false,
      stereoBalance: 0,
      crossfeedEnabled: false,
      replayGainEnabled: true,
      replayGainText: '-5.2 dB · Track'
    });
    assert.equal(pathData.hasDsp, true);
    assert.ok(pathData.qualityLabel.includes('ENHANCED'));
    assert.ok(pathData.steps[2].description.includes('ReplayGain: -5.2 dB · Track'));
  });
});

// ── 5. DOM & HTML Integration tests ──

describe('ReplayGain DOM & HTML integration', () => {
  it('có các thành phần UI trong #eq-panel', () => {
    assert.ok(html.includes('id="replaygain-toggle"'), 'Có checkbox bật/tắt ReplayGain');
    assert.ok(html.includes('id="replaygain-badge"'), 'Có badge hiển thị mức dB ReplayGain');
    assert.ok(html.includes('id="replaygain-mode"'), 'Có select chọn chế độ Track / Album');
    assert.ok(html.includes('id="replaygain-preamp"'), 'Có slider chỉnh Preamp ReplayGain');
    assert.ok(html.includes('id="replaygain-preamp-val"'), 'Có nhãn hiển thị giá trị Preamp');
  });

  it('có các hàm quản lý ReplayGain trong script', () => {
    assert.ok(html.includes('function applyReplayGain'));
    assert.ok(html.includes('function updateReplayGainUi'));
    assert.ok(html.includes('function setReplayGainEnabled'));
    assert.ok(html.includes('function setReplayGainMode'));
    assert.ok(html.includes('function setReplayGainPreamp'));
  });

  it('displayTrack gọi applyReplayGain', () => {
    assert.ok(html.includes('applyReplayGain(track)'));
  });

  it('setGain áp dụng replayGainMultiplier vào effectiveVolume', () => {
    assert.ok(html.includes('rgMult'));
    assert.ok(html.includes('effectiveVolume'));
  });
});
