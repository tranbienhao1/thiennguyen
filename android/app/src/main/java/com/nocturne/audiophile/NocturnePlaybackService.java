package com.nocturne.audiophile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.session.MediaSession;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;

/**
 * Foreground media playback service keeping WebView & native Bit-Perfect audio
 * alive on Android 10-15 (including FiiO M11S DAP) when the screen turns off or
 * playback is temporarily paused.
 */
public class NocturnePlaybackService extends Service {
    private static final String TAG = "NocturnePlaybackSvc";
    public static final String CHANNEL_ID = "nocturne_playback_channel";
    public static final int NOTIFICATION_ID = 20260409;

    public static final String ACTION_START_OR_UPDATE = "com.nocturne.audiophile.SERVICE_UPDATE";
    public static final String ACTION_STOP = "com.nocturne.audiophile.SERVICE_STOP";

    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_ARTIST = "extra_artist";
    public static final String EXTRA_ALBUM = "extra_album";
    public static final String EXTRA_IS_PLAYING = "extra_is_playing";

    private static final String ACTION_PLAY_PAUSE = "com.nocturne.audiophile.ACTION_PLAY_PAUSE";
    private static final String ACTION_NEXT = "com.nocturne.audiophile.ACTION_NEXT";
    private static final String ACTION_PREV = "com.nocturne.audiophile.ACTION_PREVIOUS";

    public static volatile MediaSession.Token sMediaSessionToken = null;
    public static volatile android.graphics.Bitmap sCurrentAlbumArt = null;
    private static volatile NocturnePlaybackService sInstance = null;
    public static final long PAUSE_IDLE_TIMEOUT_MS = 20L * 60L * 1000L;

    private final android.os.Handler mIdleHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable mIdleStopRunnable = new Runnable() {
        @Override
        public void run() {
            stopForegroundCompat();
            stopSelf();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
        ensureNotificationChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        mIdleHandler.removeCallbacks(mIdleStopRunnable);
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String artist = intent != null ? intent.getStringExtra(EXTRA_ARTIST) : null;
        String album = intent != null ? intent.getStringExtra(EXTRA_ALBUM) : null;
        boolean isPlaying = intent == null || intent.getBooleanExtra(EXTRA_IS_PLAYING, true);

        Notification notification = buildNotification(title, artist, album, isPlaying);
        if (isPlaying) {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    );
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to enter foreground playback state: " + e.getMessage(), e);
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIFICATION_ID, notification);
                }
            }
        } else {
            // Keep service & MediaSession alive when paused so FiiO M11S hardware buttons still resume with screen off,
            // and auto-stop after 20 minutes of unattended pause to conserve DAP battery.
            mIdleHandler.postDelayed(mIdleStopRunnable, PAUSE_IDLE_TIMEOUT_MS);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_DETACH);
                } else {
                    stopForeground(false);
                }
            } catch (Exception ignored) {}
            try {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIFICATION_ID, notification);
                }
            } catch (Exception ignored) {}
        }

        return START_STICKY;
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Nocturne Hi-Res Playback",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Background Hi-Res and Bit-Perfect audio playback controls");
                channel.setShowBadge(false);
                channel.setSound(null, null);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String artist, String album, boolean isPlaying) {
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        Intent prevIntent = new Intent(ACTION_PREV).setPackage(getPackageName());
        PendingIntent pPrev = PendingIntent.getBroadcast(this, 101, prevIntent, piFlags);

        Intent playPauseIntent = new Intent(ACTION_PLAY_PAUSE).setPackage(getPackageName());
        PendingIntent pPlayPause = PendingIntent.getBroadcast(this, 102, playPauseIntent, piFlags);

        Intent nextIntent = new Intent(ACTION_NEXT).setPackage(getPackageName());
        PendingIntent pNext = PendingIntent.getBroadcast(this, 103, nextIntent, piFlags);

        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(this, 100, contentIntent, piFlags);

        String displayTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Nocturne Audiophile";
        String displayArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "Nocturne Hi-Res Audio";
        String displayAlbum = (album != null && !album.trim().isEmpty()) ? album.trim() : null;

        Notification.Builder builder = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        Notification.Action prevAction = new Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_media_previous),
            "Previous",
            pPrev
        ).build();

        Notification.Action playPauseAction = new Notification.Action.Builder(
            Icon.createWithResource(this, isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
            isPlaying ? "Pause" : "Play",
            pPlayPause
        ).build();

        Notification.Action nextAction = new Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_media_next),
            "Next",
            pNext
        ).build();

        Notification.MediaStyle mediaStyle = new Notification.MediaStyle()
            .setShowActionsInCompactView(0, 1, 2);
        MediaSession.Token token = sMediaSessionToken;
        if (token != null) {
            mediaStyle.setMediaSession(token);
        }

        builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(displayTitle)
            .setContentText(displayArtist)
            .setSubText(displayAlbum)
            .setOngoing(isPlaying)
            .setAutoCancel(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(contentPendingIntent)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .setStyle(mediaStyle);
        android.graphics.Bitmap art = sCurrentAlbumArt;
        if (art != null && !art.isRecycled()) {
            builder.setLargeIcon(art);
        }

        return builder.build();
    }

    private void applyPausedNotificationState(@Nullable String title, @Nullable String artist, @Nullable String album) {
        mIdleHandler.removeCallbacks(mIdleStopRunnable);
        Notification notification = buildNotification(title, artist, album, false);
        mIdleHandler.postDelayed(mIdleStopRunnable, PAUSE_IDLE_TIMEOUT_MS);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(false);
            }
        } catch (Exception ignored) {}
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, notification);
            }
        } catch (Exception ignored) {}
    }

    public static boolean syncBackgroundPauseIfRunning(@Nullable String title, @Nullable String artist, @Nullable String album) {
        final NocturnePlaybackService svc = sInstance;
        if (svc == null) return false;
        svc.mIdleHandler.post(() -> {
            if (sInstance == svc) {
                svc.applyPausedNotificationState(title, artist, album);
            }
        });
        return true;
    }

    public static boolean stopIfRunning() {
        final NocturnePlaybackService svc = sInstance;
        if (svc == null) return false;
        svc.mIdleHandler.post(() -> {
            if (sInstance == svc) {
                svc.mIdleHandler.removeCallbacks(svc.mIdleStopRunnable);
                svc.stopForegroundCompat();
                svc.stopSelf();
            }
        });
        return true;
    }

    @Override
    public void onDestroy() {
        if (sInstance == this) {
            sInstance = null;
        }
        mIdleHandler.removeCallbacks(mIdleStopRunnable);
        stopForegroundCompat();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
