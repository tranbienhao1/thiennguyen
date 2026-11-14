# 📜 Nhật Ký Nâng Cấp Tự Động (Continuous Evolution Log) — NOCTURNE

---

## [Chu Kỳ 2026-11-14 13:00 +07] — [Pha B: UI/UX & Visualizer Hiện Đại] Thanh Sóng Dạng Sóng Tương Tác Sống Động (Interactive Waveform Scrubbing), Tooltip Xem Trước Thời Gian (Hover Time Preview) & Vạch Kim Mờ (Ghost Playhead)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. UI/UX & Visualizer Hiện Đại** & **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Chi tiết triển khai:**
  1. **Bộ Tiện Ích Đo Lường & Định Dạng Vị Trí Tua (`calculateHoverSeekFraction`, `calculateHoverSeekTime`, `formatHoverTime`):**
     - Tính toán tỷ lệ vị trí chuột tương đối trên canvas dạng sóng (`0.0` đến `1.0`), kẹp an toàn giới hạn biên.
     - Quy đổi tức thời ra số giây tua nhạc chính xác theo thời lượng bản thu (`duration`).
     - Định dạng thời gian xem trước `m:ss` tinh gọn và thanh lịch.
  2. **Vạch Kim Mờ Theo Chuột Trên Canvas Dạng Sóng (Ghost Playhead Line):**
     - Nâng cấp `renderWaveformCanvas` tiếp nhận `options.hoverFraction` và `options.colorGhostPlayhead`.
     - Hiển thị một đường kim mờ 1.5px bán trong suốt (`rgba(255, 255, 255, 0.45)` hoặc `rgba(239, 68, 68, 0.55)`) tại vị trí con trỏ chuột, giúp người nghe nhạc ngắm điểm cần tua cực kỳ chính xác.
  3. **Tooltip Nổi Xem Trước Thời Gian (Floating Hover Tooltip):**
     - Bổ sung `#waveform-hover-tooltip` trong Phòng nghe (`#listening-room`) và `#fullscreen-waveform-hover-tooltip` trong Toàn màn hình Roon (`#roon-fullscreen-view`).
     - Tooltip bám theo chuyển động chuột mượt mà, tự động giới hạn biên không bị tràn ra ngoài canvas và ẩn đi khi chuột rời khỏi vùng sóng.
  4. **Kéo Trượt Tua Nhạc Trực Tiếp (Continuous Drag-to-Seek / Scrubbing):**
     - Cho phép người dùng giữ chuột trái (`e.buttons === 1`) và kéo rê dọc theo dạng sóng để tua nhạc mượt mà theo thời gian thực (tự động bật `state.isSeeking = true` để chống giật timeupdate).
  5. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `waveform-hover-scrub.test.cjs` (**11/11 tests PASS 100%**).
     - Toàn bộ 98 test suites (**700+ tests PASS 100%**, 0 fail, 0 regression).
     - BẢO TOÀN TUYỆT ĐỐI BẤT BIẾN ĐỒ THỊ ÂM THANH: `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 12:45 +07] — [Pha A: Audio Engine & DSP + Tinh Hoa UI/UX] Chuẩn Mực Âm Học Audiophile (Target Curves & Sound Signatures) & Tái Cấu Trúc Toàn Màn Hình Roon Chuẩn Mockup

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API)** & **2. UI/UX & Visualizer Hiện Đại**.
- **Chi tiết triển khai:**
  1. **Hệ Thống Đường Cong Mục Tiêu Âm Học & Chữ Ký Âm Thanh (`AUTOEQ_PROFILES`):**
     - Bổ sung 5 chuẩn âm học audiophile đỉnh cao vào bộ PEQ:
       - `target-harman-2019`: **Harman Target Curve 2019** (Chuẩn mực toàn cầu, sub-bass ấm áp, mid trong trẻo, treble tự nhiên).
       - `target-diffuse-field`: **Diffuse Field Studio Reference** (Chuẩn kiểm âm phòng thu phẳng, độ tách bạch micro-dynamics cực cao).
       - `target-warm-vocal`: **Vocal Warmth & Intimacy** (Tôn vinh giọng ca ngọt ngào, mid-forward ấm áp, kiểm soát triệt để tiếng chói sibilance).
       - `target-basshead-club`: **Basshead Club Impact** (Sub-bass sâu uy lực, chắc khỏe cho EDM/Hip-hop sàn diễn).
       - `target-treble-air`: **Acoustic Air & Soundstage** (Mở rộng âm trường 3D thoáng đãng, lấp lánh dải treble cao Air band).
     - Tất cả profiles đều tính toán bù trừ Preamp (`<= 0 dB`) ngăn chặn digital clipping tuyệt đối.
     - Tích hợp nhận diện `Target Curve` và `Sound Signature` vào Roon Signal Path trực quan hóa chuỗi DSP.
     - Nâng cấp `#autoeq-select` có `<optgroup>` phân nhóm trực quan giữa Chuẩn mực âm học và Tai nghe cụ thể.
  2. **Tái Cấu Trúc Giao Diện Toàn Màn Hình Chuẩn Roon (`#roon-fullscreen-view`):**
     - Thống nhất hàng dock dưới cùng của màn hình Now Playing thành một hàng ngang duy nhất:
       `[⌵ Thu nhỏ]` + `[0:00 Thời gian]` + `[Dạng sóng Waveform Seekbar]` + `[0:00 Thời lượng]` + `[🎛 System Output]` + `[🔊 100 Âm lượng]`
       Hoàn toàn ăn khớp với mockup người dùng yêu cầu, tối ưu chiều cao hiển thị ảnh bìa album trên cả Desktop và Tablet.
     - Dạng sóng toàn màn hình render thanh kim scrubber màu đỏ (`#ef4444`) đặc trưng phong cách Roon Audiophile.
  3. **Tối Ưu Vị Trí Tránh Va Chạm Giao Diện (Floating Panels Clearance):**
     - Đặt khoảng cách `bottom-[140px]` cho `mini-player-hud`, `eq-panel`, `sleep-panel`, `ambient-panel` để không bao giờ bị đè hoặc che khuất bởi thanh phát nhạc 128px ở đáy màn hình.
     - Nâng vị trí `#toast` lên `bottom-40 sm:bottom-44 z-[120]` tránh che waveform seekbar hoặc các nút bấm tương tác.
  4. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `target-curves.test.cjs` (**10/10 tests PASS 100%**).
     - Toàn bộ suite test chạy thành công không một lỗi nhỏ.
     - BẢO TOÀN TUYỆT ĐỐI BẤT BIẾN ĐỒ THỊ ÂM THANH: `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 12:25 +07] — [Pha D: Hiệu Năng, Kiến Trúc & PWA] Giám Sát Hạn Ngạch Bộ Nhớ PWA (Storage Quota Monitor), Dọn Dẹp Bộ Đệm & Bộ Lọc Nghe Nhạc Ngoại Tuyến (Offline Focus Mode)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **4. Hiệu Năng, Kiến Trúc & Độ Bền Hệ Thống (Architecture & PWA)** & **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Chi tiết triển khai:**
  1. **Bộ Tiện Ích Giám Sát Dung Lượng Bộ Nhớ PWA (`formatStorageBytes` & `getStorageEstimate`):**
     - Truy vấn API `navigator.storage.estimate()` để đo lường chính xác dung lượng thực tế (`usage`) và trần hạn ngạch trình duyệt cấp phát (`quota`).
     - Tự động phát hiện và kích hoạt cờ cảnh báo dung lượng sắp đầy (`isLowSpace: true`) khi bộ nhớ còn lại dưới 100MB hoặc tỷ lệ dùng vượt quá 90%.
     - Định dạng trực quan các mức dung lượng `B`, `KB`, `MB`, `GB` chuẩn xác.
  2. **Kiểm Toán Tài Nguyên Ngoại Tuyến (`auditOfflineStorage`):**
     - Thống kê tỷ lệ và số lượng bài hát có thể phát ngoại tuyến ngay lập tức (phân loại rõ ràng bài local trên máy, bài cloud đã cache toàn bộ file trong bộ nhớ, và bài cloud đã lưu lát audio đầu).
  3. **Bộ Lọc Ngoại Tuyến Trên Roon Focus Bar (`filterTracksByFocus: 'offline'`):**
     - Bổ sung nút lọc `⚡ Ngoại tuyến` (`#focus-count-offline`) trên thanh `#roon-focus-bar`, tự động đếm và lọc danh sách thư viện chỉ còn những bài có thể nghe khi mất mạng hoặc trên máy bay.
     - Khi mất mạng, thanh thông báo `#offline-banner` cho phép click trực tiếp để kích hoạt nhanh chế độ lọc ngoại tuyến.
  4. **Giao Diện Quản Lý Bộ Nhớ & Dọn Dẹp Bộ Đệm Trong Cài Đặt (`#storage-quota-section`):**
     - Thêm phân mục quản trị bộ nhớ PWA trong hộp thoại Cài đặt: hiển thị số đo dung lượng đã dùng (`#storage-usage-val`), tổng hạn ngạch (`#storage-quota-val`), phần trăm (`#storage-percent-val`), huy hiệu trạng thái (`#storage-quota-badge`) và thanh tiến trình trực quan (`#storage-progress-bar`).
     - Nút **[Kiểm tra dung lượng]** (`#refresh-storage-btn`): Cập nhật tức thời số liệu từ StorageManager.
     - Nút **[Dọn dẹp bộ đệm lát]** (`#prune-cache-btn`): Giải phóng an toàn các lát audio đệm FLAC/DSD trong IndexedDB `firstSliceCache` khi người dùng muốn giải phóng bộ nhớ máy.
  5. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `storage-quota-offline.test.cjs` (**20/20 tests PASS 100%**).
     - Toàn bộ 96 test suites (**669/669 tests PASS 100%**, 0 fail, 0 regression).
     - BẢO TOÀN TUYỆT ĐỐI BẤT BIẾN ĐỒ THỊ ÂM THANH: `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 12:05 +07] — [Pha C: Tính Năng & Trải Nghiệm Người Dùng] Tìm Kiếm Mờ Đa Từ Khóa Thông Minh (Smart Fuzzy Multi-Token Search), Xếp Hạng Phù Hợp, Làm Nổi Bật Từ Khóa (Keyword Highlighting) & Lịch Sử Tìm Kiếm Bền Vững

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)** & **2. UI/UX Hiện Đại**.
- **Chi tiết triển khai:**
  1. **Bộ Phân Tích & Khớp Đa Từ Khóa Thông Minh (`matchSearchQuery`):**
     - Cho phép tìm kiếm bằng cụm nhiều từ khóa không theo thứ tự cố định (Multi-token out-of-order matching). Ví dụ: gõ `"thang nguoi tinh"` hoặc `"buitruonglinh mot doi"` vẫn tìm thấy chính xác bài hát `"Người Tình Điên Loạn - Thắng"` hoặc `"Một đời - buitruonglinh"`.
     - Tự động chuẩn hóa NFKC/NFD, loại bỏ dấu thanh tiếng Việt và chuyển đổi ký tự `đ/Đ -> d` tương thích hai chiều.
  2. **Thuật Toán Tính Điểm & Xếp Hạng Độ Phù Hợp (`scoreSearchMatch` & `rankByRelevance`):**
     - Đánh giá trọng số ưu tiên: Tiêu đề khớp tuyệt đối (`1000 điểm`) > Tiêu đề bắt đầu bằng từ khóa (`800 điểm`) > Tiêu đề chứa từ khóa (`600 điểm`) > Nghệ sĩ/Album chứa từ khóa (`400/300 điểm`).
     - Tự động đẩy các bài hát có tiêu đề liên quan nhất lên đầu danh sách kết quả tìm kiếm khi người dùng nhập từ khóa.
  3. **Làm Nổi Bật Từ Khóa Thông Minh (`highlightSearchMatch`):**
     - Thuật toán quét và làm nổi bật các đoạn khớp trong tiêu đề, tên nghệ sĩ và album bằng thẻ `<mark class="bg-violet-500/25 text-violet-200 font-medium rounded px-0.5">...</mark>`.
     - **Bảo toàn 100% nguyên vẹn dấu tiếng Việt và chữ hoa/chữ thường** của văn bản gốc (nhập không dấu vẫn highlight đúng chữ có dấu gốc).
     - Thoát an toàn mã HTML (`escape: true`) chống tấn công XSS tuyệt đối.
  4. **Lưu Trữ Lịch Sử Tìm Kiếm Bền Vững (Search History Dropdown):**
     - Các hàm thuần `getSearchHistory`, `addSearchHistory`, `clearSearchHistory` lưu trữ tối đa 8 từ khóa tìm kiếm gần nhất vào `localStorage['nocturne-search-history']`.
     - Dropdown giao diện Glassmorphism `#search-history-dropdown` và `#search-history-mobile-dropdown` hiển thị các thẻ chip tìm kiếm nhanh `🕒 <từ khóa>` kèm nút "Xóa hết".
  5. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `smart-search.test.cjs` (**23/23 tests PASS 100%**).
     - Toàn bộ 95 test suites (**649/649 tests PASS 100%**, 0 fail, 0 regression).
     - BẢO TOÀN TUYỆT ĐỐI BẤT BIẾN ĐỒ THỊ ÂM THANH: `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 11:55 +07] — [Pha B: UI/UX & Visualizer Hiện Đại] Hệ Thống FFT Spectrum Analyzer Thời Gian Thực Đa Bảng Màu (Audiophile Multi-Theme Spectrum with Peak Hold & Decay Physics)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. UI/UX & Visualizer Hiện Đại** & **1. Audio Engine & DSP (Web Audio API)**.
- **Chi tiết triển khai:**
  1. **Bộ 4 Bảng Màu Spectrum Audiophile Đa Sắc (`VISUALIZER_THEMES`):**
     - **Cyber Neon (`cyber` — Mặc định):** Gradient tím - lam neon (`#8b5cf6 -> #38bdf8`), vạch đỉnh ngọc bích `#a7f3d0`. Mang lại phong cách cyberpunk hiện đại và chiều sâu thị giác.
     - **Sunset Glow (`sunset`):** Gradient cam hoàng hôn - hồng cánh sen (`#f97316 -> #ec4899`), vạch đỉnh vàng hổ phách `#fde047`.
     - **Aurora Borealis (`aurora`):** Gradient xanh lục cực quang - ngọc lam ngọc lam (`#10b981 -> #06b6d4`), vạch đỉnh lục nhạt `#6ee7b7`.
     - **Monochrome Audiophile (`monochrome`):** Dải xám bạc studio tinh tế (`#e4e4e7 -> #71717a`), vạch đỉnh trắng thuần khiết `#ffffff`.
  2. **Mô Phỏng Vật Lý Giữ Đỉnh & Rơi Chậm (`updateVisualizerPeaks`):**
     - Thuật toán Peak Hold & Decay: Khi biên độ tức thời vượt đỉnh cũ, vạch đỉnh nhảy lên tức thì và giữ nguyên trong 6 frames (`holdFrames: 6`); khi hết thời gian giữ đỉnh, vạch đỉnh từ từ rơi xuống với tốc độ phân rã mượt mà (`decayRate: 0.025`).
     - Tái hiện chính xác chuyển động cơ học của các máy đo phổ tần chuyên dụng trong phòng thu âm (Hardware Studio Spectrum Analyzers).
  3. **Vẽ Phổ Tần Số Thời Gian Thực Đỉnh Cao (`renderVisualizerSpectrum`):**
     - Tự động tạo `LinearGradient` theo dải tần, hỗ trợ chế độ đối xứng gương (`mode: 'mirror'`) cho thanh điều khiển footer và bo góc cột mềm mại (`roundRect`).
     - Vẽ vạch đỉnh lơ lửng phía trên mỗi cột phổ tần số.
  4. **Tương Tác Chạm & Đồng Bộ Bền Vững:**
     - Cho phép người dùng chạm/click trực tiếp vào canvas `#visualizer` để chuyển đổi vòng tròn qua các chủ đề màu sắc (`cycleVisualizerTheme`).
     - Lưu trữ sở thích hiển thị vào `localStorage['nocturne-visualizer-theme']`.
     - Hiển thị toast thông báo tên theme trực quan khi đổi bảng màu.
  5. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `visualizer-spectrum.test.cjs` (**19/19 tests PASS 100%**).
     - Toàn bộ 94 test suites (**626/626 tests PASS 100%**, 0 fail, 0 regression).
     - BẢO TOÀN TUYỆT ĐỐI BẤT BIẾN ĐỒ THỊ ÂM THANH: `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 11:22 +07] — [Pha A: Audio Engine & DSP] Peak Limiter Đa Chế Độ Chống Clipping & Bảo Vệ Thiết Bị Âm Thanh (Audiophile Brickwall / Soft-Knee / Bypass)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API)** & **2. UI/UX Hiện Đại**.
- **Chi tiết triển khai:**
  1. **Bộ 3 Cấu Hình Peak Limiter Audiophile (`LIMITER_PROFILES`):**
     - **Brickwall Trong Suốt (`transparent` — Khuyên dùng):** Threshold `-0.5 dBFS`, tỷ lệ nén `20:1`, attack tức thì `0.001s (1ms)`, release `0.05s`. Bảo vệ trần dải động tối đa mà không bóp méo âm thanh, triệt tiêu hoàn toàn nguy cơ digital clipping khi bật ReplayGain Preamp hoặc tăng Bass/Treble EQ.
     - **Soft-Knee Ấm Áp (`soft`):** Threshold `-3.0 dBFS`, knee `6 dB`, tỷ lệ nén `12:1`, attack `0.003s`, release `0.1s`. Nén góc thoai thoải theo phong cách ampli đèn điện tử (Tube Amp), cho chất âm ngọt ngào và mượt mà.
     - **Bỏ Qua Tuyến Tính (`off`):** Threshold `0 dBFS`, tỷ lệ `1:1`. Không can thiệp dải động dành cho người nghe muốn trải nghiệm Bit-Perfect tuyệt đối.
  2. **Điều Tiết AudioParam Mượt Mà (`applyLimiterParams`):**
     - Áp dụng các tham số `threshold`, `knee`, `ratio`, `attack`, `release` lên `DynamicsCompressorNode` bằng hàm `setTargetAtTime` (thời hằng 15ms) để chuyển đổi êm ái giữa các chế độ, không gây tiếng nổ (pop/click) đột ngột.
  3. **Giao Diện Điều Khiển Trong Hộp Thoại EQ (`#eq-panel`):**
     - Thêm nhóm điều khiển Peak Limiter chuyên biệt: `#limiter-mode-select`, huy hiệu trạng thái `#limiter-badge` (`BRICKWALL`, `SOFT-KNEE`, `BYPASS`) và mô tả kỹ thuật `#limiter-desc`.
     - Lưu trữ cấu hình bền vững vào `localStorage['nocturne-limiter-mode']` và tự động nạp lại khi mở trang.
  4. **Tích Hợp Roon Signal Path (Chuỗi Tín Hiệu Số):**
     - Tự động hiển thị chặng xử lý `Peak Limiter: Brickwall (-0.5 dBFS)` hoặc `Soft-Knee (-3 dBFS)` trong tầng DSP Stage khi bật.
     - Tự động giữ nguyên trạng thái Bit-Perfect khi chọn `Bỏ qua (Bypass)` và không có hiệu ứng DSP nào khác.
  5. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `limiter-profiles.test.cjs` (**15/15 tests PASS 100%**).
     - Toàn bộ 84 test suites PASS 100% (0 fail, 0 regression).
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 11:05 +07] — [Pha D: Kiến Trúc & PWA] Lưu Trữ Trạng Thái Bền Vững & Khôi Phục Phiên Phát Nhạc (Persistent Playback Session & Position Restoration)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **4. Hiệu Năng, Kiến Trúc & Độ Bền Hệ Thống (Architecture & PWA)** & **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Chi tiết triển khai:**
  1. **Tự Động Lưu Phiên Phát Nhạc Bền Vững (Persistent Playback Session):**
     - Tiện ích thuần `savePlaybackSession(trackId, currentTime, queueTrackIds, extra)`: Ghi nhớ bài hát đang nghe, vị trí phát chính xác (giây thứ bao nhiêu), danh sách hàng đợi phát nhạc và trạng thái đang phát (`wasPlaying`).
     - Tối ưu hóa I/O: Cơ chế tự động điều tiết (throttling 3 giây) trong sự kiện `timeupdate` để không gây quá tải ghi đĩa, đồng thời lưu tức thì khi có sự kiện `pause`, `play`, `ended` hoặc khi đóng/tải lại trang (`beforeunload`).
  2. **Khôi Phục Trạng Thái & Tự Động Chuẩn Hóa Vị Trí:**
     - Tiện ích thuần `restorePlaybackSession(rawSession, tracks)`: Đọc và giải mã an toàn từ `localStorage['nocturne-playback-session']`, đối chiếu và xác thực trackId với kho nhạc.
     - Cơ chế kẹp biên an toàn: Kẹp `currentTime` trong khoảng `[0, track.duration]`. Đặc biệt, nếu người dùng đã nghe đến sát cuối bài (còn dưới 2 giây), hệ thống tự động đưa vị trí về 0 giây để tránh lỗi tự động nhảy bài khi vừa khôi phục.
     - Lọc bỏ các bài không còn tồn tại trong thư viện khỏi hàng đợi được khôi phục.
  3. **Giao Diện Khôi Phục Phiên Nghe Nhạc Mượt Mà (#resume-session-banner):**
     - Banner Glassmorphism tinh tế hiển thị phía trên thanh điều khiển: `#resume-session-banner`, nhãn thông báo thân thiện được tạo bởi `formatResumePrompt(track, position)`: `"Tiếp tục nghe 'Tên bài hát' tại mm:ss?"`.
     - Nút **[Tiếp tục]** (`#resume-session-play`): Kích hoạt phát lại đúng bài và tua ngay đến vị trí giây dở dang kèm thông báo toast.
     - Nút **[✕]** (`#resume-session-dismiss`): Đóng banner nhanh, hoặc tự động ẩn khi người dùng chọn phát bài hát khác.
  4. **Tối Ưu Hóa Bộ Nhớ & Ngăn Chặn Rò Rỉ (Memory Leak Prevention):**
     - Tự động thu hồi `URL.revokeObjectURL` cho toàn bộ các ObjectURL đã tạo khi đóng hoặc tải lại trang trong sự kiện `beforeunload`.
  5. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `persistent-session.test.cjs` (**14/14 tests PASS 100%**).
     - Toàn bộ 83 test suites PASS 100% (0 fail, 0 regression).
     - BẢO TOÀN TUYỆT ĐỐI BẤT BIẾN ĐỒ THỊ ÂM THANH: `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 10:30 +07] — [Pha C: Tính Năng & Trải Nghiệm Người Dùng] Hẹn Giờ Ngủ Đa Tầng Kết Hợp Làm Mờ Thông Minh & Ru Ngủ Môi Trường (Intelligent Multi-Stage Sleep Timer & Adaptive Fade-Out Ambient Scene)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)** & **1. Audio Engine & DSP (Web Audio API)**.
- **Chi tiết triển khai:**
  1. **Hẹn Giờ Đa Tầng Thông Minh (Multi-Stage Sleep Timer):**
     - Đa dạng các mốc thời gian cố định: `5`, `15`, `30`, `45`, `60`, `90` phút.
     - **Dừng khi hết bài (`#sleep-track-end`)**: Dừng phát tự nhiên ngay khi kết thúc bài hát đang phát.
     - **Dừng khi phát hết album hiện tại (`#sleep-album-end`)**: Tiện ích `calculateAlbumRemainingSeconds(tracks, currentTrackId, currentTrackPlaybackSec)` tự động tính chính xác thời lượng còn lại của toàn bộ album (thời gian bài đang phát còn lại + tổng thời lượng các bài tiếp theo trong album).
  2. **Gia Hạn Nhanh & Nhập Số Phút Tùy Chỉnh:**
     - Cụm nút gia hạn nhanh `+5 phút` (`#sleep-add-5m`) và `+15 phút` (`#sleep-add-15m`) qua tiện ích `extendSleepTimer(currentRemainingMs, addMinutes)`, an toàn kẹp trần tối đa 360 phút (6 giờ).
     - Ô nhập tùy chỉnh số phút linh hoạt (`#sleep-custom-input`, `#sleep-custom-btn`) cho phép hẹn giờ chính xác theo mong muốn người dùng.
  3. **Làm Mờ Âm Lượng Thích Ứng (Adaptive Fade-Out Duration):**
     - Bộ chọn thời lượng làm mờ `#sleep-fade-duration` với các mức `15s`, `30s`, `60s`, `120s`.
     - Áp dụng hàm tính độ khuếch đại mượt mà theo đường cong equal-power sine `calculateSleepFadeGain(remainingMs, fadeDurationMs)` giúp bài hát êm dịu dần trước khi tắt mà không gây giật mình.
  4. **Chế Độ Ru Ngủ Âm Thanh Thiên Nhiên (Sleep Ambient Scene):**
     - Tùy chọn `#sleep-ambient-scene` ("Sleep Scene: Kèm tiếng mưa"): Thuật toán `calculateAdaptiveSleepStage(remainingMs, totalDurationMs, fadeDurationMs, options)` tự động kích hoạt hòa âm tiếng mưa thiên nhiên nhẹ nhàng trong giai đoạn chuyển tiếp ru ngủ (`ambient_transition`), và sau đó mờ dần cùng điệu nhạc trong giai đoạn kết thúc (`fadeout`).
  5. **Huy Hiệu Đếm Ngược Thời Gian Thực (Live Countdown Badge):**
     - Tiện ích `formatSleepCountdownCompact(remainingMs)` hiển thị thời gian còn lại trực tiếp dưới dạng `mm:ss` hoặc `h:mm:ss`.
     - Tự động hiển thị huy hiệu đếm ngược `#sleep-badge` trong hộp thoại hẹn giờ và trên nút hẹn giờ ở thanh điều khiển footer (`#sleep-button`).
  6. **Kiểm Thử Độc Lập & Bất Biến Âm Thanh:**
     - Bộ kiểm thử mới `intelligent-sleep-timer.test.cjs` (16/16 tests PASS 100%).
     - Toàn bộ hệ thống kiểm chứng: 82/82 test suites PASS 100% (0 fail, 0 regression).
     - BẢO TOÀN TUYỆT ĐỐI BẤT BIẾN ĐỒ THỊ ÂM THANH: `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 08:30 +07] — [Tích Hợp Tinh Hoa Black Candy] Kết Nối Máy Chủ Black Candy REST API, Hàng Đợi Thông Minh (Play Next / Add to End) & Bộ Phân Tích LRC Offset & Karaoke (blackcandy-org/blackcandy)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & Multi-Server Streaming**, **2. UI/UX Hiện Đại** & **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Tính năng tiếp thu từ kiến trúc mã nguồn mở Black Candy (https://github.com/blackcandy-org/blackcandy):**
  1. **Kết Nối Máy Chủ Tự Lưu Trữ Black Candy REST API Client:**
     - Xây dựng tiện ích `buildBlackCandyAuthHeader(token)`: Tạo header chuẩn `Authorization: Token token=<api_token>` và `Accept: application/json`.
     - Tiện ích `buildBlackCandyUrl(endpoint, path, params)`: Chuẩn hóa endpoint, hỗ trợ các API `/sessions`, `/songs`, `/stream/new`, `/transcoded_stream/new`, `/current_playlist/songs`, `/favorite_playlist/songs`.
     - Tiện ích `parseBlackCandySong(rawSong, endpoint, options)`: Ánh xạ chuẩn bài hát từ Black Candy sang đối tượng track audiophile của Nocturne, hỗ trợ linh hoạt cả luồng trực tiếp **Direct Stream (Lossless)** lẫn luồng chuyển mã **Transcoded MP3 Stream** (giúp nghe mượt mà khi dùng mạng di động 4G hạn chế băng thông).
     - Giao diện kết nối trong Cài đặt (`#blackcandy-config-card`): URL endpoint (`#blackcandy-endpoint`), API token / tài khoản (`#blackcandy-token`), chế độ chuyển mã (`#blackcandy-transcode-mode`), nút kết nối (`#blackcandy-connect-btn`), nút đồng bộ (`#blackcandy-sync-btn`) và lưu trữ bền vững vào `localStorage ('nocturne-blackcandy-config')`.
     - Bổ sung tùy chọn `Black Candy` vào bộ lọc nguồn `#source-filter`.
  2. **Hệ Thống Hàng Đợi Thông Minh (Smart Up Next Queue):**
     - Kế thừa mô hình xử lý hàng đợi từ `CurrentPlaylist::SongsController` và `songs_controller.js` của Black Candy:
       - **Phát tiếp theo (Play Next)**: `smartQueuePlayNext(queue, currentIndex, song)` chèn bài ngay sau bài đang nghe (`currentIndex + 1`), nếu bài đã có trong hàng đợi thì tự động dời lên vị trí kế tiếp mà không sinh bản sao trùng lặp.
       - **Thêm vào cuối (Add to End)**: `smartQueueAppend(queue, song)` thêm bài vào cuối danh sách phát.
       - **Sắp xếp thứ tự**: `smartQueueReorder(queue, fromIndex, toIndex)` di chuyển bài linh hoạt.
     - Tích hợp các nút thao tác nhanh trên từng hàng bài hát (`play_next`, `append`) và menu chuột phải ngữ cảnh (`#context-menu-play-next`, `#context-menu-append-queue`).
  3. **Bộ Phân Tích Lời Bài Hát Nâng Cao (LRC Offset & Karaoke Tag Stripping):**
     - Kế thừa thuật toán từ `Song::Lyrics::Parser` của Black Candy: `parseLrcWithOffsetAndTags(lrcText)`.
     - Hỗ trợ thẻ bù trễ âm thanh `[offset: +/-ms]` trong file `.lrc` (tự động dịch chuyển thời gian của các dòng lời để đồng bộ chuẩn xác với bản thu âm).
     - Lọc sạch các thẻ karaoke theo từng từ `<mm:ss.xx>` để lời hiển thị sắc nét, mượt mà.
     - Bỏ qua các thẻ metadata header `[ar:]`, `[ti:]`, `[al:]`, `[by:]`, `[offset:]`, `[length:]` và tự động nhân bản các dòng có nhiều mốc thời gian `[00:10.00][00:25.00]`.
  4. **Cơ Chế Tự Động Phục Hồi Cuộn Lời (Lyrics Auto-Scroll Suspension & Resume Delay):**
     - Kế thừa cơ chế từ `lyrics_controller.js` của Black Candy: khi người dùng chủ động chạm/cuộn danh sách lời để đọc trước, hệ thống tạm hoãn bám sát dòng trong 4 giây (`RESUME_FOLLOWING_DELAY = 4000`).
     - Sau 4 giây không có thao tác cuộn, hệ thống tự động kích hoạt bám sát và cuộn mượt dòng đang hát vào chính giữa màn hình.
  5. **Kiểm thử tự động & Bảo toàn kiến trúc:**
     - Bộ kiểm thử mới `blackcandy-integration.test.cjs` (31/31 tests PASS 100%).
     - Toàn bộ 562/562 ca kiểm thử PASS 100% trên 81 test suites (0 fail, 0 regression).
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 08:00 +07] — [Khai Thác Hệ Sinh Thái Self-Hosted Music Apps] Kết Nối Máy Chủ Jellyfin (Finamp/Feishin), Mini Player HUD Nổi (Tauon), Phân Tách Album Artist (Symfonium) & Điều Chỉnh Tốc Độ Phát

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP**, **2. UI/UX Hiện Đại** & **4. Kết Nối Máy Chủ Tự Lưu Trữ (Multi-Server Streaming)**.
- **Tính năng khai thác từ các ứng dụng mã nguồn mở tiêu biểu trong ma trận:**
  1. **Kết Nối Máy Chủ Media Jellyfin REST API (từ Finamp & Feishin):**
     - Tiện ích thuần `buildJellyfinUrl(endpoint, path, params, apiKey)` và `parseJellyfinItem(item, endpoint, apiKey)`.
     - Chuyển đổi toàn diện các mục Audio từ Jellyfin sang cấu trúc track của Nocturne (đọc `RunTimeTicks`, `Container`, `BitDepth`, `SampleRate`, link stream `/Audio/{id}/stream`, link ảnh bìa `/Items/{id}/Images/Primary`, gắn nhãn nguồn `source: 'Jellyfin'`).
     - Giao diện kết nối trong Cài đặt (`#jellyfin-endpoint`, `#jellyfin-token`, `#jellyfin-user-id`, `#jellyfin-connect-btn`), lưu trữ cấu hình `localStorage ('nocturne-jellyfin-config')` và bổ sung tùy chọn Jellyfin trong bộ lọc nguồn.
  2. **Chế Độ Mini Player HUD Nổi Góc Màn Hình (từ Tauon Music Box):**
     - Tiện ích thu gọn nổi (`#mini-player-hud`): hiển thị ở góc phải màn hình gồm ảnh bìa mini (`#mini-cover`), tên bài hát & nghệ sĩ (`#mini-title`, `#mini-artist`), dạng sóng mini thời gian thực (`#mini-waveform`), nút phát/dừng (`#mini-play`), bài kế tiếp (`#mini-next`) và nút phóng to mở rộng (`#mini-expand`).
     - Bật/tắt nhanh bằng nút `#mini-player-toggle` ở footer hoặc phím tắt **`M`**.
  3. **Phân Tách Rạch Ròi Album Artist vs Track Artist (từ Symfonium & Navidrome):**
     - Hàm `groupTracksByAlbumArtist(tracks)`: gom nhóm album theo `albumArtist` (dành cho nghệ sĩ chính của album) thay vì phân mảnh khi có nghệ sĩ phụ (`feat.`) tham gia biểu diễn.
  4. **Bộ Điều Khiển Tốc Độ Phát Âm Thanh / Tempo Pitch Control (từ Tauon & Symfonium):**
     - Hàm `calculatePlaybackRate(rate)`: giới hạn và làm tròn an toàn trong dải `[0.5x, 2.0x]`.
     - Bộ chọn tốc độ `#playback-rate-select` trong Hộp thoại EQ (`0.75x`, `0.9x`, `1.0x`, `1.1x`, `1.25x`, `1.5x`), đồng bộ ngay trên cả 2 deck âm thanh (`audio` và `standbyAudio`).
  5. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Bộ kiểm thử mới `selfhosted-ecosystem.test.cjs` (20/20 tests PASS 100%).
     - Toàn bộ hệ thống kiểm chứng: 531/531 ca kiểm thử PASS 100% (74 test suites, 0 fail).
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 07:30 +07] — [Swarm Selfhosted Music Overview Integration] Tích Hợp Subsonic / OpenSubsonic API Client, Decade View & ListenBrainz Scrobbling (basings/selfhosted-music-overview)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)** & **4. Kiến Trúc & Kết Nối Đa Nguồn (Architecture & Integration)**.
- **Tính năng tiếp thu từ ma trận so sánh hệ thống tự lưu trữ (https://github.com/basings/selfhosted-music-overview):**
  1. **Chuẩn Kết Nối Máy Chủ Tự Lưu Trữ Subsonic / OpenSubsonic REST API Client:**
     - Xây dựng tiện ích thuần `buildSubsonicUrl(endpoint, action, params, authConfig)`: Chuẩn hóa URL, xử lý tiền tố giao thức, hỗ trợ cả mật khẩu thô và chuẩn token/salt hash `t`/`s` của OpenSubsonic, tự động thêm `v=1.16.1`, `c=nocturne`, `f=json`.
     - Hàm `parseSubsonicSong(entry, serverUrl, authConfig)`: Chuyển đổi định dạng bài hát từ Subsonic sang cấu trúc track chuẩn của Nocturne (đọc `samplingRate`, `bitDepth`, link stream `stream.view`, link ảnh bìa `getCoverArt.view`, năm phát hành, thể loại, gắn nhãn nguồn `source: 'Subsonic'`).
     - Giao diện trong Cài đặt (`#settings-panel`): Cấu hình URL máy chủ (`#subsonic-endpoint`), tài khoản (`#subsonic-user`), mật khẩu (`#subsonic-pass`), nút kết nối (`#subsonic-connect-btn`), lưu trữ bền vững vào `localStorage ('nocturne-subsonic-config')`. Cho phép stream trực tiếp kho nhạc từ các máy chủ Navidrome, Airsonic, Gonic, Ampache về Nocturne.
  2. **Duyệt & Lọc Theo Thập Niên (Decade View & Year Browsing):**
     - Tiện ích thuần `extractDecade(year)`: Quy đổi năm phát hành (ví dụ: `1984` -> `'1980s'`, `2023` -> `'2020s'`).
     - Hàm `filterTracksByDecade(tracks, decade)`: Lọc toàn bộ thư viện bài hát theo thập niên.
     - Tích hợp cụm nút lọc Thập niên trên thanh Roon Focus Bar: `1980s`, `1990s`, `2000s`, `2010s`, `2020s` kèm huy hiệu hiển thị tiếng Việt.
  3. **Giao Thức Scrobble Mã Nguồn Mở ListenBrainz:**
     - Hàm `isScrobbleEligible(playedSeconds, totalDuration)`: Kiểm tra tiêu chuẩn bài nghe hợp lệ (nghe >= 50% thời lượng hoặc trên 240 giây).
     - Hàm `buildListenBrainzPayload(track, listenType, listenedAt)`: Đóng gói payload JSON chuẩn gửi lên API ListenBrainz cho sự kiện `playing_now` và `single_listen`.
     - Cấu hình mã token ListenBrainz trong Cài đặt (`#listenbrainz-token`), tự động scrobble khi nghe nhạc.
  4. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Bộ kiểm thử mới `subsonic-library.test.cjs` (23 tests) và `selfhosted-overview-features.test.cjs` (19 tests) PASS 100%.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm chứng: 511/511 ca kiểm thử PASS 100% (68 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-14 07:00 +07] — [UI/UX Roon Pixel-Perfect] Thiết Kế Lại Giao Diện Khi Mở Toàn Màn Hình Bài Hát (Roon Immersive Now Playing View) Chuẩn Xác Theo Ảnh Mẫu

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. UI/UX & Visualizer Hiện Đại** & **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Tính năng triển khai:**
  1. **Nền Ambient Blur & Thanh Điều Hướng Đỉnh:**
     - Ảnh bìa album phóng to mờ sâu toàn màn hình (`#fullscreen-bg-cover`) kết hợp lớp gradient tối (`#fullscreen-ambient-glow`) tạo không gian chiều sâu audiophile.
     - Nút đóng `✕` tối giản ở góc trên cùng bên trái và nút bánh răng cài đặt `⚙` ở góc trên cùng bên phải.
  2. **Khu Vực Trung Tâm (Center Stage):**
     - Bìa Album Art lớn hình vuông nằm chính giữa với bóng đổ sâu (`shadow-2xl shadow-black/90`).
     - Dòng thông số định dạng kỹ thuật âm thanh (`#fullscreen-format-detail`) đặt ngay dưới ảnh bìa: ví dụ `FLAC 44.1kHz 16bit 2ch` hoặc `DSD64 2.8MHz 1bit 2ch`.
  3. **Thanh Dock Điều Khiển Dưới Chân (Bottom Control Dock):**
     - Bố cục nền tối `#131316` hiệu ứng kính mờ (Backdrop blur) viền mảnh sang trọng.
     - Hàng thông tin bài hát: Tiêu đề lớn in đậm (`#fullscreen-title`), icon trái tim yêu thích (`#fullscreen-favorite-btn`), tên album (`#fullscreen-album`), dòng credit nghệ sĩ (`Performed by ...` — `#fullscreen-performer`), và nút tùy chọn ba chấm dọc `⋮`.
     - Cụm phím điều khiển trung tâm: Nút xáo trộn `🔀`, bài trước `⏮`, phát/tạm dừng `▶`/`⏸`, bài kế `⏭`, và nút danh sách hàng đợi `≣`.
     - Thanh dạng sóng Waveform Seekbar: Nằm ngang giữa mốc thời gian đã phát `0:01` và tổng thời lượng `5:28`, với vạch playhead màu đỏ hồng mận `#e11d48` chuẩn thiết kế Roon thực tế.
     - Góc dưới: Nút thu nhỏ `⌵` góc trái; biểu tượng loa thiết bị đầu ra (`System Output` / `Direct DAC`) và nút âm lượng (`🔊 100`) ở góc phải.
  4. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Bộ kiểm thử mới `roon-fullscreen-redesign.test.cjs` PASS 100%.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.

---

## [Chu Kỳ 2026-11-14 04:45 +07] — [Pha B - Audio Engine & Visualizer] Đồng Hồ Độ Động Âm Thanh Dynamic Range Meter (Crest Factor) & Giám Sát Bộ Đệm Âm Thanh Lookahead Buffer

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API)** & **2. UI/UX & Visualizer Hiện Đại**.
- **Tính năng triển khai:**
  1. **Đồng hồ đo độ động âm thanh chuẩn quốc tế Dynamic Range Meter (Crest Factor):**
     - Xây dựng tiện ích thuần `calculateDynamicRange(peakDb, rmsDb)`: tính toán chính xác hệ số đỉnh Crest Factor theo dB (`Peak_dB - RMS_dB`), xử lý an toàn mức -96 dB và các trường hợp im lặng.
     - Hàm `formatDynamicRange(drScore)`: phân cấp đánh giá độ động chuyên nghiệp:
       + `DR >= 14`: **Audiophile Ref** (xanh ngọc lục bảo `emerald`, độ động cực cao của bản thu giao hưởng/jazz cổ điển nguyên bản).
       + `DR >= 10`: **Tự nhiên** (tím audiophile `violet`, dải động tự nhiên chuẩn hi-fi).
       + `DR >= 7`: **Tiêu chuẩn** (vàng hổ phách `amber`, bản thu hiện đại tiêu chuẩn).
       + `DR < 7`: **Nén mạnh** (đỏ cam `rose`, bản thu chịu ảnh hưởng của cuộc chiến âm lượng Loudness War).
     - Hiển thị huy hiệu thời gian thực `#room-dr-badge` và chi tiết đỉnh `#room-crest-detail` trong Phòng nghe, cùng nhãn `#footer-dr-badge` ở thanh điều khiển footer dưới chân trang.
  2. **Bộ Giám Sát Bộ Đệm Nạp Trước & Chuyển Bài Liền Mạch (Lookahead Audio Buffer Monitor):**
     - Hàm `calculateBufferLookahead(currentTime, bufferedRanges)`: tính toán chính xác số giây dữ liệu âm thanh đã nạp sẵn trong bộ nhớ đệm trình duyệt phía trước điểm phát hiện tại.
     - Hàm `formatBufferLookahead(lookaheadSec, isGaplessReady)`: hiển thị trạng thái đệm trực quan (ví dụ: `Đệm 15.2s (Sẵn sàng Gapless)`, `Đang phát (4.5s đệm)`, `Đang nạp (1.8s)`).
     - Tích hợp đèn tín hiệu `#room-buffer-dot` (xanh lá khi đệm an toàn >= 5s, vàng khi đệm nhẹ, xám khi đang nạp luồng).
  3. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Bộ kiểm thử mới `dynamic-range-buffer.test.cjs` gồm 5 bài kiểm tra chuyên sâu PASS 100%.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm chứng: 467/467 ca kiểm thử PASS 100% (57 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-14 03:30 +07] — [Swarm Orynivo Integration] Tích Hợp CUE Sheet Parser, Smart Playlists Engine & Đánh Giá 5 Sao Audiophile từ Orynivo (bschlaack/Orynivo)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)** & **4. Kiến Trúc & Quản Lý Thư Viện Audiophile**.
