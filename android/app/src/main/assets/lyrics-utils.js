/**
 * lyrics-utils.js
 * Universal Lyrics Parser, Serializer, and Synchronization Toolkit
 * Implements lrcget (YAML Lyricsfile 1.0) & lrclib specifications.
 * UMD pattern: Browser (window.LyricsUtils) + Node.js (module.exports).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LyricsUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --- CJK Character Detection ---
  const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

  function isCjkChar(char) {
    return CJK_REGEX.test(char);
  }

  // --- Pure JavaScript SHA-256 Implementation (Zero Dependencies) ---
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function pureJsSha256(input) {
    let bytes;
    if (typeof input === 'string') {
      if (typeof TextEncoder !== 'undefined') {
        bytes = new TextEncoder().encode(input);
      } else if (typeof Buffer !== 'undefined') {
        bytes = Buffer.from(input, 'utf8');
      } else {
        const arr = [];
        for (let i = 0; i < input.length; i++) {
          let code = input.charCodeAt(i);
          if (code < 0x80) arr.push(code);
          else if (code < 0x800) arr.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
          else arr.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
        bytes = new Uint8Array(arr);
      }
    } else if (input instanceof Uint8Array) {
      bytes = input;
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
      bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else {
      bytes = new Uint8Array(input);
    }

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const len = bytes.length;
    const bitLen = len * 8;
    const padLen = (len % 64 < 56) ? 64 - (len % 64) : 128 - (len % 64);
    const totalLen = len + padLen;
    const padded = new Uint8Array(totalLen);
    padded.set(bytes);
    padded[len] = 0x80;

    const view = new DataView(padded.buffer);
    view.setUint32(totalLen - 4, bitLen >>> 0, false);
    view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);

    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let i = 0; i < totalLen; i += 64) {
      for (let t = 0; t < 16; t++) {
        W[t] = view.getUint32(i + t * 4, false);
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }

      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const toHex = n => (n >>> 0).toString(16).padStart(8, '0');
    return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
  }

  // Helper to get Node crypto module if available
  function getNodeCrypto() {
    try {
      if (typeof require === 'function') {
        const c = require('crypto');
        if (c && typeof c.createHash === 'function') return c;
      }
    } catch (e) {}
    return null;
  }

  // =========================================================================
  // 1. STANDARD & ENHANCED LRC PARSER & SERIALIZER
  // =========================================================================

  /**
   * Parse a timestamp tag string like "01:23.45" or "01:23.456" into milliseconds.
   */
  function parseTimestampToMs(minStr, secStr, fracStr) {
    const minutes = parseInt(minStr, 10) || 0;
    const seconds = parseInt(secStr, 10) || 0;
    let fractionMs = 0;
    if (fracStr) {
      if (fracStr.length === 1) {
        fractionMs = parseInt(fracStr, 10) * 100;
      } else if (fracStr.length === 2) {
        fractionMs = parseInt(fracStr, 10) * 10;
      } else if (fracStr.length >= 3) {
        fractionMs = parseInt(fracStr.slice(0, 3), 10);
      }
    }
    return minutes * 60000 + seconds * 1000 + fractionMs;
  }

  /**
   * Format milliseconds into LRC timestamp [mm:ss.xx]
   */
  function formatLrcTimestamp(ms) {
    const clamped = Math.max(0, Math.round(Number(ms) || 0));
    const minutes = Math.floor(clamped / 60000);
    const seconds = Math.floor((clamped % 60000) / 1000);
    const hundredths = Math.floor((clamped % 1000) / 10);
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const xx = String(hundredths).padStart(2, '0');
    return `${mm}:${ss}.${xx}`;
  }

  /**
   * parseLrc(lrcString): parses standard and enhanced LRC text.
   * Returns: { metadata: { title, artist, album, length, duration_ms, offset }, lines: [...] }
   */
  function parseLrc(lrcString) {
    const metadata = {
      title: '',
      artist: '',
      album: '',
      length: '',
      offset: 0
    };
    const lines = [];

    if (!lrcString || typeof lrcString !== 'string') {
      return { metadata, lines };
    }

    const rawLines = lrcString.split(/\r?\n/);
    const lineTagRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const metaTagRegex = /^\[([a-zA-Z]+)\s*:\s*([^\]]*)\]/;
    const wordTagRegex = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;

    const pendingLines = [];

    for (let r = 0; r < rawLines.length; r++) {
      const raw = rawLines[r].trim();
      if (!raw) continue;

      // 1. Check for metadata tags: [ti:], [ar:], [al:], [length:], [offset:], etc.
      const metaMatch = raw.match(metaTagRegex);
      if (metaMatch && !lineTagRegex.test(raw)) {
        const key = metaMatch[1].toLowerCase();
        const value = metaMatch[2].trim();
        if (key === 'ti' || key === 'title') metadata.title = value;
        else if (key === 'ar' || key === 'artist') metadata.artist = value;
        else if (key === 'al' || key === 'album') metadata.album = value;
        else if (key === 'length') {
          metadata.length = value;
          const lMatch = value.match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
          if (lMatch) {
            metadata.duration_ms = parseTimestampToMs(lMatch[1], lMatch[2], lMatch[3]);
          }
        } else if (key === 'offset') {
          metadata.offset = parseInt(value, 10) || 0;
        } else {
          metadata[key] = value;
        }
        continue;
      }

      // 2. Check for line timestamps at start of line
      // Handles multiple timestamps: e.g. [00:12.00][00:24.00]Lyric line
      lineTagRegex.lastIndex = 0;
      const timestamps = [];
      let lastIndex = 0;
      let m;

      while ((m = lineTagRegex.exec(raw)) !== null) {
        if (m.index === lastIndex) {
          const ms = parseTimestampToMs(m[1], m[2], m[3]);
          timestamps.push(ms);
          lastIndex = lineTagRegex.lastIndex;
        } else {
          break;
        }
      }

      if (timestamps.length === 0) {
        // Line without timestamp, check if it's metadata in some other form
        if (metaMatch) {
          const key = metaMatch[1].toLowerCase();
          const value = metaMatch[2].trim();
          metadata[key] = value;
        }
        continue;
      }

      const content = raw.slice(lastIndex).trim();

      // 3. Check for enhanced word-synced karaoke tags: <mm:ss.xx>word
      const words = [];
      let lineEndMs = null;
      let plainText = '';

      wordTagRegex.lastIndex = 0;
      const wordMatches = [];
      let wm;
      while ((wm = wordTagRegex.exec(content)) !== null) {
        wordMatches.push({
          ms: parseTimestampToMs(wm[1], wm[2], wm[3]),
          index: wm.index,
          length: wm[0].length
        });
      }

      if (wordMatches.length > 0) {
        for (let w = 0; w < wordMatches.length; w++) {
          const curr = wordMatches[w];
          const textStart = curr.index + curr.length;
          const textEnd = (w + 1 < wordMatches.length) ? wordMatches[w + 1].index : content.length;
          const wordText = content.slice(textStart, textEnd);

          if (w === wordMatches.length - 1 && wordText === '') {
            // Trailing tag serves as end_ms
            lineEndMs = curr.ms;
          } else {
            words.push({
              text: wordText,
              start_ms: curr.ms
            });
          }
        }

        // Clean trailing spaces on the last word
        if (words.length > 0) {
          const lastWord = words[words.length - 1];
          lastWord.text = lastWord.text.replace(/\s+$/, '');
        }

        plainText = words.map(w => w.text).join('').trim();
      } else {
        plainText = content;
      }

      // For each timestamp, create a separate line entry
      for (const ts of timestamps) {
        const lineWords = words.map(w => ({ ...w }));
        pendingLines.push({
          text: plainText,
          start_ms: ts,
          end_ms: lineEndMs,
          words: lineWords
        });
      }
    }

    // Sort lines ascending by start_ms
    pendingLines.sort((a, b) => a.start_ms - b.start_ms);

    // Compute end_ms if not explicitly specified
    for (let i = 0; i < pendingLines.length; i++) {
      const line = pendingLines[i];
      if (line.end_ms == null) {
        if (i + 1 < pendingLines.length) {
          line.end_ms = Math.max(line.start_ms, pendingLines[i + 1].start_ms);
        } else if (metadata.duration_ms && metadata.duration_ms > line.start_ms) {
          line.end_ms = metadata.duration_ms;
        } else {
          line.end_ms = line.start_ms + 3000;
        }
      }

      // Ensure words have end_ms
      if (line.words && line.words.length > 0) {
        for (let w = 0; w < line.words.length; w++) {
          if (line.words[w].end_ms == null) {
            if (w + 1 < line.words.length) {
              line.words[w].end_ms = line.words[w + 1].start_ms;
            } else {
              line.words[w].end_ms = line.end_ms;
            }
          }
        }
      }
      lines.push(line);
    }

    return { metadata, lines };
  }

  /**
   * serializeLrc(lyricsData): converts lines & metadata back to clean LRC string.
   */
  function serializeLrc(lyricsData) {
    if (!lyricsData) return '';
    const metadata = lyricsData.metadata || {};
    const lines = Array.isArray(lyricsData.lines) ? lyricsData.lines : (Array.isArray(lyricsData) ? lyricsData : []);

    const output = [];

    // Metadata tags
    if (metadata.title) output.push(`[ti:${metadata.title}]`);
    if (metadata.artist) output.push(`[ar:${metadata.artist}]`);
    if (metadata.album) output.push(`[al:${metadata.album}]`);
    if (metadata.duration_ms) {
      const dMin = Math.floor(metadata.duration_ms / 60000);
      const dSec = Math.floor((metadata.duration_ms % 60000) / 1000);
      output.push(`[length:${String(dMin).padStart(2, '0')}:${String(dSec).padStart(2, '0')}]`);
    } else if (metadata.length) {
      output.push(`[length:${metadata.length}]`);
    }
    if (metadata.offset && Number(metadata.offset) !== 0) {
      output.push(`[offset:${metadata.offset}]`);
    }

    // Lines
    for (const line of lines) {
      const timeTag = `[${formatLrcTimestamp(line.start_ms)}]`;
      if (line.words && line.words.length > 0) {
        let lineBody = '';
        for (const word of line.words) {
          lineBody += `<${formatLrcTimestamp(word.start_ms)}>${word.text}`;
        }
        if (line.end_ms && line.end_ms > line.start_ms) {
          lineBody += `<${formatLrcTimestamp(line.end_ms)}>`;
        }
        output.push(`${timeTag}${lineBody}`);
      } else {
        output.push(`${timeTag}${line.text || ''}`);
      }
    }

    return output.join('\n');
  }

  // =========================================================================
  // 2. LYRICSFILE (YAML 1.0) PARSER & SERIALIZER
  // =========================================================================

  function unquoteYamlString(str) {
    const s = (str || '').trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      const q = s[0];
      const inner = s.slice(1, -1);
      if (q === "'") return inner.replace(/''/g, "'");
      return inner
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
    }
    return s;
  }

  function quoteYamlString(str) {
    if (str === null || str === undefined) return "''";
    const s = String(str);
    // Use single quotes and escape internal single quotes as ''
    return `'${s.replace(/'/g, "''")}'`;
  }

  /**
   * parseLyricsfile(yamlString): parses Lyricsfile YAML 1.0 string into object.
   */
  function parseLyricsfile(yamlString) {
    const result = {
      version: '1.0',
      metadata: {
        title: '',
        artist: '',
        album: '',
        duration_ms: 0,
        instrumental: false
      },
      lines: [],
      plain: ''
    };

    if (!yamlString || typeof yamlString !== 'string') return result;

    const rawLines = yamlString.split(/\r?\n/);
    let section = 'root'; // 'root' | 'metadata' | 'lines' | 'plain'
    let currentLine = null;
    let currentWord = null;
    const plainLines = [];
    let plainBaseIndent = -1;

    function applyProp(obj, key, valStr) {
      if (key === 'text') {
        obj.text = unquoteYamlString(valStr);
      } else if (key === 'start_ms' || key === 'end_ms' || key === 'duration_ms') {
        obj[key] = Math.max(0, parseInt(unquoteYamlString(valStr), 10) || 0);
      } else if (key === 'instrumental') {
        obj[key] = unquoteYamlString(valStr).toLowerCase() === 'true';
      } else {
        obj[key] = unquoteYamlString(valStr);
      }
    }

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const trimmed = raw.trim();

      // Comment
      if (trimmed.startsWith('#')) continue;

      const indent = raw.search(/\S/);

      // Multi-line plain block
      if (section === 'plain') {
        if (indent === -1) {
          plainLines.push('');
          continue;
        }
        if (plainBaseIndent === -1) {
          if (indent > 0) plainBaseIndent = indent;
          else { section = 'root'; }
        }
        if (indent >= plainBaseIndent && plainBaseIndent > 0) {
          plainLines.push(raw.slice(plainBaseIndent));
          continue;
        } else {
          section = 'root';
        }
      }

      if (trimmed === '') continue;

      // Top-level keys (indent 0)
      if (indent === 0) {
        if (/^version\s*:/i.test(trimmed)) {
          result.version = unquoteYamlString(trimmed.replace(/^version\s*:\s*/i, ''));
          section = 'root';
          continue;
        }
        if (/^metadata\s*:/i.test(trimmed)) {
          section = 'metadata';
          continue;
        }
        if (/^lines\s*:/i.test(trimmed)) {
          section = 'lines';
          if (/lines\s*:\s*\[\s*\]/i.test(trimmed)) {
            result.lines = [];
          }
          continue;
        }
        if (/^plain\s*:/i.test(trimmed)) {
          section = 'plain';
          plainLines.length = 0;
          plainBaseIndent = -1;
          const after = trimmed.replace(/^plain\s*:\s*/i, '').trim();
          if (after === "''" || after === '""') {
            result.plain = '';
            section = 'root';
          }
          continue;
        }
      }

      if (section === 'metadata') {
        const m = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
        if (m) {
          applyProp(result.metadata, m[1], m[2]);
        }
        continue;
      }

      if (section === 'lines') {
        const isListItem = /^\s*-\s+/.test(raw);
        if (isListItem) {
          const dashIndent = raw.indexOf('-');
          const itemContent = raw.slice(dashIndent + 1).trim();

          if (dashIndent <= 2 || currentLine === null) {
            // New lyric line
            currentLine = { text: '', start_ms: 0, end_ms: 0, words: [] };
            result.lines.push(currentLine);
            currentWord = null;

            if (itemContent) {
              const m = itemContent.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
              if (m) applyProp(currentLine, m[1], m[2]);
            }
          } else {
            // New word inside current lyric line
            currentWord = { text: '', start_ms: 0 };
            if (currentLine) {
              if (!Array.isArray(currentLine.words)) currentLine.words = [];
              currentLine.words.push(currentWord);
            }

            if (itemContent) {
              const m = itemContent.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
              if (m) applyProp(currentWord, m[1], m[2]);
            }
          }
        } else {
          const m = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
          if (m) {
            const key = m[1];
            const val = m[2];
            if (key === 'words') {
              currentWord = null;
            } else {
              const target = (currentWord && indent > 4) ? currentWord : currentLine;
              if (target) applyProp(target, key, val);
            }
          }
        }
      }
    }

    if (plainLines.length > 0) {
      result.plain = plainLines.join('\n');
    }

    // Instrumental handling
    if (result.metadata.instrumental) {
      result.lines = [];
      result.plain = '';
    } else {
      // Ensure monotonic integer start_ms
      result.lines.sort((a, b) => a.start_ms - b.start_ms);
      for (const line of result.lines) {
        line.start_ms = Math.round(Number(line.start_ms) || 0);
        line.end_ms = Math.round(Number(line.end_ms) || 0);
        if (Array.isArray(line.words)) {
          for (const word of line.words) {
            word.start_ms = Math.round(Number(word.start_ms) || 0);
          }
        }
      }
    }

    return result;
  }

  /**
   * serializeLyricsfile(lyricsData): converts lyricsData object into clean YAML 1.0.
   */
  function serializeLyricsfile(lyricsData) {
    if (!lyricsData) {
      return "version: '1.0'\nmetadata:\n  instrumental: false\nlines: []\nplain: ''";
    }

    const version = lyricsData.version || '1.0';
    const metadata = lyricsData.metadata || {};
    const lines = Array.isArray(lyricsData.lines) ? lyricsData.lines : [];
    const isInstrumental = Boolean(metadata.instrumental);

    const out = [];
    out.push(`version: ${quoteYamlString(version)}`);
    out.push('metadata:');
    out.push(`  title: ${quoteYamlString(metadata.title || '')}`);
    out.push(`  artist: ${quoteYamlString(metadata.artist || '')}`);
    out.push(`  album: ${quoteYamlString(metadata.album || '')}`);
    out.push(`  duration_ms: ${Math.max(0, Math.round(Number(metadata.duration_ms) || 0))}`);
    out.push(`  instrumental: ${isInstrumental ? 'true' : 'false'}`);

    if (isInstrumental) {
      out.push('lines: []');
      out.push("plain: ''");
      return out.join('\n');
    }

    // Sort lines monotonically by start_ms
    const sortedLines = [...lines].sort((a, b) => (a.start_ms || 0) - (b.start_ms || 0));

    if (sortedLines.length === 0) {
      out.push('lines: []');
    } else {
      out.push('lines:');
      for (const line of sortedLines) {
        const textStr = line.text || '';
        const startMs = Math.max(0, Math.round(Number(line.start_ms) || 0));
        const endMs = Math.max(startMs, Math.round(Number(line.end_ms) || 0));

        out.push(`  - text: ${quoteYamlString(textStr)}`);
        out.push(`    start_ms: ${startMs}`);
        out.push(`    end_ms: ${endMs}`);

        if (Array.isArray(line.words) && line.words.length > 0) {
          out.push('    words:');
          for (let w = 0; w < line.words.length; w++) {
            const word = line.words[w];
            const wText = word.text !== undefined ? String(word.text) : '';
            const wStart = Math.max(0, Math.round(Number(word.start_ms) || 0));
            out.push(`      - text: ${quoteYamlString(wText)}`);
            out.push(`        start_ms: ${wStart}`);
            if (word.end_ms != null) {
              out.push(`        end_ms: ${Math.max(wStart, Math.round(Number(word.end_ms) || 0))}`);
            }
          }
        }
      }
    }

    // Plain text block
    let plainText = lyricsData.plain;
    if (plainText === undefined || plainText === null) {
      plainText = sortedLines.map(l => l.text || '').join('\n');
    }

    if (!plainText) {
      out.push("plain: ''");
    } else {
      out.push('plain: |');
      const pLines = String(plainText).split(/\r?\n/);
      for (const pl of pLines) {
        out.push(`  ${pl}`);
      }
    }

    return out.join('\n');
  }

  // =========================================================================
  // 3. BINARY SEARCH SYNCHRONIZATION
  // =========================================================================

  /**
   * findActiveLineIndex(lines, currentMs, options):
   * O(log N) binary search returning active line index.
   */
  function findActiveLineIndex(lines, currentMs, options = {}) {
    if (!Array.isArray(lines) || lines.length === 0) return -1;
    const ms = Number(currentMs) || 0;
    if (ms < (lines[0].start_ms || 0)) return -1;

    let low = 0;
    let high = lines.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const midStart = lines[mid].start_ms || 0;
      if (midStart <= ms) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (result !== -1 && options && options.strict) {
      const line = lines[result];
      if (line.end_ms != null && ms >= line.end_ms) {
        return -1;
      }
    }

    return result;
  }

  /**
   * findActiveWordIndex(words, currentMs, options):
   * O(log N) binary search returning active word index.
   */
  function findActiveWordIndex(words, currentMs, options = {}) {
    if (!Array.isArray(words) || words.length === 0) return -1;
    const ms = Number(currentMs) || 0;
    if (ms < (words[0].start_ms || 0)) return -1;

    let low = 0;
    let high = words.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const midStart = words[mid].start_ms || 0;
      if (midStart <= ms) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (result !== -1 && options && options.strict) {
      const word = words[result];
      if (word.end_ms != null && ms >= word.end_ms) {
        return -1;
      }
    }

    return result;
  }

  // =========================================================================
  // 4. 64KB AUDIO FINGERPRINT (lrcget smart song identity)
  // =========================================================================

  /**
   * computeAudioFingerprint(blobOrBuffer):
   * Reads first 64KB, computes SHA-256, returns "64k_${hashHex.slice(0, 16)}_sz${fileSize}".
   */
  async function computeAudioFingerprint(blobOrBuffer) {
    if (!blobOrBuffer) {
      throw new TypeError('computeAudioFingerprint requires a Buffer, Blob, or ArrayBuffer');
    }

    const CHUNK_SIZE = 65536; // 64KB
    let fileSize = 0;
    let first64k = null;

    if (typeof Blob !== 'undefined' && blobOrBuffer instanceof Blob) {
      fileSize = blobOrBuffer.size;
      const slice = blobOrBuffer.slice(0, CHUNK_SIZE);
      const arrayBuffer = await slice.arrayBuffer();
      first64k = new Uint8Array(arrayBuffer);
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(blobOrBuffer)) {
      fileSize = blobOrBuffer.length;
      first64k = blobOrBuffer.subarray(0, CHUNK_SIZE);
    } else if (blobOrBuffer instanceof Uint8Array) {
      fileSize = blobOrBuffer.byteLength;
      first64k = blobOrBuffer.subarray(0, CHUNK_SIZE);
    } else if (blobOrBuffer instanceof ArrayBuffer) {
      fileSize = blobOrBuffer.byteLength;
      first64k = new Uint8Array(blobOrBuffer.slice(0, CHUNK_SIZE));
    } else if (typeof blobOrBuffer.size === 'number' && typeof blobOrBuffer.slice === 'function') {
      fileSize = blobOrBuffer.size;
      const slice = blobOrBuffer.slice(0, CHUNK_SIZE);
      const arrayBuffer = typeof slice.arrayBuffer === 'function' ? await slice.arrayBuffer() : slice;
      first64k = new Uint8Array(arrayBuffer);
    } else if (typeof blobOrBuffer.byteLength === 'number') {
      fileSize = blobOrBuffer.byteLength;
      first64k = new Uint8Array(blobOrBuffer).subarray(0, CHUNK_SIZE);
    } else {
      throw new TypeError('Unsupported input type for computeAudioFingerprint');
    }

    let hashHex = null;
    const nodeCrypto = getNodeCrypto();
    if (nodeCrypto) {
      hashHex = nodeCrypto.createHash('sha256').update(first64k).digest('hex');
    } else if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', first64k);
      hashHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      hashHex = pureJsSha256(first64k);
    }

    return `64k_${hashHex.slice(0, 16)}_sz${fileSize}`;
  }

  // =========================================================================
  // 5. LRCLIB PROOF-OF-WORK CHALLENGE SOLVER
  // =========================================================================

  /**
   * solveLrclibPoW(prefix, target, options):
   * Searches nonce such that SHA-256(prefix + nonce) in hex is strictly < target.
   * Returns nonce (number) or null if exhausted.
   */
  function solveLrclibPoW(prefix, target, options = {}) {
    if (prefix === undefined || prefix === null || target === undefined || target === null) {
      throw new Error('solveLrclibPoW requires prefix and target parameters');
    }

    const prefixStr = String(prefix);
    const targetNormalized = String(target).trim().toLowerCase().replace(/^0x/, '').padStart(64, '0');

    const maxIterations = typeof options === 'number'
      ? options
      : (options && options.maxIterations) || 5000000;
    const startNonce = (options && options.startNonce) || 0;

    const nodeCrypto = getNodeCrypto();

    let nonce = startNonce;
    const endNonce = startNonce + maxIterations;

    if (nodeCrypto) {
      while (nonce < endNonce) {
        const hashHex = nodeCrypto.createHash('sha256').update(prefixStr + nonce).digest('hex');
        if (hashHex < targetNormalized) {
          return nonce;
        }
        nonce++;
      }
    } else {
      while (nonce < endNonce) {
        const hashHex = pureJsSha256(prefixStr + nonce);
        if (hashHex < targetNormalized) {
          return nonce;
        }
        nonce++;
      }
    }

    return null;
  }

  // =========================================================================
  // 6. TIMELINE SHIFT & VALIDATION
  // =========================================================================

  /**
   * shiftLyrics(lines, deltaMs, lineIndicesOrAll):
   * Shifts start_ms, end_ms, and words start_ms clamped >= 0.
   */
  function shiftLyrics(lines, deltaMs, lineIndicesOrAll) {
    if (!Array.isArray(lines)) return lines;
    const delta = Math.round(Number(deltaMs) || 0);
    if (delta === 0) return lines;

    let targetIndices = null;
    if (lineIndicesOrAll !== undefined && lineIndicesOrAll !== null && lineIndicesOrAll !== 'all') {
      if (Array.isArray(lineIndicesOrAll) || lineIndicesOrAll instanceof Set) {
        targetIndices = new Set(lineIndicesOrAll);
      } else if (typeof lineIndicesOrAll === 'number') {
        targetIndices = new Set([lineIndicesOrAll]);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      if (targetIndices && !targetIndices.has(i)) continue;
      const line = lines[i];
      if (!line) continue;

      line.start_ms = Math.max(0, Math.round((line.start_ms || 0) + delta));
      if (line.end_ms != null) {
        line.end_ms = Math.max(line.start_ms, Math.round((line.end_ms || 0) + delta));
      }

      if (Array.isArray(line.words)) {
        for (const word of line.words) {
          word.start_ms = Math.max(0, Math.round((word.start_ms || 0) + delta));
          if (word.end_ms != null) {
            word.end_ms = Math.max(word.start_ms, Math.round((word.end_ms || 0) + delta));
          }
        }
      }
    }

    return lines;
  }

  /**
   * detectTimelineAnomalies(lines, options):
   * Returns anomalies array with { index, type, description }.
   * Types: "overlap", "gap", "negative".
   */
  function detectTimelineAnomalies(lines, options = {}) {
    const anomalies = [];
    if (!Array.isArray(lines) || lines.length === 0) return anomalies;

    const gapThresholdMs = (options && options.gapThresholdMs) || 30000;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // 1. Negative checks
      if (line.start_ms < 0) {
        anomalies.push({
          index: i,
          type: 'negative',
          description: `Line ${i} has negative start_ms (${line.start_ms})`
        });
      }
      if (line.end_ms != null && line.end_ms < 0) {
        anomalies.push({
          index: i,
          type: 'negative',
          description: `Line ${i} has negative end_ms (${line.end_ms})`
        });
      }
      if (line.end_ms != null && line.end_ms < line.start_ms) {
        anomalies.push({
          index: i,
          type: 'negative',
          description: `Line ${i} end_ms (${line.end_ms}) is earlier than start_ms (${line.start_ms})`
        });
      }

      // Word-level checks
      if (Array.isArray(line.words)) {
        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          if (word.start_ms < 0) {
            anomalies.push({
              index: i,
              type: 'negative',
              description: `Line ${i} word ${w} has negative start_ms (${word.start_ms})`
            });
          }
          if (word.end_ms != null && word.end_ms < word.start_ms) {
            anomalies.push({
              index: i,
              type: 'negative',
              description: `Line ${i} word ${w} end_ms (${word.end_ms}) is earlier than start_ms (${word.start_ms})`
            });
          }
        }
      }

      // 2. Overlap & order checks between line i and line i+1
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (nextLine.start_ms < line.start_ms) {
          anomalies.push({
            index: i + 1,
            type: 'overlap',
            description: `Line ${i + 1} start_ms (${nextLine.start_ms}) is earlier than Line ${i} start_ms (${line.start_ms})`
          });
        } else if (line.end_ms != null && line.end_ms > nextLine.start_ms) {
          anomalies.push({
            index: i,
            type: 'overlap',
            description: `Line ${i} end_ms (${line.end_ms}) overlaps with Line ${i + 1} start_ms (${nextLine.start_ms})`
          });
        }

        // Gap check
        const lineEnd = line.end_ms != null ? line.end_ms : line.start_ms;
        const gap = nextLine.start_ms - lineEnd;
        if (gap > gapThresholdMs) {
          anomalies.push({
            index: i,
            type: 'gap',
            description: `Large gap of ${gap}ms between Line ${i} and Line ${i + 1}`
          });
        }
      }
    }

    return anomalies;
  }

  // =========================================================================
  // 7. FORMAT CONVERSION UTILITIES
  // =========================================================================

  function lrcToLyricsfile(lrcString, metadataOverrides = {}) {
    const parsed = parseLrc(lrcString);
    const combinedMeta = { ...parsed.metadata, ...metadataOverrides };
    return serializeLyricsfile({
      version: '1.0',
      metadata: combinedMeta,
      lines: parsed.lines
    });
  }

  function lyricsfileToLrc(yamlString) {
    const parsed = parseLyricsfile(yamlString);
    return serializeLrc(parsed);
  }

  return {
    isCjkChar,
    pureJsSha256,
    parseLrc,
    serializeLrc,
    parseLyricsfile,
    serializeLyricsfile,
    findActiveLineIndex,
    findActiveWordIndex,
    computeAudioFingerprint,
    solveLrclibPoW,
    shiftLyrics,
    detectTimelineAnomalies,
    lrcToLyricsfile,
    lyricsfileToLrc
  };
});
