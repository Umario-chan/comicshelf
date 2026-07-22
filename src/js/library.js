// Library — folder-tree navigation + bookshelf rendering
var Library = {
  comics: [],
  rootUri: null,
  currentDocId: null,
  navStack: [], // [{name, docId}]

  // In-memory cover cache: uri → url (null = failed, undefined = not loaded yet)
  _coverCache: {},

  _resizeTimer: null,

  // Entry point — resets to root of stored folder
  load: function() {
    var uri = Storage.getFolderUri();
    if (!uri) { App.showSetup(); return; }
    Library._migrateCoverCache();
    Library.rootUri = uri;
    Library.currentDocId = null;
    Library.navStack = [];
    // Re-render on orientation change / window resize (tablet, rotation)
    window.addEventListener('resize', function() {
      clearTimeout(Library._resizeTimer);
      Library._resizeTimer = setTimeout(function() {
        if (Library.comics.length || document.getElementById('bookshelf').children.length) {
          Library.refresh();
        }
      }, 200);
    });
    Library._openFolder(null, 'ComicShelf');
  },

  // Refresh current folder
  refresh: function() {
    var title = document.getElementById('hdr-title').textContent;
    Library._openFolder(Library.currentDocId, title);
  },

  // Navigate into a subfolder
  enter: function(name, docId) {
    Library.navStack.push({
      name: document.getElementById('hdr-title').textContent,
      docId: Library.currentDocId
    });
    Library.currentDocId = docId;
    Library._openFolder(docId, name);
  },

  // Go back to parent folder
  back: function() {
    if (!Library.navStack.length) return;
    var parent = Library.navStack.pop();
    Library.currentDocId = parent.docId;
    Library._openFolder(parent.docId, parent.name);
  },

  _openFolder: function(docId, title) {
    var isRoot = Library.navStack.length === 0;
    document.getElementById('btn-change-folder').classList.toggle('hidden', !isRoot);
    document.getElementById('btn-back').classList.toggle('hidden', isRoot);
    document.getElementById('hdr-title').textContent = title || 'ComicShelf';

    document.getElementById('bookshelf').innerHTML =
      '<div class="loading-folders"><div class="spinner-small"></div></div>';
    document.getElementById('library-empty').classList.add('hidden');

    Bridge.listFolder(Library.rootUri, docId)
      .then(function(res) {
        var dirs = (res.dirs || []).sort(function(a, b) {
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
        Library.comics = (res.files || []).sort(function(a, b) {
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });

        if (!dirs.length && !Library.comics.length) {
          document.getElementById('bookshelf').innerHTML = '';
          document.getElementById('library-empty').classList.remove('hidden');
          document.querySelector('.empty-text').textContent =
            'No se encontraron archivos CBZ, CBR o PDF en esta carpeta';
          return;
        }

        Library._render(dirs, Library.comics);
        if (Library.comics.length) Library._loadCoversSequentially();
      })
      .catch(function(err) {
        var msg = (err && (err.message || err.errorMessage || String(err))) || 'Error desconocido';
        document.getElementById('bookshelf').innerHTML = '';
        document.getElementById('library-empty').classList.remove('hidden');
        document.querySelector('.empty-text').textContent = 'Error: ' + msg;
      });
  },

  // How many books per shelf row based on screen width
  _perRow: function() {
    var w = window.innerWidth;
    if (w >= 1024) return 8;
    if (w >= 840)  return 7;
    if (w >= 700)  return 6;
    if (w >= 560)  return 5;
    if (w >= 420)  return 4;
    return 3;
  },

  _render: function(dirs, files) {
    var shelf = document.getElementById('bookshelf');
    shelf.innerHTML = '';

    // ── Folder grid ──────────────────────────────────────────────────────────
    if (dirs.length) {
      var grid = document.createElement('div');
      grid.className = 'folders-grid';
      dirs.forEach(function(dir) {
        var card = document.createElement('div');
        card.className = 'folder-card';
        card.innerHTML =
          '<div class="folder-card-icon"></div>' +
          '<div class="folder-card-name">' + Library._esc(dir.name) + '</div>';
        card.addEventListener('click', function() {
          Library.enter(dir.name, dir.docId);
        });
        grid.appendChild(card);
      });
      shelf.appendChild(grid);
    }

    // ── Bookshelf for files ──────────────────────────────────────────────────
    if (files.length) {
      var perRow = Library._perRow();
      for (var i = 0; i < files.length; i += perRow) {
        shelf.appendChild(Library._buildShelfRow(files.slice(i, i + perRow), i, perRow));
      }
    }
  },

  _buildShelfRow: function(rowComics, startIndex, perRow) {
    var wrap = document.createElement('div');
    wrap.className = 'shelf-row-wrap';

    var booksRow = document.createElement('div');
    booksRow.className = 'books-row';

    rowComics.forEach(function(comic, j) {
      var progress = Storage.getProgress(comic.uri);
      var pct = progress.totalPages > 1
        ? Math.round(progress.currentPage / (progress.totalPages - 1) * 100)
        : 0;
      var done = progress.completed;

      var bookWrap = document.createElement('div');
      bookWrap.className = 'book-wrap';
      bookWrap.dataset.uri = comic.uri;

      bookWrap.innerHTML =
        '<div class="book" data-uri="' + Library._esc(comic.uri) + '">' +
          '<div class="book-cover">' +
            '<div class="book-cover-placeholder book-loading">' +
              '<div class="spinner-small"></div>' +
            '</div>' +
            '<div class="book-gloss"></div>' +
            (done ? '<div class="book-done-badge">✓</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="book-info">' +
          '<div class="book-label">' + Library._displayName(comic.name) + '</div>' +
          '<div class="book-progress">' +
            '<div class="book-progress-fill' + (done ? ' done' : '') +
              '" style="width:' + (done ? 100 : pct) + '%"></div>' +
          '</div>' +
        '</div>';

      booksRow.appendChild(bookWrap);

      Library._attachBookHandlers(bookWrap.querySelector('.book'), comic);
    });

    // Filler books for incomplete rows
    var fillCount = (perRow || 3) - rowComics.length;
    for (var k = 0; k < fillCount; k++) {
      var filler = document.createElement('div');
      filler.className = 'book-wrap';
      filler.style.visibility = 'hidden';
      booksRow.appendChild(filler);
    }

    var plank = document.createElement('div');
    plank.className = 'shelf-plank';

    wrap.appendChild(booksRow);
    wrap.appendChild(plank);
    return wrap;
  },

  // Generation counter — incremented on every folder open to cancel stale cover chains
  _coverGen: 0,

  _loadCoversSequentially: function() {
    var comics = Library.comics.slice();
    var idx = 0;
    var gen = ++Library._coverGen;
    function next() {
      if (gen !== Library._coverGen) return;
      if (idx >= comics.length) return;
      var comic = comics[idx++];

      // 1) In-memory cache (allow self-heal if the cached file vanished)
      if (Library._coverCache.hasOwnProperty(comic.uri)) {
        var cached = Library._coverCache[comic.uri];
        try { cached ? Library._setCover(comic.uri, cached, true) : Library._setCoverError(comic.uri); } catch(e) {}
        next();
        return;
      }

      // 2) localStorage cache (allow self-heal if the cached file vanished)
      var stored = null;
      try { stored = localStorage.getItem('cover:' + comic.uri); } catch(e) {}
      if (stored) {
        Library._coverCache[comic.uri] = stored;
        try { Library._setCover(comic.uri, stored, true); } catch(e) {}
        next();
        return;
      }

      // 3) Extract from native, then cache
      Library._fetchCover(comic).then(function() { next(); });
    }
    next();
  },

  // Extract a cover from native, persist it to both cache layers, and display.
  // A freshly extracted cover does not self-heal on display error (false) to
  // avoid an endless re-extract loop when an image genuinely cannot render.
  _fetchCover: function(comic, force) {
    return CBZ.getCover(comic, force).then(
      function(dataUrl) {
        Library._coverCache[comic.uri] = dataUrl;
        try { localStorage.setItem('cover:' + comic.uri, dataUrl); } catch(e) {}
        try { Library._setCover(comic.uri, dataUrl, false); } catch(e) {}
      },
      function() {
        Library._coverCache[comic.uri] = null;
        try { Library._setCoverError(comic.uri); } catch(e) {}
      }
    );
  },

  // Finds a book element without using CSS.escape (not available on all Android 6 WebViews)
  _findBook: function(uri) {
    var books = document.querySelectorAll('.book');
    for (var i = 0; i < books.length; i++) {
      if (books[i].dataset.uri === uri) return books[i];
    }
    return null;
  },

  // Reset a book's cover back to the loading spinner (before re-extraction)
  _showCoverLoading: function(uri) {
    var bookEl = Library._findBook(uri);
    if (!bookEl) return;
    var coverEl = bookEl.querySelector('.book-cover');
    if (!coverEl) return;
    var img = coverEl.querySelector('img');
    if (img) img.remove();
    var ph = coverEl.querySelector('.book-cover-placeholder');
    if (!ph) {
      ph = document.createElement('div');
      coverEl.insertBefore(ph, coverEl.firstChild);
    }
    ph.className = 'book-cover-placeholder book-loading';
    ph.innerHTML = '<div class="spinner-small"></div>';
  },

  // allowRefetch: if the cached image fails to load (file was wiped), drop the
  // stale cache entry and re-extract once from native to self-heal.
  _setCover: function(uri, dataUrl, allowRefetch) {
    var bookEl = Library._findBook(uri);
    if (!bookEl) return;
    var coverEl = bookEl.querySelector('.book-cover');
    var img = document.createElement('img');
    img.src = dataUrl;
    img.draggable = false;
    img.onerror = function() {
      this.remove();
      if (allowRefetch) {
        delete Library._coverCache[uri];
        try { localStorage.removeItem('cover:' + uri); } catch(e) {}
        var comic = Library.comics.find(function(c) { return c.uri === uri; });
        if (comic) { Library._showCoverLoading(uri); Library._fetchCover(comic); return; }
      }
      Library._setCoverError(uri);
    };
    var placeholder = coverEl.querySelector('.book-cover-placeholder');
    if (placeholder) placeholder.remove();
    coverEl.insertBefore(img, coverEl.firstChild);
  },

  _setCoverError: function(uri) {
    var bookEl = Library._findBook(uri);
    if (!bookEl) return;
    var coverEl = bookEl.querySelector('.book-cover');
    if (!coverEl) return;
    // Remove any broken img first
    var img = coverEl.querySelector('img');
    if (img) img.remove();
    // Ensure placeholder exists and shows error icon
    var ph = coverEl.querySelector('.book-cover-placeholder');
    if (!ph) {
      ph = document.createElement('div');
      ph.className = 'book-cover-placeholder';
      coverEl.insertBefore(ph, coverEl.firstChild);
    }
    ph.className = 'book-cover-placeholder';
    ph.innerHTML = '📖';
  },

  _displayName: function(filename) {
    return filename.replace(/\.(cbz|cbr|pdf)$/i, '').replace(/[_-]/g, ' ').trim();
  },

  _esc: function(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  // One-time migration: older builds saved covers in the volatile cache dir,
  // so any cached URLs now point at files the system may have wiped. Drop them
  // once so they get re-extracted into the new persistent location.
  _migrateCoverCache: function() {
    try {
      if (localStorage.getItem('coverCacheVersion') === '2') return;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('cover:') === 0) keys.push(k);
      }
      keys.forEach(function(k) { localStorage.removeItem(k); });
      localStorage.setItem('coverCacheVersion', '2');
    } catch(e) {}
  },

  // Force a full re-extraction of every cover in the current folder.
  reloadCovers: function() {
    if (!Library.comics.length) return;
    // Drop every cache layer and show spinners for the visible comics
    Library.comics.forEach(function(c) {
      delete Library._coverCache[c.uri];
      try { localStorage.removeItem('cover:' + c.uri); } catch(e) {}
      Library._showCoverLoading(c.uri);
    });
    // Wipe the native cover files, then regenerate (regenerate regardless of result)
    Bridge.clearCovers().then(
      function() { Library._loadCoversSequentially(); },
      function() { Library._loadCoversSequentially(); }
    );
  },

  // ── Book tap + long-press handling ─────────────────────────────────────────
  _attachBookHandlers: function(bookEl, comic) {
    var pressTimer = null;
    var longPressed = false;
    var startX = 0, startY = 0;

    function cancelPress() { clearTimeout(pressTimer); }

    bookEl.addEventListener('touchstart', function(e) {
      longPressed = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      cancelPress();
      pressTimer = setTimeout(function() {
        longPressed = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch(e) {} }
        Library.showContextMenu(comic);
      }, 480);
    }, { passive: true });

    bookEl.addEventListener('touchmove', function(e) {
      if (Math.abs(e.touches[0].clientX - startX) > 10 ||
          Math.abs(e.touches[0].clientY - startY) > 10) cancelPress();
    }, { passive: true });

    bookEl.addEventListener('touchend', cancelPress, { passive: true });
    bookEl.addEventListener('touchcancel', cancelPress, { passive: true });

    bookEl.addEventListener('click', function() {
      if (longPressed) { longPressed = false; return; } // long-press already handled
      Reader.open(comic);
    });
  },

  // ── Context menu ────────────────────────────────────────────────────────────
  _ctxComic: null,

  showContextMenu: function(comic) {
    Library._ctxComic = comic;
    var menu = document.getElementById('ctx-menu');
    document.getElementById('ctx-title').textContent = Library._displayName(comic.name);

    var prog = Storage.getProgress(comic.uri);
    var hasProgress = prog.completed || (prog.currentPage > 0);
    menu.querySelector('[data-action="read"]').classList.toggle('hidden', !!prog.completed);
    menu.querySelector('[data-action="unread"]').classList.toggle('hidden', !hasProgress);

    // Reset the delete confirm state every time the menu opens
    var del = menu.querySelector('[data-action="delete"]');
    del.dataset.confirm = '';
    del.textContent = '🗑️ Eliminar archivo';

    menu.classList.remove('hidden');
  },

  hideContextMenu: function() {
    document.getElementById('ctx-menu').classList.add('hidden');
    Library._ctxComic = null;
  },

  // Wire menu buttons once (called from App.init)
  initContextMenu: function() {
    var menu = document.getElementById('ctx-menu');
    if (!menu) return;
    // Tap outside the sheet closes the menu
    menu.addEventListener('click', function(e) {
      if (e.target === menu) Library.hideContextMenu();
    });
    menu.querySelectorAll('.ctx-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        Library._handleCtxAction(btn.dataset.action, btn);
      });
    });
  },

  _handleCtxAction: function(action, btn) {
    var comic = Library._ctxComic;
    if (!comic && action !== 'cancel') { Library.hideContextMenu(); return; }

    switch (action) {
      case 'open':
        Library.hideContextMenu();
        Reader.open(comic);
        break;
      case 'read':
        Storage.markCompleted(comic.uri);
        Library.refreshProgress(comic.uri);
        Library.hideContextMenu();
        break;
      case 'unread':
        Storage.resetProgress(comic.uri);
        Library.refreshProgress(comic.uri);
        Library.hideContextMenu();
        break;
      case 'reload-cover':
        Library.hideContextMenu();
        delete Library._coverCache[comic.uri];
        try { localStorage.removeItem('cover:' + comic.uri); } catch(e) {}
        Library._showCoverLoading(comic.uri);
        Library._fetchCover(comic, true); // force = regenerate
        break;
      case 'delete':
        // Two-tap confirm to avoid accidental deletion
        if (btn && btn.dataset.confirm === '1') {
          Library._doDelete(comic);
        } else if (btn) {
          btn.dataset.confirm = '1';
          btn.textContent = '⚠️ Toca otra vez para eliminar';
        }
        break;
      case 'cancel':
      default:
        Library.hideContextMenu();
        break;
    }
  },

  _doDelete: function(comic) {
    Library.hideContextMenu();
    Bridge.deleteFile(comic.uri).then(
      function() {
        delete Library._coverCache[comic.uri];
        try { localStorage.removeItem('cover:' + comic.uri); } catch(e) {}
        Storage.resetProgress(comic.uri);
        if (window.showToast) window.showToast('Archivo eliminado');
        Library.refresh(); // re-list folder (deleted file is gone)
      },
      function(err) {
        var msg = (err && (err.message || err.errorMessage)) || '';
        if (window.showToast) {
          window.showToast(/permiso|permission|denied|rechaz/i.test(msg)
            ? 'Sin permiso para borrar — reselecciona la carpeta con 📁'
            : 'No se pudo eliminar el archivo');
        }
      }
    );
  },

  refreshProgress: function(uri) {
    var progress = Storage.getProgress(uri);
    var pct = progress.totalPages > 1
      ? Math.round(progress.currentPage / (progress.totalPages - 1) * 100)
      : 0;
    var done = progress.completed;

    var bookEl = Library._findBook(uri);
    if (!bookEl) return;
    var wrap = bookEl.closest('.book-wrap');
    if (!wrap) return;

    var fill = wrap.querySelector('.book-progress-fill');
    if (fill) {
      fill.style.width = (done ? 100 : pct) + '%';
      if (done) fill.classList.add('done'); else fill.classList.remove('done');
    }

    var badge = bookEl.querySelector('.book-done-badge');
    if (done && !badge) {
      var b = document.createElement('div');
      b.className = 'book-done-badge'; b.textContent = '✓';
      bookEl.querySelector('.book-cover').appendChild(b);
    } else if (!done && badge) {
      badge.remove();
    }
  }
};
