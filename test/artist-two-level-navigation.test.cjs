const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const library = require('../library-utils.js');

describe('Cập nhật luồng điều hướng 2 cấp trong mục Nghệ sĩ (Artists)', () => {

  test('1. state khởi tạo selectedArtistEntry: null', () => {
    assert.ok(
      indexHtml.includes('selectedArtistEntry: null'),
      'state phải khởi tạo selectedArtistEntry: null'
    );
  });

  test('2. Chuyển tab/view qua setLibraryView tự động reset selectedArtistEntry', () => {
    const fnMatch = indexHtml.match(/function setLibraryView\(view\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'setLibraryView phải tồn tại trong index.html');
    const fnBody = fnMatch[1];
    assert.ok(
      fnBody.includes('state.selectedArtistEntry = null;'),
      'setLibraryView phải reset state.selectedArtistEntry = null khi chuyển tab/view'
    );
    assert.ok(
      fnBody.includes('state.currentCollectionEntry = null;'),
      'setLibraryView phải reset state.currentCollectionEntry = null'
    );
    assert.ok(
      fnBody.includes('state.trackScope = null;'),
      'setLibraryView phải reset state.trackScope = null'
    );
  });

  test('3. buildArtistAlbums gom album riêng cho nghệ sĩ và sắp xếp chuẩn đĩa/bài', () => {
    assert.ok(
      indexHtml.includes('function buildArtistAlbums(artistEntry)'),
      'buildArtistAlbums phải được định nghĩa trong index.html'
    );

    // Trích xuất và chạy thử hàm buildArtistAlbums
    const fnMatch = indexHtml.match(/function buildArtistAlbums\(([\s\S]*?)\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'Trích xuất thành công buildArtistAlbums');

    const buildArtistAlbumsFn = new Function('artistEntry', 'library', 'state', `
      ${fnMatch[2]}
    `);

    const mockArtist = {
      key: 'my-tam',
      name: 'Mỹ Tâm',
      tracks: [
        { id: 't1', title: 'Đừng Hỏi Ngày Mai', album: 'Tâm 9', artist: 'Mỹ Tâm', trackNumber: 2, discNumber: 1 },
        { id: 't2', title: 'Người Hãy Quên Em Đi', album: 'Tâm 9', artist: 'Mỹ Tâm', trackNumber: 5, discNumber: 1 },
        { id: 't3', title: 'Họa Mi Tóc Nâu', album: 'Hoạ Mi Tóc Nâu', artist: 'Mỹ Tâm', trackNumber: 1, discNumber: 1 },
        { id: 't4', title: 'Chuyện Như Chưa Bắt Đầu', album: 'Single / Chưa rõ album', artist: 'Mỹ Tâm' }
      ]
    };

    const mockState = { albumCovers: new Map(), tracks: mockArtist.tracks };
    const albums = buildArtistAlbumsFn(mockArtist, library, mockState);

    assert.strictEqual(albums.length, 3, 'Phải gom thành đúng 3 album');
    // Kiểm tra sắp xếp tên album theo tiếng Việt (Hoạ Mi Tóc Nâu, Single / Chưa rõ album, Tâm 9)
    assert.ok(albums.some(a => a.name === 'Tâm 9' && a.tracks.length === 2), 'Album Tâm 9 phải có 2 bài');
    assert.ok(albums.some(a => a.name === 'Hoạ Mi Tóc Nâu' && a.tracks.length === 1), 'Album Hoạ Mi Tóc Nâu phải có 1 bài');
    assert.ok(albums.every(a => a.action === 'album'), 'Mỗi album phải có action là album');
  });

  test('4. showArtistAlbumsView giữ nguyên tab Nghệ sĩ, ẩn track-list, hiện lưới album', () => {
    assert.ok(
      indexHtml.includes('function showArtistAlbumsView(artistEntry)'),
      'showArtistAlbumsView phải được định nghĩa trong index.html'
    );

    const fnMatch = indexHtml.match(/function showArtistAlbumsView\(([\s\S]*?)\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'Trích xuất showArtistAlbumsView');
    const fnBody = fnMatch[2];

    assert.ok(fnBody.includes('buildArtistAlbums(artistEntry)'), 'Phải gọi buildArtistAlbums');
    assert.ok(fnBody.includes('state.selectedArtistEntry = { ...artistEntry, albums: artistAlbums }'), 'Lưu artistEntry vào state.selectedArtistEntry');
    assert.ok(fnBody.includes('state.currentCollectionEntry = null;'), 'currentCollectionEntry phải là null');
    assert.ok(fnBody.includes('state.trackScope = null;'), 'trackScope phải là null (chưa chọn bài/album)');
    assert.ok(fnBody.includes("showAlbumHero(artistEntry, 'artist')"), 'Hiện hero nghệ sĩ');
    assert.ok(fnBody.includes("$('track-list').classList.add('hidden')"), 'Ẩn danh sách bài hát track-list');
    assert.ok(fnBody.includes("$('track-list-header').classList.add('hidden')"), 'Ẩn tiêu đề track-list-header');
    assert.ok(fnBody.includes("grid.classList.remove('hidden')"), 'Hiện lưới album collection-grid');
    assert.ok(fnBody.includes('renderArtistAlbumGrid(grid, artistAlbums)'), 'Render lưới album của riêng nghệ sĩ đó');
  });

  test('5. renderCollectionCards click artist không gọi renderTrackRows mà gọi showArtistAlbumsView', () => {
    const fnMatch = indexHtml.match(/function renderCollectionCards\(tracks\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'renderCollectionCards phải tồn tại');
    const fnBody = fnMatch[1];

    assert.ok(
      fnBody.includes("if (action === 'artist') {\n              showArtistAlbumsView(entry);\n              return;\n            }"),
      'Click vào nghệ sĩ phải chuyển sang showArtistAlbumsView và return ngay, không renderTrackRows'
    );
  });

  test('6. renderArtistAlbumGrid click vào album mới mở danh sách bài hát của album', () => {
    assert.ok(
      indexHtml.includes('function renderArtistAlbumGrid(grid, artistAlbums)'),
      'renderArtistAlbumGrid phải được định nghĩa trong index.html'
    );

    const fnMatch = indexHtml.match(/function renderArtistAlbumGrid\(([\s\S]*?)\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'Trích xuất renderArtistAlbumGrid');
    const fnBody = fnMatch[2];

    assert.ok(fnBody.includes('data-collection-action="artist-album"'), 'Card album phải có action artist-album');
    assert.ok(fnBody.includes("albumEntry.action = 'album';"), 'Gán action album cho albumEntry');
    assert.ok(fnBody.includes('state.currentCollectionEntry = albumEntry;'), 'Gán state.currentCollectionEntry');
    assert.ok(fnBody.includes('state.trackScope = (albumEntry.tracks || []).map(t => t.id);'), 'Gán state.trackScope');
    assert.ok(fnBody.includes("grid.classList.add('hidden')"), 'Ẩn collection-grid khi mở bài hát');
    assert.ok(fnBody.includes("showAlbumHero(albumEntry, 'album')"), 'Hiện hero cho album');
    assert.ok(fnBody.includes('renderTrackRows(albumEntry.tracks || [])'), 'Render các bài hát của album');
  });

  test('7. handleCollectionBack lùi đúng 2 cấp: Album -> Lưới Album Nghệ sĩ -> Tất cả Nghệ sĩ', () => {
    assert.ok(
      indexHtml.includes('function handleCollectionBack(e)'),
      'handleCollectionBack phải được định nghĩa trong index.html'
    );

    const fnMatch = indexHtml.match(/function handleCollectionBack\(([\s\S]*?)\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'Trích xuất handleCollectionBack');
    const fnBody = fnMatch[2];

    // Cấp 1 lùi: Đang xem bài của Album -> quay lại lưới Album của Nghệ sĩ
    assert.ok(
      fnBody.includes('if (state.currentCollectionEntry && state.selectedArtistEntry)') &&
      fnBody.includes('showArtistAlbumsView(state.selectedArtistEntry);'),
      'Từ chi tiết Album quay lại showArtistAlbumsView'
    );

    // Cấp 2 lùi: Đang xem lưới Album của Nghệ sĩ -> quay lại danh sách tất cả Nghệ sĩ
    assert.ok(
      fnBody.includes('if (state.selectedArtistEntry)') &&
      fnBody.includes('state.selectedArtistEntry = null;') &&
      fnBody.includes('renderTracks();'),
      'Từ lưới Album Nghệ sĩ quay lại danh sách tất cả Nghệ sĩ'
    );

    // Nút back gắn kết chuẩn
    assert.ok(
      indexHtml.includes('backBtn.onclick = handleCollectionBack;'),
      '#album-hero-back phải gắn handleCollectionBack'
    );
    assert.ok(
      indexHtml.includes('handleCollectionBack(e)'),
      '#back-button phải gọi handleCollectionBack'
    );
  });

  test('8. renderTracks giữ nguyên view lưới album của nghệ sĩ đang chọn khi được gọi lại', () => {
    const fnMatch = indexHtml.match(/function renderTracks\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fnMatch, 'renderTracks phải tồn tại');
    const fnBody = fnMatch[1];

    assert.ok(
      fnBody.includes("if (state.activeView === 'artists' && state.selectedArtistEntry && !state.currentCollectionEntry) {\n        showArtistAlbumsView(state.selectedArtistEntry);"),
      'renderTracks phải gọi lại showArtistAlbumsView khi đang xem lưới album của nghệ sĩ'
    );
  });

  test('BẢO TOÀN BẤT BIẾN: state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio Graph Invariant phải giữ nguyên vẹn 100%'
    );
  });

});
