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

function buildId3v24TxxxFrame(key, val) {
  const te = new TextEncoder();
  const kBytes = te.encode(key);
  const vBytes = te.encode(val);
  const payload = concatU8(new Uint8Array([0x03]), kBytes, new Uint8Array([0x00]), vBytes, new Uint8Array([0x00]));
  const header = new Uint8Array(10);
  for (let i = 0; i < 4; i++) header[i] = 'TXXX'.charCodeAt(i);
  header.set(encodeSyncsafe32(payload.byteLength), 4);
  return concatU8(header, payload);
}

function buildId3v24Rva2Frame(identification, gainDb, peakFloat = null, channelType = 1, peakBits = 16) {
  const te = new TextEncoder();
  const idBytes = te.encode(identification);
  const nullByte = new Uint8Array([0x00]);

  // Gain is signed 16-bit integer representing dB * 512
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

function buildWavFileWithId3(id3TagBytes, audioDataBytes = 128) {
  // RIFF header (12 bytes)
  // 'fmt ' chunk (24 bytes)
  // 'id3 ' chunk (8 bytes + id3TagBytes)
  // 'data' chunk (8 bytes + audioDataBytes)
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
  fmtDv.setUint16(10, 2, true); // 2 channels
  fmtDv.setUint32(12, 44100, true); // 44.1kHz
  fmtDv.setUint32(16, 44100 * 2 * 2, true); // byteRate
  fmtDv.setUint16(20, 4, true); // blockAlign
  fmtDv.setUint16(22, 16, true); // 16-bit

  const dataChunk = new Uint8Array(8 + audioDataBytes);
  const dataDv = new DataView(dataChunk.buffer);
  for (let i = 0; i < 4; i++) dataChunk[i] = 'data'.charCodeAt(i);
  dataDv.setUint32(4, audioDataBytes, true);

  const riffBody = concatU8(new Uint8Array([0x57, 0x41, 0x56, 0x45]), fmtChunk, id3Chunk, dataChunk); // 'WAVE'
  const riffHeader = new Uint8Array(8);
  for (let i = 0; i < 4; i++) riffHeader[i] = 'RIFF'.charCodeAt(i);
  const riffDv = new DataView(riffHeader.buffer);
  riffDv.setUint32(4, riffBody.byteLength, true);

  return concatU8(riffHeader, riffBody);
}

function buildAiffFileWithId3(id3TagBytes, audioDataBytes = 128) {
  // FORM header (12 bytes, big-endian)
  // 'COMM' chunk (26 bytes)
  // 'ID3 ' chunk (8 bytes + id3TagBytes)
  // 'SSND' chunk (16 bytes + audioDataBytes)
  const id3Padded = concatU8(id3TagBytes, (id3TagBytes.byteLength & 1) ? new Uint8Array(1) : new Uint8Array(0));
  const id3Chunk = new Uint8Array(8 + id3Padded.byteLength);
  const id3Dv = new DataView(id3Chunk.buffer);
  for (let i = 0; i < 4; i++) id3Chunk[i] = 'ID3 '.charCodeAt(i);
  id3Dv.setUint32(4, id3TagBytes.byteLength, false); // big-endian
  id3Chunk.set(id3Padded, 8);

  const commChunk = new Uint8Array(26);
  const commDv = new DataView(commChunk.buffer);
  for (let i = 0; i < 4; i++) commChunk[i] = 'COMM'.charCodeAt(i);
  commDv.setUint32(4, 18, false);
  commDv.setUint16(8, 2, false); // channels
  commDv.setUint32(10, 44100, false); // sampleFrames
  commDv.setUint16(14, 16, false); // bitDepth
  // 80-bit IEEE extended float for 44100: exp = 0x400E, mantissa = 0xAC440000 00000000
  commChunk[16] = 0x40; commChunk[17] = 0x0e;
  commChunk[18] = 0xac; commChunk[19] = 0x44;

  const ssndChunk = new Uint8Array(16 + audioDataBytes);
  const ssndDv = new DataView(ssndChunk.buffer);
  for (let i = 0; i < 4; i++) ssndChunk[i] = 'SSND'.charCodeAt(i);
  ssndDv.setUint32(4, 8 + audioDataBytes, false);

  const formBody = concatU8(new Uint8Array([0x41, 0x49, 0x46, 0x46]), commChunk, id3Chunk, ssndChunk); // 'AIFF'
  const formHeader = new Uint8Array(8);
  for (let i = 0; i < 4; i++) formHeader[i] = 'FORM'.charCodeAt(i);
  const formDv = new DataView(formHeader.buffer);
  formDv.setUint32(4, formBody.byteLength, false);

  return concatU8(formHeader, formBody);
}

describe('BUG-12 — Binary ID3v2.4 RVA2 Frame & WAV/AIFF ReplayGain Extractor', () => {
  it('exposes decodeRva2FramePayload on library module', () => {
    assert.equal(typeof lib.decodeRva2FramePayload, 'function', 'decodeRva2FramePayload must be exported');
  });

  it('decodes ID3v2.4 RVA2 frame payload with track volume adjustment and peak', () => {
    // -6.50 dB, peak 0.988553 (16-bit)
    const frame = buildId3v24Rva2Frame('track', -6.5, 0.988553, 1, 16);
    // Payload starts at offset 10 (after 10-byte frame header)
    const payload = frame.subarray(10);
    const decoded = lib.decodeRva2FramePayload(payload);

    assert.ok(decoded, 'Decoded result must not be null');
    assert.equal(decoded.scope, 'track');
    assert.equal(decoded.identification, 'track');
    assert.ok(Math.abs(decoded.gainDb - (-6.5)) < 0.01, `Expected ~ -6.5 dB, got ${decoded.gainDb}`);
    assert.ok(decoded.peak > 0.98 && decoded.peak < 0.99, `Expected ~ 0.988, got ${decoded.peak}`);
  });

  it('decodes ID3v2.4 RVA2 frame payload with album volume adjustment', () => {
    // +2.25 dB, peak 0.850000
    const frame = buildId3v24Rva2Frame('album', 2.25, 0.85, 1, 16);
    const payload = frame.subarray(10);
    const decoded = lib.decodeRva2FramePayload(payload);

    assert.ok(decoded);
    assert.equal(decoded.scope, 'album');
    assert.equal(decoded.identification, 'album');
    assert.ok(Math.abs(decoded.gainDb - 2.25) < 0.01, `Expected ~ 2.25 dB, got ${decoded.gainDb}`);
    assert.ok(Math.abs(decoded.peak - 0.85) < 0.01, `Expected ~ 0.85, got ${decoded.peak}`);
  });

  it('extracts RVA2 ReplayGain tags from standalone ID3v2.4 tag', () => {
    const rvaTrack = buildId3v24Rva2Frame('track', -5.2, 0.95);
    const rvaAlbum = buildId3v24Rva2Frame('album', -3.1, 0.92);
    const tag = buildId3v24Tag([rvaTrack, rvaAlbum]);

    const res = lib.extractBinaryReplayGainTags(tag);
    assert.equal(res.valid, true);
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.hasRva2, true);
    assert.equal(res.hasTrackGain, true);
    assert.equal(res.hasAlbumGain, true);
    assert.ok(Math.abs(res.trackGain - (-5.2)) < 0.02);
    assert.ok(Math.abs(res.albumGain - (-3.1)) < 0.02);
  });

  it('processes TXXX and RVA2 in parallel: complementary fallback', () => {
    // Case 1: TXXX has track gain, RVA2 has album gain
    const txxxTrack = buildId3v24TxxxFrame('REPLAYGAIN_TRACK_GAIN', '-7.00 dB');
    const rvaAlbum = buildId3v24Rva2Frame('album', -4.5, 0.88);
    const tag = buildId3v24Tag([txxxTrack, rvaAlbum]);

    const res = lib.extractBinaryReplayGainTags(tag);
    assert.equal(res.valid, true);
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.hasTrackGain, true);
    assert.equal(res.hasAlbumGain, true);
    assert.ok(Math.abs(res.trackGain - (-7.0)) < 0.01);
    assert.ok(Math.abs(res.albumGain - (-4.5)) < 0.02);
  });

  it('extracts ReplayGain from WAV file with embedded id3 chunk containing RVA2', () => {
    const rvaTrack = buildId3v24Rva2Frame('track', -8.0, 0.99);
    const id3Tag = buildId3v24Tag([rvaTrack]);
    const wavFile = buildWavFileWithId3(id3Tag);

    const res = lib.extractBinaryReplayGainTags(wavFile);
    assert.equal(res.valid, true);
    assert.equal(res.format, 'WAV');
    assert.equal(res.source, 'wav_id3v2');
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.hasRva2, true);
    assert.ok(Math.abs(res.trackGain - (-8.0)) < 0.02);
  });

  it('extracts ReplayGain from AIFF file with embedded ID3 chunk containing RVA2', () => {
    const rvaTrack = buildId3v24Rva2Frame('track', -4.2, 0.90);
    const id3Tag = buildId3v24Tag([rvaTrack]);
    const aiffFile = buildAiffFileWithId3(id3Tag);

    const res = lib.extractBinaryReplayGainTags(aiffFile);
    assert.equal(res.valid, true);
    assert.equal(res.format, 'AIFF');
    assert.equal(res.source, 'aiff_id3v2');
    assert.equal(res.hasReplayGain, true);
    assert.equal(res.hasRva2, true);
    assert.ok(Math.abs(res.trackGain - (-4.2)) < 0.02);
  });

  it('parseReplayGain parses RVA2 tags and buffers seamlessly', () => {
    // 1. Direct RVA2 string tag candidates
    const resString = lib.parseReplayGain({
      tags: {
        RVA2_TRACK_GAIN: '-6.20 dB',
        RVA2_TRACK_PEAK: '0.970000',
        RVA2_ALBUM_GAIN: '-4.10 dB',
        RVA2_ALBUM_PEAK: '0.920000'
      }
    });
    assert.equal(resString.hasReplayGain, true);
    assert.equal(resString.trackGain, -6.2);
    assert.equal(resString.albumGain, -4.1);

    // 2. Raw RVA2 frame payload buffer
    const frame = buildId3v24Rva2Frame('track', -5.5, 0.91);
    const resBuffer = lib.parseReplayGain({
      tags: {
        RVA2: frame.subarray(10)
      }
    });
    assert.equal(resBuffer.hasReplayGain, true);
    assert.ok(Math.abs(resBuffer.trackGain - (-5.5)) < 0.02);
  });

  it('Web Audio graph crossfeed invariant remains intact', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Web Audio crossfeed invariant must be 100% intact'
    );
  });
});
