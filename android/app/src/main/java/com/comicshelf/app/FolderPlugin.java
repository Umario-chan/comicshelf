package com.comicshelf.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.view.View;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.github.junrar.Archive;
import com.github.junrar.rarfile.FileHeader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "FolderPlugin")
public class FolderPlugin extends Plugin {

    // ── Pick a folder via SAF ────────────────────────────────────────────────
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handleFolderResult");
    }

    @ActivityCallback
    private void handleFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            getActivity().getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("displayName", uri.getLastPathSegment());
            call.resolve(ret);
        } else {
            call.reject("Selección cancelada");
        }
    }

    // ── List folder contents ─────────────────────────────────────────────────
    @PluginMethod
    public void listFolder(PluginCall call) {
        final String treeUriStr = call.getString("uri");
        final String docId      = call.getString("docId");
        if (treeUriStr == null) { call.reject("uri requerido"); return; }

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Uri treeUri = Uri.parse(treeUriStr);
                    Uri rootDocUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                            treeUri,
                            docId != null ? docId : DocumentsContract.getTreeDocumentId(treeUri));

                    String[] projection = {
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE
                    };

                    Cursor cursor = getContext().getContentResolver().query(
                            rootDocUri, projection, null, null, null);

                    JSArray dirs  = new JSArray();
                    JSArray files = new JSArray();

                    if (cursor != null) {
                        while (cursor.moveToNext()) {
                            String childId   = cursor.getString(0);
                            String name      = cursor.getString(1);
                            String mime      = cursor.getString(2);
                            boolean isDir    = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                            boolean isComic  = name != null &&
                                    (name.toLowerCase().endsWith(".cbz")
                                    || name.toLowerCase().endsWith(".cbr")
                                    || name.toLowerCase().endsWith(".pdf"));

                            if (isDir) {
                                JSObject d = new JSObject();
                                d.put("name", name);
                                d.put("docId", childId);
                                dirs.put(d);
                            } else if (isComic) {
                                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childId);
                                JSObject f = new JSObject();
                                f.put("name", name);
                                f.put("uri", docUri.toString());
                                files.put(f);
                            }
                        }
                        cursor.close();
                    }

                    JSObject ret = new JSObject();
                    ret.put("dirs",  dirs);
                    ret.put("files", files);
                    call.resolve(ret);
                } catch (Throwable e) {
                    call.reject("Error listando carpeta [" + e.getClass().getSimpleName() + "]: " + e.getMessage());
                }
            }
        }).start();
    }

    // ── Cover for CBZ / CBR / PDF (thumbnail only) ───────────────────────────
    @PluginMethod
    public void getCoverNative(PluginCall call) {
        final String uriStr = call.getString("uri");
        final String type   = call.getString("type", "cbr");
        if (uriStr == null) { call.reject("uri requerido"); return; }

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Uri uri = Uri.parse(uriStr);
                    String hash = Integer.toHexString(uri.toString().hashCode());

                    // Covers live in filesDir (persistent) — NOT cacheDir, which
                    // Android may wipe on background/low storage, losing all covers.
                    File coverFile = new File(coversDir(), hash + ".jpg");

                    if (!coverFile.exists()) {
                        if ("pdf".equals(type)) {
                            File rawPdf = new File(getContext().getCacheDir(), hash + ".pdf");
                            if (rawPdf.exists()) rawPdf.delete();
                            File tmp = cacheRaw(uri, hash + ".pdf");
                            ParcelFileDescriptor pfd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY);
                            PdfRenderer renderer = new PdfRenderer(pfd);
                            if (renderer.getPageCount() == 0) {
                                renderer.close(); pfd.close();
                                throw new Exception("El PDF no tiene páginas");
                            }
                            // Render at thumbnail size (240px wide) — much faster than full size
                            PdfRenderer.Page page = renderer.openPage(0);
                            int maxW = 240;
                            int w = Math.min(page.getWidth() * 2, maxW);
                            int h = (int)(w * ((float) page.getHeight() / page.getWidth()));
                            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                            bmp.eraseColor(Color.WHITE);
                            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                            page.close();
                            renderer.close();
                            pfd.close();
                            FileOutputStream fos = new FileOutputStream(coverFile);
                            try { bmp.compress(Bitmap.CompressFormat.JPEG, 75, fos); }
                            finally { fos.close(); bmp.recycle(); }

                        } else if ("cbz".equals(type)) {
                            // Stream directly from SAF — no full file copy needed for cover
                            InputStream rawIs = getContext().getContentResolver().openInputStream(uri);
                            if (rawIs == null) throw new Exception("No se pudo leer el archivo CBZ");
                            try {
                                extractFirstCbzImageAsThumb(rawIs, coverFile);
                            } finally {
                                try { rawIs.close(); } catch (Exception ignored) {}
                            }
                        } else {
                            // CBR — needs full file for junrar; delete stale cache first
                            File rawCbr = new File(getContext().getCacheDir(), hash + ".cbr");
                            if (rawCbr.exists()) rawCbr.delete();
                            File tmp = cacheRaw(uri, hash + ".cbr");
                            extractFirstCbrImageAsThumb(tmp, coverFile);
                        }
                    }

                    JSObject ret = new JSObject();
                    ret.put("path", coverFile.getAbsolutePath());
                    call.resolve(ret);
                } catch (Throwable e) {
                    call.reject("Error obteniendo portada [" + e.getClass().getSimpleName() + "]: " + e.getMessage());
                }
            }
        }).start();
    }

    // ── Extract all pages for reading ────────────────────────────────────────
    @PluginMethod
    public void extractPages(PluginCall call) {
        final String uriStr = call.getString("uri");
        final String type   = call.getString("type", "cbr");
        if (uriStr == null) { call.reject("uri requerido"); return; }

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Uri uri = Uri.parse(uriStr);
                    String hash = Integer.toHexString(uri.toString().hashCode());
                    File outDir = new File(getContext().getCacheDir(), "pages/" + hash);
                    JSArray pages = new JSArray();

                    if (!outDir.exists() || outDir.list() == null || outDir.list().length == 0) {
                        outDir.mkdirs();
                        // Delete stale raw cache to avoid corrupt files from previous crashed runs
                        String rawExt = "pdf".equals(type) ? ".pdf" : "cbz".equals(type) ? ".cbz" : ".cbr";
                        File rawFile = new File(getContext().getCacheDir(), hash + rawExt);
                        if (rawFile.exists()) rawFile.delete();

                        if ("pdf".equals(type)) {
                            File tmp = cacheRaw(uri, hash + ".pdf");
                            extractPdfPages(tmp, outDir, pages);
                        } else if ("cbz".equals(type)) {
                            // Stream directly from SAF — no full file copy needed (biggest speedup)
                            InputStream rawIs = getContext().getContentResolver().openInputStream(uri);
                            if (rawIs == null) throw new Exception("No se pudo abrir el archivo CBZ");
                            try {
                                extractCbzPagesFromStream(rawIs, outDir, pages);
                            } finally {
                                try { rawIs.close(); } catch (Exception ignored) {}
                            }
                        } else {
                            // CBR needs full file for junrar
                            File tmp = cacheRaw(uri, hash + ".cbr");
                            extractCbrPages(tmp, outDir, pages);
                        }
                    } else {
                        File[] files = outDir.listFiles();
                        if (files != null) {
                            Arrays.sort(files);
                            for (File f : files) pages.put(f.getAbsolutePath());
                        }
                    }

                    JSObject ret = new JSObject();
                    ret.put("pages", pages);
                    call.resolve(ret);
                } catch (Throwable e) {
                    call.reject("Error extrayendo páginas [" + e.getClass().getSimpleName() + "]: " + e.getMessage());
                }
            }
        }).start();
    }

    // ── Full-screen / immersive mode ─────────────────────────────────────────
    @PluginMethod
    public void setFullscreen(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                android.view.Window win = getActivity().getWindow();
                View decorView = win.getDecorView();
                if (enabled) {
                    win.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
                    decorView.setSystemUiVisibility(
                            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
                } else {
                    win.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
                    decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                }
            }
        });
        call.resolve();
    }

    // ── Minimize app (move to background) ────────────────────────────────────
    @PluginMethod
    public void minimizeApp(PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                getActivity().moveTaskToBack(true);
            }
        });
        call.resolve();
    }

    // ── Screen orientation ────────────────────────────────────────────────────
    @PluginMethod
    public void setOrientation(PluginCall call) {
        final String orientation = call.getString("orientation", "auto");
        final int req;
        if ("landscape".equals(orientation)) {
            req = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if ("portrait".equals(orientation)) {
            req = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        } else {
            req = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                getActivity().setRequestedOrientation(req);
            }
        });
        call.resolve();
    }

    // ── Clear all cached covers (force regeneration from the UI) ─────────────
    @PluginMethod
    public void clearCovers(PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    File[] files = coversDir().listFiles();
                    if (files != null) {
                        for (File f : files) f.delete();
                    }
                    call.resolve();
                } catch (Throwable e) {
                    call.reject("Error limpiando portadas: " + e.getMessage());
                }
            }
        }).start();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    // Persistent covers directory (filesDir, not cacheDir) so the system never
    // wipes saved covers between sessions.
    private File coversDir() {
        File dir = new File(getContext().getFilesDir(), "covers");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File cacheRaw(Uri uri, String filename) throws Exception {
        File raw = new File(getContext().getCacheDir(), filename);
        if (!raw.exists()) {
            File tmp = new File(getContext().getCacheDir(), filename + ".tmp");
            if (tmp.exists()) tmp.delete();
            InputStream is = getContext().getContentResolver().openInputStream(uri);
            if (is == null) throw new Exception("No se pudo leer el archivo");
            FileOutputStream fos = null;
            try {
                fos = new FileOutputStream(tmp);
                byte[] buf = new byte[65536]; int n;
                while ((n = is.read(buf)) != -1) fos.write(buf, 0, n);
            } finally {
                if (fos != null) try { fos.close(); } catch (Exception ignored) {}
                try { is.close(); } catch (Exception ignored) {}
            }
            if (!tmp.renameTo(raw)) {
                tmp.delete();
                throw new Exception("No se pudo guardar el archivo en caché");
            }
        }
        return raw;
    }

    // Save a bitmap as a JPEG thumbnail (max 240px wide, 75% quality)
    private void saveThumbnail(File srcFile, File outFile) throws Exception {
        int maxW = 240;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(srcFile.getAbsolutePath(), opts);
        int sampleSize = 1;
        while (opts.outWidth / (sampleSize * 2) >= maxW) sampleSize *= 2;
        opts.inJustDecodeBounds = false;
        opts.inSampleSize = sampleSize;
        Bitmap bmp = BitmapFactory.decodeFile(srcFile.getAbsolutePath(), opts);
        if (bmp == null) throw new Exception("No se pudo decodificar la imagen");
        if (bmp.getWidth() > maxW) {
            int newH = (int)(bmp.getHeight() * (float) maxW / bmp.getWidth());
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, maxW, newH, true);
            bmp.recycle();
            bmp = scaled;
        }
        FileOutputStream fos = new FileOutputStream(outFile);
        try { bmp.compress(Bitmap.CompressFormat.JPEG, 75, fos); }
        finally { fos.close(); bmp.recycle(); }
    }

    private void renderPdfPage(PdfRenderer.Page page, File outFile) throws Exception {
        int w = Math.min(page.getWidth() * 2, 2048);
        int h = (int)(w * ((float) page.getHeight() / page.getWidth()));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        bmp.eraseColor(Color.WHITE);
        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
        page.close();
        FileOutputStream out = new FileOutputStream(outFile);
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
        out.close();
        bmp.recycle();
    }

    private void extractPdfPages(File pdfFile, File outDir, JSArray pages) throws Exception {
        ParcelFileDescriptor pfd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY);
        PdfRenderer renderer = new PdfRenderer(pfd);
        int count = renderer.getPageCount();
        for (int i = 0; i < count; i++) {
            File imgFile = new File(outDir, String.format("%04d.jpg", i));
            renderPdfPage(renderer.openPage(i), imgFile);
            pages.put(imgFile.getAbsolutePath());
        }
        renderer.close();
        pfd.close();
    }

    // CBZ cover: stream from SAF, decode first image as thumbnail
    private void extractFirstCbzImageAsThumb(InputStream rawStream, File outFile) throws Exception {
        ZipInputStream zis = new ZipInputStream(rawStream);
        try {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (!entry.isDirectory() && isImageFile(entry.getName().toLowerCase())) {
                    // Write raw bytes to temp file for BitmapFactory to sample-decode efficiently
                    File tmp = new File(outFile.getParent(), outFile.getName() + ".rawtmp");
                    FileOutputStream fos = new FileOutputStream(tmp);
                    try {
                        byte[] buf = new byte[65536]; int n;
                        while ((n = zis.read(buf)) != -1) fos.write(buf, 0, n);
                    } finally { fos.close(); }
                    try {
                        saveThumbnail(tmp, outFile);
                    } finally { tmp.delete(); }
                    return;
                }
                zis.closeEntry();
            }
            throw new Exception("No se encontraron imágenes en el CBZ");
        } finally {
            zis.close();
        }
    }

    // CBZ pages: stream directly from SAF, no full file copy needed
    private void extractCbzPagesFromStream(InputStream rawStream, File outDir, JSArray pages) throws Exception {
        ZipInputStream zis = new ZipInputStream(rawStream);
        // Collect (entry_name, temp_file) pairs in stream order
        List<String[]> collected = new ArrayList<>();
        int count = 0;
        try {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (!entry.isDirectory() && isImageFile(entry.getName().toLowerCase())) {
                    File tmp = new File(outDir, String.format("%05d.tmp", count++));
                    FileOutputStream fos = new FileOutputStream(tmp);
                    byte[] buf = new byte[65536]; int n;
                    while ((n = zis.read(buf)) != -1) fos.write(buf, 0, n);
                    fos.close();
                    collected.add(new String[]{entry.getName(), tmp.getAbsolutePath()});
                }
                zis.closeEntry();
            }
        } finally {
            zis.close();
        }
        if (collected.isEmpty()) throw new Exception("No se encontraron imágenes en el CBZ");
        // Sort by original entry name for correct comic page order
        Collections.sort(collected, new Comparator<String[]>() {
            @Override
            public int compare(String[] a, String[] b) {
                return a[0].compareToIgnoreCase(b[0]);
            }
        });
        // Rename to final sorted names
        for (int i = 0; i < collected.size(); i++) {
            String[] pair = collected.get(i);
            String origName = pair[0].toLowerCase();
            String ext = origName.endsWith(".png") ? ".png"
                       : origName.endsWith(".webp") ? ".webp"
                       : ".jpg";
            File tmpFile = new File(pair[1]);
            File finalFile = new File(outDir, String.format("%04d" + ext, i));
            tmpFile.renameTo(finalFile);
            pages.put(finalFile.getAbsolutePath());
        }
    }

    // CBR cover: extract first image to temp file, then thumbnail
    private void extractFirstCbrImageAsThumb(File rarFile, File outFile) throws Exception {
        Archive archive = new Archive(rarFile);
        try {
            List<FileHeader> headers = archive.getFileHeaders();
            Collections.sort(headers, new Comparator<FileHeader>() {
                @Override
                public int compare(FileHeader a, FileHeader b) {
                    String na = a.getFileName(); String nb = b.getFileName();
                    if (na == null) return 1; if (nb == null) return -1;
                    return na.compareToIgnoreCase(nb);
                }
            });
            for (FileHeader fh : headers) {
                if (fh.isDirectory()) continue;
                String name = fh.getFileName();
                if (name == null || !isImageFile(name.toLowerCase())) continue;
                File tmp = new File(outFile.getParent(), outFile.getName() + ".rawtmp");
                FileOutputStream fos = new FileOutputStream(tmp);
                archive.extractFile(fh, fos);
                fos.close();
                try {
                    saveThumbnail(tmp, outFile);
                } finally { tmp.delete(); }
                return;
            }
            throw new Exception("No se encontraron imágenes en el CBR");
        } finally {
            archive.close();
        }
    }

    private void extractCbrPages(File rarFile, File outDir, JSArray pages) throws Exception {
        Archive archive = new Archive(rarFile);
        try {
            List<FileHeader> headers = archive.getFileHeaders();
            Collections.sort(headers, new Comparator<FileHeader>() {
                @Override
                public int compare(FileHeader a, FileHeader b) {
                    String na = a.getFileName(); String nb = b.getFileName();
                    if (na == null) return 1; if (nb == null) return -1;
                    return na.compareToIgnoreCase(nb);
                }
            });
            int idx = 0;
            for (FileHeader fh : headers) {
                if (fh.isDirectory()) continue;
                String name = fh.getFileName();
                if (name == null || !isImageFile(name.toLowerCase())) continue;
                File imgFile = new File(outDir, String.format("%04d.jpg", idx++));
                FileOutputStream fos = new FileOutputStream(imgFile);
                archive.extractFile(fh, fos);
                fos.close();
                pages.put(imgFile.getAbsolutePath());
            }
            if (pages.length() == 0) throw new Exception("No se encontraron imágenes en el CBR");
        } finally {
            archive.close();
        }
    }

    private boolean isImageFile(String name) {
        return name.endsWith(".jpg") || name.endsWith(".jpeg") ||
               name.endsWith(".png") || name.endsWith(".webp") || name.endsWith(".gif");
    }
}
