'use strict';

(function (root, factory) {
  let libRef = null;
  if (typeof module === 'object' && module.exports) {
    try { libRef = require('./library-utils.js'); } catch (_) {}
  }
  if (!libRef && root) {
    libRef = root.NocturneLibrary || root.library || null;
  }
  const api = factory(root, () => libRef || (root && (root.NocturneLibrary || root.library)) || null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NocturneCloudMetadata = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root, getLib) {
  const MAX_RANGE = 8 * 1024 * 1024, MAX_TOTAL = 16 * 1024 * 1024;
  const MP4_HINT_RE = /\.(?:m4a|mp4|m4b|alac)(?:$|[?#])/i;

  function isMp4SourceHint(source) {
    if (!source || typeof source !== 'object') return false;
    const nameOrUrl = String(source.name || source.filename || source.url || '');
    if (MP4_HINT_RE.test(nameOrUrl)) return true;
    const mime = String(source.mimeType || source.type || '').toLowerCase();
    return mime.includes('mp4') || mime.includes('m4a') || mime.includes('alac');
  }

  function makeRangeReader(fetchImpl, options = {}, limits = {}) {
    const maxRange = Math.max(1, Number(limits.maxRangeBytes) || MAX_RANGE);
    const maxTotal = Math.max(maxRange, Number(limits.maxTotalBytes) || MAX_TOTAL);
    return class CloudRangeFileReader {
      constructor(source) {
        this.source = source; this.size = Number(source && source.size); this.segments = []; this.loaded = 0;
        if (!Number.isSafeInteger(this.size) || this.size <= 0) throw new Error('Cloud file size unavailable for metadata range reads.');
      }
      init(callbacks) { setTimeout(callbacks.onSuccess, 0); }
      getSize() { return this.size; }
      loadRange([start, end], callbacks = {}) {
        const fail = info => callbacks.onError && callbacks.onError({type:'range', info});
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= this.size) return fail('Metadata range is outside the cloud file.');
        const length = end - start + 1;
        if (length > maxRange || this.loaded + length > maxTotal) return fail(`Metadata read exceeded its ${maxTotal}-byte safety limit.`);
        if (this.segments.some(part => part.start <= start && part.end >= end)) return setTimeout(callbacks.onSuccess, 0);
        const headers = new Headers(options.headers || {}); headers.set('Range', `bytes=${start}-${end}`);
        const request = {...options, method:'GET', headers, cache:'no-store'}; delete request.body;
        Promise.resolve().then(() => fetchImpl(this.source.url, request)).then(async response => {
          if (!response || response.status !== 206) {
            try { response && response.body && response.body.cancel(); } catch (error) {}
            throw new Error(`Byte ranges unavailable (HTTP ${response && response.status || 'no response'}); full-download fallback is disabled.`);
          }
          const header = response.headers && response.headers.get('content-range');
          if (header) {
            const match = header.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
            if (!match || Number(match[1]) !== start || Number(match[2]) !== end || (match[3] !== '*' && Number(match[3]) !== this.size)) {
              try { response.body && response.body.cancel(); } catch (error) {}
              throw new Error('Cloud provider returned a mismatched Content-Range.');
            }
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength !== length) throw new Error('Cloud provider returned an incomplete byte range.');
          this.segments.push({start, end, bytes}); this.loaded += bytes.byteLength;
          callbacks.onSuccess && callbacks.onSuccess();
        }).catch(error => fail(error && error.message || String(error)));
      }
      getByteAt(offset) {
        for (let i = this.segments.length - 1; i >= 0; i--) {
          const part = this.segments[i];
          if (offset >= part.start && offset <= part.end) return part.bytes[offset - part.start];
        }
        throw new Error(`Metadata parser accessed unloaded byte ${offset}.`);
      }
      readUint8Slice(offset, length) {
        if (length <= 0) return new Uint8Array(0);
        for (let i = this.segments.length - 1; i >= 0; i--) {
          const part = this.segments[i];
          if (offset >= part.start && (offset + length - 1) <= part.end) {
            const rel = offset - part.start;
            return part.bytes.subarray(rel, rel + length);
          }
        }
        const out = new Uint8Array(length);
        for (let k = 0; k < length; k++) out[k] = this.getByteAt(offset + k);
        return out;
      }
      getBytesAt(offset, length) { return Array.from({length}, (_, i) => this.getByteAt(offset + i)); }
      isBitSetAt(offset, bit) { return (this.getByteAt(offset) & (1 << bit)) !== 0; }
      getSByteAt(offset) { const value = this.getByteAt(offset); return value > 127 ? value - 256 : value; }
      getCharAt(offset) { return String.fromCharCode(this.getByteAt(offset)); }
      getShortAt(offset, be) { return be ? (this.getByteAt(offset) << 8) + this.getByteAt(offset + 1) : (this.getByteAt(offset + 1) << 8) + this.getByteAt(offset); }
      getSShortAt(offset, be) { const n = this.getShortAt(offset, be); return n > 32767 ? n - 65536 : n; }
      getLongAt(offset, be) {
        const b = this.getBytesAt(offset, 4);
        return be ? (((b[0] * 256 + b[1]) * 256 + b[2]) * 256 + b[3]) : (((b[3] * 256 + b[2]) * 256 + b[1]) * 256 + b[0]);
      }
      getSLongAt(offset, be) { const n = this.getLongAt(offset, be); return n > 2147483647 ? n - 4294967296 : n; }
      getInteger24At(offset, be) { const b = this.getBytesAt(offset, 3); return be ? (b[0] << 16) + (b[1] << 8) + b[2] : (b[2] << 16) + (b[1] << 8) + b[0]; }
      getSynchsafeInteger32At(offset) { return ((this.getByteAt(offset) & 127) << 21) | ((this.getByteAt(offset + 1) & 127) << 14) | ((this.getByteAt(offset + 2) & 127) << 7) | (this.getByteAt(offset + 3) & 127); }
      getStringAt(offset, length) {
        let value = '';
        for (let end = offset + length; offset < end; offset += 8192) value += String.fromCharCode(...this.getBytesAt(offset, Math.min(8192, end - offset)));
        return value;
      }
      getStringWithCharsetAt(offset, length, charset) {
        const bytes = this.readUint8Slice(offset, length);
        const selectedCharset = String(charset || 'windows-1252').toLowerCase();
        const decoderCharset = selectedCharset === 'utf-16' ? 'utf-16le' : selectedCharset;
        try { return new TextDecoder(decoderCharset).decode(bytes).replace(/\0+$/g, ''); }
        catch (error) { return this.getStringAt(offset, length).replace(/\0+$/g, ''); }
      }
    };
  }

  function loadReaderRangeAsync(reader, start, end) {
    return new Promise((resolve, reject) => {
      reader.loadRange([start, end], {
        onSuccess: () => {
          try {
            resolve(reader.readUint8Slice(start, end - start + 1));
          } catch (err) {
            reject(err);
          }
        },
        onError: error => reject(new Error((error && (error.info || error.message)) || 'Could not load metadata byte range.'))
      });
    });
  }

  function readTopBoxHeaderFromSlice(slice, relPos, remainingFileBytes) {
    if (!slice || relPos + 8 > slice.byteLength) return null;
    const dv = new DataView(slice.buffer, slice.byteOffset + relPos, slice.byteLength - relPos);
    const size32 = dv.getUint32(0, false);
    let type = '';
    for (let i = 0; i < 4; i++) {
      const c = slice[relPos + 4 + i];
      if (!((c >= 0x20 && c <= 0x7e) || c === 0xa9)) return null;
      type += String.fromCharCode(c);
    }
    if (size32 === 1) {
      if (relPos + 16 > slice.byteLength) return { type, needs16ByteHeader: true };
      const hi = dv.getUint32(8, false);
      const lo = dv.getUint32(12, false);
      const largeSize = hi * 4294967296 + lo;
      if (!Number.isSafeInteger(largeSize) || largeSize < 16) return null;
      return { type, headerSize: 16, boxSize: largeSize, isZeroEof: false };
    }
    if (size32 === 0) {
      return { type, headerSize: 8, boxSize: Math.max(8, remainingFileBytes), isZeroEof: true };
    }
    if (size32 < 8) return null;
    return { type, headerSize: 8, boxSize: size32, isZeroEof: false };
  }

  function convertParsedMp4ToRemoteTags(ilstRes, techRes) {
    const out = {};
    if (ilstRes && ilstRes.valid) {
      if (ilstRes.title) out.title = ilstRes.title;
      if (ilstRes.artist) out.artist = ilstRes.artist;
      if (ilstRes.album) out.album = ilstRes.album;
      if (ilstRes.albumArtist) {
        out.albumartist = ilstRes.albumArtist;
        out.albumArtist = ilstRes.albumArtist;
      }
      if (ilstRes.track) out.track = ilstRes.track;
      if (ilstRes.trackNumber) out.trackNumber = ilstRes.trackNumber;
      if (ilstRes.totalTracks) out.totalTracks = ilstRes.totalTracks;
      if (ilstRes.genre) out.genre = ilstRes.genre;
      if (ilstRes.year) out.year = ilstRes.year;
      if (ilstRes.lyrics) out.lyrics = ilstRes.lyrics;
      if (ilstRes.picture) out.picture = ilstRes.picture;
      if (ilstRes.iTunNORM) out.iTunNORM = ilstRes.iTunNORM;
      if (ilstRes.itunNorm) out.itunNorm = ilstRes.itunNorm;
      if (ilstRes.hasReplayGain) {
        out.hasReplayGain = true;
        out.replayGainSource = ilstRes.replayGainSource;
        out.replayGainTrackGain = ilstRes.trackGain;
        out.replayGainTrackPeak = ilstRes.trackPeak;
        if (ilstRes.hasAlbumGain) {
          out.replayGainAlbumGain = ilstRes.albumGain;
          out.replayGainAlbumPeak = ilstRes.albumPeak;
        }
      }
      if (ilstRes.rawTags && Object.keys(ilstRes.rawTags).length > 0) {
        out.rawTags = ilstRes.rawTags;
      }
    }
    if (techRes && techRes.valid) {
      if (techRes.sampleRate > 0) out.sampleRate = techRes.sampleRate;
      if (techRes.bitDepth > 0) out.bitDepth = techRes.bitDepth;
      if (techRes.channels > 0) out.channels = techRes.channels;
      if (techRes.durationSeconds > 0) out.duration = techRes.durationSeconds;
      if (techRes.codec && techRes.codec !== 'unknown') out.codec = techRes.codec;
      if (techRes.format) out.format = techRes.format;
    }
    return out;
  }

  async function readRemoteMp4Ilst(source, options = {}, limits = {}) {
    if (!source || !source.url || !(Number(source.size) > 0)) {
      throw new Error('A cloud URL and file size are required for tag ranges.');
    }
    const fetchImpl = limits.fetch || (typeof fetch === 'function' && fetch.bind(globalThis));
    if (typeof fetchImpl !== 'function') {
      throw new Error('Fetch is unavailable for metadata ranges.');
    }
    const lib = typeof getLib === 'function' ? getLib() : null;
    if (!lib || typeof lib.parseMp4IlstMetadataSafe !== 'function') {
      throw new Error('MP4 ilst parser is unavailable.');
    }

    const maxRange = Math.max(1, Number(limits.maxRangeBytes) || MAX_RANGE);
    const FileReader = makeRangeReader(fetchImpl, options, limits);
    const reader = new FileReader(source);
    const fileSize = reader.getSize();

    const initialProbeLen = Math.min(fileSize, maxRange, Math.max(64, Number(limits.headProbeBytes) || 65536));
    const headBytes = await loadReaderRangeAsync(reader, 0, initialProbeLen - 1);

    // Walk top-level boxes; hop across mdat (including 64-bit largesize=1) if moov is at the tail
    let pos = 0;
    let moovOffset = -1;
    let moovSize = 0;

    for (let hop = 0; hop < 16 && pos + 8 <= fileSize; hop++) {
      let headerInfo = null;
      if (pos + 16 <= headBytes.byteLength || (pos + 8 <= headBytes.byteLength && pos + 8 === fileSize)) {
        headerInfo = readTopBoxHeaderFromSlice(headBytes, pos, fileSize - pos);
        if (headerInfo && headerInfo.needs16ByteHeader) headerInfo = null;
      }
      if (!headerInfo) {
        // Prefetch up to 256 KiB from tail/post-mdat offset so typical tail 'moov' boxes complete in 1 RTT instead of 2!
        const hopProbeSpan = Math.min(fileSize - pos, maxRange, Math.max(64, Number(limits.tailProbeBytes) || 262144));
        const probeEnd = pos + hopProbeSpan - 1;
        const hdrSlice = await loadReaderRangeAsync(reader, pos, probeEnd);
        headerInfo = readTopBoxHeaderFromSlice(hdrSlice, 0, fileSize - pos);
      }
      if (!headerInfo || headerInfo.needs16ByteHeader) break;

      if (headerInfo.type === 'moov') {
        moovOffset = pos;
        moovSize = Math.min(headerInfo.boxSize, fileSize - pos);
        break;
      }
      if (headerInfo.isZeroEof || headerInfo.boxSize <= 0) break;
      pos += headerInfo.boxSize;
    }

    let targetSlice = headBytes;
    if (moovOffset >= 0 && moovSize >= 8) {
      const moovEnd = moovOffset + moovSize;
      if (moovEnd <= headBytes.byteLength) {
        targetSlice = headBytes;
      } else {
        const clampedMoovLen = Math.min(moovSize, maxRange, fileSize - moovOffset);
        targetSlice = await loadReaderRangeAsync(reader, moovOffset, moovOffset + clampedMoovLen - 1);
      }
    }

    const ilstRes = lib.parseMp4IlstMetadataSafe(targetSlice, { totalFileSize: fileSize });
    const techRes = typeof lib.parseSafeMp4AlacBoxMetadata === 'function'
      ? lib.parseSafeMp4AlacBoxMetadata(targetSlice, fileSize)
      : null;
    return convertParsedMp4ToRemoteTags(ilstRes, techRes);
  }

  function isFatalTransportOrSafetyError(err) {
    const msg = String((err && err.message) || err || '');
    return (
      msg.includes('Byte ranges unavailable') ||
      msg.includes('safety limit') ||
      msg.includes('mismatched Content-Range') ||
      msg.includes('incomplete byte range') ||
      msg.includes('outside the cloud file')
    );
  }

  function readRemoteTags(jsmediatags, source, options = {}, limits = {}) {
    const mp4Hint = isMp4SourceHint(source);
    if (!jsmediatags || typeof jsmediatags.Reader !== 'function') {
      if (mp4Hint) {
        return readRemoteMp4Ilst(source, options, limits);
      }
      return Promise.reject(new Error('jsmediatags Reader is unavailable.'));
    }
    if (!source || !source.url || !(Number(source.size) > 0)) return Promise.reject(new Error('A cloud URL and file size are required for tag ranges.'));
    const fetchImpl = limits.fetch || (typeof fetch === 'function' && fetch.bind(globalThis));
    if (typeof fetchImpl !== 'function') return Promise.reject(new Error('Fetch is unavailable for metadata ranges.'));
    const FileReader = makeRangeReader(fetchImpl, options, limits);
    const basePromise = new Promise((resolve, reject) => {
      let reader;
      try { reader = new jsmediatags.Reader(source).setFileReader(FileReader); }
      catch (error) { reject(error); return; }
      reader.read({onSuccess: result => resolve(result && result.tags || {}), onError: error => reject(error instanceof Error ? error : new Error(error && (error.info || error.message) || 'Could not read cloud tags.'))});
    });

    if (!mp4Hint) return basePromise;

    return basePromise.then(async tags => {
      const needsMp4Enrich = !tags.picture || (tags.iTunNORM === undefined && tags.replayGainTrackGain === undefined);
      if (!needsMp4Enrich) return tags;
      try {
        const extra = await readRemoteMp4Ilst(source, options, limits);
        return {...extra, ...tags, picture: tags.picture || extra.picture};
      } catch (_) {
        return tags;
      }
    }, async err => {
      if (isFatalTransportOrSafetyError(err)) throw err;
      return readRemoteMp4Ilst(source, options, limits);
    });
  }
  return {readRemoteTags, readRemoteMp4Ilst, makeRangeReader, MAX_RANGE, MAX_TOTAL};
});
