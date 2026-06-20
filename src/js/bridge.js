// Bridge to native FolderPlugin (Java)
var Bridge = {
  _plugin: function() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FolderPlugin;
  },

  // Open Android folder picker → returns { uri, displayName }
  pickFolder: function() {
    var p = this._plugin();
    if (!p) return Promise.reject(new Error('FolderPlugin not available'));
    return p.pickFolder();
  },

  // List immediate children → { dirs: [{name,docId}], files: [{name,uri}] }
  listFolder: function(treeUri, docId) {
    var p = this._plugin();
    if (!p) return Promise.reject(new Error('FolderPlugin not available'));
    var params = { uri: treeUri };
    if (docId != null) params.docId = docId;
    return p.listFolder(params);
  },

  // Copy CBZ to app cache and return local path → { path }
  cacheFile: function(uri) {
    var p = this._plugin();
    if (!p) return Promise.reject(new Error('FolderPlugin not available'));
    return p.cacheFile({ uri: uri });
  },

  // Get cover image for CBR/PDF (first page only) → URL string
  getCoverNative: function(uri, type) {
    var p = this._plugin();
    if (!p) return Promise.reject(new Error('FolderPlugin not available'));
    return p.getCoverNative({ uri: uri, type: type })
      .then(function(res) {
        return Bridge.toUrl(res.path);
      });
  },

  // Extract all pages for CBR/PDF → array of URL strings
  extractPages: function(uri, type) {
    var p = this._plugin();
    if (!p) return Promise.reject(new Error('FolderPlugin not available'));
    return p.extractPages({ uri: uri, type: type })
      .then(function(res) {
        return (res.pages || []).map(function(path) {
          return Bridge.toUrl(path);
        });
      });
  },

  // Move app to background (Android back-at-root behavior)
  minimizeApp: function() {
    var p = this._plugin();
    if (!p || !p.minimizeApp) return Promise.resolve();
    return p.minimizeApp();
  },

  // Enter or exit Android immersive fullscreen
  setFullscreen: function(enabled) {
    var p = this._plugin();
    if (!p || !p.setFullscreen) return Promise.resolve();
    return p.setFullscreen({ enabled: !!enabled });
  },

  // Set screen orientation: 'portrait' | 'landscape' | 'auto'
  setOrientation: function(orientation) {
    var p = this._plugin();
    if (!p || !p.setOrientation) return Promise.resolve();
    return p.setOrientation({ orientation: orientation });
  },

  // Convert a native file path to a URL the WebView can fetch
  toUrl: function(path) {
    if (window.Capacitor && window.Capacitor.convertFileSrc) {
      return window.Capacitor.convertFileSrc(path);
    }
    return 'file://' + path;
  }
};
