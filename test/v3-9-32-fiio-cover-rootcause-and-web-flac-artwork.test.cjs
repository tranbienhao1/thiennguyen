'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const cloudMetadata = require('../cloud-metadata.js');
const metadataUtils = require('../metadata-utils.js');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SW_JS = path.join(ROOT, 'sw.js');
const BUILD_GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle.kts');
const MAIN_ACTIVITY = path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'nocturne', 'audiophile', 'MainActivity.java');
const ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

function buildFlacBlockHeader(isLast, type, payloadLen) {
  const b = Buffer.alloc(4);
  b[0] = (isLast ? 0x80 : 0x00) | (type & 0x7f);
  b[1] = (payloadLen >>> 16) & 0xff;
  b[2] = (payloadLen >>> 8) & 0xff;
  b[3] = payloadLen & 0xff;
  return b;
}

function buildFlacStreamInfo96k24b(totalSamples = 960000) {
  const b = Buffer.alloc(34, 0);
  // Bytes 10..17: 20-bit sampleRate (96000), 3-bit (channels-1) (1 => 2ch), 5-bit (bitDepth-1) (23 => 24-bit), 36-bit totalSamples
  const sr = 96000;
  const chMinus1 = 1;
  const bpsMinus1 = 23;
  const hi4 = Math.floor(totalSamples / 4294967296) & 0x0f;
  const lo32 = totalSamples >>> 0;
  b[10] = (sr >>> 12) & 0xff;
  b[11] = (sr >>> 4) & 0xff;
  b[12] = ((sr & 0x0f) << 4) | ((chMinus1 & 0x07) << 1) | ((bpsMinus1 >>> 4) & 0x01);
  b[13] = ((bpsMinus1 & 0x0f) << 4) | hi4;
  b.writeUInt32BE(lo32, 14);
  return b;
}

function buildVorbisCommentPayload(entries) {
  const vendor = Buffer.from('NocturneTestEncoder', 'utf8');
  const parts = [];
  const vLen = Buffer.alloc(4);
  vLen.writeUInt32LE(vendor.length, 0);
  parts.push(vLen, vendor);
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(entries.length, 0);
  parts.push(countBuf);
  for (const line of entries) {
    const lineBuf = Buffer.from(line, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(lineBuf.length, 0);
    parts.push(lenBuf, lineBuf);
  }
  return Buffer.concat(parts);
}

function buildFlacPicturePayload(pictureType, mime, imageBytes) {
  const mimeBuf = Buffer.from(mime, 'utf8');
  const descBuf = Buffer.from('Front Cover', 'utf8');
  const out = Buffer.alloc(4 + 4 + mimeBuf.length + 4 + descBuf.length + 16 + 4 + imageBytes.length);
  let pos = 0;
  out.writeUInt32BE(pictureType, pos); pos += 4;
  out.writeUInt32BE(mimeBuf.length, pos); pos += 4;
  mimeBuf.copy(out, pos); pos += mimeBuf.length;
  out.writeUInt32BE(descBuf.length, pos); pos += 4;
  descBuf.copy(out, pos); pos += descBuf.length;
  pos += 16; // width/height/depth/colors
  out.writeUInt32BE(imageBytes.length, pos); pos += 4;
  Buffer.from(imageBytes).copy(out, pos);
  return out;
}

const FAKE_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
]);

