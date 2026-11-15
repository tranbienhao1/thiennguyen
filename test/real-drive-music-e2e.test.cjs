const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('../library-utils.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const testDir = 'C:\\Users\\thien\\Music\\DriveMusicTest';

test('E2E Real Google Drive Music Files Validation Suite', async (t) => {
  const file1Path = path.join(testDir, '06 buitruonglinh - Nàng Công Chúa Nhỏ (Interlude).flac');
  const file2Path = path.join(testDir, '08 Low G - Giải Cứu Mỹ Nhân.flac');
  const lrcPath = path.join(testDir, '08 Low G - Giải Cứu Mỹ Nhân.lrc');
  const coverPath = path.join(testDir, 'cover.jpg');

  await t.test('1. Verify real files downloaded from user Drive exist and are valid', () => {
    assert.ok(fs.existsSync(file1Path), 'buitruonglinh track must exist');
    assert.ok(fs.existsSync(file2Path), 'Low G track must exist');
    assert.ok(fs.existsSync(lrcPath), 'Low G lyrics must exist');
    assert.ok(fs.existsSync(coverPath), 'Cover art must exist');

    const s1 = fs.statSync(file1Path).size;
    const s2 = fs.statSync(file2Path).size;
    const slrc = fs.statSync(lrcPath).size;
    const scover = fs.statSync(coverPath).size;

    assert.ok(s1 > 20 * 1024 * 1024, `buitruonglinh track size (${s1}) should be > 20MB`);
    assert.ok(s2 > 40 * 1024 * 1024, `Low G track size (${s2}) should be > 40MB`);
    assert.ok(slrc > 1000, `Lyrics size (${slrc}) should be > 1KB`);
    assert.ok(scover > 100000, `Cover art size (${scover}) should be > 100KB`);
  });

  await t.test('2. FLAC Audio Header & Technical Specs Parsing on real files', () => {
    // Test parsing FLAC STREAMINFO block directly as index.html does
    function parseFlacHeader(buffer) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      function text(start, len) {
        let str = '';
        for (let i = 0; i < len; i++) str += String.fromCharCode(view.getUint8(start + i));
        return str;
      }
      let flacOffset = 0;
      if (view.byteLength >= 10 && text(0, 3) === 'ID3') {
        const flags = view.getUint8(5);
        const tagSize = ((view.getUint8(6) & 0x7f) << 21) | ((view.getUint8(7) & 0x7f) << 14) | ((view.getUint8(8) & 0x7f) << 7) | (view.getUint8(9) & 0x7f);
        flacOffset = 10 + tagSize + ((flags & 0x10) ? 10 : 0);
      }
      assert.ok(view.byteLength >= flacOffset + 42, 'Buffer must be large enough');
      assert.equal(text(flacOffset, 4), 'fLaC', 'Must start with fLaC magic bytes');

      let offset = flacOffset + 4;
      while (offset + 4 <= view.byteLength) {
        const header = view.getUint8(offset), type = header & 0x7f;
        const length = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);
        const dataOffset = offset + 4;
        if (dataOffset + length > view.byteLength) break;
        if (type === 0 && length >= 34) {
          const packed = view.getBigUint64(dataOffset + 10, false);
          const sampleRate = Number((packed >> 44n) & 0xfffffn);
          const channels = Number((packed >> 41n) & 0x7n) + 1;
          const bitDepth = Number((packed >> 36n) & 0x1fn) + 1;
          return { sampleRate, bitDepth, channels };
        }
        offset = dataOffset + length;
        if (header & 0x80) break;
      }
      return null;
    }

    const b1 = fs.readFileSync(file1Path);
    const tech1 = parseFlacHeader(b1.subarray(0, 512 * 1024));
    assert.ok(tech1, 'Must successfully parse buitruonglinh FLAC header');
    assert.equal(tech1.channels, 2, 'Must be stereo');
    assert.ok([44100, 48000, 96000].includes(tech1.sampleRate), `Sample rate must be valid standard (${tech1.sampleRate})`);
    assert.ok([16, 24].includes(tech1.bitDepth), `Bit depth must be 16 or 24 bit (${tech1.bitDepth})`);

    const b2 = fs.readFileSync(file2Path);
    const tech2 = parseFlacHeader(b2.subarray(0, 512 * 1024));
    assert.ok(tech2, 'Must successfully parse Low G FLAC header');
    assert.equal(tech2.channels, 2, 'Must be stereo');
    assert.ok([44100, 48000, 96000].includes(tech2.sampleRate), `Sample rate must be valid standard (${tech2.sampleRate})`);
    assert.ok([16, 24].includes(tech2.bitDepth), `Bit depth must be 16 or 24 bit (${tech2.bitDepth})`);
  });

  await t.test('3. Metadata & Lyric Parsing on real Drive files', () => {
    // 3.1 Filename metadata resolution
    const meta1 = library.parseFilenameMetadata(path.basename(file1Path));
    assert.equal(meta1.artist, 'buitruonglinh');
    assert.equal(meta1.title, 'Nàng Công Chúa Nhỏ (Interlude)');

    const meta2 = library.parseFilenameMetadata(path.basename(file2Path));
    assert.equal(meta2.artist, 'Low G');
    assert.equal(meta2.title, 'Giải Cứu Mỹ Nhân');

    // 3.2 Lyrics parsing
    const lrcContent = fs.readFileSync(lrcPath, 'utf8');
    const lyrics = library.parseLyrics(lrcContent);
    assert.ok(lyrics.length > 50, 'Lyrics must contain over 50 lines');
    assert.ok(lyrics[0].text.length > 0, 'First lyric line has text');
    assert.ok(typeof lyrics[0].time === 'number', 'First lyric line has timestamp');

    // 3.3 Folder art resolution
    const dummyFiles = [
      { name: path.basename(file1Path), relativePath: path.basename(file1Path) },
      { name: path.basename(file2Path), relativePath: path.basename(file2Path) },
      { name: 'cover.jpg', relativePath: 'cover.jpg' }
    ];
    const artCandidates = library.extractFolderArtCandidates(dummyFiles);
    assert.equal(artCandidates.length, 1);
    assert.equal(artCandidates[0].name, 'cover.jpg');
  });

  await t.test('4. Streaming First Slice offset calculation on real files', () => {
    const b1 = fs.readFileSync(file1Path);
    const offset1 = library.flacFirstFrameOffset(new Uint8Array(b1.buffer, b1.byteOffset, Math.min(b1.length, 1048576)));
    assert.ok(offset1 > 0, 'Offset for track 1 must be greater than 0');
    assert.ok(offset1 < 1048576, 'Offset for track 1 must be within 1MB first-slice buffer');

    const b2 = fs.readFileSync(file2Path);
    const offset2 = library.flacFirstFrameOffset(new Uint8Array(b2.buffer, b2.byteOffset, Math.min(b2.length, 1048576)));
    assert.ok(offset2 > 0, 'Offset for track 2 must be greater than 0');
    assert.ok(offset2 < 1048576, 'Offset for track 2 must be within 1MB first-slice buffer');
  });

  await t.test('5. Waveform peak generation on real audio sample', () => {
    // Generate simulated audio buffer from the real FLAC file slice
    const sampleBytes = fs.readFileSync(file1Path).subarray(200000, 200000 + 16384);
    const floatArr = new Float32Array(sampleBytes.length / 2);
    for (let i = 0; i < floatArr.length; i++) {
      const int16 = (sampleBytes[i * 2 + 1] << 8) | sampleBytes[i * 2];
      floatArr[i] = int16 / 32768;
    }
    const peaks = library.generateWaveformPeaks(floatArr, 100);
    assert.equal(peaks.length, 100, 'Peaks array must match bucket count');
    for (let i = 0; i < peaks.length; i++) {
      assert.ok(peaks[i] >= 0 && peaks[i] <= 1, `Peak at ${i} must be normalized [0, 1]`);
    }
  });

  await t.test('6. Absolute Invariant: Web Audio Graph Preservation', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output must connect directly to state.context.destination'
    );
  });
});
