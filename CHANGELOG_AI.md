# 📜 Nhật Ký Nâng Cấp Tự Động (Continuous Evolution Log) — NOCTURNE

---

## [Chu Kỳ 2026-11-13 03:34 +07] — [Pha B] Album View Kiểu Roon: Trang Chi Tiết Album Với Hero Header & Thao Tác Nhanh

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. UI/UX & Visualizer Hiện Đại**.
- **Tính năng triển khai:**
  1. **Thuật toán tổng hợp thông tin album `summarizeAlbum(tracks)` & `formatAlbumDuration` (`library-utils.js`):**
     - Tổng hợp tổng thời lượng của toàn bộ các bài hát trong album và định dạng thân thiện (`X giờ Y phút` hoặc `X phút Y giây`).
     - Tự động phát hiện và gán huy hiệu chất lượng cao nhất của bản phát hành: `DSD` (nếu có bài DSD) > `HI-RES` (nếu có bài >48kHz hoặc >16-bit) > `LOSSLESS` (FLAC/WAV/AIFF 16/44.1) > `STANDARD`.
     - Tập hợp các định dạng âm thanh xuất hiện trong album và năm phát hành.
  2. **Giao diện Hero Header chi tiết album kiểu Roon (`#album-hero` trong `index.html`):**
     - Khung hiển thị ảnh bìa nổi bật với bóng đổ sâu (`shadow-xl shadow-black/40`).
     - Huy hiệu chất lượng phát hành (`#album-hero-quality`) đổi màu động theo tầng chất lượng: vàng hổ phách (DSD), cyan (Hi-Res), trắng ngà (Lossless).
     - Tiêu đề album lớn, tên nghệ sĩ, thông tin số bài hát và tổng thời lượng phát.
     - **Nút hành động nhanh:**
       - `▶ Phát album` (`#album-hero-play`): Bắt đầu phát bài đầu tiên và tự động đưa toàn bộ các bài còn lại của album vào danh sách phát tiếp theo.
       - `＋ Hàng đợi` (`#album-hero-queue`): Thêm toàn bộ các bài trong album vào hàng đợi (`queueTrackIds`) một cách thông minh, không trùng bài đang phát.
       - `‹ Quay lại` (`#album-hero-back`): Đóng chi tiết album, khôi phục lại lưới hiển thị album đầy đủ.
  3. **Tự động chuyển đổi ngữ cảnh và điều hướng linh hoạt:**
     - Tự động gọi `showAlbumHero(entry, action)` khi nhấn vào bất kỳ thẻ album nào trong lưới.
     - Tự động ẩn `#album-hero` khi người dùng chuyển tab điều hướng (Home, Artists, Songs, History) hoặc nhấn nút `‹ Quay lại` trên thanh tiêu đề.
  4. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Tạo mới `album-view.test.cjs` kiểm thử 11 kịch bản: định dạng thời lượng, tổng hợp thông tin album, xếp bậc chất lượng DSD / Hi-Res / Lossless, và kiểm tra tính toàn vẹn của DOM markup cùng script logic.
     - Toàn bộ test suite chạy đạt **83/83 PASS (0 fail)**.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung `summarizeAlbum` và `formatAlbumDuration`, cập nhật export `NocturneLibrary`.
- `index.html`: Thêm markup `#album-hero` vào `library-view`, bổ sung hàm `showAlbumHero`, tích hợp vào `renderCollectionCards`, `renderTracks`, `setLibraryView`, `back-button`, thêm auto-schedule log comment.
- `album-view.test.cjs`: File test suite mới kiểm tra logic tóm tắt album và giao diện chi tiết album.
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ.

### 🚀 Đề Xuất Cho Chu Kỳ Kế Tiếp:
- **Pha C (Core Features):** Sleep timer fade-out mượt mà (giảm dần âm lượng trong 30 giây cuối trước khi dừng phát).
- **Pha D (Architecture & PWA):** PWA Service Worker offline caching nâng cao cho bài hát đã tải.
- **Pha A (Audio Engine & DSP):** AutoEQ profiles bù trừ tần số cho các dòng tai nghe phổ biến.

---

