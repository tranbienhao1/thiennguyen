package com.nocturne.audiophile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * Nocturne Audiophile MainActivity
 * High-performance Android host for the Nocturne Web Audio & Bit-Perfect Engine.
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "NocturneMainActivity";
    private static final String WAKELOCK_TAG = "Nocturne:AudiophilePlaybackWakeLock";
    private static final String DEFAULT_ASSET_URL = "https://appassets.androidplatform.net/assets/index.html";

    private WebView mWebView;
    private ProgressBar mProgressBar;
    private PowerManager.WakeLock mWakeLock;
    private AudioManager mAudioManager;
    private AudioFocusRequest mAudioFocusRequest;
    private boolean mHasAudioFocus = false;

    private ValueCallback<Uri[]> mFilePathCallback;
    private ActivityResultLauncher<Intent> mFileChooserLauncher;
    private ActivityResultLauncher<String> mPermissionLauncher;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Edge-to-edge fullscreen setup with notch & navigation bar insets
        setupEdgeToEdgeFullscreen();

        setContentView(R.layout.activity_main);

        mWebView = findViewById(R.id.web_view);
        mProgressBar = findViewById(R.id.loading_indicator);

        // 2. Initialize system services (PowerManager for WakeLock, AudioManager for Audio Focus)
        initPowerAndAudioManagers();

        // 3. Register activity result launchers for file selection & notifications
        initActivityResultLaunchers();

        // 4. Configure high performance WebView settings
        configureHighPerformanceWebView();

        // 5. Setup back-button dispatcher
        setupBackNavigation();

        // 6. Handle notch & window insets
        setupWindowInsetsHandling();

        // 7. Request audio & notification permissions
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
     * Register File Chooser for audio import (FLAC, DSD, WAV, MP3, etc.)
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
                        }
                        mFilePathCallback.onReceiveValue(results);
                        mFilePathCallback = null;
                    }
                }
        );

        mPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                isGranted -> {
                    Log.d(TAG, "Permission response received: " + isGranted);
                }
        );
    }

    /**
     * High performance WebSettings configured specifically for Web Audio API,
     * low-latency audio processing, and responsive UI rendering.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private void configureHighPerformanceWebView() {
        WebSettings settings = mWebView.getSettings();

        // High performance JavaScript & DOM storage
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // Audiophile background playback requires user gesture disabled
        settings.setMediaPlaybackRequiresUserGesture(false);

        // File access for offline local audio library reading
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Cache mode & viewport
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // Hardware acceleration & rendering
        mWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        mWebView.setBackgroundColor(Color.parseColor("#111315"));

        // Setup AssetLoader for secure HTTPS local file loading (works with Web Workers & AudioContext)
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse assetResponse = assetLoader.shouldInterceptRequest(request.getUrl());
                if (assetResponse != null) {
                    return assetResponse;
                }
                return super.shouldInterceptRequest(view, request);
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
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                }
                mFilePathCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    mFileChooserLauncher.launch(intent);
                } catch (ActivityNotFoundException e) {
                    mFilePathCallback = null;
                    Toast.makeText(MainActivity.this, "Cannot open file chooser", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
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
                "window.androidPlatformInfo = { platform: 'Android', sdk: " + Build.VERSION.SDK_INT + " };" +
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
                if (mWebView != null && mWebView.canGoBack()) {
                    mWebView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /**
     * Request permissions for Android 13+ audio & notification
     */
    private void requestAppPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                mPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
    }

    /**
     * Load entrypoint: Checks intent extra "url" -> fallback to asset url -> fallback to local dev url
     */
    private void loadAppEntrypoint() {
        String targetUrl = getIntent().getStringExtra("url");
        if (targetUrl == null || targetUrl.trim().isEmpty()) {
            targetUrl = DEFAULT_ASSET_URL;
        }
        Log.i(TAG, "Loading Nocturne Audiophile URL: " + targetUrl);
        mWebView.loadUrl(targetUrl);
    }

    /**
     * Acquire WakeLock for uninterrupted high-resolution audio playback
     */
    public synchronized void acquireWakeLock() {
        if (mWakeLock != null && !mWakeLock.isHeld()) {
            mWakeLock.acquire(12 * 60 * 60 * 1000L); // 12 hours max safety timeout
            Log.d(TAG, "WakeLock acquired for background audiophile playback");
        }
    }

    /**
     * Release WakeLock
     */
    public synchronized void releaseWakeLock() {
        if (mWakeLock != null && mWakeLock.isHeld()) {
            mWakeLock.release();
            Log.d(TAG, "WakeLock released");
        }
    }

    /**
     * Request Audio Focus for music playback
     */
    public synchronized boolean requestAudioFocus() {
        if (mAudioManager == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (mAudioFocusRequest == null) {
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();

                mAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(audioAttributes)
                        .setAcceptsDelayedFocusGain(true)
                        .setOnAudioFocusChangeListener(this::onAudioFocusChange)
                        .build();
            }
            int res = mAudioManager.requestAudioFocus(mAudioFocusRequest);
            mHasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        } else {
            @SuppressWarnings("deprecation")
            int res = mAudioManager.requestAudioFocus(
                    this::onAudioFocusChange,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
            );
            mHasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        }
        return mHasAudioFocus;
    }

    /**
     * Abandon Audio Focus
     */
    public synchronized void abandonAudioFocus() {
        if (mAudioManager == null || !mHasAudioFocus) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mAudioFocusRequest != null) {
            mAudioManager.abandonAudioFocusRequest(mAudioFocusRequest);
        } else {
            mAudioManager.abandonAudioFocus(this::onAudioFocusChange);
        }
        mHasAudioFocus = false;
    }

    private void onAudioFocusChange(int focusChange) {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                Log.d(TAG, "AudioFocus lost: notifying web player to pause");
                mWebView.post(() -> mWebView.evaluateJavascript(
                        "if (window.dispatchEvent) { window.dispatchEvent(new CustomEvent('audiofocus-loss')); }",
                        null
                ));
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                Log.d(TAG, "AudioFocus gained: notifying web player to resume");
                mWebView.post(() -> mWebView.evaluateJavascript(
                        "if (window.dispatchEvent) { window.dispatchEvent(new CustomEvent('audiofocus-gain')); }",
                        null
                ));
                break;
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
        // NOTE: We do NOT pause web timers/audio if background playback is active with WakeLock
        if (mWakeLock == null || !mWakeLock.isHeld()) {
            super.onPause();
            if (mWebView != null) {
                mWebView.onPause();
            }
        } else {
            super.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        releaseWakeLock();
        abandonAudioFocus();
        if (mWebView != null) {
            ViewGroup parent = (ViewGroup) mWebView.getParent();
            if (parent != null) {
                parent.removeView(mWebView);
            }
            mWebView.destroy();
            mWebView = null;
        }
        super.onDestroy();
    }

    /**
     * JavaScript Bridge Interface exposed to the web application
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
        public void showToast(String message) {
            if (message != null) {
                mActivity.runOnUiThread(() ->
                        Toast.makeText(mActivity, message, Toast.LENGTH_SHORT).show()
                );
            }
        }
    }
}
