const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

describe('Tối ưu Tốc độ Đồng bộ Google Drive (Progressive Sync)', () => {

  test('1. GOOGLE_DRIVE_AUDIO_QUERY lọc trực tiếp trên server Google Drive đầy đủ định dạng Hi-Res', () => {
    assert.ok(indexHtml.includes('const GOOGLE_DRIVE_AUDIO_QUERY'), 'GOOGLE_DRIVE_AUDIO_QUERY phải được định nghĩa');
    
    // Kiểm tra các thành phần lọc
    assert.ok(indexHtml.includes('"trashed = false"'), 'Phải lọc trashed = false');
    assert.ok(indexHtml.includes('"mimeType != \'application/vnd.google-apps.folder\'"'), 'Phải loại bỏ thư mục');
    assert.ok(indexHtml.includes('"mimeType contains \'audio/\'"'), 'Phải lọc mimeType contains audio/');

    // Danh sách định dạng âm thanh bắt buộc
    const expectedExtensions = [
      '.flac', '.dsf', '.dff', '.wav', '.alac', '.m4a', '.mp3',
      '.aiff', '.aif', '.aac', '.ogg', '.opus', '.wv', '.ape', '.wma', '.mka'
    ];
    for (const ext of expectedExtensions) {
      assert.ok(
        indexHtml.includes(`"name contains '${ext}'"`),
        `GOOGLE_DRIVE_AUDIO_QUERY phải chứa name contains '${ext}'`
      );
    }
  });

  test('2. Sắp xếp modifiedTime desc với fallback an toàn khi gặp HTTP 400', () => {
    assert.ok(indexHtml.includes("params.set('orderBy', 'modifiedTime desc')"), 'Phải ưu tiên orderBy modifiedTime desc');
    assert.ok(
      indexHtml.includes('response.status === 400 && useOrderBy'),
      'Phải có cơ chế phát hiện lỗi 400 do orderBy và tự động fallback'
    );
    assert.ok(
      indexHtml.includes('useOrderBy = false;\n            continue;'),
      'Fallback 400 phải tắt useOrderBy và thử lại ngay trang hiện tại'
    );
  });

  test('3. Progressive Render hiển thị bài mới ngay lập tức theo từng trang (không chờ hết vòng lặp)', () => {
    // Trích xuất thân hàm loadGoogleFiles
    const fnMatch = indexHtml.match(/async function loadGoogleFiles\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'loadGoogleFiles phải tồn tại trong index.html');
    const fnBody = fnMatch[1];

    // Kiểm tra trong vòng lặp do...while có gọi render bài mới khi pageTracks.length > 0
    const loopMatch = fnBody.match(/do\s*\{([\s\S]*?)\}\s*while\s*\(pageToken\);/);
    assert.ok(loopMatch, 'Phải có vòng lặp do...while (pageToken)');
    const loopBody = loopMatch[1];

    assert.ok(
      loopBody.includes('if (pageTracks.length > 0)') &&
      (loopBody.includes('scheduleBackgroundRender()') || loopBody.includes('renderTracks()')),
      'Trong vòng lặp phải gọi scheduleBackgroundRender() hoặc renderTracks() ngay khi pageTracks.length > 0'
    );

    // Kiểm tra scheduleBackgroundRender định nghĩa và tôn trọng isUserScrolling
    assert.ok(
      indexHtml.includes('function scheduleBackgroundRender()'),
      'Hàm scheduleBackgroundRender phải được định nghĩa'
    );
  });

  test('4. Không chạy queueCloudMetadata tranh băng thông trong lúc quét danh sách file', () => {
    const fnMatch = indexHtml.match(/async function loadGoogleFiles\(\)\s*\{([\s\S]*?)\n    \}/);
    const fnBody = fnMatch[1];

    const beforeLoop = fnBody.split('do {')[0];
    assert.ok(
      !beforeLoop.includes('queueCloudMetadata('),
      'Tuyệt đối không gọi queueCloudMetadata trước vòng lặp'
    );

    const loopMatch = fnBody.match(/do\s*\{([\s\S]*?)\}\s*while\s*\(pageToken\);/);
    const loopBody = loopMatch[1];
    assert.ok(
      !loopBody.includes('queueCloudMetadata('),
      'Tuyệt đối không gọi queueCloudMetadata bên trong vòng lặp quét file'
    );

    // queueCloudMetadata chỉ được gọi trong finally sau khi đã quét xong
    assert.ok(
      fnBody.includes('finally {') && fnBody.includes('queueCloudMetadata(pendingMeta)'),
      'queueCloudMetadata phải được gom lại và chỉ gọi trong khối finally'
    );
    assert.ok(
      fnBody.includes('propagateAndBroadcastCovers()'),
      'propagateAndBroadcastCovers phải được gọi trong finally'
    );
  });

  test('5. Không để persistCloudCatalog/pruneCloudCatalog chặn vòng lặp & pruneCloudCatalog chỉ chạy 1 lần', () => {
    const fnMatch = indexHtml.match(/async function loadGoogleFiles\(\)\s*\{([\s\S]*?)\n    \}/);
    const fnBody = fnMatch[1];

    const loopMatch = fnBody.match(/do\s*\{([\s\S]*?)\}\s*while\s*\(pageToken\);/);
    const loopBody = loopMatch[1];

    // Không await persistCloudCatalog trong loop
    assert.ok(
      !loopBody.includes('await persistCloudCatalog('),
      'Không được await persistCloudCatalog chặn việc tải trang kế tiếp'
    );
    assert.ok(
      loopBody.includes('persistChain = persistChain.then(() => persistCloudCatalog(pageTracks, { skipPrune: true }))'),
      'Ghi IndexedDB qua chuỗi promise nền persistChain với skipPrune: true'
    );

    // pruneCloudCatalog chỉ được gọi sau vòng lặp do...while
    const afterLoop = fnBody.split('} while (pageToken);')[1];
    assert.ok(
      afterLoop.includes('await persistChain;'),
      'Sau vòng lặp phải chờ persistChain hoàn tất'
    );
    assert.ok(
      afterLoop.includes('await pruneCloudCatalog();'),
      'pruneCloudCatalog chỉ được chạy 1 lần sau khi kết thúc vòng lặp'
    );
    assert.ok(
      !loopBody.includes('pruneCloudCatalog'),
      'pruneCloudCatalog không được xuất hiện trong vòng lặp'
    );
  });

  test('6. fetchGoogleDrivePageWithRetry xử lý retry 401 & 429/5xx chuẩn', () => {
    assert.ok(indexHtml.includes('async function fetchGoogleDrivePageWithRetry'), 'fetchGoogleDrivePageWithRetry phải được định nghĩa');
    assert.ok(indexHtml.includes('response.status === 401 && !refreshedTokenOnce'), 'Retry 401 một lần');
    assert.ok(indexHtml.includes('response.status === 429 || (response.status >= 500 && response.status <= 504)'), 'Retry 429/5xx tối đa 3 lần với exponential backoff');
  });

  test('BẢO TOÀN BẤT BIẾN: state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio Graph Invariant phải giữ nguyên vẹn 100%'
    );
  });

});
