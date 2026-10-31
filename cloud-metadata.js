'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NocturneCloudMetadata = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const MAX_RANGE = 8 * 1024 * 1024, MAX_TOTAL = 16 * 1024 * 1024;

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
        const bytes = new Uint8Array(this.getBytesAt(offset, length));
        const selectedCharset = String(charset || 'windows-1252').toLowerCase();
        const decoderCharset = selectedCharset === 'utf-16' ? 'utf-16le' : selectedCharset;
        try { return new TextDecoder(decoderCharset).decode(bytes).replace(/\\0+$/g, ''); }
        catch (error) { return this.getStringAt(offset, length).replace(/\\0+$/g, ''); }
      }
    };
  }

  function readRemoteTags(jsmediatags, source, options = {}, limits = {}) {
    if (!jsmediatags || typeof jsmediatags.Reader !== 'function') return Promise.reject(new Error('jsmediatags Reader is unavailable.'));
    if (!source || !source.url || !(Number(source.size) > 0)) return Promise.reject(new Error('A cloud URL and file size are required for tag ranges.'));
    const fetchImpl = limits.fetch || (typeof fetch === 'function' && fetch.bind(globalThis));
    if (typeof fetchImpl !== 'function') return Promise.reject(new Error('Fetch is unavailable for metadata ranges.'));
    const FileReader = makeRangeReader(fetchImpl, options, limits);
    return new Promise((resolve, reject) => {
      let reader;
      try { reader = new jsmediatags.Reader(source).setFileReader(FileReader); }
      catch (error) { reject(error); return; }
      reader.read({onSuccess: result => resolve(result && result.tags || {}), onError: error => reject(error instanceof Error ? error : new Error(error && (error.info || error.message) || 'Could not read cloud tags.'))});
    });
  }
  return {readRemoteTags, makeRangeReader, MAX_RANGE, MAX_TOTAL};
});
