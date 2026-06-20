// Main app — routing and initialization
var App = {
  init: function() {
    Reader.init();

    document.getElementById('btn-pick-folder').addEventListener('click', App.pickFolder);
    document.getElementById('btn-pick-folder-2').addEventListener('click', App.pickFolder);
    document.getElementById('btn-change-folder').addEventListener('click', App.pickFolder);
    document.getElementById('btn-back').addEventListener('click', function() { Library.back(); });
    document.getElementById('btn-refresh').addEventListener('click', function() { Library.refresh(); });

    var uri = Storage.getFolderUri();
    if (uri) {
      App.showScreen('screen-library');
      Library.load();
    } else {
      App.showScreen('screen-setup');
    }
  },

  pickFolder: function() {
    Bridge.pickFolder()
      .then(function(res) {
        Storage.setFolderUri(res.uri);
        App.showScreen('screen-library');
        Library.load();
      })
      .catch(function(err) {
        console.error('Folder pick error:', err);
      });
  },

  showSetup: function() { App.showScreen('screen-setup'); },

  showScreen: function(id) {
    var screens = ['screen-setup', 'screen-library', 'screen-reader'];
    screens.forEach(function(s) {
      var el = document.getElementById(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
  }
};

document.addEventListener('DOMContentLoaded', App.init);

// Android hardware back button handler (called from MainActivity.onBackPressed)
window._handleNativeBack = function() {
  // Reader open → close reader
  if (!document.getElementById('screen-reader').classList.contains('hidden')) {
    Reader.close();
    return;
  }
  // Inside a subfolder → go up one level
  if (Library.navStack && Library.navStack.length > 0) {
    Library.back();
    return;
  }
  // At root → move app to background instead of exiting
  Bridge.minimizeApp();
};
