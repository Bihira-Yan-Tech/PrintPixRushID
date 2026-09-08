package com.printpixrushid.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.RectF;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.print.pdf.PrintedPdfDocument;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import org.json.JSONObject;

/**
 * Minimal native shell: one Activity hosting a WebView that loads the
 * same index.html/css/js/vendor/assets already used by the browser and
 * Electron versions of this app, from assets/www/ (bundled into the
 * APK), via file:///android_asset/. No Capacitor bridge, no AndroidX —
 * the app doesn't call any native APIs (it's plain DOM/canvas/
 * localStorage code), so a plain WebView is functionally equivalent to
 * what Capacitor would provide here, and is far simpler to hand-build
 * without Gradle.
 *
 * onShowFileChooser is required for any <input type="file"> in the
 * page (photo upload, custom attire upload, job .json import) to do
 * anything at all — a bare `new WebChromeClient()` (what this had
 * originally) silently no-ops file input clicks; there is no default
 * fallback, this has to be implemented explicitly.
 *
 * Three real-device bugs (round 3) traced back to gaps a plain WebView
 * has that a full browser doesn't, fixed below:
 *  1. "Remove background" failing outright — WebView blocks fetch/import
 *     from a file:// page to any remote https:// origin by default
 *     (allowUniversalAccessFromFileURLs defaults to false for apps
 *     targeting API 16+), so the CDN model download never even starts.
 *  2. "Download PDF" / "Save Job" silently doing nothing — both go
 *     through an <a download> + blob: URL click, which a bare WebView
 *     has no DownloadListener for (no download manager UI exists here
 *     the way it does in a real browser), so the click is a no-op.
 *  3. The Print Preview modal's "Print" button doing nothing —
 *     window.print() is simply not implemented by android.webkit.WebView
 *     at all; there is no default fallback.
 * (1) is fixed by a WebSettings flag. (2) and (3) need real native code,
 * since there is no browser API that can substitute for a system
 * download/print facility inside a bare WebView — added below as a
 * small JS-to-Java bridge (`window.AndroidBridge`), which the web app's
 * own JS (printExport.js / saveRecopy.js, mobile copies only) detects
 * and routes through instead of the browser-only APIs when present.
 *
 * Round 3.1: saveFileAs originally wrote silently to the Downloads
 * folder (MediaStore) with no user choice at all — real-device feedback
 * pointed out this doesn't satisfy "let me pick where it saves", the
 * actual original ask. Replaced with Android's Storage Access Framework
 * (ACTION_CREATE_DOCUMENT), which opens the real system "Save as" picker
 * (any folder, any storage provider) — the mobile equivalent of
 * Electron's dialog.showSaveDialog or the browser's showSaveFilePicker.
 * This also needs no storage permission at all on any supported API
 * level, so it replaces the old MediaStore/legacy-File branching
 * entirely rather than sitting alongside it. See CLAUDE.md's "Mobile
 * app (Android)" section for the full writeup.
 *
 * `callProvider` (added for the AI Formal-Attire Assistant / Multi-
 * Provider Model Settings feature — see modelProviders.js) is the same
 * "browser fetch() is subject to CORS/WebView restrictions, a native
 * HTTP client isn't" pattern as Electron's own `ai-provider-call` IPC
 * handler (desktop/electron/main.js), just via java.net.HttpURLConnection
 * instead of Node's http/https modules. Runs on its own background
 * Thread (not the WebView's own JS-bridge thread, and never the UI
 * thread) since a generation call can take several seconds — blocking
 * either of those would freeze the page/app. Result comes back via
 * window.__androidProviderCallback(id, ok, status, bodyOrError), mirrored
 * from modelProviders.js's own androidCallProvider() — see that file's
 * comment for the exact contract.
 */
public class MainActivity extends Activity {

    private WebView webView;

    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST_CODE = 51426;

