package com.comicshelf.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolderPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onBackPressed() {
        // Delegate back button to JS so the app can navigate internally
        getBridge().getWebView().evaluateJavascript(
            "window._handleNativeBack && window._handleNativeBack()", null);
    }
}
