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
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioMixerAttributes;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Process;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
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
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
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
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicLong;
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
        mWebView.clearCache(true);
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
        // Disable HTTP disk caching completely for local bundled assets to prevent stale updates on APK upgrade
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // Ensure WebView on FiiO M11S (Android 10) matches physical screen dp bounds (360px viewport) without desktop zoom out
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        mWebView.setClickable(true);
        mWebView.setFocusable(true);

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
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                injectAndroidEnvironmentBridge();
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
                final FrameLayout popupContainer = new FrameLayout(MainActivity.this);
                popupContainer.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                popupContainer.setBackgroundColor(Color.parseColor("#111315"));

                final WebView popupWebView = new WebView(MainActivity.this);
                popupWebView.setLayoutParams(new FrameLayout.LayoutParams(
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

                final boolean[] redirectedExternal = {false};

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
                        Uri uri = request != null ? request.getUrl() : null;
                        if (uri != null) {
                            String urlStr = uri.toString();
                            String host = uri.getHost() != null ? uri.getHost().toLowerCase(Locale.US) : "";
                            String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.US) : "";
                            if (host.contains("developer.microsoft.com") ||
                                    (host.contains("developers.google.com") && path.contains("/oauthplayground")) ||
                                    urlStr.contains("developer.microsoft.com") ||
                                    urlStr.contains("developers.google.com/oauthplayground")) {
                                if (!redirectedExternal[0]) {
                                    redirectedExternal[0] = true;
                                    openExternalBrowser(uri.toString());
                                }
                                if (popupDialog.isShowing()) {
                                    popupDialog.dismiss();
                                }
                                return true;
                            }
                        }
                        return false;
                    }

                    @Override
                    public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                        if (url != null && (url.contains("developer.microsoft.com") || url.contains("developers.google.com/oauthplayground"))) {
                            view.stopLoading();
                            if (!redirectedExternal[0]) {
                                redirectedExternal[0] = true;
                                openExternalBrowser(url);
                            }
                            if (popupDialog.isShowing()) {
                                popupDialog.dismiss();
                            }
                            return;
                        }
                        super.onPageStarted(view, url, favicon);
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

                // Sleek floating top-right dark pill close button ("✕ Đóng") so FiiO M11S users are never trapped in fullscreen OAuth error popups
                float density = getResources().getDisplayMetrics().density;
                TextView closeBtn = new TextView(MainActivity.this);
                closeBtn.setText("✕ Đóng");
                closeBtn.setTextColor(Color.parseColor("#F4F4F6"));
                closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
                closeBtn.setTypeface(Typeface.DEFAULT_BOLD);
                closeBtn.setGravity(Gravity.CENTER);
                int padH = (int) (14 * density);
                int padV = (int) (8 * density);
                closeBtn.setPadding(padH, padV, padH, padV);
                closeBtn.setMinHeight((int) (40 * density));

                GradientDrawable pillBg = new GradientDrawable();
                pillBg.setShape(GradientDrawable.RECTANGLE);
                pillBg.setCornerRadius(999f * density);
                pillBg.setColor(Color.parseColor("#D918181B"));
                pillBg.setStroke(Math.max(1, (int) (1 * density)), Color.parseColor("#4DFFFFFF"));
                closeBtn.setBackground(pillBg);
                closeBtn.setElevation(12f * density);
                closeBtn.setOnClickListener(v -> {
                    if (popupDialog.isShowing()) {
                        popupDialog.dismiss();
                    }
                });

                FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.TOP | Gravity.END);
                int margin = (int) (16 * density);
                closeParams.setMargins(margin, margin, margin, margin);

                popupContainer.addView(popupWebView);
                popupContainer.addView(closeBtn, closeParams);

                popupDialog.setContentView(popupContainer);
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
                "try {" +
                "  if (window.caches) { caches.keys().then(function(ks){ ks.forEach(function(k){ caches.delete(k); }); }); }" +
                "  if (navigator.serviceWorker) { navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }); }" +
                "} catch (e) {}" +
                "if (window.dispatchEvent) { window.dispatchEvent(new CustomEvent('nocturne-native-ready')); }";
        mWebView.evaluateJavascript(js, null);
    }

    /**
     * Opens an external URL in the system default browser (e.g., Chrome for OAuth Playground / Graph Explorer)
     */
    public void openExternalBrowser(String url) {
        if (url == null || url.isEmpty()) return;
        runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                Log.w(TAG, "Cannot open external browser: " + e.getMessage());
                Toast.makeText(MainActivity.this, "Cannot open browser: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
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
        mWebView.post(() -> {
            mWebView.requestFocus();
            mWebView.requestFocusFromTouch();
        });
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
        stopBitPerfectPlayback();
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
            if (mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused())) {
                if (mBitPerfectPlayer.isPlaying()) {
                    mBitPerfectPlayer.pause();
                } else {
                    mBitPerfectPlayer.resume();
                }
            }
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (window.onHardwarePlayPause) { window.onHardwarePlayPause(); } else if (typeof $ !== 'undefined') { $('play-button')?.click(); } else { const b = document.getElementById('play-button'); if (b) b.click(); }", null);
            }
        });
    }

    public void dispatchNextToWeb() {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (window.onHardwareNext) { window.onHardwareNext(); } else if (typeof $ !== 'undefined') { $('next-button')?.click(); } else { const b = document.getElementById('next-button'); if (b) b.click(); }", null);
            }
        });
    }

    public void dispatchPreviousToWeb() {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (window.onHardwarePrevious) { window.onHardwarePrevious(); } else if (typeof $ !== 'undefined') { $('previous-button')?.click(); } else { const b = document.getElementById('previous-button'); if (b) b.click(); }", null);
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
            PlaybackState.Builder psb = new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                            PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                            PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
                    .setState(PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0.0f);
            mMediaSession.setPlaybackState(psb.build());
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

    public static final int FLAG_AUDIOTRACK_DIRECT = 0x1;

    public static boolean isFiioDevice() {
        String mfg = Build.MANUFACTURER != null ? Build.MANUFACTURER.toLowerCase(Locale.US) : "";
        String brand = Build.BRAND != null ? Build.BRAND.toLowerCase(Locale.US) : "";
        String model = Build.MODEL != null ? Build.MODEL.toLowerCase(Locale.US) : "";
        String product = Build.PRODUCT != null ? Build.PRODUCT.toLowerCase(Locale.US) : "";
        return mfg.contains("fiio") || brand.contains("fiio") ||
                model.contains("fiio") || model.contains("m11") || model.contains("m15") || model.contains("m17") ||
                product.contains("fiio") || product.contains("m11");
    }

    public AudioDeviceInfo findPreferredBitPerfectDevice() {
        if (mAudioManager == null) return null;
        AudioDeviceInfo[] devices = mAudioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        if (devices == null) return null;

        // 1st Priority: USB DAC (TYPE_USB_DEVICE or TYPE_USB_HEADSET)
        for (AudioDeviceInfo dev : devices) {
            if (dev.isSink() && (dev.getType() == AudioDeviceInfo.TYPE_USB_DEVICE ||
                    dev.getType() == AudioDeviceInfo.TYPE_USB_HEADSET)) {
                return dev;
            }
        }

        // 2nd Priority: FiiO Internal DAC / 3.5mm / 4.4mm Balanced / Line Out
        for (AudioDeviceInfo dev : devices) {
            if (dev.isSink()) {
                int t = dev.getType();
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                        t == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                        t == AudioDeviceInfo.TYPE_LINE_ANALOG ||
                        t == AudioDeviceInfo.TYPE_LINE_DIGITAL ||
                        t == AudioDeviceInfo.TYPE_AUX_LINE) {
                    return dev;
                }
            }
        }

        // 3rd Priority: Any sink
        for (AudioDeviceInfo dev : devices) {
            if (dev.isSink()) return dev;
        }
        return null;
    }

    public boolean isBitPerfectSupported() {
        if (isFiioDevice()) return true;
        if (Build.VERSION.SDK_INT >= 34) return true;
        if (hasConnectedUsbDac()) return true;

        try {
            AudioFormat format = new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(44100)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build();
            AudioAttributes.Builder builder = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC);
            try {
                builder.setFlags(FLAG_AUDIOTRACK_DIRECT);
            } catch (Throwable ignored) {}
            if (AudioTrack.isDirectPlaybackSupported(format, builder.build())) {
                return true;
            }
        } catch (Throwable ignored) {}

        return true;
    }

    private boolean hasConnectedUsbDac() {
        if (mAudioManager == null) return false;
        AudioDeviceInfo[] devices = mAudioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        if (devices != null) {
            for (AudioDeviceInfo dev : devices) {
                if (dev.isSink() && (dev.getType() == AudioDeviceInfo.TYPE_USB_DEVICE ||
                        dev.getType() == AudioDeviceInfo.TYPE_USB_HEADSET)) {
                    return true;
                }
            }
        }
        return false;
    }

    private String getAudioDeviceTypeName(int type, boolean isFiio) {
        switch (type) {
            case AudioDeviceInfo.TYPE_USB_DEVICE:
                return "USB Audio DAC";
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                return "USB Headset";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                return isFiio ? "FiiO Internal DAC / 3.5mm & 4.4mm Balanced" : "Wired Headphones (3.5mm)";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                return isFiio ? "FiiO Internal DAC / 3.5mm Headset" : "Wired Headset";
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
                return isFiio ? "FiiO Dedicated Line Out (LO)" : "Line Analog Out";
            case AudioDeviceInfo.TYPE_LINE_DIGITAL:
                return isFiio ? "FiiO SPDIF / Coaxial Out" : "Line Digital Out";
            case AudioDeviceInfo.TYPE_AUX_LINE:
                return "Aux Line Out";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                return "Built-in Speaker";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                return "Bluetooth Audio (A2DP)";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                return "Bluetooth SCO";
            case AudioDeviceInfo.TYPE_HEARING_AID:
                return "Hearing Aid";
            case 26: // TYPE_BLE_HEADSET
                return "BLE Headset";
            case 27: // TYPE_BLE_SPEAKER
                return "BLE Speaker";
            default:
                return "Audio Output (" + type + ")";
        }
    }

    public String getAudioOutputDeviceInfo() {
        JSONObject root = new JSONObject();
        try {
            boolean isFiio = isFiioDevice();
            boolean bitPerfectSupported = isBitPerfectSupported();
            boolean hasUsb = false;
            String usbDacName = "";
            boolean hasWired = false;
            boolean hasFiioDac = false;

            root.put("isBitPerfectSupported", bitPerfectSupported);
            root.put("isFiioDevice", isFiio);
            root.put("deviceManufacturer", Build.MANUFACTURER);
            root.put("deviceBrand", Build.BRAND);
            root.put("deviceModel", Build.MODEL);
            root.put("deviceProduct", Build.PRODUCT);
            root.put("androidSdk", Build.VERSION.SDK_INT);

            JSONArray devicesArray = new JSONArray();
            AudioDeviceInfo preferred = findPreferredBitPerfectDevice();

            if (mAudioManager != null) {
                AudioDeviceInfo[] devices = mAudioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                if (devices != null) {
                    for (AudioDeviceInfo dev : devices) {
                        if (!dev.isSink()) continue;

                        JSONObject d = new JSONObject();
                        int type = dev.getType();
                        CharSequence name = dev.getProductName();
                        String nameStr = name != null ? name.toString() : "";

                        boolean isUsbType = (type == AudioDeviceInfo.TYPE_USB_DEVICE || type == AudioDeviceInfo.TYPE_USB_HEADSET);
                        boolean isWiredType = (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                                type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                                type == AudioDeviceInfo.TYPE_LINE_ANALOG ||
                                type == AudioDeviceInfo.TYPE_LINE_DIGITAL ||
                                type == AudioDeviceInfo.TYPE_AUX_LINE);
                        boolean isFiioInternal = isFiio && isWiredType;

                        if (isUsbType) {
                            hasUsb = true;
                            if (usbDacName.isEmpty()) usbDacName = nameStr;
                        }
                        if (isWiredType) hasWired = true;
                        if (isFiioInternal) hasFiioDac = true;

                        d.put("id", dev.getId());
                        d.put("type", type);
                        d.put("typeName", getAudioDeviceTypeName(type, isFiio));
                        d.put("productName", nameStr);
                        d.put("isUsb", isUsbType);
                        d.put("isFiioInternalDac", isFiioInternal);
                        d.put("isPreferred", preferred != null && preferred.getId() == dev.getId());

                        // Sample rates
                        JSONArray rates = new JSONArray();
                        int[] devRates = dev.getSampleRates();
                        if (devRates != null && devRates.length > 0) {
                            for (int r : devRates) rates.put(r);
                        } else if (isFiioInternal) {
                            for (int r : new int[]{44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000}) {
                                rates.put(r);
                            }
                        }
                        d.put("sampleRates", rates);

                        // Channel counts
                        JSONArray chs = new JSONArray();
                        int[] devChs = dev.getChannelCounts();
                        if (devChs != null && devChs.length > 0) {
                            for (int c : devChs) chs.put(c);
                        } else {
                            chs.put(2);
                        }
                        d.put("channelCounts", chs);

                        devicesArray.put(d);
                    }
                }
            }

            root.put("hasUsbDac", hasUsb);
            root.put("usbDacName", usbDacName);
            root.put("hasWiredHeadphones", hasWired);
            root.put("hasFiioInternalDac", hasFiioDac || (isFiio && hasWired));
            root.put("devices", devicesArray);

            if (preferred != null) {
                JSONObject prefObj = new JSONObject();
                prefObj.put("id", preferred.getId());
                prefObj.put("typeName", getAudioDeviceTypeName(preferred.getType(), isFiio));
                prefObj.put("productName", preferred.getProductName() != null ? preferred.getProductName().toString() : "");
                prefObj.put("isUsb", preferred.getType() == AudioDeviceInfo.TYPE_USB_DEVICE || preferred.getType() == AudioDeviceInfo.TYPE_USB_HEADSET);
                prefObj.put("isFiioInternalDac", isFiio && (preferred.getType() == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || preferred.getType() == AudioDeviceInfo.TYPE_WIRED_HEADSET));
                root.put("preferredDevice", prefObj);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error generating audio output device info: " + e.getMessage(), e);
        }
        return root.toString();
    }

    @androidx.annotation.RequiresApi(34)
    private static class Api34AudioHelper {
        public static boolean setPreferredMixerBitPerfect(AudioManager am, AudioAttributes attrs, AudioDeviceInfo device, AudioFormat format) {
            try {
                AudioMixerAttributes mixerAttr = new AudioMixerAttributes.Builder(format)
                        .setMixerBehavior(AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT)
                        .build();
                return am.setPreferredMixerAttributes(attrs, device, mixerAttr);
            } catch (Throwable t) {
                Log.w(TAG, "setPreferredMixerAttributes failed: " + t.getMessage());
                return false;
            }
        }

        public static void clearPreferredMixer(AudioManager am, AudioAttributes attrs, AudioDeviceInfo device) {
            try {
                am.clearPreferredMixerAttributes(attrs, device);
            } catch (Throwable ignored) {}
        }
    }

    public class BitPerfectAudioPlayer {
        private final Object mPauseLock = new Object();
        private volatile boolean mIsPlaying = false;
        private volatile boolean mIsPaused = false;
        private volatile boolean mIsStopped = false;
        private final AtomicLong mSeekTargetUs = new AtomicLong(-1);
        private final AtomicLong mCurrentPositionMs = new AtomicLong(0);
        private final AtomicLong mDurationMs = new AtomicLong(0);

        private Thread mPlaybackThread = null;
        private AudioTrack mAudioTrack = null;
        private boolean mPreferredMixerAttributesSet = false;
        private String mCurrentTrackTitle = "";
        private String mCurrentTrackArtist = "";
        private String mCurrentTrackAlbum = "";

        public synchronized boolean start(String urlOrPath, int sampleRate, int bitDepth) {
            stop();

            if (urlOrPath == null || urlOrPath.trim().isEmpty()) {
                Log.e(TAG, "BitPerfect: Cannot start playback with null or empty URL/path");
                return false;
            }

            mIsStopped = false;
            mIsPaused = false;
            mIsPlaying = true;
            mSeekTargetUs.set(-1);
            mCurrentPositionMs.set(0);
            mDurationMs.set(0);

            acquireWakeLock();
            requestAudioFocus();

            // Derive display title from file name
            try {
                String fileName = new File(urlOrPath).getName();
                if (fileName.contains("?")) fileName = fileName.substring(0, fileName.indexOf('?'));
                int dot = fileName.lastIndexOf('.');
                if (dot > 0) fileName = fileName.substring(0, dot);
                mCurrentTrackTitle = fileName.replace('_', ' ');
                mCurrentTrackArtist = isFiioDevice() ? "FiiO Bit-Perfect Engine" : "Bit-Perfect Direct Audio";
                mCurrentTrackAlbum = "Direct Bit-Perfect Playback";
                updateMediaNotification(mCurrentTrackTitle, mCurrentTrackArtist, mCurrentTrackAlbum, true);
            } catch (Exception ignored) {}

            mPlaybackThread = new Thread(() -> {
                Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
                runPlaybackLoop(urlOrPath, sampleRate, bitDepth);
            }, "BitPerfectAudioThread");
            mPlaybackThread.start();

            return true;
        }

        public void pause() {
            synchronized (mPauseLock) {
                mIsPaused = true;
                mPauseLock.notifyAll();
            }
            if (mAudioTrack != null && mAudioTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                try {
                    mAudioTrack.pause();
                } catch (Exception ignored) {}
            }
            updateMediaNotification(mCurrentTrackTitle, mCurrentTrackArtist, mCurrentTrackAlbum, false);
        }

        public void resume() {
            synchronized (mPauseLock) {
                mIsPaused = false;
                mPauseLock.notifyAll();
            }
            if (mAudioTrack != null && mAudioTrack.getPlayState() == AudioTrack.PLAYSTATE_PAUSED) {
                try {
                    mAudioTrack.play();
                } catch (Exception ignored) {}
            }
            updateMediaNotification(mCurrentTrackTitle, mCurrentTrackArtist, mCurrentTrackAlbum, true);
        }

        public void seek(long positionMs) {
            mSeekTargetUs.set(Math.max(0, positionMs * 1000L));
            synchronized (mPauseLock) {
                mPauseLock.notifyAll();
            }
        }

        public synchronized void stop() {
            mIsStopped = true;
            synchronized (mPauseLock) {
                mIsPaused = false;
                mPauseLock.notifyAll();
            }
            if (mPlaybackThread != null) {
                try {
                    mPlaybackThread.interrupt();
                    mPlaybackThread.join(800);
                } catch (InterruptedException ignored) {}
                mPlaybackThread = null;
            }
            if (mAudioTrack != null) {
                try {
                    mAudioTrack.stop();
                    mAudioTrack.release();
                } catch (Exception ignored) {}
                mAudioTrack = null;
            }
            mIsPlaying = false;
            mIsPaused = false;
            cancelMediaNotification();
            releaseWakeLock();
            abandonAudioFocus();
        }

        public boolean isPlaying() {
            return mIsPlaying && !mIsPaused;
        }

        public boolean isPaused() {
            return mIsPaused;
        }

        public long getPositionMs() {
            return mCurrentPositionMs.get();
        }

        public long getDurationMs() {
            return mDurationMs.get();
        }

        private void runPlaybackLoop(String urlOrPath, int requestedSampleRate, int requestedBitDepth) {
            MediaExtractor extractor = new MediaExtractor();
            MediaCodec decoder = null;
            AudioTrack track = null;
            AudioDeviceInfo preferredDevice = null;
            AudioAttributes audioAttributes = null;

            try {
                // 1. Resolve source
                String resolvedPath = urlOrPath;
                if (resolvedPath.contains("local-media?path=")) {
                    int pIdx = resolvedPath.indexOf("path=");
                    resolvedPath = resolvedPath.substring(pIdx + 5);
                    int amp = resolvedPath.indexOf('&');
                    if (amp >= 0) resolvedPath = resolvedPath.substring(0, amp);
                    try {
                        resolvedPath = URLDecoder.decode(resolvedPath, StandardCharsets.UTF_8.name());
                    } catch (Exception ignored) {}
                }
                if (resolvedPath.startsWith("file://")) {
                    try {
                        resolvedPath = Uri.parse(resolvedPath).getPath();
                    } catch (Exception ignored) {}
                }

                File localFile = new File(resolvedPath);
                if (localFile.exists() && localFile.canRead()) {
                    try (FileInputStream fis = new FileInputStream(localFile)) {
                        extractor.setDataSource(fis.getFD());
                    } catch (Exception fallback) {
                        extractor.setDataSource(resolvedPath);
                    }
                } else if (resolvedPath.startsWith("content://")) {
                    extractor.setDataSource(MainActivity.this, Uri.parse(resolvedPath), null);
                } else {
                    extractor.setDataSource(resolvedPath);
                }

                // 2. Locate audio track
                int audioTrackIdx = -1;
                MediaFormat format = null;
                for (int i = 0; i < extractor.getTrackCount(); i++) {
                    MediaFormat f = extractor.getTrackFormat(i);
                    String mime = f.getString(MediaFormat.KEY_MIME);
                    if (mime != null && mime.startsWith("audio/")) {
                        audioTrackIdx = i;
                        format = f;
                        break;
                    }
                }

                if (audioTrackIdx < 0 || format == null) {
                    Log.e(TAG, "BitPerfect: No audio stream found in source: " + urlOrPath);
                    return;
                }

                extractor.selectTrack(audioTrackIdx);

                int sampleRate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE) ?
                        format.getInteger(MediaFormat.KEY_SAMPLE_RATE) : (requestedSampleRate > 0 ? requestedSampleRate : 44100);
                int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ?
                        format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;
                long durUs = format.containsKey(MediaFormat.KEY_DURATION) ?
                        format.getLong(MediaFormat.KEY_DURATION) : 0;
                mDurationMs.set(durUs / 1000);

                // 3. Create and configure decoder
                String mime = format.getString(MediaFormat.KEY_MIME);
                decoder = MediaCodec.createDecoderByType(mime);
                decoder.configure(format, null, null, 0);
                decoder.start();

                // 4. Build AudioAttributes with FLAG_AUDIOTRACK_DIRECT (flags = 0x1)
                AudioAttributes.Builder attrBuilder = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC);
                try {
                    attrBuilder.setFlags(FLAG_AUDIOTRACK_DIRECT);
                } catch (Throwable t) {
                    Log.w(TAG, "AudioAttributes.setFlags(FLAG_AUDIOTRACK_DIRECT) failed: " + t.getMessage());
                }
                audioAttributes = attrBuilder.build();

                // 5. Build AudioTrack
                int channelMask = (channels == 1) ? AudioFormat.CHANNEL_OUT_MONO : AudioFormat.CHANNEL_OUT_STEREO;
                int pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;
                if (requestedBitDepth == 24 && Build.VERSION.SDK_INT >= 31) {
                    pcmEncoding = AudioFormat.ENCODING_PCM_24BIT_PACKED;
                } else if (requestedBitDepth == 32 && Build.VERSION.SDK_INT >= 31) {
                    pcmEncoding = AudioFormat.ENCODING_PCM_32BIT;
                }

                AudioFormat audioFormat = new AudioFormat.Builder()
                        .setEncoding(pcmEncoding)
                        .setSampleRate(sampleRate)
                        .setChannelMask(channelMask)
                        .build();

                int minBufSize = AudioTrack.getMinBufferSize(sampleRate, channelMask, pcmEncoding);
                if (minBufSize <= 0) {
                    minBufSize = sampleRate * channels * 4;
                }
                int bufferSize = Math.max(minBufSize * 4, 131072);

                try {
                    track = new AudioTrack.Builder()
                            .setAudioAttributes(audioAttributes)
                            .setAudioFormat(audioFormat)
                            .setBufferSizeInBytes(bufferSize)
                            .setTransferMode(AudioTrack.MODE_STREAM)
                            .build();
                } catch (Throwable t) {
                    Log.w(TAG, "Direct AudioTrack build failed, falling back to standard attributes: " + t.getMessage());
                    AudioAttributes fallbackAttrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build();
                    track = new AudioTrack.Builder()
                            .setAudioAttributes(fallbackAttrs)
                            .setAudioFormat(audioFormat)
                            .setBufferSizeInBytes(bufferSize)
                            .setTransferMode(AudioTrack.MODE_STREAM)
                            .build();
                }

                mAudioTrack = track;

                // 6. Audio output device routing
                preferredDevice = findPreferredBitPerfectDevice();
                if (preferredDevice != null && track != null) {
                    boolean devOk = track.setPreferredDevice(preferredDevice);
                    Log.i(TAG, "BitPerfect: AudioTrack.setPreferredDevice(" + preferredDevice.getProductName() + ", type=" + preferredDevice.getType() + "): " + devOk);
                }

                // 7. For Android 14+ (API 34+), call AudioTrack.setBitPerfectMode(AudioTrack.BIT_PERFECT_PLAYBACK_MODE_AUTO) via reflection or SDK check
                if (Build.VERSION.SDK_INT >= 34 && track != null) {
                    try {
                        Method setBitPerfectMode = AudioTrack.class.getMethod("setBitPerfectMode", int.class);
                        int autoMode = 1; // AudioTrack.BIT_PERFECT_PLAYBACK_MODE_AUTO
                        try {
                            Field f = AudioTrack.class.getField("BIT_PERFECT_PLAYBACK_MODE_AUTO");
                            autoMode = f.getInt(null);
                        } catch (Throwable ignored) {}
                        setBitPerfectMode.invoke(track, autoMode);
                        Log.i(TAG, "BitPerfect: Invoked AudioTrack.setBitPerfectMode(" + autoMode + ") successfully.");
                    } catch (Throwable t1) {
                        try {
                            Method m2 = AudioTrack.class.getMethod("setBitPerfectPlaybackMode", int.class);
                            m2.invoke(track, 1);
                            Log.i(TAG, "BitPerfect: Invoked AudioTrack.setBitPerfectPlaybackMode(1) successfully.");
                        } catch (Throwable t2) {
                            Log.d(TAG, "BitPerfect: setBitPerfectMode reflection not available: " + t1.getMessage());
                        }
                    }

                    // Set preferred mixer attributes on AudioManager for USB DAC
                    if (preferredDevice != null && (preferredDevice.getType() == AudioDeviceInfo.TYPE_USB_DEVICE ||
                            preferredDevice.getType() == AudioDeviceInfo.TYPE_USB_HEADSET)) {
                        mPreferredMixerAttributesSet = Api34AudioHelper.setPreferredMixerBitPerfect(
                                mAudioManager, audioAttributes, preferredDevice, audioFormat);
                    }
                }

                // 8. Playback loop
                track.play();
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                boolean sawInputEOS = false;
                boolean sawOutputEOS = false;
                final long TIMEOUT_US = 10000;

                while (!mIsStopped && !sawOutputEOS) {
                    // Check pause
                    synchronized (mPauseLock) {
                        while (mIsPaused && !mIsStopped) {
                            if (track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                                track.pause();
                            }
                            try {
                                mPauseLock.wait();
                            } catch (InterruptedException e) {
                                break;
                            }
                        }
                    }
                    if (mIsStopped) break;
                    if (track.getPlayState() == AudioTrack.PLAYSTATE_PAUSED) {
                        track.play();
                    }

                    // Check seek
                    long seekUs = mSeekTargetUs.getAndSet(-1);
                    if (seekUs >= 0) {
                        try {
                            extractor.seekTo(seekUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
                            decoder.flush();
                            track.flush();
                            sawInputEOS = false;
                        } catch (Exception e) {
                            Log.w(TAG, "BitPerfect: Seek error: " + e.getMessage());
                        }
                    }

                    // Feed input buffer
                    if (!sawInputEOS) {
                        int inIndex = decoder.dequeueInputBuffer(TIMEOUT_US);
                        if (inIndex >= 0) {
                            ByteBuffer inBuf = decoder.getInputBuffer(inIndex);
                            if (inBuf != null) {
                                inBuf.clear();
                                int sampleSize = extractor.readSampleData(inBuf, 0);
                                if (sampleSize < 0) {
                                    decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                    sawInputEOS = true;
                                } else {
                                    long ptsUs = extractor.getSampleTime();
                                    decoder.queueInputBuffer(inIndex, 0, sampleSize, ptsUs, 0);
                                    extractor.advance();
                                }
                            }
                        }
                    }

                    // Dequeue output buffer
                    int outIndex = decoder.dequeueOutputBuffer(info, TIMEOUT_US);
                    if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        MediaFormat newFormat = decoder.getOutputFormat();
                        Log.i(TAG, "BitPerfect: Decoder output format changed: " + newFormat);
                        int newRate = newFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE) ?
                                newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) : sampleRate;
                        int newCh = newFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ?
                                newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : channels;
                        int newEncoding = pcmEncoding;
                        if (newFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                            newEncoding = newFormat.getInteger(MediaFormat.KEY_PCM_ENCODING);
                        }

                        if (newRate != sampleRate || newCh != channels || newEncoding != pcmEncoding) {
                            sampleRate = newRate;
                            channels = newCh;
                            pcmEncoding = newEncoding;
                            channelMask = (channels == 1) ? AudioFormat.CHANNEL_OUT_MONO : AudioFormat.CHANNEL_OUT_STEREO;

                            try {
                                track.stop();
                                track.release();
                            } catch (Exception ignored) {}

                            audioFormat = new AudioFormat.Builder()
                                    .setEncoding(pcmEncoding)
                                    .setSampleRate(sampleRate)
                                    .setChannelMask(channelMask)
                                    .build();
                            minBufSize = AudioTrack.getMinBufferSize(sampleRate, channelMask, pcmEncoding);
                            if (minBufSize <= 0) minBufSize = sampleRate * channels * 4;
                            bufferSize = Math.max(minBufSize * 4, 131072);

                            try {
                                track = new AudioTrack.Builder()
                                        .setAudioAttributes(audioAttributes)
                                        .setAudioFormat(audioFormat)
                                        .setBufferSizeInBytes(bufferSize)
                                        .setTransferMode(AudioTrack.MODE_STREAM)
                                        .build();
                            } catch (Throwable t) {
                                AudioAttributes fallbackAttrs = new AudioAttributes.Builder()
                                        .setUsage(AudioAttributes.USAGE_MEDIA)
                                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                                        .build();
                                track = new AudioTrack.Builder()
                                        .setAudioAttributes(fallbackAttrs)
                                        .setAudioFormat(audioFormat)
                                        .setBufferSizeInBytes(bufferSize)
                                        .setTransferMode(AudioTrack.MODE_STREAM)
                                        .build();
                            }
                            mAudioTrack = track;
                            if (preferredDevice != null) track.setPreferredDevice(preferredDevice);
                            track.play();
                        }
                    } else if (outIndex >= 0) {
                        if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            sawOutputEOS = true;
                        }
                        ByteBuffer outBuf = decoder.getOutputBuffer(outIndex);
                        if (outBuf != null && info.size > 0 && track != null) {
                            outBuf.position(info.offset);
                            outBuf.limit(info.offset + info.size);
                            track.write(outBuf, info.size, AudioTrack.WRITE_BLOCKING);
                            mCurrentPositionMs.set(info.presentationTimeUs / 1000);
                        }
                        decoder.releaseOutputBuffer(outIndex, false);
                    }
                }

                // If completed naturally (sawOutputEOS)
                if (sawOutputEOS && !mIsStopped) {
                    mWebView.post(() -> {
                        mWebView.evaluateJavascript(
                                "if (typeof window.onBitPerfectPlaybackComplete === 'function') window.onBitPerfectPlaybackComplete(); " +
                                "else if (typeof window.nextTrack === 'function') window.nextTrack(); " +
                                "else { var nb = document.getElementById('next-button'); if (nb) nb.click(); }",
                                null
                        );
                    });
                }

            } catch (Exception e) {
                Log.e(TAG, "BitPerfect: Playback engine error: " + e.getMessage(), e);
            } finally {
                try {
                    if (track != null) {
                        try { track.stop(); } catch (Exception ignored) {}
                        try { track.release(); } catch (Exception ignored) {}
                    }
                    if (mAudioTrack == track) {
                        mAudioTrack = null;
                    }
                } catch (Exception ignored) {}

                try {
                    if (mPreferredMixerAttributesSet && Build.VERSION.SDK_INT >= 34 && preferredDevice != null && mAudioManager != null && audioAttributes != null) {
                        Api34AudioHelper.clearPreferredMixer(mAudioManager, audioAttributes, preferredDevice);
                        mPreferredMixerAttributesSet = false;
                    }
                } catch (Exception ignored) {}

                try {
                    if (decoder != null) {
                        try { decoder.stop(); } catch (Exception ignored) {}
                        try { decoder.release(); } catch (Exception ignored) {}
                    }
                } catch (Exception ignored) {}

                try {
                    extractor.release();
                } catch (Exception ignored) {}

                mIsPlaying = false;
                mIsPaused = false;
                releaseWakeLock();
                abandonAudioFocus();
            }
        }
    }

    private final BitPerfectAudioPlayer mBitPerfectPlayer = new BitPerfectAudioPlayer();

    public boolean startBitPerfectPlayback(String urlOrPath, int sampleRate, int bitDepth) {
        return mBitPerfectPlayer.start(urlOrPath, sampleRate, bitDepth);
    }

    public void pauseBitPerfectPlayback() {
        mBitPerfectPlayer.pause();
    }

    public void resumeBitPerfectPlayback() {
        mBitPerfectPlayer.resume();
    }

    public void seekBitPerfectPlayback(long positionMs) {
        mBitPerfectPlayer.seek(positionMs);
    }

    public void stopBitPerfectPlayback() {
        mBitPerfectPlayer.stop();
    }

    public boolean isBitPerfectPlaying() {
        return mBitPerfectPlayer.isPlaying();
    }

    public long getBitPerfectPosition() {
        return mBitPerfectPlayer.getPositionMs();
    }

    public long getBitPerfectDuration() {
        return mBitPerfectPlayer.getDurationMs();
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

        @JavascriptInterface
        public boolean startBitPerfectPlayback(String urlOrPath, int sampleRate, int bitDepth) {
            return mActivity.startBitPerfectPlayback(urlOrPath, sampleRate, bitDepth);
        }

        @JavascriptInterface
        public void pauseBitPerfectPlayback() {
            mActivity.pauseBitPerfectPlayback();
        }

        @JavascriptInterface
        public void resumeBitPerfectPlayback() {
            mActivity.resumeBitPerfectPlayback();
        }

        @JavascriptInterface
        public void seekBitPerfectPlayback(long positionMs) {
            mActivity.seekBitPerfectPlayback(positionMs);
        }

        @JavascriptInterface
        public void stopBitPerfectPlayback() {
            mActivity.stopBitPerfectPlayback();
        }

        @JavascriptInterface
        public boolean isBitPerfectSupported() {
            return mActivity.isBitPerfectSupported();
        }

        @JavascriptInterface
        public String getAudioOutputDeviceInfo() {
            return mActivity.getAudioOutputDeviceInfo();
        }

        @JavascriptInterface
        public boolean isBitPerfectPlaying() {
            return mActivity.isBitPerfectPlaying();
        }

        @JavascriptInterface
        public long getBitPerfectPosition() {
            return mActivity.getBitPerfectPosition();
        }

        @JavascriptInterface
        public long getBitPerfectDuration() {
            return mActivity.getBitPerfectDuration();
        }
    }
}
