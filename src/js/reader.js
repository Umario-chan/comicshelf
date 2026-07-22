// Reader — touch-based horizontal page swipe
var Reader = {
  pages: [],
  currentPage: 0,
  manga: false,
  comic: null,
  _overlayTimer: null,
  _touchStartX: 0,
  _touchStartY: 0,
  _isDragging: false,
  _isHorizontal: null,
  _orientation: 'auto', // 'auto' | 'portrait' | 'landscape'

  // Zoom / pan state (applies to the current page only)
  _scale: 1,
  _panX: 0,
  _panY: 0,
  _panStartX: 0,
  _panStartY: 0,
  _pinchActive: false,
  _pinchStartDist: 0,
  _pinchStartScale: 1,
  _suppressClick: false,
  _lastTapTime: 0,
  _tapTimer: null,

  open: function(comic) {
    Reader.comic = comic;
    Reader.pages = [];
    Reader.currentPage = 0;
    Reader.manga = Storage.getMangaMode();
    Reader._orientation = 'auto';
    Reader._scale = 1; Reader._panX = 0; Reader._panY = 0;
    Reader._pinchActive = false; Reader._suppressClick = false;

    // Show reader screen and enter fullscreen
    App.showScreen('screen-reader');
    Bridge.setFullscreen(true);

    // Reset state
    document.getElementById('reader-pages').innerHTML = '';
    document.getElementById('reader-pages').style.transform = '';
    document.getElementById('reader-loading').style.display = 'flex';
    document.getElementById('reader-error').classList.add('hidden');
    document.getElementById('reader-overlay').classList.add('hidden');
    document.getElementById('reader-loading-msg').textContent = 'Extrayendo páginas…';
    document.getElementById('reader-comic-name').textContent =
      comic.name.replace(/\.(cbz|cbr|pdf)$/i, '');

    // Load saved progress
    var saved = Storage.getProgress(comic.uri);
    var startPage = saved.currentPage || 0;

    // Extract pages
    CBZ.extractPages(comic, function(done, total) {
      document.getElementById('reader-loading-msg').textContent =
        'Página ' + done + ' / ' + total;
    })
    .then(function(pages) {
      Reader.pages = pages;
      document.getElementById('reader-loading').style.display = 'none';
      Reader._buildPages();
      Reader._goTo(Math.min(startPage, pages.length - 1), false);
      Reader._showOverlay();
    })
    .catch(function(err) {
      document.getElementById('reader-loading').style.display = 'none';
      document.getElementById('reader-error').classList.remove('hidden');
      document.getElementById('reader-error-msg').textContent =
        (err && (err.message || err.errorMessage || JSON.stringify(err))) || 'No se pudo abrir el archivo';
    });
  },

  _buildPages: function() {
    var container = document.getElementById('reader-pages');
    container.innerHTML = '';
    var W = window.innerWidth;
    var H = window.innerHeight;

    container.style.width = (Reader.pages.length * W) + 'px';

    Reader.pages.forEach(function(dataUrl, i) {
      var page = document.createElement('div');
      page.className = 'reader-page';
      page.style.width = W + 'px';
      page.style.height = H + 'px';
      page.style.transform = Reader._baseTransform();

      var img = document.createElement('img');
      img.src = dataUrl;
      img.draggable = false;
      page.appendChild(img);
      container.appendChild(page);
    });

    // Update title
    document.getElementById('reader-title').textContent =
      Reader.comic.name.replace(/\.(cbz|cbr|pdf)$/i, '');
    document.getElementById('btn-toggle-dir').textContent = Reader.manga ? '漫' : 'W';
    document.getElementById('btn-toggle-dir').className = 'rdr-pill' + (Reader.manga ? ' manga-on' : '');
    Reader._updateCounter();
  },

  _goTo: function(page, animate) {
    var total = Reader.pages.length;
    // Reset any zoom on the page we're leaving before moving
    if (Reader._scale > 1) Reader._resetZoom(false);
    page = Math.max(0, Math.min(page, total - 1));
    Reader.currentPage = page;

    var container = document.getElementById('reader-pages');
    var W = window.innerWidth;
    var offset = Reader.manga ? (total - 1 - page) * W : page * W;

    if (animate === false) {
      container.classList.add('no-transition');
      container.style.transform = 'translateX(-' + offset + 'px)';
      // Force reflow
      container.offsetHeight;
      container.classList.remove('no-transition');
    } else {
      container.style.transform = 'translateX(-' + offset + 'px)';
    }

    Reader._updateCounter();
    Reader._updateScrubber();
    Storage.setProgress(Reader.comic.uri, page, total);
    Library.refreshProgress(Reader.comic.uri);
  },

  _updateScrubber: function() {
    var total = Reader.pages.length;
    if (!total) return;
    var display = Reader.manga ? (total - 1 - Reader.currentPage) : Reader.currentPage;
    var pct = total <= 1 ? 0 : display / (total - 1) * 100;
    var fill  = document.getElementById('reader-scrubber-fill');
    var thumb = document.getElementById('reader-scrubber-thumb');
    if (fill)  fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
  },

  _updateCounter: function() {
    var total = Reader.pages.length;
    var display = Reader.manga ? (total - Reader.currentPage) : (Reader.currentPage + 1);
    document.getElementById('btn-page-counter').textContent = display + ' / ' + total;
    document.getElementById('btn-prev').disabled = Reader.manga
      ? Reader.currentPage >= total - 1
      : Reader.currentPage === 0;
    document.getElementById('btn-next').disabled = Reader.manga
      ? Reader.currentPage === 0
      : Reader.currentPage >= total - 1;
  },

  _showOverlay: function() {
    clearTimeout(Reader._overlayTimer);
    document.getElementById('reader-overlay').classList.remove('hidden');
    Reader._overlayTimer = setTimeout(function() {
      document.getElementById('reader-overlay').classList.add('hidden');
    }, 3000);
  },

  _toggleOverlay: function() {
    var overlay = document.getElementById('reader-overlay');
    if (overlay.classList.contains('hidden')) {
      Reader._showOverlay();
    } else {
      clearTimeout(Reader._overlayTimer);
      overlay.classList.add('hidden');
    }
  },

  close: function() {
    Bridge.setFullscreen(false);
    Bridge.setOrientation('auto');
    Reader._orientation = 'auto';
    App.showScreen('screen-library');
  },

  // ── Zoom / pan ──────────────────────────────────────────────────────────────
  _baseTransform: function() {
    return Reader.manga ? 'scaleX(-1)' : '';
  },

  _currentPageEl: function() {
    var container = document.getElementById('reader-pages');
    return container ? container.children[Reader.currentPage] : null;
  },

  _dist: function(t1, t2) {
    var dx = t1.clientX - t2.clientX;
    var dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  // Keep the panned image within bounds (no empty gaps around it)
  _clampPan: function() {
    var page = Reader._currentPageEl();
    var img = page ? page.querySelector('img') : null;
    var W = window.innerWidth, H = window.innerHeight;
    var iw = img ? img.clientWidth : W;
    var ih = img ? img.clientHeight : H;
    var maxX = Math.max(0, (iw * Reader._scale - W) / 2);
    var maxY = Math.max(0, (ih * Reader._scale - H) / 2);
    Reader._panX = Math.max(-maxX, Math.min(maxX, Reader._panX));
    Reader._panY = Math.max(-maxY, Math.min(maxY, Reader._panY));
  },

  _applyZoom: function() {
    var page = Reader._currentPageEl();
    if (!page) return;
    page.style.transform =
      'translate(' + Reader._panX + 'px,' + Reader._panY + 'px) scale(' + Reader._scale + ')' +
      (Reader.manga ? ' scaleX(-1)' : '');
  },

  _resetZoom: function(animate) {
    Reader._scale = 1; Reader._panX = 0; Reader._panY = 0;
    var page = Reader._currentPageEl();
    if (!page) return;
    if (animate) page.classList.add('zoom-anim');
    page.style.transform = Reader._baseTransform();
    if (animate) {
      setTimeout(function() { if (page) page.classList.remove('zoom-anim'); }, 220);
    }
  },

  // Double-tap: toggle between 1× and ~2.5× centered on the tapped point
  _toggleZoomAt: function(clientX, clientY) {
    var page = Reader._currentPageEl();
    if (!page) return;
    if (Reader._scale > 1) {
      page.classList.add('zoom-anim');
      Reader._resetZoom(false);
      setTimeout(function() { if (page) page.classList.remove('zoom-anim'); }, 220);
      return;
    }
    Reader._scale = 2.5;
    var W = window.innerWidth, H = window.innerHeight;
    Reader._panX = (W / 2 - clientX) * (Reader._scale - 1);
    Reader._panY = (H / 2 - clientY) * (Reader._scale - 1);
    Reader._clampPan();
    page.classList.add('zoom-anim');
    Reader._applyZoom();
    setTimeout(function() { if (page) page.classList.remove('zoom-anim'); }, 220);
  },

  // ── Jump to the previous/next volume in the same folder ──────────────────────
  _goToAdjacentVolume: function(dir) {
    var comics = (typeof Library !== 'undefined' && Library.comics) || [];
    var idx = -1;
    for (var i = 0; i < comics.length; i++) {
      if (comics[i].uri === Reader.comic.uri) { idx = i; break; }
    }
    var nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= comics.length) {
      Reader._goTo(Reader.currentPage, true); // snap back
      if (window.showToast) window.showToast(dir > 0 ? 'Último tomo' : 'Primer tomo');
      return;
    }
    // Finishing forward → mark the current volume as read
    if (dir > 0) {
      Storage.markCompleted(Reader.comic.uri);
      if (typeof Library !== 'undefined') Library.refreshProgress(Reader.comic.uri);
    }
    Reader.open(comics[nextIdx]);
  },

  init: function() {
    var viewport = document.getElementById('reader-viewport');

    // Tap → toggle overlay (single tap) / zoom (double tap)
    viewport.addEventListener('click', function(e) {
      if (e.target.closest('.reader-overlay')) return;
      if (Reader._suppressClick) { Reader._suppressClick = false; return; }

      var now = (new Date()).getTime();
      if (now - Reader._lastTapTime < 300) {
        // Double tap → zoom toggle
        clearTimeout(Reader._tapTimer);
        Reader._lastTapTime = 0;
        Reader._toggleZoomAt(e.clientX, e.clientY);
      } else {
        // Single tap → toggle overlay (delayed so a second tap can cancel it)
        Reader._lastTapTime = now;
        clearTimeout(Reader._tapTimer);
        Reader._tapTimer = setTimeout(function() { Reader._toggleOverlay(); }, 280);
      }
    });

    viewport.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        // Begin pinch-zoom
        Reader._pinchActive = true;
        Reader._isDragging = false;
        Reader._isHorizontal = null;
        Reader._pinchStartDist = Reader._dist(e.touches[0], e.touches[1]);
        Reader._pinchStartScale = Reader._scale;
        return;
      }
      Reader._suppressClick = false;
      Reader._touchStartX = e.touches[0].clientX;
      Reader._touchStartY = e.touches[0].clientY;
      Reader._isDragging = false;
      Reader._isHorizontal = null;
      Reader._panStartX = Reader._panX;
      Reader._panStartY = Reader._panY;
    }, { passive: true });

    viewport.addEventListener('touchmove', function(e) {
      // Pinch-zoom (two fingers)
      if (Reader._pinchActive && e.touches.length === 2) {
        var d = Reader._dist(e.touches[0], e.touches[1]);
        var ratio = d / (Reader._pinchStartDist || d);
        Reader._scale = Math.max(1, Math.min(4, Reader._pinchStartScale * ratio));
        Reader._clampPan();
        Reader._applyZoom();
        return;
      }

      // Pan when zoomed in (one finger)
      if (Reader._scale > 1) {
        var pdx = e.touches[0].clientX - Reader._touchStartX;
        var pdy = e.touches[0].clientY - Reader._touchStartY;
        if (Math.abs(pdx) > 4 || Math.abs(pdy) > 4) Reader._isDragging = true;
        Reader._panX = Reader._panStartX + pdx;
        Reader._panY = Reader._panStartY + pdy;
        Reader._clampPan();
        Reader._applyZoom();
        return;
      }

      // Otherwise: drag-following page swipe
      var dx = e.touches[0].clientX - Reader._touchStartX;
      var dy = e.touches[0].clientY - Reader._touchStartY;

      if (Reader._isHorizontal === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        Reader._isHorizontal = Math.abs(dx) >= Math.abs(dy);
      }
      if (!Reader._isHorizontal) return;

      Reader._isDragging = true;
      var W = window.innerWidth;
      var total = Reader.pages.length;
      var base = Reader.manga ? (total - 1 - Reader.currentPage) * W : Reader.currentPage * W;

      // Resist at the ends: dampen drag past first/last page
      var atStart = Reader.manga ? Reader.currentPage >= total - 1 : Reader.currentPage === 0;
      var atEnd   = Reader.manga ? Reader.currentPage === 0 : Reader.currentPage >= total - 1;
      var resist  = (dx > 0 && atStart) || (dx < 0 && atEnd) ? 0.3 : 1;

      var container = document.getElementById('reader-pages');
      container.classList.add('no-transition');
      container.style.transform = 'translateX(' + (-(base - dx * resist)) + 'px)';
    }, { passive: true });

    function commitSwipe(endX) {
      if (!Reader._isDragging) return;
      Reader._isDragging = false;
      Reader._isHorizontal = null;
      Reader._suppressClick = true;

      var dx = endX - Reader._touchStartX;
      var W = window.innerWidth;
      var threshold = W * 0.15;
      var total = Reader.pages.length;

      var container = document.getElementById('reader-pages');
      container.classList.remove('no-transition');

      if (Math.abs(dx) >= threshold) {
        // Reading-order ends (account for manga RTL)
        var atReadingEnd   = Reader.manga ? Reader.currentPage === 0 : Reader.currentPage >= total - 1;
        var atReadingStart = Reader.manga ? Reader.currentPage >= total - 1 : Reader.currentPage === 0;

        if (dx < 0) {
          // Swipe in reading direction (advance)
          if (atReadingEnd) { Reader._goToAdjacentVolume(1); return; }
          Reader.manga
            ? Reader._goTo(Reader.currentPage - 1, true)
            : Reader._goTo(Reader.currentPage + 1, true);
        } else {
          // Swipe back
          if (atReadingStart) { Reader._goToAdjacentVolume(-1); return; }
          Reader.manga
            ? Reader._goTo(Reader.currentPage + 1, true)
            : Reader._goTo(Reader.currentPage - 1, true);
        }
      } else {
        Reader._goTo(Reader.currentPage, true); // snap back
      }
    }

    viewport.addEventListener('touchend', function(e) {
      // End of a pinch
      if (Reader._pinchActive) {
        if (e.touches.length < 2) {
          Reader._pinchActive = false;
          Reader._suppressClick = true;
          if (Reader._scale <= 1.02) Reader._resetZoom(true);
          // Hand off to a possible one-finger pan with the remaining touch
          if (e.touches.length === 1) {
            Reader._touchStartX = e.touches[0].clientX;
            Reader._touchStartY = e.touches[0].clientY;
            Reader._panStartX = Reader._panX;
            Reader._panStartY = Reader._panY;
          }
        }
        return;
      }
      // Panning while zoomed — just settle (no page change)
      if (Reader._scale > 1) {
        if (Reader._isDragging) Reader._suppressClick = true;
        Reader._isDragging = false;
        return;
      }
      commitSwipe(e.changedTouches[0].clientX);
    }, { passive: true });

    viewport.addEventListener('touchcancel', function() {
      Reader._pinchActive = false;
      if (Reader._scale > 1) { Reader._isDragging = false; return; }
      if (!Reader._isDragging) return;
      Reader._isDragging = false;
      Reader._isHorizontal = null;
      var container = document.getElementById('reader-pages');
      container.classList.remove('no-transition');
      Reader._goTo(Reader.currentPage, true);
    }, { passive: true });

    // Overlay buttons
    document.getElementById('btn-reader-back').addEventListener('click', Reader.close);
    document.getElementById('btn-reader-back-err').addEventListener('click', Reader.close);

    document.getElementById('btn-prev').addEventListener('click', function() {
      Reader.manga
        ? Reader._goTo(Reader.currentPage + 1, true)
        : Reader._goTo(Reader.currentPage - 1, true);
    });
    document.getElementById('btn-next').addEventListener('click', function() {
      Reader.manga
        ? Reader._goTo(Reader.currentPage - 1, true)
        : Reader._goTo(Reader.currentPage + 1, true);
    });

    document.getElementById('btn-toggle-dir').addEventListener('click', function() {
      Reader.manga = !Reader.manga;
      Storage.set('mangaMode', Reader.manga);
      if (Reader.pages.length) {
        var cur = Reader.currentPage;
        Reader._buildPages();
        Reader._goTo(cur, false);
        Reader._showOverlay();
      }
    });

    // Re-layout pages when screen rotates (fixes cropped/off-center display)
    Reader._resizeTimer = null;
    window.addEventListener('resize', function() {
      if (document.getElementById('screen-reader').classList.contains('hidden')) return;
      if (!Reader.pages.length) return;
      var pagesEl = document.getElementById('reader-pages');
      pagesEl.style.opacity = '0';
      clearTimeout(Reader._resizeTimer);
      Reader._resizeTimer = setTimeout(function() {
        var cur = Reader.currentPage;
        Reader._buildPages();
        Reader._goTo(cur, false);
        pagesEl.style.opacity = '1';
      }, 200);
    });

    // Screen orientation toggle: auto → landscape → portrait → auto
    document.getElementById('btn-toggle-orientation').addEventListener('click', function() {
      var next = Reader._orientation === 'auto' ? 'landscape'
               : Reader._orientation === 'landscape' ? 'portrait'
               : 'auto';
      Reader._orientation = next;
      Bridge.setOrientation(next);
      var labels = { auto: '↻', landscape: '↔', portrait: '↕' };
      this.textContent = labels[next];
    });

    // Progress scrubber — drag to jump pages
    var scrubber = document.getElementById('reader-scrubber');
    var scrubbing = false;

    function scrubTo(clientX) {
      var rect = scrubber.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      var total = Reader.pages.length;
      if (total <= 1) return;
      var logicalPage = Math.round(pct * (total - 1));
      var page = Reader.manga ? (total - 1 - logicalPage) : logicalPage;
      Reader._goTo(page, false);
    }

    scrubber.addEventListener('touchstart', function(e) {
      scrubbing = true;
      document.getElementById('reader-scrubber-thumb').classList.add('active');
      scrubTo(e.touches[0].clientX);
    }, { passive: true });

    scrubber.addEventListener('touchmove', function(e) {
      if (!scrubbing) return;
      scrubTo(e.touches[0].clientX);
    }, { passive: true });

    scrubber.addEventListener('touchend', function(e) {
      if (!scrubbing) return;
      scrubbing = false;
      document.getElementById('reader-scrubber-thumb').classList.remove('active');
      scrubTo(e.changedTouches[0].clientX);
      // Apply transition for the final snap
      var container = document.getElementById('reader-pages');
      container.classList.remove('no-transition');
    }, { passive: true });

    scrubber.addEventListener('touchcancel', function() {
      scrubbing = false;
      document.getElementById('reader-scrubber-thumb').classList.remove('active');
    }, { passive: true });
  }
};