## [Chu Kỳ 2026-11-13 03:26 +07] — [Pha A] ReplayGain & Loudness Normalization: Đồng Bộ Âm Lượng Tự Động Giữa Các Bản Nhạc

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API)**.
- **Tính năng triển khai:**
  1. **Đọc và chuẩn hóa thông số ReplayGain `parseReplayGain(input)` (`library-utils.js`):**
     - Đọc toàn diện các thẻ ReplayGain từ ID3v2 TXXX, FLAC/Ogg Vorbis Comments, ApeTag hoặc metadata nạp từ cloud/local: `replaygain_track_gain`, `replaygain_track_peak`, `replaygain_album_gain`, `replaygain_album_peak` (hỗ trợ cả định dạng chuỗi `"-6.5 dB"` lẫn số thực).
     - Cơ chế fallback thông minh: nếu bài hát chỉ có Album Gain hoặc chỉ có Track Gain, tự động dự phòng chéo để không bị mất khả năng cân bằng âm lượng.
  2. **Thuật toán tính toán Gain và chống xén biên độ `computeReplayGainMultiplier` (`library-utils.js`):**
     - Hỗ trợ 2 chế độ audiophile: **Track Mode** (chuẩn hóa từng bài độc lập) và **Album Mode** (giữ nguyên độ tương phản động giữa các bài trong cùng album).
     - Tích hợp điều chỉnh Preamp bù trừ ($\pm 6\text{ dB}$).
     - **Cơ chế Anti-clip:** Tự động kiểm tra đỉnh biên độ ($multiplier \times peak > 1.0$) để kẹp gain về mức an toàn tối đa $1.0 / peak$, bảo vệ màng loa/tai nghe và tránh méo tiếng kỹ thuật số (clipping/distortion).
     - Giới hạn an toàn kẹp gain giữa $-30\text{ dB}$ và $+15\text{ dB}$.
  3. **Tích hợp sâu vào Audio Pipeline & Playback Engine (`index.html`):**
     - Điều khiển âm lượng thực tế của deck phát thông qua `setGain`: áp dụng `replayGainMultiplier` một cách trong suốt mà không làm lệch giá trị slider người dùng đã chỉnh.
     - Tự động gọi `applyReplayGain(track)` khi chuyển bài hoặc nạp bài mới trong `displayTrack`.
     - Tích hợp vào **Roon Signal Path**: hiển thị thông tin ReplayGain trong chuỗi DSP và tự động nâng hạng chất lượng chuỗi tín hiệu thành `ENHANCED`.
  4. **Giao diện điều khiển trong panel Parametric Equalizer (`#eq-panel`):**
     - Nút gạt bật/tắt `#replaygain-toggle` kèm huy hiệu trạng thái `#replaygain-badge` (hiện mức dB bù trừ thực tế hoặc cảnh báo Anti-clip `⚡`).
     - Bộ chọn chế độ `#replaygain-mode` (Từng bài / Cả album).
     - Thanh trượt chỉnh Preamp bù `#replaygain-preamp` kèm hiển thị số đo `#replaygain-preamp-val`.
     - Tự động lưu và khôi phục trạng thái qua `localStorage`.
  5. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Tạo mới `replaygain.test.cjs` kiểm thử 16 kịch bản: đọc thẻ, định dạng dB/peak, tính multiplier, bù preamp, chống clipping, chế độ track/album, format text, tích hợp Signal Path và kiểm tra DOM/Listeners.
     - Toàn bộ test suite chạy đạt **72/72 PASS (0 fail)**.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung `parseReplayGain`, `computeReplayGainMultiplier`, `formatReplayGain`, cập nhật `computeSignalPath`.
- `index.html`: Thêm markup UI ReplayGain trong `#eq-panel`, thêm `replayGainEnabled/Mode/Preamp/Multiplier` vào `state`, cập nhật `setGain`, `renderSignalPathChain`, `displayTrack`, thêm các hàm `applyReplayGain`, `updateReplayGainUi`, `setReplayGain*`, thêm auto-schedule log comment.
- `replaygain.test.cjs`: File test suite mới kiểm tra toàn diện logic ReplayGain.
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ.

### 🚀 Đề Xuất Cho Chu Kỳ Kế Tiếp:
- **Pha B (UI/UX & Visualizer):** Album view kiểu Roon (lưới bìa album + trang chi tiết album với danh sách bài và thông tin phát hành).
- **Pha C (Core Features):** Sleep timer fade-out mượt mà (giảm dần âm lượng 30s cuối).
- **Pha D (Architecture & PWA):** PWA Service Worker offline caching nâng cao cho bài hát đã nghe.

---

