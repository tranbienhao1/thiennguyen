const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const libraryUtilsPath = path.join(__dirname, '..', 'library-utils.js');
const libraryUtilsCode = fs.readFileSync(libraryUtilsPath, 'utf8');

const sandbox = {
  window: {},
  document: {},
  navigator: { userAgent: 'NodeTest' },
  performance: { now: () => Date.now() },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Uint8Array,
  DataView,
  ArrayBuffer,
  Math,
  Number,
  String,
  Set,
  Map,
  TextEncoder,
  TextDecoder
};
vm.createContext(sandbox);
vm.runInContext(libraryUtilsCode, sandbox);
const lib = sandbox.library || sandbox.NocturneLibrary;

function concatU8(...arrays) {
  const total = arrays.reduce((acc, a) => acc + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.byteLength;
  }
  return out;
}

function encodeSyncsafe32(val) {
  return new Uint8Array([
    (val >>> 21) & 0x7f,
    (val >>> 14) & 0x7f,
    (val >>> 7) & 0x7f,
    val & 0x7f
  ]);
}

function buildId3v24Tag(framesBytes, paddingBytes = 8) {
  const body = concatU8(...framesBytes, new Uint8Array(paddingBytes));
  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = 4;    // v2.4
  header[4] = 0;
  header[5] = 0;
  header.set(encodeSyncsafe32(body.byteLength), 6);
  return concatU8(header, body);
}

function buildId3v24Rva2Frame(identification, gainDb, peakFloat = null, channelType = 1, peakBits = 16) {
  const te = new TextEncoder();
  const idBytes = te.encode(identification);
  const nullByte = new Uint8Array([0x00]);

  const signedAdj = Math.round(gainDb * 512);
  const rawAdj = (signedAdj < 0) ? (signedAdj + 0x10000) : signedAdj;
  const adjBytes = new Uint8Array([(rawAdj >>> 8) & 0xff, rawAdj & 0xff]);

  const peakBytesCount = peakFloat !== null && peakBits > 0 ? Math.ceil(peakBits / 8) : 0;
  const channelHeader = new Uint8Array([channelType, adjBytes[0], adjBytes[1], peakBytesCount > 0 ? peakBits : 0]);

  let peakBytes = new Uint8Array(0);
  if (peakBytesCount > 0) {
    const maxVal = Math.pow(2, peakBits) - 1;
    const rawPeak = Math.round(peakFloat * maxVal);
    peakBytes = new Uint8Array(peakBytesCount);
    for (let b = peakBytesCount - 1; b >= 0; b--) {
      peakBytes[b] = (rawPeak >>> ((peakBytesCount - 1 - b) * 8)) & 0xff;
    }
  }

  const payload = concatU8(idBytes, nullByte, channelHeader, peakBytes);
  const header = new Uint8Array(10);
  for (let i = 0; i < 4; i++) header[i] = 'RVA2'.charCodeAt(i);
  header.set(encodeSyncsafe32(payload.byteLength), 4);
  return concatU8(header, payload);
}

function buildWavFileWithId3(id3TagBytes, audioDataBytes = 100000) {
  const id3Padded = concatU8(id3TagBytes, (id3TagBytes.byteLength & 1) ? new Uint8Array(1) : new Uint8Array(0));
  const id3Chunk = new Uint8Array(8 + id3Padded.byteLength);
  const id3Dv = new DataView(id3Chunk.buffer);
  for (let i = 0; i < 4; i++) id3Chunk[i] = 'id3 '.charCodeAt(i);
  id3Dv.setUint32(4, id3TagBytes.byteLength, true);
  id3Chunk.set(id3Padded, 8);

  const fmtChunk = new Uint8Array(24);
  const fmtDv = new DataView(fmtChunk.buffer);
  for (let i = 0; i < 4; i++) fmtChunk[i] = 'fmt '.charCodeAt(i);
  fmtDv.setUint32(4, 16, true);
  fmtDv.setUint16(8, 1, true); // PCM
  fmtDv.setUint16(10, 2, true); // stereo
  fmtDv.setUint32(12, 44100, true);
  fmtDv.setUint32(16, 44100 * 4, true);
  fmtDv.setUint16(20, 4, true);
  fmtDv.setUint16(22, 16, true);

  const dataChunk = new Uint8Array(8 + audioDataBytes);
  const dataDv = new DataView(dataChunk.buffer);
  for (let i = 0; i < 4; i++) dataChunk[i] = 'data'.charCodeAt(i);
  dataDv.setUint32(4, audioDataBytes, true);

  const riffBody = concatU8(new Uint8Array([0x57, 0x41, 0x56, 0x45]), fmtChunk, id3Chunk, dataChunk);
  const riffHeader = new Uint8Array(8);
  for (let i = 0; i < 4; i++) riffHeader[i] = 'RIFF'.charCodeAt(i);
  const riffDv = new DataView(riffHeader.buffer);
  riffDv.setUint32(4, riffBody.byteLength, true);

  return concatU8(riffHeader, riffBody);
}

