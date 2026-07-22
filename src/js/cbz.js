// Comic parser — all formats extracted natively via Java (no JS heap pressure)
var CBZ = {
  _type: function(name) {
    var lower = (name || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.cbr')) return 'cbr';
    return 'cbz';
  },

  // Get cover image — accepts {uri, name} object or bare URI string.
  // force = regenerate the cover even if one is already cached.
  getCover: function(comic, force) {
    var uri  = typeof comic === 'string' ? comic : comic.uri;
    var type = typeof comic === 'string' ? 'cbz' : CBZ._type(comic.name);
    return Bridge.getCoverNative(uri, type, force);
  },

  // Extract all pages — accepts {uri, name} object or bare URI string
  extractPages: function(comic, onProgress) {
    var uri  = typeof comic === 'string' ? comic : comic.uri;
    var type = typeof comic === 'string' ? 'cbz' : CBZ._type(comic.name);
    return Bridge.extractPages(uri, type)
      .then(function(urls) {
        if (onProgress) onProgress(urls.length, urls.length);
        return urls;
      });
  }
};