## [Chu Kỳ 2026-11-13 03:12 +07] — [Pha D] Ambient Glow: Hiệu Ứng Ánh Sáng Nền Động Trích Xuất Từ Bìa Album

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. UI/UX & Visualizer Hiện Đại**.
- **Tính năng triển khai:**
  1. **Thuật toán trích xuất màu chủ đạo `extractDominantColors(pixelData, width, height, count)` (`library-utils.js`):**
     - Xử lý dữ liệu pixel mảng RGBA từ canvas offscreen siêu nhẹ (12×12 pixel).
     - Lượng tử hóa không gian màu (quantization với bước 32) để gom nhóm màu hiệu quả và tính tần suất xuất hiện.
     - Lọc bỏ các pixel quá tối (luminance < 25) và quá sáng (luminance > 230), loại bỏ pixel trong suốt (alpha < 128) để ánh sáng nền giữ độ bão hòa và tương phản tốt trong giao diện tối.
     - Trả về danh sách `[r, g, b]` được sắp xếp theo mức độ phổ biến giảm dần.
  2. **Hiệu ứng nền phát sáng mềm mại thời gian thực (`#ambient-glow` trong `index.html`):**
     - Tạo lớp phủ nền mềm mại đa điểm phát (`radial-gradient` 3 điểm phát quang: 20% 30%, 80% 70%, 50% 100%) dựa trên bảng màu được trích xuất.
     - Thiết lập chuyển cảnh mượt mà 60fps (`transition: opacity 1.5s ease, background 1.5s ease`).
     - Đặt các biến CSS toàn cục `--ambient-c1` và `--ambient-c2` để các thành phần UI khác có thể tận dụng màu sắc bìa album.
     - Fallback an toàn: ẩn hiệu ứng nhẹ nhàng khi bài hát không có bìa hoặc khi ảnh bìa bị lỗi cross-origin (CORS).
  3. **Tích hợp liền mạch vào vòng đời phát nhạc (`displayTrack`):**
     - Tự động gọi `applyAmbientGlow(track)` mỗi khi chuyển bài hát mới hoặc cập nhật metadata.
     - Kiểm tra tránh tính toán lại lặp (caching id bài hát `_lastAmbientCoverId`).
  4. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Tạo mới `ambient-glow.test.cjs` kiểm thử 12 kịch bản: pixel quá tối, quá sáng, đồng nhất, sắp xếp tần suất, pixel trong suốt, giới hạn số lượng màu, mảng rỗng, cùng các assertions về DOM và script integration.
     - Toàn bộ test suite chạy đạt 56/56 PASS.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung hàm `extractDominantColors` và xuất trong `NocturneLibrary`.
- `index.html`: Thêm CSS `#ambient-glow`, chèn markup `#ambient-glow` trong `#listening-room`, bổ sung hàm `applyAmbientGlow`, tích hợp gọi từ `displayTrack`, thêm auto-schedule log comment.
- `ambient-glow.test.cjs`: File test suite mới kiểm tra thuật toán và DOM integration.
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ.

### 🚀 Đề Xuất Cho Chu Kỳ Kế Tiếp:
- **Pha A (Audio Engine & DSP):** Tích hợp ReplayGain / Loudness Normalization hoặc Parametric EQ nâng cao (AutoEQ profiles).
- **Pha B (UI/UX & Core Features):** Album view kiểu Roon (lưới bìa album + trang chi tiết album).
- **Pha C (Core Features):** Sleep timer fade-out mượt mà (giảm dần âm lượng 30s cuối).

---

