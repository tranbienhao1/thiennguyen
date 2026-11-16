/**
 * Nocturne - AutoEQ Headphone Database & CUE Sheet Virtual Track Engine
 * Audiophile 10-band Parametric EQ compensation & Red Book CUE sheet parser.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    const exports = factory();
    root.NocturneAutoEqCue = exports;
    root.getAutoEqProfiles = exports.getAutoEqProfiles;
    root.searchAutoEqProfiles = exports.searchAutoEqProfiles;
    root.getAutoEqProfile = exports.getAutoEqProfile;
    root.applyAutoEqProfile = exports.applyAutoEqProfile;
    root.parseCueSheet = exports.parseCueSheet;
    root.seekVirtualTrack = exports.seekVirtualTrack;
    root.getVirtualPlaybackProgress = exports.getVirtualPlaybackProgress;
    root.shouldAdvanceVirtualTrack = exports.shouldAdvanceVirtualTrack;

    // Automatically initialize UI when DOM is ready
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => exports.initAutoEqCueUI());
      } else {
        exports.initAutoEqCueUI();
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // Helper to create 10-band PEQ with safe headroom
  function create10BandProfile(id, name, brand, model, category, description, bands) {
    let maxBoost = 0;
    bands.forEach(b => {
      if (b.gain > maxBoost) maxBoost = b.gain;
    });
    const preamp = maxBoost > 0 ? -Math.round(maxBoost * 10) / 10 : 0;
    return {
      id,
      name,
      brand,
      model,
      category,
      description,
      preamp,
      bands: bands.map(b => ({
        type: b.type || 'peaking',
        frequency: Math.round(b.frequency),
        gain: Math.round(b.gain * 10) / 10,
        q: Math.round(b.q * 100) / 100
      }))
    };
  }

  // --- Audiophile Database: 50+ Top Headphone & IEM Profiles ---
  const AUTOEQ_DATABASE = {
    // === Sennheiser ===
    'sennheiser-hd600': create10BandProfile(
      'sennheiser-hd600', 'Sennheiser HD 600', 'Sennheiser', 'HD 600', 'Over-Ear Open',
      'Chuẩn âm học tham chiếu: bù sub-bass, tuyến tính dải trung và mượt mà dải cao',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 70, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 190, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 850, gain: -0.8, q: 1.5 },
        { type: 'peaking', frequency: 1250, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 2200, gain: -1.0, q: 2.2 },
        { type: 'peaking', frequency: 3200, gain: -2.0, q: 2.5 },
        { type: 'peaking', frequency: 5800, gain: 2.2, q: 3.0 },
        { type: 'peaking', frequency: 8200, gain: 1.5, q: 2.8 },
        { type: 'highshelf', frequency: 10000, gain: 1.5, q: 0.71 }
      ]
    ),
    'sennheiser-hd650': create10BandProfile(
      'sennheiser-hd650', 'Sennheiser HD 650 / 6XX', 'Sennheiser', 'HD 650', 'Over-Ear Open',
      'Harman Over-Ear: bù sub-bass dải sâu, gọt nhẹ mid-bass bloat, mở rộng treble air',
      [
        { type: 'lowshelf', frequency: 32, gain: 5.0, q: 0.71 },
        { type: 'peaking', frequency: 75, gain: 2.5, q: 1.1 },
        { type: 'peaking', frequency: 220, gain: -2.0, q: 1.1 },
        { type: 'peaking', frequency: 800, gain: -0.6, q: 1.5 },
        { type: 'peaking', frequency: 1300, gain: -1.0, q: 1.8 },
        { type: 'peaking', frequency: 2400, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 3300, gain: -1.8, q: 2.2 },
        { type: 'peaking', frequency: 5600, gain: 3.0, q: 2.8 },
        { type: 'peaking', frequency: 8200, gain: 1.2, q: 2.5 },
        { type: 'highshelf', frequency: 10500, gain: 2.0, q: 0.71 }
      ]
    ),
    'sennheiser-hd800s': create10BandProfile(
      'sennheiser-hd800s', 'Sennheiser HD 800 S', 'Sennheiser', 'HD 800 S', 'Over-Ear Open',
      'Đỉnh cao âm trường 3D: bù dải sub-bass phẳng, kiểm soát đỉnh nhọn 6kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 5.5, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 3.0, q: 1.0 },
        { type: 'peaking', frequency: 250, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 750, gain: 0.5, q: 1.4 },
        { type: 'peaking', frequency: 1500, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 2600, gain: 1.5, q: 2.2 },
        { type: 'peaking', frequency: 3800, gain: -1.0, q: 2.5 },
        { type: 'peaking', frequency: 5800, gain: -5.5, q: 3.5 },
        { type: 'peaking', frequency: 7800, gain: 1.8, q: 2.5 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),
    'sennheiser-hd560s': create10BandProfile(
      'sennheiser-hd560s', 'Sennheiser HD 560S', 'Sennheiser', 'HD 560S', 'Over-Ear Open',
      'Chất âm kiểm âm tuyến tính: tăng nhẹ sub-bass, làm mượt dải 4.5kHz',
      [
        { type: 'lowshelf', frequency: 38, gain: 3.5, q: 0.71 },
        { type: 'peaking', frequency: 100, gain: 1.5, q: 1.2 },
        { type: 'peaking', frequency: 280, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: -2.5, q: 2.8 },
        { type: 'peaking', frequency: 6200, gain: 1.5, q: 2.5 },
        { type: 'peaking', frequency: 8500, gain: -1.8, q: 3.0 },
        { type: 'highshelf', frequency: 11000, gain: 1.2, q: 0.71 }
      ]
    ),
    'sennheiser-hd660s': create10BandProfile(
      'sennheiser-hd660s', 'Sennheiser HD 660S', 'Sennheiser', 'HD 660S', 'Over-Ear Open',
      'Độ động nhanh: bù dải sub-bass và mở rộng upper-treble 10kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.8, q: 0.71 },
        { type: 'peaking', frequency: 80, gain: 2.2, q: 1.1 },
        { type: 'peaking', frequency: 220, gain: -1.5, q: 1.3 },
        { type: 'peaking', frequency: 850, gain: -0.6, q: 1.5 },
        { type: 'peaking', frequency: 1400, gain: -1.0, q: 1.8 },
        { type: 'peaking', frequency: 2500, gain: 1.2, q: 2.0 },
        { type: 'peaking', frequency: 3600, gain: -1.5, q: 2.2 },
        { type: 'peaking', frequency: 5400, gain: 2.5, q: 2.6 },
        { type: 'peaking', frequency: 8000, gain: 1.8, q: 2.5 },
        { type: 'highshelf', frequency: 11000, gain: 2.5, q: 0.71 }
      ]
    ),
    'sennheiser-hd700': create10BandProfile(
      'sennheiser-hd700', 'Sennheiser HD 700', 'Sennheiser', 'HD 700', 'Over-Ear Open',
      'Triệt tiêu đỉnh 6kHz gắt gỏng, tái tạo âm sắc tự nhiên hài hòa',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: 1.5, q: 1.2 },
        { type: 'peaking', frequency: 280, gain: -1.2, q: 1.4 },
        { type: 'peaking', frequency: 900, gain: 0.8, q: 1.5 },
        { type: 'peaking', frequency: 1800, gain: 1.5, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: -1.5, q: 2.2 },
        { type: 'peaking', frequency: 6000, gain: -6.0, q: 3.5 },
        { type: 'peaking', frequency: 7800, gain: 1.5, q: 2.5 },
        { type: 'peaking', frequency: 9500, gain: -2.5, q: 2.8 },
        { type: 'highshelf', frequency: 12000, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Sony ===
    'sony-wh1000xm4': create10BandProfile(
      'sony-wh1000xm4', 'Sony WH-1000XM4', 'Sony', 'WH-1000XM4', 'Over-Ear ANC',
      'Cắt bỏ bass bloat, mở rộng vocal trong trẻo và tăng chi tiết âm trường',
      [
        { type: 'lowshelf', frequency: 40, gain: -2.0, q: 0.71 },
        { type: 'peaking', frequency: 150, gain: -5.0, q: 0.8 },
        { type: 'peaking', frequency: 400, gain: 1.2, q: 1.5 },
        { type: 'peaking', frequency: 700, gain: 1.8, q: 1.4 },
        { type: 'peaking', frequency: 1500, gain: -1.2, q: 1.8 },
        { type: 'peaking', frequency: 2400, gain: 3.5, q: 1.8 },
        { type: 'peaking', frequency: 4200, gain: -1.8, q: 2.0 },
        { type: 'peaking', frequency: 6500, gain: -2.5, q: 2.5 },
        { type: 'peaking', frequency: 8000, gain: 1.5, q: 2.0 },
        { type: 'highshelf', frequency: 8500, gain: 3.0, q: 0.71 }
      ]
    ),
    'sony-wh1000xm5': create10BandProfile(
      'sony-wh1000xm5', 'Sony WH-1000XM5', 'Sony', 'WH-1000XM5', 'Over-Ear ANC',
      'Harman Target Over-Ear: gọt bass quá đà, làm rõ giọng ca và dải cao tinh tế',
      [
        { type: 'lowshelf', frequency: 45, gain: -2.5, q: 0.71 },
        { type: 'peaking', frequency: 140, gain: -4.0, q: 0.9 },
        { type: 'peaking', frequency: 380, gain: 1.2, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: 1.8, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 2500, gain: 3.2, q: 1.8 },
        { type: 'peaking', frequency: 4000, gain: -1.8, q: 2.0 },
        { type: 'peaking', frequency: 6200, gain: -2.2, q: 2.5 },
        { type: 'peaking', frequency: 8200, gain: 1.0, q: 2.0 },
        { type: 'highshelf', frequency: 10500, gain: 2.5, q: 0.71 }
      ]
    ),
    'sony-wf1000xm4': create10BandProfile(
      'sony-wf1000xm4', 'Sony WF-1000XM4', 'Sony', 'WF-1000XM4', 'In-Ear TWS',
      'Cân chỉnh In-Ear: làm sạch upper-bass, nâng vocal presence 3kHz',
      [
        { type: 'lowshelf', frequency: 40, gain: -1.5, q: 0.71 },
        { type: 'peaking', frequency: 130, gain: -2.5, q: 1.0 },
        { type: 'peaking', frequency: 450, gain: 1.0, q: 1.4 },
        { type: 'peaking', frequency: 950, gain: -0.8, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.5, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: 2.8, q: 2.0 },
        { type: 'peaking', frequency: 4800, gain: -1.5, q: 2.2 },
        { type: 'peaking', frequency: 6800, gain: -2.0, q: 2.5 },
        { type: 'peaking', frequency: 8500, gain: 1.5, q: 2.0 },
        { type: 'highshelf', frequency: 11000, gain: 2.0, q: 0.71 }
      ]
    ),
    'sony-wf1000xm5': create10BandProfile(
      'sony-wf1000xm5', 'Sony WF-1000XM5', 'Sony', 'WF-1000XM5', 'In-Ear TWS',
      'Chất âm Hi-Res TWS: kiểm soát bass ấm, đẩy âm trường và dải cao thoáng đãng',
      [
        { type: 'lowshelf', frequency: 35, gain: -1.2, q: 0.71 },
        { type: 'peaking', frequency: 150, gain: -2.2, q: 1.1 },
        { type: 'peaking', frequency: 420, gain: 1.0, q: 1.5 },
        { type: 'peaking', frequency: 1000, gain: -0.6, q: 1.6 },
        { type: 'peaking', frequency: 2000, gain: 1.8, q: 1.8 },
        { type: 'peaking', frequency: 3200, gain: 2.5, q: 2.0 },
        { type: 'peaking', frequency: 5000, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 7000, gain: -2.2, q: 2.6 },
        { type: 'peaking', frequency: 9000, gain: 1.8, q: 2.2 },
        { type: 'highshelf', frequency: 12000, gain: 2.2, q: 0.71 }
      ]
    ),
    'sony-mdr7506': create10BandProfile(
      'sony-mdr7506', 'Sony MDR-7506', 'Sony', 'MDR-7506', 'Over-Ear Studio',
      'Huyền thoại phòng thu: làm dịu dải cao 4-10kHz gắt, bổ sung lực sub-bass',
      [
        { type: 'lowshelf', frequency: 45, gain: 3.5, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: 1.2, q: 1.2 },
        { type: 'peaking', frequency: 280, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 850, gain: 0.8, q: 1.5 },
        { type: 'peaking', frequency: 1800, gain: -1.5, q: 1.8 },
        { type: 'peaking', frequency: 3200, gain: -2.0, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: -4.5, q: 2.8 },
        { type: 'peaking', frequency: 6500, gain: -2.0, q: 2.5 },
        { type: 'peaking', frequency: 8500, gain: -4.0, q: 3.0 },
        { type: 'highshelf', frequency: 11000, gain: 1.0, q: 0.71 }
      ]
    ),
    'sony-mdr1am2': create10BandProfile(
      'sony-mdr1am2', 'Sony MDR-1AM2', 'Sony', 'MDR-1AM2', 'Over-Ear Portable',
      'Gọt nhẹ mid-bass nồng ấm, tăng cường độ nét dải trung âm và treble',
      [
        { type: 'lowshelf', frequency: 35, gain: -1.5, q: 0.71 },
        { type: 'peaking', frequency: 160, gain: -3.5, q: 1.0 },
        { type: 'peaking', frequency: 450, gain: 1.2, q: 1.4 },
        { type: 'peaking', frequency: 1100, gain: -0.8, q: 1.6 },
        { type: 'peaking', frequency: 2200, gain: 2.5, q: 1.8 },
        { type: 'peaking', frequency: 3500, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 5500, gain: 2.0, q: 2.4 },
        { type: 'peaking', frequency: 7200, gain: -2.5, q: 2.8 },
        { type: 'peaking', frequency: 9500, gain: 1.5, q: 2.2 },
        { type: 'highshelf', frequency: 12000, gain: 1.8, q: 0.71 }
      ]
    ),
    'sony-ier-m9': create10BandProfile(
      'sony-ier-m9', 'Sony IER-M9', 'Sony', 'IER-M9', 'In-Ear Monitor',
      '5 BA Monitor tham chiếu: nâng độ mở vocal 3kHz và lấp lánh dải siêu cao',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.5, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: -0.8, q: 1.2 },
        { type: 'peaking', frequency: 380, gain: 0.5, q: 1.5 },
        { type: 'peaking', frequency: 900, gain: -0.5, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 3100, gain: 2.0, q: 2.0 },
        { type: 'peaking', frequency: 4800, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 6800, gain: 1.8, q: 2.5 },
        { type: 'peaking', frequency: 9200, gain: -1.5, q: 2.8 },
        { type: 'highshelf', frequency: 13000, gain: 2.5, q: 0.71 }
      ]
    ),
    'sony-ier-z1r': create10BandProfile(
      'sony-ier-z1r', 'Sony IER-Z1R', 'Sony', 'IER-Z1R', 'In-Ear Flagship',
      'Đỉnh cao tai nghe IEM: làm mịn upper-midrange, tôn vinh sub-bass tráng lệ',
      [
        { type: 'lowshelf', frequency: 30, gain: 1.0, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: -1.0, q: 1.2 },
        { type: 'peaking', frequency: 350, gain: 0.8, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: -0.6, q: 1.6 },
        { type: 'peaking', frequency: 1500, gain: 1.5, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: 2.2, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: -2.0, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: -3.0, q: 3.0 },
        { type: 'peaking', frequency: 9000, gain: 1.2, q: 2.2 },
        { type: 'highshelf', frequency: 12500, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Moondrop ===
    'moondrop-aria': create10BandProfile(
      'moondrop-aria', 'Moondrop Aria', 'Moondrop', 'Aria', 'In-Ear Monitor',
      'Harman VDSF chuẩn mực: tăng nhẹ sub-bass, làm mịn đỉnh 6.5kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.8, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: -1.0, q: 1.2 },
        { type: 'peaking', frequency: 300, gain: 0.5, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 6500, gain: -2.5, q: 3.0 },
        { type: 'peaking', frequency: 9000, gain: 1.2, q: 2.5 },
        { type: 'highshelf', frequency: 12000, gain: -1.0, q: 0.71 }
      ]
    ),
    'moondrop-kato': create10BandProfile(
      'moondrop-kato', 'Moondrop Kato', 'Moondrop', 'Kato', 'In-Ear Monitor',
      'Dynamic Driver cao cấp: cân bằng tự nhiên dải vocal và kiểm soát treble sắc sảo',
      [
        { type: 'lowshelf', frequency: 30, gain: 2.0, q: 0.71 },
        { type: 'peaking', frequency: 100, gain: -0.8, q: 1.2 },
        { type: 'peaking', frequency: 350, gain: 0.6, q: 1.5 },
        { type: 'peaking', frequency: 950, gain: -0.5, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.2, q: 2.0 },
        { type: 'peaking', frequency: 3000, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 4800, gain: 2.2, q: 2.4 },
        { type: 'peaking', frequency: 6800, gain: -2.0, q: 2.8 },
        { type: 'peaking', frequency: 9500, gain: 1.5, q: 2.2 },
        { type: 'highshelf', frequency: 13000, gain: -1.5, q: 0.71 }
      ]
    ),
    'moondrop-blessing2': create10BandProfile(
      'moondrop-blessing2', 'Moondrop Blessing 2', 'Moondrop', 'Blessing 2', 'In-Ear Monitor',
      '1DD + 4BA Hybrid: bù đắp sub-bass ấm áp, giữ trọn độ nét chi tiết micro-details',
      [
        { type: 'lowshelf', frequency: 40, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: 1.5, q: 1.2 },
        { type: 'peaking', frequency: 400, gain: -0.8, q: 1.4 },
        { type: 'peaking', frequency: 1000, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 2000, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 3200, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 5000, gain: 1.8, q: 2.5 },
        { type: 'peaking', frequency: 7000, gain: -2.0, q: 3.0 },
        { type: 'peaking', frequency: 9200, gain: 2.0, q: 2.5 },
        { type: 'highshelf', frequency: 12000, gain: 1.0, q: 0.71 }
      ]
    ),
    'moondrop-blessing2-dusk': create10BandProfile(
      'moondrop-blessing2-dusk', 'Moondrop Blessing 2 Dusk', 'Moondrop', 'Blessing 2 Dusk', 'In-Ear Monitor',
      'Crinacle Tuning chuẩn mực: sub-bass sâu chắc khỏe, vocal truyền cảm',
      [
        { type: 'lowshelf', frequency: 35, gain: 2.0, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: -0.5, q: 1.2 },
        { type: 'peaking', frequency: 380, gain: 0.4, q: 1.5 },
        { type: 'peaking', frequency: 900, gain: -0.5, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4600, gain: 1.5, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: -1.8, q: 2.8 },
        { type: 'peaking', frequency: 9000, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 12500, gain: 1.2, q: 0.71 }
      ]
    ),
    'moondrop-chu': create10BandProfile(
      'moondrop-chu', 'Moondrop Chu', 'Moondrop', 'Chu', 'In-Ear Entry',
      'Tai nghe quốc dân: bù dải sub-bass ấm áp, hạ nhiệt đỉnh treble 6-8kHz',
      [
        { type: 'lowshelf', frequency: 45, gain: 3.5, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: 1.2, q: 1.2 },
        { type: 'peaking', frequency: 350, gain: -0.6, q: 1.4 },
        { type: 'peaking', frequency: 850, gain: -0.4, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: 1.5, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: -3.5, q: 3.0 },
        { type: 'peaking', frequency: 8500, gain: -2.5, q: 3.0 },
        { type: 'highshelf', frequency: 11000, gain: -1.0, q: 0.71 }
      ]
    ),
    'moondrop-chu2': create10BandProfile(
      'moondrop-chu2', 'Moondrop Chu II', 'Moondrop', 'Chu II', 'In-Ear Entry',
      'Dynamic Brass Nozzle: kiểm soát upper-bass gọn gàng, tăng độ mở vocal',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.2, q: 0.71 },
        { type: 'peaking', frequency: 140, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 400, gain: 0.8, q: 1.5 },
        { type: 'peaking', frequency: 950, gain: -0.5, q: 1.6 },
        { type: 'peaking', frequency: 1900, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 3100, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4800, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 6800, gain: -2.2, q: 2.8 },
        { type: 'peaking', frequency: 9200, gain: 1.5, q: 2.4 },
        { type: 'highshelf', frequency: 12000, gain: -0.8, q: 0.71 }
      ]
    ),
    'moondrop-starfield': create10BandProfile(
      'moondrop-starfield', 'Moondrop Starfield', 'Moondrop', 'Starfield', 'In-Ear Monitor',
      'Carbon Nanotube diaphragm: tối ưu vocal ấm mộc, làm phẳng dải treble',
      [
        { type: 'lowshelf', frequency: 38, gain: 1.5, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: -0.8, q: 1.2 },
        { type: 'peaking', frequency: 320, gain: 0.5, q: 1.4 },
        { type: 'peaking', frequency: 850, gain: -0.4, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2900, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4600, gain: 1.8, q: 2.4 },
        { type: 'peaking', frequency: 6600, gain: -2.0, q: 2.8 },
        { type: 'peaking', frequency: 9000, gain: 1.2, q: 2.4 },
        { type: 'highshelf', frequency: 11500, gain: -0.5, q: 0.71 }
      ]
    ),
    'moondrop-variations': create10BandProfile(
      'moondrop-variations', 'Moondrop Variations', 'Moondrop', 'Variations', 'In-Ear Tribrid',
      'Tribrid EST + BA + DD: kiểm soát mid-bass gap, làm mượt vocal tự nhiên',
      [
        { type: 'lowshelf', frequency: 30, gain: -1.0, q: 0.71 },
        { type: 'peaking', frequency: 150, gain: 1.5, q: 1.2 },
        { type: 'peaking', frequency: 400, gain: 1.0, q: 1.5 },
        { type: 'peaking', frequency: 1000, gain: -0.5, q: 1.6 },
        { type: 'peaking', frequency: 2000, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 3200, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 5000, gain: 1.8, q: 2.5 },
        { type: 'peaking', frequency: 7200, gain: -2.0, q: 2.8 },
        { type: 'peaking', frequency: 9500, gain: 1.5, q: 2.4 },
        { type: 'highshelf', frequency: 13000, gain: 1.0, q: 0.71 }
      ]
    ),

    // === FiiO ===
    'fiio-fh9': create10BandProfile(
      'fiio-fh9', 'FiiO FH9', 'FiiO', 'FH9', 'In-Ear Flagship Hybrid',
      '1DD + 6 Knowles BA: gọt nhẹ upper-bass, nâng độ mở dải vocal trung tâm',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.5, q: 0.71 },
        { type: 'peaking', frequency: 150, gain: -2.0, q: 1.2 },
        { type: 'peaking', frequency: 450, gain: 1.0, q: 1.4 },
        { type: 'peaking', frequency: 1100, gain: -1.0, q: 1.6 },
        { type: 'peaking', frequency: 2200, gain: 2.2, q: 2.0 },
        { type: 'peaking', frequency: 3800, gain: -1.5, q: 2.2 },
        { type: 'peaking', frequency: 5500, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 7200, gain: -3.0, q: 3.0 },
        { type: 'peaking', frequency: 9500, gain: 1.8, q: 2.5 },
        { type: 'highshelf', frequency: 13000, gain: 1.5, q: 0.71 }
      ]
    ),
    'fiio-fd5': create10BandProfile(
      'fiio-fd5', 'FiiO FD5', 'FiiO', 'FD5', 'In-Ear Beryllium Dynamic',
      'Beryllium Diamond Dynamic: triệt tiêu đỉnh 6kHz gắt, cân bằng dải trung',
      [
        { type: 'lowshelf', frequency: 40, gain: -1.0, q: 0.71 },
        { type: 'peaking', frequency: 180, gain: -2.5, q: 1.1 },
        { type: 'peaking', frequency: 500, gain: 1.2, q: 1.5 },
        { type: 'peaking', frequency: 1200, gain: -1.2, q: 1.8 },
        { type: 'peaking', frequency: 2400, gain: 2.5, q: 2.0 },
        { type: 'peaking', frequency: 4000, gain: -2.0, q: 2.2 },
        { type: 'peaking', frequency: 6000, gain: -4.0, q: 3.0 },
        { type: 'peaking', frequency: 8000, gain: 1.5, q: 2.5 },
        { type: 'peaking', frequency: 10000, gain: -2.5, q: 2.8 },
        { type: 'highshelf', frequency: 13000, gain: 1.0, q: 0.71 }
      ]
    ),
    'fiio-fa7s': create10BandProfile(
      'fiio-fa7s', 'FiiO FA7S', 'FiiO', 'FA7S', 'In-Ear Balanced Armature',
      '6 BA Balanced Tuning: tăng dải siêu trầm, mở rộng không gian 3D soundstage',
      [
        { type: 'lowshelf', frequency: 38, gain: 2.0, q: 0.71 },
        { type: 'peaking', frequency: 160, gain: -1.8, q: 1.2 },
        { type: 'peaking', frequency: 480, gain: 0.8, q: 1.4 },
        { type: 'peaking', frequency: 1150, gain: -0.8, q: 1.6 },
        { type: 'peaking', frequency: 2300, gain: 2.0, q: 2.0 },
        { type: 'peaking', frequency: 3600, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 5800, gain: 2.2, q: 2.5 },
        { type: 'peaking', frequency: 7500, gain: -2.5, q: 3.0 },
        { type: 'peaking', frequency: 9800, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 12500, gain: 1.0, q: 0.71 }
      ]
    ),
    'fiio-fh7': create10BandProfile(
      'fiio-fh7', 'FiiO FH7', 'FiiO', 'FH7', 'In-Ear Hybrid',
      'Beryllium 13.6mm DD + 4BA: cân chỉnh mid-bass mượt mà, kiểm soát sibilance',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.2, q: 0.71 },
        { type: 'peaking', frequency: 160, gain: -2.2, q: 1.1 },
        { type: 'peaking', frequency: 450, gain: 1.0, q: 1.4 },
        { type: 'peaking', frequency: 1100, gain: -1.0, q: 1.6 },
        { type: 'peaking', frequency: 2200, gain: 2.0, q: 2.0 },
        { type: 'peaking', frequency: 3800, gain: -1.8, q: 2.2 },
        { type: 'peaking', frequency: 5600, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 7400, gain: -3.2, q: 3.0 },
        { type: 'peaking', frequency: 9400, gain: 1.5, q: 2.4 },
        { type: 'highshelf', frequency: 12500, gain: 1.2, q: 0.71 }
      ]
    ),
    'fiio-fd7': create10BandProfile(
      'fiio-fd7', 'FiiO FD7', 'FiiO', 'FD7', 'In-Ear Pure Beryllium',
      'Màng Pure Beryllium nguyên chất: dải cao tự nhiên, sub-bass chắc gọn',
      [
        { type: 'lowshelf', frequency: 32, gain: 1.8, q: 0.71 },
        { type: 'peaking', frequency: 140, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 420, gain: 0.8, q: 1.5 },
        { type: 'peaking', frequency: 1000, gain: -0.6, q: 1.6 },
        { type: 'peaking', frequency: 2100, gain: 1.8, q: 1.8 },
        { type: 'peaking', frequency: 3500, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 5400, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 7200, gain: -2.5, q: 2.8 },
        { type: 'peaking', frequency: 9600, gain: 1.5, q: 2.2 },
        { type: 'highshelf', frequency: 13000, gain: 1.0, q: 0.71 }
      ]
    ),
    'fiio-fh3': create10BandProfile(
      'fiio-fh3', 'FiiO FH3', 'FiiO', 'FH3', 'In-Ear Hybrid Entry',
      'Bass mạnh mẽ: gọt nhẹ lượng bass thừa, tăng độ nét dải trung âm vocal',
      [
        { type: 'lowshelf', frequency: 40, gain: -1.5, q: 0.71 },
        { type: 'peaking', frequency: 170, gain: -3.0, q: 1.1 },
        { type: 'peaking', frequency: 450, gain: 1.2, q: 1.4 },
        { type: 'peaking', frequency: 1100, gain: -0.8, q: 1.6 },
        { type: 'peaking', frequency: 2200, gain: 2.2, q: 1.8 },
        { type: 'peaking', frequency: 3600, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 5800, gain: 2.0, q: 2.4 },
        { type: 'peaking', frequency: 7500, gain: -3.0, q: 3.0 },
        { type: 'peaking', frequency: 9500, gain: 1.8, q: 2.4 },
        { type: 'highshelf', frequency: 12000, gain: 1.5, q: 0.71 }
      ]
    ),
    'fiio-ft3': create10BandProfile(
      'fiio-ft3', 'FiiO FT3', 'FiiO', 'FT3', 'Over-Ear Open',
      '60mm Dynamic Driver: bổ sung sub-bass sâu, làm mượt dải trung cao',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.2, q: 0.71 },
        { type: 'peaking', frequency: 90, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 240, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 800, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2600, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 3800, gain: 1.8, q: 2.2 },
        { type: 'peaking', frequency: 5800, gain: -2.8, q: 2.8 },
        { type: 'peaking', frequency: 8200, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 11000, gain: 1.2, q: 0.71 }
      ]
    ),

    // === Apple ===
    'apple-airpods-pro': create10BandProfile(
      'apple-airpods-pro', 'Apple AirPods Pro', 'Apple', 'AirPods Pro', 'In-Ear TWS',
      'Harman In-Ear: tối ưu upper-midrange, cân bằng dải âm tự nhiên sạch sẽ',
      [
        { type: 'lowshelf', frequency: 45, gain: 2.5, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: 1.0, q: 1.2 },
        { type: 'peaking', frequency: 350, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 800, gain: 0.8, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: -2.0, q: 2.0 },
        { type: 'peaking', frequency: 3000, gain: 1.5, q: 2.2 },
        { type: 'peaking', frequency: 4500, gain: 3.0, q: 2.5 },
        { type: 'peaking', frequency: 6200, gain: -1.5, q: 2.8 },
        { type: 'peaking', frequency: 7500, gain: -3.0, q: 3.0 },
        { type: 'highshelf', frequency: 11000, gain: 1.2, q: 0.71 }
      ]
    ),
    'apple-airpods-pro-2': create10BandProfile(
      'apple-airpods-pro-2', 'Apple AirPods Pro 2', 'Apple', 'AirPods Pro 2', 'In-Ear TWS',
      'Adaptive EQ chuẩn hóa: tăng độ chi tiết micro-treble, sub-bass sâu êm',
      [
        { type: 'lowshelf', frequency: 40, gain: 1.5, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: 0.8, q: 1.2 },
        { type: 'peaking', frequency: 320, gain: -0.6, q: 1.5 },
        { type: 'peaking', frequency: 850, gain: 0.6, q: 1.6 },
        { type: 'peaking', frequency: 1700, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 2900, gain: 1.2, q: 2.0 },
        { type: 'peaking', frequency: 4400, gain: 2.5, q: 2.4 },
        { type: 'peaking', frequency: 6200, gain: -1.8, q: 2.8 },
        { type: 'peaking', frequency: 8000, gain: -2.2, q: 3.0 },
        { type: 'highshelf', frequency: 11500, gain: 1.8, q: 0.71 }
      ]
    ),
    'apple-airpods-max': create10BandProfile(
      'apple-airpods-max', 'Apple AirPods Max', 'Apple', 'AirPods Max', 'Over-Ear ANC',
      'Âm học nhôm nguyên khối: gọt mid-bass thừa, mở rộng vocal và treble air',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.0, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 300, gain: 1.2, q: 1.4 },
        { type: 'peaking', frequency: 850, gain: -0.8, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.5, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4200, gain: 2.2, q: 2.2 },
        { type: 'peaking', frequency: 6000, gain: -2.0, q: 2.5 },
        { type: 'peaking', frequency: 8500, gain: 1.8, q: 2.5 },
        { type: 'highshelf', frequency: 11500, gain: 2.0, q: 0.71 }
      ]
    ),
    'apple-airpods-3': create10BandProfile(
      'apple-airpods-3', 'Apple AirPods 3', 'Apple', 'AirPods 3', 'Earbuds Semi-Open',
      'Semi-open fit compensation: bù bass tự nhiên, làm dịu dải cao 6kHz',
      [
        { type: 'lowshelf', frequency: 50, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 140, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 380, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 900, gain: 0.6, q: 1.5 },
        { type: 'peaking', frequency: 1800, gain: -1.2, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: 1.5, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: 2.2, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: -3.0, q: 3.0 },
        { type: 'peaking', frequency: 8500, gain: -1.8, q: 2.8 },
        { type: 'highshelf', frequency: 11000, gain: 1.0, q: 0.71 }
      ]
    ),

    // === HiFiMan ===
    'hifiman-sundara': create10BandProfile(
      'hifiman-sundara', 'HiFiMan Sundara', 'HiFiMan', 'Sundara', 'Planar Magnetic',
      'Planar Magnetic chuẩn mực: tăng lực sub-bass Planar, kiểm soát treble 9kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 90, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 220, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: 0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 2200, gain: 1.5, q: 2.5 },
        { type: 'peaking', frequency: 3800, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 6000, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 9200, gain: -3.0, q: 3.0 },
        { type: 'highshelf', frequency: 12000, gain: 1.0, q: 0.71 }
      ]
    ),
    'hifiman-ananda': create10BandProfile(
      'hifiman-ananda', 'HiFiMan Ananda', 'HiFiMan', 'Ananda', 'Planar Magnetic',
      'Màng loa NsD siêu mỏng: bù sub-bass ấm áp, cân bằng dải trung âm thanh thoát',
      [
        { type: 'lowshelf', frequency: 32, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 1.8, q: 1.2 },
        { type: 'peaking', frequency: 240, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 750, gain: 0.6, q: 1.6 },
        { type: 'peaking', frequency: 1400, gain: -0.8, q: 2.0 },
        { type: 'peaking', frequency: 2100, gain: 1.2, q: 2.2 },
        { type: 'peaking', frequency: 3600, gain: -1.5, q: 2.4 },
        { type: 'peaking', frequency: 5800, gain: 2.2, q: 2.5 },
        { type: 'peaking', frequency: 8800, gain: -2.8, q: 3.0 },
        { type: 'highshelf', frequency: 12500, gain: 1.2, q: 0.71 }
      ]
    ),
    'hifiman-edition-xs': create10BandProfile(
      'hifiman-edition-xs', 'HiFiMan Edition XS', 'HiFiMan', 'Edition XS', 'Planar Magnetic',
      'Stealth Magnets: bù sub-bass uy lực, làm mịn dải treble 6-9kHz lấp lánh',
      [
        { type: 'lowshelf', frequency: 32, gain: 4.2, q: 0.71 },
        { type: 'peaking', frequency: 90, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 230, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 780, gain: 0.5, q: 1.5 },
        { type: 'peaking', frequency: 1450, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 2200, gain: 1.5, q: 2.2 },
        { type: 'peaking', frequency: 3700, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 5800, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 9000, gain: -3.2, q: 3.0 },
        { type: 'highshelf', frequency: 12000, gain: 1.0, q: 0.71 }
      ]
    ),
    'hifiman-arya': create10BandProfile(
      'hifiman-arya', 'HiFiMan Arya (Stealth)', 'HiFiMan', 'Arya', 'Planar Magnetic Flagship',
      'Không gian âm nhạc mở rộng: bù sub-bass tuyến tính, tinh chỉnh dải cao mượt mà',
      [
        { type: 'lowshelf', frequency: 30, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 2.2, q: 1.1 },
        { type: 'peaking', frequency: 250, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 800, gain: 0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: -0.8, q: 2.0 },
        { type: 'peaking', frequency: 2300, gain: 1.2, q: 2.2 },
        { type: 'peaking', frequency: 3600, gain: -1.5, q: 2.4 },
        { type: 'peaking', frequency: 5600, gain: 2.5, q: 2.6 },
        { type: 'peaking', frequency: 8500, gain: -3.0, q: 3.0 },
        { type: 'highshelf', frequency: 12000, gain: 1.2, q: 0.71 }
      ]
    ),
    'hifiman-he400se': create10BandProfile(
      'hifiman-he400se', 'HiFiMan HE400se', 'HiFiMan', 'HE400se', 'Planar Magnetic Entry',
      'Planar giá mềm: nâng sub-bass, làm phẳng dải mid-treble 5-8kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.8, q: 0.71 },
        { type: 'peaking', frequency: 95, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 240, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: 0.5, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 2400, gain: 1.5, q: 2.2 },
        { type: 'peaking', frequency: 3800, gain: -1.5, q: 2.4 },
        { type: 'peaking', frequency: 5800, gain: 2.2, q: 2.5 },
        { type: 'peaking', frequency: 8800, gain: -3.5, q: 3.0 },
        { type: 'highshelf', frequency: 11500, gain: 1.2, q: 0.71 }
      ]
    ),
    'hifiman-susvara': create10BandProfile(
      'hifiman-susvara', 'HiFiMan Susvara', 'HiFiMan', 'Susvara', 'Planar Magnetic Ultra',
      'Siêu phẩm audiophile thế giới: hoàn thiện dải sub-bass vô song, độ phân giải vi mô',
      [
        { type: 'lowshelf', frequency: 30, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 80, gain: 2.0, q: 1.0 },
        { type: 'peaking', frequency: 220, gain: -0.8, q: 1.4 },
        { type: 'peaking', frequency: 750, gain: 0.4, q: 1.5 },
        { type: 'peaking', frequency: 1400, gain: -0.6, q: 2.0 },
        { type: 'peaking', frequency: 2200, gain: 1.0, q: 2.2 },
        { type: 'peaking', frequency: 3500, gain: -1.0, q: 2.4 },
        { type: 'peaking', frequency: 5500, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 8200, gain: -2.0, q: 3.0 },
        { type: 'highshelf', frequency: 12000, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Beyerdynamic ===
    'beyer-dt770': create10BandProfile(
      'beyer-dt770', 'Beyerdynamic DT 770 Pro 80Ω', 'Beyerdynamic', 'DT 770 Pro', 'Over-Ear Studio',
      'Harman Over-Ear: triệt tiêu đỉnh gắt 6kHz/8.5kHz (Beyer peak), nâng vocal',
      [
        { type: 'lowshelf', frequency: 50, gain: -1.5, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: -1.0, q: 1.2 },
        { type: 'peaking', frequency: 350, gain: 1.2, q: 1.4 },
        { type: 'peaking', frequency: 850, gain: -0.8, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.5, q: 1.8 },
        { type: 'peaking', frequency: 2200, gain: 2.5, q: 1.6 },
        { type: 'peaking', frequency: 4000, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 6000, gain: -5.0, q: 3.0 },
        { type: 'peaking', frequency: 8500, gain: -4.0, q: 3.5 },
        { type: 'highshelf', frequency: 11000, gain: -1.5, q: 0.71 }
      ]
    ),
    'beyer-dt990': create10BandProfile(
      'beyer-dt990', 'Beyerdynamic DT 990 Pro 250Ω', 'Beyerdynamic', 'DT 990 Pro', 'Over-Ear Open',
      'Triệt tiêu hoàn toàn đỉnh chói 6kHz và 8.5kHz, cân bằng dải trung vocal',
      [
        { type: 'lowshelf', frequency: 40, gain: 3.5, q: 0.71 },
        { type: 'peaking', frequency: 100, gain: 1.5, q: 1.2 },
        { type: 'peaking', frequency: 280, gain: -1.5, q: 1.3 },
        { type: 'peaking', frequency: 800, gain: -0.8, q: 1.5 },
        { type: 'peaking', frequency: 1800, gain: 1.8, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: 2.0, q: 2.5 },
        { type: 'peaking', frequency: 6200, gain: -5.5, q: 3.5 },
        { type: 'peaking', frequency: 8500, gain: -5.0, q: 3.5 },
        { type: 'highshelf', frequency: 12000, gain: -2.0, q: 0.71 }
      ]
    ),
    'beyer-dt880': create10BandProfile(
      'beyer-dt880', 'Beyerdynamic DT 880 Pro', 'Beyerdynamic', 'DT 880 Pro', 'Over-Ear Semi-Open',
      'Bán mở kiểm âm: bù dải sub-bass, làm mịn đỉnh treble 6kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 95, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 250, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 850, gain: -0.6, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 4200, gain: 1.8, q: 2.4 },
        { type: 'peaking', frequency: 6000, gain: -4.5, q: 3.2 },
        { type: 'peaking', frequency: 8500, gain: -3.0, q: 3.0 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),
    'beyer-dt1990': create10BandProfile(
      'beyer-dt1990', 'Beyerdynamic DT 1990 Pro', 'Beyerdynamic', 'DT 1990 Pro', 'Over-Ear Tesla Studio',
      'Tesla Driver 250Ω: thuần hóa đỉnh 8kHz chói gắt, nâng dải siêu trầm chắc khỏe',
      [
        { type: 'lowshelf', frequency: 35, gain: 3.8, q: 0.71 },
        { type: 'peaking', frequency: 90, gain: 1.8, q: 1.1 },
        { type: 'peaking', frequency: 260, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 800, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2600, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4000, gain: 1.5, q: 2.4 },
        { type: 'peaking', frequency: 5800, gain: -2.5, q: 2.8 },
        { type: 'peaking', frequency: 8200, gain: -5.5, q: 3.5 },
        { type: 'highshelf', frequency: 12000, gain: 1.2, q: 0.71 }
      ]
    ),
    'beyer-t1': create10BandProfile(
      'beyer-t1', 'Beyerdynamic T1 2nd Gen', 'Beyerdynamic', 'T1 2nd Gen', 'Over-Ear Flagship Tesla',
      'Tesla 600Ω: làm mượt đỉnh treble 6-9kHz, tái hiện âm trường analog tự nhiên',
      [
        { type: 'lowshelf', frequency: 32, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 240, gain: -1.5, q: 1.3 },
        { type: 'peaking', frequency: 850, gain: 0.6, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4200, gain: 1.5, q: 2.4 },
        { type: 'peaking', frequency: 6200, gain: -5.0, q: 3.5 },
        { type: 'peaking', frequency: 8800, gain: -4.0, q: 3.2 },
        { type: 'highshelf', frequency: 12500, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Audio-Technica ===
    'ath-m50x': create10BandProfile(
      'ath-m50x', 'Audio-Technica ATH-M50x', 'Audio-Technica', 'ATH-M50x', 'Over-Ear Closed',
      'Harman Over-Ear: giảm dải bass thừa, tăng vocal, làm mượt treble gắt',
      [
        { type: 'lowshelf', frequency: 40, gain: -1.5, q: 0.71 },
        { type: 'peaking', frequency: 180, gain: -3.5, q: 1.0 },
        { type: 'peaking', frequency: 400, gain: 1.5, q: 1.5 },
        { type: 'peaking', frequency: 800, gain: -0.8, q: 1.6 },
        { type: 'peaking', frequency: 1200, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 2200, gain: 1.8, q: 2.0 },
        { type: 'peaking', frequency: 3100, gain: 3.0, q: 2.0 },
        { type: 'peaking', frequency: 5500, gain: -1.5, q: 2.5 },
        { type: 'peaking', frequency: 9200, gain: -4.0, q: 3.0 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),
    'ath-m40x': create10BandProfile(
      'ath-m40x', 'Audio-Technica ATH-M40x', 'Audio-Technica', 'ATH-M40x', 'Over-Ear Closed',
      'Âm sắc cân bằng phòng thu: bổ sung sub-bass, làm mượt upper-midrange',
      [
        { type: 'lowshelf', frequency: 35, gain: 2.5, q: 0.71 },
        { type: 'peaking', frequency: 160, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 420, gain: 0.8, q: 1.5 },
        { type: 'peaking', frequency: 950, gain: -0.6, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: 2.2, q: 2.0 },
        { type: 'peaking', frequency: 4800, gain: -1.8, q: 2.4 },
        { type: 'peaking', frequency: 6800, gain: -2.5, q: 2.8 },
        { type: 'peaking', frequency: 9000, gain: -1.5, q: 2.5 },
        { type: 'highshelf', frequency: 11500, gain: 1.5, q: 0.71 }
      ]
    ),
    'ath-r70x': create10BandProfile(
      'ath-r70x', 'Audio-Technica ATH-R70x', 'Audio-Technica', 'ATH-R70x', 'Over-Ear Open Reference',
      'Kiểm âm 470Ω cực phẳng: tăng cường sub-bass, tái tạo âm sắc tự nhiên trung thực',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.8, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 2.2, q: 1.1 },
        { type: 'peaking', frequency: 240, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 0.8, q: 1.8 },
        { type: 'peaking', frequency: 2600, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 3800, gain: 1.5, q: 2.2 },
        { type: 'peaking', frequency: 5800, gain: 1.8, q: 2.5 },
        { type: 'peaking', frequency: 8500, gain: -2.0, q: 3.0 },
        { type: 'highshelf', frequency: 11000, gain: 1.5, q: 0.71 }
      ]
    ),
    'ath-ad900x': create10BandProfile(
      'ath-ad900x', 'Audio-Technica ATH-AD900X', 'Audio-Technica', 'ATH-AD900X', 'Over-Ear Open Air',
      'Air Dynamic mở rộng: bù lực dải trầm, tôn vinh giọng nữ ngọt ngào bay bổng',
      [
        { type: 'lowshelf', frequency: 40, gain: 5.5, q: 0.71 },
        { type: 'peaking', frequency: 100, gain: 2.5, q: 1.1 },
        { type: 'peaking', frequency: 260, gain: -1.5, q: 1.3 },
        { type: 'peaking', frequency: 850, gain: 0.5, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 4000, gain: 1.8, q: 2.4 },
        { type: 'peaking', frequency: 6000, gain: -3.5, q: 3.0 },
        { type: 'peaking', frequency: 8500, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Shure ===
    'shure-se215': create10BandProfile(
      'shure-se215', 'Shure SE215', 'Shure', 'SE215', 'In-Ear Stage Monitor',
      'Kiểm âm sân khấu kinh điển: gọt bớt bass ù, tăng độ rõ vocal và dải treble sáng',
      [
        { type: 'lowshelf', frequency: 45, gain: -2.5, q: 0.71 },
        { type: 'peaking', frequency: 160, gain: -3.0, q: 1.1 },
        { type: 'peaking', frequency: 450, gain: 1.2, q: 1.4 },
        { type: 'peaking', frequency: 1100, gain: -1.0, q: 1.6 },
        { type: 'peaking', frequency: 2000, gain: 2.5, q: 1.8 },
        { type: 'peaking', frequency: 3200, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 4800, gain: 3.0, q: 2.2 },
        { type: 'peaking', frequency: 7000, gain: -2.0, q: 2.8 },
        { type: 'peaking', frequency: 9000, gain: 3.5, q: 2.5 },
        { type: 'highshelf', frequency: 12000, gain: 2.5, q: 0.71 }
      ]
    ),
    'shure-se846': create10BandProfile(
      'shure-se846', 'Shure SE846', 'Shure', 'SE846', 'In-Ear Quad BA Flagship',
      'Quad Driver Subwoofer: cân bằng mid-bass, mở rộng dải treble air 10kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 2.0, q: 0.71 },
        { type: 'peaking', frequency: 140, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 420, gain: 0.8, q: 1.5 },
        { type: 'peaking', frequency: 1050, gain: -0.6, q: 1.6 },
        { type: 'peaking', frequency: 2100, gain: 1.8, q: 2.0 },
        { type: 'peaking', frequency: 3400, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 5200, gain: 2.5, q: 2.5 },
        { type: 'peaking', frequency: 7400, gain: -2.2, q: 3.0 },
        { type: 'peaking', frequency: 9600, gain: 3.0, q: 2.5 },
        { type: 'highshelf', frequency: 13000, gain: 2.0, q: 0.71 }
      ]
    ),
    'shure-srh1840': create10BandProfile(
      'shure-srh1840', 'Shure SRH1840', 'Shure', 'SRH1840', 'Over-Ear Open Mastering',
      'Mastering phòng thu cao cấp: bù lực sub-bass dải trầm, giữ vững độ chi tiết',
      [
        { type: 'lowshelf', frequency: 35, gain: 5.0, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 2.2, q: 1.1 },
        { type: 'peaking', frequency: 240, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2600, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 3800, gain: 1.5, q: 2.2 },
        { type: 'peaking', frequency: 5800, gain: -2.2, q: 2.8 },
        { type: 'peaking', frequency: 8500, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 11000, gain: 1.2, q: 0.71 }
      ]
    ),
    'shure-srh1540': create10BandProfile(
      'shure-srh1540', 'Shure SRH1540', 'Shure', 'SRH1540', 'Over-Ear Closed Audiophile',
      'Carbon Fiber Closed: giảm nhẹ lượng bass dư, tăng độ nổi khối âm hình stereo',
      [
        { type: 'lowshelf', frequency: 40, gain: -1.5, q: 0.71 },
        { type: 'peaking', frequency: 160, gain: -2.5, q: 1.1 },
        { type: 'peaking', frequency: 420, gain: 1.0, q: 1.4 },
        { type: 'peaking', frequency: 950, gain: -0.6, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: 2.0, q: 2.0 },
        { type: 'peaking', frequency: 4600, gain: -1.5, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: -2.2, q: 2.8 },
        { type: 'peaking', frequency: 8800, gain: 1.5, q: 2.4 },
        { type: 'highshelf', frequency: 11500, gain: 1.5, q: 0.71 }
      ]
    ),
    'shure-srh840': create10BandProfile(
      'shure-srh840', 'Shure SRH840', 'Shure', 'SRH840', 'Over-Ear Closed Studio',
      'Phòng thu chuẩn mực: tăng sub-bass, làm phẳng dải trung âm vocal chính xác',
      [
        { type: 'lowshelf', frequency: 35, gain: 3.0, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: 1.0, q: 1.2 },
        { type: 'peaking', frequency: 300, gain: -1.0, q: 1.4 },
        { type: 'peaking', frequency: 850, gain: 0.5, q: 1.5 },
        { type: 'peaking', frequency: 1700, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: -1.5, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: 2.2, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: -3.0, q: 3.0 },
        { type: 'peaking', frequency: 8800, gain: 1.8, q: 2.5 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Focal ===
    'focal-clear': create10BandProfile(
      'focal-clear', 'Focal Clear', 'Focal', 'Clear', 'Over-Ear Open Audiophile',
      'Màng loa Magnesium/Aluminum M-dome: bù dải sub-bass, tinh chỉnh treble tự nhiên',
      [
        { type: 'lowshelf', frequency: 35, gain: 4.0, q: 0.71 },
        { type: 'peaking', frequency: 95, gain: 1.5, q: 1.1 },
        { type: 'peaking', frequency: 260, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 850, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1450, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 2400, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 3800, gain: 1.5, q: 2.2 },
        { type: 'peaking', frequency: 5800, gain: -2.5, q: 2.8 },
        { type: 'peaking', frequency: 8500, gain: 1.8, q: 2.5 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),
    'focal-utopia': create10BandProfile(
      'focal-utopia', 'Focal Utopia', 'Focal', 'Utopia', 'Over-Ear Open Pure Beryllium',
      'Đỉnh cao âm thanh Pháp: màng Pure Beryllium mộc mạc, hoàn thiện dải sub-bass',
      [
        { type: 'lowshelf', frequency: 32, gain: 4.5, q: 0.71 },
        { type: 'peaking', frequency: 90, gain: 2.0, q: 1.0 },
        { type: 'peaking', frequency: 240, gain: -1.0, q: 1.2 },
        { type: 'peaking', frequency: 800, gain: -0.4, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2500, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4000, gain: 1.8, q: 2.2 },
        { type: 'peaking', frequency: 6000, gain: -3.0, q: 3.0 },
        { type: 'peaking', frequency: 8200, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 12000, gain: 1.2, q: 0.71 }
      ]
    ),
    'focal-elegia': create10BandProfile(
      'focal-elegia', 'Focal Elegia', 'Focal', 'Elegia', 'Over-Ear Closed Audiophile',
      'Closed-back dynamic: bù sub-bass bị hụt, làm phẳng mid-treble 1-4kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 5.0, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: 2.0, q: 1.1 },
        { type: 'peaking', frequency: 280, gain: -1.5, q: 1.3 },
        { type: 'peaking', frequency: 850, gain: 0.8, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: -1.5, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: 2.5, q: 2.0 },
        { type: 'peaking', frequency: 4500, gain: -2.0, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: 1.8, q: 2.5 },
        { type: 'peaking', frequency: 8500, gain: -2.5, q: 2.8 },
        { type: 'highshelf', frequency: 11500, gain: 1.2, q: 0.71 }
      ]
    ),
    'focal-celestee': create10BandProfile(
      'focal-celestee', 'Focal Celestee', 'Focal', 'Celestee', 'Over-Ear Closed Audiophile',
      'Vỏ đóng sang trọng: kiểm soát mid-bass, tăng chiều sâu và độ trong trẻo âm hình',
      [
        { type: 'lowshelf', frequency: 35, gain: 3.5, q: 0.71 },
        { type: 'peaking', frequency: 130, gain: -1.2, q: 1.2 },
        { type: 'peaking', frequency: 350, gain: 0.8, q: 1.4 },
        { type: 'peaking', frequency: 900, gain: -0.5, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.5, q: 1.8 },
        { type: 'peaking', frequency: 3000, gain: 2.2, q: 2.0 },
        { type: 'peaking', frequency: 4800, gain: -1.8, q: 2.4 },
        { type: 'peaking', frequency: 6800, gain: 1.5, q: 2.5 },
        { type: 'peaking', frequency: 9000, gain: -2.2, q: 2.8 },
        { type: 'highshelf', frequency: 12000, gain: 1.5, q: 0.71 }
      ]
    ),
    'focal-bathys': create10BandProfile(
      'focal-bathys', 'Focal Bathys', 'Focal', 'Bathys', 'Over-Ear Hi-Fi ANC',
      'Hi-Fi ANC đỉnh cao: tối ưu hóa dải trung âm hi-res và kiểm soát dải trầm',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.0, q: 0.71 },
        { type: 'peaking', frequency: 130, gain: -1.5, q: 1.2 },
        { type: 'peaking', frequency: 380, gain: 0.8, q: 1.4 },
        { type: 'peaking', frequency: 950, gain: -0.6, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.2, q: 1.8 },
        { type: 'peaking', frequency: 2900, gain: 1.8, q: 2.0 },
        { type: 'peaking', frequency: 4600, gain: -1.5, q: 2.2 },
        { type: 'peaking', frequency: 6500, gain: -2.0, q: 2.6 },
        { type: 'peaking', frequency: 8800, gain: 1.5, q: 2.4 },
        { type: 'highshelf', frequency: 11500, gain: 1.8, q: 0.71 }
      ]
    ),

    // === AKG ===
    'akg-k371': create10BandProfile(
      'akg-k371', 'AKG K371', 'AKG', 'K371', 'Over-Ear Closed Harman',
      'Gần như chuẩn Harman xuất xưởng: cân chỉnh vi mô độ phẳng dải cao và sub-bass',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.2, q: 0.71 },
        { type: 'peaking', frequency: 100, gain: -0.8, q: 1.2 },
        { type: 'peaking', frequency: 300, gain: 0.5, q: 1.4 },
        { type: 'peaking', frequency: 800, gain: -0.4, q: 1.5 },
        { type: 'peaking', frequency: 1600, gain: 0.8, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 4200, gain: 1.5, q: 2.4 },
        { type: 'peaking', frequency: 6200, gain: -2.0, q: 2.8 },
        { type: 'peaking', frequency: 8500, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 11000, gain: 1.0, q: 0.71 }
      ]
    ),
    'akg-k702': create10BandProfile(
      'akg-k702', 'AKG K702', 'AKG', 'K702', 'Over-Ear Open Reference',
      'Âm trường rộng lớn mênh mông: bù dải sub-bass sâu, làm mượt dải 2.5kHz',
      [
        { type: 'lowshelf', frequency: 35, gain: 5.5, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 2.5, q: 1.1 },
        { type: 'peaking', frequency: 240, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 850, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2400, gain: -2.5, q: 2.0 },
        { type: 'peaking', frequency: 3800, gain: 1.8, q: 2.2 },
        { type: 'peaking', frequency: 5800, gain: -2.0, q: 2.8 },
        { type: 'peaking', frequency: 8200, gain: 1.5, q: 2.5 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Audeze ===
    'audeze-lcd-x': create10BandProfile(
      'audeze-lcd-x', 'Audeze LCD-X (2021)', 'Audeze', 'LCD-X', 'Planar Magnetic Studio',
      'Đỉnh cao mixing phòng thu: nâng độ mở vocal 3-4kHz, tận dụng bass Planar',
      [
        { type: 'lowshelf', frequency: 32, gain: 3.5, q: 0.71 },
        { type: 'peaking', frequency: 85, gain: 1.5, q: 1.1 },
        { type: 'peaking', frequency: 250, gain: -1.0, q: 1.3 },
        { type: 'peaking', frequency: 750, gain: 0.6, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: -1.0, q: 2.0 },
        { type: 'peaking', frequency: 2800, gain: 2.5, q: 1.8 },
        { type: 'peaking', frequency: 4000, gain: 3.8, q: 2.0 },
        { type: 'peaking', frequency: 6000, gain: -2.0, q: 2.5 },
        { type: 'peaking', frequency: 8500, gain: -2.5, q: 2.8 },
        { type: 'highshelf', frequency: 12000, gain: 1.5, q: 0.71 }
      ]
    ),
    'audeze-maxwell': create10BandProfile(
      'audeze-maxwell', 'Audeze Maxwell', 'Audeze', 'Maxwell', 'Planar Wireless Audiophile',
      'Tai nghe không dây Planar 90mm: cân chỉnh âm sắc tự nhiên phòng thu chuẩn mực',
      [
        { type: 'lowshelf', frequency: 35, gain: 1.2, q: 0.71 },
        { type: 'peaking', frequency: 110, gain: -0.8, q: 1.2 },
        { type: 'peaking', frequency: 320, gain: 0.5, q: 1.4 },
        { type: 'peaking', frequency: 850, gain: -0.5, q: 1.6 },
        { type: 'peaking', frequency: 1700, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: 1.5, q: 2.0 },
        { type: 'peaking', frequency: 4400, gain: -1.2, q: 2.2 },
        { type: 'peaking', frequency: 6500, gain: -1.8, q: 2.6 },
        { type: 'peaking', frequency: 8800, gain: 1.5, q: 2.4 },
        { type: 'highshelf', frequency: 11500, gain: 1.2, q: 0.71 }
      ]
    ),

    // === Meze ===
    'meze-109-pro': create10BandProfile(
      'meze-109-pro', 'Meze 109 Pro', 'Meze Audio', '109 Pro', 'Over-Ear Open Dynamic',
      'Màng Beryllium phủ Carbon: kiểm soát dải treble 6-8kHz, gia cố sub-bass sâu',
      [
        { type: 'lowshelf', frequency: 35, gain: 3.5, q: 0.71 },
        { type: 'peaking', frequency: 90, gain: 1.5, q: 1.1 },
        { type: 'peaking', frequency: 240, gain: -1.2, q: 1.3 },
        { type: 'peaking', frequency: 800, gain: -0.5, q: 1.5 },
        { type: 'peaking', frequency: 1500, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2800, gain: -1.2, q: 2.0 },
        { type: 'peaking', frequency: 4200, gain: 1.8, q: 2.2 },
        { type: 'peaking', frequency: 6200, gain: -4.5, q: 3.2 },
        { type: 'peaking', frequency: 8500, gain: -3.0, q: 3.0 },
        { type: 'highshelf', frequency: 11500, gain: 1.0, q: 0.71 }
      ]
    ),

    // === Etymotic ===
    'etymotic-er4xr': create10BandProfile(
      'etymotic-er4xr', 'Etymotic ER4XR', 'Etymotic', 'ER4XR', 'In-Ear Deep Insertion',
      'Kiểm âm cách âm tuyệt đối: làm mượt đỉnh resonance dải cao, giữ vững độ chi tiết',
      [
        { type: 'lowshelf', frequency: 35, gain: 2.5, q: 0.71 },
        { type: 'peaking', frequency: 120, gain: 0.8, q: 1.2 },
        { type: 'peaking', frequency: 350, gain: -0.6, q: 1.5 },
        { type: 'peaking', frequency: 850, gain: -0.4, q: 1.6 },
        { type: 'peaking', frequency: 1800, gain: 1.0, q: 1.8 },
        { type: 'peaking', frequency: 2700, gain: -1.8, q: 2.2 },
        { type: 'peaking', frequency: 4500, gain: 2.2, q: 2.4 },
        { type: 'peaking', frequency: 6500, gain: -2.5, q: 2.8 },
        { type: 'peaking', frequency: 9000, gain: 2.0, q: 2.5 },
        { type: 'highshelf', frequency: 12000, gain: 1.5, q: 0.71 }
      ]
    )
  };

  /**
   * Return array of all AutoEQ headphone profiles.
   */
  function getAutoEqProfiles() {
    return Object.keys(AUTOEQ_DATABASE).map(key => AUTOEQ_DATABASE[key]);
  }

  /**
   * Search headphone profiles by text query (brand, model, name, category).
   */
  function searchAutoEqProfiles(query) {
    const list = getAutoEqProfiles();
    if (!query || typeof query !== 'string' || !query.trim()) {
      return list;
    }
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return list.filter(p => {
      const haystack = `${p.name} ${p.brand} ${p.model} ${p.category} ${p.description} ${p.id}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }

  /**
   * Get single AutoEQ profile by ID.
   */
  function getAutoEqProfile(profileId) {
    if (!profileId || typeof profileId !== 'string') return null;
    if (AUTOEQ_DATABASE[profileId]) {
      return JSON.parse(JSON.stringify(AUTOEQ_DATABASE[profileId]));
    }
    return null;
  }

  /**
   * Apply an AutoEQ profile to the player's audio DSP state.
   * Assigns 10-band PEQ parameters to state.bands while preserving audio invariants.
   */
  function applyAutoEqProfile(profileId, state) {
    const targetState = state || (typeof window !== 'undefined' && window.state ? window.state : null);
    if (!targetState) {
      return { success: false, error: 'State object not provided' };
    }

    if (!profileId || profileId === 'none') {
      targetState.autoEqProfile = 'none';
      targetState.bands = [];
      targetState.preamp = 0;
      if (typeof targetState.applyEq === 'function') targetState.applyEq();
      return { success: true, profile: null };
    }

    const profile = getAutoEqProfile(profileId);
    if (!profile) {
      return { success: false, error: `AutoEQ profile '${profileId}' not found.` };
    }

    targetState.autoEqProfile = profile.id;
    targetState.preamp = profile.preamp;

    // Assign 10 PEQ bands with sequential serial IDs
    targetState.bands = profile.bands.map((b, i) => ({
      id: (typeof targetState.bandSerial === 'number') ? ++targetState.bandSerial : (i + 1),
      type: b.type,
      frequency: b.frequency,
      gain: b.gain,
      q: b.q
    }));

    if (typeof targetState.applyEq === 'function') {
      targetState.applyEq();
    }

    return { success: true, profile };
  }

  // --- CUE Sheet Virtual Track Parser ---

  /**
   * Parse CUE Sheet text into structured virtual tracks for seamless seeking and playback.
   * Supports standard CUE syntax: PERFORMER, TITLE, FILE, TRACK [num] AUDIO, INDEX 01 mm:ss:ff.
   * Calculates startTime, endTime, duration, trackNumber, title, artist, cueOffset, isVirtualCue: true.
   *
   * @param {string} cueText - Raw text content of the .cue sheet
   * @param {File|Blob|Object|number|null} audioFile - Parent audio file or total duration
   * @returns {Array} Virtual track list with metadata properties
   */
  function parseCueSheet(cueText, audioFile) {
    const tracks = [];
    let globalTitle = '';
    let globalPerformer = '';
    let globalSongwriter = '';
    let globalFile = '';
    let globalGenre = '';
    let globalDate = '';

    let totalDuration = null;
    let audioFileName = '';
    let audioSrc = '';

    if (typeof audioFile === 'number' && Number.isFinite(audioFile)) {
      totalDuration = audioFile;
    } else if (audioFile && typeof audioFile === 'object') {
      if (Number.isFinite(audioFile.duration)) totalDuration = audioFile.duration;
      audioFileName = audioFile.name || audioFile.fileName || audioFile.title || '';
      audioSrc = audioFile.url || audioFile.src || '';
    } else if (typeof audioFile === 'string') {
      audioFileName = audioFile;
      audioSrc = audioFile;
    }

    const result = Object.assign(tracks, {
      title: '',
      album: '',
      performer: '',
      artist: '',
      songwriter: '',
      file: audioFileName || '',
      genre: '',
      date: '',
      isCueSheet: true
    });

    if (typeof cueText !== 'string' || !cueText.trim()) {
      return result;
    }

    const lines = cueText.split(/\r?\n/);
    let currentTrack = null;
    let currentFile = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // REM comments (e.g. REM GENRE "Rock", REM DATE 1973)
      const remMatch = line.match(/^REM\s+(\S+)\s*(.*)$/i);
      if (remMatch) {
        const remKey = remMatch[1].toUpperCase();
        const remVal = remMatch[2].replace(/^["']|["']$/g, '').trim();
        if (remKey === 'GENRE') {
          if (!currentTrack) globalGenre = remVal;
          else currentTrack.genre = remVal;
        } else if (remKey === 'DATE' || remKey === 'YEAR') {
          if (!currentTrack) globalDate = remVal;
          else currentTrack.year = remVal;
        }
        continue;
      }

      // FILE "filename" TYPE
      const fileMatch = line.match(/^FILE\s+(?:"([^"]+)"|'([^']*)'|(\S+))\s*(.*)$/i);
      if (fileMatch) {
        const fileName = (fileMatch[1] || fileMatch[2] || fileMatch[3] || '').trim();
        currentFile = fileName;
        if (!currentTrack && !globalFile) {
          globalFile = fileName;
        }
        continue;
      }

      // TRACK nn AUDIO
      const trackMatch = line.match(/^TRACK\s+(\d+)(?:\s+(\S+))?/i);
      if (trackMatch) {
        const trackNum = parseInt(trackMatch[1], 10);
        currentTrack = {
          number: trackNum,
          trackNumber: trackNum,
          track: trackNum,
          title: '',
          performer: '',
          artist: '',
          album: '',
          file: currentFile || globalFile || audioFileName || '',
          src: audioSrc || '',
          offset: 0,
          cueOffset: 0,
          startTime: 0,
          endTime: null,
          duration: 0,
          isVirtualCue: true,
          indexes: {},
          audioFile: audioFile || null
        };
        tracks.push(currentTrack);
        continue;
      }

      // Header vs Track properties
      if (!currentTrack) {
        const titleMatch = line.match(/^TITLE\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (titleMatch) {
          globalTitle = (titleMatch[1] || titleMatch[2] || titleMatch[3] || '').trim();
          continue;
        }
        const performerMatch = line.match(/^PERFORMER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (performerMatch) {
          globalPerformer = (performerMatch[1] || performerMatch[2] || performerMatch[3] || '').trim();
          continue;
        }
        const songwriterMatch = line.match(/^SONGWRITER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (songwriterMatch) {
          globalSongwriter = (songwriterMatch[1] || songwriterMatch[2] || songwriterMatch[3] || '').trim();
          continue;
        }
      } else {
        const titleMatch = line.match(/^TITLE\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (titleMatch) {
          currentTrack.title = (titleMatch[1] || titleMatch[2] || titleMatch[3] || '').trim();
          continue;
        }
        const performerMatch = line.match(/^PERFORMER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (performerMatch) {
          currentTrack.performer = (performerMatch[1] || performerMatch[2] || performerMatch[3] || '').trim();
          continue;
        }
        const songwriterMatch = line.match(/^SONGWRITER\s+(?:"([^"]+)"|'([^']*)'|(.*))$/i);
        if (songwriterMatch) {
          currentTrack.songwriter = (songwriterMatch[1] || songwriterMatch[2] || songwriterMatch[3] || '').trim();
          continue;
        }

        // INDEX nn mm:ss:ff (frames = 1/75 second)
        const indexMatch = line.match(/^INDEX\s+(\d+)\s+(\d{1,3}):(\d{2}):(\d{2})/i);
        if (indexMatch) {
          const idxNum = indexMatch[1];
          const mm = parseInt(indexMatch[2], 10);
          const ss = parseInt(indexMatch[3], 10);
          const ff = parseInt(indexMatch[4], 10);
          const offsetSeconds = mm * 60 + ss + ff / 75;
          currentTrack.indexes[idxNum] = offsetSeconds;

          if (idxNum === '01' || idxNum === '1') {
            currentTrack.offset = offsetSeconds;
            currentTrack.cueOffset = offsetSeconds;
            currentTrack.startTime = offsetSeconds;
          } else if (idxNum === '00' || idxNum === '0') {
            currentTrack.pregap = offsetSeconds;
          }
          continue;
        }
      }
    }

    // Post-process virtual tracks: calculate endTime, duration, and fallback metadata
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track.title) {
        track.title = `Track ${track.trackNumber}`;
      }
      if (!track.performer) {
        track.performer = globalPerformer || globalSongwriter || 'Unknown Artist';
      }
      track.artist = track.performer;
      track.album = globalTitle || 'Unknown Album';
      if (!track.file) {
        track.file = currentFile || globalFile || audioFileName || '';
      }
      if (globalGenre && !track.genre) {
        track.genre = globalGenre;
      }
      if (globalDate && !track.year) {
        track.year = globalDate;
      }

      // Calculate endTime and duration
      if (i < tracks.length - 1) {
        const nextTrack = tracks[i + 1];
        track.endTime = nextTrack.startTime;
        const diff = nextTrack.startTime - track.startTime;
        track.duration = diff > 0 ? diff : 0;
      } else if (totalDuration != null && Number.isFinite(Number(totalDuration))) {
        track.endTime = Number(totalDuration);
        track.duration = Math.max(0, Number(totalDuration) - track.startTime);
      } else {
        track.endTime = null;
        track.duration = 0;
      }
    }

    result.title = globalTitle;
    result.album = globalTitle;
    result.performer = globalPerformer;
    result.artist = globalPerformer || globalSongwriter || 'Unknown Artist';
    result.file = globalFile || audioFileName || '';
    result.genre = globalGenre;
    result.date = globalDate;

    return result;
  }

  // --- Seamless Virtual Seek & Playback Integration ---

  /**
   * Seek audio element within virtual track bounds.
   * @param {HTMLMediaElement} audioElement
   * @param {Object} virtualTrack
   * @param {number} relativeSeconds
   */
  function seekVirtualTrack(audioElement, virtualTrack, relativeSeconds) {
    if (!audioElement || !virtualTrack) return 0;
    const maxDuration = virtualTrack.duration > 0 ? virtualTrack.duration : Infinity;
    const clampedRel = Math.max(0, Math.min(relativeSeconds, maxDuration));
    const targetAbsolute = (virtualTrack.startTime || 0) + clampedRel;
    try {
      audioElement.currentTime = targetAbsolute;
    } catch (_) {}
    return targetAbsolute;
  }

  /**
   * Get relative playback progress of a virtual track.
   * @param {HTMLMediaElement} audioElement
   * @param {Object} virtualTrack
   * @returns {{current: number, duration: number, fraction: number, isEnded: boolean}}
   */
  function getVirtualPlaybackProgress(audioElement, virtualTrack) {
    if (!audioElement || !virtualTrack) {
      return { current: 0, duration: 0, fraction: 0, isEnded: false };
    }
    const currentAbs = audioElement.currentTime || 0;
    const start = virtualTrack.startTime || 0;
    const currentRel = Math.max(0, currentAbs - start);
    const duration = virtualTrack.duration || (virtualTrack.endTime ? virtualTrack.endTime - start : 0);
    const fraction = duration > 0 ? Math.min(1, currentRel / duration) : 0;
    const isEnded = virtualTrack.endTime != null && currentAbs >= (virtualTrack.endTime - 0.05);

    return {
      current: currentRel,
      duration,
      fraction,
      isEnded
    };
  }

  /**
   * Check if playback reached the end of the virtual track and needs advancing.
   */
  function shouldAdvanceVirtualTrack(audioElement, virtualTrack) {
    if (!audioElement || !virtualTrack || virtualTrack.endTime == null) return false;
    return (audioElement.currentTime || 0) >= (virtualTrack.endTime - 0.05);
  }

  // --- UI Integration: Equalizer Modal & Dropdown ---

  /**
   * Populate AutoEQ select dropdown in #eq-panel and initialize modal listeners.
   */
  function initAutoEqCueUI() {
    if (typeof document === 'undefined') return;

    const select = document.getElementById('autoeq-select');
    if (select) {
      // Check if top 50+ profiles are already in options; if not, group and populate
      const existingOptions = select.querySelectorAll('option');
      const hasFullCatalog = Array.from(existingOptions).some(o => o.value === 'moondrop-aria');

      if (!hasFullCatalog) {
        // Build optgroups for 50+ models
        const profiles = getAutoEqProfiles();
        const brands = {};
        profiles.forEach(p => {
          if (!brands[p.brand]) brands[p.brand] = [];
          brands[p.brand].push(p);
        });

        // Retain Bypass and Target Curves, append complete Brand groups
        const brandOrder = [
          'Sennheiser', 'Sony', 'Moondrop', 'FiiO', 'Apple',
          'HiFiMan', 'Beyerdynamic', 'Audio-Technica', 'Shure',
          'Focal', 'AKG', 'Audeze', 'Meze Audio', 'Etymotic'
        ];

        brandOrder.forEach(brand => {
          const items = brands[brand];
          if (!items || items.length === 0) return;
          const optgroup = document.createElement('optgroup');
          optgroup.label = `── ${brand} (${items.length} models) ──`;
          items.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.category})`;
            optgroup.appendChild(opt);
          });
          select.appendChild(optgroup);
        });
      }
    }

    // Modal Search and Filter integration
    const modal = document.getElementById('autoeq-modal');
    const modalBtn = document.getElementById('autoeq-modal-btn');
    const modalClose = document.getElementById('autoeq-modal-close');
    const modalSearch = document.getElementById('autoeq-modal-search');
    const modalList = document.getElementById('autoeq-modal-list');

    function renderModalList(profiles) {
      if (!modalList) return;
      modalList.innerHTML = '';
      if (profiles.length === 0) {
        modalList.innerHTML = '<div class="py-8 text-center text-xs text-zinc-500">Không tìm thấy tai nghe phù hợp</div>';
        return;
      }
      profiles.forEach(p => {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-800/80 border border-white/5 transition';
        item.innerHTML = `
          <div class="flex flex-col">
            <span class="text-xs font-semibold text-zinc-200">${p.name}</span>
            <span class="text-[10px] text-zinc-400">${p.category} · 10 PEQ Bands · Preamp ${p.preamp} dB</span>
            <span class="text-[9px] text-zinc-500 mt-0.5 line-clamp-1">${p.description}</span>
          </div>
          <button type="button" class="px-2.5 py-1 text-[11px] font-medium bg-violet-600 hover:bg-violet-500 text-white rounded transition active:scale-95 shrink-0 ml-3" data-profile-id="${p.id}">
            Áp dụng
          </button>
        `;
        const applyBtn = item.querySelector('button');
        if (applyBtn) {
          applyBtn.addEventListener('click', () => {
            if (typeof window !== 'undefined' && typeof window.applyAutoEqProfile === 'function') {
              window.applyAutoEqProfile(p.id, window.state);
            }
            if (select) select.value = p.id;
            if (modal) modal.classList.add('hidden');
          });
        }
        modalList.appendChild(item);
      });
    }

    if (modalBtn && modal) {
      modalBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        renderModalList(getAutoEqProfiles());
        if (modalSearch) {
          modalSearch.value = '';
          modalSearch.focus();
        }
      });
    }

    if (modalClose && modal) {
      modalClose.addEventListener('click', () => modal.classList.add('hidden'));
    }

    if (modalSearch) {
      modalSearch.addEventListener('input', e => {
        const q = e.target.value;
        const matches = searchAutoEqProfiles(q);
        renderModalList(matches);
      });
    }
  }

  // Auto-register with library-utils if loaded
  if (typeof window !== 'undefined' && window.NocturneLibrary && window.NocturneLibrary.AUTOEQ_PROFILES) {
    Object.assign(window.NocturneLibrary.AUTOEQ_PROFILES, AUTOEQ_DATABASE);
  }

  return {
    AUTOEQ_DATABASE,
    getAutoEqProfiles,
    searchAutoEqProfiles,
    getAutoEqProfile,
    applyAutoEqProfile,
    parseCueSheet,
    seekVirtualTrack,
    getVirtualPlaybackProgress,
    shouldAdvanceVirtualTrack,
    initAutoEqCueUI
  };
});