    private static final int SAVE_FILE_REQUEST_CODE = 51427;
    private String pendingSaveRequestId;
    private byte[] pendingSaveBytes;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.WHITE);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);       // localStorage (Save Job list)
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // Required for "Remove background"/custom-attire cutout to reach
        // its CDN model at all — without this, every fetch()/dynamic
        // import() from this file:// page to any https:// origin is
        // silently blocked before it even leaves the device. See the
        // class doc above (bug #1).
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowFileAccessFromFileURLs(true);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                              FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null); // cancel any pending chooser first
                }
                filePathCallback = callback;

                Intent intent = params.createIntent();
                // The page's own accept="" attribute (image/png, application/json, etc.)
                // already narrows params.createIntent()'s type/extras — just launch it.
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else if (requestCode == SAVE_FILE_REQUEST_CODE) {
            String requestId = pendingSaveRequestId;
            byte[] bytes = pendingSaveBytes;
            pendingSaveRequestId = null;
            pendingSaveBytes = null;
            if (requestId == null) return;

            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                notifyJs(requestId, "cancelled");
                return;
            }
            Uri uri = data.getData();
            try {
                // Lets a later "Save" on the same job (still within this
                // app process) write back to the same chosen file without
                // showing the picker again — see writeToUri() below.
                getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
                // Not every provider supports persistable grants; the
                // in-process write right below still works regardless.
            }
            try {
                writeBytesToUri(uri, bytes);
                notifyJs(requestId, "ok:" + uri.toString());
            } catch (Exception e) {
                notifyJs(requestId, "error:" + e.getMessage());
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        // Let the in-page app handle back navigation if it ever wants to;
        // otherwise fall back to default (closes the app) since this is
        // a single-page app with no browser-style history stack to pop.
        super.onBackPressed();
    }

    private void writeBytesToUri(Uri uri, byte[] bytes) throws IOException {
        OutputStream out = getContentResolver().openOutputStream(uri, "wt");
        if (out == null) throw new IOException("Could not open the chosen file for writing");
        try {
            out.write(bytes);
        } finally {
            out.close();
        }
    }

    /** Calls back into the JS bridge's pending-promise map (see printExport.js/saveRecopy.js). */
    private void notifyJs(final String requestId, final String result) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String js = "window.__androidSaveFileCallback && window.__androidSaveFileCallback("
                    + JSONObject.quote(requestId) + "," + JSONObject.quote(result) + ")";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    /** Calls back into modelProviders.js's androidCallProvider() pending-promise map. */
    private void notifyProviderJs(final String requestId, final boolean ok, final int status, final String bodyOrError) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String js = "window.__androidProviderCallback && window.__androidProviderCallback("
                    + JSONObject.quote(requestId) + "," + ok + "," + status + ","
                    + JSONObject.quote(bodyOrError) + ")";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    /** Reads an InputStream to completion. Returns an empty array for a null stream (e.g. a response with no body). */
    private static byte[] readAllBytes(InputStream is) throws IOException {
        if (is == null) return new byte[0];
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int len;
        while ((len = is.read(chunk)) != -1) {
            buffer.write(chunk, 0, len);
        }
        is.close();
        return buffer.toByteArray();
    }

    /** Renders `bitmap` as the sole page of a PDF sized to `widthIn`x`heightIn`, then hands it to Android's PrintManager. */
    private void doPrint(final Bitmap bitmap, final double widthIn, final double heightIn) {
        PrintManager printManager = (PrintManager) getSystemService(PRINT_SERVICE);
        if (printManager == null || bitmap == null) return;

        int wMils = (int) Math.round(widthIn * 1000);
        int hMils = (int) Math.round(heightIn * 1000);
        final PrintAttributes attrs = new PrintAttributes.Builder()
            .setMediaSize(new PrintAttributes.MediaSize("printpix_sheet", "PrintPix Sheet", wMils, hMils))
            .setResolution(new PrintAttributes.Resolution("printpix_res", "PrintPix", 300, 300))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .build();

        PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
            @Override
            public void onLayout(PrintAttributes oldAttrs, PrintAttributes newAttrs,
                                  CancellationSignal cancellationSignal,
                                  LayoutResultCallback callback, Bundle extras) {
                if (cancellationSignal.isCanceled()) {
                    callback.onLayoutCancelled();
                    return;
                }
                PrintDocumentInfo info = new PrintDocumentInfo.Builder("PrintPixRushID.pdf")
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(1)
                    .build();
                callback.onLayoutFinished(info, true);
            }

            @Override
            public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                 CancellationSignal cancellationSignal, WriteResultCallback callback) {
                PrintedPdfDocument doc = new PrintedPdfDocument(MainActivity.this, attrs);
                try {
                    PdfDocument.Page page = doc.startPage(0);
                    Canvas canvas = page.getCanvas();
                    RectF rect = new RectF(0, 0, canvas.getWidth(), canvas.getHeight());
                    canvas.drawBitmap(bitmap, null, rect, null);
                    doc.finishPage(page);
                    doc.writeTo(new FileOutputStream(destination.getFileDescriptor()));
                    callback.onWriteFinished(new PageRange[]{ PageRange.ALL_PAGES });
                } catch (IOException e) {
                    callback.onWriteFailed(e.toString());
                } finally {
                    doc.close();
                }
            }
        };
        printManager.print("PrintPixRushID Sheet", adapter, attrs);
    }

    /**
     * JS-to-Java bridge exposed as `window.AndroidBridge` — substitutes
     * for the two browser facilities a bare WebView doesn't have (real
     * file saving with a real location picker, and real printing).
     * Methods here run on a WebView background thread, not the UI
     * thread (standard for addJavascriptInterface); everything that
     * touches the Activity/window (starting the picker, PrintManager,
     * evaluateJavascript) is posted to the UI thread via runOnUiThread.
     *
     * saveFileAs/writeToUri are fire-and-forget from JS's side (return
     * void) because showing a picker is inherently asynchronous — JS
     * gets the result later via window.__androidSaveFileCallback(id,
     * result), matched up to the original call through requestId. This
     * replaced an earlier synchronous-return design (MediaStore write,
     * no picker) that real-device testing showed didn't satisfy the
     * actual ask: a real "choose where to save" dialog.
     */
    private class AndroidBridge {
        @JavascriptInterface
        public void saveFileAs(final String requestId, final String base64Data,
                                final String filename, final String mimeType) {
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64Data, Base64.DEFAULT);
            } catch (Exception e) {
                notifyJs(requestId, "error:" + e.getMessage());
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingSaveRequestId = requestId;
                    pendingSaveBytes = bytes;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mimeType);
                    intent.putExtra(Intent.EXTRA_TITLE, filename);
                    try {
                        startActivityForResult(intent, SAVE_FILE_REQUEST_CODE);
                    } catch (Exception e) {
                        pendingSaveRequestId = null;
                        pendingSaveBytes = null;
                        notifyJs(requestId, "error:" + e.getMessage());
                    }
                }
            });
        }

        /** Silent re-save to a Uri string returned by an earlier saveFileAs — no picker. */
        @JavascriptInterface
        public void writeToUri(final String requestId, final String uriString, final String base64Data) {
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64Data, Base64.DEFAULT);
            } catch (Exception e) {
                notifyJs(requestId, "error:" + e.getMessage());
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        writeBytesToUri(Uri.parse(uriString), bytes);
                        notifyJs(requestId, "ok:" + uriString);
                    } catch (Exception e) {
                        notifyJs(requestId, "error:" + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void printImage(final String base64Png, final double widthIn, final double heightIn) {
            final byte[] bytes = Base64.decode(base64Png, Base64.DEFAULT);
            final Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            // Plain anonymous Runnable, not a lambda: javac fails to
            // compile lambda syntax against android.jar as a bootclasspath
            // (a stub jar with no real LambdaMetafactory to resolve the
            // invokedynamic call site against) — see build script's error
            // if this is ever "simplified" back to a lambda.
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    doPrint(bitmap, widthIn, heightIn);
                }
            });
        }

        /**
         * Makes a real HTTP(S) request to an AI provider's API and returns
         * the result via notifyProviderJs() — see the class doc comment
         * above and modelProviders.js's androidCallProvider() for the
         * full contract. Runs on its own Thread (not the addJavascriptInterface
         * call's own background thread, and never the UI thread) since a
         * generation request can take several seconds.
         */
        @JavascriptInterface
        public void callProvider(final String requestId, final String method, final String urlStr,
                                  final String headersJson, final String body) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection conn = null;
                    try {
                        URL url = new URL(urlStr);
                        conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod((method == null || method.length() == 0) ? "GET" : method);
                        conn.setConnectTimeout(60000);
                        conn.setReadTimeout(60000);
                        conn.setInstanceFollowRedirects(true);

                        try {
                            JSONObject headers = new JSONObject(headersJson == null || headersJson.length() == 0 ? "{}" : headersJson);
                            Iterator<String> keys = headers.keys();
                            while (keys.hasNext()) {
                                String key = keys.next();
                                conn.setRequestProperty(key, headers.getString(key));
                            }
                        } catch (Exception ignored) {
                            // Malformed/empty headers JSON — proceed without them
                            // rather than fail the whole request over it.
                        }

                        if (body != null && body.length() > 0) {
                            conn.setDoOutput(true);
                            byte[] bodyBytes = body.getBytes("UTF-8");
                            OutputStream os = conn.getOutputStream();
                            try {
                                os.write(bodyBytes);
                            } finally {
                                os.close();
                            }
                        }

                        int status = conn.getResponseCode();
                        InputStream is = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
                        byte[] responseBytes = readAllBytes(is);
                        // Mirrors Electron's ai-provider-call handler: an
                        // image/* response is base64-encoded (some providers
                        // return raw image bytes instead of JSON+base64), a
                        // provider marked as JS's own callHttp() already
                        // knows how to detect base64-vs-JSON either way.
                        String contentType = conn.getContentType();
                        String responseBody = (contentType != null && contentType.startsWith("image/"))
                            ? Base64.encodeToString(responseBytes, Base64.NO_WRAP)
                            : new String(responseBytes, "UTF-8");
                        notifyProviderJs(requestId, true, status, responseBody);
                    } catch (Exception e) {
                        notifyProviderJs(requestId, false, 0, String.valueOf(e.getMessage()));
                    } finally {
                        if (conn != null) conn.disconnect();
                    }
                }
            }).start();
        }
    }
}
