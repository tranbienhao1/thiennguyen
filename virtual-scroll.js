/**
 * virtual-scroll.js
 * High-performance virtualized track list rendering for Nocturne.
 * Optimizes DOM overhead for large audio libraries (1251+ tracks) on mobile and DAP devices (FiiO M11S).
 * 
 * UMD Pattern: Browser (window.VirtualScroll) + Node.js (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    root.VirtualTrackList = exports.VirtualTrackList;
    root.calculateVirtualWindow = exports.calculateVirtualWindow;
    root.renderVirtualizedTrackRows = exports.renderVirtualizedTrackRows;
    root.VirtualScroll = exports;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Escape HTML utility for default templates.
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Calculates the virtual scrolling window based on list size, scroll position, and viewport dimensions.
   * 
   * @param {number} totalItems - Total number of items in list.
   * @param {number} scrollTop - Current vertical scroll offset in px.
   * @param {number} containerHeight - Viewport or container visible height in px.
   * @param {number} [rowHeight=64] - Fixed height of each row in px.
   * @param {number} [bufferCount=5] - Number of off-screen rows to pre-render above and below.
   * @returns {{ startIndex: number, endIndex: number, topSpacerHeight: number, bottomSpacerHeight: number, visibleIndices: number[] }}
   */
  function calculateVirtualWindow(totalItems, scrollTop, containerHeight, rowHeight, bufferCount) {
    const total = Math.max(0, parseInt(totalItems, 10) || 0);
    const rHeight = Math.max(1, parseFloat(rowHeight) || 64);
    const cHeight = Math.max(0, parseFloat(containerHeight) || 0);
    const buffer = bufferCount !== undefined ? Math.max(0, parseInt(bufferCount, 10) || 0) : 5;

    if (total === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        visibleIndices: []
      };
    }

    const sTop = Math.max(0, parseFloat(scrollTop) || 0);
    const maxScroll = Math.max(0, total * rHeight - cHeight);
    const clampedScroll = Math.min(sTop, maxScroll);

    const firstVisible = Math.floor(clampedScroll / rHeight);
    const lastVisible = Math.ceil((clampedScroll + cHeight) / rHeight);

    const startIndex = Math.max(0, firstVisible - buffer);
    const endIndex = Math.min(total, lastVisible + buffer);

    const topSpacerHeight = startIndex * rHeight;
    const bottomSpacerHeight = Math.max(0, (total - endIndex) * rHeight);

    const visibleIndices = [];
    for (let i = startIndex; i < endIndex; i++) {
      visibleIndices.push(i);
    }

    return {
      startIndex,
      endIndex,
      topSpacerHeight,
      bottomSpacerHeight,
      visibleIndices
    };
  }

  /**
   * Default row template renderer when custom renderRow is not supplied.
   */
  function defaultRenderRow(track, index, options = {}) {
    const active = Boolean(options.currentId && track.id === options.currentId);
    const queued = Boolean(options.queueTrackIds && options.queueTrackIds.includes(track.id) && !active);
    const title = track.title || track.name || 'Unknown Track';
    const artist = track.artist || 'Unknown Artist';
    const album = track.album || 'Unknown Album';
    const duration = typeof options.formatTime === 'function' 
      ? options.formatTime(track.duration) 
      : (track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : '—');
    const coverHtml = track.cover ? `<img src="${escapeHtml(track.cover)}" class="h-full w-full object-contain" alt="">` : '♫';
    const overlayHtml = active ? '<span class="track-playing-overlay absolute inset-0 grid place-items-center bg-black/45 text-white">♫</span>' : '';
    const trackIdx = index + 1;
    const rating = track.rating || 0;
    const stars = '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

    return `<div role="button" tabindex="0" class="track-row ${active ? 'active' : ''} group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[.06] px-4 py-2 text-left transition hover:bg-white/[.04] sm:grid-cols-[minmax(0,1fr)_minmax(100px,.45fr)_minmax(110px,.5fr)_104px]" aria-label="Phát ${escapeHtml(title)} — ${escapeHtml(artist)}" data-track-index="${trackIdx}" data-track-id="${escapeHtml(track.id)}">` +
      `<span class="flex min-w-0 items-center gap-3">` +
        `<span class="track-number relative w-5 shrink-0 text-center text-[10px] tabular-nums text-zinc-600" aria-hidden="true">` +
          `<span class="group-hover:invisible">${String(trackIdx).padStart(2, '0')}</span>` +
          `<span class="track-hover-play absolute inset-0 hidden place-items-center text-[11px] text-zinc-100 group-hover:grid">▶</span>` +
        `</span>` +
        `<span class="track-art relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded bg-zinc-800 text-sm text-zinc-400">` +
          `${coverHtml}${overlayHtml}` +
        `</span>` +
        `<span class="min-w-0">` +
          `<span class="track-title block truncate text-sm font-medium ${active ? 'text-violet-200' : 'text-zinc-200'}">${escapeHtml(title)}</span>` +
          `<span class="mt-0.5 block truncate text-xs text-zinc-500"><span class="artist-link text-[#7675ed] hover:underline cursor-pointer font-medium">${escapeHtml(artist)}</span></span>` +
        `</span>` +
      `</span>` +
      `<span class="hidden truncate text-xs text-zinc-500 sm:block"><span class="album-link hover:underline cursor-pointer">${escapeHtml(album)}</span></span>` +
      `<span class="hidden sm:block"><span class="rounded-full border px-2 py-0.5 text-[9px] font-medium tracking-wide border-white/10 text-zinc-400">${track.format || 'AUDIO'}</span></span>` +
      `<span class="flex items-center justify-end gap-1">` +
        `<span class="track-rating hidden sm:inline-block mr-1 text-[11px] text-amber-400 cursor-pointer select-none hover:opacity-80" data-rating-track-id="${escapeHtml(track.id)}" title="Đánh giá: ${rating}/5 sao">${stars}</span>` +
        `<span class="text-right text-xs tabular-nums text-zinc-400">${duration}</span>` +
        `<button type="button" data-metadata-action="open" data-metadata-track-id="${escapeHtml(track.id)}" class="grid h-8 w-8 place-items-center rounded-md text-xs text-zinc-500 opacity-0 transition hover:bg-sky-200/10 hover:text-sky-100 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" aria-label="Tra thông tin" title="Thông tin">ⓘ</button>` +
        `<button type="button" data-queue-action="play_next" data-track-id="${escapeHtml(track.id)}" class="grid h-8 w-8 place-items-center rounded-md text-xs text-zinc-500 opacity-0 transition hover:bg-violet-400/20 hover:text-violet-200 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" aria-label="Phát tiếp theo" title="Phát tiếp theo">⏭</button>` +
        `<button type="button" data-queue-action="append" data-track-id="${escapeHtml(track.id)}" class="grid h-8 w-8 place-items-center rounded-md text-xs text-zinc-500 opacity-0 transition hover:bg-violet-400/20 hover:text-violet-200 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" aria-label="Thêm vào cuối" title="Thêm vào cuối">➕</button>` +
        (queued ? `<span data-queue-indicator="true" class="w-4 text-center text-xs text-violet-300" title="Đã có trong Phát tiếp theo">☷</span>` : `<button type="button" data-queue-action="add" data-track-id="${escapeHtml(track.id)}" class="w-4 text-center text-xs text-zinc-600 opacity-0 hover:text-violet-200 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" title="Phát tiếp theo">＋</button>`) +
      `</span>` +
    `</div>`;
  }

  /**
   * VirtualTrackList class.
   * Manages virtual scrolling state, scroll listening, RAF throttling, and DOM updates.
   */
  class VirtualTrackList {
    constructor(container, options = {}) {
      this.container = container;
      this.options = Object.assign({
        rowHeight: 64,
        bufferCount: 5,
        scrollContainer: null,
        renderRow: null,
        onRowClick: null,
        onRowContextMenu: null,
        onRowKeyDown: null,
        currentId: null,
        queueTrackIds: []
      }, options);

      this.tracks = [];
      this.currentWindow = null;
      this.rafPending = false;
      this._scrollTarget = null;
      this._scrollListenerAttached = false;
      this._boundOnScroll = this.onScroll.bind(this);

      this.init();
    }

    init() {
      if (!this.container) return;
      this.attachScrollListener();
      this.attachDelegatedEvents();
    }

    setTracks(tracks, options = {}) {
      this.tracks = Array.isArray(tracks) ? tracks : [];
      if (options && typeof options === 'object') {
        Object.assign(this.options, options);
      }
      this.render(true);
    }

    getScrollTarget() {
      if (this.options.scrollContainer) return this.options.scrollContainer;
      if (this._scrollTarget) return this._scrollTarget;

      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const isMobileOrDap = window.innerWidth <= 768 || Boolean(window.isNativeAndroid || window.NocturneNative);
        const contentCol = document.getElementById('content-col');
        if (contentCol && !isMobileOrDap) {
          const style = window.getComputedStyle ? window.getComputedStyle(contentCol) : null;
          const overflowY = style ? style.overflowY : '';
          if (overflowY === 'auto' || overflowY === 'scroll') {
            this._scrollTarget = contentCol;
            return contentCol;
          }
        }
        this._scrollTarget = window;
        return window;
      }
      if (typeof document !== 'undefined') {
        const contentCol = document.getElementById('content-col');
        if (contentCol) {
          this._scrollTarget = contentCol;
          return contentCol;
        }
      }
      if (typeof window !== 'undefined') {
        this._scrollTarget = window;
        return window;
      }
      return this.container;
    }

    getScrollState() {
      if (this.options.scrollTop !== undefined && this.options.containerHeight !== undefined) {
        return {
          scrollTop: Math.max(0, parseFloat(this.options.scrollTop) || 0),
          containerHeight: Math.max(0, parseFloat(this.options.containerHeight) || 600)
        };
      }

      const target = this.getScrollTarget();
      let scrollTop = 0;
      let containerHeight = 600;

      if (target === (typeof window !== 'undefined' ? window : null) || target === (typeof root !== 'undefined' ? root : null)) {
        scrollTop = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0) : 0;
        containerHeight = typeof window !== 'undefined' ? (window.innerHeight || 600) : 600;
        if (this.container && this.container.getBoundingClientRect) {
          const rect = this.container.getBoundingClientRect();
          const offsetTop = rect.top + scrollTop;
          scrollTop = Math.max(0, scrollTop - offsetTop);
        }
      } else if (target && target.scrollTop !== undefined) {
        scrollTop = target.scrollTop;
        containerHeight = target.clientHeight || target.offsetHeight || 600;
        if (this.container && target !== this.container && this.container.offsetTop !== undefined) {
          scrollTop = Math.max(0, scrollTop - (this.container.offsetTop || 0));
        }
      } else if (this.container && this.container.scrollTop !== undefined) {
        scrollTop = this.container.scrollTop;
        containerHeight = this.container.clientHeight || 600;
      }

      if (this.options.scrollTop !== undefined) {
        scrollTop = Math.max(0, parseFloat(this.options.scrollTop) || 0);
      }
      if (this.options.containerHeight !== undefined) {
        containerHeight = Math.max(0, parseFloat(this.options.containerHeight) || 600);
      }

      return { scrollTop, containerHeight };
    }

    calculateWindow() {
      const { scrollTop, containerHeight } = this.getScrollState();
      return calculateVirtualWindow(
        this.tracks.length,
        scrollTop,
        containerHeight,
        this.options.rowHeight,
        this.options.bufferCount
      );
    }

    onScroll(event) {
      if (event && event.immediate) {
        this.render();
        return;
      }
      if (this.rafPending) return;
      this.rafPending = true;

      const raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : (cb => setTimeout(cb, 16));

      raf(() => {
        this.rafPending = false;
        this.render();
      });
    }

    attachScrollListener() {
      if (this._scrollListenerAttached) return;
      const target = this.getScrollTarget();
      if (target && target.addEventListener) {
        target.addEventListener('scroll', this._boundOnScroll, { passive: true });
        this._scrollListenerAttached = true;
      }
      if (typeof window !== 'undefined' && target !== window && window.addEventListener) {
        window.addEventListener('scroll', this._boundOnScroll, { passive: true });
      }
    }

    detachScrollListener() {
      const target = this.getScrollTarget();
      if (target && target.removeEventListener) {
        target.removeEventListener('scroll', this._boundOnScroll);
      }
      if (typeof window !== 'undefined' && target !== window && window.removeEventListener) {
        window.removeEventListener('scroll', this._boundOnScroll);
      }
      this._scrollListenerAttached = false;
    }

    attachDelegatedEvents() {
      const container = this.container;
      if (!container || container._vtlDelegatedAttached || !container.addEventListener) return;
      container._vtlDelegatedAttached = true;

      container.addEventListener('click', event => {
        // Rating click
        const ratingBtn = event.target && event.target.closest ? event.target.closest('[data-rating-track-id]') : null;
        if (ratingBtn) {
          if (event.stopPropagation) event.stopPropagation();
          const trackId = ratingBtn.dataset ? ratingBtn.dataset.ratingTrackId : ratingBtn.getAttribute('data-rating-track-id');
          if (typeof this.options.onRatingClick === 'function') {
            this.options.onRatingClick(trackId, event);
          } else if (typeof trackById === 'function') {
            const t = trackById(trackId);
            if (t) {
              const current = (typeof getTrackRating === 'function') ? getTrackRating(t) : (t.rating || 0);
              const next = (current % 5) + 1;
              if (typeof setTrackRating === 'function') setTrackRating(t, next);
            }
          }
          return;
        }

        // Metadata click
        const metaBtn = event.target && event.target.closest ? event.target.closest('[data-metadata-action="open"]') : null;
        if (metaBtn) {
          if (event.stopPropagation) event.stopPropagation();
          const trackId = metaBtn.dataset ? metaBtn.dataset.metadataTrackId : metaBtn.getAttribute('data-metadata-track-id');
          if (typeof this.options.onMetadataClick === 'function') {
            this.options.onMetadataClick(trackId, event);
          } else if (typeof metadataUI !== 'undefined' && metadataUI && typeof metadataUI.open === 'function') {
            const t = (typeof trackById === 'function') ? trackById(trackId) : null;
            metadataUI.open(t);
          }
          return;
        }

        // Queue action click
        const queueBtn = event.target && event.target.closest ? event.target.closest('[data-queue-action]') : null;
        if (queueBtn) {
          if (event.stopPropagation) event.stopPropagation();
          const action = queueBtn.dataset ? queueBtn.dataset.queueAction : queueBtn.getAttribute('data-queue-action');
          const trackId = queueBtn.dataset ? queueBtn.dataset.trackId : queueBtn.getAttribute('data-track-id');
          if (typeof this.options.onQueueAction === 'function') {
            this.options.onQueueAction(action, trackId, event);
          } else {
            if (action === 'play_next' && typeof handlePlayNext === 'function') handlePlayNext(trackId);
            else if (action === 'append' && typeof handleAppendQueue === 'function') handleAppendQueue(trackId);
            else if (action === 'remove' && typeof removeFromQueue === 'function') removeFromQueue(trackId);
            else if (typeof addToQueue === 'function') addToQueue(trackId);
          }
          return;
        }

        // Album link click
        const albumLink = event.target && event.target.closest ? event.target.closest('.album-link') : null;
        if (albumLink) {
          if (event.stopPropagation) event.stopPropagation();
          const row = albumLink.closest('[data-track-id]');
          const trackId = row?.dataset?.trackId || row?.getAttribute?.('data-track-id');
          if (typeof this.options.onAlbumClick === 'function') {
            this.options.onAlbumClick(trackId, event);
          } else {
            const track = (typeof trackById === 'function') ? trackById(trackId) : (typeof state !== 'undefined' && state.tracks ? state.tracks.find(t => t.id === trackId) : null);
            if (track) {
              const meta = (typeof library !== 'undefined' && library && typeof library.trackMetadata === 'function') ? library.trackMetadata(track) : track;
              if (typeof openAlbum === 'function') openAlbum(meta.album, meta.artist);
            }
          }
          return;
        }

        // Artist link click
        const artistLink = event.target && event.target.closest ? event.target.closest('.artist-link') : null;
        if (artistLink) {
          if (event.stopPropagation) event.stopPropagation();
          const row = artistLink.closest('[data-track-id]');
          const trackId = row?.dataset?.trackId || row?.getAttribute?.('data-track-id');
          if (typeof this.options.onArtistClick === 'function') {
            this.options.onArtistClick(trackId, event);
          } else {
            const track = (typeof trackById === 'function') ? trackById(trackId) : (typeof state !== 'undefined' && state.tracks ? state.tracks.find(t => t.id === trackId) : null);
            if (track) {
              const meta = (typeof library !== 'undefined' && library && typeof library.trackMetadata === 'function') ? library.trackMetadata(track) : track;
              if (typeof openArtist === 'function') openArtist(meta.artist);
            }
          }
          return;
        }

        // Version toggle
        const versionBtn = event.target && event.target.closest ? event.target.closest('[data-version-action="toggle"]') : null;
        if (versionBtn) {
          if (event.stopPropagation) event.stopPropagation();
          const key = versionBtn.dataset ? versionBtn.dataset.versionKey : versionBtn.getAttribute('data-version-key');
          if (typeof this.options.onVersionToggle === 'function') {
            this.options.onVersionToggle(key, event);
          } else if (key && typeof state !== 'undefined') {
            if (!(state.expandedVersions instanceof Set)) state.expandedVersions = new Set();
            if (state.expandedVersions.has(key)) state.expandedVersions.delete(key); else state.expandedVersions.add(key);
            if (typeof renderTracks === 'function') renderTracks();
          }
          return;
        }

        // Track row activation
        const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null;
        if (row && (!container.contains || container.contains(row))) {
          const trackId = row.dataset ? row.dataset.trackId : row.getAttribute('data-track-id');
          if (event.ctrlKey || event.metaKey) {
            if (typeof addToQueue === 'function') addToQueue(trackId);
            return;
          }
          if (typeof this.options.onRowClick === 'function') {
            this.options.onRowClick(trackId, event, row);
          } else if (typeof handleTrackRowActivation === 'function') {
            handleTrackRowActivation(trackId);
          }
        }
      });

      // Context menu
      container.addEventListener('contextmenu', event => {
        const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null;
        if (row && (!container.contains || container.contains(row))) {
          if (event.preventDefault) event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          const trackId = row.dataset ? row.dataset.trackId : row.getAttribute('data-track-id');
          if (typeof this.options.onRowContextMenu === 'function') {
            this.options.onRowContextMenu(trackId, event, row);
          } else if (typeof showTrackContextMenu === 'function') {
            showTrackContextMenu(event.clientX, event.clientY, trackId);
          }
        }
      });

      // Keyboard navigation
      container.addEventListener('keydown', event => {
        const row = event.target && event.target.closest ? event.target.closest('[data-track-id]') : null;
        if (row && (!container.contains || container.contains(row))) {
          if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
          if (event.preventDefault) event.preventDefault();
          const trackId = row.dataset ? row.dataset.trackId : row.getAttribute('data-track-id');
          if (typeof this.options.onRowKeyDown === 'function') {
            this.options.onRowKeyDown(trackId, event, row);
          } else if (typeof this.options.onRowClick === 'function') {
            this.options.onRowClick(trackId, event, row);
          } else if (typeof handleTrackRowActivation === 'function') {
            handleTrackRowActivation(trackId);
          }
        }
      });
    }

    render(force = false) {
      if (!this.container) return;

      const win = this.calculateWindow();

      // Skip DOM rebuild if window indices haven't changed (unless forced)
      if (!force && this.currentWindow &&
          this.currentWindow.startIndex === win.startIndex &&
          this.currentWindow.endIndex === win.endIndex) {
        return;
      }

      this.currentWindow = win;

      if (this.tracks.length === 0) {
        this.container.innerHTML = '';
        return;
      }

      const topSpacerHtml = `<div id="virtual-top-spacer" class="virtual-spacer virtual-top-spacer" style="height:${win.topSpacerHeight}px;width:100%;pointer-events:none;" aria-hidden="true" data-spacer-height="${win.topSpacerHeight}"></div>`;
      const bottomSpacerHtml = `<div id="virtual-bottom-spacer" class="virtual-spacer virtual-bottom-spacer" style="height:${win.bottomSpacerHeight}px;width:100%;pointer-events:none;" aria-hidden="true" data-spacer-height="${win.bottomSpacerHeight}"></div>`;

      const visibleTracks = this.tracks.slice(win.startIndex, win.endIndex);
      const renderRowFn = (typeof this.options.renderRow === 'function')
        ? this.options.renderRow
        : ((track, idx) => defaultRenderRow(track, idx, this.options));

      const rowsHtml = visibleTracks.map((track, i) => {
        return renderRowFn(track, win.startIndex + i, this.tracks);
      }).join('');

      this.container.innerHTML = topSpacerHtml + rowsHtml + bottomSpacerHtml;

      this.updateIndicators();
    }

    updateIndicators(currentTrackId) {
      if (currentTrackId !== undefined) {
        this.options.currentId = currentTrackId;
      }
      const activeId = this.options.currentId || (typeof state !== 'undefined' ? state.currentId : null);
      if (!this.container || !this.container.querySelectorAll) return;

      const rows = this.container.querySelectorAll('[data-track-id]');
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowId = row.dataset ? row.dataset.trackId : row.getAttribute('data-track-id');
        const isCurrent = Boolean(activeId && rowId === activeId);

        if (row.classList) {
          if (isCurrent) row.classList.add('active');
          else row.classList.remove('active');
        }

        const title = row.querySelector ? row.querySelector('.track-title') : null;
        if (title && title.classList) {
          if (isCurrent) {
            title.classList.add('text-violet-200');
            title.classList.remove('text-zinc-200');
          } else {
            title.classList.remove('text-violet-200');
            title.classList.add('text-zinc-200');
          }
        }

        const art = row.querySelector ? row.querySelector('.track-art') : null;
        if (art) {
          let overlay = art.querySelector ? art.querySelector('.track-playing-overlay') : null;
          if (isCurrent && !overlay && typeof document !== 'undefined' && document.createElement) {
            overlay = document.createElement('span');
            overlay.className = 'track-playing-overlay absolute inset-0 grid place-items-center bg-black/45 text-white';
            overlay.textContent = '♫';
            art.appendChild(overlay);
          } else if (!isCurrent && overlay && overlay.remove) {
            overlay.remove();
          }
        }
      }
    }

    scrollToIndex(index) {
      const idx = Math.max(0, Math.min(this.tracks.length - 1, parseInt(index, 10) || 0));
      const targetScroll = idx * this.options.rowHeight;
      const target = this.getScrollTarget();

      if (target === (typeof window !== 'undefined' ? window : null) || target === (typeof root !== 'undefined' ? root : null)) {
        if (typeof window !== 'undefined' && window.scrollTo) {
          window.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }
      } else if (target && target.scrollTop !== undefined) {
        target.scrollTop = targetScroll;
      } else if (this.container && this.container.scrollTop !== undefined) {
        this.container.scrollTop = targetScroll;
      }

      this.render();
    }

    getVisibleWindow() {
      return this.currentWindow || this.calculateWindow();
    }

    destroy() {
      this.detachScrollListener();
      if (this.container) {
        this.container._virtualTrackList = null;
        this.container._vtlDelegatedAttached = false;
      }
    }
  }

  /**
   * Main entrypoint to render virtualized track rows into a container.
   * Reuses or instantiates a VirtualTrackList attached to the container.
   * 
   * @param {HTMLElement} container - DOM container for the track rows.
   * @param {Array<Object>} tracks - Array of track items.
   * @param {Object} [options={}] - Custom options (rowHeight, bufferCount, renderRow, etc.)
   * @returns {VirtualTrackList|null}
   */
  function renderVirtualizedTrackRows(container, tracks, options = {}) {
    if (!container) return null;

    let instance = container._virtualTrackList;
    if (!instance || !(instance instanceof VirtualTrackList)) {
      instance = new VirtualTrackList(container, options);
      container._virtualTrackList = instance;
    } else if (options && typeof options === 'object') {
      Object.assign(instance.options, options);
    }

    instance.setTracks(tracks, options);
    return instance;
  }

  return {
    VirtualTrackList,
    calculateVirtualWindow,
    renderVirtualizedTrackRows
  };
});