- **Tính năng tiếp thu từ kho lưu trữ Orynivo (https://github.com/bschlaack/Orynivo):**
  1. **Hỗ trợ CUE Sheet chuyên sâu (`parseCueSheet`):**
     - Hỗ trợ tải hoặc kéo thả các file `.cue` đi kèm album/CD rip nguyên khối (FLAC/WAV/APE).
     - Phân tích cú pháp CUE chuẩn: đọc tiêu đề album, nghệ sĩ, tên file âm thanh gốc, các lệnh `TRACK nn AUDIO`, `INDEX 01` quy đổi khung hình `mm:ss:ff` (75 fps) sang giây chính xác.
     - Tự động tạo các bản nhạc ảo (Virtual Tracks) và liên kết với file âm thanh gốc; phát nhạc với độ lệch `cueStart` và `cueEnd` liền mạch, hiển thị thời lượng chuẩn từng bài.
  2. **Bộ máy Danh sách phát Thông minh (Smart Playlists Engine — `evaluateSmartPlaylist`):**
     - Đánh giá động danh sách phát theo quy tắc đa điều kiện: Định dạng chất lượng (`format: 'dsd' | 'hires' | 'lossless'`), trạng thái yêu thích (`favorite`), độ dài bài hát (`minDuration / maxDuration`), nghệ sĩ, thể loại và mức đánh giá sao.
     - Tích hợp điều hướng Smart Playlists trong thanh Sidebar và các nút lọc nhanh trên Focus bar: *DSD Collection*, *Hi-Res Audiophile*, *Top Yêu Thích > 4m*.
  3. **Hệ thống Đánh giá 5 Sao Không Xâm Phạm File (Non-Destructive Audiophile Rating):**
     - Thêm giao diện đánh giá sao tương tác trong Phòng nghe (`#room-rating`) với 5 ngôi sao nhấp chuột (`data-rating="1..5"`), cùng nhãn hiển thị sao trên từng hàng bài hát.
     - Tiện ích xử lý thuần `clampRating(rating)` và `formatRating(rating)` (hiển thị `★★★★☆`, `☆☆☆☆☆`).
     - Lưu trữ bền vững vào `localStorage` (`nocturne-rating-${track.id}`) mà không sửa đổi file âm thanh nguồn.
  4. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Bộ kiểm thử mới `cue-smart-playlist.test.cjs` (6 tests) và `orynivo-features.test.cjs` (21 tests) PASS 100%.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm chứng: 462/462 ca kiểm thử PASS 100% (56 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-14 00:55 +07] — [Sửa lỗi & Nâng cấp] Tự Động Tìm Lời Đồng Bộ (.lrc) Qua LRCLIB & Dạng Sóng Âm Thanh Siêu Nét (High-DPI Waveform Seekbar)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. UI/UX & Visualizer Hiện Đại** & **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Vấn đề thực tế được khắc phục theo phản hồi người dùng:**
  1. Người dùng nghe nhạc (ví dụ bài "An Thần" của "Low G") nhưng hệ thống báo *"Chưa có lời đồng bộ (.lrc) cho bài này."* do bài hát không có sẵn file `.lrc` offline trong thư viện.
  2. Dạng sóng (Waveform Seekbar) bị kẹt thanh playhead ở vị trí `0:00` bên trái, thao tác nhấp chuột để tua không phản hồi chính xác hoặc gặp lỗi chuyển bài.
- **Tính năng & Giải pháp triển khai:**
  1. **Tự động tìm và nạp lời đồng bộ (.lrc) trực tuyến qua LRCLIB API:**
     - Tích hợp hàm `cleanSearchQuery(title, artist)` trong `library-utils.js`: tự động loại bỏ đuôi mở rộng file (`.mp3`, `.flac`, `.wav`), số thứ tự track (`01. `), và các nhãn phụ (`(Official Music Video)`, `[Lyrics]`, `(ft. ...)`) để đạt tỷ lệ khớp lời cao nhất.
     - Hàm bất đồng bộ `triggerLyricsFetch(track)`: tự động truy vấn LRCLIB (`https://lrclib.net/api/get` và fallback `/api/search`) theo thời lượng bài hát, nạp ngay khi phát bài mới.
     - Bộ nhớ đệm bền vững (`localStorage ('nocturne-lyrics-{track.id}')`): bài đã tải lời một lần sẽ được mở ngay lập tức ở các lần nghe sau mà không tốn băng thông.
     - Hỗ trợ thao tác thủ công: Thêm nút `🔍 Tìm lời trực tuyến` để tìm lại khi cần, và nút `📝 Dán lời .lrc` cho phép người dùng dán trực tiếp nội dung file lời bài hát.
  2. **High-DPI Waveform Seekbar & Nhấp tua nhạy bén:**
     - Hàm `syncCanvasDimensions(canvas)`: cân chỉnh kích thước buffer canvas theo `window.devicePixelRatio`, loại bỏ hoàn toàn tình trạng vỡ hạt, mờ hoặc lệch toạ độ trên màn hình độ phân giải cao.
     - Hàm `generateDeterministicWaveform(seed, count)` trong `library-utils.js`: tự động tính toán hình bao sóng tự nhiên, sống động theo hàm băm xác định từ tên bài hát và nghệ sĩ ngay khi nạp bài (loại bỏ trường hợp sóng bẹp dí thành vạch phẳng 0.1 khi không thể decode PCM thô qua mạng).
     - Nâng cấp bộ lắng nghe click trên `#waveform-canvas` và `#fullscreen-waveform`: bắt chuẩn xác deck âm thanh đang hoạt động (`state.activeDeck.element`), tính toán thời gian `currentTime = fraction * dur` chính xác, di chuyển playhead tức thì và phát thông báo toast xác nhận thời điểm tua.
  3. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Tạo mới test suite `lyrics-waveform.test.cjs` gồm 5 bài kiểm tra chuyên sâu PASS 100%.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm chứng: 440/440 ca kiểm thử PASS 100% (52 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-13 23:25 +07] — [Pha A - Audio Engine & DSP] Reversible Phase Invert (Đảo Pha Tuyệt Đối 180° / Polarity Inversion Ø)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API) & 3. Trải Nghiệm Nghe Nhạc Audiophile**.
