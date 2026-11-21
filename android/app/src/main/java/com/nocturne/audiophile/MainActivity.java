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
import java.util.concurrent.atomic.AtomicInteger;
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
    private volatile boolean mPausedByTransientFocusLoss = false;
    private int mRendererRecoveryCount = 0;
    private long mRendererRecoveryWindowStartMs = 0L;
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
    private final java.util.concurrent.atomic.AtomicBoolean mStorageScanRunning = new java.util.concurrent.atomic.AtomicBoolean(false);
    private volatile boolean mIsInBackground = false;
    private volatile boolean mIsMediaPlaying = false;
    private volatile String mOtaPendingVersion = "";
    private boolean mIsMediaReceiverRegistered = false;
    private boolean mIsStorageReceiverRegistered = false;
    private static final String PREF_FIIO_STORAGE_LINKED = "fiio_storage_linked";
    private static final String PREF_FIIO_LINKED_ROOTS = "fiio_linked_roots_json";
    private static final String PREF_FIIO_LAST_COUNT = "fiio_last_scan_count";
    private static final String PREF_FIIO_LAST_TS = "fiio_last_scan_ts";
    private static final String FIIO_CATALOG_CACHE_FILE = "fiio_library_cache.json";
    private static final int FIIO_CATALOG_MAX_BYTES = 16 * 1024 * 1024;

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
        registerStorageMountReceiver();
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

                // v3.9.27: native album-art (embedded picture / MediaStore thumbnail / folder.jpg) as small cached JPEG
                if ("https".equalsIgnoreCase(scheme) &&
                        "appassets.androidplatform.net".equalsIgnoreCase(host) &&
                        "/local-cover".equalsIgnoreCase(path)) {
                    return handleLocalCoverArt(request);
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

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                boolean didCrash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
                int priority = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null ? detail.rendererPriorityAtExit() : -1;
                Log.e(TAG, "Main WebView render process gone (didCrash=" + didCrash + ", priority=" + priority + ")");
                return recoverWebViewAfterRenderProcessGone(view);
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

                    @Override
                    public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                        boolean didCrash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
                        Log.w(TAG, "OAuth popup WebView render process gone (didCrash=" + didCrash + ")");
                        android.view.ViewParent parent = view.getParent();
                        if (parent instanceof ViewGroup) {
                            ((ViewGroup) parent).removeView(view);
                        }
                        if (popupDialog.isShowing()) {
                            popupDialog.dismiss();
                        }
                        try {
                            popupWebView.destroy();
                        } catch (Throwable ignored) {
                        }
                        if (mActivePopupDialog == popupDialog) {
                            mActivePopupDialog = null;
                        }
                        return true;
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
     * Safely detaches/destroys a crashed WebView renderer and recreates mWebView
     * (capped at 3 recoveries per 60s) WITHOUT interrupting active Native Bit-Perfect playback.
     */
    private boolean recoverWebViewAfterRenderProcessGone(final WebView deadView) {
        if (deadView != null && mWebView != null && deadView != mWebView) {
            android.view.ViewParent staleParent = deadView.getParent();
            if (staleParent instanceof ViewGroup) {
                ((ViewGroup) staleParent).removeView(deadView);
            }
            try {
                deadView.destroy();
            } catch (Throwable ignored) {
            }
            return true;
        }

        if (isFinishing() || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed())) {
            if (deadView != null) {
                android.view.ViewParent deadParent = deadView.getParent();
                if (deadParent instanceof ViewGroup) {
                    ((ViewGroup) deadParent).removeView(deadView);
                }
                try {
                    deadView.destroy();
                } catch (Throwable ignored) {
                }
            }
            return true;
        }

        long nowElapsedMs = SystemClock.elapsedRealtime();
        if (mRendererRecoveryWindowStartMs == 0L || (nowElapsedMs - mRendererRecoveryWindowStartMs) > 60_000L) {
            mRendererRecoveryWindowStartMs = nowElapsedMs;
            mRendererRecoveryCount = 0;
        }
        mRendererRecoveryCount++;
        if (mRendererRecoveryCount > 3) {
            Log.e(TAG, "WebView renderer recovery limit exceeded (" + mRendererRecoveryCount + " in 60s); halting auto-recreate to preserve audio");
            if (deadView != null) {
                android.view.ViewParent deadParent = deadView.getParent();
                if (deadParent instanceof ViewGroup) {
                    ((ViewGroup) deadParent).removeView(deadView);
                }
                try {
                    deadView.destroy();
                } catch (Throwable ignored) {
                }
            }
            return true;
        }

        ViewGroup parentGroup = null;
        int childIndex = -1;
        ViewGroup.LayoutParams existingLp = null;
        int visibility = View.VISIBLE;
        if (deadView != null) {
            existingLp = deadView.getLayoutParams();
            visibility = deadView.getVisibility();
            android.view.ViewParent parent = deadView.getParent();
            if (parent instanceof ViewGroup) {
                parentGroup = (ViewGroup) parent;
                childIndex = parentGroup.indexOfChild(deadView);
                parentGroup.removeView(deadView);
            }
            try {
                deadView.destroy();
            } catch (Throwable ignored) {
            }
        }
        if (parentGroup == null) {
            View root = findViewById(R.id.root_layout);
            if (root instanceof ViewGroup) {
                parentGroup = (ViewGroup) root;
                childIndex = 0;
            }
        }

        WebView freshWebView = new WebView(MainActivity.this);
        freshWebView.setId(R.id.web_view);
        freshWebView.setVisibility(visibility);
        if (existingLp != null) {
            freshWebView.setLayoutParams(existingLp);
        } else {
            freshWebView.setLayoutParams(new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        }

        if (parentGroup != null) {
            if (childIndex >= 0 && childIndex <= parentGroup.getChildCount()) {
                parentGroup.addView(freshWebView, childIndex);
            } else {
                parentGroup.addView(freshWebView);
            }
        }

        mWebView = freshWebView;
        configureHighPerformanceWebView();
        loadAppEntrypoint();
        Log.i(TAG, "Recovered crashed main WebView (" + mRendererRecoveryCount + "/3 in window) without stopping mBitPerfectPlayer");
        return true;
    }

    /**
     * Native WakeLock control for uninterrupted high-resolution audio playback.
     * Holds WifiLock only when streaming remotely so local MicroSD playback saves battery.
     */
    public void acquireWakeLock() {
        acquireWakeLock(true);
    }

    public void acquireWakeLock(boolean needWifiLock) {
        try {
            if (mWakeLock != null && !mWakeLock.isHeld()) {
                mWakeLock.acquire(10 * 60 * 60 * 1000L); // 10 hours max safety timeout
                Log.d(TAG, "Acquired playback WakeLock");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire WakeLock: " + e.getMessage());
        }
        try {
            if (needWifiLock) {
                if (mWifiLock != null && !mWifiLock.isHeld()) {
                    mWifiLock.acquire();
                    Log.d(TAG, "Acquired Hi-Res playback WifiLock");
                }
            } else if (mWifiLock != null && mWifiLock.isHeld()) {
                mWifiLock.release();
                Log.d(TAG, "Released WifiLock for offline local playback");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to update WifiLock: " + e.getMessage());
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
                                mHasAudioFocus = false;
                                mPausedByTransientFocusLoss = false;
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
                            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                                mHasAudioFocus = false;
                                if (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()) {
                                    mPausedByTransientFocusLoss = true;
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
                                    if (mPausedByTransientFocusLoss && mBitPerfectPlayer.isPaused()) {
                                        mPausedByTransientFocusLoss = false;
                                        mBitPerfectPlayer.resume();
                                        if (mWebView != null) {
                                            mWebView.post(() -> mWebView.evaluateJavascript(
                                                    "if (window.onNativeBitPerfectStateChange) window.onNativeBitPerfectStateChange(true);",
                                                    null));
                                        }
                                    }
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
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                            mHasAudioFocus = false;
                            mPausedByTransientFocusLoss = false;
                            if (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()) {
                                mBitPerfectPlayer.pause();
                            }
                        } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            mHasAudioFocus = false;
                            if (mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying()) {
                                mPausedByTransientFocusLoss = true;
                                mBitPerfectPlayer.pause();
                            }
                        } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                            mHasAudioFocus = true;
                            if (mPausedByTransientFocusLoss && mBitPerfectPlayer != null && mBitPerfectPlayer.isPaused()) {
                                mPausedByTransientFocusLoss = false;
                                mBitPerfectPlayer.resume();
                            }
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
        mIsInBackground = false;
        if (mWebView != null) {
            mWebView.onResume();
            mWebView.requestFocus();
            boolean psm = false;
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) psm = pm.isPowerSaveMode();
            } catch (Exception ignored) {}
            final boolean isPowerSave = psm;
            final boolean syncBpPos = mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused());
            final long bpPosMs = syncBpPos ? mBitPerfectPlayer.getPositionMs() : 0L;
            final long bpDurMs = syncBpPos ? mBitPerfectPlayer.getDurationMs() : 0L;
            mWebView.post(() -> {
                if (mWebView == null) return;
                StringBuilder js = new StringBuilder();
                js.append("if(typeof window.onAndroidAppLifecycle==='function'){window.onAndroidAppLifecycle('foreground');}");
                js.append("if(typeof window.onAndroidStorageStateChanged==='function'){window.onAndroidStorageStateChanged('resume');}");
                js.append("if(typeof window.onAndroidPowerSaveChanged==='function'){window.onAndroidPowerSaveChanged(")
                  .append(isPowerSave ? "true" : "false").append(");}");
                if (syncBpPos) {
                    js.append("if(typeof window.onNativeBitPerfectPosition==='function'){window.onNativeBitPerfectPosition(")
                      .append(bpPosMs).append(",").append(bpDurMs).append(");}");
                }
                mWebView.evaluateJavascript(js.toString(), null);
            });
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
        mIsInBackground = true;
        // Release WakeLock/WifiLock immediately if playback is paused/idle when entering background
        if (!mIsMediaPlaying && (mBitPerfectPlayer == null || !mBitPerfectPlayer.isPlaying())) {
            releaseWakeLock();
        }
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

    private final BroadcastReceiver mStorageMountReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || mWebView == null) return;
            final String action = intent.getAction();
            if (Intent.ACTION_MEDIA_MOUNTED.equals(action) || Intent.ACTION_MEDIA_SCANNER_FINISHED.equals(action)) {
                mWebView.post(() -> {
                    if (mWebView != null) {
                        mWebView.evaluateJavascript(
                                "if(typeof window.onAndroidStorageStateChanged==='function'){window.onAndroidStorageStateChanged('mounted');}",
                                null
                        );
                    }
                });
            }
        }
    };

    private void registerStorageMountReceiver() {
        if (mIsStorageReceiverRegistered) return;
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_MEDIA_MOUNTED);
            filter.addAction(Intent.ACTION_MEDIA_SCANNER_FINISHED);
            filter.addDataScheme("file");
            registerReceiver(mStorageMountReceiver, filter);
            mIsStorageReceiverRegistered = true;
        } catch (Throwable t) {
            Log.w(TAG, "registerStorageMountReceiver warning: " + t.getMessage());
        }
    }

    private void unregisterStorageMountReceiver() {
        if (!mIsStorageReceiverRegistered) return;
        try {
            unregisterReceiver(mStorageMountReceiver);
        } catch (Throwable ignored) {}
        mIsStorageReceiverRegistered = false;
    }

    @Override
    protected void onDestroy() {
        stopBitPerfectPlayback();
        cancelMediaNotification();
        releaseWakeLock();
        abandonAudioFocus();
        unregisterMediaNotificationReceiver();
        unregisterStorageMountReceiver();
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
        private volatile boolean mClosed = false;

        public BoundedFileInputStream(File file, long start, long length) throws IOException {
            this.mRaf = new RandomAccessFile(file, "r");
            try {
                if (start > 0) {
                    this.mRaf.seek(start);
                }
                this.mRemaining = length;
            } catch (IOException seekErr) {
                try { this.mRaf.close(); } catch (IOException ignored) {}
                throw seekErr;
            }
        }

        @Override
        public int read() throws IOException {
            if (mClosed || mRemaining <= 0) return -1;
            int b = mRaf.read();
            if (b != -1) mRemaining--;
            return b;
        }

        @Override
        public int read(@NonNull byte[] b, int off, int len) throws IOException {
            if (mClosed || mRemaining <= 0) return -1;
            int toRead = (int) Math.min(len, mRemaining);
            int bytesRead = mRaf.read(b, off, toRead);
            if (bytesRead > 0) {
                mRemaining -= bytesRead;
            }
            return bytesRead;
        }

        @Override
        public long skip(long n) throws IOException {
            if (mClosed || n <= 0 || mRemaining <= 0) return 0;
            long curPos = mRaf.getFilePointer();
            long fileAvail = Math.max(0L, mRaf.length() - curPos);
            long toSkip = Math.min(n, Math.min(mRemaining, fileAvail));
            if (toSkip <= 0) return 0;
            mRaf.seek(curPos + toSkip);
            mRemaining -= toSkip;
            return toSkip;
        }

        @Override
        public int available() throws IOException {
            if (mClosed) return 0;
            return (int) Math.min(mRemaining, Integer.MAX_VALUE);
        }

        @Override
        public void close() throws IOException {
            if (mClosed) return;
            mClosed = true;
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
        private FileInputStream mFis;
        private long mRemaining;
        private volatile boolean mClosed = false;

        public BoundedContentUriInputStream(@NonNull AssetFileDescriptor afd, long start, long length) throws IOException {
            this.mAfd = afd;
            try {
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
            } catch (IOException initErr) {
                try { if (this.mFis != null) this.mFis.close(); } catch (IOException ignored) {}
                try { this.mAfd.close(); } catch (IOException ignored) {}
                throw initErr;
            }
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
            if (mClosed || mRemaining <= 0) return -1;
            int b = mFis.read();
            if (b != -1) mRemaining--;
            return b;
        }

        @Override
        public int read(@NonNull byte[] b, int off, int len) throws IOException {
            if (mClosed || mRemaining <= 0) return -1;
            int toRead = (int) Math.min(len, mRemaining);
            int bytesRead = mFis.read(b, off, toRead);
            if (bytesRead > 0) {
                mRemaining -= bytesRead;
            }
            return bytesRead;
        }

        @Override
        public long skip(long n) throws IOException {
            if (mClosed || n <= 0 || mRemaining <= 0) return 0;
            long toSkip = Math.min(n, mRemaining);
            try {
                FileChannel channel = mFis.getChannel();
                if (channel != null) {
                    long curPos = channel.position();
                    long fileAvail = Math.max(0L, channel.size() - curPos);
                    long step = Math.min(toSkip, fileAvail);
                    if (step > 0) {
                        channel.position(curPos + step);
                        mRemaining -= step;
                        return step;
                    }
                    return 0;
                }
            } catch (IOException ignored) {}
            long skipped = 0;
            byte[] buf = new byte[(int) Math.min(8192L, toSkip)];
            while (skipped < toSkip) {
                long s = mFis.skip(toSkip - skipped);
                if (s > 0) {
                    skipped += s;
                } else {
                    int r = mFis.read(buf, 0, (int) Math.min(buf.length, toSkip - skipped));
                    if (r < 0) break;
                    skipped += r;
                }
            }
            mRemaining -= skipped;
            return skipped;
        }

        @Override
        public int available() throws IOException {
            if (mClosed) return 0;
            return (int) Math.min(mRemaining, Integer.MAX_VALUE);
        }

        @Override
        public void close() throws IOException {
            if (mClosed) return;
            mClosed = true;
            try {
                if (mFis != null) mFis.close();
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
        if (lower.endsWith(".wv")) return "audio/x-wavpack";
        if (lower.endsWith(".mka")) return "audio/x-matroska";
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

    // ===== v3.9.27: native album-art pipeline for FiiO M11S (MicroSD / MediaStore tracks) =====
    // https://appassets.androidplatform.net/local-cover?uri=<content://..>|path=<file>&key=<album key>&size=<px>
    // Order: disk cache -> embedded picture -> binary FLAC/ID3 -> MediaStore albumart/thumbnail -> folder.jpg (+Artwork/).
    // Output is a small JPEG cached under cacheDir/covers so the WebView never keeps base64 art in RAM.
    private static final java.util.concurrent.Semaphore COVER_ART_PERMITS = new java.util.concurrent.Semaphore(4);
    private final java.util.concurrent.ConcurrentHashMap<String, Object> mCoverHashLocks = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.atomic.AtomicInteger mCoverWrites = new java.util.concurrent.atomic.AtomicInteger(0);
    private static final long COVER_CACHE_MAX_BYTES = 48L * 1024L * 1024L;
    private static final int COVER_CACHE_MAX_FILES = 1500;

    static int computeCoverSampleSize(int srcWidth, int srcHeight, int targetEdge) {
        int sample = 1;
        int maxEdge = Math.max(srcWidth, srcHeight);
        if (targetEdge <= 0) return 1;
        while (maxEdge / (sample * 2) >= targetEdge) sample *= 2;
        return sample;
    }

    private static String coverSha1Hex(String value) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            byte[] digest = md.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) sb.append(String.format(Locale.US, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(value.hashCode());
        }
    }

    private byte[] coverBitmapToJpeg(android.graphics.Bitmap source, int size) {
        if (source == null) return null;
        android.graphics.Bitmap scaled = source;
        try {
            int w = source.getWidth(), h = source.getHeight();
            int maxEdge = Math.max(w, h);
            if (maxEdge > size) {
                float ratio = (float) size / (float) maxEdge;
                scaled = android.graphics.Bitmap.createScaledBitmap(source, Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio)), true);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream(32 * 1024);
            if (!scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)) return null;
            return out.toByteArray();
        } catch (Throwable t) {
            return null;
        } finally {
            if (scaled != null && scaled != source) { try { scaled.recycle(); } catch (Throwable ignored) {} }
        }
    }

    private byte[] coverBytesToJpeg(byte[] raw, int size) {
        if (raw == null || raw.length == 0) return null;
        try {
            android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
            opts.inSampleSize = computeCoverSampleSize(bounds.outWidth, bounds.outHeight, size);
            opts.inPreferredConfig = android.graphics.Bitmap.Config.RGB_565;
            android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
            if (bmp == null) return null;
            try {
                return coverBitmapToJpeg(bmp, size);
            } finally {
                try { bmp.recycle(); } catch (Throwable ignored) {}
            }
        } catch (Throwable t) {
            return null;
        }
    }

    private static byte[] coverReadSmallFile(File file, long maxBytes) {
        if (file == null || !file.isFile()) return null;
        long len = file.length();
        if (len <= 0 || len > maxBytes) return null;
        try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream((int) len)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (Throwable t) {
            return null;
        }
    }

    private static boolean readFullyLenient(InputStream in, byte[] dst, int off, int len) throws IOException {
        int total = 0;
        while (total < len) {
            int n = in.read(dst, off + total, len - total);
            if (n < 0) return false;
            total += n;
        }
        return true;
    }

    private static boolean skipFullyLenient(InputStream in, long bytesToSkip) throws IOException {
        long remaining = bytesToSkip;
        byte[] skipBuf = null;
        while (remaining > 0) {
            long skipped = in.skip(remaining);
            if (skipped > 0) {
                remaining -= skipped;
                continue;
            }
            if (skipBuf == null) skipBuf = new byte[4096];
            int n = in.read(skipBuf, 0, (int) Math.min(skipBuf.length, remaining));
            if (n < 0) return false;
            remaining -= n;
        }
        return true;
    }

    private static byte[] readStreamBounded(InputStream in, long maxBytes) {
        if (in == null) return null;
        try (ByteArrayOutputStream out = new ByteArrayOutputStream(32 * 1024)) {
            byte[] buf = new byte[8192];
            long total = 0L;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) return null;
                out.write(buf, 0, n);
            }
            return out.size() > 0 ? out.toByteArray() : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static byte[] parseFlacPictureBlock(byte[] buf, int off, int len, boolean[] isFrontOut) {
        if (buf == null || off < 0 || len < 32 || off + len > buf.length) return null;
        int end = off + len;
        int pos = off;
        int picType = ((buf[pos] & 0xFF) << 24) | ((buf[pos + 1] & 0xFF) << 16) | ((buf[pos + 2] & 0xFF) << 8) | (buf[pos + 3] & 0xFF);
        pos += 4;
        if (pos + 4 > end) return null;
        int mimeLen = ((buf[pos] & 0xFF) << 24) | ((buf[pos + 1] & 0xFF) << 16) | ((buf[pos + 2] & 0xFF) << 8) | (buf[pos + 3] & 0xFF);
        pos += 4;
        if (mimeLen < 0 || mimeLen > 256 || pos + mimeLen + 4 > end) return null;
        pos += mimeLen;
        int descLen = ((buf[pos] & 0xFF) << 24) | ((buf[pos + 1] & 0xFF) << 16) | ((buf[pos + 2] & 0xFF) << 8) | (buf[pos + 3] & 0xFF);
        pos += 4;
        if (descLen < 0 || descLen > 16384 || (long) pos + descLen + 20L > end) return null;
        pos += descLen + 16; // skip width(4), height(4), depth(4), colors(4)
        int dataLen = ((buf[pos] & 0xFF) << 24) | ((buf[pos + 1] & 0xFF) << 16) | ((buf[pos + 2] & 0xFF) << 8) | (buf[pos + 3] & 0xFF);
        pos += 4;
        if (dataLen <= 16 || dataLen > 8 * 1024 * 1024 || (long) pos + dataLen > end) return null;
        if (isFrontOut != null && isFrontOut.length > 0) isFrontOut[0] = (picType == 3);
        byte[] out = new byte[dataLen];
        System.arraycopy(buf, pos, out, 0, dataLen);
        return out;
    }

    /**
     * v3.9.32: Pure-Java FLAC METADATA_BLOCK_PICTURE (type 6) & Vorbis METADATA_BLOCK_PICTURE (type 4 base64)
     * extractor so Hi-Res / 24-bit FLAC files work even when Android 10 MediaMetadataRetriever returns null.
     */
    private static byte[] extractFlacPictureFromStream(InputStream rawIn) {
        if (rawIn == null) return null;
        try {
            byte[] magic = new byte[4];
            if (!readFullyLenient(rawIn, magic, 0, 4)) return null;
            if (magic[0] == 'I' && magic[1] == 'D' && magic[2] == '3') {
                byte[] id3Rest = new byte[6];
                if (!readFullyLenient(rawIn, id3Rest, 0, 6)) return null;
                int flags = id3Rest[1] & 0xFF;
                long tagSize = ((long) (id3Rest[2] & 0x7F) << 21) | ((long) (id3Rest[3] & 0x7F) << 14)
                        | ((long) (id3Rest[4] & 0x7F) << 7) | (long) (id3Rest[5] & 0x7F);
                long skipId3 = tagSize + ((flags & 0x10) != 0 ? 10L : 0L);
                if (skipId3 < 0 || skipId3 > 16L * 1024L * 1024L || !skipFullyLenient(rawIn, skipId3)) return null;
                if (!readFullyLenient(rawIn, magic, 0, 4)) return null;
            }
            if (magic[0] != 'f' || magic[1] != 'L' || magic[2] != 'a' || magic[3] != 'C') return null;

            byte[] hdr = new byte[4];
            byte[] fallbackPic = null;
            long totalRead = 4L;
            boolean[] isFront = new boolean[1];
            for (int iter = 0; iter < 64 && totalRead < 16L * 1024L * 1024L; iter++) {
                if (!readFullyLenient(rawIn, hdr, 0, 4)) break;
                totalRead += 4L;
                boolean isLast = (hdr[0] & 0x80) != 0;
                int blockType = hdr[0] & 0x7F;
                int blockLen = ((hdr[1] & 0xFF) << 16) | ((hdr[2] & 0xFF) << 8) | (hdr[3] & 0xFF);
                if (blockLen < 0) break;

                if (blockType == 6 && blockLen >= 32 && blockLen <= 8 * 1024 * 1024) {
                    byte[] block = new byte[blockLen];
                    if (!readFullyLenient(rawIn, block, 0, blockLen)) break;
                    totalRead += blockLen;
                    isFront[0] = false;
                    byte[] pic = parseFlacPictureBlock(block, 0, blockLen, isFront);
                    if (pic != null) {
                        if (isFront[0]) return pic;
                        if (fallbackPic == null) fallbackPic = pic;
                    }
                } else if (blockType == 4 && fallbackPic == null && blockLen >= 8 && blockLen <= 4 * 1024 * 1024) {
                    byte[] vc = new byte[blockLen];
                    if (!readFullyLenient(rawIn, vc, 0, blockLen)) break;
                    totalRead += blockLen;
                    int pos = 0;
                    if (pos + 4 <= blockLen) {
                        int vendorLen = (vc[pos] & 0xFF) | ((vc[pos + 1] & 0xFF) << 8) | ((vc[pos + 2] & 0xFF) << 16) | ((vc[pos + 3] & 0xFF) << 24);
                        pos += 4;
                        if (vendorLen >= 0 && pos + vendorLen + 4 <= blockLen) {
                            pos += vendorLen;
                            int count = (vc[pos] & 0xFF) | ((vc[pos + 1] & 0xFF) << 8) | ((vc[pos + 2] & 0xFF) << 16) | ((vc[pos + 3] & 0xFF) << 24);
                            pos += 4;
                            for (int c = 0; c < count && pos + 4 <= blockLen; c++) {
                                int itemLen = (vc[pos] & 0xFF) | ((vc[pos + 1] & 0xFF) << 8) | ((vc[pos + 2] & 0xFF) << 16) | ((vc[pos + 3] & 0xFF) << 24);
                                pos += 4;
                                if (itemLen < 0 || pos + itemLen > blockLen) break;
                                if (itemLen > 24 && itemLen <= 4 * 1024 * 1024) {
                                    String prefix = new String(vc, pos, 23, StandardCharsets.US_ASCII);
                                    if ("METADATA_BLOCK_PICTURE=".equalsIgnoreCase(prefix)) {
                                        try {
                                            String b64 = new String(vc, pos + 23, itemLen - 23, StandardCharsets.US_ASCII);
                                            byte[] decoded = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                                            isFront[0] = false;
                                            byte[] pic = parseFlacPictureBlock(decoded, 0, decoded.length, isFront);
                                            if (pic != null) {
                                                if (isFront[0]) return pic;
                                                if (fallbackPic == null) fallbackPic = pic;
                                            }
                                        } catch (Throwable ignored) {}
                                    }
                                }
                                pos += itemLen;
                            }
                        }
                    }
                } else {
                    if (blockLen > 16 * 1024 * 1024 || !skipFullyLenient(rawIn, blockLen)) break;
                    totalRead += blockLen;
                }
                if (isLast) break;
            }
            return fallbackPic;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static byte[] extractId3v2ApicFromBuffer(byte[] tagBuf, int readLen) {
        if (tagBuf == null || readLen <= 16) return null;
        for (int i = 0; i + 10 < readLen; i++) {
            boolean isApic = tagBuf[i] == 'A' && tagBuf[i + 1] == 'P' && tagBuf[i + 2] == 'I' && tagBuf[i + 3] == 'C';
            boolean isPic22 = !isApic && tagBuf[i] == 'P' && tagBuf[i + 1] == 'I' && tagBuf[i + 2] == 'C'
                    && ((tagBuf[i + 3] & 0xFF) == 0);
            if (isApic || isPic22) {
                int headerAdvance = isApic ? 10 : 6;
                int searchEnd = Math.min(readLen - 4, i + headerAdvance + 3 * 1024 * 1024);
                for (int j = i + headerAdvance; j < searchEnd; j++) {
                    boolean isJpeg = (tagBuf[j] & 0xFF) == 0xFF && (tagBuf[j + 1] & 0xFF) == 0xD8 && (tagBuf[j + 2] & 0xFF) == 0xFF;
                    boolean isPng = (tagBuf[j] & 0xFF) == 0x89 && tagBuf[j + 1] == 'P' && tagBuf[j + 2] == 'N' && tagBuf[j + 3] == 'G';
                    if (isJpeg || isPng) {
                        int maxPicLen = readLen - j;
                        byte[] pic = new byte[maxPicLen];
                        System.arraycopy(tagBuf, j, pic, 0, maxPicLen);
                        return pic;
                    }
                }
            }
        }
        return null;
    }

    private static byte[] extractId3v2ApicFromChannel(java.nio.channels.FileChannel ch) {
        if (ch == null) return null;
        try {
            long fileLen = ch.size();
            if (fileLen < 38) return null;
            java.nio.ByteBuffer magicBuf = java.nio.ByteBuffer.allocate(4);
            ch.position(0L);
            if (ch.read(magicBuf) < 4) return null;
            byte[] magic = magicBuf.array();
            long id3Offset = -1L;
            if (magic[0] == 'D' && magic[1] == 'S' && magic[2] == 'D' && magic[3] == ' ') {
                java.nio.ByteBuffer ptrBuf = java.nio.ByteBuffer.allocate(8);
                ch.position(20L);
                if (ch.read(ptrBuf) < 8) return null;
                byte[] ptrBytes = ptrBuf.array();
                long ptr = 0L;
                for (int i = 0; i < 8; i++) ptr |= ((long) (ptrBytes[i] & 0xFF)) << (i * 8);
                if (ptr >= 28 && ptr + 10 < fileLen) id3Offset = ptr;
            } else if (magic[0] == 'I' && magic[1] == 'D' && magic[2] == '3') {
                id3Offset = 0L;
            }
            if (id3Offset < 0) return null;
            ch.position(id3Offset);
            java.nio.ByteBuffer hdrBuf = java.nio.ByteBuffer.allocate(10);
            if (ch.read(hdrBuf) < 10) return null;
            byte[] hdr = hdrBuf.array();
            if (hdr[0] != 'I' || hdr[1] != 'D' || hdr[2] != '3') return null;
            int tagSize = ((hdr[6] & 0x7F) << 21) | ((hdr[7] & 0x7F) << 14) | ((hdr[8] & 0x7F) << 7) | (hdr[9] & 0x7F);
            int readLen = (int) Math.min((long) tagSize, Math.min(4L * 1024L * 1024L, fileLen - (id3Offset + 10)));
            if (readLen <= 16) return null;
            byte[] tagBuf = new byte[readLen];
            java.nio.ByteBuffer tagBb = java.nio.ByteBuffer.wrap(tagBuf);
            while (tagBb.hasRemaining()) {
                if (ch.read(tagBb) < 0) break;
            }
            return extractId3v2ApicFromBuffer(tagBuf, readLen - tagBb.remaining());
        } catch (Throwable ignored) {
            return null;
        }
    }

    /**
     * v3.9.28: Extracts embedded ID3v2 APIC cover art directly from .dsf (DSD tail ID3 pointer at bytes 20..27)
     * or leading ID3v2 tags when Android's MediaMetadataRetriever does not support the container (e.g. DSF/DFF).
     */
    private static byte[] extractId3v2ApicFromFile(File file) {
        if (file == null || !file.isFile() || !file.canRead()) return null;
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            return extractId3v2ApicFromChannel(raf.getChannel());
        } catch (Throwable ignored) {}
        return null;
    }

    private static long[] findMp4BoxRange(java.nio.channels.FileChannel ch, long start, long end, String fourCc) throws IOException {
        if (ch == null || start < 0 || end <= start + 8 || fourCc == null || fourCc.length() != 4) return null;
        byte[] hdr = new byte[8];
        byte[] ext = new byte[8];
        long pos = start;
        for (int iter = 0; iter < 128 && pos + 8 <= end; iter++) {
            ch.position(pos);
            java.nio.ByteBuffer hb = java.nio.ByteBuffer.wrap(hdr);
            while (hb.hasRemaining()) {
                if (ch.read(hb) < 0) return null;
            }
            long size = ((hdr[0] & 0xFFL) << 24) | ((hdr[1] & 0xFFL) << 16) | ((hdr[2] & 0xFFL) << 8) | (hdr[3] & 0xFFL);
            int headerLen = 8;
            if (size == 1L) {
                if (pos + 16 > end) return null;
                java.nio.ByteBuffer eb = java.nio.ByteBuffer.wrap(ext);
                while (eb.hasRemaining()) {
                    if (ch.read(eb) < 0) return null;
                }
                size = 0L;
                for (int i = 0; i < 8; i++) size = (size << 8) | (ext[i] & 0xFFL);
                headerLen = 16;
            } else if (size == 0L) {
                size = end - pos;
            }
            if (size < headerLen) return null;
            long boxEnd = pos + size;
            if (boxEnd > end) boxEnd = end;
            if (boxEnd <= pos) return null;
            if (hdr[4] == (byte) fourCc.charAt(0) && hdr[5] == (byte) fourCc.charAt(1)
                    && hdr[6] == (byte) fourCc.charAt(2) && hdr[7] == (byte) fourCc.charAt(3)) {
                return new long[]{pos + headerLen, boxEnd};
            }
            pos = boxEnd;
        }
        return null;
    }

    private static byte[] extractMp4CovrFromChannel(java.nio.channels.FileChannel ch) {
        if (ch == null) return null;
        try {
            long fileLen = ch.size();
            if (fileLen < 32) return null;
            byte[] head = new byte[12];
            ch.position(0L);
            java.nio.ByteBuffer hb = java.nio.ByteBuffer.wrap(head);
            while (hb.hasRemaining()) {
                if (ch.read(hb) < 0) return null;
            }
            if (head[4] != 'f' || head[5] != 't' || head[6] != 'y' || head[7] != 'p') return null;
            long[] moov = findMp4BoxRange(ch, 0L, fileLen, "moov");
            if (moov == null) return null;
            long[] udta = findMp4BoxRange(ch, moov[0], moov[1], "udta");
            if (udta == null) return null;
            long[] meta = findMp4BoxRange(ch, udta[0], udta[1], "meta");
            if (meta == null || meta[1] - meta[0] <= 12) return null;
            long[] ilst = findMp4BoxRange(ch, meta[0] + 4L, meta[1], "ilst");
            if (ilst == null) return null;
            long[] covr = findMp4BoxRange(ch, ilst[0], ilst[1], "covr");
            if (covr == null) return null;
            long[] data = findMp4BoxRange(ch, covr[0], covr[1], "data");
            if (data == null || data[1] - data[0] <= 24) return null;
            long picStart = data[0] + 8L;
            long picLen = data[1] - picStart;
            if (picLen <= 16 || picLen > 8L * 1024L * 1024L) return null;
            byte[] pic = new byte[(int) picLen];
            ch.position(picStart);
            java.nio.ByteBuffer pb = java.nio.ByteBuffer.wrap(pic);
            while (pb.hasRemaining()) {
                if (ch.read(pb) < 0) break;
            }
            if (pb.hasRemaining()) return null;
            boolean isJpeg = (pic[0] & 0xFF) == 0xFF && (pic[1] & 0xFF) == 0xD8 && (pic[2] & 0xFF) == 0xFF;
            boolean isPng = (pic[0] & 0xFF) == 0x89 && pic[1] == 'P' && pic[2] == 'N' && pic[3] == 'G';
            return (isJpeg || isPng) ? pic : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static byte[] extractWavId3ApicFromChannel(java.nio.channels.FileChannel ch) {
        if (ch == null) return null;
        try {
            long fileLen = ch.size();
            if (fileLen < 36) return null;
            byte[] riff = new byte[12];
            ch.position(0L);
            java.nio.ByteBuffer rb = java.nio.ByteBuffer.wrap(riff);
            while (rb.hasRemaining()) {
                if (ch.read(rb) < 0) return null;
            }
            if (riff[0] != 'R' || riff[1] != 'I' || riff[2] != 'F' || riff[3] != 'F'
                    || riff[8] != 'W' || riff[9] != 'A' || riff[10] != 'V' || riff[11] != 'E') {
                return null;
            }
            byte[] chkHdr = new byte[8];
            long pos = 12L;
            for (int iter = 0; iter < 128 && pos + 8 <= fileLen; iter++) {
                ch.position(pos);
                java.nio.ByteBuffer hb = java.nio.ByteBuffer.wrap(chkHdr);
                while (hb.hasRemaining()) {
                    if (ch.read(hb) < 0) return null;
                }
                long chunkSize = (chkHdr[4] & 0xFFL) | ((chkHdr[5] & 0xFFL) << 8)
                        | ((chkHdr[6] & 0xFFL) << 16) | ((chkHdr[7] & 0xFFL) << 24);
                if (chunkSize < 0) return null;
                long dataStart = pos + 8L;
                long paddedSize = chunkSize + (chunkSize & 1L);
                long nextPos = dataStart + paddedSize;
                if (dataStart > fileLen || nextPos <= pos) return null;
                String id = new String(chkHdr, 0, 4, StandardCharsets.US_ASCII);
                if ("id3 ".equalsIgnoreCase(id) && chunkSize > 26 && dataStart < fileLen) {
                    int readLen = (int) Math.min(chunkSize, Math.min(4L * 1024L * 1024L, fileLen - dataStart));
                    if (readLen > 26) {
                        byte[] buf = new byte[readLen];
                        ch.position(dataStart);
                        java.nio.ByteBuffer bb = java.nio.ByteBuffer.wrap(buf);
                        while (bb.hasRemaining()) {
                            if (ch.read(bb) < 0) break;
                        }
                        int actual = readLen - bb.remaining();
                        if (actual > 26 && buf[0] == 'I' && buf[1] == 'D' && buf[2] == '3') {
                            byte[] body = new byte[actual - 10];
                            System.arraycopy(buf, 10, body, 0, body.length);
                            return extractId3v2ApicFromBuffer(body, body.length);
                        }
                        if (actual > 16) {
                            return extractId3v2ApicFromBuffer(buf, actual);
                        }
                    }
                }
                pos = nextPos;
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private byte[] extractBinaryEmbeddedArt(@Nullable Uri contentUri, @Nullable File file) {
        try {
            if (file != null && file.isFile() && file.canRead()) {
                try (FileInputStream fis = new FileInputStream(file)) {
                    byte[] flacPic = extractFlacPictureFromStream(fis);
                    if (flacPic != null) return flacPic;
                } catch (Throwable ignored) {}
            } else if (contentUri != null) {
                try (InputStream is = getContentResolver().openInputStream(contentUri)) {
                    byte[] flacPic = extractFlacPictureFromStream(is);
                    if (flacPic != null) return flacPic;
                } catch (Throwable ignored) {}
            }
            if (file != null && file.isFile() && file.canRead()) {
                try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                    java.nio.channels.FileChannel ch = raf.getChannel();
                    byte[] id3Pic = extractId3v2ApicFromChannel(ch);
                    if (id3Pic != null) return id3Pic;
                    byte[] mp4Pic = extractMp4CovrFromChannel(ch);
                    if (mp4Pic != null) return mp4Pic;
                    byte[] wavPic = extractWavId3ApicFromChannel(ch);
                    if (wavPic != null) return wavPic;
                } catch (Throwable ignored) {}
            }
            if (contentUri != null) {
                try (ParcelFileDescriptor pfd = getContentResolver().openFileDescriptor(contentUri, "r")) {
                    if (pfd != null) {
                        try (FileInputStream fis = new FileInputStream(pfd.getFileDescriptor())) {
                            java.nio.channels.FileChannel ch = fis.getChannel();
                            byte[] id3Pic = extractId3v2ApicFromChannel(ch);
                            if (id3Pic != null) return id3Pic;
                            byte[] mp4Pic = extractMp4CovrFromChannel(ch);
                            if (mp4Pic != null) return mp4Pic;
                            byte[] wavPic = extractWavId3ApicFromChannel(ch);
                            if (wavPic != null) return wavPic;
                        }
                    }
                } catch (Throwable ignored) {}
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private byte[] extractFolderCoverFromDir(File dir, int size) {
        if (dir == null || !dir.isDirectory()) return null;
        try {
            File[] kids = dir.listFiles();
            if (kids == null || kids.length == 0) return null;
            String[] preferred = new String[] {"cover", "folder", "front", "album", "albumart", "artwork", "thumb", "albumartsmall"};
            for (String base : preferred) {
                for (File kid : kids) {
                    if (kid == null || !kid.isFile()) continue;
                    String name = kid.getName().toLowerCase(Locale.US);
                    if (name.equals(base + ".jpg") || name.equals(base + ".jpeg") || name.equals(base + ".png") || name.equals(base + ".webp")) {
                        byte[] jpeg = coverBytesToJpeg(coverReadSmallFile(kid, 8L * 1024L * 1024L), size);
                        if (jpeg != null) return jpeg;
                    }
                }
            }
            // Fallback: pick the largest .jpg/.jpeg/.png in this album directory (skipping root /Music or /sdcard)
            String dirName = dir.getName() != null ? dir.getName().toLowerCase(Locale.US) : "";
            if (!dirName.equals("music") && !dirName.equals("dsd") && !dirName.equals("flac") && !dirName.equals("audio") && !dirName.equals("0") && !dirName.equals("sdcard")) {
                File bestImg = null;
                long bestLen = 0L;
                for (File kid : kids) {
                    if (kid == null || !kid.isFile()) continue;
                    String name = kid.getName().toLowerCase(Locale.US);
                    if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp")) {
                        long len = kid.length();
                        if (len > bestLen && len <= 10L * 1024L * 1024L) {
                            bestLen = len;
                            bestImg = kid;
                        }
                    }
                }
                if (bestImg != null) {
                    return coverBytesToJpeg(coverReadSmallFile(bestImg, 10L * 1024L * 1024L), size);
                }
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private File resolveFileFromContentUri(Uri contentUri) {
        if (contentUri == null) return null;
        try (Cursor cursor = getContentResolver().query(
                contentUri,
                new String[]{MediaStore.Audio.Media.DATA},
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int col = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
                if (col >= 0) {
                    String dataPath = cursor.getString(col);
                    if (dataPath != null && !dataPath.trim().isEmpty()) {
                        File f = new File(dataPath.trim());
                        if (f.exists()) return f;
                    }
                }
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private static final long COVER_NONE_TTL_MS = 2L * 60L * 1000L;

    private byte[] extractArtworkSubfolderCover(File parent, int size) {
        if (parent == null || !parent.isDirectory()) return null;
        try {
            File[] kids = parent.listFiles();
            if (kids == null) return null;
            for (File kid : kids) {
                if (kid == null || !kid.isDirectory()) continue;
                String name = kid.getName() != null ? kid.getName().trim().toLowerCase(Locale.US) : "";
                if ("artwork".equals(name) || "cover".equals(name) || "covers".equals(name)
                        || "scans".equals(name) || "images".equals(name)) {
                    byte[] art = extractFolderCoverFromDir(kid, size);
                    if (art != null) return art;
                }
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private byte[] extractMediaStoreAlbumArt(@Nullable Uri audioUri, int size) {
        if (audioUri == null || !"media".equals(audioUri.getAuthority())) return null;
        long albumId = -1L;
        try (Cursor cursor = getContentResolver().query(
                audioUri,
                new String[]{MediaStore.Audio.Media.ALBUM_ID},
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int col = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID);
                if (col >= 0) albumId = cursor.getLong(col);
            }
        } catch (Throwable ignored) {}
        if (albumId <= 0L) return null;

        try {
            Uri albumArtUri = ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumId);
            try (InputStream is = getContentResolver().openInputStream(albumArtUri)) {
                byte[] bytes = readStreamBounded(is, 8L * 1024L * 1024L);
                byte[] jpeg = coverBytesToJpeg(bytes, size);
                if (jpeg != null) return jpeg;
            }
        } catch (Throwable ignored) {}

        if (Build.VERSION.SDK_INT >= 29) {
            try {
                Uri albumItemUri = ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, albumId);
                android.graphics.Bitmap thumb = getContentResolver().loadThumbnail(albumItemUri, new android.util.Size(size, size), null);
                if (thumb != null) {
                    try {
                        byte[] jpeg = coverBitmapToJpeg(thumb, size);
                        if (jpeg != null) return jpeg;
                    } finally {
                        try { thumb.recycle(); } catch (Throwable ignored) {}
                    }
                }
            } catch (Throwable ignored) {}
        }
        return null;
    }

    private byte[] extractCoverJpeg(String uriParam, String pathParam, int size) {
        Uri contentUri = null;
        File file = null;
        if (uriParam != null && uriParam.startsWith("content://")) {
            contentUri = Uri.parse(uriParam);
        }
        if (pathParam != null && !pathParam.isEmpty()) {
            file = new File(pathParam);
            if (!file.exists()) {
                try {
                    String safeEncoded = pathParam.replace("+", "%2B");
                    File decoded = new File(URLDecoder.decode(safeEncoded, StandardCharsets.UTF_8.name()));
                    if (decoded.exists()) file = decoded;
                } catch (Exception ignored) {}
            }
            if (contentUri == null && (!file.exists() || !file.canRead())) {
                contentUri = resolveMediaStoreContentUriForPath(file.getAbsolutePath());
            }
        }
        if ((file == null || !file.exists()) && contentUri != null) {
            file = resolveFileFromContentUri(contentUri);
        }

        // 1. Embedded picture (ID3 APIC / FLAC PICTURE / MP4 covr)
        android.media.MediaMetadataRetriever mmr = new android.media.MediaMetadataRetriever();
        try {
            if (contentUri != null) {
                mmr.setDataSource(MainActivity.this, contentUri);
            } else if (file != null && file.canRead()) {
                mmr.setDataSource(file.getAbsolutePath());
            }
            byte[] pic = mmr.getEmbeddedPicture();
            byte[] jpeg = coverBytesToJpeg(pic, size);
            if (jpeg != null) return jpeg;
        } catch (Throwable ignored) {
        } finally {
            try { mmr.release(); } catch (Throwable ignored) {}
        }

        // 1b. Binary FLAC METADATA_BLOCK_PICTURE / Vorbis base64 + DSF tail ID3v2 APIC / PIC (File & contentUri)
        byte[] binaryArt = extractBinaryEmbeddedArt(contentUri, file);
        if (binaryArt != null) {
            byte[] jpeg = coverBytesToJpeg(binaryArt, size);
            if (jpeg != null) return jpeg;
        }

        // 2. MediaStore album art (ALBUM_ID) & thumbnail (Android 10+)
        Uri thumbUri = contentUri;
        if (thumbUri == null && file != null) thumbUri = resolveMediaStoreContentUriForPath(file.getAbsolutePath());
        byte[] msAlbumArt = extractMediaStoreAlbumArt(thumbUri, size);
        if (msAlbumArt != null) return msAlbumArt;
        if (Build.VERSION.SDK_INT >= 29 && thumbUri != null && "media".equals(thumbUri.getAuthority())) {
            try {
                android.graphics.Bitmap thumb = getContentResolver().loadThumbnail(thumbUri, new android.util.Size(size, size), null);
                if (thumb != null) {
                    try {
                        byte[] jpeg = coverBitmapToJpeg(thumb, size);
                        if (jpeg != null) return jpeg;
                    } finally {
                        try { thumb.recycle(); } catch (Throwable ignored) {}
                    }
                }
            } catch (Throwable ignored) {}
        }

        // 3. Folder art next to the track, multi-disc parent folder, or Artwork/Covers subfolders
        File parent = file != null ? file.getParentFile() : null;
        if (parent != null) {
            byte[] directFolderArt = extractFolderCoverFromDir(parent, size);
            if (directFolderArt != null) return directFolderArt;
            String pName = parent.getName() != null ? parent.getName().trim().toLowerCase(Locale.US) : "";
            if (pName.matches("^(?:cd|disc|disk|sacd|side)\\s*[-_#.]?\\s*(?:\\d+|[a-d]|[ivx]+).*")) {
                File grandParent = parent.getParentFile();
                byte[] albumParentArt = extractFolderCoverFromDir(grandParent, size);
                if (albumParentArt != null) return albumParentArt;
                byte[] subArt = extractArtworkSubfolderCover(grandParent, size);
                if (subArt != null) return subArt;
            }
            byte[] directSubArt = extractArtworkSubfolderCover(parent, size);
            if (directSubArt != null) return directSubArt;
        }
        return null;
    }

    private void pruneCoverCache(File dir) {
        try {
            File[] files = dir.listFiles();
            if (files == null) return;
            long total = 0;
            for (File f : files) total += f.length();
            if (files.length <= COVER_CACHE_MAX_FILES && total <= COVER_CACHE_MAX_BYTES) return;
            java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            int count = files.length;
            for (File f : files) {
                if (count <= COVER_CACHE_MAX_FILES * 3 / 4 && total <= COVER_CACHE_MAX_BYTES * 3 / 4) break;
                long len = f.length();
                if (f.delete()) { total -= len; count--; }
            }
        } catch (Throwable ignored) {}
    }

    private WebResourceResponse buildCoverResponse(int status, String reason, byte[] body) {
        Map<String, String> headers = new HashMap<>(buildLocalMediaCorsHeaders());
        if (status == 200 && body != null) {
            headers.put("Content-Type", "image/jpeg");
            headers.put("Content-Length", String.valueOf(body.length));
            headers.put("Cache-Control", "public, max-age=31536000");
            return new WebResourceResponse("image/jpeg", null, status, reason, headers, new ByteArrayInputStream(body));
        }
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, headers, new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse handleLocalCoverArt(WebResourceRequest request) {
        try {
            Uri uri = request.getUrl();
            String uriParam = uri.getQueryParameter("uri");
            String pathParam = uri.getQueryParameter("path");
            String keyParam = uri.getQueryParameter("key");
            int size = 320;
            try {
                size = Math.max(96, Math.min(512, Integer.parseInt(uri.getQueryParameter("size"))));
            } catch (Exception ignored) {}
            if (uriParam != null && !uriParam.isEmpty() && !uriParam.startsWith("content://")) {
                try {
                    String decodedUri = URLDecoder.decode(uriParam.replace("+", "%2B"), StandardCharsets.UTF_8.name());
                    if (decodedUri.startsWith("content://")) uriParam = decodedUri;
                } catch (Exception ignored) {}
            }
            String source = (uriParam != null && !uriParam.isEmpty()) ? uriParam : (pathParam != null ? pathParam : "");
            if (source.isEmpty()) return buildCoverResponse(400, "Bad Request", null);

            String identity = (keyParam != null && !keyParam.isEmpty()) ? "v3k:" + keyParam : "v3s:" + source;
            String hash = coverSha1Hex(identity + "|" + size);
            String sourceHash = coverSha1Hex("v3src:" + source + "|" + size);
            File dir = new File(getCacheDir(), "covers");
            if (!dir.exists()) dir.mkdirs();
            File jpg = new File(dir, hash + ".jpg");
            File none = new File(dir, sourceHash + ".none");

            byte[] cached = coverReadSmallFile(jpg, 2L * 1024L * 1024L);
            if (cached != null) {
                jpg.setLastModified(System.currentTimeMillis());
                return buildCoverResponse(200, "OK", cached);
            }
            if (none.exists()) {
                if ((System.currentTimeMillis() - none.lastModified()) < COVER_NONE_TTL_MS) {
                    return buildCoverResponse(404, "Not Found", null);
                }
                try { none.delete(); } catch (Throwable ignored) {}
            }

            if (mCoverHashLocks.size() > 256) mCoverHashLocks.clear();
            Object hashLock = mCoverHashLocks.computeIfAbsent(hash, k -> new Object());
            synchronized (hashLock) {
                cached = coverReadSmallFile(jpg, 2L * 1024L * 1024L);
                if (cached != null) {
                    jpg.setLastModified(System.currentTimeMillis());
                    return buildCoverResponse(200, "OK", cached);
                }
                if (none.exists() && (System.currentTimeMillis() - none.lastModified()) < COVER_NONE_TTL_MS) {
                    return buildCoverResponse(404, "Not Found", null);
                }

                boolean acquired = false;
                try {
                    acquired = COVER_ART_PERMITS.tryAcquire(15, java.util.concurrent.TimeUnit.SECONDS);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
                if (!acquired) return buildCoverResponse(503, "Busy", null);
                int previousPriority = Process.getThreadPriority(Process.myTid());
                try {
                    Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
                    byte[] jpeg = extractCoverJpeg(uriParam, pathParam, size);
                    if (jpeg == null) {
                        try {
                            none.createNewFile();
                            none.setLastModified(System.currentTimeMillis());
                        } catch (Throwable ignored) {}
                        return buildCoverResponse(404, "Not Found", null);
                    }
                    try { if (none.exists()) none.delete(); } catch (Throwable ignored) {}
                    File tmp = new File(dir, hash + ".tmp");
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(tmp)) {
                        fos.write(jpeg);
                    }
                    if (!tmp.renameTo(jpg)) tmp.delete();
                    if (mCoverWrites.incrementAndGet() % 20 == 0) pruneCoverCache(dir);
                    return buildCoverResponse(200, "OK", jpeg);
                } finally {
                    try { Process.setThreadPriority(previousPriority); } catch (Throwable ignored) {}
                    COVER_ART_PERMITS.release();
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "local-cover failed: " + t.getMessage());
            return buildCoverResponse(404, "Not Found", null);
        }
    }
    /**
     * Handles local media streaming for URLs matching:
     * - https://appassets.androidplatform.net/local-media?uri=<encoded_content_uri>&name=<optional_filename>
     * - https://appassets.androidplatform.net/local-media?path=<encoded_path>
     * Implements HTTP 206 Partial Content (Range header: bytes=start-end) support,
     * Content-Range, Content-Length, CORS headers, and proper audio MIME types.
     */
    /**
     * Parses HTTP Range header ("bytes=start-end", "bytes=start-", "bytes=-suffix", case-insensitive, first range only).
     * Returns:
     * - null if no valid Range header (serve full 200 OK)
     * - long[]{-1L, -1L, 0L} if Range is unsatisfiable (serve 416)
     * - long[]{start, end, 1L} if satisfiable (serve 206 Partial Content)
     */
    public static long[] parseByteRangeHeader(@Nullable String rangeHeader, long totalLength) {
        if (rangeHeader == null || totalLength <= 0) return null;
        String trimmed = rangeHeader.trim();
        if (trimmed.length() < 7 || !trimmed.regionMatches(true, 0, "bytes=", 0, 6)) {
            return null;
        }
        String spec = trimmed.substring(6).trim();
        int commaIdx = spec.indexOf(',');
        if (commaIdx >= 0) {
            spec = spec.substring(0, commaIdx).trim();
        }
        int dashIdx = spec.indexOf('-');
        if (dashIdx < 0) return null;
        long start;
        long end = totalLength - 1;
        try {
            if (dashIdx == 0) {
                long suffix = Long.parseLong(spec.substring(1).trim());
                if (suffix <= 0) return new long[]{-1L, -1L, 0L};
                start = Math.max(0L, totalLength - suffix);
            } else {
                String sStart = spec.substring(0, dashIdx).trim();
                String sEnd = spec.substring(dashIdx + 1).trim();
                start = Long.parseLong(sStart);
                if (!sEnd.isEmpty()) {
                    end = Long.parseLong(sEnd);
                }
            }
        } catch (NumberFormatException e) {
            return null;
        }
        if (start < 0 || start >= totalLength || end < start) {
            return new long[]{-1L, -1L, 0L};
        }
        if (end >= totalLength) {
            end = totalLength - 1;
        }
        return new long[]{start, end, 1L};
    }

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

            if (fileLength <= 0) {
                Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
                respHeaders.put("Content-Type", mimeType);
                respHeaders.put("Content-Length", "0");
                respHeaders.put("Accept-Ranges", "bytes");
                respHeaders.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mimeType, null, 200, "OK", respHeaders, new ByteArrayInputStream(new byte[0]));
            }

            long start = 0;
            long end = fileLength - 1;
            boolean isRange = false;

            long[] parsedRange = parseByteRangeHeader(rangeHeader, fileLength);
            if (parsedRange != null) {
                if (parsedRange[2] == 0L) {
                    Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
                    respHeaders.put("Content-Range", "bytes */" + fileLength);
                    return new WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", respHeaders,
                            new ByteArrayInputStream(new byte[0]));
                }
                start = parsedRange[0];
                end = parsedRange[1];
                isRange = true;
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
            try {
                return new WebResourceResponse(mimeType, null, 200, "OK", respHeaders, afd.createInputStream());
            } catch (IOException openErr) {
                try { afd.close(); } catch (IOException ignored) {}
                throw openErr;
            }
        }

        long start = 0;
        long end = totalLength - 1;
        boolean isRange = false;

        long[] parsedRange = parseByteRangeHeader(rangeHeader, totalLength);
        if (parsedRange != null) {
            if (parsedRange[2] == 0L) {
                try { afd.close(); } catch (IOException ignored) {}
                Map<String, String> respHeaders = buildLocalMediaCorsHeaders();
                respHeaders.put("Content-Range", "bytes */" + totalLength);
                return new WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", respHeaders,
                        new ByteArrayInputStream(new byte[0]));
            }
            start = parsedRange[0];
            end = parsedRange[1];
            isRange = true;
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

        try {
            InputStream is = new BoundedContentUriInputStream(afd, start, contentLength);
            return new WebResourceResponse(mimeType, null, statusCode, statusReason, respHeaders, is);
        } catch (IOException streamErr) {
            try { afd.close(); } catch (IOException ignored) {}
            throw streamErr;
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
                dispatchPlayToWeb();
                break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                dispatchPauseToWeb();
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
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
        mPausedByTransientFocusLoss = false;
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

    public void dispatchPlayToWeb() {
        mPausedByTransientFocusLoss = false;
        runOnUiThread(() -> {
            if (mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused())) {
                if (mBitPerfectPlayer.isPaused()) {
                    mBitPerfectPlayer.resume();
                    if (mWebView != null) {
                        mWebView.evaluateJavascript(
                                "if (typeof window.onNativeBitPerfectStateChange === 'function') { window.onNativeBitPerfectStateChange(true); }",
                                null
                        );
                    }
                }
                return;
            }
            if (mWebView != null) {
                mWebView.evaluateJavascript(
                        "if (typeof window.onHardwarePlay === 'function') { window.onHardwarePlay(); } else { var b = document.getElementById('play-button'); if (b && b.textContent && b.textContent.indexOf('\\u25B6') !== -1) b.click(); }",
                        null
                );
            }
        });
    }

    public void dispatchPauseToWeb() {
        mPausedByTransientFocusLoss = false;
        runOnUiThread(() -> {
            if (mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused())) {
                if (mBitPerfectPlayer.isPlaying()) {
                    mBitPerfectPlayer.pause();
                    if (mWebView != null) {
                        mWebView.evaluateJavascript(
                                "if (typeof window.onNativeBitPerfectStateChange === 'function') { window.onNativeBitPerfectStateChange(false); }",
                                null
                        );
                    }
                }
                return;
            }
            if (mWebView != null) {
                mWebView.evaluateJavascript(
                        "if (typeof window.onHardwarePause === 'function') { window.onHardwarePause(); } else { var b = document.getElementById('play-button'); if (b && b.textContent && b.textContent.indexOf('\\u2161') !== -1) b.click(); }",
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
                    dispatchPlayToWeb();
                }

                @Override
                public void onPause() {
                    dispatchPauseToWeb();
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
                    dispatchPauseToWeb();
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
        mIsMediaPlaying = isPlaying;
        NocturnePlaybackService.sCurrentAlbumArt = loadCachedCoverBitmap(album, artist);
        if (isPlaying) {
            boolean needWifi = !(mBitPerfectPlayer != null && mBitPerfectPlayer.isPlaying() && !mBitPerfectPlayer.isRemoteStream());
            acquireWakeLock(needWifi);
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

    private static String stripFeaturedArtistForCoverKey(@Nullable String rawArtist) {
        if (rawArtist == null) return "";
        String cleaned = rawArtist.trim();
        if (cleaned.isEmpty()) return "";
        cleaned = cleaned.replaceAll("(?i)\\s*\\([^)]*(?:feat\\.?|ft\\.?|featuring|cùng|với|hợp\\s+tác)[^)]*\\)", "");
        cleaned = cleaned.replaceAll("(?i)\\s*\\[[^\\]]*(?:feat\\.?|ft\\.?|featuring|cùng|với|hợp\\s+tác)[^\\]]*\\]", "");
        cleaned = cleaned.replaceAll("(?i)\\s+(?:feat\\.?|ft\\.?|featuring|cùng|với|hợp\\s+tác|x|×)\\s+.*$", "");
        String[] inlineSeps = new String[] { " & ", " + ", ";", ",", " · ", "、", " - " };
        for (String sep : inlineSeps) {
            int idx = cleaned.indexOf(sep);
            if (idx > 0) cleaned = cleaned.substring(0, idx);
        }
        return cleaned.trim();
    }

    @Nullable
    private android.graphics.Bitmap decodeCachedCoverHash(@Nullable String hash) {
        if (hash == null || hash.isEmpty()) return null;
        File jpg = new File(new File(getCacheDir(), "covers"), hash + ".jpg");
        if (!jpg.isFile() || jpg.length() <= 0 || jpg.length() > 1024 * 1024) return null;
        return android.graphics.BitmapFactory.decodeFile(jpg.getAbsolutePath());
    }

    private android.graphics.Bitmap loadCachedCoverBitmap(@Nullable String album, @Nullable String artist) {
        try {
            String a = album != null ? album.trim() : "";
            String ar = artist != null ? artist.trim() : "";
            boolean validAlbum = !a.isEmpty() && !"FiiO Internal & SD Card".equalsIgnoreCase(a) && !"Unknown Album".equalsIgnoreCase(a);
            boolean validArtist = !ar.isEmpty() && !"Unknown Artist".equalsIgnoreCase(ar);
            if (validAlbum && validArtist) {
                String key = (a + "|" + ar).toLowerCase(Locale.US);
                String hash = coverSha1Hex("v3k:" + key + "|320");
                android.graphics.Bitmap exactBmp = decodeCachedCoverHash(hash);
                if (exactBmp != null) return exactBmp;
                String primaryAr = stripFeaturedArtistForCoverKey(ar);
                if (!primaryAr.isEmpty() && !primaryAr.equalsIgnoreCase(ar)) {
                    String primaryHash = coverSha1Hex("v3k:" + (a + "|" + primaryAr).toLowerCase(Locale.US) + "|320");
                    android.graphics.Bitmap primaryBmp = decodeCachedCoverHash(primaryHash);
                    if (primaryBmp != null) return primaryBmp;
                }
            }
            if (mBitPerfectPlayer != null) {
                String activeSrc = mBitPerfectPlayer.getCurrentSourceKey();
                if (activeSrc != null && !activeSrc.isEmpty()) {
                    android.graphics.Bitmap srcBmp = decodeCachedCoverHash(coverSha1Hex("v3s:" + activeSrc + "|320"));
                    if (srcBmp != null) return srcBmp;
                }
            }
            return null;
        } catch (Throwable ignored) {
            return null;
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
            if (mBitPerfectPlayer != null && (mBitPerfectPlayer.isPlaying() || mBitPerfectPlayer.isPaused()) && mBitPerfectPlayer.getDurationMs() > 0) {
                mb.putLong(MediaMetadata.METADATA_KEY_DURATION, mBitPerfectPlayer.getDurationMs());
            }
            android.graphics.Bitmap coverBmp = loadCachedCoverBitmap(album, displayArtist);
            NocturnePlaybackService.sCurrentAlbumArt = coverBmp;
            if (coverBmp != null) {
                mb.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, coverBmp);
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
            android.graphics.Bitmap coverBmp = loadCachedCoverBitmap(displayAlbum, displayArtist);

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
            if (coverBmp != null) {
                builder.setLargeIcon(coverBmp);
            }

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
                    if (coverBmp != null) {
                        mb.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, coverBmp);
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
        private volatile boolean mIsRemoteStream = false;
        // v3.9.25: epoch guard so a stale (slow-to-die) playback thread can never clobber the next session's state.
        private final AtomicInteger mPlaybackEpoch = new AtomicInteger(0);
        private final AtomicLong mSeekTargetUs = new AtomicLong(-1);
        private final AtomicLong mCurrentPositionMs = new AtomicLong(0);
        private final AtomicLong mDurationMs = new AtomicLong(0);

        private Thread mPlaybackThread = null;
        private volatile AudioTrack mAudioTrack = null;
        private boolean mPreferredMixerAttributesSet = false;
        private volatile String mCurrentSourceKey = "";
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
            mIsRemoteStream = !(trimmedUrl.startsWith("/") || trimmedUrl.startsWith("file://") || trimmedUrl.startsWith("content://") || trimmedUrl.contains("/local-media?"));
            mSeekTargetUs.set(-1);
            mCurrentPositionMs.set(0);
            mDurationMs.set(0);

            acquireWakeLock(mIsRemoteStream);
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

            final int playbackEpoch = mPlaybackEpoch.incrementAndGet();
            mPlaybackThread = new Thread(() -> {
                Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
                runPlaybackLoop(trimmedUrl, sampleRate, bitDepth, playbackEpoch);
            }, "BitPerfectAudioThread");
            mPlaybackThread.start();

            return true;
        }

        public void pause() {
            if (!isActive()) return;
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
            acquireWakeLock(mIsRemoteStream);
            requestAudioFocus();
            if (!isActive()) {
                releaseWakeLock();
                abandonAudioFocus();
                return;
            }
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
            long clampedMs = Math.max(0L, positionMs);
            long durMs = mDurationMs.get();
            if (durMs > 0L) {
                clampedMs = Math.min(clampedMs, durMs);
            }
            mSeekTargetUs.set(clampedMs * 1000L);
            mCurrentPositionMs.set(clampedMs);
            synchronized (mPauseLock) {
                mPauseLock.notifyAll();
            }
            if (!mIsStopped) {
                updateMediaSessionMetadata(
                        mCurrentTrackTitle,
                        mCurrentTrackArtist,
                        mCurrentTrackAlbum,
                        isPlaying());
                final long posForJs = clampedMs;
                final long durForJs = Math.max(0L, durMs);
                runOnUiThread(() -> {
                    if (!mIsStopped && mWebView != null && !isFinishing() && !isDestroyed()) {
                        mWebView.evaluateJavascript(
                                "if (typeof window.onNativeBitPerfectPosition === 'function') window.onNativeBitPerfectPosition(" + posForJs + ", " + durForJs + ");",
                                null);
                    }
                });
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
            mPlaybackEpoch.incrementAndGet();
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
            mCurrentSourceKey = "";
            if (!preserveSession) {
                cancelMediaNotification();
                releaseWakeLock();
                abandonAudioFocus();
            }
        }

        public boolean isActive() {
            return mIsPlaying && !mIsStopped && mPlaybackThread != null && mPlaybackThread.isAlive();
        }

        public String getCurrentSourceKey() {
            return mCurrentSourceKey;
        }

        public boolean isPlaying() {
            return mIsPlaying && !mIsPaused;
        }

        public boolean isPaused() {
            return mIsPaused;
        }

        public boolean isRemoteStream() {
            return mIsRemoteStream;
        }

        public long getPositionMs() {
            return mCurrentPositionMs.get();
        }

        public long getDurationMs() {
            return mDurationMs.get();
        }

        private static int pcmBytesPerFrame(int channels, int pcmEncoding) {
            int bytesPerSample = (pcmEncoding == AudioFormat.ENCODING_PCM_16BIT) ? 2
                    : (pcmEncoding == AudioFormat.ENCODING_PCM_24BIT_PACKED ? 3 : 4);
            return Math.max(1, channels) * bytesPerSample;
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

        private void runPlaybackLoop(String urlOrPath, int requestedSampleRate, int requestedBitDepth, final int epoch) {
            MediaExtractor extractor = new MediaExtractor();
            MediaCodec decoder = null;
            AudioTrack track = null;
            AudioDeviceInfo preferredDevice = null;
            AudioAttributes audioAttributes = null;
            String pendingErrorReason = null;

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

                mCurrentSourceKey = (resolvedUri != null && !resolvedUri.isEmpty())
                        ? resolvedUri
                        : (resolvedPath != null ? resolvedPath : "");

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
                if (mDurationMs.get() <= 0) {
                    android.media.MediaMetadataRetriever durMmr = new android.media.MediaMetadataRetriever();
                    try {
                        boolean mmrBound = false;
                        if (resolvedUri != null && resolvedUri.startsWith("content://")) {
                            durMmr.setDataSource(MainActivity.this, Uri.parse(resolvedUri));
                            mmrBound = true;
                        } else if (resolvedPath != null && !resolvedPath.isEmpty()) {
                            File localDurFile = new File(resolvedPath);
                            if (localDurFile.exists() && localDurFile.canRead()) {
                                durMmr.setDataSource(resolvedPath);
                                mmrBound = true;
                            } else {
                                Uri fallbackMediaUri = resolveMediaStoreContentUriForPath(resolvedPath);
                                if (fallbackMediaUri != null) {
                                    durMmr.setDataSource(MainActivity.this, fallbackMediaUri);
                                    mmrBound = true;
                                } else {
                                    durMmr.setDataSource(resolvedPath);
                                    mmrBound = true;
                                }
                            }
                        }
                        if (mmrBound) {
                            String durStr = durMmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
                            if (durStr != null && !durStr.isEmpty()) {
                                long fallbackDurMs = Long.parseLong(durStr.trim());
                                if (fallbackDurMs > 0) {
                                    mDurationMs.set(fallbackDurMs);
                                }
                            }
                        }
                    } catch (Throwable ignored) {
                    } finally {
                        try { durMmr.release(); } catch (Throwable ignored) {}
                    }
                }

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
                if (!mIsPaused && !mIsStopped) {
                    track.play();
                }
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                boolean sawInputEOS = false;
                boolean sawOutputEOS = false;
                final long TIMEOUT_US = 10000;
                long lastUiUpdateElapsedMs = 0L;
                long basePositionMs = 0L;
                long writtenFramesSinceBase = 0L;
                long lastPtsPosMs = -1L;
                int stuckPtsCount = 0;
                int bytesPerFrame = pcmBytesPerFrame(channels, pcmEncoding);

                while (!mIsStopped && !sawOutputEOS && mPlaybackEpoch.get() == epoch) {
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
                            basePositionMs = seekUs / 1000L;
                            writtenFramesSinceBase = 0L;
                            lastPtsPosMs = -1L;
                            stuckPtsCount = 0;
                            mCurrentPositionMs.set(basePositionMs);
                            lastUiUpdateElapsedMs = SystemClock.uptimeMillis();
                            if (mWebView != null && !mIsStopped) {
                                final long seekReportPosMs = basePositionMs;
                                final long seekReportDurMs = mDurationMs.get();
                                mWebView.post(() -> {
                                    if (!mIsStopped && mWebView != null) {
                                        mWebView.evaluateJavascript(
                                                "if (typeof window.onNativeBitPerfectPosition === 'function') window.onNativeBitPerfectPosition(" + seekReportPosMs + ", " + seekReportDurMs + ");",
                                                null
                                        );
                                    }
                                });
                            }
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
                            bytesPerFrame = pcmBytesPerFrame(channels, pcmEncoding);

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
                            int written = track.write(outBuf, info.size, AudioTrack.WRITE_BLOCKING);
                            if (written > 0) {
                                writtenFramesSinceBase += (written / Math.max(1, bytesPerFrame));
                            }
                            long pcmPosMs = basePositionMs + ((writtenFramesSinceBase * 1000L) / Math.max(1, sampleRate));
                            long ptsPosMs = info.presentationTimeUs > 0 ? (info.presentationTimeUs / 1000L) : -1L;
                            if (ptsPosMs > 0 && ptsPosMs == lastPtsPosMs) {
                                stuckPtsCount++;
                            } else if (ptsPosMs > 0) {
                                stuckPtsCount = 0;
                                lastPtsPosMs = ptsPosMs;
                            }
                            long posMs = (ptsPosMs > 0 && stuckPtsCount < 3)
                                    ? Math.max(ptsPosMs, Math.max(0L, pcmPosMs - 1500L))
                                    : pcmPosMs;
                            long knownDurMs = mDurationMs.get();
                            if (knownDurMs > 0 && posMs > knownDurMs) {
                                posMs = knownDurMs;
                            }
                            mCurrentPositionMs.set(posMs);
                            long nowElapsed = SystemClock.uptimeMillis();
                            final long uiUpdateIntervalMs = mIsInBackground ? 2000L : 250L;
                            if ((lastUiUpdateElapsedMs == 0L || (nowElapsed - lastUiUpdateElapsedMs >= uiUpdateIntervalMs)) && !mIsStopped && mWebView != null) {
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
                if (sawOutputEOS && !mIsStopped && mPlaybackEpoch.get() == epoch) {
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
                if (mPlaybackEpoch.get() == epoch && !mIsStopped) {
                    pendingErrorReason = e.getMessage() != null ? e.getMessage() : "Bit-Perfect playback engine error";
                }
            } finally {
                final boolean sessionCurrent = (mPlaybackEpoch.get() == epoch);
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
                    if (sessionCurrent && mPreferredMixerAttributesSet && Build.VERSION.SDK_INT >= 34 && preferredDevice != null && mAudioManager != null && audioAttributes != null) {
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

                if (sessionCurrent) {
                    mIsPlaying = false;
                    mIsPaused = false;
                    releaseWakeLock();
                    abandonAudioFocus();
                }
                if (sessionCurrent) mCurrentSourceKey = "";
                if (pendingErrorReason != null && sessionCurrent && !mIsStopped) {
                    notifyBitPerfectErrorToWeb(pendingErrorReason);
                }
            }
        }
    }

    private final BitPerfectAudioPlayer mBitPerfectPlayer = new BitPerfectAudioPlayer();

    public boolean startBitPerfectPlayback(String urlOrPath, int sampleRate, int bitDepth) {
        mPausedByTransientFocusLoss = false;
        return mBitPerfectPlayer.start(urlOrPath, sampleRate, bitDepth);
    }

    public void pauseBitPerfectPlayback() {
        mPausedByTransientFocusLoss = false;
        mBitPerfectPlayer.pause();
    }

    public void resumeBitPerfectPlayback() {
        mPausedByTransientFocusLoss = false;
        mBitPerfectPlayer.resume();
    }

    public void seekBitPerfectPlayback(long positionMs) {
        mBitPerfectPlayer.seek(positionMs);
    }

    public void stopBitPerfectPlayback() {
        mPausedByTransientFocusLoss = false;
        mBitPerfectPlayer.stop();
    }

    public boolean isBitPerfectPlaying() {
        return mBitPerfectPlayer.isPlaying();
    }

    public boolean isBitPerfectActive() {
        return mBitPerfectPlayer.isActive();
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
                String vName = pi != null && pi.versionName != null ? pi.versionName.replace("\"", "") : "3.9.50";
                String model = Build.MODEL != null ? Build.MODEL.replace("\"", "") : "Android";
                return "{\"versionName\":\"" + vName + "\",\"sdkInt\":" + Build.VERSION.SDK_INT + ",\"model\":\"" + model + "\"}";
            } catch (Exception e) {
                return "{\"versionName\":\"3.9.50\",\"sdkInt\":" + Build.VERSION.SDK_INT + ",\"model\":\"Android\"}";
            }
        }

        @JavascriptInterface
        public boolean saveFiioCatalogNative(String catalogJson) {
            if (catalogJson == null) return false;
            try {
                byte[] bytes = catalogJson.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > FIIO_CATALOG_MAX_BYTES) return false;
                File target = new File(mActivity.getFilesDir(), FIIO_CATALOG_CACHE_FILE);
                File tmp = new File(mActivity.getFilesDir(), FIIO_CATALOG_CACHE_FILE + ".tmp");
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(tmp, false)) {
                    fos.write(bytes);
                    fos.flush();
                    try { fos.getFD().sync(); } catch (Throwable ignored) {}
                }
                if (target.exists() && !target.delete()) {
                    try (java.io.FileOutputStream fos2 = new java.io.FileOutputStream(target, false)) {
                        fos2.write(bytes);
                        fos2.flush();
                    }
                    try { tmp.delete(); } catch (Throwable ignored) {}
                    return true;
                }
                return tmp.renameTo(target);
            } catch (Throwable t) {
                Log.w(TAG, "saveFiioCatalogNative warning: " + t.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public String loadFiioCatalogNative() {
            try {
                File target = new File(mActivity.getFilesDir(), FIIO_CATALOG_CACHE_FILE);
                if (!target.exists() || !target.isFile()) return "";
                long len = target.length();
                if (len <= 0 || len > FIIO_CATALOG_MAX_BYTES) return "";
                try (FileInputStream fis = new FileInputStream(target);
                     ByteArrayOutputStream bos = new ByteArrayOutputStream((int) len)) {
                    byte[] buf = new byte[16384];
                    int read;
                    while ((read = fis.read(buf)) != -1) {
                        bos.write(buf, 0, read);
                    }
                    return new String(bos.toByteArray(), StandardCharsets.UTF_8);
                }
            } catch (Throwable t) {
                Log.w(TAG, "loadFiioCatalogNative warning: " + t.getMessage());
                return "";
            }
        }

        @JavascriptInterface
        public String getFiioStorageLinkStateJson() {
            try {
                SharedPreferences prefs = mActivity.getSharedPreferences("nocturne_prefs", Context.MODE_PRIVATE);
                boolean linked = prefs.getBoolean(PREF_FIIO_STORAGE_LINKED, false);
                String rootsRaw = prefs.getString(PREF_FIIO_LINKED_ROOTS, "[]");
                int lastCount = prefs.getInt(PREF_FIIO_LAST_COUNT, 0);
                long lastTs = prefs.getLong(PREF_FIIO_LAST_TS, 0L);
                JSONArray rootsArr;
                try {
                    rootsArr = new JSONArray(rootsRaw);
                } catch (Exception ignored) {
                    rootsArr = new JSONArray();
                }
                JSONObject out = new JSONObject();
                out.put("linked", linked);
                out.put("hasPermission", mActivity.hasStoragePermission());
                out.put("linkedRoots", rootsArr);
                out.put("lastTrackCount", lastCount);
                out.put("lastScanTs", lastTs);
                return out.toString();
            } catch (Throwable t) {
                return "{\"linked\":false,\"hasPermission\":" + (mActivity.hasStoragePermission() ? "true" : "false") + ",\"linkedRoots\":[],\"lastTrackCount\":0,\"lastScanTs\":0}";
            }
        }

        @JavascriptInterface
        public boolean setFiioStorageLinkState(boolean linked, @Nullable String rootsJson, int trackCount) {
            try {
                SharedPreferences prefs = mActivity.getSharedPreferences("nocturne_prefs", Context.MODE_PRIVATE);
                SharedPreferences.Editor ed = prefs.edit();
                ed.putBoolean(PREF_FIIO_STORAGE_LINKED, linked);
                if (rootsJson != null && !rootsJson.trim().isEmpty()) {
                    ed.putString(PREF_FIIO_LINKED_ROOTS, rootsJson.trim());
                }
                if (trackCount >= 0) {
                    ed.putInt(PREF_FIIO_LAST_COUNT, trackCount);
                }
                ed.putLong(PREF_FIIO_LAST_TS, System.currentTimeMillis());
                ed.apply();
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        private static final int MAX_LOCAL_LYRICS_TEXT_BYTES = 256 * 1024;
        private static final int MAX_LOCAL_FLAC_VORBIS_BYTES = 512 * 1024;

        private static long readLeUint32(byte[] buf, int off) {
            if (buf == null || off < 0 || off + 4 > buf.length) return -1L;
            return ((long) (buf[off] & 0xFF))
                    | (((long) (buf[off + 1] & 0xFF)) << 8)
                    | (((long) (buf[off + 2] & 0xFF)) << 16)
                    | (((long) (buf[off + 3] & 0xFF)) << 24);
        }

        private static String decodeLyricsBytes(byte[] raw) {
            if (raw == null || raw.length == 0) return "";
            String text;
            if (raw.length >= 3 && (raw[0] & 0xFF) == 0xEF && (raw[1] & 0xFF) == 0xBB && (raw[2] & 0xFF) == 0xBF) {
                text = new String(raw, 3, raw.length - 3, StandardCharsets.UTF_8);
            } else if (raw.length >= 2 && (raw[0] & 0xFF) == 0xFF && (raw[1] & 0xFF) == 0xFE) {
                text = new String(raw, 2, raw.length - 2, StandardCharsets.UTF_16LE);
            } else if (raw.length >= 2 && (raw[0] & 0xFF) == 0xFE && (raw[1] & 0xFF) == 0xFF) {
                text = new String(raw, 2, raw.length - 2, StandardCharsets.UTF_16BE);
            } else {
                text = new String(raw, StandardCharsets.UTF_8);
            }
            if (text.startsWith("\uFEFF")) text = text.substring(1);
            return text.trim();
        }

        private static String readLocalLyricsTextFile(File f) {
            if (f == null || !f.exists() || !f.isFile() || !f.canRead()) return "";
            long len = f.length();
            if (len <= 0L || len > MAX_LOCAL_LYRICS_TEXT_BYTES) return "";
            try (FileInputStream fis = new FileInputStream(f);
                 ByteArrayOutputStream bos = new ByteArrayOutputStream((int) len)) {
                byte[] buf = new byte[8192];
                int read;
                int total = 0;
                while ((read = fis.read(buf)) != -1) {
                    if (total + read > MAX_LOCAL_LYRICS_TEXT_BYTES) return "";
                    bos.write(buf, 0, read);
                    total += read;
                }
                return decodeLyricsBytes(bos.toByteArray());
            } catch (Throwable ignored) {
                return "";
            }
        }

        private static String extractFlacVorbisLyricsFromFile(File f) {
            if (f == null || !f.exists() || !f.isFile() || !f.canRead()) return "";
            try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r")) {
                long fileLen = raf.length();
                if (fileLen < 42L) return "";
                byte[] lead = new byte[14];
                raf.readFully(lead);
                long pos = 0L;
                if (lead[0] == 'I' && lead[1] == 'D' && lead[2] == '3') {
                    int flags = lead[5] & 0xFF;
                    int tagSize = ((lead[6] & 0x7F) << 21)
                            | ((lead[7] & 0x7F) << 14)
                            | ((lead[8] & 0x7F) << 7)
                            | (lead[9] & 0x7F);
                    pos = 10L + tagSize + ((flags & 0x10) != 0 ? 10L : 0L);
                }
                if (pos < 0L || pos + 4L > fileLen) return "";
                raf.seek(pos);
                byte[] magic = new byte[4];
                raf.readFully(magic);
                if (magic[0] != 'f' || magic[1] != 'L' || magic[2] != 'a' || magic[3] != 'C') return "";
                pos += 4L;
                long maxScanPos = 16L * 1024L * 1024L;
                byte[] bh = new byte[4];
                for (int guard = 0; guard < 128 && pos + 4L <= fileLen && pos <= maxScanPos; guard++) {
                    raf.seek(pos);
                    raf.readFully(bh);
                    int hdr = bh[0] & 0xFF;
                    boolean isLast = (hdr & 0x80) != 0;
                    int blockType = hdr & 0x7F;
                    int blockLen = ((bh[1] & 0xFF) << 16) | ((bh[2] & 0xFF) << 8) | (bh[3] & 0xFF);
                    long dataStart = pos + 4L;
                    long dataEnd = dataStart + blockLen;
                    if (blockLen < 0 || dataEnd > fileLen) break;
                    if (blockType == 4 && blockLen >= 8 && blockLen <= MAX_LOCAL_FLAC_VORBIS_BYTES) {
                        byte[] vc = new byte[blockLen];
                        raf.readFully(vc);
                        int vp = 0;
                        long vendorLen = readLeUint32(vc, vp);
                        vp += 4;
                        if (vendorLen >= 0L && vendorLen <= blockLen && vp + (int) vendorLen + 4 <= blockLen) {
                            vp += (int) vendorLen;
                            long count = readLeUint32(vc, vp);
                            vp += 4;
                            String unsynced = "";
                            for (long i = 0; i < count && i < 512L && vp + 4 <= blockLen; i++) {
                                long itemLen = readLeUint32(vc, vp);
                                vp += 4;
                                if (itemLen < 0L || itemLen > (blockLen - vp)) break;
                                String entry = new String(vc, vp, (int) itemLen, StandardCharsets.UTF_8);
                                vp += (int) itemLen;
                                int eq = entry.indexOf('=');
                                if (eq > 0) {
                                    String key = entry.substring(0, eq).trim().toUpperCase(Locale.US);
                                    if ("LYRICS".equals(key)) {
                                        String val = entry.substring(eq + 1).trim();
                                        if (!val.isEmpty()) return val;
                                    } else if ("UNSYNCEDLYRICS".equals(key) && unsynced.isEmpty()) {
                                        String val = entry.substring(eq + 1).trim();
                                        if (!val.isEmpty()) unsynced = val;
                                    }
                                }
                            }
                            if (!unsynced.isEmpty()) return unsynced;
                        }
                    }
                    pos = dataEnd;
                    if (isLast) break;
                }
            } catch (Throwable ignored) {}
            return "";
        }

        @JavascriptInterface
        public String readLocalLyrics(@Nullable String filePath, @Nullable String contentUri) {
            try {
                File audioFile = null;
                if (filePath != null && !filePath.trim().isEmpty()) {
                    File f = new File(filePath.trim());
                    if (f.exists() && f.isFile()) audioFile = f;
                }
                if (audioFile == null && contentUri != null && !contentUri.trim().isEmpty()) {
                    try {
                        audioFile = mActivity.resolveFileFromContentUri(Uri.parse(contentUri.trim()));
                    } catch (Throwable ignored) {}
                }
                if (audioFile == null || !audioFile.exists() || !audioFile.isFile()) return "";

                String rawName = audioFile.getName();
                int dot = rawName.lastIndexOf('.');
                String baseName = dot > 0 ? rawName.substring(0, dot) : rawName;
                File parent = audioFile.getParentFile();
                if (parent != null && parent.isDirectory() && !baseName.isEmpty()) {
                    File[] siblings = parent.listFiles();
                    if (siblings != null) {
                        File bestFile = null;
                        int bestRank = 99;
                        for (File kid : siblings) {
                            if (kid == null || !kid.isFile()) continue;
                            String kn = kid.getName();
                            int kd = kn.lastIndexOf('.');
                            if (kd <= 0) continue;
                            if (!kn.substring(0, kd).equalsIgnoreCase(baseName)) continue;
                            String ext = kn.substring(kd).toLowerCase(Locale.US);
                            int rank = ".lrc".equals(ext) ? 1 : (".lyricsfile".equals(ext) ? 2 : (".txt".equals(ext) ? 3 : 99));
                            if (rank < bestRank) {
                                bestRank = rank;
                                bestFile = kid;
                            }
                        }
                        if (bestFile != null) {
                            String sidecar = readLocalLyricsTextFile(bestFile);
                            if (!sidecar.isEmpty()) return sidecar;
                        }
                    }
                }
                if (rawName.toLowerCase(Locale.US).endsWith(".flac")) {
                    String embedded = extractFlacVorbisLyricsFromFile(audioFile);
                    if (!embedded.isEmpty()) return embedded;
                }
            } catch (Throwable ignored) {}
            return "";
        }

        @JavascriptInterface
        public int clearLocalCoverCache() {
            int deleted = 0;
            try {
                File dir = new File(mActivity.getCacheDir(), "covers");
                if (dir.exists() && dir.isDirectory()) {
                    File[] files = dir.listFiles();
                    if (files != null) {
                        for (File f : files) {
                            try {
                                if (f != null && f.isFile() && f.delete()) {
                                    deleted++;
                                }
                            } catch (Throwable ignored) {}
                        }
                    }
                }
                mActivity.mCoverHashLocks.clear();
            } catch (Throwable ignored) {}
            return deleted;
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
            String[] baseProjection = new String[]{
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
            String[] extendedProjection = new String[]{
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
                    MediaStore.Audio.Media.YEAR,
                    "album_artist"
            };
            String sortOrder = MediaStore.Audio.Media.DATE_ADDED + " DESC";
            Cursor cursor = null;
            try {
                try {
                    cursor = mActivity.getContentResolver().query(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            extendedProjection,
                            null,
                            null,
                            sortOrder
                    );
                } catch (IllegalArgumentException | android.database.sqlite.SQLiteException colErr) {
                    cursor = mActivity.getContentResolver().query(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            baseProjection,
                            null,
                            null,
                            sortOrder
                    );
                }
                if (cursor != null) {
                    int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int nameCol = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);
                    int titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
                    int artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                    int albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
                    int albumArtistCol = cursor.getColumnIndex("album_artist");
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
                        String albumArtist = albumArtistCol >= 0 ? cursor.getString(albumArtistCol) : null;
                        long durationMs = durCol >= 0 ? cursor.getLong(durCol) : 0L;
                        int rawTrack = trackCol >= 0 ? cursor.getInt(trackCol) : 0;
                        int year = yearCol >= 0 ? cursor.getInt(yearCol) : 0;

                        JSONObject obj = new JSONObject();
                        obj.put("uri", contentUri.toString());
                        obj.put("name", displayName);
                        obj.put("title", title != null ? title : "");
                        obj.put("artist", artist != null ? artist : "");
                        obj.put("album", album != null ? album : "");
                        if (albumArtist != null && !albumArtist.trim().isEmpty()) {
                            obj.put("albumArtist", albumArtist.trim());
                        }
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
            } finally {
                if (cursor != null) {
                    try { cursor.close(); } catch (Throwable ignored) {}
                }
            }
            return results.toString();
        }

        /**
         * Non-blocking background chunked storage scanner for FiiO M11S & Android 10-15.
         * Streams 250-track chunks to WebView without freezing the UI thread or triggering Android ANR
         * on 5,000+ track MicroSD libraries, while skipping redundant overlapping sub-paths.
         */
        @JavascriptInterface
        public boolean startAsyncStorageScan(final int maxFiles) {
            if (!mActivity.mStorageScanRunning.compareAndSet(false, true)) {
                return false;
            }
            final int limit = maxFiles > 0 ? maxFiles : 10000;
            new Thread(() -> {
                Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
                final int CHUNK_SIZE = 250;
                int totalEmitted = 0;
                String errorMsg = null;
                try {
                    Set<String> seenPaths = new HashSet<>();
                    Set<String> seenUris = new HashSet<>();
                    JSONArray batch = new JSONArray();

                    // Phase 1: MediaStore ContentResolver
                    try {
                        String rawMs = scanMediaStoreAudio(limit);
                        JSONArray msArr = new JSONArray(rawMs);
                        for (int i = 0; i < msArr.length() && totalEmitted < limit; i++) {
                            JSONObject item = msArr.optJSONObject(i);
                            if (item == null) continue;
                            String p = item.optString("path", "").trim();
                            String u = item.optString("uri", "").trim();
                            if (!p.isEmpty() && !seenPaths.add(p)) continue;
                            if (!u.isEmpty() && !seenUris.add(u)) continue;
                            batch.put(item);
                            totalEmitted++;
                            if (batch.length() >= CHUNK_SIZE) {
                                emitStorageScanChunk(batch, totalEmitted, "MediaStore");
                                batch = new JSONArray();
                            }
                        }
                    } catch (Throwable msErr) {
                        Log.w(TAG, "Async MediaStore scan warning: " + msErr.getMessage());
                    }

                    // Phase 2: Deduplicated top-level storage roots (SD cards / DSD files not indexed by MediaStore)
                    List<String> rawRoots = new ArrayList<>();
                    try {
                        SharedPreferences linkPrefs = mActivity.getSharedPreferences("nocturne_prefs", Context.MODE_PRIVATE);
                        JSONArray savedRootsArr = new JSONArray(linkPrefs.getString(PREF_FIIO_LINKED_ROOTS, "[]"));
                        for (int i = 0; i < savedRootsArr.length(); i++) {
                            String sr = savedRootsArr.optString(i, "").trim();
                            if (!sr.isEmpty() && !rawRoots.contains(sr)) rawRoots.add(sr);
                        }
                    } catch (Throwable ignored) {}
                    try {
                        JSONArray rootsArr = new JSONArray(getStoragePaths());
                        for (int i = 0; i < rootsArr.length(); i++) {
                            String r = rootsArr.optString(i, "").trim();
                            if (!r.isEmpty() && !rawRoots.contains(r)) rawRoots.add(r);
                        }
                    } catch (Throwable ignored) {}
                    Collections.sort(rawRoots, (a, b) -> Integer.compare(a.length(), b.length()));
                    List<String> minimalRoots = new ArrayList<>();
                    for (String candidate : rawRoots) {
                        boolean covered = false;
                        for (String parent : minimalRoots) {
                            if (candidate.equals(parent) || candidate.startsWith(parent + "/")) {
                                covered = true;
                                break;
                            }
                        }
                        if (!covered) minimalRoots.add(candidate);
                    }

                    Set<String> visitedDirs = new HashSet<>();
                    List<String> activeRoots = new ArrayList<>();
                    for (String rootPath : minimalRoots) {
                        if (totalEmitted >= limit) break;
                        File rootDir = new File(rootPath);
                        if (!rootDir.exists() || !rootDir.canRead()) continue;
                        activeRoots.add(rootPath);
                        List<File> collected = new ArrayList<>();
                        scanDirInternal(rootDir, collected, Math.max(1, limit - totalEmitted), 0, visitedDirs);
                        for (File f : collected) {
                            if (totalEmitted >= limit) break;
                            String abs = f.getAbsolutePath();
                            if (!seenPaths.add(abs)) continue;
                            try {
                                JSONObject obj = new JSONObject();
                                obj.put("name", f.getName());
                                obj.put("path", abs);
                                obj.put("size", f.length());
                                obj.put("lastModified", f.lastModified());
                                batch.put(obj);
                                totalEmitted++;
                                if (batch.length() >= CHUNK_SIZE) {
                                    emitStorageScanChunk(batch, totalEmitted, "MicroSD");
                                    batch = new JSONArray();
                                }
                            } catch (Exception ignored) {}
                        }
                    }

                    if (batch.length() > 0) {
                        emitStorageScanChunk(batch, totalEmitted, "Storage");
                    }
                    if (totalEmitted > 0) {
                        JSONArray linkedRootsJson = new JSONArray();
                        for (String ar : (activeRoots.isEmpty() ? minimalRoots : activeRoots)) {
                            linkedRootsJson.put(ar);
                        }
                        setFiioStorageLinkState(true, linkedRootsJson.toString(), totalEmitted);
                    }
                } catch (Throwable t) {
                    errorMsg = t.getMessage() != null ? t.getMessage() : "Storage scan failed";
                    Log.w(TAG, "Async storage scan failed: " + errorMsg, t);
                } finally {
                    mActivity.mStorageScanRunning.set(false);
                    emitStorageScanDone(totalEmitted, errorMsg);
                }
            }, "NocturneStorageScanner").start();
            return true;
        }

        private void emitStorageScanChunk(final JSONArray chunk, final int totalSoFar, final String sourceLabel) {
            final String quotedJson = JSONObject.quote(chunk.toString());
            final String quotedLabel = JSONObject.quote(sourceLabel != null ? sourceLabel : "Storage");
            mActivity.runOnUiThread(() -> {
                if (mActivity.mWebView != null) {
                    try {
                        mActivity.mWebView.evaluateJavascript(
                                "if(typeof window.onAndroidStorageScanChunk==='function'){window.onAndroidStorageScanChunk(JSON.parse("
                                        + quotedJson + ")," + totalSoFar + "," + quotedLabel + ");}",
                                null
                        );
                    } catch (Throwable ignored) {}
                }
            });
        }

        private void emitStorageScanDone(final int totalCount, @Nullable final String errorMsg) {
            final String errArg = errorMsg != null ? JSONObject.quote(errorMsg) : "null";
            mActivity.runOnUiThread(() -> {
                if (mActivity.mWebView != null) {
                    try {
                        mActivity.mWebView.evaluateJavascript(
                                "if(typeof window.onAndroidStorageScanDone==='function'){window.onAndroidStorageScanDone("
                                        + totalCount + "," + errArg + ");}",
                                null
                        );
                    } catch (Throwable ignored) {}
                }
            });
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
        public boolean isBitPerfectActive() {
            return mActivity.isBitPerfectActive();
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
            String bundled = mActivity.readBundledCacheName().replace("\"", "");
            String pending = mActivity.mOtaPendingVersion != null ? mActivity.mOtaPendingVersion.replace("\"", "") : "";
            boolean isOtaActive = new File(mActivity.getOtaActiveDir(), ".ota_ready").exists() && !active.isEmpty() && !active.equals(bundled);
            return "{\"activeVersion\":\"" + active + "\",\"bundledVersion\":\"" + bundled + "\",\"pendingVersion\":\"" + pending + "\",\"isOtaActive\":" + (isOtaActive ? "true" : "false") + ",\"apkVersionCode\":" + BuildConfig.VERSION_CODE + "}";
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
            String activeOtaVer = prefs.getString(OTA_KEY_ACTIVE_VERSION, "");
            String bundledVer = readBundledCacheName();
            boolean staleOtaComparedToApk = activeOtaVer != null && !activeOtaVer.isEmpty()
                    && compareSemverVersions(activeOtaVer, bundledVer) <= 0;
            if ((savedCode != -1 && savedCode != currentCode) || staleOtaComparedToApk) {
                // Newer or equal APK was installed: clear older OTA cache so freshly bundled APK assets take over
                deleteDirRecursive(getOtaRootDir());
                prefs.edit()
                        .remove(OTA_KEY_ACTIVE_VERSION)
                        .putInt(OTA_KEY_APK_VERSION_CODE, currentCode)
                        .apply();
                Log.i(TAG, "OTA cache cleared after APK upgrade (" + savedCode + " -> " + currentCode + ", ota=" + activeOtaVer + ", apk=" + bundledVer + ")");
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
                .compile("const\\s+CACHE_NAME\\s*=\\s*['\"]([^'\"]+)['\"]")
                .matcher(swText);
        return m.find() ? m.group(1).trim() : "";
    }

    /**
     * Compares SemVer tags such as "nocturne-v3.9.14" vs "nocturne-v3.9.13" numerically.
     * Returns > 0 if a > b, 0 if equal, < 0 if a < b. Prevents stale CDN responses from downgrading a newer APK.
     */
    public static int compareSemverVersions(String a, String b) {
        int[] pa = parseSemverTuple(a);
        int[] pb = parseSemverTuple(b);
        for (int i = 0; i < 3; i++) {
            if (pa[i] != pb[i]) return Integer.compare(pa[i], pb[i]);
        }
        return 0;
    }

    private static int[] parseSemverTuple(String raw) {
        int[] parts = new int[]{0, 0, 0};
        if (raw == null || raw.isEmpty()) return parts;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(\\d+)\\.(\\d+)\\.(\\d+)")
                .matcher(raw);
        if (m.find()) {
            try {
                parts[0] = Integer.parseInt(m.group(1));
                parts[1] = Integer.parseInt(m.group(2));
                parts[2] = Integer.parseInt(m.group(3));
            } catch (NumberFormatException ignored) {}
        }
        return parts;
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
                if (remoteVer.isEmpty() || compareSemverVersions(remoteVer, currentVer) <= 0) {
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
                    if ("library-utils.js".equals(relFile)) {
                        String head = new String(data, 0, Math.min(64, data.length), StandardCharsets.UTF_8).trim().toLowerCase(Locale.US);
                        if (data.length < 50000 || head.startsWith("<")) {
                            deleteDirRecursive(stagingDir);
                            if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                            return;
                        }
                    }
                    if (!isPlausibleOtaPayload(relFile, data)) {
                        Log.w(TAG, "OTA payload for " + relFile + " looks like HTML/captive-portal content, aborting cleanly");
                        deleteDirRecursive(stagingDir);
                        if (notifyIfUpToDate) notifyWebOtaStatus("error", currentVer);
                        return;
                    }
                    File outFile = new File(stagingDir, relFile);
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile)) {
                        fos.write(data);
                        fos.flush();
                        try { fos.getFD().sync(); } catch (Throwable ignored) {}
                    }
                }

                // Mark staging ready and perform atomic swap -> active
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(new File(stagingDir, ".ota_ready"))) {
                    fos.write(remoteVer.getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                    try { fos.getFD().sync(); } catch (Throwable ignored) {}
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
                try { deleteDirRecursive(new File(getOtaRootDir(), "staging")); } catch (Throwable ignored) {}
                if (notifyIfUpToDate) notifyWebOtaStatus("error", getCurrentActiveWebVersion());
            } finally {
                mOtaChecking.set(false);
            }
        }, "NocturneOtaUpdater").start();
    }

    /** Rejects HTML error/captive-portal pages (HTTP 200) served in place of JS/CSS OTA assets. */
    static boolean isPlausibleOtaPayload(String relFile, byte[] data) {
        if (relFile == null || data == null || data.length == 0) return false;
        boolean isJs = relFile.endsWith(".js");
        boolean isCss = relFile.endsWith(".css");
        if (!isJs && !isCss) return true;
        int i = 0;
        if (data.length >= 3 && (data[0] & 0xFF) == 0xEF && (data[1] & 0xFF) == 0xBB && (data[2] & 0xFF) == 0xBF) i = 3;
        while (i < data.length && (data[i] == ' ' || data[i] == '\t' || data[i] == '\r' || data[i] == '\n')) i++;
        return !(i < data.length && data[i] == '<');
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

