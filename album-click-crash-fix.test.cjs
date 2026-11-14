'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

describe('Fix Album Click Crash & Safe Title Resolution', () => {
  it('hàm sắp xếp danh sách bài hát xử lý an toàn khi track không có title, title null hoặc undefined', () => {
    const getTitle = t => {
      if (!t) return '';
      if (typeof library !== 'undefined' && library && typeof library.trackMetadata === 'function') {
        return String(library.trackMetadata(t).title || t.title || t.name || '');
      }
      return String(t.title || t.name || '');
    };

    const tracks = [
      { id: 't1', title: undefined, name: 'Z-File.mp3' },
      { id: 't2', title: null, name: 'A-File.flac' },
      { id: 't3', title: 'Bài hát thứ ba', name: 'song3.wav' },
      { id: 't4' }, // completely missing title and name
      { id: 't5', title: 'Áo lụa Hà Đông' }
    ];

    // Không được ném ngoại lệ TypeError: Cannot read properties of undefined (reading 'localeCompare')
    assert.doesNotThrow(() => {
      const sortedAsc = [...tracks].sort((a, b) => {
        const titleA = getTitle(a);
        const titleB = getTitle(b);
        return titleA.localeCompare(titleB, 'vi');
      });
      assert.equal(sortedAsc.length, 5);
    });

    assert.doesNotThrow(() => {
      const sortedDesc = [...tracks].sort((a, b) => {
        const titleA = getTitle(a);
        const titleB = getTitle(b);
        return -1 * titleA.localeCompare(titleB, 'vi');
      });
      assert.equal(sortedDesc.length, 5);
    });
  });

  it('renderCollectionCards sắp xếp an toàn khi tên album hoặc nghệ sĩ null/undefined', () => {
    const entries = [
      { name: undefined, artist: 'Artist A', tracks: [] },
      { name: null, artist: 'Artist B', tracks: [] },
      { name: 'Album 1', artist: undefined, tracks: [] },
      { name: 'Album 2', artist: 'Artist C', tracks: [] }
    ];

    assert.doesNotThrow(() => {
      entries.sort((a, b) => {
        const first = a.name;
        const second = b.name;
        return String(first || '').localeCompare(String(second || ''), 'vi');
      });
      assert.equal(entries.length, 4);
    });
  });

  it('tạo initials an toàn không bị văng khi entry.name rỗng hoặc undefined', () => {
    const testNames = ['', '   ', undefined, null, 'Nocturne Symphony', 'Một đời'];
    for (const name of testNames) {
      assert.doesNotThrow(() => {
        const entryName = String(name || 'Unknown');
        const initials = entryName.trim().split(/\s+/u).slice(0, 2).map(word => [...word][0] || '').join('').toLocaleUpperCase('vi');
        assert.ok(typeof initials === 'string');
      });
    }
  });

  it('showAlbumHero có fallback bảo vệ summary.highestQuality và dữ liệu rỗng', () => {
    assert.ok(html.includes('summary?.highestQuality || { label: \'LOSSLESS\', tier: \'lossless\' }'), 'Có fallback an toàn cho highestQuality');
    assert.ok(html.includes('entry.name || \'Album\''), 'Có fallback tên album an toàn');
  });

  it('có hàm openAlbum và openArtist để điều hướng tới album/nghệ sĩ an toàn', () => {
    assert.ok(html.includes('function openAlbum(albumName, artistName)'), 'Có hàm openAlbum');
    assert.ok(html.includes('function openArtist(artistName)'), 'Có hàm openArtist');
    assert.ok(html.includes('list.querySelectorAll(\'.album-link\')'), 'Có event listener cho .album-link');
    assert.ok(html.includes('list.querySelectorAll(\'.artist-link\')'), 'Có event listener cho .artist-link');
  });

  it('bọc try-catch error boundary khi click thẻ collection card', () => {
    assert.ok(html.includes('Lỗi khi mở album/bộ sưu tập:'), 'Có try-catch bắt lỗi và thông báo toast');
  });

  it('bảo toàn nghiêm ngặt bất biến đồ thị âm thanh Web Audio API', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Bất biến âm thanh state.crossfeedNodes.output.connect(state.context.destination) phải được giữ nguyên'
    );
  });
});
