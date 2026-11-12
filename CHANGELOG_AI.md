# 📜 Nhật Ký Nâng Cấp Tự Động (Continuous Evolution Log) — NOCTURNE

---

## [Chu Kỳ 2026-11-12 01:05 +07] — [Pha B] Signal Path Kiểu Roon Trong Phòng Nghe (Nguồn → Giải Mã → DSP → Đầu Ra)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. UI/UX & Visualizer Hiện Đại** kết hợp **1. Audio Engine & DSP (Web Audio API)**.
- **Tính năng triển khai:**
  1. **Hàm lõi tính toán chuỗi tín hiệu `computeSignalPath(track, options)`:** Phân tích toàn diện 4 công đoạn (Stages) của chuỗi tín hiệu âm thanh thực tế:
     - **Nguồn phát (Source):** Định dạng (FLAC, DSD, WAV, MP3...), tần số lấy mẫu (kHz/MHz), độ sâu bit (1-bit / 16-bit / 24-bit), số kênh (Stereo / Mono), nguồn lưu trữ (Local, Google Drive, OneDrive, WebDAV).
     - **Giải mã (Decoder):** Nhận diện giải mã Lossless / nén, giải mã Web Audio API native hoặc giải mã phần mềm thời gian thực bằng Web Worker đa luồng (FIR decimation DSD → PCM 44.1–192 kHz).
     - **DSP (Digital Signal Processing):** Tự động phát hiện trạng thái xử lý tín hiệu:
       - *Bit-perfect*: Khi EQ tắt (Direct/Bypass), cân bằng L/R ở giữa và Crossfeed tắt.
       - *Enhanced*: Khi bật Parametric EQ (hiển thị rõ tên preset + mức preamp trim), thay đổi cân bằng L/R, hoặc kích hoạt Crossfeed mô phỏng không gian tai nghe.
     - **Đầu ra (Output):** AudioContext Destination theo tần số phần cứng hệ thống (DAC / Loa ngoài / Tai nghe).
     - **Đánh giá tầng chất lượng (Quality Tier):** `DSD`, `HI-RES` (khi >48kHz hoặc >16-bit), `LOSSLESS`, hoặc `STANDARD`, kèm hậu tố `· ENHANCED` khi chuỗi có can thiệp DSP.
  2. **Giao diện chuỗi tín hiệu kiểu Roon trong Phòng nghe (`#listening-room`):**
     - Huy hiệu tầng chất lượng động (`#signal-path-badge`) đổi màu theo phong cách Audiophile: Xanh ngọc (Bit-perfect Lossless), Cyan (Hi-Res), Vàng cam (DSD), Tím neon (DSP Enhanced).
     - Nút mở rộng/thu gọn trực quan (`#toggle-signal-path`) chuyển đổi `Chi tiết ▾` / `Thu gọn ▴`.
     - Container chuỗi tín hiệu phân tầng (`#room-signal-chain`) hiển thị tiến trình 4 bước với đường timeline liên kết, biểu tượng trực quan, tiêu đề và chi tiết kỹ thuật từng bước.
  3. **Tự động đồng bộ thời gian thực:**
     - Tự động làm mới khi đổi bài hát, chuyển trạng thái cache lát đầu DSD/FLAC.
     - Tự động cập nhật ngay lập tức khi người dùng bật/tắt EQ, đổi preset EQ, chỉnh thanh trượt Cân bằng L/R hoặc Crossfeed mà không cần đóng mở lại Phòng nghe.
  4. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Đã thêm kiểm thử đơn vị cho `computeSignalPath` trong `library-utils.test.cjs`.
     - Đã tạo mới file test `signal-path.test.cjs` xác nhận logic thuần, phân loại tầng chất lượng, trạng thái bypass vs enhanced, và tính toàn vẹn của DOM / Event listeners.

### 📝 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung hàm `computeSignalPath(track, options)` và xuất trong `NocturneLibrary`.
- `library-utils.test.cjs`: Thêm test assertions cho `computeSignalPath`.
- `index.html`: Cập nhật UI trong `#listening-room` (`#signal-path-badge`, `#toggle-signal-path`, `#room-signal-chain`), thêm hàm `renderSignalPathChain`, gắn hook vào `renderRoomSignal`, `applyEq`, `setStereoBalance`, `setCrossfeed`, `openListeningRoom`, và thêm log bình luận cuối trang.
- `signal-path.test.cjs`: File test suite mới kiểm tra toàn diện tính năng Signal Path Roon-style.
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ.

### 🧪 Kết Quả Kiểm Chứng (Self-Test):
- Cú pháp mã nguồn chuẩn, không có lỗi console hay thiếu literal ID.
- `node signal-path.test.cjs`: PASS (2/2 test suites).
- `node index-script.test.cjs`: PASS (toàn bộ kiểm tra hồi quy).
- `node library-utils.test.cjs`: PASS.
- Đầy đủ các test suites đều chạy thành công trên môi trường Node.js.

### 🚀 Đề Xuất Cho Chu Kỳ Tiếp Theo:
- **Phân khu 3 (Tính Năng & Trải Nghiệm Người Dùng):** **Roon Radio** — Tự động đề xuất và phát tiếp các bài hát tương tự từ thư viện khi hết danh sách phát hoặc hàng đợi (dựa trên nghệ sĩ, thể loại, hoặc tính ngẫu nhiên thông minh).
- **Hoặc Phân khu 2 (UI/UX & Visualizer):** **Ambient Glow** — Trích xuất màu chủ đạo từ ảnh bìa album để làm ánh sáng nền chuyển màu huyền ảo cho toàn bộ ứng dụng.

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