test('1. library.parseFlacMetadataSafe parses STREAMINFO (96kHz/24-bit), Vorbis tags, ReplayGain & block-6 PICTURE', () => {
  const streamInfo = buildFlacStreamInfo96k24b(960000); // 10 seconds
  const vorbis = buildVorbisCommentPayload([
    'TITLE=Người Hãy Quên Em Đi',
    'ARTIST=Mỹ Tâm',
    'ALBUM=Tâm 9',
    'ALBUMARTIST=Mỹ Tâm',
    'TRACKNUMBER=03/13',
    'DISCNUMBER=1',
    'DATE=2017',
    'GENRE=Pop Ballad',
    'LYRICS=[00:01.00]Dòng lời mẫu',
    'REPLAYGAIN_TRACK_GAIN=-5.25 dB',
    'REPLAYGAIN_TRACK_PEAK=0.9123'
  ]);
  const pic = buildFlacPicturePayload(3, 'image/jpeg', FAKE_JPEG);

  const flacBuf = Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    buildFlacBlockHeader(false, 0, streamInfo.length), streamInfo,
    buildFlacBlockHeader(false, 4, vorbis.length), vorbis,
    buildFlacBlockHeader(true, 6, pic.length), pic
  ]);

  const parsed = library.parseFlacMetadataSafe(flacBuf);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.sampleRate, 96000);
  assert.equal(parsed.bitDepth, 24);
  assert.equal(parsed.channels, 2);
  assert.equal(parsed.durationSeconds, 10);
  assert.equal(parsed.title, 'Người Hãy Quên Em Đi');
  assert.equal(parsed.artist, 'Mỹ Tâm');
  assert.equal(parsed.album, 'Tâm 9');
  assert.equal(parsed.albumArtist, 'Mỹ Tâm');
  assert.equal(parsed.trackNumber, 3);
  assert.equal(parsed.discNumber, 1);
  assert.equal(parsed.year, 2017);
  assert.equal(parsed.genre, 'Pop Ballad');
  assert.equal(parsed.lyrics, '[00:01.00]Dòng lời mẫu');
  assert.equal(parsed.hasReplayGain, true);
  assert.equal(parsed.replayGainTrackGain, -5.25);
  assert.equal(parsed.lastBlockReached, true);
  assert.ok(parsed.picture, 'Must extract PICTURE block');
  assert.equal(parsed.picture.format, 'image/jpeg');
  assert.deepEqual(Array.from(parsed.picture.data), Array.from(FAKE_JPEG));
});

test('2. library.parseFlacMetadataSafe handles leading ID3v2 header & Vorbis base64 METADATA_BLOCK_PICTURE', () => {
  const id3Size = 20;
  const id3 = Buffer.alloc(10 + id3Size, 0);
  id3.write('ID3', 0, 'ascii');
  id3[3] = 3; // ID3v2.3
  id3[9] = id3Size; // synchsafe size < 128

  const streamInfo = buildFlacStreamInfo96k24b(480000);
  const picPayload = buildFlacPicturePayload(3, 'image/png', FAKE_JPEG);
  const vorbis = buildVorbisCommentPayload([
    'TITLE=Vorbis B64 Art Test',
    'ARTIST=Trần Thái Hòa',
    'METADATA_BLOCK_PICTURE=' + picPayload.toString('base64')
  ]);

  const flacBuf = Buffer.concat([
    id3,
    Buffer.from('fLaC', 'ascii'),
    buildFlacBlockHeader(false, 0, streamInfo.length), streamInfo,
    buildFlacBlockHeader(true, 4, vorbis.length), vorbis
  ]);

  const parsed = library.parseFlacMetadataSafe(flacBuf);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.title, 'Vorbis B64 Art Test');
  assert.equal(parsed.artist, 'Trần Thái Hòa');
  assert.ok(parsed.picture, 'Must decode Vorbis base64 METADATA_BLOCK_PICTURE');
  assert.equal(parsed.picture.format, 'image/png');
  assert.deepEqual(Array.from(parsed.picture.data), Array.from(FAKE_JPEG));
});

