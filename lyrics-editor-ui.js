/**
 * lyrics-editor-ui.js
 * Comprehensive Lyrics UI Toolkit for Nocturne:
 * 1. Word-by-Word Karaoke Renderer (renderKaraokeLine)
 * 2. Lyric Syncer V2 Editor Modal (#lyrics-editor-modal)
 * 3. Manual LRCLIB Search Modal (#lyrics-search-modal)
 *
 * UMD Pattern: Browser (window.LyricsEditorUI) + Node.js (module.exports)
 */

(function (root, factory) {
  const getDependency = (name, relativePath) => {
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof require === 'function') {
      try { return require(relativePath); } catch (_) { return null; }
    }
    return null;
  };

  const lyricsUtils = getDependency('LyricsUtils', './lyrics-utils.js');
  const lrclibClient = getDependency('LrclibClient', './lrclib-client.js');

  const api = factory(lyricsUtils, lrclibClient);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LyricsEditorUI = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (externalLyricsUtils, externalLrclibClient) {
  'use strict';

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================

  function getLyricsUtils() {
    if (typeof window !== 'undefined' && window.LyricsUtils) return window.LyricsUtils;
    if (typeof globalThis !== 'undefined' && globalThis.LyricsUtils) return globalThis.LyricsUtils;
    return externalLyricsUtils || null;
  }

  function getLrclibClient() {
    if (typeof window !== 'undefined' && window.LrclibClient) return window.LrclibClient;
    if (typeof globalThis !== 'undefined' && globalThis.LrclibClient) return globalThis.LrclibClient;
    return externalLrclibClient || null;
  }

  function getNocturneLibrary() {
    if (typeof window !== 'undefined' && window.NocturneLibrary) return window.NocturneLibrary;
    if (typeof globalThis !== 'undefined' && globalThis.NocturneLibrary) return globalThis.NocturneLibrary;
    if (typeof window !== 'undefined' && window.library) return window.library;
    if (typeof globalThis !== 'undefined' && globalThis.library) return globalThis.library;
    if (typeof require === 'function') {
      try { return require('./library-utils.js'); } catch (_) {}
    }
    return null;
  }

  function esc(val) {
    return String(val ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '00:00.00';
    const totalSec = ms / 1000;
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  function formatSec(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function parseTimestampToMs(str) {
    if (typeof str === 'number') return Math.round(str);
    if (!str) return 0;
    const match = String(str).match(/(?:\[|<)?(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?(?:\]|>)?/);
    if (!match) {
      const num = parseFloat(str);
      return Number.isFinite(num) ? Math.round(num * 1000) : 0;
    }
    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    let ms = 0;
    if (match[3]) {
      const raw = match[3];
      if (raw.length === 1) ms = parseInt(raw, 10) * 100;
      else if (raw.length === 2) ms = parseInt(raw, 10) * 10;
      else ms = parseInt(raw.slice(0, 3), 10);
    }
    return (min * 60 + sec) * 1000 + ms;
  }

  function getAudioElement() {
    if (typeof window === 'undefined') return null;
    if (window.state && window.state.activeDeck && window.state.activeDeck.element) {
      return window.state.activeDeck.element;
    }
    if (window.audio) return window.audio;
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const audios = document.querySelectorAll('audio');
      if (audios && audios.length > 0) return audios[0];
    }
    return null;
  }

  function getPlayerCurrentMs() {
    const audio = getAudioElement();
    if (audio && Number.isFinite(audio.currentTime)) {
      return Math.round(audio.currentTime * 1000);
    }
    return 0;
  }

  function getPlayerDurationMs() {
    const audio = getAudioElement();
    if (audio && Number.isFinite(audio.duration)) {
      return Math.round(audio.duration * 1000);
    }
    return 0;
  }

  function seekPlayerMs(ms) {
    const audio = getAudioElement();
    if (audio && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(Math.max(0, ms / 1000), audio.duration);
      if (typeof window !== 'undefined' && typeof window.updatePositionState === 'function') {
        window.updatePositionState(true);
      }
    }
  }

  function togglePlayPause() {
    const audio = getAudioElement();
    if (audio) {
      if (audio.paused) {
        audio.play().catch(() => {});
        return true;
      } else {
        audio.pause();
        return false;
      }
    }
    if (typeof document !== 'undefined') {
      const btn = document.getElementById('play-button');
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function setPlayerPlaybackRate(rate) {
    const audio = getAudioElement();
    const r = parseFloat(rate) || 1.0;
    if (audio) {
      audio.playbackRate = r;
    }
    if (typeof window !== 'undefined' && window.standbyAudio) {
      window.standbyAudio.playbackRate = r;
    }
  }

  function showToast(msg) {
    if (typeof window !== 'undefined' && typeof window.toast === 'function') {
      window.toast(msg);
    } else {
      console.log('[LyricsUI]', msg);
    }
  }

  function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }

  // --- Internal Parser & Serializer Fallbacks ---

  function parseLrcInternal(lrcText) {
    const lu = getLyricsUtils();
    if (lu && typeof lu.parseLrc === 'function') {
      return lu.parseLrc(lrcText);
    }
    const lines = [];
    const metadata = {};
    if (!lrcText || typeof lrcText !== 'string') return { metadata, lines };

    const rawLines = lrcText.split(/\r?\n/);
    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      // Metadata tag check [tag:value]
      const tagMatch = trimmed.match(/^\[(ti|ar|al|by|offset|length):([^\]]*)\]$/i);
      if (tagMatch) {
        const key = tagMatch[1].toLowerCase();
        const val = tagMatch[2].trim();
        if (key === 'ti') metadata.title = val;
        else if (key === 'ar') metadata.artist = val;
        else if (key === 'al') metadata.album = val;
        else if (key === 'offset') metadata.offset = parseInt(val, 10) || 0;
        else metadata[key] = val;
        continue;
      }

      // Time tag extraction
      const timeMatches = [...trimmed.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      if (timeMatches.length === 0) {
        // Plain lyric line
        lines.push({ text: trimmed, start_ms: 0, end_ms: 0 });
        continue;
      }

      let lyricText = trimmed.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();

      // Check word-by-word timestamps <mm:ss.xx>
      const wordMatches = [...lyricText.matchAll(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g)];
      let words = null;
      if (wordMatches.length > 0) {
        words = wordMatches.map(wm => {
          const wMin = parseInt(wm[1], 10);
          const wSec = parseInt(wm[2], 10);
          let wMs = 0;
          if (wm[3]) {
            const raw = wm[3];
            if (raw.length === 1) wMs = parseInt(raw, 10) * 100;
            else if (raw.length === 2) wMs = parseInt(raw, 10) * 10;
            else wMs = parseInt(raw.slice(0, 3), 10);
          }
          return {
            text: wm[4],
            start_ms: (wMin * 60 + wSec) * 1000 + wMs
          };
        });
        lyricText = words.map(w => w.text).join('').trim();
      }

      for (const tm of timeMatches) {
        const min = parseInt(tm[1], 10);
        const sec = parseInt(tm[2], 10);
        let ms = 0;
        if (tm[3]) {
          const raw = tm[3];
          if (raw.length === 1) ms = parseInt(raw, 10) * 100;
          else if (raw.length === 2) ms = parseInt(raw, 10) * 10;
          else ms = parseInt(raw.slice(0, 3), 10);
        }
        const start_ms = (min * 60 + sec) * 1000 + ms;
        lines.push({
          text: lyricText,
          start_ms,
          end_ms: start_ms,
          words: words ? JSON.parse(JSON.stringify(words)) : null
        });
      }
    }

    lines.sort((a, b) => a.start_ms - b.start_ms);
    for (let i = 0; i < lines.length; i++) {
      if (i + 1 < lines.length) {
        lines[i].end_ms = lines[i + 1].start_ms;
      }
    }
    return { metadata, lines };
  }

  function serializeLrcInternal(lines, metadata = {}) {
    const lu = getLyricsUtils();
    if (lu && typeof lu.serializeLrc === 'function') {
      return lu.serializeLrc({ metadata, lines });
    }
    const out = [];
    if (metadata.title) out.push(`[ti:${metadata.title}]`);
    if (metadata.artist) out.push(`[ar:${metadata.artist}]`);
    if (metadata.album) out.push(`[al:${metadata.album}]`);
    if (metadata.by) out.push(`[by:${metadata.by}]`);
    if (metadata.offset) out.push(`[offset:${metadata.offset}]`);

    lines.forEach(line => {
      const tMs = (line.start_ms !== undefined) ? line.start_ms : Math.round((line.time || 0) * 1000);
      const timeTag = `[${formatMs(tMs)}]`;
      if (line.words && Array.isArray(line.words) && line.words.length > 0) {
        const wordsStr = line.words.map(w => {
          const wMs = (w.start_ms !== undefined) ? w.start_ms : Math.round((w.time || 0) * 1000);
          return `<${formatMs(wMs)}>${w.text}`;
        }).join('');
        out.push(`${timeTag}${wordsStr}`);
      } else {
        out.push(`${timeTag}${line.text || ''}`);
      }
    });
    return out.join('\n');
  }

  function serializeLyricsfileInternal(lyricsData) {
    const lu = getLyricsUtils();
    if (lu && typeof lu.serializeLyricsfile === 'function') {
      return lu.serializeLyricsfile(lyricsData);
    }
    const meta = (lyricsData && lyricsData.metadata) || {};
    const lines = (lyricsData && lyricsData.lines) || [];
    let yaml = `version: "1.0"\nmetadata:\n`;
    yaml += `  title: "${(meta.title || '').replace(/"/g, '\\"')}"\n`;
    yaml += `  artist: "${(meta.artist || '').replace(/"/g, '\\"')}"\n`;
    yaml += `  album: "${(meta.album || '').replace(/"/g, '\\"')}"\n`;
    yaml += `  duration_ms: ${meta.duration_ms || 0}\n`;
    yaml += `  instrumental: ${Boolean(meta.instrumental)}\n`;
    yaml += `lines:\n`;
    lines.forEach(line => {
      yaml += `  - text: "${(line.text || '').replace(/"/g, '\\"')}"\n`;
      yaml += `    start_ms: ${line.start_ms || 0}\n`;
      yaml += `    end_ms: ${line.end_ms || line.start_ms || 0}\n`;
      if (line.words && Array.isArray(line.words) && line.words.length > 0) {
        yaml += `    words:\n`;
        line.words.forEach(w => {
          yaml += `      - text: "${(w.text || '').replace(/"/g, '\\"')}"\n`;
          yaml += `        start_ms: ${w.start_ms || 0}\n`;
        });
      }
    });
    return yaml;
  }

  function detectTimelineAnomalies(lines) {
    const lu = getLyricsUtils();
    if (lu && typeof lu.detectTimelineAnomalies === 'function') {
      return lu.detectTimelineAnomalies(lines, { gapThresholdMs: 5000 });
    }
    const anomalies = [];
    if (!Array.isArray(lines) || lines.length === 0) return anomalies;

    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i];
      const next = lines[i + 1];
      if (next) {
        const curEnd = cur.end_ms !== undefined ? cur.end_ms : cur.start_ms;
        if (cur.start_ms > next.start_ms || curEnd > next.start_ms) {
          anomalies.push({
            index: i,
            lineIndex: i,
            type: 'overlap',
            description: `Trùng lặp thời gian: dòng ${i + 1} (${curEnd}ms) chồng lên dòng ${i + 2} (${next.start_ms}ms)`
          });
        } else if (next.start_ms - curEnd > 5000) {
          anomalies.push({
            index: i,
            lineIndex: i,
            type: 'gap',
            description: `Khoảng lặng > 5s (${next.start_ms - curEnd}ms) giữa dòng ${i + 1} và ${i + 2}`
          });
        }
      }
      if (cur.start_ms < 0) {
        anomalies.push({
          index: i,
          lineIndex: i,
          type: 'negative',
          description: `Dòng ${i + 1} có mốc thời gian âm (${cur.start_ms}ms)`
        });
      }
    }
    return anomalies;
  }

  function shiftLyricsLines(lines, deltaMs, targetIndices = null) {
    const lu = getLyricsUtils();
    if (lu && typeof lu.shiftLyrics === 'function') {
      return lu.shiftLyrics(lines, deltaMs, targetIndices);
    }
    const delta = Math.round(Number(deltaMs) || 0);
    const targetSet = targetIndices ? new Set(Array.isArray(targetIndices) ? targetIndices : [targetIndices]) : null;

    for (let i = 0; i < lines.length; i++) {
      if (targetSet && !targetSet.has(i)) continue;
      const line = lines[i];
      if (!line) continue;
      line.start_ms = Math.max(0, Math.round((line.start_ms || 0) + delta));
      if (line.end_ms != null) {
        line.end_ms = Math.max(line.start_ms, Math.round((line.end_ms || 0) + delta));
      }
      if (Array.isArray(line.words)) {
        for (const w of line.words) {
          w.start_ms = Math.max(0, Math.round((w.start_ms || 0) + delta));
          if (w.end_ms != null) {
            w.end_ms = Math.max(w.start_ms, Math.round((w.end_ms || 0) + delta));
          }
        }
      }
    }
    return lines;
  }

  // =========================================================================
  // 1. WORD-BY-WORD KARAOKE RENDERER
  // =========================================================================

  /**
   * renderKaraokeLine(container, line, currentMs, options):
   * Renders words with precise fill/highlight based on word start_ms and next word timestamp.
   *
   * @param {HTMLElement} container - DOM row element (<p class="lyric-line">)
   * @param {Object} line - { text, start_ms, end_ms, words: [{ text, start_ms, end_ms }] }
   * @param {number} currentMs - Current playback timestamp in milliseconds
   * @param {Object} [options] - Optional settings ({ onSeek })
   */
  function renderKaraokeLine(container, line, currentMs, options = {}) {
    if (!container) return;

    let ms = Number(currentMs);
    if (!Number.isFinite(ms)) ms = 0;

    // Normalization: if line has ms timestamps (>1000) and currentMs was passed in seconds (<1000)
    if (line) {
      const lineStart = (line.start_ms !== undefined) ? line.start_ms : (line.time !== undefined ? line.time * 1000 : 0);
      const firstWordStart = (line.words && line.words[0] && line.words[0].start_ms !== undefined) ? line.words[0].start_ms : 0;
      if ((lineStart > 1000 || firstWordStart > 1000) && ms > 0 && ms < 1000) {
        ms = Math.round(ms * 1000);
      }
    }

    // A. Word-by-Word karaoke rendering if line has words
    if (line && Array.isArray(line.words) && line.words.length > 0) {
      let spans = typeof container.querySelectorAll === 'function'
        ? container.querySelectorAll('.lyric-word')
        : (container.children || []).filter(c => c.classList && c.classList.contains('lyric-word'));

      // If container does not yet have matching word spans, rebuild DOM children
      if (container._karaokeLineRef !== line || spans.length !== line.words.length) {
        container._karaokeLineRef = line;
        container.innerHTML = '';

        for (let i = 0; i < line.words.length; i++) {
          const w = line.words[i];
          const span = document.createElement('span');
          span.className = 'lyric-word';
          span.classList.add('lyric-word');
          span.dataset.wordIndex = String(i);
          span.textContent = w.text || '';

          const wStart = (w.start_ms !== undefined)
            ? w.start_ms
            : Math.round((w.time || 0) * 1000);
          span.dataset.startMs = String(wStart);

          // Click on word to seek
          span.addEventListener('click', (e) => {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            if (typeof options.onSeek === 'function') {
              options.onSeek(wStart / 1000);
            } else {
              seekPlayerMs(wStart);
            }
          });

          container.appendChild(span);

          // Preserve whitespace between words if word text does not end with space
          if (i < line.words.length - 1 && !w.text.endsWith(' ')) {
            if (typeof document.createTextNode === 'function') {
              container.appendChild(document.createTextNode(' '));
            }
          }
        }

        spans = typeof container.querySelectorAll === 'function'
          ? container.querySelectorAll('.lyric-word')
          : (container.children || []).filter(c => c.classList && c.classList.contains('lyric-word'));
      }

      // Update state, styles, and classes for each word
      for (let i = 0; i < line.words.length; i++) {
        const w = line.words[i];
        const span = spans[i];
        if (!span) continue;

        const wStart = (w.start_ms !== undefined)
          ? w.start_ms
          : Math.round((w.time || 0) * 1000);

        // Next word timestamp or line end timestamp
        let wEnd;
        if (w.end_ms !== undefined) {
          wEnd = w.end_ms;
        } else if (i + 1 < line.words.length) {
          const nextW = line.words[i + 1];
          wEnd = (nextW.start_ms !== undefined)
            ? nextW.start_ms
            : Math.round((nextW.time || 0) * 1000);
        } else if (line.end_ms !== undefined) {
          wEnd = line.end_ms;
        } else if (line.time !== undefined && line.duration) {
          wEnd = Math.round((line.time + line.duration) * 1000);
        } else {
          wEnd = wStart + 800;
        }

        if (wEnd < wStart) wEnd = wStart;

        if (ms < wStart) {
          // Word has not been sung yet
          span.classList.remove('lyric-word-sung', 'lyric-word-active');
          if (span.style) {
            span.style.backgroundImage = '';
            span.style.webkitBackgroundClip = '';
            span.style.backgroundClip = '';
            if (typeof span.style.removeProperty === 'function') {
              span.style.removeProperty('--karaoke-fill');
              span.style.removeProperty('--karaoke-progress');
            }
          }
          span.dataset.fill = '0%';
        } else if (ms >= wEnd) {
          // Word has finished being sung
          span.classList.add('lyric-word-sung');
          span.classList.remove('lyric-word-active');
          if (span.style) {
            span.style.backgroundImage = '';
            span.style.webkitBackgroundClip = '';
            span.style.backgroundClip = '';
            if (typeof span.style.setProperty === 'function') {
              span.style.setProperty('--karaoke-fill', '100%');
              span.style.setProperty('--karaoke-progress', '1.000');
            }
          }
          span.dataset.fill = '100%';
        } else {
          // Active word in progress!
          span.classList.remove('lyric-word-sung');
          span.classList.add('lyric-word-active');

          const duration = Math.max(1, wEnd - wStart);
          const ratio = Math.min(1, Math.max(0, (ms - wStart) / duration));
          const pct = Math.round(ratio * 100);

          if (span.style) {
            if (typeof span.style.setProperty === 'function') {
              span.style.setProperty('--karaoke-fill', `${pct}%`);
              span.style.setProperty('--karaoke-progress', ratio.toFixed(3));
            }
            // Linear gradient for fluid word wipe
            span.style.backgroundImage = `linear-gradient(to right, #c4b5fd ${pct}%, rgba(255, 255, 255, 0.6) ${pct}%)`;
            span.style.webkitBackgroundClip = 'text';
            span.style.backgroundClip = 'text';
          }
          span.dataset.fill = `${pct}%`;
        }
      }
      return;
    }

    // B. Plain line rendering if no words
    container._karaokeLineRef = null;
    const text = line ? (line.text || '') : '';
    if (container.textContent !== text) {
      container.textContent = text;
    }
  }

  // =========================================================================
  // 2. LYRIC SYNCER V2 MODAL (#lyrics-editor-modal)
  // =========================================================================

  const editorState = {
    isOpen: false,
    track: null,
    lines: [],
    metadata: {},
    cursorIndex: 0,
    playbackRate: 1.0,
    undoStack: [],
    redoStack: [],
    activeInterval: null,
    activePlayingIndex: -1,
    keyHandlerBound: null,
    powController: null,
    lastPowSnapshot: null
  };

  function ensureEditorModalDOM() {
    if (typeof document === 'undefined') return null;
    let modal = document.getElementById('lyrics-editor-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'lyrics-editor-modal';
    modal.className = 'fixed inset-0 z-[85] hidden items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 md:p-6';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'lyrics-editor-title');

    modal.innerHTML = `
      <section class="flex flex-col w-full max-w-4xl h-[92vh] max-h-[850px] bg-[#14171a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-zinc-100 font-sans">
        <!-- Header -->
        <header class="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5 bg-black/30">
          <div class="min-w-0">
            <p class="text-[10px] uppercase tracking-[.2em] text-violet-400 font-semibold">Lyric Syncer V2 · Trình Đồng Bộ Lời Nhạc</p>
            <h2 id="lyrics-editor-title" class="mt-0.5 truncate text-base sm:text-lg font-semibold text-white">Chỉnh sửa lời bài hát</h2>
            <p id="lyrics-editor-subtitle" class="truncate text-xs text-zinc-400"></p>
          </div>
          <div class="flex items-center gap-3">
            <!-- Playback Rate Selector -->
            <div class="flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs">
              <label for="lyrics-editor-playback-rate" class="text-zinc-400 text-[11px] whitespace-nowrap">Tốc độ:</label>
              <select id="lyrics-editor-playback-rate" class="bg-transparent text-violet-300 font-semibold text-xs outline-none cursor-pointer">
                <option value="0.5" class="bg-zinc-900 text-zinc-100">0.5x</option>
                <option value="0.75" class="bg-zinc-900 text-zinc-100">0.75x</option>
                <option value="1.0" selected class="bg-zinc-900 text-zinc-100">1.0x (Chuẩn)</option>
                <option value="1.25" class="bg-zinc-900 text-zinc-100">1.25x</option>
                <option value="1.5" class="bg-zinc-900 text-zinc-100">1.5x</option>
                <option value="2.0" class="bg-zinc-900 text-zinc-100">2.0x</option>
              </select>
            </div>
            <button id="lyrics-editor-close-btn" type="button" class="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-lg text-zinc-300 hover:bg-white/10 hover:text-white transition" aria-label="Đóng (Esc)">✕</button>
          </div>
        </header>

        <!-- Controls Bar -->
        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 border-b border-white/10 bg-black/20">
          <div class="flex items-center gap-3">
            <button id="lyrics-editor-play-btn" type="button" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition shadow">
              <span id="lyrics-editor-play-icon">▶</span> <span id="lyrics-editor-play-label">Phát (Space)</span>
            </button>
            <span id="lyrics-editor-time-display" class="font-mono text-sm text-zinc-200 tabular-nums">00:00.00 / 00:00.00</span>
          </div>
          <div class="flex items-center gap-2">
            <button id="lyrics-editor-undo-btn" type="button" class="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs text-zinc-300 transition" title="Hoàn tác (Ctrl+Z)">↶ Hoàn tác</button>
            <button id="lyrics-editor-redo-btn" type="button" class="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs text-zinc-300 transition" title="Làm lại (Ctrl+Y)">↷ Làm lại</button>
            <div class="h-4 w-px bg-white/10 mx-0.5"></div>
            <button id="lyrics-editor-nudge-prev-btn" type="button" class="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs font-mono text-zinc-300 transition" title="Nudge -100ms ([)">[ -100ms ]</button>
            <button id="lyrics-editor-nudge-next-btn" type="button" class="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs font-mono text-zinc-300 transition" title="Nudge +100ms (])">[ +100ms ]</button>
            <div class="h-4 w-px bg-white/10 mx-0.5"></div>
            <button id="lyrics-editor-stamp-btn" type="button" class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow transition" title="Gán mốc hiện tại và xuống dòng tiếp theo (Enter / ↓)">
              ⚡ Gán mốc (Enter / ↓)
            </button>
            <button id="lyrics-editor-add-line-btn" type="button" class="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs text-zinc-300 transition" title="Thêm dòng mới">＋ Thêm dòng</button>
          </div>
        </div>

        <!-- Shortcuts info -->
        <div class="flex items-center justify-between px-5 py-1.5 bg-black/40 border-b border-white/5 text-[11px] text-zinc-400">
          <span>⌨ <strong>Space</strong>: Phát/Dừng · <strong>Down / Enter</strong>: Gán mốc & xuống dòng · <strong>Up</strong>: Lên dòng · <strong>[ / ]</strong>: -/+100ms · <strong>Ctrl+Z / Y</strong>: Undo/Redo</span>
          <span id="lyrics-editor-stats" class="text-zinc-500 font-mono">0 dòng</span>
        </div>

        <!-- Lines Container -->
        <div id="lyrics-editor-lines" class="flex-1 overflow-y-auto p-4 space-y-1.5 select-none focus:outline-none" tabindex="0"></div>

        <!-- PoW SHA-256 Live Batch Progress & Instant Abort Bar (UPG-09) -->
        <div id="lyrics-editor-pow-panel" class="hidden flex-col gap-2 px-5 py-2.5 border-t border-emerald-500/20 bg-emerald-950/20 text-xs" role="status" aria-live="polite">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1 flex flex-wrap items-center gap-2">
              <span id="lyrics-editor-pow-status" class="font-medium text-emerald-300 truncate">⏳ Đang giải PoW SHA-256...</span>
              <span id="lyrics-editor-pow-metrics" class="font-mono text-[11px] text-zinc-400 tabular-nums">Nonce #0 · 0 H/s · 0.0s</span>
            </div>
            <button id="lyrics-editor-pow-cancel-btn" type="button" class="px-2.5 py-1 rounded-lg border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 font-semibold text-[11px] transition shrink-0">✕ Hủy giải PoW</button>
          </div>
          <div class="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div id="lyrics-editor-pow-progress-bar" class="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-150" style="width: 0%" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
          </div>
        </div>

        <!-- Footer Actions -->
        <footer class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-black/40">
          <div class="flex items-center gap-2">
            <button id="lyrics-editor-save-btn" type="button" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition shadow-lg shadow-violet-600/20">💾 Lưu vào máy</button>
            <button id="lyrics-editor-export-lrc-btn" type="button" class="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200 text-xs transition">📄 Xuất file .lrc</button>
            <button id="lyrics-editor-export-yaml-btn" type="button" class="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200 text-xs transition">📜 Xuất Lyricsfile (.yaml)</button>
          </div>
          <button id="lyrics-editor-publish-btn" type="button" class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs transition shadow">
            <span>🚀</span> <span>Đóng góp lên LRCLIB</span>
          </button>
        </footer>
      </section>
    `;

    document.body.appendChild(modal);
    bindEditorStaticEvents(modal);
    return modal;
  }

  function bindEditorStaticEvents(modal) {
    if (!modal) return;

    const closeBtn = modal.querySelector('#lyrics-editor-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeEditor);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeEditor();
    });

    const rateSelect = modal.querySelector('#lyrics-editor-playback-rate');
    if (rateSelect) {
      rateSelect.addEventListener('change', (e) => {
        const rate = parseFloat(e.target.value) || 1.0;
        editorState.playbackRate = rate;
        setPlayerPlaybackRate(rate);
      });
    }

    const playBtn = modal.querySelector('#lyrics-editor-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        togglePlayPause();
        updatePlayButtonState();
      });
    }

    const undoBtn = modal.querySelector('#lyrics-editor-undo-btn');
    if (undoBtn) undoBtn.addEventListener('click', editorUndo);

    const redoBtn = modal.querySelector('#lyrics-editor-redo-btn');
    if (redoBtn) redoBtn.addEventListener('click', editorRedo);

    const nudgePrevBtn = modal.querySelector('#lyrics-editor-nudge-prev-btn');
    if (nudgePrevBtn) nudgePrevBtn.addEventListener('click', () => editorNudge(-100));

    const nudgeNextBtn = modal.querySelector('#lyrics-editor-nudge-next-btn');
    if (nudgeNextBtn) nudgeNextBtn.addEventListener('click', () => editorNudge(100));

    const stampBtn = modal.querySelector('#lyrics-editor-stamp-btn');
    if (stampBtn) stampBtn.addEventListener('click', editorStampAndAdvance);

    const addLineBtn = modal.querySelector('#lyrics-editor-add-line-btn');
    if (addLineBtn) addLineBtn.addEventListener('click', editorAddLine);

    const saveBtn = modal.querySelector('#lyrics-editor-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', editorSaveToDevice);

    const exportLrcBtn = modal.querySelector('#lyrics-editor-export-lrc-btn');
    if (exportLrcBtn) exportLrcBtn.addEventListener('click', editorExportLrc);

    const exportYamlBtn = modal.querySelector('#lyrics-editor-export-yaml-btn');
    if (exportYamlBtn) exportYamlBtn.addEventListener('click', editorExportYaml);

    const publishBtn = modal.querySelector('#lyrics-editor-publish-btn');
    if (publishBtn) publishBtn.addEventListener('click', () => editorPublishToLrclib());

    const cancelPowBtn = modal.querySelector('#lyrics-editor-pow-cancel-btn');
    if (cancelPowBtn) cancelPowBtn.addEventListener('click', () => editorCancelPowSolve('user_clicked_cancel_pow'));
  }

  function pushUndoState() {
    editorState.undoStack.push(JSON.stringify(editorState.lines));
    if (editorState.undoStack.length > 50) {
      editorState.undoStack.shift();
    }
    editorState.redoStack = [];
  }

  function editorUndo() {
    if (editorState.undoStack.length === 0) return;
    editorState.redoStack.push(JSON.stringify(editorState.lines));
    const previous = editorState.undoStack.pop();
    editorState.lines = JSON.parse(previous);
    renderEditorLinesList();
  }

  function editorRedo() {
    if (editorState.redoStack.length === 0) return;
    editorState.undoStack.push(JSON.stringify(editorState.lines));
    const next = editorState.redoStack.pop();
    editorState.lines = JSON.parse(next);
    renderEditorLinesList();
  }

  function editorNudge(deltaMs) {
    if (!editorState.lines || editorState.lines.length === 0) return;
    pushUndoState();
    shiftLyricsLines(editorState.lines, deltaMs, [editorState.cursorIndex]);
    renderEditorLinesList();
  }

  function editorStampAndAdvance() {
    if (!editorState.lines || editorState.lines.length === 0) return;
    const nowMs = getPlayerCurrentMs();
    pushUndoState();

    const idx = editorState.cursorIndex;
    editorState.lines[idx].start_ms = nowMs;

    // Auto-update previous line end_ms if unassigned or overlapping
    if (idx > 0) {
      const prev = editorState.lines[idx - 1];
      if (!prev.end_ms || prev.end_ms > nowMs) {
        prev.end_ms = nowMs;
      }
    }

    // Auto-advance cursor
    if (editorState.cursorIndex < editorState.lines.length - 1) {
      editorState.cursorIndex++;
    }

    renderEditorLinesList();
    scrollCursorLineIntoView();
  }

  function editorAddLine() {
    pushUndoState();
    const nowMs = getPlayerCurrentMs();
    const newLine = {
      text: 'Lời mới...',
      start_ms: nowMs,
      end_ms: nowMs + 3000
    };
    editorState.lines.splice(editorState.cursorIndex + 1, 0, newLine);
    editorState.cursorIndex++;
    renderEditorLinesList();
    scrollCursorLineIntoView();
  }

  function updatePlayButtonState() {
    const audio = getAudioElement();
    const isPlaying = audio && !audio.paused;
    const icon = document.getElementById('lyrics-editor-play-icon');
    const label = document.getElementById('lyrics-editor-play-label');
    if (icon) icon.textContent = isPlaying ? '⏸' : '▶';
    if (label) label.textContent = isPlaying ? 'Tạm dừng (Space)' : 'Phát (Space)';
  }

  function scrollCursorLineIntoView() {
    const linesContainer = document.getElementById('lyrics-editor-lines');
    if (!linesContainer) return;
    const activeRow = linesContainer.querySelector(`[data-index="${editorState.cursorIndex}"]`);
    if (activeRow && typeof activeRow.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderEditorLinesList() {
    const linesContainer = document.getElementById('lyrics-editor-lines');
    if (!linesContainer) return;

    const stats = document.getElementById('lyrics-editor-stats');
    if (stats) stats.textContent = `${editorState.lines.length} dòng`;

    // Detect anomalies (overlaps and gaps > 5s)
    const anomalies = detectTimelineAnomalies(editorState.lines);
    const anomalyMap = new Map();
    for (const a of anomalies) {
      const idx = (a.index !== undefined) ? a.index : a.lineIndex;
      if (!anomalyMap.has(idx)) anomalyMap.set(idx, []);
      anomalyMap.get(idx).push(a);
    }

    linesContainer.innerHTML = '';

    if (editorState.lines.length === 0) {
      linesContainer.innerHTML = `
        <div class="py-12 text-center text-zinc-500">
          <p class="text-sm">Chưa có dòng lời bài hát nào.</p>
          <button type="button" class="mt-3 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-violet-300" onclick="window.LyricsEditorUI && window.LyricsEditorUI.addLine()">＋ Thêm dòng đầu tiên</button>
        </div>
      `;
      return;
    }

    editorState.lines.forEach((line, i) => {
      const isCursor = (i === editorState.cursorIndex);
      const isPlaying = (i === editorState.activePlayingIndex);
      const lineAnomalies = anomalyMap.get(i) || [];

      const hasOverlap = lineAnomalies.some(a => a.type === 'overlap');
      const hasGap = lineAnomalies.some(a => a.type === 'gap');

      const row = document.createElement('div');
      row.className = `lyrics-editor-row flex items-center gap-2.5 p-2 rounded-xl border transition ${
        isCursor ? 'is-cursor-active ring-1 ring-violet-500 bg-violet-950/30 border-violet-500' : 'border-white/5 bg-white/[0.02]'
      } ${
        isPlaying ? 'is-playing-active border-violet-400 bg-violet-500/10' : ''
      } ${
        hasOverlap ? 'border-rose-500/50 bg-rose-500/10' : hasGap ? 'border-amber-500/40 bg-amber-500/5' : ''
      }`;
      row.dataset.index = String(i);

      // Line number
      const numSpan = document.createElement('span');
      numSpan.className = 'w-6 text-right text-xs font-mono text-zinc-500 shrink-0 select-none';
      numSpan.textContent = String(i + 1);
      row.appendChild(numSpan);

      // Timestamp button (Click to seek or mark)
      const timeBtn = document.createElement('button');
      timeBtn.type = 'button';
      timeBtn.className = 'btn-stamp-line px-2 py-1 rounded bg-black/40 hover:bg-violet-600/30 text-xs font-mono text-violet-300 border border-white/10 transition shrink-0 select-none';
      timeBtn.title = 'Click để nghe từ mốc này · Đúp click để gán mốc hiện tại';
      timeBtn.textContent = formatMs(line.start_ms);
      timeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editorState.cursorIndex = i;
        seekPlayerMs(line.start_ms || 0);
        renderEditorLinesList();
      });
      timeBtn.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        pushUndoState();
        line.start_ms = getPlayerCurrentMs();
        renderEditorLinesList();
      });
      row.appendChild(timeBtn);

      // Editable text input
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'line-text-input flex-1 min-w-0 bg-transparent px-2 py-1 text-sm text-zinc-100 rounded border border-transparent hover:border-white/10 focus:border-violet-500 focus:bg-black/40 outline-none transition';
      textInput.value = line.text || '';
      textInput.addEventListener('focus', () => {
        if (editorState.cursorIndex !== i) {
          editorState.cursorIndex = i;
          renderEditorLinesList();
        }
      });
      textInput.addEventListener('change', (e) => {
        pushUndoState();
        line.text = e.target.value;
      });
      row.appendChild(textInput);

      // Anomaly warning badges
      if (hasOverlap) {
        const badge = document.createElement('span');
        badge.className = 'anomaly-badge anomaly-overlap inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 shrink-0';
        badge.classList.add('anomaly-badge', 'anomaly-overlap');
        badge.title = 'Trùng lặp thời gian: mốc kết thúc vượt quá dòng kế tiếp!';
        badge.textContent = '❌ Overlap';
        row.appendChild(badge);
      } else if (hasGap) {
        const badge = document.createElement('span');
        badge.className = 'anomaly-badge anomaly-gap inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0';
        badge.classList.add('anomaly-badge', 'anomaly-gap');
        badge.title = 'Khoảng lặng lớn > 5s tới dòng tiếp theo';
        badge.textContent = '⚠️ Gap > 5s';
        row.appendChild(badge);
      }

      // Stamp button for this row
      const stampBtn = document.createElement('button');
      stampBtn.type = 'button';
      stampBtn.className = 'p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-white/5 transition shrink-0';
      stampBtn.title = 'Gán mốc hiện tại cho dòng này';
      stampBtn.innerHTML = '⚡';
      stampBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndoState();
        line.start_ms = getPlayerCurrentMs();
        editorState.cursorIndex = i;
        renderEditorLinesList();
      });
      row.appendChild(stampBtn);

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-delete-line p-1 text-zinc-500 hover:text-rose-400 hover:bg-white/5 rounded transition shrink-0';
      delBtn.title = 'Xóa dòng này';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndoState();
        editorState.lines.splice(i, 1);
        editorState.cursorIndex = Math.min(editorState.cursorIndex, Math.max(0, editorState.lines.length - 1));
        renderEditorLinesList();
      });
      row.appendChild(delBtn);

      // Select line on row click
      row.addEventListener('click', () => {
        editorState.cursorIndex = i;
        renderEditorLinesList();
      });

      linesContainer.appendChild(row);
    });
  }

  function setupKeyboardShortcuts() {
    if (editorState.keyHandlerBound) {
      document.removeEventListener('keydown', editorState.keyHandlerBound, true);
    }

    editorState.keyHandlerBound = function (e) {
      if (!editorState.isOpen) return;

      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      // 1. Space: Toggle Play/Pause
      if (e.code === 'Space' || e.key === ' ') {
        if (!isInput) {
          e.preventDefault();
          togglePlayPause();
          updatePlayButtonState();
        }
        return;
      }

      // 2. Down / Enter: Timestamp current line and auto-advance!
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        if (isInput && e.key === 'Enter') {
          activeEl.blur();
        }
        e.preventDefault();
        editorStampAndAdvance();
        return;
      }

      // 3. Up: Move to previous line
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (editorState.cursorIndex > 0) {
          editorState.cursorIndex--;
          renderEditorLinesList();
          scrollCursorLineIntoView();
        }
        return;
      }

      // 4. [ and ]: Nudge / batch shift -100ms / +100ms
      if (e.key === '[') {
        if (!isInput) {
          e.preventDefault();
          editorNudge(-100);
        }
        return;
      }
      if (e.key === ']') {
        if (!isInput) {
          e.preventDefault();
          editorNudge(100);
        }
        return;
      }

      // 5. Ctrl+Z / Ctrl+Y: Undo/Redo history
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          editorRedo();
        } else {
          editorUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        editorRedo();
        return;
      }

      // 6. Escape: Close modal
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEditor();
        return;
      }
    };

    document.addEventListener('keydown', editorState.keyHandlerBound, true);
  }

  function removeKeyboardShortcuts() {
    if (editorState.keyHandlerBound) {
      document.removeEventListener('keydown', editorState.keyHandlerBound, true);
      editorState.keyHandlerBound = null;
    }
  }

  function startEditorSyncLoop() {
    if (editorState.activeInterval) {
      clearInterval(editorState.activeInterval);
    }

    editorState.activeInterval = setInterval(() => {
      if (!editorState.isOpen) return;

      const curMs = getPlayerCurrentMs();
      const durMs = getPlayerDurationMs();

      // Update time display
      const timeDisplay = document.getElementById('lyrics-editor-time-display');
      if (timeDisplay) {
        timeDisplay.textContent = `${formatMs(curMs)} / ${formatMs(durMs)}`;
      }

      // Update active playing line highlight
      if (editorState.lines && editorState.lines.length > 0) {
        let playingIdx = -1;
        const lu = getLyricsUtils();
        if (lu && typeof lu.findActiveLineIndex === 'function') {
          playingIdx = lu.findActiveLineIndex(editorState.lines, curMs);
        } else {
          for (let i = editorState.lines.length - 1; i >= 0; i--) {
            if (curMs >= (editorState.lines[i].start_ms || 0)) {
              playingIdx = i;
              break;
            }
          }
        }

        if (playingIdx !== editorState.activePlayingIndex) {
          editorState.activePlayingIndex = playingIdx;
          const container = document.getElementById('lyrics-editor-lines');
          if (container) {
            container.querySelectorAll('.lyrics-editor-row').forEach((row, idx) => {
              row.classList.toggle('is-playing-active', idx === playingIdx);
            });
          }
        }
      }

      updatePlayButtonState();
    }, 100);
  }

  function stopEditorSyncLoop() {
    if (editorState.activeInterval) {
      clearInterval(editorState.activeInterval);
      editorState.activeInterval = null;
    }
  }

  // --- Syncer Action Button Implementations ---

  async function editorSaveToDevice() {
    if (!editorState.track) return;
    const lrcText = serializeLrcInternal(editorState.lines, editorState.metadata);
    const yamlText = serializeLyricsfileInternal({
      metadata: editorState.metadata,
      lines: editorState.lines
    });

    const trackKey = editorState.track.fingerprint || editorState.track.id || 'default_track';

    // 1. Save to LRCLIB vault if available
    const client = getLrclibClient();
    if (client && typeof client.saveLyricsToVault === 'function') {
      try {
        await client.saveLyricsToVault(trackKey, {
          key: trackKey,
          lrc: lrcText,
          lyricsfile: yamlText,
          metadata: editorState.metadata,
          source: 'editor-v2',
          updatedAt: Date.now()
        });
      } catch (e) {
        console.warn('[LyricsUI] Could not save to vault:', e);
      }
    }

    // 2. Save to localStorage
    if (typeof localStorage !== 'undefined' && editorState.track.id) {
      try {
        localStorage.setItem(`nocturne-lyrics-${editorState.track.id}`, lrcText);
      } catch (_) {}
    }

    // 3. Update active player state
    if (typeof window !== 'undefined' && window.state) {
      window.state.lyrics = editorState.lines.map(l => ({
        time: (l.start_ms || 0) / 1000,
        text: l.text,
        words: l.words
      }));
      window.state.lyricIndex = -1;
    }

    if (typeof window !== 'undefined' && typeof window.renderLyrics === 'function') {
      window.renderLyrics(lrcText, editorState.track);
    }

    showToast('Đã lưu lời bài hát vào máy thành công!');
    closeEditor();
  }

  function editorExportLrc() {
    const lrcText = serializeLrcInternal(editorState.lines, editorState.metadata);
    const title = (editorState.metadata && editorState.metadata.title) || (editorState.track && editorState.track.title) || 'track';
    const artist = (editorState.metadata && editorState.metadata.artist) || (editorState.track && editorState.track.artist) || 'artist';
    const filename = `${artist} - ${title}.lrc`;
    downloadTextFile(filename, lrcText, 'text/plain;charset=utf-8');
    showToast(`Đã xuất file ${filename}!`);
  }

  function editorExportYaml() {
    const yamlText = serializeLyricsfileInternal({
      metadata: editorState.metadata,
      lines: editorState.lines
    });
    const title = (editorState.metadata && editorState.metadata.title) || (editorState.track && editorState.track.title) || 'track';
    const artist = (editorState.metadata && editorState.metadata.artist) || (editorState.track && editorState.track.artist) || 'artist';
    const filename = `${artist} - ${title}.lyricsfile`;
    downloadTextFile(filename, yamlText, 'text/yaml;charset=utf-8');
    showToast(`Đã xuất file ${filename}!`);
  }

  function renderPowProgressUI(snapshot) {
    if (!snapshot) return;
    editorState.lastPowSnapshot = snapshot;
    if (typeof document === 'undefined') return;

    const panel = document.getElementById('lyrics-editor-pow-panel');
    const statusEl = document.getElementById('lyrics-editor-pow-status');
    const metricsEl = document.getElementById('lyrics-editor-pow-metrics');
    const barEl = document.getElementById('lyrics-editor-pow-progress-bar');
    const cancelBtn = document.getElementById('lyrics-editor-pow-cancel-btn');

    if (panel) {
      if (snapshot.stage === 'idle') {
        panel.classList.add('hidden');
        panel.classList.remove('flex');
      } else {
        panel.classList.remove('hidden');
        panel.classList.add('flex');
      }
      panel.dataset.stage = snapshot.stage;
    }

    if (statusEl) {
      statusEl.textContent = snapshot.statusText || '';
    }
    if (metricsEl) {
      metricsEl.textContent = snapshot.metricsText || '';
    }
    if (barEl) {
      const pct = Math.max(0, Math.min(100, Number(snapshot.percent) || 0));
      if (barEl.style) {
        barEl.style.width = `${pct}%`;
        if (typeof barEl.style.setProperty === 'function') {
          barEl.style.setProperty('width', `${pct}%`);
        }
      }
      if (typeof barEl.setAttribute === 'function') {
        barEl.setAttribute('aria-valuenow', String(pct));
      }
      barEl.dataset.percent = String(pct);
    }
    if (cancelBtn) {
      cancelBtn.disabled = !snapshot.canCancel;
      cancelBtn.classList.toggle('hidden', !snapshot.canCancel);
    }
  }

  function ensureEditorPowController() {
    if (editorState.powController) return editorState.powController;
    const lib = getNocturneLibrary();
    if (lib && typeof lib.createPowProgressController === 'function') {
      editorState.powController = lib.createPowProgressController({
        onUpdate(snapshot) {
          renderPowProgressUI(snapshot);
        }
      });
      return editorState.powController;
    }

    // Minimal lightweight fallback controller if library-utils.js is not loaded
    let activeCtrl = null;
    let stage = 'idle';
    let lastSnap = {
      stage: 'idle',
      nonce: 0,
      iterations: 0,
      hashRateHps: 0,
      elapsedMs: 0,
      batchIndex: 0,
      percent: 0,
      canCancel: false,
      statusText: 'Sẵn sàng',
      metricsText: 'Nonce #0 · 0 H/s · 0.0s'
    };
    editorState.powController = {
      beginSession() {
        if (activeCtrl && !activeCtrl.signal.aborted) activeCtrl.abort('superseded');
        activeCtrl = new AbortController();
        stage = 'requesting_challenge';
        lastSnap = { ...lastSnap, stage, percent: 8, canCancel: true, statusText: '⏳ Đang lấy thử thách PoW SHA-256 từ LRCLIB...' };
        renderPowProgressUI(lastSnap);
        return { signal: activeCtrl.signal, snapshot: lastSnap };
      },
      setStage(nextStage, extra = {}) {
        stage = nextStage;
        const pct = nextStage === 'completed' ? 100 : (nextStage === 'publishing' ? 96 : (nextStage === 'solving' ? 15 : 8));
        const canCancel = nextStage === 'requesting_challenge' || nextStage === 'solving' || nextStage === 'publishing';
        const statusText = nextStage === 'completed'
          ? '✅ Đóng góp lên LRCLIB thành công!'
          : (nextStage === 'publishing'
            ? '🚀 Đã giải xong PoW · Đang gửi lời bài hát lên LRCLIB...'
            : (nextStage === 'aborted'
              ? '⏹ Đã hủy giải PoW tức thì.'
              : (nextStage === 'error'
                ? `⚠️ Lỗi giải PoW / đóng góp${extra.errorMessage ? ': ' + extra.errorMessage : ''}`
                : '⏳ Đang giải PoW SHA-256...')));
        lastSnap = { ...lastSnap, stage: nextStage, percent: pct, canCancel, statusText };
        renderPowProgressUI(lastSnap);
        return lastSnap;
      },
      reportProgress(p = {}) {
        stage = 'solving';
        const nonce = Number(p.nonce) || 0;
        const hps = Number(p.hashRateHps) || 0;
        const elapsedMs = Number(p.elapsedMs) || 0;
        const batchIndex = Number(p.batchIndex) || 1;
        lastSnap = {
          ...lastSnap,
          stage: 'solving',
          nonce,
          iterations: Number(p.iterations) || nonce,
          hashRateHps: hps,
          elapsedMs,
          batchIndex,
          percent: Math.min(92, 12 + batchIndex * 5),
          canCancel: true,
          statusText: `⏳ Đang giải PoW SHA-256 (lô #${batchIndex})...`,
          metricsText: `Nonce #${nonce} · ${hps} H/s · ${(elapsedMs / 1000).toFixed(1)}s`
        };
        renderPowProgressUI(lastSnap);
        return lastSnap;
      },
      abort(reason = 'pow_cancelled_by_user') {
        const hadActive = Boolean(activeCtrl && !activeCtrl.signal.aborted);
        if (activeCtrl && !activeCtrl.signal.aborted) activeCtrl.abort(reason);
        activeCtrl = null;
        stage = 'aborted';
        lastSnap = { ...lastSnap, stage: 'aborted', canCancel: false, statusText: '⏹ Đã hủy giải PoW tức thì.' };
        renderPowProgressUI(lastSnap);
        return { aborted: hadActive, reason, snapshot: lastSnap };
      },
      reset() {
        if (activeCtrl && !activeCtrl.signal.aborted) activeCtrl.abort('reset');
        activeCtrl = null;
        stage = 'idle';
        lastSnap = { ...lastSnap, stage: 'idle', percent: 0, canCancel: false };
        renderPowProgressUI(lastSnap);
        return lastSnap;
      },
      isRunning: () => stage === 'requesting_challenge' || stage === 'solving' || stage === 'publishing',
      getSignal: () => (activeCtrl ? activeCtrl.signal : null),
      getSnapshot: () => lastSnap,
      getWorkerRunner: () => null
    };
    return editorState.powController;
  }

  function editorCancelPowSolve(reason = 'user_clicked_cancel_pow') {
    const powCtrl = editorState.powController;
    if (!powCtrl) {
      return { aborted: false, reason };
    }
    const wasRunning = powCtrl.isRunning();
    const res = powCtrl.abort(reason);
    const publishBtn = typeof document !== 'undefined' ? document.getElementById('lyrics-editor-publish-btn') : null;
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.innerHTML = '<span>🚀</span> <span>Đóng góp lên LRCLIB</span>';
    }
    if (wasRunning && reason !== 'editor_modal_closed') {
      showToast('Đã hủy giải Proof-of-Work tức thì.');
    }
    return res;
  }

  async function editorPublishToLrclib(publishOptions = {}) {
    const opts = (publishOptions && typeof publishOptions === 'object' && !publishOptions.type && !publishOptions.target)
      ? publishOptions
      : {};

    const client = opts.client || getLrclibClient();
    if (!client || typeof client.publishLyrics !== 'function') {
      showToast('Tính năng đóng góp LRCLIB chưa sẵn sàng (LrclibClient not found).');
      return null;
    }

    const powCtrl = ensureEditorPowController();
    if (powCtrl.isRunning()) {
      return null;
    }

    const title = (editorState.metadata && editorState.metadata.title) || (editorState.track && editorState.track.title) || '';
    const artist = (editorState.metadata && editorState.metadata.artist) || (editorState.track && editorState.track.artist) || '';
    const album = (editorState.metadata && editorState.metadata.album) || (editorState.track && editorState.track.album) || '';

    if (!title || !artist) {
      showToast('Vui lòng cung cấp đầy đủ Tên bài hát và Nghệ sĩ trước khi đóng góp.');
      return null;
    }

    const durSec = Math.round((editorState.metadata.duration_ms || getPlayerDurationMs()) / 1000);
    const lrcText = serializeLrcInternal(editorState.lines, editorState.metadata);
    const plainText = editorState.lines.map(l => l.text).join('\n');

    const publishBtn = typeof document !== 'undefined' ? document.getElementById('lyrics-editor-publish-btn') : null;
    const origHtml = publishBtn ? (publishBtn.innerHTML || '<span>🚀</span> <span>Đóng góp lên LRCLIB</span>') : '<span>🚀</span> <span>Đóng góp lên LRCLIB</span>';
    if (publishBtn) {
      publishBtn.disabled = true;
      publishBtn.innerHTML = '⏳ Đang giải PoW & gửi...';
    }

    const session = powCtrl.beginSession({ signal: opts.signal });
    const signal = session.signal;

    try {
      const result = await client.publishLyrics(
        {
          trackName: title,
          artistName: artist,
          albumName: album,
          duration: durSec,
          plainLyrics: plainText,
          syncedLyrics: lrcText
        },
        {
          signal,
          powRunner: opts.powRunner || (typeof powCtrl.getWorkerRunner === 'function' ? powCtrl.getWorkerRunner() : undefined),
          solvePoW: opts.solvePoW,
          batchSize: opts.batchSize,
          maxIterations: opts.maxIterations,
          onStageChange(stageName, info) {
            powCtrl.setStage(stageName, info);
            if (typeof opts.onStageChange === 'function') {
              opts.onStageChange(stageName, powCtrl.getSnapshot());
            }
          },
          onProgress(progressTelemetry) {
            const snap = powCtrl.reportProgress(progressTelemetry);
            if (typeof opts.onProgress === 'function') {
              opts.onProgress(snap);
            }
          }
        }
      );

      powCtrl.setStage('completed');
      showToast('Đóng góp lên LRCLIB thành công! Cảm ơn bạn.');
      return result;
    } catch (err) {
      if ((err && err.name === 'AbortError') || (signal && signal.aborted)) {
        if (powCtrl.getSnapshot().stage !== 'aborted') {
          powCtrl.abort((signal && signal.reason) || 'pow_aborted');
        }
        if (opts.rethrowAbort === true) throw err;
        return { aborted: true };
      }
      powCtrl.setStage('error', { errorMessage: err && err.message ? err.message : 'Lỗi kết nối' });
      console.error('[LyricsUI] Publish error:', err);
      showToast(`Không thể đóng góp lên LRCLIB: ${err.message || 'Lỗi kết nối'}`);
      if (opts.rethrowError === true) throw err;
      return null;
    } finally {
      if (publishBtn) {
        publishBtn.disabled = false;
        publishBtn.innerHTML = origHtml;
      }
    }
  }

  /**
   * openEditor(track, options):
   * Opens the Lyric Syncer V2 modal for the given track.
   */
  function openEditor(track, options = {}) {
    const modal = ensureEditorModalDOM();
    if (!modal) return;

    editorState.isOpen = true;
    editorState.track = track || (typeof window !== 'undefined' && window.currentTrack) || {};
    editorState.cursorIndex = 0;
    editorState.undoStack = [];
    editorState.redoStack = [];
    editorState.playbackRate = 1.0;

    const title = editorState.track.title || editorState.track.name || 'Chưa rõ tiêu đề';
    const artist = editorState.track.artist || 'Chưa rõ nghệ sĩ';
    const album = editorState.track.album || '';

    editorState.metadata = {
      title,
      artist,
      album,
      duration_ms: (editorState.track.duration || 0) * 1000 || getPlayerDurationMs()
    };

    const titleEl = document.getElementById('lyrics-editor-title');
    if (titleEl) titleEl.textContent = title;
    const subEl = document.getElementById('lyrics-editor-subtitle');
    if (subEl) subEl.textContent = `${artist}${album ? ` · ${album}` : ''}`;

    const rateSelect = document.getElementById('lyrics-editor-playback-rate');
    if (rateSelect) rateSelect.value = '1.0';
    setPlayerPlaybackRate(1.0);

    // Load initial lines
    let rawLines = options.lines;
    if (!rawLines && options.lyricsText) {
      rawLines = parseLrcInternal(options.lyricsText).lines;
    }
    if (!rawLines && typeof localStorage !== 'undefined' && editorState.track.id) {
      const cached = localStorage.getItem(`nocturne-lyrics-${editorState.track.id}`);
      if (cached) rawLines = parseLrcInternal(cached).lines;
    }
    if (!rawLines && typeof window !== 'undefined' && window.state && Array.isArray(window.state.lyrics) && window.state.lyrics.length > 0) {
      rawLines = window.state.lyrics.map(l => ({
        text: l.text || '',
        start_ms: (l.start_ms !== undefined) ? l.start_ms : Math.round((l.time || 0) * 1000),
        end_ms: (l.end_ms !== undefined) ? l.end_ms : Math.round((l.time || 0) * 1000) + 3000,
        words: l.words
      }));
    }

    if (!rawLines || rawLines.length === 0) {
      editorState.lines = [
        { text: 'Dòng 1', start_ms: 0, end_ms: 3000 }
      ];
    } else {
      editorState.lines = JSON.parse(JSON.stringify(rawLines)).map(l => ({
        text: l.text || '',
        start_ms: (l.start_ms !== undefined) ? l.start_ms : Math.round((l.time || 0) * 1000),
        end_ms: (l.end_ms !== undefined) ? l.end_ms : (l.start_ms || 0) + 3000,
        words: l.words || null
      }));
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (typeof document !== 'undefined') {
      document.body.classList.add('lyrics-editor-open');
    }

    renderEditorLinesList();
    setupKeyboardShortcuts();
    startEditorSyncLoop();
    updatePlayButtonState();
  }

  function closeEditor() {
    if (editorState.powController && editorState.powController.isRunning()) {
      editorCancelPowSolve('editor_modal_closed');
    }
    const modal = document.getElementById('lyrics-editor-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    if (typeof document !== 'undefined') {
      document.body.classList.remove('lyrics-editor-open');
    }
    editorState.isOpen = false;
    removeKeyboardShortcuts();
    stopEditorSyncLoop();
    setPlayerPlaybackRate(1.0);
  }

  // =========================================================================
  // 3. MANUAL LRCLIB SEARCH MODAL (#lyrics-search-modal)
  // =========================================================================

  const searchState = {
    isOpen: false,
    track: null,
    results: []
  };

  function ensureSearchModalDOM() {
    if (typeof document === 'undefined') return null;
    let modal = document.getElementById('lyrics-search-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'lyrics-search-modal';
    modal.className = 'fixed inset-0 z-[85] hidden items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'lyrics-search-title-header');

    modal.innerHTML = `
      <section class="flex flex-col w-full max-w-2xl max-h-[85vh] bg-[#16191c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-zinc-100 font-sans">
        <!-- Header -->
        <header class="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 bg-black/30">
          <div class="min-w-0">
            <p class="text-[10px] uppercase tracking-[.2em] text-cyan-400 font-semibold">LRCLIB · Tìm kiếm lời bài hát</p>
            <h2 id="lyrics-search-title-header" class="mt-0.5 truncate text-lg font-semibold text-white">Tra cứu lời trực tuyến</h2>
            <p class="truncate text-xs text-zinc-400">Kho lời bài hát cộng đồng mở chuẩn LRC & Word-synced</p>
          </div>
          <button id="lyrics-search-close-btn" type="button" class="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-lg text-zinc-300 hover:bg-white/10 hover:text-white transition" aria-label="Đóng (Esc)">✕</button>
        </header>

        <!-- Search Form -->
        <div class="flex flex-col gap-3 px-5 py-4 border-b border-white/10 bg-black/20">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label for="lyrics-search-title" class="block text-[11px] font-medium text-zinc-400 mb-1">Tên bài hát</label>
              <input id="lyrics-search-title" type="text" class="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-cyan-400 transition" placeholder="Ví dụ: Bohemian Rhapsody">
            </div>
            <div>
              <label for="lyrics-search-artist" class="block text-[11px] font-medium text-zinc-400 mb-1">Nghệ sĩ / Ca sĩ</label>
              <input id="lyrics-search-artist" type="text" class="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-cyan-400 transition" placeholder="Ví dụ: Queen">
            </div>
          </div>
          <div class="flex items-center justify-between gap-2 pt-1">
            <span id="lyrics-search-status" class="text-xs text-zinc-400" role="status" aria-live="polite">Nhập thông tin và bấm tìm kiếm...</span>
            <button id="lyrics-search-submit" type="button" class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition shadow">
              🔍 Tìm kiếm
            </button>
          </div>
        </div>

        <!-- Results Container -->
        <div id="lyrics-search-results" class="flex-1 overflow-y-auto p-5 space-y-3"></div>

        <!-- Footer -->
        <footer class="flex items-center justify-between px-5 py-3 border-t border-white/10 bg-black/30 text-[11px] text-zinc-500">
          <span>Dữ liệu mở từ <a href="https://lrclib.net" target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:underline">LRCLIB</a></span>
          <button id="lyrics-search-close-bottom-btn" type="button" class="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-zinc-300 text-xs transition">Đóng</button>
        </footer>
      </section>
    `;

    document.body.appendChild(modal);
    bindSearchStaticEvents(modal);
    return modal;
  }

  function bindSearchStaticEvents(modal) {
    if (!modal) return;

    const closeBtn = modal.querySelector('#lyrics-search-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeSearch);

    const bottomCloseBtn = modal.querySelector('#lyrics-search-close-bottom-btn');
    if (bottomCloseBtn) bottomCloseBtn.addEventListener('click', closeSearch);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSearch();
    });

    const submitBtn = modal.querySelector('#lyrics-search-submit');
    if (submitBtn) submitBtn.addEventListener('click', executeLyricsSearch);

    const titleInput = modal.querySelector('#lyrics-search-title');
    const artistInput = modal.querySelector('#lyrics-search-artist');

    const handleKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeLyricsSearch();
      }
    };
    if (titleInput) titleInput.addEventListener('keydown', handleKey);
    if (artistInput) artistInput.addEventListener('keydown', handleKey);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchState.isOpen) {
        closeSearch();
      }
    });
  }

  async function executeLyricsSearch() {
    const titleInput = document.getElementById('lyrics-search-title');
    const artistInput = document.getElementById('lyrics-search-artist');
    const statusEl = document.getElementById('lyrics-search-status');
    const resultsContainer = document.getElementById('lyrics-search-results');

    if (!titleInput || !artistInput || !statusEl || !resultsContainer) return;

    const title = titleInput.value.trim();
    const artist = artistInput.value.trim();

    if (!title && !artist) {
      statusEl.textContent = 'Vui lòng nhập tên bài hát hoặc nghệ sĩ.';
      return;
    }

    const query = `${title} ${artist}`.trim();
    statusEl.textContent = 'Đang tìm kiếm trên LRCLIB...';
    resultsContainer.innerHTML = `
      <div class="py-8 text-center text-zinc-500">
        <div class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"></div>
        <p class="mt-2 text-xs">Đang truy vấn cơ sở dữ liệu lời bài hát...</p>
      </div>
    `;

    const client = getLrclibClient();
    if (!client || typeof client.searchLyrics !== 'function') {
      statusEl.textContent = 'Lỗi: Client LRCLIB chưa sẵn sàng.';
      resultsContainer.innerHTML = '';
      return;
    }

    try {
      const results = await client.searchLyrics(query, {
        track_name: title || undefined,
        artist_name: artist || undefined
      });

      searchState.results = results || [];

      if (!results || results.length === 0) {
        statusEl.textContent = 'Không tìm thấy lời bài hát nào cho từ khóa này.';
        resultsContainer.innerHTML = `
          <div class="py-12 text-center text-zinc-500">
            <p class="text-sm">Không tìm thấy kết quả phù hợp trên LRCLIB.</p>
            <p class="mt-1 text-xs text-zinc-600">Hãy thử điều chỉnh tên bài hát hoặc tên nghệ sĩ.</p>
          </div>
        `;
        return;
      }

      statusEl.textContent = `Tìm thấy ${results.length} kết quả trên LRCLIB:`;
      renderSearchResults(results, resultsContainer);
    } catch (err) {
      console.error('[LyricsUI] Search error:', err);
      statusEl.textContent = `Lỗi tra cứu: ${err.message || 'Không thể kết nối máy chủ'}`;
      resultsContainer.innerHTML = '';
    }
  }

  function renderSearchResults(results, container) {
    container.innerHTML = '';

    results.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'flex flex-col gap-2 p-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition';

      // Badges detection
      const hasWordSync = Boolean(
        item.hasWordSync ||
        (item.syncedLyrics && /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/.test(item.syncedLyrics))
      );
      const hasSyncedLyrics = Boolean(item.hasSyncedLyrics || item.syncedLyrics);
      const hasPlainLyrics = Boolean(item.hasPlainLyrics || item.plainLyrics);
      const instrumental = Boolean(item.instrumental);

      const badgesHtml = [
        hasWordSync ? '<span class="badge-word-sync px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30">Word Synced</span>' : '',
        hasSyncedLyrics ? '<span class="badge-synced px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">Synced</span>' : '',
        hasPlainLyrics ? '<span class="badge-plain px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-600/30 text-zinc-300 border border-zinc-500/30">Plain</span>' : '',
        instrumental ? '<span class="badge-instrumental px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">Instrumental</span>' : ''
      ].filter(Boolean).join(' ');

      const durText = item.duration ? formatSec(item.duration) : '';

      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h4 class="text-sm font-semibold text-white truncate">${esc(item.trackName || 'Không có tên')}</h4>
            <p class="text-xs text-zinc-400 mt-0.5 truncate">${esc(item.artistName || 'Chưa rõ nghệ sĩ')}${item.albumName ? ` · ${esc(item.albumName)}` : ''}</p>
          </div>
          <div class="text-right shrink-0">
            <span class="text-xs font-mono text-zinc-500">${durText}</span>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
          <div class="flex flex-wrap items-center gap-1.5">
            ${badgesHtml}
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-preview-lyrics px-2.5 py-1 text-xs rounded border border-white/10 hover:bg-white/5 text-zinc-300 transition">Xem trước</button>
            <button type="button" class="btn-apply-lyrics px-3 py-1 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition shadow" data-id="${esc(item.id)}">Áp dụng</button>
          </div>
        </div>
        <div class="preview-box hidden mt-2 p-2.5 rounded-lg bg-black/50 border border-white/5 text-xs text-zinc-300 font-mono max-h-40 overflow-y-auto whitespace-pre-wrap"></div>
      `;

      // Preview toggle
      const previewBtn = card.querySelector('.btn-preview-lyrics');
      const previewBox = card.querySelector('.preview-box');
      if (previewBtn && previewBox) {
        previewBtn.addEventListener('click', () => {
          const isHidden = previewBox.classList.contains('hidden');
          if (isHidden) {
            previewBox.textContent = item.syncedLyrics || item.plainLyrics || (instrumental ? '(Bản hòa tấu - Không có lời)' : 'Không có nội dung lời');
            previewBox.classList.remove('hidden');
            previewBtn.textContent = 'Thu gọn';
          } else {
            previewBox.classList.add('hidden');
            previewBtn.textContent = 'Xem trước';
          }
        });
      }

      // Apply button
      const applyBtn = card.querySelector('.btn-apply-lyrics');
      if (applyBtn) {
        applyBtn.addEventListener('click', () => applyLyricsItem(item));
      }

      container.appendChild(card);
    });
  }

  async function applyLyricsItem(item) {
    if (!item) return;

    let lyricContent = item.syncedLyrics || item.plainLyrics || '';
    if (item.instrumental) {
      lyricContent = '[00:00.00] (Instrumental)';
    }

    // If lyrics are not fully loaded on search result, fetch by ID
    const client = getLrclibClient();
    if (!lyricContent && item.id && client && typeof client.getLyricsById === 'function') {
      try {
        const fullItem = await client.getLyricsById(item.id);
        if (fullItem) {
          lyricContent = fullItem.syncedLyrics || fullItem.plainLyrics || '';
        }
      } catch (e) {
        console.warn('[LyricsUI] Could not fetch full item:', e);
      }
    }

    const currentTrack = searchState.track || (typeof window !== 'undefined' && window.currentTrack);
    const trackKey = currentTrack ? (currentTrack.fingerprint || currentTrack.id) : String(item.id);

    // 1. Save to offline vault
    if (client && typeof client.saveLyricsToVault === 'function') {
      try {
        await client.saveLyricsToVault(trackKey, {
          key: trackKey,
          lrc: lyricContent,
          metadata: {
            title: item.trackName,
            artist: item.artistName,
            album: item.albumName,
            duration_ms: (item.duration || 0) * 1000,
            instrumental: item.instrumental
          },
          source: 'lrclib-search',
          updatedAt: Date.now()
        });
      } catch (err) {
        console.warn('[LyricsUI] Failed to save to vault:', err);
      }
    }

    // 2. Save to localStorage
    if (currentTrack && currentTrack.id && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`nocturne-lyrics-${currentTrack.id}`, lyricContent);
      } catch (_) {}
    }

    // 3. Update player view immediately
    if (typeof window !== 'undefined') {
      if (window.state) {
        const parsed = parseLrcInternal(lyricContent);
        window.state.lyrics = parsed.lines.map(l => ({
          time: (l.start_ms || 0) / 1000,
          text: l.text,
          words: l.words
        }));
        window.state.lyricIndex = -1;
      }
      if (typeof window.renderLyrics === 'function') {
        window.renderLyrics(lyricContent, currentTrack);
      }
      if (typeof window.renderFullscreenLyrics === 'function') {
        window.renderFullscreenLyrics();
      }
    }

    showToast('Đã áp dụng lời bài hát từ LRCLIB thành công!');
    closeSearch();
  }

  function openSearch(track, options = {}) {
    const modal = ensureSearchModalDOM();
    if (!modal) return;

    searchState.isOpen = true;
    searchState.track = track || (typeof window !== 'undefined' && window.currentTrack) || {};
    searchState.results = [];

    const titleInput = document.getElementById('lyrics-search-title');
    const artistInput = document.getElementById('lyrics-search-artist');
    const statusEl = document.getElementById('lyrics-search-status');
    const resultsContainer = document.getElementById('lyrics-search-results');

    const defaultTitle = searchState.track.title || searchState.track.name || '';
    const defaultArtist = searchState.track.artist || '';

    if (titleInput) titleInput.value = defaultTitle;
    if (artistInput) artistInput.value = defaultArtist;
    if (resultsContainer) resultsContainer.innerHTML = '';
    if (statusEl) statusEl.textContent = 'Nhập thông tin và bấm tìm kiếm...';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (typeof document !== 'undefined') {
      document.body.classList.add('lyrics-search-open');
    }

    // Automatically trigger search if title or artist is available
    if (defaultTitle || defaultArtist) {
      executeLyricsSearch();
    }
  }

  function closeSearch() {
    const modal = document.getElementById('lyrics-search-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    if (typeof document !== 'undefined') {
      document.body.classList.remove('lyrics-search-open');
    }
    searchState.isOpen = false;
  }

  // =========================================================================
  // 4. FACTORY & PUBLIC API
  // =========================================================================

  function init(options = {}) {
    if (typeof document === 'undefined') return;

    // Attach to existing trigger buttons if present in DOM
    const editBtn = document.getElementById('room-lyrics-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const cur = (window.state && window.state.tracks && window.state.tracks.find(t => t.id === window.state.currentId)) || window.currentTrack;
        openEditor(cur);
      });
    }

    const searchBtn = document.getElementById('room-lyrics-search-btn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        const cur = (window.state && window.state.tracks && window.state.tracks.find(t => t.id === window.state.currentId)) || window.currentTrack;
        openSearch(cur);
      });
    }
  }

  // Auto-init when DOM is ready in browser
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init());
    } else {
      setTimeout(() => init(), 0);
    }
  }

  const api = {
    // 1. Karaoke Renderer
    renderKaraokeLine,

    // 2. Syncer V2 Editor
    openEditor,
    closeEditor,
    editorState,
    editorUndo,
    editorRedo,
    editorNudge,
    editorStampAndAdvance,
    editorAddLine,
    editorSaveToDevice,
    editorExportLrc,
    editorExportYaml,
    editorPublishToLrclib,
    editorCancelPowSolve,
    ensureEditorPowController,

    // 3. LRCLIB Search Modal
    openSearch,
    closeSearch,
    searchState,
    executeLyricsSearch,
    applyLyricsItem,

    // 4. Utilities
    detectTimelineAnomalies,
    shiftLyricsLines,
    parseLrc: parseLrcInternal,
    serializeLrc: serializeLrcInternal,
    serializeLyricsfile: serializeLyricsfileInternal,
    formatMs,
    formatSec,
    parseTimestampToMs,
    init,

    // Factory method for DI/Testing
    create: (opts = {}) => ({
      renderKaraokeLine,
      openEditor: (t, o) => openEditor(t, { ...opts, ...o }),
      closeEditor,
      openSearch: (t, o) => openSearch(t, { ...opts, ...o }),
      closeSearch,
      init: () => init(opts)
    })
  };

  return api;
});
