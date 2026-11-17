#!/usr/bin/env node
/**
 * Antigravity 30-Minute Continuous Watchdog & Codebase Auditor
 * Repo: https://github.com/tranbienhao1/thiennguyen
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = process.cwd();
const STATE_DIR = path.join(ROOT_DIR, '.agent');
const STATE_FILE = path.join(STATE_DIR, 'ANTIGRAVITY_STATE.json');
const INTERVAL_MS = 30 * 60 * 1000; // 30 phút (1.800.000 ms)

const DEFAULT_QUEUE = [
  {
    id: 'BUG-01',
    phase: 'BUG_HUNT',
    title: 'Kiểm tra và khắc phục rò rỉ bộ nhớ ObjectURL/AudioBuffer khi chuyển bài Lossless/DSD liên tục và hủy tải bằng AbortController'
  },
  {
    id: 'UPG-01',
    phase: 'UPGRADE',
    title: 'Hoàn thiện module LRCLIB Client (GET /api/get, /api/v2/search, xử lý 429 Retry-After + jitter) và bộ đọc LRC / Lyricsfile YAML 1.0 đồng bộ từng từ bằng Binary Search'
  },
  {
    id: 'OPT-01',
    phase: 'OPTIMIZE',
    title: 'Tối ưu vòng lặp đồng bộ lời bài hát và Visualizer 60fps không cấp phát bộ nhớ dư thừa (zero-allocation) trong timeupdate/requestAnimationFrame'
  },
  {
    id: 'BUG-02',
    phase: 'BUG_HUNT',
    title: 'Kiểm tra điều kiện biên DataView khi parse header nhị phân FLAC (STREAMINFO/PICTURE), WAV (fmt/data) và DSD (.dsf LSB-first / .dff MSB-first)'
  },
  {
    id: 'UPG-02',
    phase: 'UPGRADE',
    title: 'Bổ sung cache lời bài hát và metadata vào IndexedDB bằng khóa băm SHA-256 64KB đầu file + file_size theo kiến trúc lrcget'
  },
  {
    id: 'OPT-02',
    phase: 'OPTIMIZE',
    title: 'Tối ưu tự động gia hạn Google Drive OAuth 2.0 Access Token ngầm trước khi hết hạn và cải thiện trải nghiệm phím tắt điều khiển trình phát'
  }
];

function loadOrCreateState() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(STATE_FILE)) {
    const initial = {
      repo: 'https://github.com/tranbienhao1/thiennguyen',
      cadenceMinutes: 30,
      cycleCount: 0,
      lastPhase: 'OPTIMIZE',
      lastRunIso: null,
      diagnostics: { syntaxErrors: [], warnings: [] },
      pendingQueue: DEFAULT_QUEUE,
      completedTasks: []
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function scanCodebaseHealth() {
  const syntaxErrors = [];
  const warnings = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.agent', 'android', 'build', '.gradle', '.agents'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.js')) {
        try {
          execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
        } catch (err) {
          syntaxErrors.push({
            file: path.relative(ROOT_DIR, fullPath),
            error: String(err.stderr || err.message).trim().slice(0, 300)
          });
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('createObjectURL(') && !content.includes('revokeObjectURL(')) {
          warnings.push(`${path.relative(ROOT_DIR, fullPath)}: Có sử dụng URL.createObjectURL nhưng chưa thấy URL.revokeObjectURL (nguy cơ rò rỉ RAM).`);
        }
      } else if (entry.name.endsWith('.html')) {
        const html = fs.readFileSync(fullPath, 'utf8');
        const openScripts = (html.match(/<script\b[^>]*>/gi) || []).length;
        const closeScripts = (html.match(/<\/script>/gi) || []).length;
        if (openScripts !== closeScripts) {
          syntaxErrors.push({
            file: path.relative(ROOT_DIR, fullPath),
            error: `Lệch cặp thẻ <script> (${openScripts} mở / ${closeScripts} đóng)`
          });
        }
      }
    }
  };
  walk(ROOT_DIR);
  return { syntaxErrors, warnings };
}

function runCycle() {
  const nowIso = new Date().toISOString();
  console.log(`\n[Antigravity 30m Engine] Bắt đầu chu kỳ quét & nối đuôi lúc ${nowIso}`);

  try {
    execSync('git pull --rebase origin HEAD', { stdio: 'inherit' });
  } catch (e) {
    console.warn('[Antigravity 30m Engine] Bỏ qua bước git pull (đang ở chế độ offline hoặc có thay đổi local).');
  }

  const state = loadOrCreateState();
  const health = scanCodebaseHealth();
  state.cycleCount = (state.cycleCount || 0) + 1;
  state.lastRunIso = nowIso;
  state.diagnostics = health;

  // Nếu phát hiện lỗi cú pháp hoặc cảnh báo mới, tự động đẩy lên đầu hàng đợi ưu tiên
  if (health.syntaxErrors.length > 0) {
    state.pendingQueue.unshift({
      id: `URGENT-FIX-${Date.now()}`,
      phase: 'BUG_HUNT',
      title: `Khắc phục ngay ${health.syntaxErrors.length} lỗi cú pháp phát hiện tự động trong: ${health.syntaxErrors.map(e => e.file).join(', ')}`
    });
  }
  if (state.pendingQueue.length === 0) {
    state.pendingQueue.push(...DEFAULT_QUEUE);
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  const nextTask = state.pendingQueue[0];
  console.log(`[Antigravity 30m Engine] Nhiệm vụ nối đuôi tiếp theo: [${nextTask.phase}] ${nextTask.title}`);
}

// Chạy ngay lập tức ở lượt đầu tiên và lặp lại mỗi 30 phút
if (require.main === module || module.id === '[eval]') {
  runCycle();
  if (!process.argv.includes('--once')) {
    setInterval(runCycle, INTERVAL_MS);
  }
}

module.exports = {
  loadOrCreateState,
  scanCodebaseHealth,
  runCycle,
  DEFAULT_QUEUE,
  INTERVAL_MS,
  STATE_DIR,
  STATE_FILE
};
