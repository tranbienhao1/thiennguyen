# 📜 Nhật Ký Nâng Cấp Tự Động (Continuous Evolution Log) — NOCTURNE

---

## [Chu Kỳ 2026-11-11 22:30 +07] — Cân Bằng Âm Thanh L/R (Stereo Balance) & Mở Rộng Phím Tắt

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API)** kết hợp **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Tính năng triển khai:**
  1. **Stereo Balance DSP Node:** Tích hợp `StereoPannerNode` mượt mà vào chuỗi Web Audio Graph (`state.panner`), nằm giữa bộ phân tích tín hiệu (`analyser` / `directAnalyser`) và `context.destination`. Tự động áp dụng `setTargetAtTime(balance, currentTime, 0.015)` chống lụp bụp / clipping khi xoay cân bằng. Có fallback an toàn khi trình duyệt không hỗ trợ `createStereoPanner`.
  2. **Giao diện điều khiển Audiophile:** Bổ sung thanh trượt `Cân bằng L / R` (`#balance-slider`, `-100` đến `+100`), nhãn trạng thái trực quan (`#balance-label`: `Giữa`, `Trái X%`, `Phải X%`), và nút đặt lại nhanh (`#balance-reset`) trong panel Parametric Equalizer (`#eq-panel`).
  3. **Lưu trữ trạng thái bền vững:** Ghi nhớ giá trị cân bằng stereo vào `localStorage['nocturne-stereo-balance']` và tự động khôi phục khi mở lại app.
  4. **Cập nhật dòng tín hiệu Phòng nghe:** Hiển thị thông số cân bằng stereo trong `#room-output` (ví dụ `· Cân bằng: Trái 30%`) khi người dùng chỉnh khác mức giữa.
  5. **Mở rộng phím tắt bàn phím toàn diện:**
     - `M`: Bật/tắt tiếng (Mute toggle) kèm ghi nhớ âm lượng trước đó và hiển thị toast thông báo.
     - `↑` / `↓`: Tăng / giảm âm lượng 5% nhanh chóng.
     - `J` / `L`: Tua lùi 10s / tua tới 10s (chuẩn YouTube / media player chuyên nghiệp), kết hợp với `←` / `→` và `[` / `]`.
     - `K`: Phát / tạm dừng (kết hợp với `Space`).
  6. **Tiện ích Module & Bộ Test Tự Động:**
     - Xuất `clampBalance(value, fallback)` và `formatBalance(value)` trong `library-utils.js`.
     - Viết bộ test `balance.test.cjs` kiểm thử toàn diện: tính toán giá trị biên, định dạng, Web Audio Graph connection, fallback, persistence, và event listeners.

### 📝 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Thêm `clampBalance`, `formatBalance` và export vào `NocturneLibrary`.
- `library-utils.test.cjs`: Thêm assertions cho `clampBalance` và `formatBalance`.
- `index.html`: Thêm `stereoBalance` và `panner` vào `state`, tích hợp `StereoPannerNode` trong `setupAudio()`, thêm hàm `setStereoBalance()`, `toggleMute()`, mở rộng phím tắt `M`, `↑`, `↓`, `J`, `K`, `L`, thêm slider cân bằng L/R trong `#eq-panel`, và cập nhật log.
- `balance.test.cjs`: Test suite mới cho tính năng cân bằng L/R và phím tắt âm lượng.
- `versions.test.cjs`: Thêm mock fallback khi file flac bên ngoài môi trường máy tính của Melissa không có sẵn.
- `.gitattributes`: Chuẩn hóa line endings `eol=lf` cho môi trường Windows/Linux.
- `CHANGELOG_AI.md`: Khởi tạo và ghi nhận nhật ký chu kỳ tiến hóa.

### 🧪 Kết Quả Kiểm Chứng (Self-Test):
- Cú pháp và cấu trúc mã nguồn hoàn toàn hợp lệ, không có lỗi console, không làm hỏng tính năng cũ.
- Đầy đủ 38/38 file test trong bộ test `node --test` vượt qua (PASS 100%).
- `AudioContext` tiếp tục tự động resume khi có tương tác người dùng, không bị chặn bởi chính sách Autoplay.

### 🚀 Đề Xuất Cho Chu Kỳ Tiếp Theo:
- **Phân khu 2 (UI/UX & Visualizer):** Trích xuất màu chủ đạo (Dominant Color) từ ảnh bìa album đang phát để tạo hiệu ứng Ambient Glow chuyển màu mềm mại cho toàn bộ trang và nền phòng nghe.
- **Hoặc Phân khu 1 (Audio Engine):** ReplayGain / Loudness Normalization tự động cân bằng mức âm lượng giữa các bài hát khác nhau để tránh chênh lệch âm lượng đột ngột.
