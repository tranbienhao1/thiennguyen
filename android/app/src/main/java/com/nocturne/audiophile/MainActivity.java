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
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.app.ActivityManager;
import android.os.BatteryManager;
import android.provider.Settings;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
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
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.WindowManager;
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
import java.nio.channels.FileChannel;
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
    private WifiManager.WifiLock mWifiLock;
    private AudioManager mAudioManager;
    private AudioFocusRequest mAudioFocusRequest;
    private boolean mHasAudioFocus = false;
    private MediaSession mMediaSession;
    private volatile int mSafeInsetTopDp = 0;
    private volatile int mSafeInsetBottomDp = 0;
    private volatile int mSafeInsetLeftDp = 0;
    private volatile int mSafeInsetRightDp = 0;

    // OTA Web Assets Engine (auto-updates HTML/CSS/JS from GitHub main without reinstalling APK)
    private static final String OTA_PREFS_NAME = "nocturne_ota_prefs";
    private static final String OTA_KEY_ACTIVE_VERSION = "ota_active_version";
    private static final String OTA_KEY_APK_VERSION_CODE = "ota_apk_version_code";
    private static final String OTA_BASE_URL = "https://raw.githubusercontent.com/tranbienhao1/thiennguyen/main/";
    private static final String[] OTA_FILES = new String[] {
            "sw.js",
            "index.html",
            "tailwind.min.css",
            "autoeq-cue.js",
            "cloud-metadata.js",
            "dsd-worker.js",
            "library-tools.js",
            "library-utils.js",
            "lrclib-client.js",
            "lyrics-editor-ui.js",
            "lyrics-utils.js",
            "metadata-ui.js",
            "metadata-utils.js",
            "ui-overlay.js",
            "virtual-scroll.js"
    };
    private final java.util.concurrent.atomic.AtomicBoolean mOtaChecking = new java.util.concurrent.atomic.AtomicBoolean(false);
    private volatile String mOtaPendingVersion = "";
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
        // Only clear WebView HTTP cache when APK version changes so FiiO M11S caches remote covers & starts faster
        try {
            SharedPreferences prefs = getSharedPreferences("nocturne_prefs", Context.MODE_PRIVATE);
            int lastVer = prefs.getInt("last_version_code", -1);
            if (lastVer != BuildConfig.VERSION_CODE) {
                mWebView.clearCache(true);
                prefs.edit().putInt("last_version_code", BuildConfig.VERSION_CODE).apply();
            }
        } catch (Exception ignored) {}
        mProgressBar = findViewById(R.id.loading_indicator);
        if (mProgressBar != null) {
            mProgressBar.setClickable(false);
            mProgressBar.setFocusable(false);
        }

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

        // 7. Request audio, storage & notification permissions (delayed to avoid stealing initial touch focus)
        if (mWebView != null) {
            mWebView.postDelayed(this::requestAppPermissions, 650);
        } else {
            requestAppPermissions();
        }

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

        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                int wifiMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_HIGH_PERF
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                mWifiLock = wm.createWifiLock(wifiMode, "Nocturne:HiResWifiLock");
                mWifiLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            Log.w(TAG, "WifiLock unavailable: " + e.getMessage());
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
                    boolean anyAudioOrStorageGranted = false;
                    if (result != null) {
                        for (Map.Entry<String, Boolean> entry : result.entrySet()) {
                            String perm = entry.getKey();
                            if (Boolean.TRUE.equals(entry.getValue()) && perm != null &&
                                    (perm.contains("READ_MEDIA_AUDIO") || perm.contains("READ_EXTERNAL_STORAGE"))) {
                                anyAudioOrStorageGranted = true;
                                break;
                            }
                        }
                    }
                    if ((anyAudioOrStorageGranted || hasStoragePermission()) && mWebView != null) {
                        mWebView.post(() -> mWebView.evaluateJavascript(
                                "if (window.onAndroidStoragePermissionGranted) window.onAndroidStoragePermissionGranted();",
                                null));
                    }
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
            getContentIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            getContentIntent.putExtra(Intent.EXTRA_MIME_TYPES, audioMimeTypes);

            Intent chooserIntent = Intent.createChooser(getContentIntent, "Chọn nhạc");
            chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
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
            openDocIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
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
                fallbackIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
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
            genericIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
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
        // Local bundled assets are served directly via WebViewAssetLoader (never stale), while LOAD_DEFAULT caches remote album art/thumbnails on FiiO M11S
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Ensure WebView on FiiO M11S (Android 10) matches physical screen dp bounds (360px viewport) without desktop zoom out
        settings.setUseWideViewPort(false);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        mWebView.setClickable(true);
        mWebView.setFocusable(true);
        mWebView.setFocusableInTouchMode(true);
        mWebView.setVerticalScrollBarEnabled(true);
        mWebView.setHorizontalScrollBarEnabled(false);
        mWebView.setScrollContainer(true);
        mWebView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);

        // 9. Hardware acceleration, renderer priority & Legacy Android stability
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                mWebView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            } catch (Throwable ignored) {}
        }
        mWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        mWebView.setBackgroundColor(Color.parseColor("#111315"));

        // 10. Setup AssetLoader with OTA-first + bundled APK fallback (never bricks on offline/error)
        ensureOtaMatchesCurrentApk();
        final WebViewAssetLoader.AssetsPathHandler bundledAssetsHandler = new WebViewAssetLoader.AssetsPathHandler(this);
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", path -> {
                    WebResourceResponse otaRes = serveOtaAssetIfAvailable(path);
                    if (otaRes != null) return otaRes;
                    return bundledAssetsHandler.handle(path);
                })
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

                // Intercept tailwindcss CDN to prevent blocking HTML parsing and syntax crashes in Chromium 74
                if (host != null && host.contains("cdn.tailwindcss.com")) {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    headers.put("Content-Type", "application/javascript");
                    return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK", headers, new ByteArrayInputStream(new byte[0]));
                }

                // Intercept offline remote CDNs so they don't block webview loading for 60-120s
                if (host != null && (host.contains("alcdn.msauth.net") || host.contains("cdn.jsdelivr.net") || host.contains("accounts.google.com"))) {
                    if (!isNetworkConnected()) {
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        return new WebResourceResponse("text/plain", "UTF-8", 200, "OK", headers, new ByteArrayInputStream(new byte[0]));
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
                applySafeAreaInsetsToWebView();
                View root = findViewById(R.id.root_layout);
                if (root != null) {
                    ViewCompat.requestApplyInsets(root);
                }
                mWebView.postDelayed(() -> checkAndDownloadOtaUpdateAsync(false), 4000);
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
                ", isDapCompatible: true, isFiio: " + isFiioDevice() + ", supportsLegacyStorage: " + (Build.VERSION.SDK_INT <= 30) + " };" +
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
            if (density <= 0f) density = 1f;
            mSafeInsetTopDp = Math.round(topPx / density);
            mSafeInsetBottomDp = Math.round(bottomPx / density);
            mSafeInsetLeftDp = Math.round(leftPx / density);
            mSafeInsetRightDp = Math.round(rightPx / density);

            applySafeAreaInsetsToWebView();

            return windowInsets;
        });
    }

    private void applySafeAreaInsetsToWebView() {
        if (mWebView == null) return;
        final String setCssVars = String.format(
                Locale.US,
                "try{document.documentElement.style.setProperty('--safe-inset-top','%dpx');" +
                "document.documentElement.style.setProperty('--safe-inset-bottom','%dpx');" +
                "document.documentElement.style.setProperty('--safe-inset-left','%dpx');" +
                "document.documentElement.style.setProperty('--safe-inset-right','%dpx');}catch(e){}",
                mSafeInsetTopDp, mSafeInsetBottomDp, mSafeInsetLeftDp, mSafeInsetRightDp
        );
        runOnUiThread(() -> {
            if (mWebView != null) {
                try {
                    mWebView.evaluateJavascript(setCssVars, null);
                } catch (Throwable ignored) {}
            }
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
        try {
            if (mWifiLock != null && !mWifiLock.isHeld()) {
                mWifiLock.acquire();
                Log.d(TAG, "Acquired Hi-Res playback WifiLock");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire WifiLock: " + e.getMessage());
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
        try {
            if (mWifiLock != null && mWifiLock.isHeld()) {
                mWifiLock.release();
                Log.d(TAG, "Released Hi-Res playback WifiLock");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to release WifiLock: " + e.getMessage());
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
                            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                                // Smoothly duck volume during GPS/notification chime without pausing
                                if (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()) {
                                    mBitPerfectPlayer.setDucking(true);
                                }
                                if (mWebView != null) {
                                    mWebView.post(() -> mWebView.evaluateJavascript(
                                            "if (typeof window.onAndroidAudioDuck === 'function') window.onAndroidAudioDuck(true);",
                                            null));
                                }
                                break;
                            case AudioManager.AUDIOFOCUS_LOSS:
                            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                                mHasAudioFocus = false;
                                // Only pause native BitPerfectAudioPlayer if actively playing.
                                // NEVER blindly click #play-button on WebView because Chromium WebView
                                // natively requests AUDIOFOCUS_GAIN for HTML5/WebAudio playback, which
                                // triggers AUDIOFOCUS_LOSS here and would self-pause WebView playback!
                                if (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()) {
                                    mBitPerfectPlayer.pause();
                                    if (mWebView != null) {
                                        mWebView.post(() -> mWebView.evaluateJavascript(
                                                "if (window.onNativeBitPerfectStateChange) window.onNativeBitPerfectStateChange(false);",
                                                null));
                                    }
                                }
                                break;
                            case AudioManager.AUDIOFOCUS_GAIN:
                                mHasAudioFocus = true;
                                if (mBitPerfectPlayer != null) {
                                    mBitPerfectPlayer.setDucking(false);
                                }
                                if (mWebView != null) {
                                    mWebView.post(() -> mWebView.evaluateJavascript(
                                            "if (typeof window.onAndroidAudioDuck === 'function') window.onAndroidAudioDuck(false);",
                                            null));
                                }
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
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS ||
                                focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            mHasAudioFocus = false;
                            if (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()) {
                                mBitPerfectPlayer.pause();
                            }
                        } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                            mHasAudioFocus = true;
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
            mWebView.requestFocus();
            boolean psm = false;
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) psm = pm.isPowerSaveMode();
            } catch (Exception ignored) {}
            final boolean isPowerSave = psm;
            mWebView.post(() -> mWebView.evaluateJavascript("if(typeof window.onAndroidAppLifecycle==='function'){window.onAndroidAppLifecycle('foreground');}if(typeof window.onAndroidPowerSaveChanged==='function'){window.onAndroidPowerSaveChanged(" + (isPowerSave ? "true" : "false") + ");}", null));
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && mWebView != null) {
            mWebView.requestFocus();
        }
    }

    private boolean isNetworkConnected() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
                return activeNetwork != null && activeNetwork.isConnected();
            }
        } catch (Exception ignored) {}
        return true;
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep audio playback running smoothly, but let Web pause heavy visualizers to save battery/RAM
        if (mWebView != null) {
            mWebView.post(() -> mWebView.evaluateJavascript("if(typeof window.onAndroidAppLifecycle==='function'){window.onAndroidAppLifecycle('background');}", null));
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            final int trimLevel = level;
            runOnUiThread(() -> {
                if (mWebView != null) {
                    try {
                        mWebView.evaluateJavascript(
                            "if(typeof window.onAndroidLowMemory==='function'){window.onAndroidLowMemory(" + trimLevel + ");}",
                            null
                        );
                        if (trimLevel >= TRIM_MEMORY_RUNNING_CRITICAL) {
                            mWebView.clearCache(false);
                        }
                    } catch (Throwable ignored) {}
                }
            });
        }
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        onTrimMemory(TRIM_MEMORY_COMPLETE);
    }

    @Override
    protected void onDestroy() {
        stopBitPerfectPlayback();
        cancelMediaNotification();
        releaseWakeLock();
        abandonAudioFocus();
        unregisterMediaNotificationReceiver();
        NocturnePlaybackService.sMediaSessionToken = null;
        try {
            Intent stopIntent = new Intent(this, NocturnePlaybackService.class);
            stopIntent.setAction(NocturnePlaybackService.ACTION_STOP);
            startService(stopIntent);
        } catch (Exception ignored) {}
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
     * BoundedContentUriInputStream wraps AssetFileDescriptor + FileInputStream/FileChannel
     * to stream exact byte ranges (HTTP 200 & HTTP 206 Partial Content) from Android 11-15
     * Scoped Storage content:// URIs (MediaStore.Audio.Media & SAF DocumentsProvider).
     */
    public static class BoundedContentUriInputStream extends InputStream {
        private final AssetFileDescriptor mAfd;
        private final FileInputStream mFis;
        private long mRemaining;

        public BoundedContentUriInputStream(@NonNull AssetFileDescriptor afd, long start, long length) throws IOException {
            this.mAfd = afd;
            this.mFis = afd.createInputStream();
            if (start > 0) {
                long targetPos = Math.max(0L, afd.getStartOffset()) + start;
                boolean positioned = false;
                try {
                    FileChannel channel = this.mFis.getChannel();
                    if (channel != null) {
                        channel.position(targetPos);
                        positioned = true;
                    }
                } catch (IOException ignored) {
                    // Pipe-backed ContentProvider does not support FileChannel.position(); fall back to stream skip
                }
                if (!positioned) {
                    long toSkip = start;
                    byte[] skipBuf = new byte[8192];
                    while (toSkip > 0) {
                        long skipped = this.mFis.skip(toSkip);
                        if (skipped > 0) {
                            toSkip -= skipped;
                        } else {
                            int r = this.mFis.read(skipBuf, 0, (int) Math.min(skipBuf.length, toSkip));
                            if (r < 0) break;
                            toSkip -= r;
                        }
                    }
                }
            }
            this.mRemaining = length;
        }

        public BoundedContentUriInputStream(@NonNull ContentResolver resolver, @NonNull Uri contentUri, long start, long length) throws IOException {
            this(openRequiredAssetFd(resolver, contentUri), start, length);
        }

        private static AssetFileDescriptor openRequiredAssetFd(@NonNull ContentResolver resolver, @NonNull Uri contentUri) throws IOException {
            AssetFileDescriptor afd = resolver.openAssetFileDescriptor(contentUri, "r");
            if (afd == null) {
                throw new IOException("Unable to open AssetFileDescriptor for " + contentUri);
            }
            return afd;
        }

        @Override
        public int read() throws IOException {
            if (mRemaining <= 0) return -1;
            int b = mFis.read();
            if (b != -1) mRemaining--;
            return b;
        }

        @Override
        public int read(@NonNull byte[] b, int off, int len) throws IOException {
            if (mRemaining <= 0) return -1;
            int toRead = (int) Math.min(len, mRemaining);
            int bytesRead = mFis.read(b, off, toRead);
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
            try {
                mFis.close();
            } finally {
                try {
                    mAfd.close();
                } catch (IOException ignored) {}
            }
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
        if (lower.endsWith(".m4a") || lower.endsWith(".alac")) return "audio/mp4";
        if (lower.endsWith(".aac")) return "audio/aac";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".opus")) return "audio/opus";
        if (lower.endsWith(".aiff") || lower.endsWith(".aif")) return "audio/aiff";
        if (lower.endsWith(".ape")) return "audio/x-ape";
        if (lower.endsWith(".wma")) return "audio/x-ms-wma";
        return "audio/octet-stream";
    }

    private static Map<String, String> buildLocalMediaCorsHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "*");
        headers.put("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
        headers.put("Access-Control-Max-Age", "86400");
        return headers;
    }

    /**
     * Resolves a MediaStore content:// URI for a filesystem path when direct File access is blocked
     * by Android 11-15 Scoped Storage.
     */
    @Nullable
    public Uri resolveMediaStoreContentUriForPath(@Nullable String filePath) {
        if (filePath == null || filePath.isEmpty()) return null;
        try (Cursor cursor = getContentResolver().query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Audio.Media._ID},
                MediaStore.Audio.Media.DATA + " = ?",
                new String[]{filePath},
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                long id = cursor.getLong(0);
                return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
            }
        } catch (Exception ignored) {}
        return null;
    }

    /**
     * Handles local media streaming for URLs matching:
     * - https://appassets.androidplatform.net/local-media?uri=<encoded_content_uri>&name=<optional_filename>
     * - https://appassets.androidplatform.net/local-media?path=<encoded_path>
     * Implements HTTP 206 Partial Content (Range header: bytes=start-end) support,
     * Content-Range, Content-Length, CORS headers, and proper audio MIME types.
     */
    private WebResourceResponse handleLocalMediaStreaming(WebResourceRequest request) {
        try {
            Uri uri = request.getUrl();
            String method = request.getMethod();
            if (method == null || method.isEmpty()) method = "GET";
            method = method.toUpperCase(Locale.US);

            if ("OPTIONS".equals(method)) {
                return new WebResourceResponse("text/plain", "UTF-8", 200, "OK",
                        buildLocalMediaCorsHeaders(), new ByteArrayInputStream(new byte[0]));
            }

            String uriParam = uri.getQueryParameter("uri");
            String nameParam = uri.getQueryParameter("name");
            String pathParam = uri.getQueryParameter("path");
            if ((pathParam == null || pathParam.isEmpty()) && (uriParam == null || uriParam.isEmpty())) {
                String query = uri.getQuery();
                if (query != null && query.startsWith("path=")) {
                    pathParam = query.substring(5);
                } else if (query != null && query.startsWith("uri=")) {
                    uriParam = query.substring(4);
                }
            }

            if (uriParam != null && !uriParam.isEmpty() && !uriParam.startsWith("content://")) {
                try {
                    String decodedUri = URLDecoder.decode(uriParam, StandardCharsets.UTF_8.name());
                    if (decodedUri.startsWith("content://")) {
                        uriParam = decodedUri;
                    }
                } catch (Exception ignored) {}
            }

            if ((uriParam == null || uriParam.isEmpty()) && pathParam != null && pathParam.startsWith("content://")) {
                uriParam = pathParam;
            }

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

            // 1. Scoped Storage content:// URI streaming (Android 10-15 MediaStore & SAF)
            if (uriParam != null && uriParam.startsWith("content://")) {
                Uri contentUri = Uri.parse(uriParam);
                return streamContentUriResponse(contentUri, nameParam, method, rangeHeader);
            }

            if (pathParam == null || pathParam.isEmpty()) {
                return new WebResourceResponse("text/plain", "UTF-8", 400, "Bad Request", buildLocalMediaCorsHeaders(),
                        new ByteArrayInputStream("Missing path or uri parameter".getBytes(StandardCharsets.UTF_8)));
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

            // Automatic Scoped Storage fallback: if direct File read is blocked on Android 11+, resolve via MediaStore
            if (!file.exists() || !file.isFile() || !file.canRead()) {
                Uri fallbackContentUri = resolveMediaStoreContentUriForPath(file.getAbsolutePath());
                if (fallbackContentUri == null && !file.getAbsolutePath().equals(pathParam)) {
                    fallbackContentUri = resolveMediaStoreContentUriForPath(pathParam);
                }
                if (fallbackContentUri != null) {
                    return streamContentUriResponse(fallbackContentUri, file.getName(), method, rangeHeader);
                }
                Log.w(TAG, "Local media file not found or unreadable: " + file.getAbsolutePath());
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", buildLocalMediaCorsHeaders(),
                        new ByteArrayInputStream(("File not found: " + pathParam).getBytes(StandardCharsets.UTF_8)));
            }

            long fileLength = file.length();
            String mimeType = getAudioMimeType(file.getName());

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
                    Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
                    respHeaders.put("Content-Range", "bytes */" + fileLength);
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

            Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
            respHeaders.put("Content-Type", mimeType);
            respHeaders.put("Content-Length", String.valueOf(contentLength));
            respHeaders.put("Accept-Ranges", "bytes");
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
            return new WebResourceResponse("text/plain", "UTF-8", 500, "Internal Server Error", buildLocalMediaCorsHeaders(),
                    new ByteArrayInputStream(("Stream error: " + e.getMessage()).getBytes(StandardCharsets.UTF_8)));
        }
    }

    private WebResourceResponse streamContentUriResponse(Uri contentUri, @Nullable String nameHint, String method, @Nullable String rangeHeader) throws IOException {
        ContentResolver resolver = getContentResolver();
        AssetFileDescriptor afd = resolver.openAssetFileDescriptor(contentUri, "r");
        if (afd == null) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", buildLocalMediaCorsHeaders(),
                    new ByteArrayInputStream(("Content URI not found: " + contentUri).getBytes(StandardCharsets.UTF_8)));
        }

        long totalLength = afd.getLength();
        if (totalLength < 0 && afd.getParcelFileDescriptor() != null) {
            totalLength = afd.getParcelFileDescriptor().getStatSize();
        }
        if (totalLength < 0) {
            try (Cursor c = resolver.query(contentUri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) {
                    totalLength = c.getLong(0);
                }
            } catch (Exception ignored) {}
        }

        String mimeType = null;
        if (nameHint != null && !nameHint.isEmpty()) {
            String byName = getAudioMimeType(nameHint);
            if (!"audio/octet-stream".equals(byName) && !"application/octet-stream".equals(byName)) {
                mimeType = byName;
            }
        }
        if (mimeType == null) {
            String crMime = resolver.getType(contentUri);
            if (crMime != null && !crMime.isEmpty() && !"application/octet-stream".equals(crMime)) {
                if ("audio/x-flac".equalsIgnoreCase(crMime) || "application/flac".equalsIgnoreCase(crMime) || "application/x-flac".equalsIgnoreCase(crMime)) {
                    mimeType = "audio/flac";
                } else if ("audio/x-wav".equalsIgnoreCase(crMime)) {
                    mimeType = "audio/wav";
                } else if ("audio/x-m4a".equalsIgnoreCase(crMime)) {
                    mimeType = "audio/mp4";
                } else {
                    mimeType = crMime;
                }
            }
        }
        if (mimeType == null) {
            mimeType = getAudioMimeType(contentUri.toString());
        }

        if (totalLength <= 0) {
            Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
            respHeaders.put("Content-Type", mimeType);
            respHeaders.put("Cache-Control", "no-cache");
            if ("HEAD".equals(method)) {
                try { afd.close(); } catch (IOException ignored) {}
                return new WebResourceResponse(mimeType, null, 200, "OK", respHeaders, new ByteArrayInputStream(new byte[0]));
            }
            return new WebResourceResponse(mimeType, null, 200, "OK", respHeaders, afd.createInputStream());
        }

        long start = 0;
        long end = totalLength - 1;
        boolean isRange = false;

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            String rangeValue = rangeHeader.substring(6).trim();
            int dashIndex = rangeValue.indexOf('-');
            try {
                if (dashIndex == 0) {
                    long suffix = Long.parseLong(rangeValue.substring(1).trim());
                    start = Math.max(0, totalLength - suffix);
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
                Log.w(TAG, "Invalid range header for content URI: " + rangeHeader, e);
            }
        }

        if (isRange) {
            if (start < 0 || start > end || start >= totalLength) {
                try { afd.close(); } catch (IOException ignored) {}
                Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
                respHeaders.put("Content-Range", "bytes */" + totalLength);
                return new WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", respHeaders,
                        new ByteArrayInputStream(new byte[0]));
            }
            if (end >= totalLength) {
                end = totalLength - 1;
            }
        }

        long contentLength = end - start + 1;
        int statusCode = isRange ? 206 : 200;
        String statusReason = isRange ? "Partial Content" : "OK";

        Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
        respHeaders.put("Content-Type", mimeType);
        respHeaders.put("Content-Length", String.valueOf(contentLength));
        respHeaders.put("Accept-Ranges", "bytes");
        respHeaders.put("Cache-Control", "no-cache");
        if (isRange) {
            respHeaders.put("Content-Range", String.format(Locale.US, "bytes %d-%d/%d", start, end, totalLength));
        }

        if ("HEAD".equals(method)) {
            try { afd.close(); } catch (IOException ignored) {}
            return new WebResourceResponse(mimeType, null, statusCode, statusReason, respHeaders, new ByteArrayInputStream(new byte[0]));
        }

        InputStream is = new BoundedContentUriInputStream(afd, start, contentLength);
        return new WebResourceResponse(mimeType, null, statusCode, statusReason, respHeaders, is);
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
                keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS ||
                keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ||
                keyCode == KeyEvent.KEYCODE_MEDIA_REWIND;
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
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                dispatchSeekOffsetToWeb(10);
                break;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                dispatchSeekOffsetToWeb(-10);
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
                boolean nowPlaying;
                if (mBitPerfectPlayer.isPlaying()) {
                    mBitPerfectPlayer.pause();
                    nowPlaying = false;
                } else {
                    mBitPerfectPlayer.resume();
                    nowPlaying = true;
                }
                if (mWebView != null) {
                    mWebView.evaluateJavascript(
                            "if (typeof window.onNativeBitPerfectStateChange === 'function') { window.onNativeBitPerfectStateChange(" + (nowPlaying ? "true" : "false") + "); }",
                            null
                    );
                }
                return;
            }
            if (mWebView != null) {
                // Pure ES5 JS (zero optional chaining ?.) so FiiO M11S Chromium 74 WebView executes physical buttons reliably
                mWebView.evaluateJavascript(
                        "if (typeof window.onHardwarePlayPause === 'function') { window.onHardwarePlayPause(); } else { var b = document.getElementById('play-button'); if (b) b.click(); }",
                        null
                );
            }
        });
    }

    public void dispatchNextToWeb() {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript(
                        "if (typeof window.onHardwareNext === 'function') { window.onHardwareNext(); } else { var b = document.getElementById('next-button'); if (b) b.click(); }",
                        null
                );
            }
        });
    }

    public void dispatchPreviousToWeb() {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript(
                        "if (typeof window.onHardwarePrevious === 'function') { window.onHardwarePrevious(); } else { var b = document.getElementById('previous-button'); if (b) b.click(); }",
                        null
                );
            }
        });
    }

    public void dispatchSeekOffsetToWeb(final int deltaSeconds) {
        runOnUiThread(() -> {
            if (mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused())) {
                long targetMs = Math.max(0L, mBitPerfectPlayer.getPositionMs() + (deltaSeconds * 1000L));
                long durMs = mBitPerfectPlayer.getDurationMs();
                if (durMs > 0L) targetMs = Math.min(targetMs, durMs);
                mBitPerfectPlayer.seek(targetMs);
                return;
            }
            if (mWebView != null) {
                mWebView.evaluateJavascript(
                        "if (typeof window.onHardwareSeekOffset === 'function') { window.onHardwareSeekOffset(" + deltaSeconds + "); }",
                        null
                );
            }
        });
    }

    public void dispatchSeekToWeb(final long positionMs) {
        runOnUiThread(() -> {
            if (mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused())) {
                mBitPerfectPlayer.seek(Math.max(0L, positionMs));
                return;
            }
            if (mWebView != null) {
                mWebView.evaluateJavascript(
                        "if (typeof window.onHardwareSeekTo === 'function') { window.onHardwareSeekTo(" + Math.max(0L, positionMs) + "); }",
                        null
                );
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

    private boolean mIsBecomingNoisyRegistered = false;
    private final BroadcastReceiver mBecomingNoisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                try {
                    if (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()) {
                        pauseBitPerfectPlayback();
                    }
                } catch (Exception ignored) {}
                runOnUiThread(() -> {
                    if (mWebView != null) {
                        mWebView.evaluateJavascript("if(typeof window.onAndroidAudioBecomingNoisy==='function'){window.onAndroidAudioBecomingNoisy();}", null);
                    }
                });
            }
        }
    };

    private Object mAudioDeviceCallback = null;

    private void registerAudioHardwareObservers() {
        if (!mIsBecomingNoisyRegistered) {
            try {
                IntentFilter noisyFilter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(mBecomingNoisyReceiver, noisyFilter, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    registerReceiver(mBecomingNoisyReceiver, noisyFilter);
                }
                mIsBecomingNoisyRegistered = true;
            } catch (Exception ignored) {}
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && mAudioManager != null && mAudioDeviceCallback == null) {
            try {
                AudioDeviceCallback cb = new AudioDeviceCallback() {
                    @Override
                    public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                        notifyUsbDacChange(addedDevices, true);
                    }
                    @Override
                    public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
                        notifyUsbDacChange(removedDevices, false);
                    }
                };
                mAudioManager.registerAudioDeviceCallback(cb, new Handler(Looper.getMainLooper()));
                mAudioDeviceCallback = cb;
            } catch (Exception ignored) {}
        }
    }

    private void unregisterAudioHardwareObservers() {
        if (mIsBecomingNoisyRegistered) {
            try { unregisterReceiver(mBecomingNoisyReceiver); } catch (Exception ignored) {}
            mIsBecomingNoisyRegistered = false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && mAudioManager != null && mAudioDeviceCallback instanceof AudioDeviceCallback) {
            try { mAudioManager.unregisterAudioDeviceCallback((AudioDeviceCallback) mAudioDeviceCallback); } catch (Exception ignored) {}
            mAudioDeviceCallback = null;
        }
    }

    private void notifyUsbDacChange(AudioDeviceInfo[] devices, boolean connected) {
        if (devices == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        for (AudioDeviceInfo dev : devices) {
            if (dev == null || !dev.isSink()) continue;
            int t = dev.getType();
            boolean isExternalDac = (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP);
            if (!isExternalDac) continue;
            String rawName = dev.getProductName() != null ? dev.getProductName().toString() : "Audio Output";
            String safeName = rawName.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ");
            final String js = "if(typeof window.onAndroidAudioDeviceChanged==='function'){window.onAndroidAudioDeviceChanged('" + safeName + "'," + (connected ? "true" : "false") + ");}";
            runOnUiThread(() -> { if (mWebView != null) mWebView.evaluateJavascript(js, null); });
            break;
        }
    }

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
        registerAudioHardwareObservers();
    }

    private void unregisterMediaNotificationReceiver() {
        if (mIsMediaReceiverRegistered) {
            try {
                unregisterReceiver(mMediaNotificationReceiver);
            } catch (Exception ignored) {}
            mIsMediaReceiverRegistered = false;
        }
        unregisterAudioHardwareObservers();
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

                @Override
                public void onSeekTo(long pos) {
                    dispatchSeekToWeb(pos);
                }

                @Override
                public void onFastForward() {
                    dispatchSeekOffsetToWeb(10);
                }

                @Override
                public void onRewind() {
                    dispatchSeekOffsetToWeb(-10);
                }
            });
            PlaybackState.Builder psb = new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                            PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                            PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP |
                            PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_FAST_FORWARD |
                            PlaybackState.ACTION_REWIND)
                    .setState(PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0.0f);
            mMediaSession.setPlaybackState(psb.build());
            mMediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
            mMediaSession.setActive(true);
            NocturnePlaybackService.sMediaSessionToken = mMediaSession.getSessionToken();
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
            try {
                Intent svcIntent = new Intent(this, NocturnePlaybackService.class);
                svcIntent.setAction(NocturnePlaybackService.ACTION_START_OR_UPDATE);
                svcIntent.putExtra(NocturnePlaybackService.EXTRA_TITLE, title);
                svcIntent.putExtra(NocturnePlaybackService.EXTRA_ARTIST, artist);
                svcIntent.putExtra(NocturnePlaybackService.EXTRA_ALBUM, album);
                svcIntent.putExtra(NocturnePlaybackService.EXTRA_IS_PLAYING, true);
                ContextCompat.startForegroundService(this, svcIntent);
            } catch (Exception e) {
                Log.w(TAG, "Foreground service start deferred, using standard notification: " + e.getMessage());
                showMediaNotification(title, artist, album, true);
            }
            updateMediaSessionMetadata(title, artist, album, true);
        } else {
            try {
                Intent pauseIntent = new Intent(this, NocturnePlaybackService.class);
                pauseIntent.setAction(NocturnePlaybackService.ACTION_START_OR_UPDATE);
                pauseIntent.putExtra(NocturnePlaybackService.EXTRA_TITLE, title);
                pauseIntent.putExtra(NocturnePlaybackService.EXTRA_ARTIST, artist);
                pauseIntent.putExtra(NocturnePlaybackService.EXTRA_ALBUM, album);
                pauseIntent.putExtra(NocturnePlaybackService.EXTRA_IS_PLAYING, false);
                startService(pauseIntent);
            } catch (Exception bgPauseErr) {
                // On Android 10 (FiiO M11S) with screen off, startService may throw IllegalStateException; fall back to direct notification update
                showMediaNotification(title, artist, album, false);
            }
            updateMediaSessionMetadata(title, artist, album, false);
            releaseWakeLock();
        }
    }

    private void updateMediaSessionMetadata(String title, String artist, String album, boolean isPlaying) {
        if (mMediaSession == null) return;
        try {
            String displayTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Nocturne Audiophile";
            String displayArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "Nocturne Hi-Res Audio";
            PlaybackState.Builder psb = new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                    PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP |
                    PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_FAST_FORWARD |
                    PlaybackState.ACTION_REWIND)
                .setState(isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                    mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused())
                        ? mBitPerfectPlayer.getPositionMs() : PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                    isPlaying ? 1.0f : 0.0f);
            mMediaSession.setPlaybackState(psb.build());
            MediaMetadata.Builder mb = new MediaMetadata.Builder();
            mb.putString(MediaMetadata.METADATA_KEY_TITLE, displayTitle);
            mb.putString(MediaMetadata.METADATA_KEY_ARTIST, displayArtist);
            if (album != null && !album.trim().isEmpty()) {
                mb.putString(MediaMetadata.METADATA_KEY_ALBUM, album.trim());
            }
            mMediaSession.setMetadata(mb.build());
        } catch (Exception ignored) {}
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
        private volatile AudioTrack mAudioTrack = null;
        private boolean mPreferredMixerAttributesSet = false;
        private String mCurrentTrackTitle = "";
        private String mCurrentTrackArtist = "";
        private String mCurrentTrackAlbum = "";

        public synchronized boolean start(String urlOrPath, int sampleRate, int bitDepth) {
            stopInternal(true);

            if (urlOrPath == null || urlOrPath.trim().isEmpty()) {
                Log.e(TAG, "BitPerfect: Cannot start playback with null or empty URL/path");
                stopInternal(false);
                return false;
            }
            String trimmedUrl = urlOrPath.trim();
            if (trimmedUrl.startsWith("blob:") || trimmedUrl.startsWith("data:")) {
                Log.w(TAG, "BitPerfect: Rejecting non-native blob:/data: URL so Web Audio handles playback");
                stopInternal(false);
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

            // Derive display title from file name or ?name= parameter
            try {
                String fileName = null;
                if (trimmedUrl.contains("/local-media?")) {
                    Uri parsedUri = Uri.parse(trimmedUrl);
                    fileName = parsedUri.getQueryParameter("name");
                    if (fileName == null || fileName.isEmpty()) {
                        String p = parsedUri.getQueryParameter("path");
                        if (p != null && !p.isEmpty()) fileName = new File(p).getName();
                    }
                }
                if (fileName == null || fileName.isEmpty()) {
                    fileName = new File(trimmedUrl).getName();
                }
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
                runPlaybackLoop(trimmedUrl, sampleRate, bitDepth);
            }, "BitPerfectAudioThread");
            mPlaybackThread.start();

            return true;
        }

        public void pause() {
            synchronized (mPauseLock) {
                mIsPaused = true;
                mPauseLock.notifyAll();
            }
            AudioTrack track = mAudioTrack;
            if (track != null) {
                try {
                    if (track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                        track.pause();
                    }
                } catch (Exception ignored) {}
            }
            updateMediaNotification(mCurrentTrackTitle, mCurrentTrackArtist, mCurrentTrackAlbum, false);
        }

        public void resume() {
            acquireWakeLock();
            requestAudioFocus();
            synchronized (mPauseLock) {
                mIsPaused = false;
                mPauseLock.notifyAll();
            }
            AudioTrack track = mAudioTrack;
            if (track != null) {
                try {
                    if (track.getPlayState() == AudioTrack.PLAYSTATE_PAUSED) {
                        track.play();
                    }
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

        public void setDucking(boolean ducked) {
            AudioTrack track = mAudioTrack;
            if (track != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    track.setVolume(ducked ? 0.25f : 1.0f);
                } catch (Exception ignored) {}
            }
        }

        public synchronized void stop() {
            stopInternal(false);
        }

        private synchronized void stopInternal(boolean preserveSession) {
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
            if (!preserveSession) {
                cancelMediaNotification();
                releaseWakeLock();
                abandonAudioFocus();
            }
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

        private void notifyBitPerfectFormatToWeb(int actualRate, int actualEncoding, boolean mixerBitPerfect, AudioDeviceInfo dev) {
            final int bits = (actualEncoding == AudioFormat.ENCODING_PCM_FLOAT || actualEncoding == 22) ? 32
                    : (actualEncoding == 21 ? 24 : 16);
            final String devName = (dev != null && dev.getProductName() != null) ? dev.getProductName().toString() : "";
            final String safeDev = devName.replace("\\", "\\\\").replace("'", "\\'");
            final String js = "if(typeof window.onBitPerfectFormatLocked==='function'){window.onBitPerfectFormatLocked("
                    + actualRate + "," + bits + "," + (mixerBitPerfect ? "true" : "false") + ",'" + safeDev + "');}";
            runOnUiThread(() -> {
                if (mWebView != null) {
                    mWebView.evaluateJavascript(js, null);
                }
            });
        }

        private void notifyBitPerfectErrorToWeb(String reason) {
            if (mIsStopped || mWebView == null) return;
            final String safeMsg = (reason != null ? reason : "Bit-Perfect playback error")
                    .replace("\\", "\\\\")
                    .replace("'", "\\'")
                    .replace("\n", " ")
                    .replace("\r", " ");
            mWebView.post(() -> {
                if (mWebView != null) {
                    mWebView.evaluateJavascript(
                            "if (typeof window.onNativeBitPerfectError === 'function') window.onNativeBitPerfectError('" + safeMsg + "');",
                            null
                    );
                }
            });
        }

        private void runPlaybackLoop(String urlOrPath, int requestedSampleRate, int requestedBitDepth) {
            MediaExtractor extractor = new MediaExtractor();
            MediaCodec decoder = null;
            AudioTrack track = null;
            AudioDeviceInfo preferredDevice = null;
            AudioAttributes audioAttributes = null;

            try {
                // 1. Resolve source (supports /local-media?uri=content://..., /local-media?path=..., content://, file://, and http(s)://)
                String resolvedUri = null;
                String resolvedPath = urlOrPath;
                if (resolvedPath.contains("/local-media?")) {
                    try {
                        Uri parsedLocal = Uri.parse(resolvedPath);
                        String qUri = parsedLocal.getQueryParameter("uri");
                        String qPath = parsedLocal.getQueryParameter("path");
                        if (qUri != null && !qUri.isEmpty()) {
                            resolvedUri = qUri;
                        } else if (qPath != null && !qPath.isEmpty()) {
                            if (qPath.startsWith("content://")) {
                                resolvedUri = qPath;
                            } else {
                                resolvedPath = qPath;
                            }
                        }
                    } catch (Exception ignored) {}
                } else if (resolvedPath.contains("local-media?path=")) {
                    int pIdx = resolvedPath.indexOf("path=");
                    resolvedPath = resolvedPath.substring(pIdx + 5);
                    int amp = resolvedPath.indexOf('&');
                    if (amp >= 0) resolvedPath = resolvedPath.substring(0, amp);
                    try {
                        resolvedPath = URLDecoder.decode(resolvedPath, StandardCharsets.UTF_8.name());
                    } catch (Exception ignored) {}
                } else if (resolvedPath.startsWith("content://")) {
                    resolvedUri = resolvedPath;
                }

                if (resolvedUri != null && !resolvedUri.startsWith("content://")) {
                    try {
                        String dec = URLDecoder.decode(resolvedUri, StandardCharsets.UTF_8.name());
                        if (dec.startsWith("content://")) resolvedUri = dec;
                    } catch (Exception ignored) {}
                }

                if (resolvedPath.startsWith("file://")) {
                    try {
                        String parsedFile = Uri.parse(resolvedPath).getPath();
                        if (parsedFile != null) resolvedPath = parsedFile;
                    } catch (Exception ignored) {}
                }

                if (resolvedUri != null && resolvedUri.startsWith("content://")) {
                    extractor.setDataSource(MainActivity.this, Uri.parse(resolvedUri), null);
                } else {
                    File localFile = new File(resolvedPath);
                    if (localFile.exists() && localFile.canRead()) {
                        try (FileInputStream fis = new FileInputStream(localFile)) {
                            extractor.setDataSource(fis.getFD());
                        } catch (Exception fallback) {
                            extractor.setDataSource(resolvedPath);
                        }
                    } else {
                        Uri fallbackMediaUri = resolveMediaStoreContentUriForPath(resolvedPath);
                        if (fallbackMediaUri != null) {
                            extractor.setDataSource(MainActivity.this, fallbackMediaUri, null);
                        } else {
                            extractor.setDataSource(resolvedPath);
                        }
                    }
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
                    notifyBitPerfectErrorToWeb("No audio stream found in source");
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

                // 3. Create and configure decoder (preserve >=24-bit Hi-Res precision via PCM_FLOAT when supported)
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (requestedBitDepth >= 24 && Build.VERSION.SDK_INT >= 24 && !format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                    try {
                        format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_FLOAT);
                    } catch (Throwable ignored) {}
                }
                decoder = MediaCodec.createDecoderByType(mime);
                try {
                    decoder.configure(format, null, null, 0);
                } catch (Throwable hiResConfigErr) {
                    if (Build.VERSION.SDK_INT >= 24 && format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
                    }
                    decoder.configure(format, null, null, 0);
                }
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

                // 5. Build AudioTrack (preserve full 24-bit/32-bit Hi-Res precision via ENCODING_PCM_FLOAT on FiiO M11S Android 10 API 29)
                int channelMask = (channels == 1) ? AudioFormat.CHANNEL_OUT_MONO : AudioFormat.CHANNEL_OUT_STEREO;
                int pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;
                if (requestedBitDepth == 24 && Build.VERSION.SDK_INT >= 31) {
                    pcmEncoding = AudioFormat.ENCODING_PCM_24BIT_PACKED;
                } else if (requestedBitDepth == 32 && Build.VERSION.SDK_INT >= 31) {
                    pcmEncoding = AudioFormat.ENCODING_PCM_32BIT;
                } else if (requestedBitDepth >= 24 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    pcmEncoding = AudioFormat.ENCODING_PCM_FLOAT;
                }

                AudioFormat audioFormat = new AudioFormat.Builder()
                        .setEncoding(pcmEncoding)
                        .setSampleRate(sampleRate)
                        .setChannelMask(channelMask)
                        .build();

                int minBufSize = AudioTrack.getMinBufferSize(sampleRate, channelMask, pcmEncoding);
                if (minBufSize <= 0 && pcmEncoding != AudioFormat.ENCODING_PCM_16BIT) {
                    pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;
                    audioFormat = new AudioFormat.Builder()
                            .setEncoding(pcmEncoding)
                            .setSampleRate(sampleRate)
                            .setChannelMask(channelMask)
                            .build();
                    minBufSize = AudioTrack.getMinBufferSize(sampleRate, channelMask, pcmEncoding);
                }
                if (minBufSize <= 0) {
                    minBufSize = sampleRate * channels * 4;
                }
                boolean fiioHiRes = isFiioDevice() && sampleRate >= 88200;
                int bufferSize = fiioHiRes ? Math.max(minBufSize * 6, 196608) : Math.max(minBufSize * 4, 131072);

                // 6. Resolve preferred DAC device & apply Android 14+ Bit-Perfect Mixer Attributes BEFORE AudioTrack.build()
                preferredDevice = findPreferredBitPerfectDevice();
                if (Build.VERSION.SDK_INT >= 34 && preferredDevice != null &&
                        (preferredDevice.getType() == AudioDeviceInfo.TYPE_USB_DEVICE ||
                         preferredDevice.getType() == AudioDeviceInfo.TYPE_USB_HEADSET)) {
                    mPreferredMixerAttributesSet = Api34AudioHelper.setPreferredMixerBitPerfect(
                            mAudioManager, audioAttributes, preferredDevice, audioFormat);
                    Log.i(TAG, "BitPerfect: Pre-build setPreferredMixerBitPerfect(" + sampleRate + "Hz, enc=" + pcmEncoding + "): " + mPreferredMixerAttributesSet);
                }

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

                if (preferredDevice != null && track != null) {
                    boolean devOk = track.setPreferredDevice(preferredDevice);
                    Log.i(TAG, "BitPerfect: AudioTrack.setPreferredDevice(" + preferredDevice.getProductName() + ", type=" + preferredDevice.getType() + "): " + devOk);
                }
                // Lock AudioTrack software gain to unity (1.0 / 0 dBFS) for zero digital attenuation
                if (track != null) {
                    try { track.setVolume(AudioTrack.getMaxVolume()); } catch (Throwable ignored) {}
                }

                // 7. For Android 14+ (API 34+), also invoke AudioTrack.setBitPerfectMode if exposed
                if (Build.VERSION.SDK_INT >= 34 && track != null) {
                    try {
                        Method setBitPerfectMode = AudioTrack.class.getMethod("setBitPerfectMode", int.class);
                        int autoMode = 1;
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
                        } catch (Throwable ignored) {}
                    }
                }
                notifyBitPerfectFormatToWeb(sampleRate, pcmEncoding, mPreferredMixerAttributesSet, preferredDevice);

                // 8. Playback loop
                track.play();
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                boolean sawInputEOS = false;
                boolean sawOutputEOS = false;
                final long TIMEOUT_US = 10000;
                long lastUiUpdateElapsedMs = 0L;

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
                            boolean fiioHiResRebuild = isFiioDevice() && sampleRate >= 88200;
                            bufferSize = fiioHiResRebuild ? Math.max(minBufSize * 6, 196608) : Math.max(minBufSize * 4, 131072);

                            if (Build.VERSION.SDK_INT >= 34 && preferredDevice != null &&
                                    (preferredDevice.getType() == AudioDeviceInfo.TYPE_USB_DEVICE ||
                                     preferredDevice.getType() == AudioDeviceInfo.TYPE_USB_HEADSET)) {
                                mPreferredMixerAttributesSet = Api34AudioHelper.setPreferredMixerBitPerfect(
                                        mAudioManager, audioAttributes, preferredDevice, audioFormat);
                            }
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
                            try { track.setVolume(AudioTrack.getMaxVolume()); } catch (Throwable ignored) {}
                            notifyBitPerfectFormatToWeb(sampleRate, pcmEncoding, mPreferredMixerAttributesSet, preferredDevice);
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
                            long posMs = Math.max(0L, info.presentationTimeUs / 1000L);
                            mCurrentPositionMs.set(posMs);
                            long nowElapsed = SystemClock.uptimeMillis();
                            if (nowElapsed - lastUiUpdateElapsedMs >= 250L && !mIsStopped && mWebView != null) {
                                lastUiUpdateElapsedMs = nowElapsed;
                                final long reportPosMs = posMs;
                                final long reportDurMs = mDurationMs.get();
                                mWebView.post(() -> {
                                    if (!mIsStopped && mWebView != null) {
                                        mWebView.evaluateJavascript(
                                                "if (typeof window.onNativeBitPerfectPosition === 'function') window.onNativeBitPerfectPosition(" + reportPosMs + ", " + reportDurMs + ");",
                                                null
                                        );
                                    }
                                });
                            }
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
                notifyBitPerfectErrorToWeb(e.getMessage() != null ? e.getMessage() : "Bit-Perfect playback engine error");
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
        public void setKeepScreenOn(boolean enable) {
            mActivity.runOnUiThread(() -> {
                try {
                    if (enable) {
                        mActivity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        mActivity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public void hapticTick() {
            mActivity.runOnUiThread(() -> {
                try {
                    if (mActivity.mWebView != null) {
                        mActivity.mWebView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                    }
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public int getSystemVolumePercent() {
            try {
                if (mActivity.mAudioManager == null) return 70;
                int max = mActivity.mAudioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int cur = mActivity.mAudioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                return max > 0 ? Math.round((cur * 100f) / max) : 70;
            } catch (Exception e) { return 70; }
        }

        @JavascriptInterface
        public void setSystemVolumePercent(int pct) {
            try {
                if (mActivity.mAudioManager == null) return;
                int clamped = Math.max(0, Math.min(100, pct));
                int max = mActivity.mAudioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int target = Math.round((clamped * max) / 100f);
                mActivity.mAudioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public boolean isPowerSaveMode() {
            try {
                PowerManager pm = (PowerManager) mActivity.getSystemService(Context.POWER_SERVICE);
                return pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && pm.isPowerSaveMode();
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean isLowRamDevice() {
            try {
                ActivityManager am = (ActivityManager) mActivity.getSystemService(Context.ACTIVITY_SERVICE);
                return am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && am.isLowRamDevice();
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public int getAvailableMemoryMb() {
            try {
                ActivityManager am = (ActivityManager) mActivity.getSystemService(Context.ACTIVITY_SERVICE);
                if (am == null) return -1;
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                return (int) Math.max(0, mi.availMem / (1024L * 1024L));
            } catch (Exception e) { return -1; }
        }

        @JavascriptInterface
        public boolean shareText(final String title, final String text) {
            if (text == null || text.trim().isEmpty()) return false;
            try {
                mActivity.runOnUiThread(() -> {
                    try {
                        Intent sendIntent = new Intent(Intent.ACTION_SEND);
                        sendIntent.setType("text/plain");
                        if (title != null && !title.isEmpty()) sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                        sendIntent.putExtra(Intent.EXTRA_TEXT, text);
                        mActivity.startActivity(Intent.createChooser(sendIntent, title != null && !title.isEmpty() ? title : "Chia sẻ bài hát"));
                    } catch (Exception ignored) {}
                });
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public String getBatteryInfoJson() {
            try {
                IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent batteryStatus = mActivity.registerReceiver(null, filter);
                if (batteryStatus == null) return "{\"level\":-1,\"charging\":false}";
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int pct = (level >= 0 && scale > 0) ? Math.round((level * 100f) / scale) : -1;
                int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
                return "{\"level\":" + pct + ",\"charging\":" + charging + "}";
            } catch (Exception e) {
                return "{\"level\":-1,\"charging\":false}";
            }
        }

        @JavascriptInterface
        public boolean openAppAudioSettings() {
            try {
                mActivity.runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
                        mActivity.startActivity(intent);
                    } catch (Exception ignored) {}
                });
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public String getAudioOutputRouteName() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && mActivity.mAudioManager != null) {
                    AudioDeviceInfo[] outs = mActivity.mAudioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                    for (AudioDeviceInfo d : outs) {
                        if (d == null) continue;
                        int t = d.getType();
                        if (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET) return "USB DAC";
                    }
                    for (AudioDeviceInfo d : outs) {
                        if (d == null) continue;
                        int t = d.getType();
                        if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_LINE_ANALOG) return "Wired Headphones";
                    }
                    for (AudioDeviceInfo d : outs) {
                        if (d == null) continue;
                        int t = d.getType();
                        if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return "Bluetooth Hi-Res";
                    }
                }
            } catch (Exception ignored) {}
            return "Phone Speaker";
        }

        @JavascriptInterface
        public int getScreenBrightnessPercent() {
            try {
                float b = mActivity.getWindow().getAttributes().screenBrightness;
                if (b < 0f) return -1;
                return Math.max(5, Math.min(100, Math.round(b * 100f)));
            } catch (Exception e) { return -1; }
        }

        @JavascriptInterface
        public void setScreenBrightnessPercent(final int pct) {
            try {
                mActivity.runOnUiThread(() -> {
                    try {
                        android.view.WindowManager.LayoutParams lp = mActivity.getWindow().getAttributes();
                        if (pct < 0) {
                            lp.screenBrightness = android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                        } else {
                            int clamped = Math.max(10, Math.min(100, pct));
                            lp.screenBrightness = clamped / 100f;
                        }
                        mActivity.getWindow().setAttributes(lp);
                    } catch (Exception ignored) {}
                });
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String getDeviceThermalStatus() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    PowerManager pm = (PowerManager) mActivity.getSystemService(Context.POWER_SERVICE);
                    if (pm != null) {
                        int st = pm.getCurrentThermalStatus();
                        if (st >= PowerManager.THERMAL_STATUS_CRITICAL) return "CRITICAL";
                        if (st >= PowerManager.THERMAL_STATUS_SEVERE) return "SEVERE";
                        if (st >= PowerManager.THERMAL_STATUS_MODERATE) return "MODERATE";
                        if (st >= PowerManager.THERMAL_STATUS_LIGHT) return "LIGHT";
                        return "NOMINAL";
                    }
                }
            } catch (Exception ignored) {}
            return "NOMINAL";
        }

        @JavascriptInterface
        public String getAppBuildInfoJson() {
            try {
                android.content.pm.PackageInfo pi = mActivity.getPackageManager().getPackageInfo(mActivity.getPackageName(), 0);
                String vName = pi != null && pi.versionName != null ? pi.versionName.replace("\"", "") : "3.9.13";
                String model = Build.MODEL != null ? Build.MODEL.replace("\"", "") : "Android";
                return "{\"versionName\":\"" + vName + "\",\"sdkInt\":" + Build.VERSION.SDK_INT + ",\"model\":\"" + model + "\"}";
            } catch (Exception e) {
                return "{\"versionName\":\"3.9.13\",\"sdkInt\":" + Build.VERSION.SDK_INT + ",\"model\":\"Android\"}";
            }
        }

        @JavascriptInterface
        public int getNativeOutputSampleRateHz() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && mActivity.mAudioManager != null) {
                    String rate = mActivity.mAudioManager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE);
                    if (rate != null) return Integer.parseInt(rate);
                }
            } catch (Exception ignored) {}
            return 48000;
        }

        @JavascriptInterface
        public int getNativeOutputFramesPerBuffer() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && mActivity.mAudioManager != null) {
                    String frames = mActivity.mAudioManager.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER);
                    if (frames != null) return Integer.parseInt(frames);
                }
            } catch (Exception ignored) {}
            return 256;
        }

        @JavascriptInterface
        public boolean isIgnoringBatteryOptimizations() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PowerManager pm = (PowerManager) mActivity.getSystemService(Context.POWER_SERVICE);
                    return pm != null && pm.isIgnoringBatteryOptimizations(mActivity.getPackageName());
                }
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean openBatteryOptimizationSettings() {
            try {
                mActivity.runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                            mActivity.startActivity(intent);
                        }
                    } catch (Exception ignored) {}
                });
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean isExternalAudioGearConnected() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && mActivity.mAudioManager != null) {
                    AudioDeviceInfo[] outs = mActivity.mAudioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                    for (AudioDeviceInfo d : outs) {
                        if (d == null) continue;
                        int t = d.getType();
                        if (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET ||
                            t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                            t == AudioDeviceInfo.TYPE_LINE_ANALOG || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
                            return true;
                        }
                    }
                }
            } catch (Exception ignored) {}
            return false;
        }

        @JavascriptInterface
        public boolean isAudioFocusHeld() {
            return mActivity.mHasAudioFocus;
        }

        @JavascriptInterface
        public int getAudioLatencyEstimateMs() {
            try {
                int rate = getNativeOutputSampleRateHz();
                int frames = getNativeOutputFramesPerBuffer();
                if (rate > 0 && frames > 0) {
                    return Math.max(1, Math.round((frames * 1000f) / rate));
                }
            } catch (Exception ignored) {}
            return -1;
        }

        @JavascriptInterface
        public String getDeviceAudioTelemetry() {
            try {
                boolean hasUsbDac = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && mActivity.mAudioManager != null) {
                    AudioDeviceInfo[] outs = mActivity.mAudioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                    for (AudioDeviceInfo d : outs) {
                        if (d != null && (d.getType() == AudioDeviceInfo.TYPE_USB_DEVICE || d.getType() == AudioDeviceInfo.TYPE_USB_HEADSET)) {
                            hasUsbDac = true;
                            break;
                        }
                    }
                }
                return "{\"sdk\":" + Build.VERSION.SDK_INT + ",\"hasUsbDac\":" + hasUsbDac + ",\"bitPerfectApi34\":" + (Build.VERSION.SDK_INT >= 34) + "}";
            } catch (Exception e) {
                return "{\"sdk\":" + Build.VERSION.SDK_INT + "}";
            }
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
         * Queries MediaStore.Audio.Media.EXTERNAL_CONTENT_URI via ContentResolver so Android 11-15
         * Scoped Storage devices (targetSdk 35) discover all audio files with content:// URIs
         * and native ID3/FLAC/Vorbis tags without relying on blocked File.listFiles().
         */
        @JavascriptInterface
        public String scanMediaStoreAudio(int maxFiles) {
            JSONArray results = new JSONArray();
            int limit = maxFiles > 0 ? maxFiles : 10000;
            String[] projection = new String[]{
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.SIZE,
                    MediaStore.Audio.Media.MIME_TYPE,
                    MediaStore.Audio.Media.DATA,
                    MediaStore.Audio.Media.TRACK,
                    MediaStore.Audio.Media.YEAR
            };
            String sortOrder = MediaStore.Audio.Media.DATE_ADDED + " DESC";
            try (Cursor cursor = mActivity.getContentResolver().query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    sortOrder
            )) {
                if (cursor != null) {
                    int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int nameCol = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);
                    int titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
                    int artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                    int albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
                    int durCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
                    int sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
                    int mimeCol = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE);
                    int dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
                    int trackCol = cursor.getColumnIndex(MediaStore.Audio.Media.TRACK);
                    int yearCol = cursor.getColumnIndex(MediaStore.Audio.Media.YEAR);

                    int count = 0;
                    while (cursor.moveToNext() && count < limit) {
                        long id = cursor.getLong(idCol);
                        String displayName = nameCol >= 0 ? cursor.getString(nameCol) : null;
                        String dataPath = dataCol >= 0 ? cursor.getString(dataCol) : null;
                        String mimeType = mimeCol >= 0 ? cursor.getString(mimeCol) : null;
                        long size = sizeCol >= 0 ? cursor.getLong(sizeCol) : 0L;
                        if (size <= 0) continue;

                        if ((displayName == null || displayName.isEmpty()) && dataPath != null && !dataPath.isEmpty()) {
                            displayName = new File(dataPath).getName();
                        }
                        if (displayName == null || displayName.isEmpty()) {
                            displayName = "Track_" + id + ".mp3";
                        }

                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
                        String title = titleCol >= 0 ? cursor.getString(titleCol) : null;
                        String artist = artistCol >= 0 ? cursor.getString(artistCol) : null;
                        String album = albumCol >= 0 ? cursor.getString(albumCol) : null;
                        long durationMs = durCol >= 0 ? cursor.getLong(durCol) : 0L;
                        int rawTrack = trackCol >= 0 ? cursor.getInt(trackCol) : 0;
                        int year = yearCol >= 0 ? cursor.getInt(yearCol) : 0;

                        JSONObject obj = new JSONObject();
                        obj.put("uri", contentUri.toString());
                        obj.put("name", displayName);
                        obj.put("title", title != null ? title : "");
                        obj.put("artist", artist != null ? artist : "");
                        obj.put("album", album != null ? album : "");
                        obj.put("duration", durationMs > 0 ? (durationMs / 1000.0) : 0);
                        obj.put("size", size);
                        obj.put("mimeType", mimeType != null ? mimeType : getAudioMimeType(displayName));
                        obj.put("path", dataPath != null ? dataPath : "");
                        if (rawTrack > 0) {
                            int discNo = rawTrack >= 1000 ? (rawTrack / 1000) : 0;
                            int trackNo = rawTrack >= 1000 ? (rawTrack % 1000) : rawTrack;
                            if (trackNo > 0) obj.put("trackNumber", trackNo);
                            if (discNo > 0) obj.put("discNumber", discNo);
                        }
                        if (year > 0) obj.put("year", year);
                        results.put(obj);
                        count++;
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "scanMediaStoreAudio error: " + e.getMessage(), e);
            }
            return results.toString();
        }

        /**
         * Scans a directory recursively for audio files (FLAC, DSD: DSF/DFF, WAV, ALAC, AIFF, MP3, etc.)
         * Returns a JSON array of track metadata descriptors.
         */
        @JavascriptInterface
        public String scanDirectory(String dirPath, int maxFiles) {
            JSONArray results = new JSONArray();
            try {
                if (dirPath == null || dirPath.isEmpty()) return results.toString();

                File dir = new File(dirPath);
                if (!dir.exists() || !dir.canRead()) return results.toString();

                int limit = maxFiles > 0 ? maxFiles : 10000;
                List<File> audioFiles = new ArrayList<>();
                Set<String> visitedDirs = new HashSet<>();
                scanDirInternal(dir, audioFiles, limit, 0, visitedDirs);

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
            } catch (Throwable t) {
                Log.w(TAG, "scanDirectory safe catch for " + dirPath + ": " + t.getMessage());
            }
            return results.toString();
        }

        private void scanDirInternal(File current, List<File> collected, int limit, int depth, Set<String> visitedDirs) {
            if (depth > 16 || collected.size() >= limit || current == null || !current.exists()) return;
            try {
                String canonical = current.getCanonicalPath();
                if (!visitedDirs.add(canonical)) return;
            } catch (Exception ignored) {}

            File[] files;
            try {
                files = current.listFiles();
            } catch (Throwable t) {
                return;
            }
            if (files == null) return;

            for (File file : files) {
                if (collected.size() >= limit) break;
                if (file == null) continue;
                try {
                    if (file.isDirectory()) {
                        String dName = file.getName();
                        if (dName == null || dName.startsWith(".") ||
                                "Android".equals(dName) || "proc".equals(dName) || "sys".equals(dName)) {
                            continue;
                        }
                        scanDirInternal(file, collected, limit, depth + 1, visitedDirs);
                    } else {
                        String name = file.getName().toLowerCase(Locale.US);
                        if (name.endsWith(".flac") || name.endsWith(".dsf") || name.endsWith(".dff") ||
                                name.endsWith(".wav") || name.endsWith(".mp3") || name.endsWith(".m4a") ||
                                name.endsWith(".alac") || name.endsWith(".aiff") || name.endsWith(".aif") ||
                                name.endsWith(".ogg") || name.endsWith(".opus") || name.endsWith(".ape") ||
                                name.endsWith(".wv") || name.endsWith(".aac") || name.endsWith(".mka") ||
                                name.endsWith(".cue") || name.endsWith(".iso") || name.endsWith(".wma")) {
                            collected.add(file);
                        }
                    }
                } catch (Throwable ignored) {}
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

        @JavascriptInterface
        public void checkOtaUpdateNow() {
            mActivity.checkAndDownloadOtaUpdateAsync(true);
        }

        @JavascriptInterface
        public void applyOtaReload() {
            mActivity.runOnUiThread(() -> {
                if (mActivity.mWebView != null) {
                    mActivity.mWebView.reload();
                }
            });
        }

        @JavascriptInterface
        public boolean resetOtaCache() {
            return mActivity.resetOtaCache();
        }

        @JavascriptInterface
        public String getOtaStatusJson() {
            String active = mActivity.getCurrentActiveWebVersion().replace("\"", "");
            String pending = mActivity.mOtaPendingVersion != null ? mActivity.mOtaPendingVersion.replace("\"", "") : "";
            return "{\"activeVersion\":\"" + active + "\",\"pendingVersion\":\"" + pending + "\",\"apkVersionCode\":" + BuildConfig.VERSION_CODE + "}";
        }
    }

    // =========================================================================
    // OTA WEB ASSETS ENGINE (GitHub main -> private storage -> instant reload)
    // =========================================================================

    private File getOtaRootDir() {
        return new File(getFilesDir(), "web_ota");
    }

    private File getOtaActiveDir() {
        return new File(getOtaRootDir(), "active");
    }

    private void ensureOtaMatchesCurrentApk() {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences(OTA_PREFS_NAME, Context.MODE_PRIVATE);
            int savedCode = prefs.getInt(OTA_KEY_APK_VERSION_CODE, -1);
            int currentCode = BuildConfig.VERSION_CODE;
            if (savedCode != -1 && savedCode != currentCode) {
                // Newer APK was installed: clear older OTA cache so freshly bundled APK assets take over
                deleteDirRecursive(getOtaRootDir());
                prefs.edit()
                        .remove(OTA_KEY_ACTIVE_VERSION)
                        .putInt(OTA_KEY_APK_VERSION_CODE, currentCode)
                        .apply();
                Log.i(TAG, "OTA cache cleared after APK upgrade (" + savedCode + " -> " + currentCode + ")");
            } else if (savedCode == -1) {
                prefs.edit().putInt(OTA_KEY_APK_VERSION_CODE, currentCode).apply();
            }
        } catch (Throwable ignored) {}
    }

    private WebResourceResponse serveOtaAssetIfAvailable(String relPath) {
        try {
            if (relPath == null || relPath.isEmpty() || relPath.contains("..")) return null;
            String cleanPath = relPath.startsWith("/") ? relPath.substring(1) : relPath;
            File activeDir = getOtaActiveDir();
            File readyMarker = new File(activeDir, ".ota_ready");
            if (!readyMarker.exists()) return null;

            File target = new File(activeDir, cleanPath);
            if (!target.exists() || !target.isFile() || target.length() <= 0) return null;
            if (!target.getCanonicalPath().startsWith(activeDir.getCanonicalPath())) return null;

            String mime = getWebAssetMimeType(cleanPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store, no-cache, must-revalidate");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, new java.io.FileInputStream(target));
        } catch (Throwable t) {
            Log.w(TAG, "OTA serve fallback to bundled asset for " + relPath + ": " + t.getMessage());
            return null;
        }
    }

    private String getWebAssetMimeType(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    private String readBundledCacheName() {
        try (InputStream is = getAssets().open("sw.js")) {
            byte[] buf = new byte[4096];
            int n = is.read(buf);
            if (n > 0) {
                return extractCacheNameFromSw(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
        } catch (Throwable ignored) {}
        return "nocturne-v" + BuildConfig.VERSION_NAME;
    }

    private String extractCacheNameFromSw(String swText) {
        if (swText == null) return "";
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("const\s+CACHE_NAME\s*=\s*['\"]([^'\"]+)['\"]")
                .matcher(swText);
        return m.find() ? m.group(1).trim() : "";
    }

    private String getCurrentActiveWebVersion() {
        android.content.SharedPreferences prefs = getSharedPreferences(OTA_PREFS_NAME, Context.MODE_PRIVATE);
        String otaVer = prefs.getString(OTA_KEY_ACTIVE_VERSION, "");
        if (otaVer != null && !otaVer.isEmpty() && new File(getOtaActiveDir(), ".ota_ready").exists()) {
            return otaVer;
        }
        return readBundledCacheName();
    }

    public void checkAndDownloadOtaUpdateAsync(final boolean notifyIfUpToDate) {
        if (!isNetworkConnected()) {
            if (notifyIfUpToDate) notifyWebOtaStatus("offline", getCurrentActiveWebVersion());
            return;
        }
        if (!mOtaChecking.compareAndSet(false, true)) return;

        new Thread(() -> {
            try {
                String currentVer = getCurrentActiveWebVersion();
                String swUrl = OTA_BASE_URL + "sw.js?t=" + System.currentTimeMillis();
                byte[] remoteSwBytes = downloadUrlBytes(swUrl, 10000);
                if (remoteSwBytes == null || remoteSwBytes.length < 100) {
                    if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                    return;
                }
                String remoteVer = extractCacheNameFromSw(new String(remoteSwBytes, StandardCharsets.UTF_8));
                if (remoteVer.isEmpty() || remoteVer.equals(currentVer)) {
                    if (notifyIfUpToDate) notifyWebOtaStatus("up_to_date", currentVer);
                    return;
                }

                Log.i(TAG, "OTA update detected: " + currentVer + " -> " + remoteVer);
                File otaRoot = getOtaRootDir();
                File stagingDir = new File(otaRoot, "staging");
                deleteDirRecursive(stagingDir);
                if (!stagingDir.mkdirs() && !stagingDir.exists()) {
                    if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                    return;
                }

                long ts = System.currentTimeMillis();
                for (String relFile : OTA_FILES) {
                    byte[] data = "sw.js".equals(relFile)
                            ? remoteSwBytes
                            : downloadUrlBytes(OTA_BASE_URL + relFile + "?t=" + ts, 20000);
                    if (data == null || data.length < 100) {
                        Log.w(TAG, "OTA download failed/empty for " + relFile + ", aborting cleanly");
                        deleteDirRecursive(stagingDir);
                        if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                        return;
                    }
                    if ("index.html".equals(relFile)) {
                        if (data.length < 50000) {
                            deleteDirRecursive(stagingDir);
                            if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                            return;
                        }
                        String tail = new String(data, Math.max(0, data.length - 4096), Math.min(4096, data.length), StandardCharsets.UTF_8);
                        if (!tail.toLowerCase(Locale.US).contains("</html>")) {
                            deleteDirRecursive(stagingDir);
                            if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                            return;
                        }
                    }
                    if ("tailwind.min.css".equals(relFile) && data.length < 10000) {
                        deleteDirRecursive(stagingDir);
                        if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                        return;
                    }
                    File outFile = new File(stagingDir, relFile);
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile)) {
                        fos.write(data);
                    }
                }

                // Mark staging ready and perform atomic swap -> active
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(new File(stagingDir, ".ota_ready"))) {
                    fos.write(remoteVer.getBytes(StandardCharsets.UTF_8));
                }
                File activeDir = getOtaActiveDir();
                File backupDir = new File(otaRoot, "old");
                deleteDirRecursive(backupDir);
                if (activeDir.exists()) {
                    activeDir.renameTo(backupDir);
                }
                boolean swapped = stagingDir.renameTo(activeDir);
                if (!swapped) {
                    if (backupDir.exists()) backupDir.renameTo(activeDir);
                    deleteDirRecursive(stagingDir);
                    if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                    return;
                }
                deleteDirRecursive(backupDir);

                getSharedPreferences(OTA_PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putString(OTA_KEY_ACTIVE_VERSION, remoteVer)
                        .putInt(OTA_KEY_APK_VERSION_CODE, BuildConfig.VERSION_CODE)
                        .apply();
                mOtaPendingVersion = remoteVer;
                Log.i(TAG, "OTA update staged and activated successfully: " + remoteVer);
                notifyWebOtaStatus("ready", remoteVer);
            } catch (Throwable t) {
                Log.w(TAG, "OTA background check failed: " + t.getMessage());
                if (notifyIfUpToDate) notifyWebOtaStatus("error", getCurrentActiveWebVersion());
            } finally {
                mOtaChecking.set(false);
            }
        }, "NocturneOtaUpdater").start();
    }

    private byte[] downloadUrlBytes(String urlStr, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Cache-Control", "no-cache");
            conn.setRequestProperty("User-Agent", "Nocturne-Android-OTA");
            int code = conn.getResponseCode();
            if (code != 200) return null;
            try (InputStream is = conn.getInputStream();
                 ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = is.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
                return baos.toByteArray();
            }
        } catch (Throwable t) {
            return null;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Throwable ignored) {}
            }
        }
    }

    private void deleteDirRecursive(File dir) {
        if (dir == null || !dir.exists()) return;
        File[] children = dir.listFiles();
        if (children != null) {
            for (File c : children) {
                if (c.isDirectory()) deleteDirRecursive(c);
                else c.delete();
            }
        }
        dir.delete();
    }

    private void notifyWebOtaStatus(final String status, final String version) {
        final String safeStatus = status != null ? status.replace("'", "") : "";
        final String safeVer = version != null ? version.replace("'", "") : "";
        runOnUiThread(() -> {
            if (mWebView != null) {
                try {
                    mWebView.evaluateJavascript(
                            "if(typeof window.onNocturneOtaStatus==='function'){window.onNocturneOtaStatus('" + safeStatus + "','" + safeVer + "');}",
                            null
                    );
                } catch (Throwable ignored) {}
            }
        });
    }

    public boolean resetOtaCache() {
        try {
            deleteDirRecursive(getOtaRootDir());
            getSharedPreferences(OTA_PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .remove(OTA_KEY_ACTIVE_VERSION)
                    .apply();
            mOtaPendingVersion = "";
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

}

