---
description: Quy tắc tự hành vĩnh viễn và nối đuôi mỗi 30 phút cho dự án Web Nghe Nhạc Hi-Res tranbienhao1/thiennguyen
globs: "**/*"
alwaysApply: true
---

# QUY TẮC VẬN HÀNH TỰ ĐỘNG 24/7 (`tranbienhao1/thiennguyen`)

1. **Chế độ Thực Thi Không Gián Đoạn (Zero-Confirmation Autonomous Mode):**
   - Luôn tự động chạy các lệnh kiểm tra, kiểm thử Node.js (`node --check`, unit test) và đồng bộ Git (`git pull --rebase`, `git add`, `git commit`, `git push`) mà không dừng lại chờ người dùng xác nhận.
   - Sau khi hoàn thành một nhiệm vụ và push lên GitHub, **bắt buộc tự động chuyển sang nhiệm vụ kế tiếp** trong `.agent/ANTIGRAVITY_STATE.json` ngay trong cùng lượt chạy (In-Session Tail-Chaining).

2. **Chuẩn Kỹ Thuật Cốt Lõi Của Dự Án:**
   - **Audio & DSD Engine:** Hỗ trợ giải mã chính xác Lossless (`FLAC`, `WAV`, `ALAC`, `AIFF` tới 24/32-bit, 384kHz, Gapless 0ms, Cue Sheet `.cue`) và `DSD` (`.dsf` LSB-first, `.dff` MSB-first, DSD64/128/256 qua Web Worker/AudioWorklet + bộ lọc FIR khử nhiễu siêu âm). Luôn gọi `URL.revokeObjectURL` để chống rò rỉ bộ nhớ.
   - **Lyrics Engine (`lrcget` + `LRCLIB`):** Tuân thủ đặc tả `https://lrclib.net/docs` và `https://lrclib.net/lyricsfile` (LRC chuẩn, Enhanced LRC, Lyricsfile YAML 1.0, đồng bộ từng từ/từng dòng bằng tìm kiếm nhị phân `O(log N)`, xử lý `429 Retry-After` + jitter, giải PoW SHA-256 cho `/api/publish`, lưu cache `IndexedDB` theo hash 64KB đầu file + `file_size`).
   - **Cloud & Offline PWA:** Đảm bảo hoạt động mượt khi offline (`IndexedDB`, `FileSystemFileHandle`) và tự động làm mới token khi đồng bộ Google Drive OAuth 2.0 / Microsoft Entra.

3. **Cổng Kiểm Chứng 3 Tầng Trước Mọi Commit:**
   - Không bao giờ commit code chưa qua kiểm tra `node --check` (0 lỗi cú pháp) và kiểm thử logic điều kiện biên bằng Node.js. Nếu lỗi không thể khắc phục sau 2 lần thử, tự động `git checkout -- .` để bảo vệ nhánh chính.
