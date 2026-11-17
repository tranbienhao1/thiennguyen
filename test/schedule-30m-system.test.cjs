const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_MD = path.join(ROOT, '.agent', 'workflows', 'auto_evolve_30m.md');
const RULE_MD = path.join(ROOT, '.agent', 'rules', 'thiennguyen_autonomy.md');
const LOOP_SCRIPT = path.join(ROOT, 'scripts', 'antigravity_30m_loop.js');
const GH_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'antigravity-30m.yml');
const STATE_JSON = path.join(ROOT, '.agent', 'ANTIGRAVITY_STATE.json');

describe('Antigravity 30-Minute Schedule & Tail-Chaining System', () => {
  it('1. Phần 1 & 3: .agent/workflows/auto_evolve_30m.md contains Master Prompt & 5-Step Engine', () => {
    assert.ok(fs.existsSync(WORKFLOW_MD), '.agent/workflows/auto_evolve_30m.md must exist');
    const content = fs.readFileSync(WORKFLOW_MD, 'utf8');
    assert.match(content, /# SYSTEM ROLE: PRINCIPAL AUTONOMOUS HI-RES AUDIO & WEB ARCHITECT \(GOOGLE ANTIGRAVITY 24\/7 ENGINE\)/);
    assert.match(content, /## I\. QUY TẮC TỰ HÀNH & NỐI ĐUÔI BẤT BIẾN \(ZERO-STOP RULES\)/);
    assert.match(content, /## II\. QUY TRÌNH 5 BƯỚC TRONG MỖI CHU KỲ 30 PHÚT/);
    assert.match(content, /### BƯỚC 1: ĐỒNG BỘ REPO & ĐỌC TRẠNG THÁI NỐI ĐUÔI \(`SYNC & STATE RECOVERY`\)/);
    assert.match(content, /### BƯỚC 2: QUÉT SÂU TOÀN BỘ CODEBASE & THỰC THI THEO PHA \(`DEEP SCAN & EXECUTE`\)/);
    assert.match(content, /#### PHA A — TỰ TÌM LỖI & TỰ SỬA LỖI \(`BUG_HUNT & SELF-HEALING`\)/);
    assert.match(content, /#### PHA B — TỰ TÌM NÂNG CẤP TÍNH NĂNG \(`AUTONOMOUS FEATURE UPGRADE`\)/);
    assert.match(content, /#### PHA C — TỰ TÌM CẢI TIẾN HIỆU NĂNG, KIẾN TRÚC & UX \(`AUTONOMOUS OPTIMIZATION`\)/);
    assert.match(content, /### BƯỚC 3: CỔNG KIỂM CHỨNG 3 TẦNG BẮT BUỘC \(`3-TIER VERIFICATION GATE`\)/);
    assert.match(content, /### BƯỚC 4: CẬP NHẬT TRẠNG THÁI & ĐẨY CODE LÊN GITHUB \(`COMMIT & PUSH`\)/);
    assert.match(content, /### BƯỚC 5: KÍCH HOẠT NỐI ĐUÔI LIÊN HOÀN \(`CONTINUOUS TAIL-CHAINING`\)/);
    assert.match(content, /https:\/\/github\.com\/tranbienhao1\/thiennguyen/);
    assert.match(content, /https:\/\/lrclib\.net\/docs/);
  });

  it('2. Phần 2: .agent/rules/thiennguyen_autonomy.md contains alwaysApply frontmatter & 3 core autonomy rules', () => {
    assert.ok(fs.existsSync(RULE_MD), '.agent/rules/thiennguyen_autonomy.md must exist');
    const content = fs.readFileSync(RULE_MD, 'utf8');
    assert.match(content, /^---\r?\ndescription: Quy tắc tự hành vĩnh viễn và nối đuôi mỗi 30 phút cho dự án Web Nghe Nhạc Hi-Res tranbienhao1\/thiennguyen\r?\nglobs: "\*\*\/\*"\r?\nalwaysApply: true\r?\n---/);
    assert.match(content, /# QUY TẮC VẬN HÀNH TỰ ĐỘNG 24\/7 \(`tranbienhao1\/thiennguyen`\)/);
    assert.match(content, /1\. \*\*Chế độ Thực Thi Không Gián Đoạn \(Zero-Confirmation Autonomous Mode\):\*\*/);
    assert.match(content, /2\. \*\*Chuẩn Kỹ Thuật Cốt Lõi Của Dự Án:\*\*/);
    assert.match(content, /3\. \*\*Cổng Kiểm Chứng 3 Tầng Trước Mọi Commit:\*\*/);
  });

  it('3. Phần 4.1: scripts/antigravity_30m_loop.js passes syntax check and exports watchdog functions & DEFAULT_QUEUE', () => {
    assert.ok(fs.existsSync(LOOP_SCRIPT), 'scripts/antigravity_30m_loop.js must exist');
    execSync(`node --check "${LOOP_SCRIPT}"`, { stdio: 'pipe' });

    const code = fs.readFileSync(LOOP_SCRIPT, 'utf8');
    assert.ok(code.includes('setInterval(runCycle, INTERVAL_MS);'), 'must retain setInterval(runCycle, INTERVAL_MS); for GitHub Actions compatibility');

    const loopModule = require(LOOP_SCRIPT);
    assert.equal(loopModule.INTERVAL_MS, 30 * 60 * 1000);
    assert.equal(typeof loopModule.loadOrCreateState, 'function');
    assert.equal(typeof loopModule.scanCodebaseHealth, 'function');
    assert.equal(typeof loopModule.runCycle, 'function');
    assert.ok(Array.isArray(loopModule.DEFAULT_QUEUE));
    assert.equal(loopModule.DEFAULT_QUEUE.length, 6);
    assert.deepEqual(
      loopModule.DEFAULT_QUEUE.map((item) => item.id),
      ['BUG-01', 'UPG-01', 'OPT-01', 'BUG-02', 'UPG-02', 'OPT-02']
    );

    const health = loopModule.scanCodebaseHealth();
    assert.ok(Array.isArray(health.syntaxErrors));
    assert.equal(health.syntaxErrors.length, 0, 'Web codebase must have 0 syntax errors');
    assert.ok(Array.isArray(health.warnings));
  });

  it('4. Phần 4.2: .github/workflows/antigravity-30m.yml configures 30-minute cron and state commit', () => {
    assert.ok(fs.existsSync(GH_WORKFLOW), '.github/workflows/antigravity-30m.yml must exist');
    const yml = fs.readFileSync(GH_WORKFLOW, 'utf8');
    assert.match(yml, /name: Antigravity 30-Minute Continuous Audit & Queue Feeder/);
    assert.match(yml, /cron: '\*\/30 \* \* \* \*'/);
    assert.match(yml, /workflow_dispatch:/);
    assert.match(yml, /contents: write/);
    assert.match(yml, /scripts\/antigravity_30m_loop\.js/);
    assert.match(yml, /chore\(antigravity\): 30m heartbeat diagnostics & queue update \[skip ci\]/);
  });

  it('5. State Persistence: .agent/ANTIGRAVITY_STATE.json is valid and initialized with 0 syntax errors', () => {
    assert.ok(fs.existsSync(STATE_JSON), '.agent/ANTIGRAVITY_STATE.json must exist');
    const state = JSON.parse(fs.readFileSync(STATE_JSON, 'utf8'));
    assert.equal(state.repo, 'https://github.com/tranbienhao1/thiennguyen');
    assert.equal(state.cadenceMinutes, 30);
    assert.ok(typeof state.cycleCount === 'number' && state.cycleCount >= 1);
    assert.ok(['BUG_HUNT', 'UPGRADE', 'OPTIMIZE'].includes(state.lastPhase));
    assert.ok(typeof state.lastRunIso === 'string' && state.lastRunIso.length > 0);
    assert.ok(state.diagnostics && Array.isArray(state.diagnostics.syntaxErrors));
    assert.equal(state.diagnostics.syntaxErrors.length, 0);
    assert.ok(Array.isArray(state.pendingQueue) && state.pendingQueue.length > 0);
    assert.ok(Array.isArray(state.completedTasks));
  });

  it('6. BUG-01: safeRevokeObjectUrlRegistry & createAbortableTrackLoader prevent ObjectURL leaks and stale race conditions', () => {
    const lib = require(path.join(ROOT, 'library-utils.js'));
    assert.equal(typeof lib.safeRevokeObjectUrlRegistry, 'function');
    assert.equal(typeof lib.createAbortableTrackLoader, 'function');

    const revokedList = [];
    const loader = lib.createAbortableTrackLoader({
      maxRetained: 4,
      revokeFn: url => revokedList.push(url)
    });

    // Rapid track switching: Track A -> Track B -> Track C
    const loadA = loader.beginLoad('track-a');
    const urlA = loadA.registerObjectUrl('blob:https://nocturne.app/uuid-a');
    assert.equal(urlA, 'blob:https://nocturne.app/uuid-a');
    assert.equal(loadA.isCurrent(), true);

    const loadB = loader.beginLoad('track-b');
    assert.equal(loadA.signal.aborted, true, 'Track A signal must be aborted when Track B starts');
    assert.equal(loadA.isCurrent(), false);
    assert.equal(loadB.isCurrent(), true);

    // Late ObjectURL registration from stale Track A must be immediately revoked
    const lateUrlA = loadA.registerObjectUrl('blob:https://nocturne.app/uuid-a-late');
    assert.equal(lateUrlA, null);
    assert.ok(revokedList.includes('blob:https://nocturne.app/uuid-a-late'));

    // Stale commit from Track A must be rejected and its URL revoked
    const staleCommit = loader.commitLoad(loadA.generationId, 'blob:https://nocturne.app/uuid-a');
    assert.equal(staleCommit.committed, false);
    assert.equal(staleCommit.stale, true);
    assert.ok(revokedList.includes('blob:https://nocturne.app/uuid-a'));

    // Active commit from Track B succeeds and retains only active + standby URLs
    const urlB = loadB.registerObjectUrl('blob:https://nocturne.app/uuid-b');
    const standbyC = 'blob:https://nocturne.app/uuid-c-standby';
    const commitB = loader.commitLoad(loadB.generationId, urlB, standbyC);
    assert.equal(commitB.committed, true);
    assert.equal(commitB.stale, false);
    assert.equal(commitB.activeUrl, 'blob:https://nocturne.app/uuid-b');
    assert.equal(commitB.standbyUrl, standbyC);

    // abortAll revokes remaining URLs
    const aborted = loader.abortAll('shutdown');
    assert.ok(aborted.revokedUrls.includes('blob:https://nocturne.app/uuid-b'));
    assert.ok(aborted.revokedUrls.includes(standbyC));
    assert.equal(loader.getState().activeUrlCount, 0);
  });

  it('7. BUG-02: validateBinaryAudioHeaderBounds safely validates FLAC, WAV (JUNK/bext/fmt/data), DSF (LSB) & DFF (MSB) without DataView RangeError', () => {
    const { validateBinaryAudioHeaderBounds } = require(path.join(ROOT, 'library-utils.js'));
    assert.equal(typeof validateBinaryAudioHeaderBounds, 'function');

    // Empty & 2-byte truncated inputs never throw RangeError
    assert.equal(validateBinaryAudioHeaderBounds(null).valid, false);
    assert.equal(validateBinaryAudioHeaderBounds(new Uint8Array(0)).error, 'empty_buffer');
    assert.equal(validateBinaryAudioHeaderBounds(new Uint8Array([0x66, 0x4c])).truncated, true);

    // Truncated ID3v2 header / body
    const truncatedId3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00]);
    const id3Res = validateBinaryAudioHeaderBounds(truncatedId3);
    assert.equal(id3Res.valid, false);
    assert.equal(id3Res.truncated, true);
    assert.equal(id3Res.error, 'truncated_id3_body');

    // Valid FLAC with STREAMINFO (34 bytes: 96kHz, 2ch, 24-bit) + PICTURE block
    const flacBuf = new Uint8Array(4 + 4 + 34 + 4 + 32);
    flacBuf.set([0x66, 0x4c, 0x61, 0x43], 0); // 'fLaC'
    flacBuf[4] = 0x00; // STREAMINFO (not last)
    flacBuf[5] = 0x00; flacBuf[6] = 0x00; flacBuf[7] = 34;
    // 96000 Hz = 0x17700 -> (0x17 << 12) | (0x70 << 4) | 0x0
    flacBuf[18] = 0x17;
    flacBuf[19] = 0x70;
    // channels=2 ((2-1)<<1 = 0x02), bitsPerSample=24 (23 = 0x17 -> high bit 1, low 4 bits 7)
    flacBuf[20] = 0x02 | 0x01;
    flacBuf[21] = 0x70;
    // PICTURE block (isLast=true, type=6, length=32)
    const picHeader = 42;
    flacBuf[picHeader] = 0x80 | 6;
    flacBuf[picHeader + 1] = 0; flacBuf[picHeader + 2] = 0; flacBuf[picHeader + 3] = 32;
    const flacValid = validateBinaryAudioHeaderBounds(flacBuf);
    assert.equal(flacValid.valid, true);
    assert.equal(flacValid.format, 'flac');
    assert.equal(flacValid.sampleRate, 96000);
    assert.equal(flacValid.channels, 2);
    assert.equal(flacValid.bitsPerSample, 24);

    // Truncated FLAC PICTURE block (declares 2MB picture inside a 60-byte slice)
    const flacTruncPic = flacBuf.slice(0, 50);
    flacTruncPic[picHeader + 1] = 0x20; // ~2MB length
    const flacTruncRes = validateBinaryAudioHeaderBounds(flacTruncPic);
    assert.equal(flacTruncRes.valid, false);
    assert.equal(flacTruncRes.truncated, true);
    assert.equal(flacTruncRes.error, 'truncated_flac_picture_block');

    // Valid WAV with JUNK chunk before fmt & data
    const wavBuf = new Uint8Array(12 + 12 + 24 + 8);
    const wavView = new DataView(wavBuf.buffer);
    wavBuf.set(Buffer.from('RIFF'), 0);
    wavView.setUint32(4, wavBuf.byteLength - 8, true);
    wavBuf.set(Buffer.from('WAVE'), 8);
    wavBuf.set(Buffer.from('JUNK'), 12);
    wavView.setUint32(16, 4, true); // 4-byte JUNK body (12..23)
    wavBuf.set(Buffer.from('fmt '), 24);
    wavView.setUint32(28, 16, true);
    wavView.setUint16(32, 1, true); // PCM
    wavView.setUint16(34, 2, true); // 2 channels
    wavView.setUint32(36, 192000, true); // 192kHz
    wavView.setUint16(46, 24, true); // 24-bit
    wavBuf.set(Buffer.from('data'), 48);
    wavView.setUint32(52, 4096, true);
    const wavValid = validateBinaryAudioHeaderBounds(wavBuf);
    assert.equal(wavValid.valid, true);
    assert.equal(wavValid.format, 'wav');
    assert.equal(wavValid.sampleRate, 192000);
    assert.equal(wavValid.bitsPerSample, 24);
    assert.equal(wavValid.dataOffset, 56);

    // Valid DSF (LSB-first, 92 bytes header) & truncated DSF
    const dsfBuf = new Uint8Array(96);
    const dsfView = new DataView(dsfBuf.buffer);
    dsfBuf.set(Buffer.from('DSD '), 0);
    dsfView.setUint32(4, 28, true);
    dsfBuf.set(Buffer.from('fmt '), 28);
    dsfView.setUint32(32, 52, true);
    dsfView.setUint32(28 + 24, 2, true); // 2ch
    dsfView.setUint32(28 + 28, 2822400, true); // DSD64
    dsfView.setUint32(28 + 32, 1, true); // LSB-first
    dsfBuf.set(Buffer.from('data'), 80);
    dsfView.setUint32(84, 1024, true);
    const dsfValid = validateBinaryAudioHeaderBounds(dsfBuf);
    assert.equal(dsfValid.valid, true);
    assert.equal(dsfValid.format, 'dsf');
    assert.equal(dsfValid.bitOrder, 'lsb');
    assert.equal(dsfValid.sampleRate, 2822400);
    assert.equal(validateBinaryAudioHeaderBounds(dsfBuf.slice(0, 40)).truncated, true);

    // Valid DFF (MSB-first FRM8 ... DSD ) & truncated DFF
    const dffBuf = new Uint8Array(32);
    const dffView = new DataView(dffBuf.buffer);
    dffBuf.set(Buffer.from('FRM8'), 0);
    dffView.setUint32(8, 20, false);
    dffBuf.set(Buffer.from('DSD '), 12);
    dffBuf.set(Buffer.from('DSD '), 16);
    dffView.setUint32(24, 4096, false);
    const dffValid = validateBinaryAudioHeaderBounds(dffBuf);
    assert.equal(dffValid.valid, true);
    assert.equal(dffValid.format, 'dff');
    assert.equal(dffValid.bitOrder, 'msb');
    assert.equal(dffValid.dataOffset, 28);
    assert.equal(validateBinaryAudioHeaderBounds(dffBuf.slice(0, 10)).truncated, true);
  });
});
