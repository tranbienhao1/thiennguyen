package com.nocturne.audiophile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.widget.ProgressBar;
import android.widget.Toast;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.X509Certificate;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Nocturne Audiophile MainActivity
 * High-performance Android host for the Nocturne Web Audio & Bit-Perfect Engine.
 * Features:
 * - FiiO M11S (Android 10 / API 29) & Audiophile DAP compatibility:
 *   * Runtime storage permission handling (READ_EXTERNAL_STORAGE for Android <= 12)
 *   * Legacy external storage access for direct SD card /sdcard/Music browsing
 *   * Robust multi-fallback file chooser bypassing non-existent DocumentsUI
 * - Full OAuth popup support (Google Identity Services GIS, Microsoft MSAL)
 * - Mixed Content ALWAYS_ALLOW & Full HTTP method CORS proxy for Subsonic/Jellyfin/Black Candy (GET, POST, PUT, DELETE, OPTIONS, HEAD)
 * - Clean User-Agent bypassing Google 403 disallowed_useragent
 * - Audio Focus & Partial WakeLock for continuous background audiophile streaming
 * - Edge-to-edge fullscreen with WindowInsets notch and gesture navigation handling
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "NocturneMainActivity";
    private static final String WAKELOCK_TAG = "Nocturne:AudiophilePlaybackWakeLock";
    private static final String DEFAULT_ASSET_URL = "https://appassets.androidplatform.net/assets/index.html";

    private static final String NOTIFICATION_CHANNEL_ID = "nocturne_playback";
    private static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_PLAY_PAUSE = "com.nocturne.audiophile.ACTION_PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.nocturne.audiophile.ACTION_NEXT";
    public static final String ACTION_PREV = "com.nocturne.audiophile.ACTION_PREVIOUS";

    private WebView mWebView;
    private ProgressBar mProgressBar;
    private PowerManager.WakeLock mWakeLock;
    private AudioManager mAudioManager;
    private AudioFocusRequest mAudioFocusRequest;
    private boolean mHasAudioFocus = false;
    private MediaSession mMediaSession;
    private boolean mIsMediaReceiverRegistered = false;

    private ValueCallback<Uri[]> mFilePathCallback;
    private ActivityResultLauncher<Intent> mFileChooserLauncher;
    private ActivityResultLauncher<String[]> mPermissionLauncher;
    private String mCleanUserAgent;
    private Dialog mActivePopupDialog;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Edge-to-edge fullscreen setup with notch & navigation bar insets
        setupEdgeToEdgeFullscreen();

        setContentView(R.layout.activity_main);

        mWebView = findViewById(R.id.web_view);
        mProgressBar = findViewById(R.id.loading_indicator);

        // 2. Initialize system services (PowerManager for WakeLock, AudioManager for Audio Focus, MediaSession & Notifications)
        initPowerAndAudioManagers();
        initMediaSession();
        registerMediaNotificationReceiver();
        createNotificationChannelIfNeeded();

        // 3. Register activity result launchers for file selection & permissions
        initActivityResultLaunchers();

        // 4. Configure high performance WebView settings
        configureHighPerformanceWebView();

        // 5. Setup back-button dispatcher
        setupBackNavigation();

        // 6. Handle notch & window insets
        setupWindowInsetsHandling();

        // 7. Request audio, storage & notification permissions
        requestAppPermissions();

        // 8. Load application entrypoint
        loadAppEntrypoint();
    }

    /**
     * Configure Edge-to-Edge display and immersive transparent bars
     */
    private void setupEdgeToEdgeFullscreen() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }
    }

    /**
     * Initialize PowerManager wake lock and AudioManager
     */
    private void initPowerAndAudioManagers() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            mWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG);
            mWakeLock.setReferenceCounted(false);
        }

        mAudioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    /**
     * Register File Chooser for audio import (FLAC, DSD, WAV, MP3, etc.) and runtime permissions
     */
    private void initActivityResultLaunchers() {
        mFileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (mFilePathCallback != null) {
                        Uri[] results = null;
                        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                            Intent data = result.getData();
                            if (data.getClipData() != null) {
                                int count = data.getClipData().getItemCount();
                                results = new Uri[count];
                                for (int i = 0; i < count; i++) {
                                    results[i] = data.getClipData().getItemAt(i).getUri();
                                }
                            } else if (data.getData() != null) {
                                results = new Uri[]{data.getData()};
                            }

                            // Try to persist read permission if supported by the provider
                            if (results != null) {
                                for (Uri u : results) {
                                    try {
                                        getContentResolver().takePersistableUriPermission(
                                                u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    } catch (SecurityException ignored) {
                                        // ACTION_GET_CONTENT URIs may not support persistable flags
                                    }
                                }
                            }
                        }
                        mFilePathCallback.onReceiveValue(results);
                        mFilePathCallback = null;
                    }
                }
        );

        mPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestMultiplePermissions(),
                result -> {
                    Log.d(TAG, "Runtime permissions response: " + result);
                }
        );
    }

    /**
     * Audiophile DAP Multi-Fallback File Chooser:
     * DAPs like FiiO M11S (Android 10), Astell&Kern, HiBy, Cayin often do NOT have standard DocumentsUI.
     * Hierarchy of fallbacks:
     * 1. Primary: Intent.ACTION_GET_CONTENT with Intent.createChooser(..., "Chọn nhạc")
     * 2. Fallback 1: Intent.ACTION_OPEN_DOCUMENT
     * 3. Fallback 2: FileChooserParams.createIntent()
     * 4. Fallback 3: Generic Intent.ACTION_GET_CONTENT with "*\/*"
     */
    public boolean launchDapMusicChooser(@Nullable WebChromeClient.FileChooserParams fileChooserParams) {
        String[] audioMimeTypes = new String[]{
                "audio/*",
                "application/ogg",
                "application/x-flac",
                "application/flac",
                "audio/flac",
                "audio/x-flac",
                "audio/dsd",
                "audio/x-dsd",
                "audio/wav",
                "audio/x-wav",
                "audio/x-aiff",
                "audio/aiff",
                "audio/aac",
                "audio/mp4",
                "audio/mpeg",
                "audio/mp3",
                "audio/x-m4a",
                "audio/alac",
                "application/octet-stream",
                "*/*"
        };

        // Primary: Intent.ACTION_GET_CONTENT with Intent.createChooser(..., "Chọn nhạc")
        try {
            Intent getContentIntent = new Intent(Intent.ACTION_GET_CONTENT);
            getContentIntent.addCategory(Intent.CATEGORY_OPENABLE);
            getContentIntent.setType("audio/*");
            getContentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            getContentIntent.putExtra(Intent.EXTRA_MIME_TYPES, audioMimeTypes);

            Intent chooserIntent = Intent.createChooser(getContentIntent, "Chọn nhạc");
            chooserIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            mFileChooserLauncher.launch(chooserIntent);
            return true;
        } catch (ActivityNotFoundException e1) {
            Log.w(TAG, "ACTION_GET_CONTENT chooser failed, falling back to ACTION_OPEN_DOCUMENT", e1);
        } catch (Exception e1) {
            Log.w(TAG, "Chooser launch error: " + e1.getMessage());
        }

        // Fallback 1: ACTION_OPEN_DOCUMENT
        try {
            Intent openDocIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            openDocIntent.addCategory(Intent.CATEGORY_OPENABLE);
            openDocIntent.setType("audio/*");
            openDocIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            openDocIntent.putExtra(Intent.EXTRA_MIME_TYPES, audioMimeTypes);
            mFileChooserLauncher.launch(openDocIntent);
            return true;
        } catch (ActivityNotFoundException e2) {
            Log.w(TAG, "ACTION_OPEN_DOCUMENT failed, falling back to default params", e2);
        } catch (Exception e2) {
            Log.w(TAG, "ACTION_OPEN_DOCUMENT error: " + e2.getMessage());
        }

        // Fallback 2: fileChooserParams.createIntent()
        if (fileChooserParams != null) {
            try {
                Intent fallbackIntent = fileChooserParams.createIntent();
                fallbackIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                mFileChooserLauncher.launch(fallbackIntent);
                return true;
            } catch (Exception e3) {
                Log.w(TAG, "fileChooserParams createIntent failed", e3);
            }
        }

        // Fallback 3: Generic GET_CONTENT
        try {
            Intent genericIntent = new Intent(Intent.ACTION_GET_CONTENT);
            genericIntent.setType("*/*");
            genericIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            mFileChooserLauncher.launch(genericIntent);
            return true;
        } catch (Exception e4) {
            Log.e(TAG, "All file chooser intents failed", e4);
            if (mFilePathCallback != null) {
                mFilePathCallback.onReceiveValue(null);
                mFilePathCallback = null;
            }
            Toast.makeText(this, "Không tìm thấy ứng dụng chọn tập tin âm thanh", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    /**
     * Checks if a host belongs to private local network (LAN / localhost)
     */
    private static boolean isLocalOrPrivateNetwork(String host) {
        if (host == null) return false;
        return host.equals("localhost") ||
                host.equals("127.0.0.1") ||
                host.equals("10.0.2.2") ||
                host.startsWith("192.168.") ||
                host.startsWith("10.") ||
                (host.startsWith("172.") && isPrivate172(host)) ||
                host.endsWith(".local") ||
                host.endsWith(".lan");
    }

    private static boolean isPrivate172(String host) {
        String[] parts = host.split("\\.");
        if (parts.length >= 2) {
            try {
                int second = Integer.parseInt(parts[1]);
                return second >= 16 && second <= 31;
            } catch (NumberFormatException ignored) {}
        }
        return false;
    }

    /**
     * Extracts request body from WebResourceRequest using reflection or stream access
     */
    private byte[] extractRequestBody(WebResourceRequest request) {
        if (request == null) return null;
        Class<?> reqClass = request.getClass();

        // 1. Try common getter methods
        String[] methodNames = new String[]{"getBody", "getData", "getInputStream", "getRequestBody", "getBytes"};
        for (String name : methodNames) {
            try {
                Method m = reqClass.getMethod(name);
                m.setAccessible(true);
                Object res = m.invoke(request);
                byte[] b = toByteArray(res);
                if (b != null) return b;
            } catch (Throwable ignored) {}
        }

        // 2. Try declared fields on class hierarchy
        Class<?> cur = reqClass;
        String[] fieldNames = new String[]{"body", "mBody", "data", "mData", "postData", "mPostData", "requestBody", "mRequestBody"};
        while (cur != null && cur != Object.class) {
            for (String name : fieldNames) {
                try {
                    Field f = cur.getDeclaredField(name);
                    f.setAccessible(true);
                    Object res = f.get(request);
                    byte[] b = toByteArray(res);
                    if (b != null) return b;
                } catch (Throwable ignored) {}
            }
            cur = cur.getSuperclass();
        }

        return null;
    }

    private byte[] toByteArray(Object obj) {
        if (obj == null) return null;
        if (obj instanceof byte[]) return (byte[]) obj;
        if (obj instanceof String) return ((String) obj).getBytes(StandardCharsets.UTF_8);
        if (obj instanceof InputStream) {
            try (InputStream in = (InputStream) obj;
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            } catch (Exception ignored) {}
        }
        if (obj instanceof ByteBuffer) {
            ByteBuffer bb = (ByteBuffer) obj;
            byte[] b = new byte[bb.remaining()];
            bb.get(b);
            return b;
        }
        return null;
    }

    private static SSLSocketFactory sTrustAllSslSocketFactory = null;
    private static HostnameVerifier sTrustAllHostnameVerifier = null;

    private static synchronized void initTrustAllSsl() {
        if (sTrustAllSslSocketFactory == null) {
            try {
                TrustManager[] trustAllCerts = new TrustManager[]{
                    new X509TrustManager() {
                        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                        public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                        public void checkServerTrusted(X509Certificate[] certs, String authType) {}
                    }
                };
                SSLContext sc = SSLContext.getInstance("TLS");
                sc.init(null, trustAllCerts, new java.security.SecureRandom());
                sTrustAllSslSocketFactory = sc.getSocketFactory();
                sTrustAllHostnameVerifier = (hostname, session) -> true;
            } catch (Exception ignored) {}
        }
    }

    /**
     * Proxies HTTP & HTTPS requests to local networks via native HttpURLConnection.
     * Handles ALL HTTP methods (GET, POST, PUT, DELETE, HEAD, OPTIONS, PATCH) and forwards the request body.
     * Injects permissive CORS headers and trusts local self-signed certs so JavaScript fetch() never gets blocked.
     */
    private WebResourceResponse proxyLocalHttpRequest(WebResourceRequest request) {
        try {
            URL url = new URL(request.getUrl().toString());
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            if (conn instanceof HttpsURLConnection && isLocalOrPrivateNetwork(url.getHost())) {
                initTrustAllSsl();
                if (sTrustAllSslSocketFactory != null) {
                    ((HttpsURLConnection) conn).setSSLSocketFactory(sTrustAllSslSocketFactory);
                    ((HttpsURLConnection) conn).setHostnameVerifier(sTrustAllHostnameVerifier);
                }
            }
            String method = request.getMethod();
            if (method == null || method.isEmpty()) method = "GET";
            method = method.toUpperCase(Locale.US);
            conn.setRequestMethod(method);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(12000);
            conn.setInstanceFollowRedirects(true);

            Map<String, String> reqHeaders = request.getRequestHeaders();
            if (reqHeaders != null) {
                for (Map.Entry<String, String> entry : reqHeaders.entrySet()) {
                    if (!"Host".equalsIgnoreCase(entry.getKey())) {
                        conn.setRequestProperty(entry.getKey(), entry.getValue());
                    }
                }
            }

            // Handle request body for POST, PUT, PATCH, DELETE
            byte[] bodyBytes = extractRequestBody(request);
            boolean hasOutput = "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method) ||
                    ("DELETE".equals(method) && bodyBytes != null && bodyBytes.length > 0);

            if (hasOutput) {
                conn.setDoOutput(true);
                if (bodyBytes != null && bodyBytes.length > 0) {
                    conn.setFixedLengthStreamingMode(bodyBytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bodyBytes);
                        os.flush();
                    }
                }
            }

            int statusCode = conn.getResponseCode();
            String message = conn.getResponseMessage();
            if (message == null || message.isEmpty()) message = "OK";
            String contentType = conn.getContentType();
            String mimeType = "application/octet-stream";
            String encoding = "UTF-8";
            if (contentType != null) {
                String[] parts = contentType.split(";");
                mimeType = parts[0].trim();
                for (int i = 1; i < parts.length; i++) {
                    String p = parts[i].trim().toLowerCase(Locale.US);
                    if (p.startsWith("charset=")) {
                        encoding = parts[i].trim().substring(8).trim();
                    }
                }
            }

            Map<String, String> respHeaders = new HashMap<>();
            for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
                if (entry.getKey() != null && !entry.getValue().isEmpty()) {
                    respHeaders.put(entry.getKey(), entry.getValue().get(0));
                }
            }

            // Inject CORS headers on all responses so WebView fetch() never gets blocked
            respHeaders.put("Access-Control-Allow-Origin", "*");
            respHeaders.put("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH");
            respHeaders.put("Access-Control-Allow-Headers", "*");
            respHeaders.put("Access-Control-Allow-Credentials", "true");
            respHeaders.put("Access-Control-Expose-Headers", "*");

            InputStream in;
            if ("HEAD".equals(method)) {
                in = new ByteArrayInputStream(new byte[0]);
            } else {
                in = statusCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (in == null) in = new ByteArrayInputStream(new byte[0]);
            }

            return new WebResourceResponse(mimeType, encoding, statusCode, message, respHeaders, in);
        } catch (Exception e) {
            Log.d(TAG, "Local proxy bypass to native for " + request.getUrl() + " (" + request.getMethod() + "): " + e.getMessage());
            return null;
        }
    }

    /**
     * High performance WebSettings configured specifically for Web Audio API,
     * low-latency audio processing, OAuth popups, and local server streaming.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private void configureHighPerformanceWebView() {
        WebSettings settings = mWebView.getSettings();

        // 1. High performance JavaScript & DOM storage
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // 2. CookieManager setup for OAuth (Google, Microsoft, Cloud APIs)
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(mWebView, true);

        // 3. Clean User-Agent: strips "; wv" and "Version/4.0" to prevent Google 403 disallowed_useragent
        String defaultUa = settings.getUserAgentString();
        mCleanUserAgent = defaultUa.replace("; wv", "").replaceAll("Version/\\d+\\.\\d+\\s*", "");
        settings.setUserAgentString(mCleanUserAgent);

        // 4. Audiophile background playback requires user gesture disabled
        settings.setMediaPlaybackRequiresUserGesture(false);

        // 5. Mixed Content: allow HTTP local NAS & server connections from HTTPS appassets
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // 6. Multiple Windows & popups for Google & Microsoft OAuth
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);

        // 7. File access for offline local audio library reading & DAP SD card storage
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowFileAccessFromFileURLs(true);

        // 8. Cache mode & viewport
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // 9. Hardware acceleration & rendering
        mWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        mWebView.setBackgroundColor(Color.parseColor("#111315"));

        // 10. Setup AssetLoader for secure HTTPS local file loading (works with Web Workers & AudioContext)
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();

                // 1. Intercept local media streaming (FLAC, DSD, WAV, MP3) with HTTP 206 Partial Content range support
                String scheme = uri.getScheme();
                String host = uri.getHost();
                String path = uri.getPath();
                if ("https".equalsIgnoreCase(scheme) &&
                        "appassets.androidplatform.net".equalsIgnoreCase(host) &&
                        "/local-media".equalsIgnoreCase(path)) {
                    WebResourceResponse mediaResponse = handleLocalMediaStreaming(request);
                    if (mediaResponse != null) {
                        return mediaResponse;
                    }
                }

                // Intercept asset loader
                WebResourceResponse assetResponse = assetLoader.shouldInterceptRequest(uri);
                if (assetResponse != null) {
                    return assetResponse;
                }

                // CORS Preflight: Intercept OPTIONS requests to allow cross-origin local servers
                if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    headers.put("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH");
                    headers.put("Access-Control-Allow-Headers", "*");
                    headers.put("Access-Control-Max-Age", "86400");
                    headers.put("Access-Control-Allow-Credentials", "true");
                    return new WebResourceResponse("text/plain", "UTF-8", 200, "OK", headers, new ByteArrayInputStream(new byte[0]));
                }

                // Proxy local network HTTP/HTTPS requests for ALL methods (GET, POST, PUT, DELETE, HEAD, etc.) to bypass CORS & self-signed cert restrictions
                if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && isLocalOrPrivateNetwork(host) && !"/local-media".equalsIgnoreCase(path)) {
                    WebResourceResponse proxied = proxyLocalHttpRequest(request);
                    if (proxied != null) return proxied;
                }

                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                String host = error.getUrl() != null ? Uri.parse(error.getUrl()).getHost() : "";
                if (isLocalOrPrivateNetwork(host)) {
                    handler.proceed(); // Allow self-signed SSL certs for local NAS / Jellyfin / Subsonic
                } else {
                    super.onReceivedSslError(view, handler, error);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                mProgressBar.setVisibility(View.GONE);
                injectAndroidEnvironmentBridge();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    Log.w(TAG, "MainFrame load error: " + error.getDescription());
                }
            }
        });

        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    mProgressBar.setVisibility(View.VISIBLE);
                    mProgressBar.setProgress(newProgress);
                } else {
                    mProgressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(TAG, "[Console] " + consoleMessage.message() +
                        " -- From line " + consoleMessage.lineNumber() + " of " + consoleMessage.sourceId());
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                // Creates a dedicated modal popup WebView for Google & Microsoft OAuth
                final Dialog popupDialog = new Dialog(MainActivity.this, android.R.style.Theme_DeviceDefault_NoActionBar_Fullscreen);
                final WebView popupWebView = new WebView(MainActivity.this);
                popupWebView.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));

                WebSettings popupSettings = popupWebView.getSettings();
                popupSettings.setJavaScriptEnabled(true);
                popupSettings.setDomStorageEnabled(true);
                popupSettings.setDatabaseEnabled(true);
                popupSettings.setSupportMultipleWindows(true);
                popupSettings.setJavaScriptCanOpenWindowsAutomatically(true);
                popupSettings.setUserAgentString(mCleanUserAgent);
                popupSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

                CookieManager.getInstance().setAcceptCookie(true);
                CookieManager.getInstance().setAcceptThirdPartyCookies(popupWebView, true);

                popupWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        Uri uri = request.getUrl();
                        if ("https".equalsIgnoreCase(uri.getScheme()) &&
                                "appassets.androidplatform.net".equalsIgnoreCase(uri.getHost()) &&
                                "/local-media".equalsIgnoreCase(uri.getPath())) {
                            WebResourceResponse mediaResponse = handleLocalMediaStreaming(request);
                            if (mediaResponse != null) {
                                return mediaResponse;
                            }
                        }
                        WebResourceResponse assetResponse = assetLoader.shouldInterceptRequest(uri);
                        if (assetResponse != null) {
                            return assetResponse;
                        }
                        return super.shouldInterceptRequest(view, request);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        return false;
                    }
                });

                popupWebView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onCloseWindow(WebView window) {
                        if (popupDialog.isShowing()) {
                            popupDialog.dismiss();
                        }
                        window.destroy();
                        mActivePopupDialog = null;
                    }
                });

                popupDialog.setContentView(popupWebView);
                popupDialog.setOnDismissListener(dialog -> {
                    popupWebView.destroy();
                    mActivePopupDialog = null;
                });
                mActivePopupDialog = popupDialog;
                popupDialog.show();

                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popupWebView);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onCloseWindow(WebView window) {
                if (mActivePopupDialog != null && mActivePopupDialog.isShowing()) {
                    mActivePopupDialog.dismiss();
                    mActivePopupDialog = null;
                }
                super.onCloseWindow(window);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                }
                mFilePathCallback = filePathCallback;

                return launchDapMusicChooser(fileChooserParams);
            }
        });

        // Add native JavaScript bridge
        mWebView.addJavascriptInterface(new WebAppInterface(this), "NocturneNative");
    }

    /**
     * Inject native Android runtime bridge and safe-area environment flags
     */
    private void injectAndroidEnvironmentBridge() {
        String js = "window.isNativeAndroid = true;" +
                "window.androidPlatformInfo = { platform: 'Android', sdk: " + Build.VERSION.SDK_INT +
                ", isDapCompatible: true, supportsLegacyStorage: " + (Build.VERSION.SDK_INT <= 30) + " };" +
                "if (window.dispatchEvent) { window.dispatchEvent(new CustomEvent('nocturne-native-ready')); }";
        mWebView.evaluateJavascript(js, null);
    }

    /**
     * Dispatch notch and gesture navigation bar insets to layout and CSS custom properties
     */
    private void setupWindowInsetsHandling() {
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root_layout), (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );

            // Pass safe-area padding into web runtime for responsive notch/pill padding
            int topPx = insets.top;
            int bottomPx = insets.bottom;
            int leftPx = insets.left;
            int rightPx = insets.right;

            float density = getResources().getDisplayMetrics().density;
            int topDp = (int) (topPx / density);
            int bottomDp = (int) (bottomPx / density);
            int leftDp = (int) (leftPx / density);
            int rightDp = (int) (rightPx / density);

            String setCssVars = String.format(
                    Locale.US,
                    "document.documentElement.style.setProperty('--safe-inset-top', '%dpx');" +
                    "document.documentElement.style.setProperty('--safe-inset-bottom', '%dpx');" +
                    "document.documentElement.style.setProperty('--safe-inset-left', '%dpx');" +
                    "document.documentElement.style.setProperty('--safe-inset-right', '%dpx');",
                    topDp, bottomDp, leftDp, rightDp
            );
            mWebView.evaluateJavascript(setCssVars, null);

            return windowInsets;
        });
    }

    /**
     * Back button handling: navigates back in WebView history if available, else finishes
     */
    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (mActivePopupDialog != null && mActivePopupDialog.isShowing()) {
                    mActivePopupDialog.dismiss();
                    mActivePopupDialog = null;
                    return;
                }
                if (mWebView != null) {
                    mWebView.evaluateJavascript("(function(){ return Boolean(window.onAndroidBackPressed && window.onAndroidBackPressed()); })()", value -> {
                        if ("true".equalsIgnoreCase(value)) {
                            // Handled by JavaScript modal / panel dismissal
                            return;
                        }
                        if (mWebView.canGoBack()) {
                            mWebView.goBack();
                        } else {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    });
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }

    /**
     * Request permissions for Android 10 (FiiO M11S / API 29) through Android 15 (API 35).
     * Android <= 12 (API <= 32) MUST request Manifest.permission.READ_EXTERNAL_STORAGE at runtime.
     * Android 13+ (API 33+) requests READ_MEDIA_AUDIO and POST_NOTIFICATIONS.
     */
    public void requestAppPermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            // Android <= 12 (API <= 32) e.g. FiiO M11S (Android 10 / API 29)
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                }
            }
        } else {
            // Android 13+ (API 33+)
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.READ_MEDIA_AUDIO);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (!perms.isEmpty()) {
            mPermissionLauncher.launch(perms.toArray(new String[0]));
        }
    }

    /**
     * Check if audio storage read permission is granted
     */
    public boolean hasStoragePermission() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED;
        } else {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO)
                    == PackageManager.PERMISSION_GRANTED;
        }
    }

    /**
     * Load entrypoint: Checks intent extra "url" -> fallback to asset url -> fallback to local dev url
     */
    private void loadAppEntrypoint() {
        Intent intent = getIntent();
        String targetUrl = DEFAULT_ASSET_URL;

        if (intent != null && intent.hasExtra("url")) {
            String customUrl = intent.getStringExtra("url");
            if (customUrl != null && (customUrl.startsWith("http://") || customUrl.startsWith("https://"))) {
                targetUrl = customUrl;
            }
        }

        Log.i(TAG, "Loading Nocturne audiophile entrypoint: " + targetUrl);
        mWebView.loadUrl(targetUrl);
    }

    /**
     * Native WakeLock control for uninterrupted high-resolution audio playback
     */
    public void acquireWakeLock() {
        try {
            if (mWakeLock != null && !mWakeLock.isHeld()) {
                mWakeLock.acquire(10 * 60 * 60 * 1000L); // 10 hours max safety timeout
                Log.d(TAG, "Acquired playback WakeLock");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire WakeLock: " + e.getMessage());
        }
    }

    public void releaseWakeLock() {
        try {
            if (mWakeLock != null && mWakeLock.isHeld()) {
                mWakeLock.release();
                Log.d(TAG, "Released playback WakeLock");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to release WakeLock: " + e.getMessage());
        }
    }

    /**
     * Request Audio Focus for bit-perfect/exclusive media playback
     */
    public boolean requestAudioFocus() {
        if (mAudioManager == null) return false;

        AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            mAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(focusChange -> {
                        switch (focusChange) {
                            case AudioManager.AUDIOFOCUS_LOSS:
                            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                                mHasAudioFocus = false;
                                mWebView.post(() -> mWebView.evaluateJavascript(
                                        "if (typeof state !== 'undefined' && state.context && state.context.state === 'running') { $('play-button')?.click(); }",
                                        null));
                                break;
                            case AudioManager.AUDIOFOCUS_GAIN:
                                mHasAudioFocus = true;
                                break;
                        }
                    })
                    .build();

            int result = mAudioManager.requestAudioFocus(mAudioFocusRequest);
            mHasAudioFocus = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        } else {
            @SuppressWarnings("deprecation")
            int result = mAudioManager.requestAudioFocus(
                    focusChange -> {
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                            mHasAudioFocus = false;
                        }
                    },
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
            );
            mHasAudioFocus = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        }

        return mHasAudioFocus;
    }

    public void abandonAudioFocus() {
        if (mAudioManager != null && mHasAudioFocus) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mAudioFocusRequest != null) {
                mAudioManager.abandonAudioFocusRequest(mAudioFocusRequest);
            }
            mHasAudioFocus = false;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mWebView != null) {
            mWebView.onResume();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Do not pause webview timers during active background playback
    }

    @Override
    protected void onDestroy() {
        cancelMediaNotification();
        releaseWakeLock();
        abandonAudioFocus();
        unregisterMediaNotificationReceiver();
        if (mMediaSession != null) {
            try {
                mMediaSession.setActive(false);
                mMediaSession.release();
            } catch (Exception ignored) {}
            mMediaSession = null;
        }
        if (mActivePopupDialog != null && mActivePopupDialog.isShowing()) {
            mActivePopupDialog.dismiss();
            mActivePopupDialog = null;
        }
        if (mWebView != null) {
            mWebView.destroy();
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if (ACTION_PLAY_PAUSE.equals(action)) {
                dispatchPlayPauseToWeb();
            } else if (ACTION_NEXT.equals(action)) {
                dispatchNextToWeb();
            } else if (ACTION_PREV.equals(action)) {
                dispatchPreviousToWeb();
            }
        }
    }

    /**
     * BoundedFileInputStream wraps RandomAccessFile to stream exact byte ranges (HTTP 206 Partial Content)
     * with zero memory buffering for high-resolution FLAC/DSD/WAV audio files.
     */
    public static class BoundedFileInputStream extends InputStream {
        private final RandomAccessFile mRaf;
        private long mRemaining;

        public BoundedFileInputStream(File file, long start, long length) throws IOException {
            this.mRaf = new RandomAccessFile(file, "r");
            if (start > 0) {
                this.mRaf.seek(start);
            }
            this.mRemaining = length;
        }

        @Override
        public int read() throws IOException {
            if (mRemaining <= 0) return -1;
            int b = mRaf.read();
            if (b != -1) mRemaining--;
            return b;
        }

        @Override
        public int read(@NonNull byte[] b, int off, int len) throws IOException {
            if (mRemaining <= 0) return -1;
            int toRead = (int) Math.min(len, mRemaining);
            int bytesRead = mRaf.read(b, off, toRead);
            if (bytesRead > 0) {
                mRemaining -= bytesRead;
            }
            return bytesRead;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(mRemaining, Integer.MAX_VALUE);
        }

        @Override
        public void close() throws IOException {
            mRaf.close();
        }
    }

    /**
     * Determines proper audio MIME type based on file extension
     */
    public static String getAudioMimeType(String fileName) {
        if (fileName == null) return "application/octet-stream";
        String lower = fileName.toLowerCase(Locale.US);
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".dsf") || lower.endsWith(".dff")) return "audio/x-dsd";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".m4a") || lower.endsWith(".alac") || lower.endsWith(".aac")) return "audio/mp4";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".opus")) return "audio/opus";
        if (lower.endsWith(".aiff") || lower.endsWith(".aif")) return "audio/aiff";
        if (lower.endsWith(".ape")) return "audio/x-ape";
        if (lower.endsWith(".wma")) return "audio/x-ms-wma";
        return "audio/octet-stream";
    }

    /**
     * Handles local media streaming for URLs matching:
     * https://appassets.androidplatform.net/local-media?path=<encoded_path>
     * Implements HTTP 206 Partial Content (Range header: bytes=start-end) support,
     * Content-Range, Content-Length, and proper audio MIME types for zero memory buffering.
     */
    private WebResourceResponse handleLocalMediaStreaming(WebResourceRequest request) {
        try {
            Uri uri = request.getUrl();
            String method = request.getMethod();
            if (method == null || method.isEmpty()) method = "GET";
            method = method.toUpperCase(Locale.US);

            if ("OPTIONS".equals(method)) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
                headers.put("Access-Control-Allow-Headers", "*");
                headers.put("Access-Control-Max-Age", "86400");
                return new WebResourceResponse("text/plain", "UTF-8", 200, "OK", headers, new ByteArrayInputStream(new byte[0]));
            }

            String pathParam = uri.getQueryParameter("path");
            if (pathParam == null || pathParam.isEmpty()) {
                String query = uri.getQuery();
                if (query != null && query.startsWith("path=")) {
                    pathParam = query.substring(5);
                }
            }

            if (pathParam == null || pathParam.isEmpty()) {
                Map<String, String> errHeaders = new HashMap<>();
                errHeaders.put("Access-Control-Allow-Origin", "*");
                return new WebResourceResponse("text/plain", "UTF-8", 400, "Bad Request", errHeaders,
                        new ByteArrayInputStream("Missing path parameter".getBytes(StandardCharsets.UTF_8)));
            }

            File file = new File(pathParam);
            if (!file.exists()) {
                try {
                    String decoded = URLDecoder.decode(pathParam, StandardCharsets.UTF_8.name());
                    File f2 = new File(decoded);
                    if (f2.exists()) {
                        file = f2;
                    }
                } catch (Exception ignored) {}
            }

            if (!file.exists() || !file.isFile() || !file.canRead()) {
                Log.w(TAG, "Local media file not found or unreadable: " + file.getAbsolutePath());
                Map<String, String> errHeaders = new HashMap<>();
                errHeaders.put("Access-Control-Allow-Origin", "*");
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", errHeaders,
                        new ByteArrayInputStream(("File not found: " + pathParam).getBytes(StandardCharsets.UTF_8)));
            }

            long fileLength = file.length();
            String mimeType = getAudioMimeType(file.getName());

            Map<String, String> reqHeaders = request.getRequestHeaders();
            String rangeHeader = null;
            if (reqHeaders != null) {
                for (Map.Entry<String, String> entry : reqHeaders.entrySet()) {
                    if ("Range".equalsIgnoreCase(entry.getKey())) {
                        rangeHeader = entry.getValue();
                        break;
                    }
                }
            }

            long start = 0;
            long end = fileLength - 1;
            boolean isRange = false;

            if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                String rangeValue = rangeHeader.substring(6).trim();
                int dashIndex = rangeValue.indexOf('-');
                try {
                    if (dashIndex == 0) {
                        // bytes=-500 -> last 500 bytes
                        long suffix = Long.parseLong(rangeValue.substring(1).trim());
                        start = Math.max(0, fileLength - suffix);
                        isRange = true;
                    } else if (dashIndex > 0) {
                        String sStart = rangeValue.substring(0, dashIndex).trim();
                        String sEnd = rangeValue.substring(dashIndex + 1).trim();
                        start = Long.parseLong(sStart);
                        if (!sEnd.isEmpty()) {
                            end = Long.parseLong(sEnd);
                        }
                        isRange = true;
                    }
                } catch (NumberFormatException e) {
                    Log.w(TAG, "Invalid range header: " + rangeHeader, e);
                }
            }

            if (isRange) {
                if (start < 0 || start > end || start >= fileLength) {
                    Map<String, String> respHeaders = new HashMap<>();
                    respHeaders.put("Content-Range", "bytes */" + fileLength);
                    respHeaders.put("Access-Control-Allow-Origin", "*");
                    return new WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", respHeaders,
                            new ByteArrayInputStream(new byte[0]));
                }
                if (end >= fileLength) {
                    end = fileLength - 1;
                }
            }

            long contentLength = end - start + 1;
            int statusCode = isRange ? 206 : 200;
            String statusReason = isRange ? "Partial Content" : "OK";

            Map<String, String> respHeaders = new HashMap<>();
            respHeaders.put("Content-Type", mimeType);
            respHeaders.put("Content-Length", String.valueOf(contentLength));
            respHeaders.put("Accept-Ranges", "bytes");
            respHeaders.put("Access-Control-Allow-Origin", "*");
            respHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            respHeaders.put("Access-Control-Allow-Headers", "*");
            respHeaders.put("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
            respHeaders.put("Cache-Control", "no-cache");

            if (isRange) {
                respHeaders.put("Content-Range", String.format(Locale.US, "bytes %d-%d/%d", start, end, fileLength));
            }

            InputStream is;
            if ("HEAD".equals(method)) {
                is = new ByteArrayInputStream(new byte[0]);
            } else {
                is = new BoundedFileInputStream(file, start, contentLength);
            }
            return new WebResourceResponse(mimeType, null, statusCode, statusReason, respHeaders, is);
        } catch (Exception e) {
            Log.e(TAG, "Error handling local media streaming: " + e.getMessage(), e);
            Map<String, String> errHeaders = new HashMap<>();
            errHeaders.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse("text/plain", "UTF-8", 500, "Internal Server Error", errHeaders,
                    new ByteArrayInputStream(("Stream error: " + e.getMessage()).getBytes(StandardCharsets.UTF_8)));
        }
    }

    /**
     * Intercept FiiO physical hardware buttons & headphone media keys
     */
    public boolean isMediaKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
                keyCode == KeyEvent.KEYCODE_MEDIA_STOP ||
                keyCode == KeyEvent.KEYCODE_MEDIA_NEXT ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS;
    }

    public void handleMediaKey(int keyCode) {
        Log.d(TAG, "Hardware Media Key intercepted: " + keyCode);
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                dispatchNextToWeb();
                break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                dispatchPreviousToWeb();
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
            case KeyEvent.KEYCODE_MEDIA_STOP:
            default:
                dispatchPlayPauseToWeb();
                break;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        if (isMediaKey(keyCode)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                handleMediaKey(keyCode);
            }
            return true; // Return true so FiiO system music app doesn't steal the hardware key events!
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (isMediaKey(keyCode)) {
            if (event.getRepeatCount() == 0) {
                handleMediaKey(keyCode);
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (isMediaKey(keyCode)) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    public void dispatchPlayPauseToWeb() {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (typeof state !== 'undefined') $('play-button')?.click();", null);
            }
        });
    }

    public void dispatchNextToWeb() {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (typeof state !== 'undefined') $('next-button')?.click();", null);
            }
        });
    }

    public void dispatchPreviousToWeb() {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (typeof state !== 'undefined') $('previous-button')?.click();", null);
            }
        });
    }

    private final BroadcastReceiver mMediaNotificationReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            Log.d(TAG, "Media notification action received: " + action);
            if (ACTION_PLAY_PAUSE.equals(action)) {
                dispatchPlayPauseToWeb();
            } else if (ACTION_NEXT.equals(action)) {
                dispatchNextToWeb();
            } else if (ACTION_PREV.equals(action)) {
                dispatchPreviousToWeb();
            }
        }
    };

    private void registerMediaNotificationReceiver() {
        if (!mIsMediaReceiverRegistered) {
            IntentFilter filter = new IntentFilter();
            filter.addAction(ACTION_PLAY_PAUSE);
            filter.addAction(ACTION_NEXT);
            filter.addAction(ACTION_PREV);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(mMediaNotificationReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(mMediaNotificationReceiver, filter);
            }
            mIsMediaReceiverRegistered = true;
        }
    }

    private void unregisterMediaNotificationReceiver() {
        if (mIsMediaReceiverRegistered) {
            try {
                unregisterReceiver(mMediaNotificationReceiver);
            } catch (Exception ignored) {}
            mIsMediaReceiverRegistered = false;
        }
    }

    private void initMediaSession() {
        try {
            mMediaSession = new MediaSession(this, "NocturnePlayback");
            mMediaSession.setCallback(new MediaSession.Callback() {
                @Override
                public boolean onMediaButtonEvent(Intent mediaButtonIntent) {
                    if (mediaButtonIntent != null && mediaButtonIntent.hasExtra(Intent.EXTRA_KEY_EVENT)) {
                        KeyEvent ke = mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                        if (ke != null && ke.getAction() == KeyEvent.ACTION_DOWN && ke.getRepeatCount() == 0) {
                            if (isMediaKey(ke.getKeyCode())) {
                                handleMediaKey(ke.getKeyCode());
                                return true;
                            }
                        }
                    }
                    return super.onMediaButtonEvent(mediaButtonIntent);
                }

                @Override
                public void onPlay() {
                    dispatchPlayPauseToWeb();
                }

                @Override
                public void onPause() {
                    dispatchPlayPauseToWeb();
                }

                @Override
                public void onSkipToNext() {
                    dispatchNextToWeb();
                }

                @Override
                public void onSkipToPrevious() {
                    dispatchPreviousToWeb();
                }

                @Override
                public void onStop() {
                    dispatchPlayPauseToWeb();
                }
            });
            mMediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
            mMediaSession.setActive(true);
        } catch (Exception e) {
            Log.w(TAG, "Failed to initialize MediaSession: " + e.getMessage());
        }
    }

    private void createNotificationChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel channel = nm.getNotificationChannel(NOTIFICATION_CHANNEL_ID);
                if (channel == null) {
                    channel = new NotificationChannel(
                            NOTIFICATION_CHANNEL_ID,
                            "Nocturne Playback",
                            NotificationManager.IMPORTANCE_LOW
                    );
                    channel.setDescription("Nocturne Audiophile Hi-Res Playback Controls");
                    channel.setShowBadge(false);
                    channel.setSound(null, null);
                    channel.enableVibration(false);
                    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                    nm.createNotificationChannel(channel);
                }
            }
        }
    }

    public void updateMediaNotification(String title, String artist, String album, boolean isPlaying) {
        if (isPlaying) {
            acquireWakeLock();
            showMediaNotification(title, artist, album, true);
        } else {
            cancelMediaNotification();
            releaseWakeLock();
        }
    }

    private void showMediaNotification(String title, String artist, String album, boolean isPlaying) {
        try {
            createNotificationChannelIfNeeded();

            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);

            Intent prevIntent = new Intent(ACTION_PREV).setPackage(getPackageName());
            PendingIntent pPrev = PendingIntent.getBroadcast(this, 101, prevIntent, flags);

            Intent playPauseIntent = new Intent(ACTION_PLAY_PAUSE).setPackage(getPackageName());
            PendingIntent pPlayPause = PendingIntent.getBroadcast(this, 102, playPauseIntent, flags);

            Intent nextIntent = new Intent(ACTION_NEXT).setPackage(getPackageName());
            PendingIntent pNext = PendingIntent.getBroadcast(this, 103, nextIntent, flags);

            Intent contentIntent = new Intent(this, MainActivity.class);
            contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent contentPendingIntent = PendingIntent.getActivity(this, 100, contentIntent, flags);

            String displayTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Nocturne Audiophile";
            String displayArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "Nocturne Hi-Res Audio";
            String displayAlbum = (album != null && !album.trim().isEmpty()) ? album.trim() : null;

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(displayTitle)
                    .setContentText(displayArtist)
                    .setSubText(displayAlbum)
                    .setOngoing(true)
                    .setAutoCancel(false)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(contentPendingIntent)
                    .addAction(android.R.drawable.ic_media_previous, "Previous", pPrev)
                    .addAction(isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                            isPlaying ? "Pause" : "Play", pPlayPause)
                    .addAction(android.R.drawable.ic_media_next, "Next", pNext);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, builder.build());
            }

            if (mMediaSession != null) {
                try {
                    PlaybackState.Builder psb = new PlaybackState.Builder()
                            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                                    PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                                    PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
                            .setState(isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                                    PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f);
                    mMediaSession.setPlaybackState(psb.build());

                    MediaMetadata.Builder mb = new MediaMetadata.Builder();
                    mb.putString(MediaMetadata.METADATA_KEY_TITLE, displayTitle);
                    mb.putString(MediaMetadata.METADATA_KEY_ARTIST, displayArtist);
                    if (displayAlbum != null) {
                        mb.putString(MediaMetadata.METADATA_KEY_ALBUM, displayAlbum);
                    }
                    mMediaSession.setMetadata(mb.build());
                } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            Log.e(TAG, "Error displaying media notification: " + e.getMessage(), e);
        }
    }

    private void cancelMediaNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIFICATION_ID);
            }
            if (mMediaSession != null) {
                try {
                    PlaybackState.Builder psb = new PlaybackState.Builder()
                            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE)
                            .setState(PlaybackState.STATE_STOPPED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0.0f);
                    mMediaSession.setPlaybackState(psb.build());
                } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling media notification: " + e.getMessage(), e);
        }
    }

    /**
     * JavaScript Bridge Interface exposed to the web application as `window.NocturneNative`
     */
    public static class WebAppInterface {
        private final MainActivity mActivity;

        public WebAppInterface(MainActivity activity) {
            this.mActivity = activity;
        }

        @JavascriptInterface
        public void acquireWakeLock() {
            mActivity.runOnUiThread(mActivity::acquireWakeLock);
        }

        @JavascriptInterface
        public void releaseWakeLock() {
            mActivity.runOnUiThread(mActivity::releaseWakeLock);
        }

        @JavascriptInterface
        public void updateMediaNotification(String title, String artist, String album, boolean isPlaying) {
            mActivity.runOnUiThread(() -> mActivity.updateMediaNotification(title, artist, album, isPlaying));
        }

        @JavascriptInterface
        public boolean requestAudioFocus() {
            return mActivity.requestAudioFocus();
        }

        @JavascriptInterface
        public void abandonAudioFocus() {
            mActivity.runOnUiThread(mActivity::abandonAudioFocus);
        }

        @JavascriptInterface
        public boolean isNativeAndroid() {
            return true;
        }

        @JavascriptInterface
        public String getPlatform() {
            return "Android";
        }

        @JavascriptInterface
        public int getAndroidSdk() {
            return Build.VERSION.SDK_INT;
        }

        @JavascriptInterface
        public boolean hasStoragePermission() {
            return mActivity.hasStoragePermission();
        }

        @JavascriptInterface
        public void requestStoragePermission() {
            mActivity.runOnUiThread(mActivity::requestAppPermissions);
        }

        @JavascriptInterface
        public void openMusicChooser() {
            mActivity.runOnUiThread(() -> mActivity.launchDapMusicChooser(null));
        }

        /**
         * Returns JSON array of all accessible music storage root directories
         * (e.g. /sdcard/Music, internal storage, and external MicroSD card mount points on FiiO M11S).
         */
        @JavascriptInterface
        public String getStoragePaths() {
            JSONArray array = new JSONArray();
            Set<String> paths = new HashSet<>();

            // 1. Primary external storage /sdcard
            try {
                File extDir = Environment.getExternalStorageDirectory();
                if (extDir != null && extDir.exists()) {
                    paths.add(extDir.getAbsolutePath());
                    File musicDir = new File(extDir, "Music");
                    if (musicDir.exists()) {
                        paths.add(musicDir.getAbsolutePath());
                    }
                }
            } catch (Exception ignored) {}

            // 2. Standard Music public directory
            try {
                File pubMusic = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
                if (pubMusic != null && pubMusic.exists()) {
                    paths.add(pubMusic.getAbsolutePath());
                }
            } catch (Exception ignored) {}

            // 3. App-specific external files dirs (covers secondary SD cards on DAPs)
            try {
                File[] extFilesDirs = ContextCompat.getExternalFilesDirs(mActivity, null);
                if (extFilesDirs != null) {
                    for (File f : extFilesDirs) {
                        if (f != null) {
                            // Extract root SD card mount point from /storage/XXXX-XXXX/Android/data/...
                            String p = f.getAbsolutePath();
                            int idx = p.indexOf("/Android/");
                            if (idx > 0) {
                                String root = p.substring(0, idx);
                                paths.add(root);
                                File sdMusic = new File(root, "Music");
                                if (sdMusic.exists()) paths.add(sdMusic.getAbsolutePath());
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}

            // 4. Scan /storage directly on Android 10 (FiiO M11S)
            try {
                File storageRoot = new File("/storage");
                if (storageRoot.exists() && storageRoot.isDirectory()) {
                    File[] sub = storageRoot.listFiles();
                    if (sub != null) {
                        for (File s : sub) {
                            if (s.isDirectory() && !s.getName().equals("self") && !s.getName().equals("knox-emulated")) {
                                paths.add(s.getAbsolutePath());
                                File m = new File(s, "Music");
                                if (m.exists()) paths.add(m.getAbsolutePath());
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}

            for (String p : paths) {
                array.put(p);
            }
            return array.toString();
        }

        /**
         * Scans a directory recursively for audio files (FLAC, DSD: DSF/DFF, WAV, ALAC, AIFF, MP3, etc.)
         * Returns a JSON array of track metadata descriptors.
         */
        @JavascriptInterface
        public String scanDirectory(String dirPath, int maxFiles) {
            JSONArray results = new JSONArray();
            if (dirPath == null || dirPath.isEmpty()) return results.toString();

            File dir = new File(dirPath);
            if (!dir.exists() || !dir.canRead()) return results.toString();

            int limit = maxFiles > 0 ? maxFiles : 10000;
            List<File> audioFiles = new ArrayList<>();
            scanDirInternal(dir, audioFiles, limit);

            for (File file : audioFiles) {
                try {
                    JSONObject obj = new JSONObject();
                    obj.put("name", file.getName());
                    obj.put("path", file.getAbsolutePath());
                    obj.put("size", file.length());
                    obj.put("lastModified", file.lastModified());
                    results.put(obj);
                } catch (Exception ignored) {}
            }
            return results.toString();
        }

        private void scanDirInternal(File current, List<File> collected, int limit) {
            if (collected.size() >= limit || current == null || !current.exists()) return;
            File[] files = current.listFiles();
            if (files == null) return;

            for (File file : files) {
                if (collected.size() >= limit) break;
                if (file.isDirectory()) {
                    if (!file.getName().startsWith(".")) {
                        scanDirInternal(file, collected, limit);
                    }
                } else {
                    String name = file.getName().toLowerCase(Locale.US);
                    if (name.endsWith(".flac") || name.endsWith(".dsf") || name.endsWith(".dff") ||
                            name.endsWith(".wav") || name.endsWith(".mp3") || name.endsWith(".m4a") ||
                            name.endsWith(".alac") || name.endsWith(".aiff") || name.endsWith(".aif") ||
                            name.endsWith(".ogg") || name.endsWith(".opus") || name.endsWith(".ape") ||
                            name.endsWith(".cue") || name.endsWith(".iso") || name.endsWith(".wma")) {
                        collected.add(file);
                    }
                }
            }
        }

        /**
         * Native HTTP request proxy bridge for JavaScript fetch() calls that need native execution
         * (e.g. Jellyfin POST login /Users/AuthenticateByName, Subsonic, Black Candy POST /api/v1/sessions)
         */
        @JavascriptInterface
        public String httpFetch(String urlString, String method, String headersJson, String body) {
            JSONObject response = new JSONObject();
            try {
                URL url = new URL(urlString);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                if (conn instanceof HttpsURLConnection && isLocalOrPrivateNetwork(url.getHost())) {
                    initTrustAllSsl();
                    if (sTrustAllSslSocketFactory != null) {
                        ((HttpsURLConnection) conn).setSSLSocketFactory(sTrustAllSslSocketFactory);
                        ((HttpsURLConnection) conn).setHostnameVerifier(sTrustAllHostnameVerifier);
                    }
                }
                String m = (method != null && !method.isEmpty()) ? method.toUpperCase(Locale.US) : "GET";
                conn.setRequestMethod(m);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(12000);
                conn.setInstanceFollowRedirects(true);

                if (headersJson != null && !headersJson.isEmpty()) {
                    try {
                        JSONObject h = new JSONObject(headersJson);
                        java.util.Iterator<String> keys = h.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            conn.setRequestProperty(k, h.optString(k));
                        }
                    } catch (Exception ignored) {}
                }

                if (("POST".equals(m) || "PUT".equals(m) || "PATCH".equals(m)) && body != null) {
                    conn.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bytes);
                        os.flush();
                    }
                }

                int code = conn.getResponseCode();
                String msg = conn.getResponseMessage();
                response.put("status", code);
                response.put("statusText", msg != null ? msg : "OK");

                JSONObject respHeaders = new JSONObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && !e.getValue().isEmpty()) {
                        respHeaders.put(e.getKey(), e.getValue().get(0));
                    }
                }
                // Inject CORS headers
                respHeaders.put("Access-Control-Allow-Origin", "*");
                response.put("headers", respHeaders);

                InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (in != null) {
                    try (ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[4096];
                        int r;
                        while ((r = in.read(buf)) != -1) {
                            bos.write(buf, 0, r);
                        }
                        response.put("body", bos.toString("UTF-8"));
                    }
                } else {
                    response.put("body", "");
                }
            } catch (Exception e) {
                try {
                    response.put("status", 500);
                    response.put("statusText", "Native Fetch Error: " + e.getMessage());
                    response.put("error", e.getMessage());
                } catch (Exception ignored) {}
            }
            return response.toString();
        }

        @JavascriptInterface
        public void openAuthInBrowser(String url) {
            if (url != null && !url.isEmpty()) {
                mActivity.runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        mActivity.startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(mActivity, "Cannot open browser: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                });
            }
        }

        @JavascriptInterface
        public void showToast(String message) {
            if (message != null) {
                mActivity.runOnUiThread(() ->
                        Toast.makeText(mActivity, message, Toast.LENGTH_SHORT).show()
                );
            }
        }
    }
}
