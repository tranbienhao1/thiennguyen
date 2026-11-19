const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const libraryUtilsPath = path.join(rootDir, 'library-utils.js');
const virtualScrollPath = path.join(rootDir, 'virtual-scroll.js');

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const libraryUtilsCode = fs.readFileSync(libraryUtilsPath, 'utf8');
const virtualScrollCode = fs.readFileSync(virtualScrollPath, 'utf8');

describe('Sửa dứt điểm 3 lỗi: Search Bar, Drive Sync, Scroll Jank', () => {

  test('LỖI 1: Thanh tìm kiếm desktop và mobile hiển thị đúng cơ chế Tailwind', () => {
    // 1. Kiểm tra .hidden không còn bị !important toàn cục đè lên utility responsive của Tailwind
    const styleAppMatch = indexHtml.match(/<style id="app-style">([\s\S]*?)<\/style>/);
    assert.ok(styleAppMatch, '<style id="app-style"> phải tồn tại');
    const styleContent = styleAppMatch[1];

    assert.ok(
      !styleContent.match(/\.hidden\s*,\s*\[hidden\]\s*\{/),
      '.hidden không được gộp chung với [hidden] trong quy tắc !important toàn cục'
    );
    assert.ok(
      styleContent.includes('[hidden]') && styleContent.includes('display: none !important'),
      'Thuộc tính [hidden] vẫn phải giữ display: none !important'
    );

    // 2. Kiểm tra phần tử tìm kiếm desktop (#search) và mobile (#search-mobile)
    assert.ok(
      indexHtml.includes('class="relative hidden sm:block"') && indexHtml.includes('id="search"'),
      'Khung chứa #search phải dùng "relative hidden sm:block" để hiển thị trên màn hình >= 640px'
    );
    assert.ok(
      indexHtml.includes('class="relative mt-4 block sm:hidden"') && indexHtml.includes('id="search-mobile"'),
      'Khung chứa #search-mobile phải dùng "relative mt-4 block sm:hidden" để hiển thị trên màn hình < 640px'
    );
  });

  test('LỖI 2: Đồng bộ Google Drive không bị thiếu bài hát & hỗ trợ toàn diện định dạng', () => {
    // 1. Kiểm tra MAX_CLOUD_CATALOG_ENTRIES trong library-utils.js >= 50000
    const utils = require('../library-utils.js');
    assert.strictEqual(utils.MAX_CLOUD_CATALOG_ENTRIES, 50000, 'MAX_CLOUD_CATALOG_ENTRIES phải là 50000');

    // 2. Trích xuất và kiểm tra isCloudAudio trong index.html
    const isCloudAudioMatch = indexHtml.match(/const CLOUD_AUDIO_EXT_RE = ([\s\S]*?);[\s\S]*?function isCloudAudio\(([\s\S]*?)\) \{([\s\S]*?)\n    \}/);
    assert.ok(isCloudAudioMatch, 'isCloudAudio phải được định nghĩa trong index.html');

    const extRegexStr = isCloudAudioMatch[1];
    const isCloudAudioFnBody = isCloudAudioMatch[3];
    const isCloudAudioFn = new Function('file', `
      const CLOUD_AUDIO_EXT_RE = ${extRegexStr};
      ${isCloudAudioFnBody}
    `);

    // Kiểm tra các định dạng Hi-Res & phổ biến
    const validExtensions = ['flac', 'wav', 'wave', 'aif', 'aiff', 'aifc', 'alac', 'm4a', 'mp4', 'aac', 'mp3', 'ogg', 'oga', 'opus', 'dsf', 'dff', 'wv', 'ape', 'wma', 'webm', 'mka', 'caf', 'tta', 'mpc', 'tak'];
    for (const ext of validExtensions) {
      assert.strictEqual(
        isCloudAudioFn({ name: `Song 01.${ext}`, mimeType: 'application/octet-stream' }),
        true,
        `File đuôi .${ext} phải được nhận diện kể cả khi mimeType là octet-stream`
      );
      assert.strictEqual(
        isCloudAudioFn({ name: `SONG 02.${ext.toUpperCase()} `, mimeType: '' }),
        true,
        `File đuôi .${ext.toUpperCase()} hoa phải được nhận diện kể cả khi mimeType rỗng`
      );
      assert.strictEqual(
        isCloudAudioFn({ name: `Track without ext`, fileExtension: ext, mimeType: '' }),
        true,
        `File nhận qua fileExtension: ${ext}`
      );
    }
    assert.strictEqual(isCloudAudioFn({ name: 'Track', mimeType: 'application/ogg' }), true, 'Hỗ trợ application/ogg');
    assert.strictEqual(isCloudAudioFn({ name: 'Track', mimeType: 'application/x-flac' }), true, 'Hỗ trợ application/x-flac');

    // Kiểm tra thư mục và trashed bị loại bỏ
    assert.strictEqual(isCloudAudioFn({ name: 'Music Folder', mimeType: 'application/vnd.google-apps.folder' }), false, 'Thư mục không phải audio');
    assert.strictEqual(isCloudAudioFn({ name: 'Track.flac', trashed: true }), false, 'File trashed không được nhận');
    assert.strictEqual(isCloudAudioFn(null), false, 'Null an toàn');

    // 3. Kiểm tra loadGoogleFiles query params, retry, và không prune trong vòng lặp
    assert.ok(
      indexHtml.includes("files(id,name,fileExtension,mimeType,size,parents,modifiedTime,md5Checksum,shortcutDetails,thumbnailLink)") ||
      indexHtml.includes("files(id,name,mimeType,size,parents,modifiedTime,md5Checksum,shortcutDetails,thumbnailLink)"),
      'loadGoogleFiles phải yêu cầu đầy đủ fields'
    );
    assert.ok(indexHtml.includes("pageSize: '1000'"), 'loadGoogleFiles phải đặt pageSize: 1000');
    assert.ok(indexHtml.includes("supportsAllDrives:'true'"), 'loadGoogleFiles phải hỗ trợ All Drives');
    assert.ok(indexHtml.includes("includeItemsFromAllDrives:'true'"), 'loadGoogleFiles phải include Items From All Drives');
    assert.ok(indexHtml.includes("corpora: 'user'") || indexHtml.includes("corpora:'allDrives'"), 'loadGoogleFiles phải corpora allDrives hoặc user');

    // Kiểm tra không prune giữa chừng
    assert.ok(indexHtml.includes('persistCloudCatalog(pageTracks, { skipPrune: true })'), 'persistCloudCatalog phải truyền skipPrune: true trong vòng lặp');
    assert.ok(indexHtml.includes('await pruneCloudCatalog();\n        renderTracks();\n        cloudStatus(\'google\''), 'pruneCloudCatalog chỉ được gọi sau khi quét xong');

    // Kiểm tra 401 token refresh và 429/5xx exponential backoff
    assert.ok(indexHtml.includes('response.status === 401 && !refreshedTokenOnce'), 'Xử lý retry 401 qua ensureGoogleToken');
    assert.ok(indexHtml.includes('response.status === 429 || (response.status >= 500 && response.status <= 504)'), 'Xử lý retry 429/5xx exponential backoff');
  });

  test('LỖI 3: Cuộn Album / Ca sĩ không bị giật, khựng hoặc reset vị trí cuộn', () => {
    // 1. Kiểm tra CSS overflow-anchor: none và aspect-ratio: 1 / 1
    assert.ok(indexHtml.includes('#content-col, #collection-grid {\n      overflow-anchor: none;\n    }'), 'CSS phải có overflow-anchor: none cho #content-col và #collection-grid');
    assert.ok(indexHtml.includes('#collection-grid .collection-card img {\n      aspect-ratio: 1 / 1;\n      object-fit: cover;\n    }'), 'CSS phải cố định aspect-ratio 1/1 và object-fit cover cho card img');

    // 2. Kiểm tra VirtualTrackList.onScroll early return khi container bị ẩn
    assert.ok(
      virtualScrollCode.includes('this.container.hidden || (this.container.classList && this.container.classList.contains(\'hidden\')) || this.container.offsetParent === null'),
      'VirtualTrackList.onScroll phải return sớm khi container bị ẩn'
    );

    // 3. Kiểm tra renderCollectionCards patch in place & phục hồi scrollTop
    assert.ok(indexHtml.includes('canPatchInPlace = currentStructureKey === lastCollectionStructureKey && grid.children.length === entries.length'), 'renderCollectionCards phải kiểm tra canPatchInPlace');
    assert.ok(indexHtml.includes('col.scrollTop = prevScrollTop'), 'Phải lưu và phục hồi scrollTop của #content-col khi DOM thay đổi');

    // 4. Kiểm tra isUserScrolling và hoãn renderTracks ngầm khi đang cuộn
    assert.ok(indexHtml.includes('isUserScrolling'), 'Phải có cờ theo dõi isUserScrolling');
    assert.ok(indexHtml.includes('recordUserScroll'), 'Phải có hàm recordUserScroll');
    assert.ok(indexHtml.includes('initUserScrollListener'), 'Phải có hàm initUserScrollListener');
  });

  test('BẢO TOÀN BẤT BIẾN: state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Bất biến chuỗi âm thanh Web Audio API phải được giữ nguyên vẹn 100%'
    );
  });

});