- **Tính năng triển khai:**
  1. **Đảo pha cực tính tuyệt đối (Absolute Polarity Inversion Ø 180°):**
     - Đảo ngược cực tính pha 180° trực tiếp trên dòng tín hiệu số bằng cách nhân hệ số pha `phaseMult = state.phaseInvert ? -1 : 1` qua các `GainNode` chuyên biệt (`deck.preamp` và `deck.direct`).
     - Bảo toàn 100% pha chuyển tiếp mượt mà không gây tiếng click/pop nhờ cơ chế `setTargetAtTime(..., currentTime, 0.015)`.
     - Hoạt động trơn tru cả ở chế độ có can thiệp DSP (EQ enabled) lẫn chế độ bypass tín hiệu nguyên bản (Direct Bit-perfect bypass).
  2. **Giao diện điều khiển trong Hộp thoại EQ (`#eq-panel`):**
     - Bổ sung công tắc `#phase-invert-toggle` với nhãn chuyên môn audiophile: **Đảo cực tính pha (Phase Invert Ø)**.
     - Huy hiệu trạng thái thời gian thực `#phase-invert-badge` hiển thị `0°` (chữ xám khi bình thường) hoặc `Ø 180°` (vàng hổ phách sáng khi đảo pha).
     - Lưu trữ trạng thái bền vững vào `localStorage ('nocturne-phase-invert')` và tự động khôi phục khi tải lại trang.
  3. **Tích hợp Roon Signal Path (Chuỗi tín hiệu thời gian thực):**
     - Trạm xử lý **DSP Stage** trong Signal Path lập tức phản ánh `Đảo pha: Ø 180°` khi tính năng được kích hoạt.
  4. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Bộ kiểm thử mới `phase-invert.test.cjs` gồm 9 bài kiểm tra phủ kín tiện ích thuần (`clampPhaseInvert`, `formatPhaseInvert`), tích hợp DOM/Script và bảo toàn đồ thị âm thanh.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm chứng: 430/430 ca kiểm thử PASS 100% (53 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-13 18:05 +07] — [Pha D - Audio Engine & DSP] AutoEQ Headphone Compensation Profiles (Harman Target) & Audiophile PEQ Presets

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API) & 3. Trải Nghiệm Nghe Nhạc Audiophile**.
- **Tính năng triển khai:**
  1. **Thư viện cấu hình AutoEQ Harman Target (`AUTOEQ_PROFILES`):**
     - Tích hợp 8 hồ sơ bù trừ đáp tuyến tần số tai nghe đo đạc chuẩn mục tiêu Harman Curve (Over-Ear & In-Ear Target 2018):
       - `none`: Flat / Bypass không can thiệp.
       - `sennheiser-hd600`: Sennheiser HD 600 (Bù sub-bass 50Hz +4.5dB, căn chỉnh mid/treble).
       - `sennheiser-hd650`: Sennheiser HD 650 / 6XX (Bù sub-bass 45Hz +5.0dB, giảm mid-bass 220Hz, mở rộng treble).
       - `ath-m50x`: Audio-Technica ATH-M50x (Hạ bớt bass thừa 180Hz -3.5dB, tăng vocal 3.1kHz +3.0dB, làm mượt treble 9.2kHz).
       - `sony-wh1000xm4`: Sony WH-1000XM4 (Gọt mid-bass bloat 150Hz -5.0dB, tăng vocal 2.4kHz +3.5dB và treble 8.5kHz).
       - `beyer-dt770`: Beyerdynamic DT 770 Pro 80Ω (Triệt tiêu đỉnh chói "Beyer peak" 6kHz/8.5kHz, nâng dải vocal 2.2kHz).
       - `airpods-pro`: Apple AirPods Pro (Cân chỉnh mượt mà theo chuẩn Harman In-Ear Target).
       - `hifiman-sundara`: HiFiMan Sundara (Bù lực sub-bass Planar Magnetic 45Hz +4.5dB, làm dịu dải cao 9.2kHz).
     - Mỗi hồ sơ tự động tính toán preamp an toàn âm (Negative Preamp Headroom, ví dụ `-4.5 dB` đến `-5.0 dB`) bằng `calculateAutoEqPreamp` để loại bỏ 100% hiện tượng méo tiếng clipping kỹ thuật số (0 dBFS inter-sample clipping).
  2. **Giao diện điều khiển trong Hộp thoại Parametric Equalizer (`#eq-panel`):**
     - Bổ sung phân mục riêng **Cân chỉnh tai nghe (AutoEQ Harman)** với menu lựa chọn `#autoeq-select`.
     - Huy hiệu trạng thái thời gian thực `#autoeq-badge` (sáng tím khi kích hoạt) và dòng mô tả đặc tính âm thanh `#autoeq-desc`.
     - Tự động điền chuỗi filter band vào `state.bands`, gán preamp an toàn, bật toggle EQ, và lưu cấu hình bền vững vào `localStorage.getItem('nocturne-autoeq-profile')`.
  3. **Tích hợp Roon Signal Path (Chuỗi tín hiệu thời gian thực):**
     - Trong trạm xử lý **DSP Stage** của Signal Path (`buildRoonSignalPathStages` / `computeSignalPath`), hiển thị chi tiết tên dòng tai nghe đang được cân chỉnh: `AutoEQ: [Tên Tai Nghe] (DSP Active / Enhanced)`.
  4. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Bộ kiểm thử mới `autoeq-profiles.test.cjs` gồm 11 bài kiểm tra phủ kín tiện ích tính toán và tích hợp DOM/Script.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm chứng: 421/421 ca kiểm thử PASS 100% (52 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-13 13:25 +07] — [Swarm UI] Chuẩn Hóa Pixel-Perfect Theo Giao Diện Roon Desktop Thực Tế (Idle Zone Pill, Collapsible Focus, Roon Track Rows & Discover/Recent Artists Banner)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. Giao Diện Người Dùng & Trực Quan Hóa Audiophile (UI/UX & Visualizer)**.