test('3. cloudMetadata.readRemoteTags extracts .flac tags & cover WITHOUT window.jsmediatags (including 2-range continuation)', async () => {
  const streamInfo = buildFlacStreamInfo96k24b(960000);
  const paddingPayload = Buffer.alloc(4096, 0);
  const vorbis = buildVorbisCommentPayload([
    'TITLE=Cloud Hi-Res Track',
    'ARTIST=Lệ Quyên',
    'ALBUM=Khúc Tình Xưa'
  ]);
  const pic = buildFlacPicturePayload(3, 'image/jpeg', FAKE_JPEG);

  const fullFile = Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    buildFlacBlockHeader(false, 0, streamInfo.length), streamInfo,
    buildFlacBlockHeader(false, 4, vorbis.length), vorbis,
    buildFlacBlockHeader(false, 1, paddingPayload.length), paddingPayload,
    buildFlacBlockHeader(true, 6, pic.length), pic,
    Buffer.alloc(1024, 0xaa)
  ]);

  const rangeCalls = [];
  const mockFetch = async (url, options) => {
    const hdr = options.headers.get('range');
    rangeCalls.push(hdr);
    const m = /^bytes=(\d+)-(\d+)$/i.exec(hdr);
    const s = Number(m[1]);
    const e = Number(m[2]);
    const slice = fullFile.subarray(s, e + 1);
    return {
      status: 206,
      headers: { get: k => (k.toLowerCase() === 'content-range' ? `bytes ${s}-${s + slice.length - 1}/${fullFile.length}` : null) },
      arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
      body: { cancel() {} }
    };
  };

  // Force initial headProbeBytes smaller than full header so continuation range fetch is exercised!
  const tags = await cloudMetadata.readRemoteTags(
    null,
    { url: 'https://cloud.example/LeQuyen.flac', size: fullFile.length, name: 'LeQuyen.flac' },
    {},
    { fetch: mockFetch, headProbeBytes: 4096, maxRangeBytes: 32768 }
  );

  assert.equal(rangeCalls.length, 2, 'Should expand range fetch once when head probe lacks PICTURE block');
  assert.equal(tags.format, 'FLAC');
  assert.equal(tags.title, 'Cloud Hi-Res Track');
  assert.equal(tags.artist, 'Lệ Quyên');
  assert.equal(tags.album, 'Khúc Tình Xưa');
  assert.equal(tags.sampleRate, 96000);
  assert.equal(tags.bitDepth, 24);
  assert.ok(tags.picture && tags.picture.format === 'image/jpeg');
  assert.deepEqual(Array.from(tags.picture.data), Array.from(FAKE_JPEG));
});

