// Persistent storage — wraps localStorage with JSON support
var Storage = {
  get: function(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; }
  },
  set: function(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
  },
  remove: function(key) {
    try { localStorage.removeItem(key); } catch(e) {}
  },

  // Progress: { currentPage, totalPages, completed }
  getProgress: function(uri) {
    return this.get('progress:' + uri) || { currentPage: 0, totalPages: 0, completed: false };
  },
  setProgress: function(uri, currentPage, totalPages) {
    this.set('progress:' + uri, {
      currentPage: currentPage,
      totalPages: totalPages,
      completed: currentPage >= totalPages - 1
    });
  },
  resetProgress: function(uri) {
    this.remove('progress:' + uri);
  },

  // Library
  getFolderUri: function() { return this.get('folderUri'); },
  setFolderUri: function(uri) { this.set('folderUri', uri); },

  // Settings
  getMangaMode: function() { return this.get('mangaMode') || false; }
};