## [Chu Kỳ 2026-11-13 00:06 +07] — [Pha C] Roon Radio: Tự Động Chọn & Phát Bài Tương Tự Khi Hết Danh Sách

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Tính năng triển khai:**
  1. **Thuật toán thông minh `selectRoonRadioTrack(currentTrack, tracks, options)` (`library-utils.js`):**
     - Tự động phân tích và tính điểm độ tương đồng đa chiều giữa bài đang phát và các bài trong thư viện:
       - **Ưu tiên nghệ sĩ (+60 điểm):** Chọn các bản nhạc cùng nghệ sĩ hoặc nghệ sĩ hợp tác.
       - **Ưu tiên album (+40 điểm):** Tận dụng các bản nhạc cùng album (đặc biệt hiệu quả với album tuyển tập / compilation nhiều nghệ sĩ).
       - **Điểm thưởng yêu thích (+25 điểm):** Tăng khả năng chọn các bài đã được người dùng thả tim (Favorites).
       - **Tương đồng định dạng Audiophile (+15 DSD / +10 Hi-Res):** Giữ mạch trải nghiệm âm thanh độ phân giải cao liền mạch.
       - **Chống lặp bài vừa nghe (-80 điểm cho 3 bài gần nhất, -40 cho 8 bài gần nhất):** Đảm bảo không bị tua lại vòng lặp các bài vừa phát.
       - **Đa dạng hóa tự nhiên:** Tích hợp hàm băm ID nhẹ nhàng để chọn ngẫu nhiên có kiểm soát trong nhóm điểm cao nhất.
       - Trả về đối tượng `{ track, reason, score }` giải thích rõ lý do gợi ý (ví dụ: `Cùng nghệ sĩ Pink Floyd`, `Từ bài hát yêu thích`).
  2. **Tích hợp sâu vào Audio Engine & Playback Pipeline (`index.html`):**
     - **Tự động chuyển bài liền mạch (`playNext`):** Khi danh sách phát hoặc hàng đợi kết thúc (`currentIndex >= state.tracks.length - 1`), thay vì ngắt tiếng im lặng, Roon Radio lập tức khởi động, hiện thông báo toast kín đáo (`⚡ Roon Radio: [Tên bài] (Cùng nghệ sĩ...)`) và tiếp tục phát nhạc.
     - **Tự động đệm & giải mã trước (`queueIndex` ➔ `preloadNext`):** `queueIndex()` dự đoán trước bài Roon Radio kế tiếp, cho phép hệ thống tải trước và giải mã nền (kể cả lát PCM đầu DSD) để chuyển bài chuẩn Gapless / Crossfade.
  3. **Giao diện điều khiển trong Panel Hàng Đợi (`#queue-panel`):**
     - Banner trạng thái Roon Radio (`#roon-radio-banner`) với huy hiệu động (`#roon-radio-badge`).
     - Dòng xem trước thông minh (`#roon-radio-hint`): Hiển thị trước bài tiếp theo mà Radio dự kiến sẽ phát (`Sắp phát: [Tên bài] · [Lý do]`).
     - Nút gạt bật/tắt nhanh (`#roon-radio-toggle`), lưu cấu hình vào `localStorage['nocturne-roon-radio']`.
  4. **Kiểm thử tự động (Unit & Integration Tests):**
     - Đã tạo file test mới `roon-radio.test.cjs` kiểm thử 6 kịch bản lựa chọn (cùng nghệ sĩ, cùng album, bài yêu thích, phạt bài vừa nghe, định dạng DSD, và thư viện rỗng/đơn bài), kèm kiểm tra DOM/Listeners.
     - Đã thêm kiểm thử đơn vị trong `library-utils.test.cjs`.

### 📝 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung hàm `selectRoonRadioTrack` và xuất trong `NocturneLibrary`.
- `library-utils.test.cjs`: Thêm assertions cho `selectRoonRadioTrack`.
- `index.html`: Thêm `state.roonRadio`, cập nhật UI hàng đợi (`#roon-radio-banner`, `#roon-radio-badge`, `#roon-radio-hint`, `#roon-radio-toggle`), tích hợp Roon Radio vào `queueIndex()` và `playNext()`, hàm `updateRoonRadioStatus()`, khôi phục `localStorage`, và thêm log bình luận cuối trang.
- `roon-radio.test.cjs`: Test suite mới kiểm tra toàn diện tính năng Roon Radio.
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ.

### 🧪 Kết Quả Kiểm Chứng (Self-Test):
- `node roon-radio.test.cjs`: PASS (2/2 test suites).
- `node signal-path.test.cjs`: PASS.
- `node index-script.test.cjs`: PASS.
- `node library-utils.test.cjs`: PASS.
- Không có lỗi cú pháp hay thiếu literal ID.

### 🚀 Đề Xuất Cho Chu Kỳ Tiếp Theo:
- **Phân khu 2 (UI/UX & Visualizer):** **Ambient Glow** — Trích xuất màu chủ đạo (Dominant Palette) từ ảnh bìa album đang phát để làm ánh sáng nền mờ huyền ảo theo nhịp điệu cho toàn trang và phòng nghe.
- **Hoặc Phân khu 1 (Audio Engine):** **Sleep Timer Fade-out** — Giảm âm lượng theo đường cong logarit mượt mà trong 30 giây cuối trước khi dừng phát khi hết giờ hẹn ngủ.

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