test('4. metadataUtils.fetchOnlineAlbumCover & fetchOnlineArtistPortrait support iTunes/Wikipedia, reject placeholders & unsafe URLs', async () => {
  const seenUrls = [];
  const mockFetch = async (url) => {
    seenUrls.push(url);
    if (url.includes('vi.wikipedia.org/api/rest_v1/page/summary/M%E1%BB%B9_T%C3%A2m')) {
      return {
        ok: true,
        json: async () => ({ thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/my_tam_320.jpg' } })
      };
    }
    if (url.includes('itunes.apple.com/search') && url.includes('entity=album')) {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              collectionName: 'Tâm 9',
              artistName: 'Mỹ Tâm',
              artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg'
            }
          ]
        })
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const albumArt = await metadataUtils.fetchOnlineAlbumCover('Tâm 9', 'Mỹ Tâm', { fetchImpl: mockFetch, size: 300 });
  assert.equal(albumArt, 'https://is1-ssl.mzstatic.com/image/thumb/Music/300x300bb.jpg');

  const artistPortrait = await metadataUtils.fetchOnlineArtistPortrait('Mỹ Tâm', { fetchImpl: mockFetch });
  assert.equal(artistPortrait, 'https://upload.wikimedia.org/wikipedia/commons/my_tam_320.jpg');

  // Fallback to iTunes when Wikipedia misses or returns untrusted host
  const wikiMissFetch = async (url) => {
    if (url.includes('wikipedia.org')) {
      return { ok: true, json: async () => ({ thumbnail: { source: 'http://evil.example.com/x.jpg' } }) };
    }
    if (url.includes('itunes.apple.com/search')) {
      return {
        ok: true,
        json: async () => ({
          results: [{ artistName: 'Adele', collectionName: '25', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg' }]
        })
      };
    }
    return { ok: false, status: 404 };
  };
  const fallbackPortrait = await metadataUtils.fetchOnlineArtistPortrait('Adele', { fetchImpl: wikiMissFetch, size: 500 });
  assert.equal(fallbackPortrait, 'https://is1-ssl.mzstatic.com/image/thumb/a/500x500bb.jpg');

  // Generic DAP/unknown placeholders must short-circuit without network calls
  let callsBefore = seenUrls.length;
  assert.equal(await metadataUtils.fetchOnlineAlbumCover('FiiO Internal & SD Card', 'Unknown Artist', { fetchImpl: mockFetch }), '');
  assert.equal(await metadataUtils.fetchOnlineArtistPortrait('Unknown Artist', { fetchImpl: mockFetch }), '');
  assert.equal(seenUrls.length, callsBefore, 'Placeholders must not hit external APIs');
});

test('5. MainActivity.java has FLAC binary picture parser, ALBUM_ID albumart fallback, single-flight lock & v3k/v3s cache', () => {
  const java = fs.readFileSync(MAIN_ACTIVITY, 'utf8');
  assert.ok(java.includes('new java.util.concurrent.Semaphore(4)'), 'Must allow 4 concurrent cover decodes');
  assert.ok(java.includes('mCoverHashLocks'), 'Must deduplicate concurrent decodes per album hash');
  assert.ok(java.includes('COVER_NONE_TTL_MS'), 'Negative cache must expire cleanly after TTL');
  assert.ok(java.includes('extractFlacPictureFromStream(InputStream rawIn)'), 'Must parse FLAC block type 6 & base64 Vorbis art natively');
  assert.ok(java.includes('extractBinaryEmbeddedArt('), 'Must extract embedded FLAC/DSF art across both File & contentUri');
  assert.ok(java.includes('MediaStore.Audio.Media.ALBUM_ID'), 'Must query Android 10 MediaStore albumart by ALBUM_ID');
  assert.ok(java.includes('extractArtworkSubfolderCover('), 'Must check Artwork/Cover subfolders');
  assert.ok(java.includes('"v3k:"') && java.includes('"v3s:"'), 'Must invalidate stale v1/v2 cover cache namespace');
});

test('6. index.html integrates lazy cover observer, retry-once + online fallback, FLAC parser in readAudioMetadata, pickFolder relativePath + .lrc & rescan refresh', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('function observeLazyCovers(container)'), 'Must lazily load offscreen /local-cover tiles');
  assert.ok(html.includes('coverRetried'), 'Must retry transient /local-cover failure once before blacklisting');
  assert.ok(html.includes('function handleFailedLocalCoverElement(el)'), 'Must keep error listener compact and trigger online fallback');
  assert.ok(html.includes('library.parseFlacMetadataSafe(buffer'), 'readAudioMetadata must extract full FLAC tags & cover offline');
  assert.ok(html.includes('queueOnlineAlbumCover(') && html.includes('queueOnlineArtistPortrait('), 'Must auto-fetch missing album/artist artwork when online');
  assert.ok(html.includes("Object.defineProperty(file, 'relativePath'"), 'pickFolder must preserve subfolder relativePath for folder art & artist/album inference');
  assert.ok(html.includes('fiioScanUpgradedCount > 0'), 'finalizeFiioScanUi must refresh UI when existing tracks are enriched on rescan');
  assert.ok(html.includes('#collection-grid .collection-art img {\n      position: absolute !important;'), 'Must apply Chromium 74 absolute grid image rule');
  assert.ok(html.includes('FiiO M11S · v3.9.32'), 'Badge must reflect v3.9.32');
  assert.ok(html.includes('state.crossfeedNodes.output.connect(state.context.destination)'), 'CRITICAL Web Audio graph invariant must hold');
});

test('7. Version sync v3.9.32 (versionCode 86) & Unix LF asset parity', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const sw = fs.readFileSync(SW_JS, 'utf8');
  const gradle = fs.readFileSync(BUILD_GRADLE, 'utf8');
  assert.ok(sw.includes("const CACHE_VERSION = 'v3.9.32';"));
  assert.ok(sw.includes("const CACHE_NAME = 'nocturne-v3.9.32';"));
  assert.ok(/versionCode\s*=\s*86\b/.test(gradle));
  assert.ok(/versionName\s*=\s*"3\.9\.32"/.test(gradle));
  for (const name of ['index.html', 'sw.js', 'library-utils.js', 'cloud-metadata.js', 'metadata-utils.js']) {
    const rootText = fs.readFileSync(path.join(ROOT, name), 'utf8');
    const assetText = fs.readFileSync(path.join(ASSETS_DIR, name), 'utf8');
    assert.equal(assetText, rootText, `${name} must match Android assets`);
    assert.ok(!assetText.includes('\r'), `${name} in Android assets must use Unix LF (0 CR bytes)`);
  }
});