describe('UPG-12 — Unified 64KB Head Slice ReplayGain & Fingerprint Extractor', () => {
  it('exposes readHeadSliceReplayGainAndFingerprintAsync on library and NocturneLibrary', () => {
    assert.equal(typeof lib.readHeadSliceReplayGainAndFingerprintAsync, 'function',
      'Must expose readHeadSliceReplayGainAndFingerprintAsync');
  });

  it('unifies 64KB zero-copy read for both binary ReplayGain and audio fingerprint in 1 single pass', async () => {
    const rvaTrack = buildId3v24Rva2Frame('track', -6.5, 0.985);
    const rvaAlbum = buildId3v24Rva2Frame('album', -3.2, 0.91);
    const id3Tag = buildId3v24Tag([rvaTrack, rvaAlbum]);
    const wavAudio = buildWavFileWithId3(id3Tag, 80000);

    let fileSliceCallCount = 0;
    const mockFileHandle = {
      kind: 'file',
      name: 'test_audiophile_track.wav',
      getFile: async () => ({
        name: 'test_audiophile_track.wav',
        size: wavAudio.byteLength,
        slice: (start, end) => {
          fileSliceCallCount++;
          return {
            size: Math.max(0, end - start),
            arrayBuffer: async () => wavAudio.slice(start, end).buffer
          };
        }
      })
    };

    const res = await lib.readHeadSliceReplayGainAndFingerprintAsync(mockFileHandle);

    assert.ok(res, 'Result must exist');
    assert.equal(fileSliceCallCount, 1, 'Must read head slice exactly ONCE without duplicate I/O');
    assert.ok(res.fingerprintKey, 'Must compute fingerprintKey');
    assert.ok(res.hashHex, 'Must compute hashHex');
    assert.equal(res.hasReplayGain, true, 'Must extract ReplayGain from same slice');
    assert.ok(Math.abs(res.trackGain - (-6.5)) < 0.02, `Expected ~ -6.5 dB track gain, got ${res.trackGain}`);
    assert.ok(Math.abs(res.albumGain - (-3.2)) < 0.02, `Expected ~ -3.2 dB album gain, got ${res.albumGain}`);
    assert.ok(res.trackPeak > 0.97 && res.trackPeak < 0.99, `Expected ~ 0.985 track peak, got ${res.trackPeak}`);
  });

  it('computeSourceFingerprint64kAsync supports { withReplayGain: true } option seamlessly', async () => {
    const rvaTrack = buildId3v24Rva2Frame('track', -4.8, 0.94);
    const id3Tag = buildId3v24Tag([rvaTrack]);
    const wavAudio = buildWavFileWithId3(id3Tag, 50000);

    const fpWithRg = await lib.computeSourceFingerprint64kAsync(wavAudio, { withReplayGain: true });

    assert.ok(fpWithRg.fingerprintKey);
    assert.ok(fpWithRg.hashHex);
    assert.equal(fpWithRg.hasReplayGain, true);
    assert.ok(fpWithRg.replayGain);
    assert.ok(Math.abs(fpWithRg.replayGain.trackGain - (-4.8)) < 0.02);
  });

  it('Web Audio graph crossfeed invariant remains intact', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio crossfeed invariant must be 100% intact'
    );
  });
});
