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

  open: function(comic) {
    Reader.comic = comic;
    Reader.pages = [];
    Reader.currentPage = 0;
    Reader.manga = Storage.getMangaMode();
    Reader._orientation = 'auto';

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
      if (Reader.manga) page.style.transform = 'scaleX(-1)';

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

  init: function() {
    var viewport = document.getElementById('reader-viewport');

    // Tap to toggle overlay
    viewport.addEventListener('click', function(e) {
      // Ignore taps on overlay buttons
      if (e.target.closest('.reader-overlay')) return;
      Reader._toggleOverlay();
    });

    // Drag-following touch swipe
    viewport.addEventListener('touchstart', function(e) {
      Reader._touchStartX = e.touches[0].clientX;
      Reader._touchStartY = e.touches[0].clientY;
      Reader._isDragging = false;
      Reader._isHorizontal = null;
    }, { passive: true });

    viewport.addEventListener('touchmove', function(e) {
      var dx = e.touches[0].clientX - Reader._touchStartX;
      var dy = e.touches[0].clientY - Reader._touchStartY;

      // Determine axis on first significant movement
      if (Reader._isHorizontal === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        Reader._isHorizontal = Math.abs(dx) >= Math.abs(dy);
      }
      if (!Reader._isHorizontal) return;

      Reader._isDragging = true;
      var W = window.innerWidth;
      var total = Reader.pages.length;
      var base = Reader.manga ? (total - 1 - Reader.currentPage) * W : Reader.currentPage * W;

      // Resist at the ends: halve drag past first/last page
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

      var dx = endX - Reader._touchStartX;
      var W = window.innerWidth;
      var threshold = W * 0.15;

      var container = document.getElementById('reader-pages');
      container.classList.remove('no-transition');

      if (Math.abs(dx) >= threshold) {
        if (dx < 0) {
          Reader.manga
            ? Reader._goTo(Reader.currentPage - 1, true)
            : Reader._goTo(Reader.currentPage + 1, true);
        } else {
          Reader.manga
            ? Reader._goTo(Reader.currentPage + 1, true)
            : Reader._goTo(Reader.currentPage - 1, true);
        }
      } else {
        // Snap back to current page
        Reader._goTo(Reader.currentPage, true);
      }
    }

    viewport.addEventListener('touchend', function(e) {
      commitSwipe(e.changedTouches[0].clientX);
    }, { passive: true });

    viewport.addEventListener('touchcancel', function() {
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