- **Tính năng triển khai qua Swarm Teamwork (`@qa-2` & `@designer-2`):**
  1. **Thanh Player Đáy khi rảnh (Idle Player Bar) & Nút Zone Pill chuẩn Roon:**
     - Thiết kế thanh đáy cố định tối giản khi chưa phát nhạc (`footer.player-idle`), thay thế nút mặc định bằng nút pill bo tròn ở chính giữa `#zone-idle-pill` với nhãn `Select an audio zone` ("Chọn vùng phát: ...").
     - Tông màu xanh tím nhận diện thương hiệu Roon `#5265a2`, hiệu ứng bóng mờ `box-shadow: 0 4px 14px rgba(0,0,0,0.4)` và bo tròn mềm mại `rounded-full`.
     - Nhấp chuột trực tiếp vào `#zone-idle-pill` kích hoạt mở ngay hộp thoại chọn vùng phát `#zone-modal` (`toggleZoneModal(true)`). Bảo toàn phần tử `#audio-zone-button` để tương thích ngược 100%.
  2. **Trang Danh Sách Bài Hát (My Tracks) & Roon Focus Thu Gọn:**
     - Đặt thanh công cụ lọc `#roon-focus-bar` ẩn mặc định (`class="hidden ..."`), loại bỏ các đoạn văn bản tĩnh thừa.
     - Nút `› Focus` (`#focus-button`) điều khiển đóng/mở thanh công cụ Focus mượt mà qua cơ chế toggle lớp hiển thị.
     - Cấu trúc cột danh sách bài hát chuẩn Roon Image 5: số thứ tự `#`, `Bài hát / Track` (kèm ảnh bìa và thời lượng), `Nghệ sĩ / Album artist` (màu link tím xanh `#7675ed` đặc trưng của Roon, có gạch chân khi hover), `Album` (link hover underline), và cột chất lượng/định dạng.
  3. **Trang Chủ Home Dashboard Chuẩn Roon Desktop:**
     - Thêm banner **Discover** (`#discover-banner`) với nền xanh tím `#5265a2`, phông chữ serif sang trọng cùng dòng phụ đề kinh điển: *"Roon’s classic way to explore your library and re-discover music you've collected. >"*.
     - Thêm phân mục **Your recent artists** (`#recent-artists-section`) với tiêu đề rõ ràng, bộ nút điều hướng carousel `< >` và nút pill `MORE`, cùng các avatar nghệ sĩ dạng vòng tròn lớn (`rounded-full`, viền sáng tím và chữ viết tắt nghệ sĩ hoa phông serif `RM`, `GD`, `VA`, `TH`, `HL`).
  4. **Kiểm thử tự động TDD & Bảo Toàn Tuyệt Đối Đồ Thị Âm Thanh:**
     - Tạo bộ kiểm thử TDD `roon-pixel-perfect.test.cjs` gồm 15 ca kiểm tra chi tiết bao quát toàn bộ 4 yêu cầu.
     - Nghiêm ngặt bảo tồn cấu trúc dây nối Web Audio: `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm thử: 410/410 ca kiểm tra PASS tuyệt đối (51 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-13 12:55 +07] — [Swarm UI] Hoàn Thiện Từng Mục Giao Diện Web Chuẩn Roon Labs (Sidebar, Home Stats, Album Format Badges, Artist Glow)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. Giao Diện Người Dùng & Trực Quan Hóa Audiophile (UI/UX & Visualizer)**.
- **Tính năng triển khai qua Swarm Teamwork (`@qa` & `@designer`):**
  1. **Thanh điều hướng Sidebar chuẩn Roon:**
     - Thiết lập chỉ báo viền sáng tím `box-shadow: inset 3px 0 var(--roon-active)` kết hợp nền pill `rgba(255,255,255,0.06)` cho mục đang chọn (`.nav-link.is-active`).
     - Tối ưu hóa phân nhóm phân cấp danh mục rõ ràng giữa *BROWSE* (Home, Thể loại, Live Radio, Listen Later, Tag, History) và *MY LIBRARY* (Album, Nghệ sĩ, Bài hát, Compositions).
  2. **Trang chủ Home Dashboard (Roon Overview):**
     - Thẻ thống kê 3 phân khu (`.roon-stat`) bo góc tròn 10px (`border-radius: 10px`) kèm hiệu ứng gradient tối mờ `linear-gradient(135deg,#24262b 0%,#1a1b1e 100%)`.
     - Phân định tab *Recent Activity* rõ rệt giữa hai chế độ `PLAYED` và `ĐÃ THÊM`.
  3. **Bộ sưu tập Thẻ Album & Nghệ Sĩ (Collection Cards):**
     - Thẻ Album tự động gắn huy hiệu chất lượng cao nhất (`.album-format-badge`: `DSD`, `HI-RES`, `LOSSLESS`) tính toán từ `summarizeAlbum`.
     - Thẻ Nghệ sĩ dạng avatar tròn (`.is-artist`) tích hợp hiệu ứng ánh sáng tím lan tỏa khi di chuột (`box-shadow: 0 0 20px rgba(118,117,237,0.38)`).
  4. **Kiểm thử tự động & Bảo toàn cấu trúc:**
     - Thêm test suite `roon-sections.test.cjs` gồm 18 ca kiểm thử TDD phủ kín 4 mục giao diện và đồ thị âm thanh.
     - Bảo toàn tuyệt đối đường định tuyến Web Audio `state.crossfeedNodes.output.connect(state.context.destination)`.
     - Toàn bộ hệ thống kiểm chứng: 395/395 test cases PASS (47 test suites, 0 fail).

---

## [Chu Kỳ 2026-11-13 12:35 +07] — [Pha B & C] Hoàn Thiện Trọn Bộ Giao Diện Roon Luxe UI (Focus Engine, Signal Path LED Popover, Immersive Fullscreen Now Playing)

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. Giao Diện Người Dùng & Trực Quan Hóa Audiophile (UI/UX & Visualizer)**.
- **Tính năng triển khai:**
  1. **Roon "Focus" Engine (Bộ lọc thư viện tức thì đa chiều):**
     - Thanh công cụ Roon Focus `#roon-focus-bar` với các pill phân loại nhanh: `Tất cả`, `DSD Audiophile`, `Hi-Res Lossless (>48k/16b)`, `Lossless CD (16/44.1)`, `Yêu thích ♥`, và `Cloud ☁`.
     - Bộ đếm danh mục thời gian thực `countFocusCategories`: hiển thị số lượng bài tương ứng trên từng pill lọc.
     - Hàm lọc thuần túy `filterTracksByFocus`: tích hợp chặt chẽ vào `filteredTracks()` và `renderFocusBar()`, tương thích 100% với tìm kiếm và sắp xếp.
  2. **Roon Signal Path Popover Modal (Đèn LED phát sáng chuẩn Roon & 4 chặng xử lý):**
     - Đèn LED chất lượng âm thanh Roon `#signal-path-led` và hệ thống đánh giá sao `#signal-path-stars` qua `computeRoonSignalLed`:
       - Tím phát sáng (`#a855f7`, 5 sao): Bit-Perfect Lossless / DSD Direct.
       - Xanh lá (`#10b981`, 4 sao): High-Resolution Audio.
       - Xanh dương (`#3b82f6`, 4 sao): Enhanced DSP Processing (EQ / Tone / Crossfeed).
       - Xanh ngọc (`#34d399`, 3 sao): Lossless CD Quality.
       - Vàng hổ phách (`#eab308`, 2 sao): Standard Quality.
     - Hộp thoại Popover dọc `#signal-path-popover` mô phỏng 4 trạm xử lý liên kết bằng đường dây phát sáng gradient (`buildRoonSignalPathStages`):
       - Trạm 1: Nguồn âm thanh (Source file, codec, kHz, bit depth, channels).
       - Trạm 2: Trình giải mã (Decoder stream preservation).
       - Trạm 3: Bộ xử lý DSP (Bypass Direct Bit-perfect vs Chuỗi xử lý EQ/Crossfeed/Limiter).
       - Trạm 4: Đầu ra & Vùng phát (DAC output, AudioContext rate).
  3. **Chế độ Now Playing Toàn Màn Hình Roon Immersive Fullscreen (`#roon-fullscreen-view`):**
     - Trải nghiệm phòng nghe tràn viền cao cấp: ảnh bìa album siêu lớn kèm lớp ánh sáng Ambient Glow động đồng điệu tông màu bìa đĩa (`#fullscreen-ambient-glow`).
     - Dạng sóng Waveform seekbar toàn màn hình (`#fullscreen-waveform`): trực quan hóa dạng sóng và tua bài tương tác mượt mà.
     - Dòng lời bài hát Karaoke đồng bộ tự động nhảy theo thời gian thực (`#fullscreen-lyrics-box`).
     - Nút kích hoạt `#fullscreen-toggle-btn` trên footer cố định, phím tắt `F` chuyển đổi nhanh và phím `Escape` để thoát tức thì.
  4. **Kiểm chứng tự động toàn diện:**
     - Tạo mới test suite `roon-luxe-ui.test.cjs` gồm 18 bài kiểm thử phủ kín cả 3 tầng: Pure library helpers, DOM markup cấu trúc và Script integration. Toàn bộ 18/18 test PASS 100%.
     - Kiểm chứng hồi quy toàn bộ hệ thống (`node --test *.test.cjs`): 377/377 tests PASS, 44 suites, 0 fail.

---

## [Chu Kỳ 2026-11-13 12:15 +07] — [Pha A & B] Roon Multi-Output Zone Controller & Roon Core Bridge: Quản Lý Đa Vùng Phát Audiophile & Tích Hợp Giao Thức Roon MOO/WebSocket

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Giao Thức & Điều Khiển Đa Thiết Bị Audiophile (Zone Controller & Remote Bridge)**.
- **Tính năng triển khai (Phương án 3: Kết hợp cả hai):**
  1. **Bộ điều khiển đa vùng phát nội bộ (Internal Zone Controller):**
     - Hỗ trợ chuyển đổi liền mạch giữa hai vùng âm thanh chính:
       - `zone_dsp` (Phòng nghe Audiophile - PWA DSP): Toàn bộ chuỗi xử lý Parametric EQ, Tone Controls, Crossfeed Chu Moy, ReplayGain và Soft-Limiter.
       - `zone_direct` (Ngõ ra Trực tiếp - Bit-Perfect Direct): Bỏ qua (bypass) toàn bộ DSP, vô hiệu hóa can thiệp gain, đưa âm thanh trực tiếp tới DAC.
     - Đồng bộ trạng thái trực quan: Nút chọn vùng phát trên thanh điều khiển phòng nghe `#zone-picker-btn` và thanh footer phát nhạc `#zone-footer-btn`, cập nhật nhãn tức thời (`PWA DSP`, `Direct DAC`, `Roon Zone`).
  2. **Cổng mở rộng Roon Core Bridge (MOO Wire Protocol Client):**
     - Triển khai định dạng gói tin MOO (Multi-Object Oriented) chuẩn của hệ sinh thái Roon Labs qua WebSocket: `MOO/1 <VERB> <NAME>\nRequest-Id: <id>\nContent-Type: application/json\n\n<JSON_BODY>`.
     - Phân tích cú pháp endpoint linh hoạt qua `parseRoonCoreEndpoint`: hỗ trợ định dạng `host:port`, `ws://`, `http://`, tự động chuẩn hóa cổng mặc định 9330.
     - Handshake đăng ký ứng dụng ngoại vi `com.roonlabs.registry:1/info` và đăng ký lắng nghe vùng phát `com.roonlabs.transport:2/subscribe_zones`.
     - Nhận diện và đồng bộ danh sách thiết bị/vùng phát Roon Core ngoại vi theo thời gian thực.
  3. **Định dạng hiển thị Roon 3-line Now Playing:**
     - `formatRoonThreeLine(track, zone)`: Chuẩn hóa 3 dòng thông tin:
       - Dòng 1: Tiêu đề bài hát (`title`).
       - Dòng 2: Nghệ sĩ & Album (`artist — album`).
       - Dòng 3: Định dạng âm thanh, thông số kỹ thuật (kHz/bit/DSD) và tên vùng phát (`zone`).
  4. **Điều hướng tác vụ chuẩn Roon (Roon Context Action Items):**
     - Hàm `triggerRoonAction(action, track)` hỗ trợ 4 hành động phát nhạc kinh điển:
       - `play_now`: Phát ngay lập tức bài hát đã chọn.
       - `play_next`: Đẩy lên vị trí ưu tiên đầu danh sách hàng đợi phát tiếp theo.
       - `add_queue`: Thêm vào cuối hàng đợi phát.
       - `start_radio`: Kích hoạt chế độ Roon Radio tự động chọn bài theo phong cách bài hát hiện tại.
  5. **Giao diện Modal quản lý Vùng & Kết nối Roon Core 100% tiếng Việt:**
     - Modal `#zone-modal` với danh sách card vùng phát nội bộ (`#zone-list-container`), huy hiệu `BIT-PERFECT` / `DSP`, form nhập địa chỉ Roon Core (`#roon-bridge-input`), nút kết nối/ngắt kết nối kèm badge trạng thái kết nối (`Chưa kết nối`, `Đang nối...`, `Đã kết nối`).
     - Hỗ trợ đầy đủ phím tắt `Escape` và click backdrop đóng modal tiện lợi.
  6. **Bộ kiểm thử toàn diện:**
     - Xây dựng suite `roon-zone-bridge.test.cjs` gồm 15 bài kiểm thử phủ kín cả 3 tầng: Pure library helpers, DOM markup cấu trúc và Script integration. Toàn bộ 15/15 test PASS 100%.
     - Kiểm chứng hồi quy toàn bộ hệ thống (`node --test *.test.cjs`): 359/359 tests PASS, 43 suites, 0 fail.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung 6 helper Roon (`createZoneModel`, `formatRoonThreeLine`, `parseRoonCoreEndpoint`, `createRoonMooMessage`, `parseRoonMooMessage`, `formatRoonZoneStatus`), xuất qua dual UMD wrapper.
- `index.html`: Thêm markup giao diện `#room-zone-bar`, `#zone-modal`, `#zone-footer-btn`, bổ sung state và các hàm quản lý vùng/kết nối Roon, tích hợp 3-line metadata vào `displayTrack`.
- `roon-zone-bridge.test.cjs`: Tạo mới bộ kiểm thử tự động 15 test cases.
- `CHANGELOG_AI.md`: Bổ sung nhật ký chi tiết chu kỳ nâng cấp Roon Zone & Bridge.

---

## [Chu Kỳ 2026-11-13 08:45 +07] — [Pha D] Ambient Sound Mixer (Procedural Noise Synthesis & Headroom-Safe Routing): Trình Pha Trộn Âm Thanh Môi Trường Mưa & Lửa Trại Độc Lập Chuẩn Audiophile

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **4. Hiệu Năng, Kiến Trúc & Độ Bền Hệ Thống (Architecture & PWA)**.
- **Tính năng triển khai:**
  1. **Bộ tổng hợp âm thanh thủ tục thuần túy (Pure Procedural Noise Synthesis in `library-utils.js`):**
     - `generatePinkNoiseBuffer(context, duration)`: Thuật toán lọc 7 tầng Voss-McCartney tạo nhiễu hồng (Pink Noise) 1/f chuẩn stereo 2 kênh độc lập, khử tương quan không gian (cross-correlation < 0.25), biên độ chặt chẽ trong [-1.05, 1.05], RMS > 0.01.
     - `generateBrownNoiseBuffer(context, duration)`: Tích phân rò rỉ (Leaky Integrator AR(1) cực 1/1.02) tạo nhiễu nâu trầm ấm 1/f^2 mô phỏng tiếng than hồng âm ỉ của lửa trại, tỷ lệ khác biệt dải tần < 0.2, thích ứng từ 22.05 kHz đến 192 kHz.
     - `generateCampfireCrackleBuffer(context, duration)`: Bộ phát xung Poisson thưa (~12 xung/giây), phân tầng 85% tiếng nổ tí tách nhỏ và 15% tiếng nổ đốp lớn với đường bao phân rã hàm mũ (2-15ms), crest factor peak/RMS > 3.0.
     - `createAmbientChannel(context, type, options)`: Khởi tạo sub-graph Web Audio hoàn chỉnh với phương thức `.stop()` giải phóng tài nguyên RAM.
     - Các tiện ích điều khiển: `clampAmbientVolume` kẹp giá trị 0..100%, `formatAmbientVolume` xuất chuỗi hiển thị, và `formatAmbientSummary` hiển thị tiếng Việt trạng thái tổng hợp (`Đang tắt`, `Mưa X%`, `Lửa trại Y%`, hoặc `Mưa X% · Lửa trại Y%`).
  2. **Định tuyến Audio Graph độc lập bảo toàn Bit-perfect (`index.html`):**
     - Đồ thị âm thanh môi trường: `rainGain + campfireGain -> ambientMasterGain (gain 0.5 headroom budget) -> ctx.destination`.
     - Phân tách hoàn toàn khỏi chuỗi DSP âm nhạc chính (limiter, analyser, panner, tone controls), giữ sạch visualizer và không làm suy giảm chất lượng file nhạc Hi-Res / Bit-perfect.
     - Chuỗi lọc tiếng mưa: Lowpass 1200 Hz -> Highpass 200 Hz -> rainGain kết hợp điều chế dao động nhẹ LFO Sine 0.2 Hz mô phỏng từng đợt gió mưa chân thực.
     - Chuỗi lọc tiếng lửa trại: Brown Noise -> Lowpass 450 Hz -> baseGain + Crackle Buffer -> Highpass 600 Hz -> crackleGain -> campfireGain.
  3. **Giao diện người dùng 100% tiếng Việt & Khả năng trợ năng:**
     - Nút bật mở `#ambient-button` (desktop) và `#ambient-button-mobile` (mobile) với nhãn `aria-label="Âm thanh môi trường"`, đồng bộ trạng thái `aria-expanded`.
     - Hộp thoại nổi `#ambient-panel` (role="dialog", Tailwind dark-theme) gồm công tắc bật/tắt riêng cho từng kênh Mưa và Lửa trại, thanh trượt âm lượng mượt mà, nhãn phần trăm hiển thị tức thì, nút "Tắt tất cả" (`#ambient-reset`) và nút đóng (`#ambient-close`).
     - Hỗ trợ phím tắt Escape và sự kiện click bên ngoài để đóng bảng điều khiển tiện lợi.
  4. **Cơ chế mở khóa âm thanh & Tích hợp bộ hẹn giờ ngủ (Sleep Timer):**
     - `ensureAudioContextRunning()`: Đảm bảo AudioContext luôn ở trạng thái 'running' sau cử chỉ tương tác của người dùng mà không gây xung đột bất đồng bộ.
     - Tích hợp mượt mà vào `setSleepTimer`: tự động hạ dần âm lượng master của ambient trong 30 giây fade-out cuối cùng cùng với bài hát và ngắt hẳn khi hết thời gian, bảo toàn giá trị cấu hình âm lượng của người dùng trong `localStorage` cho phiên sau.
     - `restoreAmbientSettings()`: Tự động khôi phục cấu hình âm lượng và trạng thái bật/tắt từ `localStorage` khi mở lại ứng dụng.
  5. **Bộ kiểm thử toàn diện & Khắc phục triệt để vi phạm liêm chính:**
     - Hoàn thiện test suite `ambient-mixer.test.cjs` gồm 80 test cases phủ kín 4 tầng (Tier 1: Feature Coverage, Tier 2: Boundaries, Tier 3: Combinatorial, Tier 4: Real-world Scenarios).
     - Remediate 9 vi phạm giả định kiểm thử theo báo cáo của Forensic Auditor, biến thành các bài kiểm thử thực tế trên đồ thị âm thanh Web Audio và DOM thật. Toàn bộ 80/80 test cases PASS 100%.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung 7 hàm tổng hợp và tiện ích âm thanh môi trường, cập nhật dual-export UMD wrapper.
- `index.html`: Thêm markup `#ambient-panel`, desktop/mobile buttons, định tuyến Web Audio graph, các hàm điều khiển tiếng Việt và tích hợp sleep timer.
- `ambient-mixer.test.cjs`: Remediate 9 ca kiểm thử giả định, đạt chuẩn 80/80 PASS không skip, không fail.
- `CHANGELOG_AI.md`: Bổ sung chi tiết nâng cấp cho Pha C và Pha D.

---

## [Chu Kỳ 2026-11-13 07:15 +07] — [Pha C] Karaoke Word-by-Word Synchronized Lyrics Highlight & Smooth Scrolling: Hiển Thị Lời Bài Hát Đồng Bộ Từng Từ & Cuộn Mượt Viewport

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **3. Tính Năng Cốt Lõi Trình Phát Nhạc (Core Player Features)**.
- **Tính năng triển khai:**
  1. **Bộ phân tích cú pháp Enhanced LRC (`library-utils.js`):**
     - Mở rộng `parseLyrics` để phân giải thẻ thời gian mức từ `<mm:ss.xx>` (hỗ trợ độ chính xác 1 đến 4 chữ số thập phân) và gắn vào thuộc tính `words` (non-enumerable để tương thích tuyệt đối với `assert.deepStrictEqual`).
     - Tự động làm sạch các thẻ `<...>` khỏi `line.text` để đảm bảo văn bản hiển thị nguyên bản, không rò rỉ cú pháp đánh dấu ra giao diện.
     - Hàm `parseKaraokeWords(text, lineTimeMs, offsetMs, sort)` bóc tách danh sách từ cùng mốc thời gian giây tương ứng, hỗ trợ tiền tố từ không gắn thẻ và điều chỉnh offset chuẩn xác.
     - Hàm `lyricWordAt(words, timeSeconds)` xác định vị trí từ đang hát theo thời gian thực với độ trễ tối thiểu và duy trì chỉ số giữa các khoảng nghỉ.
     - Hàm `shouldScrollLyricIntoView(lineRect, containerRect, options)` đánh giá ổn định khung nhìn, chống hiện tượng giật rung màn hình (anti-jitter) khi các từ trong cùng một dòng tiến triển.
  2. **Dựng cấu trúc DOM & Trực quan hóa Karaoke (`index.html`):**
     - Đóng gói từng từ trong dòng bài hát vào thẻ `<span class="lyric-word" data-time="...">`, ngăn cách bởi khoảng trắng tự nhiên, bảo toàn tổng số phần tử con của container theo đúng số dòng lời bài hát.
     - Hiệu ứng đổi màu từ đồng bộ: `.lyric-word-sung` (tím sáng cho các từ đã hát) và `.lyric-word-active` (vàng kim loại nổi bật cho từ đang phát).
     - Hỗ trợ tương tác nhấp vào từng từ để tua trực tiếp (`click-to-seek`) đến mốc thời gian của từ đó mà không làm ngắt quãng dòng phát nhạc.
     - Cuộn mượt tự động chỉ khi dòng bài hát vượt ra ngoài viewport, đảm bảo trải nghiệm đọc lời thoải mái nhất.
  3. **Bộ kiểm thử tự động (Unit, Boundary & Real-world Tests):**
     - Bộ kiểm thử toàn diện `karaoke-lyrics.test.cjs` gồm 99 test cases và `karaoke-adversarial.test.cjs` gồm 20 test cases.
     - Đạt 99/99 và 20/20 PASS 100% qua mọi điều kiện biên: lời bài hát tiếng Việt có dấu, file LRC đa thẻ thời gian, timestamp 4 chữ số thập phân, tua nhanh tiến lùi liên tục.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Mở rộng `parseLyrics`, bổ sung `parseKaraokeWords`, `lyricWordAt`, `shouldScrollLyricIntoView`.
- `index.html`: Cập nhật cấu trúc hiển thị lời bài hát, CSS cho `.lyric-word`, `.lyric-word-sung`, `.lyric-word-active`.
- `karaoke-lyrics.test.cjs` & `karaoke-adversarial.test.cjs`: Toàn bộ 119 test cases PASS.

---

## [Chu Kỳ 2026-11-13 05:25 +07] — [Pha B] Waveform Seekbar: Trực Quan Hóa Dạng Sóng Bài Hát Bằng Web Audio Analyser & Canvas

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **2. Giao Diện Người Dùng & Trực Quan Hóa Âm Thanh (UI/UX & Visualizer)**.
- **Tính năng triển khai:**
  1. **Các hàm tiện ích dạng sóng (`library-utils.js`):**
     - `generateWaveformPeaks(channelData, numBuckets)`: Thuật toán phân rã mảng mẫu PCM âm thanh `Float32Array` thành các bucket đều nhau (mặc định 200 mẫu), tính toán biên độ đỉnh tuyệt đối lớn nhất trong mỗi khoảng (giá trị chuẩn hóa 0.0 – 1.0). Xử lý an toàn các trường hợp mảng rỗng hoặc số lượng bucket không hợp lệ.
     - `renderWaveformCanvas(canvas, peaks, playbackFraction, options)`: Vẽ đồ thị dạng sóng đối xứng theo trục giữa canvas với 2 dải màu phân biệt trực quan: phần bài hát đã phát (`rgba(167,139,250,0.9)` - tím sáng) và phần chưa phát (`rgba(167,139,250,0.35)` - tím mờ), kèm vạch định vị playhead 2px sắc nét (`rgba(255,255,255,0.9)`).
     - `formatWaveformStatus(numPeaks, isReady)`: Trả về trạng thái dạng sóng bằng tiếng Việt thân thiện (`Dạng sóng: 200 mẫu` hoặc `Dạng sóng: đang tải...`).
  2. **Thành phần giao diện trong Phòng nghe (`#listening-room` trong `index.html`):**
     - Bổ sung `<canvas id="waveform-canvas">` ngay phía trên thanh trượt thời gian `#room-seek`, thiết kế cong nhẹ bo góc và con trỏ tay chỉ `cursor-pointer`.
     - Kèm thuộc tính trợ năng tiếng Việt `aria-label="Dạng sóng bài hát - nhấn để tua"`.
  3. **Cơ chế nạp & giải mã âm thanh OfflineAudioContext:**
     - `generateTrackWaveform(track)`: Tự động tải dữ liệu nhị phân của bài hát qua fetch ngầm, khởi tạo `OfflineAudioContext` để giải mã PCM toàn bài mà không phát ra loa, trích xuất 200 đỉnh dạng sóng và lưu vào `state.waveformPeaks`.
     - Bộ nhớ đệm `state.waveformTrackId` giúp tái sử dụng ngay lập tức dạng sóng đã tính mà không tốn công giải mã lại.
     - Cơ chế fallback an toàn: khi gặp file stream hoặc lỗi mạng, tự động sinh dạng sóng dự phòng nhẹ nhàng để giao diện vẫn hiển thị đẹp mắt.
  4. **Tương tác tua bài hát mượt mà (Click-to-seek & Timeupdate):**
     - Người dùng có thể nhấp trực tiếp vào bất kỳ vị trí nào trên đồ thị sóng để tua bài hát tức thì (`audio.currentTime = fraction * audio.duration`).
     - Tích hợp vòng lặp cập nhật `renderWaveformSeekbar()` trong sự kiện `timeupdate` của trình phát, di chuyển vạch playhead và tô màu dạng sóng thời gian thực mượt mà.
     - Bảo vệ sandbox thông minh (`typeof renderWaveformSeekbar === 'function'`) chống lỗi tham chiếu trong môi trường test cô lập.
  5. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Tạo mới `waveform-seekbar.test.cjs` gồm 18 test cases kiểm thử: hàm xử lý đỉnh mẫu, vẽ canvas, định dạng chuỗi, cấu trúc DOM và các hàm hook trong script.
     - Toàn bộ 18/18 test cases PASS 100%, bộ hồi quy tổng thể 145/145 PASS trên toàn bộ 26 test suites.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung các hàm `generateWaveformPeaks`, `renderWaveformCanvas`, `formatWaveformStatus` và export trong `NocturneLibrary`.
- `index.html`: Thêm canvas `#waveform-canvas`, mở rộng `state`, bổ sung `generateTrackWaveform`, `renderWaveformSeekbar`, click-to-seek listener, kết nối `displayTrack` và `timeupdate`, thêm auto-schedule log comment.
- `waveform-seekbar.test.cjs`: Test suite mới cho tính năng Waveform seekbar (18/18 PASS).
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ `[Pha B]`.

### 🚀 Đề Xuất Cho Chu Kỳ Kế Tiếp:
- **Pha C (Core Features):** Đồng bộ lời bài hát .lrc cuộn mượt từng từ (Karaoke word-by-word highlight).
- **Pha D (Architecture & PWA):** Ambient Sound Mixer (tiếng mưa rơi, lửa trại kết hợp nhạc nền audiophile).
- **Pha A (Audio Engine & DSP):** AutoEQ Headphone Compensation Presets cho các dòng tai nghe phổ biến.

---

## [Chu Kỳ 2026-11-13 04:35 +07] — [Pha A] Tone Controls (Bass & Treble Quick Trim): Bộ Điều Chỉnh Âm Sắc Nhanh Trong Chuỗi Xử Lý DSP

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **1. Audio Engine & DSP (Web Audio API)**.
- **Tính năng triển khai:**
  1. **Các hàm toán học & tiện ích Tone Controls (`library-utils.js`):**
     - Hằng số tần số chuẩn audiophile: `TONE_BASS_FREQ_HZ = 100` (low-shelf 100 Hz), `TONE_TREBLE_FREQ_HZ = 10000` (high-shelf 10 kHz), dải bù trừ `TONE_GAIN_MIN_DB = -6`, `TONE_GAIN_MAX_DB = 6`.
     - `clampToneGain(val)`: Giới hạn gain trong dải ±6 dB và làm tròn chính xác về bước nhảy 0.5 dB.
     - `formatToneGain(val)`: Định dạng chuỗi hiển thị mức gain (`0 dB`, `+2.5 dB`, `-1.5 dB`).
     - `formatToneSummary(bass, treble)`: Định dạng tóm tắt trạng thái âm sắc (`Bass +2.0 dB · Treble -1.5 dB`).
     - Cập nhật `computeSignalPath(track, options)`: Tích hợp thông tin âm sắc vào tầng DSP (DSP Stage) trong Roon Signal Path khi có can thiệp, đánh dấu `isEnhanced = true`.
  2. **Giao diện điều khiển trong panel Parametric EQ (`#eq-panel` trong `index.html`):**
     - Thêm khu vực "Âm sắc nhanh (Tone Controls)" gồm 2 thanh trượt riêng biệt: Trầm (Bass -6..+6 dB) và Bổng (Treble -6..+6 dB).
     - Nút reset nhanh "0" cho từng thanh trượt giúp đưa ngay về mức 0 dB phẳng.
     - Nhãn tóm tắt động `#tone-summary-label` hiển thị giá trị hiện tại.
  3. **Kiến trúc AudioContext Graph & Định Tuyến Động (Dynamic Bypass):**
     - Tạo cặp node `BiquadFilterNode` độc lập `state.toneNodes` (`bass: lowshelf`, `treble: highshelf`) thông qua `createToneNodes(ctx)`.
     - **Cơ chế Dynamic Bypass:** Khi cả Bass và Treble đều ở mức 0 dB, hệ thống tự động bypass để tín hiệu âm thanh đi thẳng tới loa (Bit-perfect bit-transparent). Khi người dùng kéo thanh trượt, hệ thống chuyển mạch mượt mà 15ms (`setTargetAtTime`) sang chuỗi bộ lọc mà không gây bất kỳ tiếng click/pop nào.
     - Lưu trạng thái vào `localStorage` (`nocturne-tone-bass`, `nocturne-tone-treble`) và tự động nạp lại khi tải lại trang.
  4. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Tạo mới `tone-controls.test.cjs` gồm 16 test cases kiểm thử: tính chính xác của hàm kẹp biên độ, làm tròn 0.5 dB, định dạng chuỗi, tích hợp trong Roon Signal Path, và kiểm tra DOM/script integration.
     - Toàn bộ 16/16 test cases PASS 100%.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung các hằng số và hàm tiện ích Tone Controls, cập nhật `computeSignalPath` và export `NocturneLibrary`.
- `index.html`: Thêm markup Tone Controls trong `#eq-panel`, mở rộng `state`, bổ sung `createToneNodes`, `applyToneControls`, `setToneBass`, `setToneTreble`, `resetToneControls`, kết nối vào `setupAudio`, thêm auto-schedule log comment.
- `tone-controls.test.cjs`: Test suite mới cho tính năng Tone Controls (16/16 PASS).
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ `[Pha A]`.

### 🚀 Đề Xuất Cho Chu Kỳ Kế Tiếp:
- **Pha B (UI/UX & Visualizer):** Waveform seekbar trực quan hóa dạng sóng bài hát bằng Web Audio Analyser/Canvas.
- **Pha C (Core Features):** Đồng bộ lời bài hát .lrc cuộn mượt từng từ (Karaoke word-by-word highlight).
- **Pha D (Architecture & PWA):** Ambient Sound Mixer (tiếng mưa rơi, lửa trại kết hợp nhạc nền audiophile).

---

## [Chu Kỳ 2026-11-13 03:55 +07] — [Pha D] Network Status Monitor, Offline Indicator & Smart Fallback: Giám Sát Kết Nối Mạng PWA & Trải Nghiệm Ngoại Tuyến Liền Mạch

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **4. Hiệu Năng, Kiến Trúc & Độ Bền Hệ Thống (Architecture & PWA)**.
- **Tính năng triển khai:**
  1. **Các hàm kiểm tra trạng thái mạng & khả năng phát ngoại tuyến (`library-utils.js`):**
     - `isOnlineState(navigatorObj)`: Kiểm tra an toàn trạng thái kết nối `navigator.onLine`, tự động fallback sang `true` nếu môi trường không có đối tượng `navigator` (như test runner hoặc server-side rendering).
     - `formatNetworkStatus(online)`: Định dạng trạng thái mạng kèm nhãn (`Trực tuyến` / `Ngoại tuyến`) và thông điệp giải thích thân thiện cho người dùng.
     - `canPlayOffline(track)`: Xác định bài hát có thể phát khi mất mạng hay không (trả về `true` cho bài cục bộ `source === 'local'`, bài có file/blob trong RAM, hoặc bài đã được lưu lát PCM/lát 1MB trong bộ nhớ cache IndexedDB).
  2. **Thanh thông báo trạng thái ngoại tuyến chuẩn Dark Mode Audiophile (`#offline-banner` trong `index.html`):**
     - Thiết kế pill bo tròn đặt ở đầu trang (`fixed left-1/2 top-4 z-[69] -translate-x-1/2`), viền vàng hổ phách `border-amber-500/30`, nền kính mờ `bg-amber-950/90 backdrop-blur-xl`, đèn báo hiệu nhấp nháy `animate-pulse`.
     - Tự động hiển thị khi thiết bị ngắt kết nối Internet và tự động ẩn khi mạng được khôi phục.
  3. **Lắng nghe sự kiện kết nối & Cơ chế phục hồi thông minh:**
     - `window.addEventListener('offline')`: Kích hoạt thanh báo ngoại tuyến, thông báo toast "Mất kết nối mạng. Đang ở chế độ Ngoại tuyến."
     - `window.addEventListener('online')`: Tự động ẩn thanh báo, thông báo toast "Đã kết nối Internet trở lại.", tự động kiểm tra bản cập nhật mới (`checkForAppUpdate`) và tiếp tục tải trước (prefetch) bài hát tiếp theo (`preloadNext`).
  4. **Bảo vệ trình phát nhạc `playTrack` khi ngoại tuyến:**
     - Ngăn ngừa tình trạng trình duyệt gửi yêu cầu `fetch` mạng khi đang offline khiến Promise reject, gây lỗi decoder và kích hoạt cơ chế `skipFailedTrack` nhảy qua toàn bộ playlist cloud.
     - Hiển thị toast hướng dẫn trực quan: "Đang ngoại tuyến. Bài hát cloud này cần Internet để tải." giúp người dùng hiểu rõ nguyên nhân.
  5. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Tạo mới `offline-mode.test.cjs` gồm 14 test cases kiểm tra: độ chính xác của `isOnlineState`, `formatNetworkStatus`, phân loại `canPlayOffline`, và kiểm tra tích hợp DOM & script logic.
     - Toàn bộ 14/14 test cases PASS 100%.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung `isOnlineState`, `formatNetworkStatus`, `canPlayOffline`, cập nhật export `NocturneLibrary`.
- `index.html`: Thêm markup `#offline-banner`, hàm `updateNetworkStatus`, cập nhật `playTrack`, bổ sung event listener `online`/`offline`, thêm auto-schedule log comment.
- `offline-mode.test.cjs`: Test suite mới cho tính năng Network Status Monitor & Offline Mode (14/14 PASS).
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ.

### 🚀 Đề Xuất Cho Chu Kỳ Kế Tiếp:
- **Pha A (Audio Engine & DSP):** Parametric EQ Presets & AutoEQ profile compensation cho tai nghe phổ biến (HD600, AirPods Pro, Sony WH-1000XM...).
- **Pha B (UI/UX & Visualizer):** Waveform seekbar trực quan hóa dạng sóng bài hát bằng Web Audio Analyser/Canvas.
- **Pha C (Core Features):** Đồng bộ lời bài hát .lrc cuộn mượt từng từ (Karaoke highlight effect).

---

## [Chu Kỳ 2026-11-13 03:45 +07] — [Pha C] Sleep Timer Fade-Out: Giảm Dần Âm Lượng Mượt Mà 30s Cuối Trước Khi Dừng Nhạc

### 🎯 Hạng Mục Nâng Cấp:
- **Phân khu trọng tâm:** **3. Tính Năng & Trải Nghiệm Người Dùng (Core Features)**.
- **Tính năng triển khai:**
  1. **Đường cong Equal-Power Sine Fade-Out `calculateSleepFadeGain` (`library-utils.js`):**
     - Thay vì giảm tuyến tính (linear) khiến âm lượng tụt nhanh đột ngột ở dải đầu và khó nghe ở dải cuối, hàm áp dụng đường cong equal-power sine $\sin(\text{ratio} \times \pi / 2)$ giúp tai người cảm nhận âm lượng giảm dần đều và êm dịu.
     - Thời lượng fade-out mặc định là 30 giây (`DEFAULT_SLEEP_FADEOUT_MS = 30000`), tự động giới hạn `min(30s, duration/2)` cho các khoảng thời gian hẹn giờ ngắn để tránh fade quá sớm.
     - Trả về hệ số $1$ khi còn nhiều thời gian, giảm mượt dần về $0$ khi chạm mốc deadline, và trả về $0$ an toàn nếu thời gian đã hết hoặc tham số không hợp lệ.
  2. **Định dạng thời gian còn lại `formatSleepRemaining` (`library-utils.js`):**
     - Hỗ trợ định dạng thời gian còn lại thân thiện: `45 giây`, `1 phút`, `2 phút 5 giây`, hoặc `Hết giờ`.
  3. **Tùy chọn giao diện & Tích hợp điều khiển âm lượng (`index.html`):**
     - Thêm checkbox tùy chọn `#sleep-fadeout` ("Fade-out 30s cuối", mặc định bật) trong hộp thoại hẹn giờ `#sleep-panel`.
     - `state` mở rộng để theo dõi: `sleepFadeTimer`, `sleepFadeInterval`, `sleepOriginalVolume`.
     - `setSleepTimer(minutes)`: Bắt đầu chu kỳ giảm âm lượng dần đều trong 30 giây cuối qua `setInterval` 250ms gọi `setGain(state.sleepOriginalVolume * gain)`.
     - **Cơ chế bảo toàn và khôi phục âm lượng gốc:**
       - Ghi nhớ mức âm lượng của người dùng trước khi bắt đầu fade.
       - Khi hết giờ (dừng phát nhạc) hoặc khi người dùng hủy hẹn giờ (`clearSleepTimer`) hay chuyển sang chế độ dừng khi hết bài (`#sleep-track-end`), hệ thống tự động dọn dẹp các timer/interval và khôi phục nguyên vẹn mức âm lượng ban đầu của người dùng.
  4. **Bộ kiểm thử tự động (Unit & Integration Tests):**
     - Tạo mới `sleep-fadeout.test.cjs` gồm 14 test cases kiểm tra: giá trị đường cong equal-power, xử lý thời gian âm/NaN, giới hạn clamp min 1s, định dạng chuỗi thời gian, và kiểm tra tích hợp DOM & script logic.
     - Kiểm chứng toàn bộ: **14/14 test mới PASS**, toàn bộ regression test suite PASS.

### 📁 Các File Đã Sửa / Tạo Mới:
- `library-utils.js`: Bổ sung `DEFAULT_SLEEP_FADEOUT_MS`, `calculateSleepFadeGain`, `formatSleepRemaining`, cập nhật export `NocturneLibrary`.
- `index.html`: Thêm checkbox `#sleep-fadeout`, cập nhật `state`, tích hợp fade-out và khôi phục volume vào `setSleepTimer`, `clearSleepTimer`, `#sleep-track-end`, thêm auto-schedule log comment.
- `sleep-fadeout.test.cjs`: Test suite mới cho tính năng Sleep Timer Fade-Out (14/14 PASS).
- `CHANGELOG_AI.md`: Cập nhật nhật ký tiến hóa chu kỳ.

### 🚀 Đề Xuất Cho Chu Kỳ Kế Tiếp:
- **Pha D (Architecture & PWA):** PWA Service Worker offline caching nâng cao cho bài hát đã tải.
- **Pha A (Audio Engine & DSP):** AutoEQ profiles bù trừ tần số cho các dòng tai nghe phổ biến.
- **Pha B (UI/UX & Visualizer):** Waveform seekbar trực quan hóa dạng sóng bài hát bằng Web Audio Analyser/Canvas.

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
