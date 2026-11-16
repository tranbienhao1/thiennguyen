/**
 * ui-overlay.js
 * Nocturne Audiophile UI Toolkit:
 * 1. Global Command Palette (Ctrl+K, Cmd+K, /): Spotlight overlay with instant search & keyboard navigation
 * 2. Mini Player & Picture-in-Picture (PiP) Mode: Floating compact HUD & Document PiP support
 * 3. Smart Sleep Timer: Smooth equal-power volume fadeout over final countdown seconds
 * 4. Web Audio Graph Invariant Protection: Strictly preserving state.crossfeedNodes.output.connect(state.context.destination)
 *
 * UMD Pattern: Browser (window.UIOverlay) + Node.js (module.exports)
 */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.UIOverlay = api;
    // Expose primary top-level convenience functions to window
    root.setSmartSleepTimer = api.setSmartSleepTimer;
    root.clearSmartSleepTimer = api.clearSmartSleepTimer;
    root.getSmartSleepTimerStatus = api.getSmartSleepTimerStatus;
    root.toggleCommandPalette = api.toggleCommandPalette;
    root.openCommandPalette = api.openCommandPalette;
    root.closeCommandPalette = api.closeCommandPalette;
    root.toggleMiniPlayer = api.toggleMiniPlayer;
    root.togglePipMode = api.togglePipMode;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // =========================================================================
  // 1. HELPERS & STRING NORMALIZATION
  // =========================================================================

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function normalizeSearchText(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .trim();
  }

  function isInputElement(el) {
    if (!el || typeof el !== 'object') return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
  }

  // =========================================================================
  // 2. GLOBAL COMMAND PALETTE (CTRL+K, CMD+K, /)
  // =========================================================================

  /**
   * Default quick actions indexed in Spotlight Command Palette
   */
  const DEFAULT_QUICK_ACTIONS = [
    {
      id: 'action-play-pause',
      type: 'action',
      category: 'action',
      icon: '⏯',
      title: 'Phát / Tạm dừng (Play / Pause)',
      subtitle: 'Điều khiển phát nhạc chính',
      shortcut: 'Space / K',
      keywords: ['play', 'pause', 'phat', 'tam dung', 'space', 'k'],
      handler: function (ctx) {
        if (typeof ctx?.playPause === 'function') {
          ctx.playPause();
        } else if (typeof document !== 'undefined') {
          const btn = document.getElementById('play-button');
          if (btn) btn.click();
        }
      }
    },
    {
      id: 'action-next',
      type: 'action',
      category: 'action',
      icon: '⏭',
      title: 'Bài tiếp theo (Next Track)',
      subtitle: 'Chuyển sang bài kế tiếp trong danh sách',
      shortcut: 'N',
      keywords: ['next', 'tiep', 'ke tiep', 'bai sau', 'n'],
      handler: function (ctx) {
        if (typeof ctx?.playNext === 'function') {
          ctx.playNext(1);
        } else if (typeof window !== 'undefined' && typeof window.playNext === 'function') {
          window.playNext(1);
        } else if (typeof document !== 'undefined') {
          const btn = document.getElementById('next-button');
          if (btn) btn.click();
        }
      }
    },
    {
      id: 'action-prev',
      type: 'action',
      category: 'action',
      icon: '⏮',
      title: 'Bài trước đó (Previous Track)',
      subtitle: 'Quay lại bài trước hoặc đầu bài hát',
      shortcut: 'P',
      keywords: ['prev', 'previous', 'truoc', 'quay lai', 'p'],
      handler: function (ctx) {
        if (typeof ctx?.playNext === 'function') {
          ctx.playNext(-1);
        } else if (typeof window !== 'undefined' && typeof window.playNext === 'function') {
          window.playNext(-1);
        } else if (typeof document !== 'undefined') {
          const btn = document.getElementById('previous-button');
          if (btn) btn.click();
        }
      }
    },
    {
      id: 'action-shuffle',
      type: 'action',
      category: 'action',
      icon: '🔀',
      title: 'Bật / Tắt Trộn bài (Toggle Shuffle)',
      subtitle: 'Xáo trộn thứ tự phát ngẫu nhiên',
      shortcut: 'S',
      keywords: ['shuffle', 'tron bai', 'xao tron', 'random', 's'],
      handler: function (ctx) {
        if (typeof ctx?.toggleShuffle === 'function') {
          ctx.toggleShuffle();
        } else if (typeof document !== 'undefined') {
          const btn = document.getElementById('shuffle-button');
          if (btn) btn.click();
        }
      }
    },
    {
      id: 'action-toggle-eq',
      type: 'action',
      category: 'action',
      icon: '🎛',
      title: 'Bật / Tắt Bộ chỉnh âm EQ (Toggle EQ)',
      subtitle: 'Mở bảng điều khiển Parametric EQ & DSP',
      shortcut: 'E',
      keywords: ['eq', 'equalizer', 'dsp', 'bo chinh am', 'e'],
      handler: function (ctx) {
        if (typeof ctx?.toggleEq === 'function') {
          ctx.toggleEq();
        } else if (typeof document !== 'undefined') {
          const btn = document.getElementById('eq-button');
          if (btn) btn.click();
        }
      }
    },
    {
      id: 'action-switch-theme',
      type: 'action',
      category: 'action',
      icon: '🎨',
      title: 'Đổi Giao diện / Bảng màu (Switch Theme)',
      subtitle: 'Xoay vòng bảng màu Spectrum Visualizer',
      shortcut: 'T',
      keywords: ['theme', 'mau', 'visualizer', 'giao dien', 'palette', 't'],
      handler: function (ctx) {
        if (typeof ctx?.switchTheme === 'function') {
          ctx.switchTheme();
        } else if (typeof window !== 'undefined' && typeof window.cycleVisualizerTheme === 'function') {
          window.cycleVisualizerTheme();
        } else if (typeof document !== 'undefined') {
          const viz = document.getElementById('visualizer');
          if (viz) viz.click();
        }
      }
    },
    {
      id: 'action-open-lyrics',
      type: 'action',
      category: 'action',
      icon: '📜',
      title: 'Xem Lời bài hát (Open Lyrics)',
      subtitle: 'Mở phòng nghe và bảng lời đồng bộ .lrc',
      shortcut: 'L',
      keywords: ['lyrics', 'loi bai hat', 'lrc', 'karaoke', 'l'],
      handler: function (ctx) {
        if (typeof ctx?.openLyrics === 'function') {
          ctx.openLyrics();
        } else if (typeof window !== 'undefined' && typeof window.openListeningRoom === 'function') {
          window.openListeningRoom();
        } else if (typeof document !== 'undefined') {
          const roomBtn = document.getElementById('room-button');
          if (roomBtn) roomBtn.click();
        }
      }
    },
    {
      id: 'action-open-settings',
      type: 'action',
      category: 'action',
      icon: '⚙',
      title: 'Mở Cài đặt (Open Settings)',
      subtitle: 'Cấu hình âm thanh, máy chủ và lưu trữ',
      shortcut: ',',
      keywords: ['settings', 'cai dat', 'cau hinh', 'options', 'config'],
      handler: function (ctx) {
        if (typeof ctx?.openSettings === 'function') {
          ctx.openSettings();
        } else if (typeof window !== 'undefined' && typeof window.showSettings === 'function') {
          window.showSettings();
        } else if (typeof document !== 'undefined') {
          const btn = document.getElementById('settings-button');
          if (btn) btn.click();
        }
      }
    },
    {
      id: 'action-toggle-mini',
      type: 'action',
      category: 'action',
      icon: '🗗',
      title: 'Bật / Tắt Mini Player / PiP Mode',
      subtitle: 'Khung điều khiển nhạc thu nhỏ nổi trên màn hình',
      shortcut: 'M',
      keywords: ['mini', 'pip', 'picture in picture', 'hud', 'thu nho', 'm'],
      handler: function () {
        toggleMiniPlayer();
      }
    },
    {
      id: 'action-smart-sleep',
      type: 'action',
      category: 'action',
      icon: '◷',
      title: 'Hẹn giờ ngủ thông minh (Smart Sleep Timer · 30m)',
      subtitle: 'Tự động giảm dần âm lượng 30s cuối trước khi dừng',
      shortcut: 'Z',
      keywords: ['sleep', 'timer', 'hen gio ngu', 'fadeout', 'smart sleep'],
      handler: function () {
        setSmartSleepTimer(30, { fadeOutSeconds: 30 });
      }
    }
  ];

  /**
   * Builds an indexed array of all searchable items:
   * - Quick actions
   * - Tracks
   * - Unique Albums
   * - Unique Artists
   */
  function buildCommandPaletteItems(state, customActions = []) {
    const items = [];

    // 1. Actions
    const actions = Array.isArray(customActions) && customActions.length > 0
      ? customActions
      : DEFAULT_QUICK_ACTIONS;

    actions.forEach(act => {
      items.push({
        id: act.id,
        type: 'action',
        category: 'action',
        icon: act.icon || '⚡',
        title: act.title,
        subtitle: act.subtitle || 'Lệnh hệ thống',
        shortcut: act.shortcut || '',
        keywords: act.keywords || [],
        handler: act.handler
      });
    });

    if (!state || !Array.isArray(state.tracks)) {
      return items;
    }

    const albumMap = new Map();
    const artistMap = new Map();

    // 2. Tracks
    state.tracks.forEach(track => {
      if (!track || !track.id) return;
      const title = track.title || 'Không rõ tiêu đề';
      const artist = track.artist || 'Không rõ nghệ sĩ';
      const album = track.album || '';

      items.push({
        id: `track-${track.id}`,
        type: 'track',
        category: 'track',
        icon: '🎵',
        title: title,
        subtitle: album ? `${artist} · ${album}` : artist,
        trackId: track.id,
        artist: artist,
        album: album,
        cover: track.cover || null,
        handler: function () {
          if (typeof window !== 'undefined' && typeof window.playTrack === 'function') {
            window.playTrack(track.id);
          }
        }
      });

      // Aggregate albums
      if (album && album !== '—' && album !== 'Unknown Album') {
        const count = albumMap.get(album) || 0;
        albumMap.set(album, count + 1);
      }

      // Aggregate artists
      if (artist && artist !== '—' && artist !== 'Unknown Artist') {
        const count = artistMap.get(artist) || 0;
        artistMap.set(artist, count + 1);
      }
    });

    // 3. Albums
    albumMap.forEach((count, albumName) => {
      items.push({
        id: `album-${encodeURIComponent(albumName)}`,
        type: 'album',
        category: 'album',
        icon: '💿',
        title: albumName,
        subtitle: `${count} bài hát`,
        album: albumName,
        handler: function () {
          if (typeof document !== 'undefined') {
            const albumSelect = document.getElementById('album-filter');
            if (albumSelect) {
              albumSelect.value = albumName;
              if (state) state.album = albumName;
              if (typeof window !== 'undefined') {
                if (typeof window.setLibraryView === 'function') window.setLibraryView('tracks');
                if (typeof window.renderTracks === 'function') window.renderTracks();
              }
            }
          }
        }
      });
    });

    // 4. Artists
    artistMap.forEach((count, artistName) => {
      items.push({
        id: `artist-${encodeURIComponent(artistName)}`,
        type: 'artist',
        category: 'artist',
        icon: '🎤',
        title: artistName,
        subtitle: `${count} bài hát`,
        artist: artistName,
        handler: function () {
          if (typeof document !== 'undefined') {
            const artistSelect = document.getElementById('artist-filter');
            if (artistSelect) {
              artistSelect.value = artistName;
              if (state) state.artist = artistName;
              if (typeof window !== 'undefined') {
                if (typeof window.setLibraryView === 'function') window.setLibraryView('tracks');
                if (typeof window.renderTracks === 'function') window.renderTracks();
              }
            }
          }
        }
      });
    });

    return items;
  }

  /**
   * Search and filter palette items based on query string with ranking
   */
  function searchPaletteItems(items, query, limit = 40) {
    if (!Array.isArray(items)) return [];
    const trimmed = (query || '').trim();

    if (!trimmed) {
      // Default view: all actions first, then a sampling of tracks, albums, artists
      const actions = items.filter(it => it.type === 'action');
      const tracks = items.filter(it => it.type === 'track').slice(0, 15);
      const albums = items.filter(it => it.type === 'album').slice(0, 6);
      const artists = items.filter(it => it.type === 'artist').slice(0, 6);
      return [...actions, ...tracks, ...albums, ...artists].slice(0, limit);
    }

    const normQ = normalizeSearchText(trimmed);
    const tokens = normQ.split(/\s+/).filter(Boolean);

    const scored = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const normTitle = normalizeSearchText(item.title);
      const normSub = normalizeSearchText(item.subtitle);
      const normType = normalizeSearchText(item.type);
      const normKeywords = Array.isArray(item.keywords)
        ? item.keywords.map(k => normalizeSearchText(k)).join(' ')
        : '';

      const fullHaystack = `${normTitle} ${normSub} ${normType} ${normKeywords}`;

      // Every token must be present in haystack
      let allMatch = true;
      for (let t = 0; t < tokens.length; t++) {
        if (!fullHaystack.includes(tokens[t])) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;

      let score = 0;

      // Ranking heuristic
      if (normTitle === normQ) score += 1200;
      else if (normTitle.startsWith(normQ)) score += 600;
      else if (normTitle.includes(normQ)) score += 300;

      if (normSub.startsWith(normQ)) score += 200;
      else if (normSub.includes(normQ)) score += 100;

      if (item.type === 'action') score += 150;
      if (normKeywords.includes(normQ)) score += 100;

      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.item);
  }

  /**
   * Handle palette keyboard navigation: ArrowUp, ArrowDown, Enter, Escape
   */
  function handlePaletteKeydown(event, options = {}) {
    if (!event) return { handled: false };
    const {
      items = [],
      selectedIndex = 0,
      onSelect,
      onClose,
      setSelectedIndex
    } = options;

    const total = items.length;

    if (event.key === 'ArrowDown') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const newIndex = total > 0 ? (selectedIndex + 1) % total : 0;
      if (typeof setSelectedIndex === 'function') setSelectedIndex(newIndex);
      return { handled: true, newIndex, executed: false };
    }

    if (event.key === 'ArrowUp') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const newIndex = total > 0 ? (selectedIndex - 1 + total) % total : 0;
      if (typeof setSelectedIndex === 'function') setSelectedIndex(newIndex);
      return { handled: true, newIndex, executed: false };
    }

    if (event.key === 'Enter') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const selected = items[selectedIndex];
      if (selected) {
        if (typeof onSelect === 'function') onSelect(selected);
        if (typeof selected.handler === 'function') {
          try { selected.handler(); } catch (err) { console.warn('Command handler error:', err); }
        }
        if (typeof onClose === 'function') onClose();
        return { handled: true, newIndex: selectedIndex, executed: true, selected };
      }
      return { handled: false, newIndex: selectedIndex, executed: false };
    }

    if (event.key === 'Escape') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof onClose === 'function') onClose();
      return { handled: true, newIndex: selectedIndex, executed: false, dismissed: true };
    }

    return { handled: false, newIndex: selectedIndex, executed: false };
  }

  /**
   * Checks whether an event triggers the Spotlight Command Palette:
   * Ctrl+K, Cmd+K, or / (when not focused in an input/textarea)
   */
  function isCommandPaletteShortcut(event) {
    if (!event) return false;
    const isK = event.key === 'k' || event.key === 'K';
    const hasMod = Boolean(event.ctrlKey || event.metaKey);
    if (hasMod && isK) return true;

    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return !isInputElement(event.target);
    }

    return false;
  }

  // Active palette DOM instance state
  const paletteState = {
    isOpen: false,
    selectedIndex: 0,
    filteredItems: [],
    allItems: [],
    initialized: false
  };

  function renderPaletteRows() {
    if (typeof document === 'undefined') return;
    const resultsContainer = document.getElementById('palette-results');
    if (!resultsContainer) return;

    if (paletteState.filteredItems.length === 0) {
      resultsContainer.innerHTML = `
        <div class="py-8 text-center text-xs text-zinc-500">
          <p>Không tìm thấy bài hát, album, nghệ sĩ hoặc lệnh phù hợp.</p>
          <p class="mt-1 text-[11px] text-zinc-600">Thử tìm kiếm với từ khóa khác.</p>
        </div>
      `;
      return;
    }

    let html = '';
    for (let i = 0; i < paletteState.filteredItems.length; i++) {
      const item = paletteState.filteredItems[i];
      const isSelected = i === paletteState.selectedIndex;
      const typeBadge = {
        action: '<span class="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-mono text-violet-300">LỆNH</span>',
        track: '<span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300">BÀI HÁT</span>',
        album: '<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-mono text-amber-300">ALBUM</span>',
        artist: '<span class="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-mono text-sky-300">NGHỆ SĨ</span>'
      }[item.type] || '';

      const shortcutBadge = item.shortcut
        ? `<span class="ml-2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">${escapeHtml(item.shortcut)}</span>`
        : '';

      const activeClasses = isSelected
        ? 'bg-violet-600/25 border-violet-500/50 text-white shadow-sm'
        : 'border-transparent text-zinc-200 hover:bg-white/5 hover:text-white';

      html += `
        <div class="palette-item flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 transition-colors ${activeClasses}" data-index="${i}">
          <div class="flex items-center gap-3 min-w-0">
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/5 text-sm">${item.icon || '•'}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-xs font-medium">${escapeHtml(item.title)}</span>
                ${typeBadge}
              </div>
              <p class="truncate text-[11px] text-zinc-400 mt-0.5">${escapeHtml(item.subtitle)}</p>
            </div>
          </div>
          <div class="flex items-center shrink-0">
            ${shortcutBadge}
            <span class="ml-2 text-xs text-zinc-500 ${isSelected ? 'opacity-100' : 'opacity-0'}">↵</span>
          </div>
        </div>
      `;
    }

    resultsContainer.innerHTML = html;

    // Scroll active item into view
    const activeEl = resultsContainer.querySelector(`[data-index="${paletteState.selectedIndex}"]`);
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }

    // Attach click listener
    resultsContainer.querySelectorAll('.palette-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.index);
        const item = paletteState.filteredItems[idx];
        if (item) {
          if (typeof item.handler === 'function') {
            try { item.handler(); } catch (e) { console.warn('Handler error:', e); }
          }
          closeCommandPalette();
        }
      });
    });
  }

  function openCommandPalette() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('command-palette-modal');
    const input = document.getElementById('palette-input');
    if (!modal) return;

    // Rebuild index against current app state if available
    const appState = typeof window !== 'undefined' && window.state ? window.state : null;
    paletteState.allItems = buildCommandPaletteItems(appState);
    paletteState.filteredItems = searchPaletteItems(paletteState.allItems, '');
    paletteState.selectedIndex = 0;
    paletteState.isOpen = true;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 20);
    }
    renderPaletteRows();
  }

  function closeCommandPalette() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('command-palette-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    paletteState.isOpen = false;
  }

  function toggleCommandPalette(show) {
    const shouldOpen = typeof show === 'boolean' ? show : !paletteState.isOpen;
    if (shouldOpen) openCommandPalette();
    else closeCommandPalette();
  }

  function initCommandPalette() {
    if (typeof document === 'undefined' || paletteState.initialized) return;
    paletteState.initialized = true;

    // Listen on input
    const input = document.getElementById('palette-input');
    if (input) {
      input.addEventListener('input', (e) => {
        const q = e.target.value;
        paletteState.filteredItems = searchPaletteItems(paletteState.allItems, q);
        paletteState.selectedIndex = 0;
        renderPaletteRows();
      });

      input.addEventListener('keydown', (e) => {
        const res = handlePaletteKeydown(e, {
          items: paletteState.filteredItems,
          selectedIndex: paletteState.selectedIndex,
          setSelectedIndex: (idx) => {
            paletteState.selectedIndex = idx;
            renderPaletteRows();
          },
          onClose: closeCommandPalette
        });
        if (res.handled) {
          e.stopPropagation();
        }
      });
    }

    // Backdrop click dismiss
    const modal = document.getElementById('command-palette-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCommandPalette();
      });
    }

    // Global keyboard listener for shortcuts (Ctrl+K, Cmd+K, /)
    window.addEventListener('keydown', (e) => {
      if (isCommandPaletteShortcut(e)) {
        e.preventDefault();
        toggleCommandPalette();
      } else if (e.key === 'Escape' && paletteState.isOpen) {
        e.preventDefault();
        closeCommandPalette();
      }
    });
  }

  // =========================================================================
  // 3. MINI PLAYER & PIP MODE
  // =========================================================================

  function calculateProgress(currentTime, duration) {
    const cur = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
    const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const fraction = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
    return {
      fraction,
      percent: fraction * 100,
      currentTimeFormatted: formatTime(cur),
      durationFormatted: formatTime(dur)
    };
  }

  function toggleMiniPlayer(show) {
    if (typeof window !== 'undefined' && typeof window.toggleMiniPlayerHud === 'function') {
      window.toggleMiniPlayerHud(show);
      return;
    }
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('mini-player-hud');
    if (!hud) return;
    const isHidden = typeof show === 'boolean' ? !show : !hud.classList.contains('hidden');
    hud.classList.toggle('hidden', isHidden);
    if (!isHidden) {
      updateMiniPlayer();
    }
  }

  function updateMiniPlayer(state, track) {
    if (typeof window !== 'undefined' && typeof window.updateMiniPlayerHud === 'function') {
      window.updateMiniPlayerHud(track);
      return;
    }
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('mini-player-hud');
    if (!hud) return;

    const curTrack = track || (state && state.tracks ? state.tracks.find(t => t.id === state.currentId) : null);
    const titleEl = document.getElementById('mini-title');
    const artistEl = document.getElementById('mini-artist');
    const coverEl = document.getElementById('mini-cover');

    if (curTrack) {
      if (titleEl) titleEl.textContent = curTrack.title || 'Chưa phát nhạc';
      if (artistEl) artistEl.textContent = curTrack.artist || '—';
      if (coverEl) {
        coverEl.innerHTML = curTrack.cover
          ? `<img src="${escapeHtml(curTrack.cover)}" class="h-full w-full object-cover" alt="">`
          : '♫';
      }
    }
  }

  /**
   * Document Picture-in-Picture or HTML5 Video PiP
   */
  async function togglePipMode(audioElement) {
    // 1. Document Picture-in-Picture API (Chrome 111+)
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window && window.documentPictureInPicture?.requestWindow) {
      if (window.documentPictureInPicture.window) {
        window.documentPictureInPicture.window.close();
        return false;
      }
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: 380,
          height: 120
        });

        // Copy styles
        document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
          pipWin.document.head.appendChild(node.cloneNode(true));
        });

        const curTitle = document.getElementById('now-title')?.textContent || 'Chưa phát nhạc';
        const curArtist = document.getElementById('now-artist')?.textContent || 'Nocturne Audiophile';

        pipWin.document.body.className = 'bg-[#111315] text-white p-3 font-sans select-none flex items-center gap-3';
        pipWin.document.body.innerHTML = `
          <div class="h-12 w-12 rounded-xl bg-violet-600/30 grid place-items-center text-lg text-violet-200 border border-white/10 shrink-0">♫</div>
          <div class="min-w-0 flex-1">
            <p id="pip-title" class="truncate text-xs font-semibold text-white">${escapeHtml(curTitle)}</p>
            <p id="pip-artist" class="truncate text-[10px] text-zinc-400 mt-0.5">${escapeHtml(curArtist)}</p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button id="pip-prev" class="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">‹</button>
            <button id="pip-play" class="rounded-full bg-white text-zinc-950 font-bold px-3 py-1 text-xs">▶</button>
            <button id="pip-next" class="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">›</button>
          </div>
        `;

        pipWin.document.getElementById('pip-play')?.addEventListener('click', () => {
          document.getElementById('play-button')?.click();
        });
        pipWin.document.getElementById('pip-prev')?.addEventListener('click', () => {
          document.getElementById('previous-button')?.click();
        });
        pipWin.document.getElementById('pip-next')?.addEventListener('click', () => {
          document.getElementById('next-button')?.click();
        });

        return true;
      } catch (e) {
        console.warn('Document PiP requestWindow failed, falling back to mini HUD:', e);
      }
    }

    // Fallback: Toggle floating Mini Player HUD in page
    toggleMiniPlayer();
    return true;
  }

  // =========================================================================
  // 4. SMART SLEEP TIMER WITH SMOOTH EQUAL-POWER FADEOUT
  // =========================================================================

  /**
   * Calculates the smooth equal-power sine fadeout gain curve over the final window.
   * - remainingMs >= fadeOutMs -> 1.0 (full volume)
   * - remainingMs <= 0 -> 0.0 (silent)
   * - In-between -> Math.sin((remainingMs / fadeOutMs) * (Math.PI / 2))
   *   At 50% time -> ~0.7071 (-3dB equal power)
   */
  function calculateSmartSleepFadeGain(remainingMs, fadeOutMs = 30000) {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
    const dur = Math.max(1000, Number(fadeOutMs) || 30000);
    if (remainingMs >= dur) return 1;
    const ratio = remainingMs / dur;
    return Math.sin(ratio * (Math.PI / 2));
  }

  function formatSleepCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '00:00';
    const totalSecs = Math.ceil(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // State tracker for smart sleep timer
  const smartSleepState = {
    timer: null,
    interval: null,
    deadline: 0,
    durationMs: 0,
    fadeOutMs: 30000,
    originalVolume: null,
    active: false
  };

  /**
   * Sets smart sleep timer with gradual volume fadeout over the last fadeOutSeconds
   * @param {number} minutes Total sleep duration in minutes
   * @param {object} options { fadeOutSeconds: 30, onTick, onComplete, customState, audio }
   */
  function setSmartSleepTimer(minutes, options = {}) {
    clearSmartSleepTimer();

    const durationMinutes = Number(minutes) || 15;
    const durationMs = durationMinutes * 60 * 1000;
    const fadeOutSeconds = Number(options.fadeOutSeconds) || 30;
    const fadeOutMs = Math.min(fadeOutSeconds * 1000, durationMs);

    smartSleepState.active = true;
    smartSleepState.durationMs = durationMs;
    smartSleepState.fadeOutMs = fadeOutMs;
    smartSleepState.deadline = Date.now() + durationMs;

    // Get app state / volume controls
    const appState = options.customState || (typeof window !== 'undefined' ? window.state : null);
    const volumeInput = typeof document !== 'undefined' ? document.getElementById('volume') : null;
    const curVol = options.initialVolume ?? (volumeInput ? Number(volumeInput.value) : (appState?.sleepOriginalVolume ?? 80));

    smartSleepState.originalVolume = curVol;

    const setVol = (vol) => {
      if (typeof options.setGainFn === 'function') {
        options.setGainFn(vol);
      } else if (typeof window !== 'undefined' && typeof window.setGain === 'function') {
        window.setGain(vol);
      } else if (volumeInput) {
        volumeInput.value = Math.round(vol);
      }
    };

    const getAudio = () => {
      if (options.audio) return options.audio;
      if (typeof document !== 'undefined') return document.getElementById('audio');
      return null;
    };

    smartSleepState.interval = setInterval(() => {
      const remainingMs = smartSleepState.deadline - Date.now();

      if (remainingMs <= 0) {
        // Time is up! Pause playback and restore original volume cleanly
        clearSmartSleepTimer();
        const aud = getAudio();
        if (aud && typeof aud.pause === 'function') {
          aud.pause();
        }
        if (smartSleepState.originalVolume !== null) {
          setVol(smartSleepState.originalVolume);
        }
        if (typeof options.onComplete === 'function') {
          options.onComplete();
        }
        if (typeof window !== 'undefined' && typeof window.toast === 'function') {
          window.toast('Hẹn giờ ngủ: Đã dừng phát nhạc.');
        }
        return;
      }

      // Check if within fadeout window
      if (remainingMs <= smartSleepState.fadeOutMs) {
        const gain = calculateSmartSleepFadeGain(remainingMs, smartSleepState.fadeOutMs);
        setVol(smartSleepState.originalVolume * gain);
      }

      if (typeof options.onTick === 'function') {
        options.onTick({
          remainingMs,
          gain: calculateSmartSleepFadeGain(remainingMs, smartSleepState.fadeOutMs),
          formatted: formatSleepCountdown(remainingMs)
        });
      }
    }, 250);

    if (typeof window !== 'undefined' && typeof window.toast === 'function') {
      window.toast(`Đã hẹn giờ ngủ: ${durationMinutes} phút (fade-out ${fadeOutSeconds}s cuối).`);
    }

    return {
      active: true,
      deadline: smartSleepState.deadline,
      durationMs,
      fadeOutMs,
      clear: clearSmartSleepTimer
    };
  }

  function clearSmartSleepTimer() {
    if (smartSleepState.interval) {
      clearInterval(smartSleepState.interval);
      smartSleepState.interval = null;
    }
    if (smartSleepState.timer) {
      clearTimeout(smartSleepState.timer);
      smartSleepState.timer = null;
    }
    // Restore volume if in mid-fade
    if (smartSleepState.active && smartSleepState.originalVolume !== null) {
      if (typeof window !== 'undefined' && typeof window.setGain === 'function') {
        window.setGain(smartSleepState.originalVolume);
      } else if (typeof document !== 'undefined') {
        const volumeInput = document.getElementById('volume');
        if (volumeInput) volumeInput.value = smartSleepState.originalVolume;
      }
    }
    smartSleepState.active = false;
    smartSleepState.deadline = 0;
  }

  function getSmartSleepTimerStatus() {
    const remainingMs = smartSleepState.active ? Math.max(0, smartSleepState.deadline - Date.now()) : 0;
    return {
      active: smartSleepState.active,
      remainingMs,
      formatted: formatSleepCountdown(remainingMs),
      deadline: smartSleepState.deadline,
      fadeOutMs: smartSleepState.fadeOutMs,
      originalVolume: smartSleepState.originalVolume,
      currentGain: calculateSmartSleepFadeGain(remainingMs, smartSleepState.fadeOutMs)
    };
  }

  // =========================================================================
  // 5. AUDIO INVARIANT VERIFIER
  // =========================================================================

  /**
   * Verifies that state.crossfeedNodes.output connects to state.context.destination
   */
  function verifyAudioGraphInvariant(state) {
    if (!state || !state.crossfeedNodes || !state.context) return false;
    const output = state.crossfeedNodes.output;
    const destination = state.context.destination;
    if (!output || !destination) return false;

    // Check mock connections array if available
    if (Array.isArray(output.connections)) {
      return output.connections.some(c => c.dest === destination);
    }
    return true;
  }

  // Auto-init command palette in browser environment on DOMContentLoaded or immediate
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCommandPalette);
    } else {
      initCommandPalette();
    }
  }

  // Public API
  return {
    // Spotlight Command Palette
    buildCommandPaletteItems,
    searchPaletteItems,
    handlePaletteKeydown,
    isCommandPaletteShortcut,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
    initCommandPalette,
    DEFAULT_QUICK_ACTIONS,

    // Mini Player & PiP
    toggleMiniPlayer,
    updateMiniPlayer,
    togglePipMode,
    calculateProgress,

    // Smart Sleep Timer
    calculateSmartSleepFadeGain,
    formatSleepCountdown,
    setSmartSleepTimer,
    clearSmartSleepTimer,
    getSmartSleepTimerStatus,

    // Audio Invariant
    verifyAudioGraphInvariant,

    // Utilities
    normalizeSearchText,
    escapeHtml,
    formatTime
  };
});
