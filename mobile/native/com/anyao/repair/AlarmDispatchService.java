package com.anyao.repair;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A brief, visible exact-alarm dispatch. No continuously running keeper service.
 * Some vivo builds indefinitely defer alarms sent to a frozen broadcast consumer.
 * A service PendingIntent lets AlarmManager start this short foreground task.
 * Delivery, deduplication and cancellation still use the original reminder ledger.
 */
public final class AlarmDispatchService extends Service {
    private static final String CHANNEL = "anyao_alarm_dispatch";
    private static final int NOTIFICATION = 8451;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    public static PendingIntent pending(Context context, String key) throws Exception {
        Uri uri = Uri.parse("anyao://alarm/" + key);
        // Migrate the previous broadcast identity, including cancelled/changed plans.
        Intent legacy = new Intent(context, Class.forName("com.anyao.app.DoseAlarmReceiver")).setData(uri);
        PendingIntent old = PendingIntent.getBroadcast(context, key.hashCode(), legacy,
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (old != null) {
            context.getSystemService(AlarmManager.class).cancel(old);
            old.cancel();
        }
        Intent intent = new Intent(context, AlarmDispatchService.class).setData(uri);
        return PendingIntent.getForegroundService(context, key.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String key = intent == null || intent.getData() == null ? null : intent.getData().getLastPathSegment();
        NotificationManager notifications = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "定时提醒执行", NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null);
        channel.enableVibration(false);
        notifications.createNotificationChannel(channel);
        Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("安药正在检查定时提醒")
                .setContentText("执行完成后自动结束")
                .setOngoing(true).setShowWhen(false).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        else startForeground(NOTIFICATION, notification);
        if (key == null || key.isEmpty()) {
            finish(startId);
            return START_NOT_STICKY;
        }
        PowerManager.WakeLock wake = getSystemService(PowerManager.class)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "anyao:dispatch");
        wake.acquire(60000L);
        getSharedPreferences("anyao_dispatch", MODE_PRIVATE).edit()
                .putString("lastKey", key).putLong("startedAt", System.currentTimeMillis()).putString("error", "").apply();
        worker.execute(() -> {
            try {
                Class<?> reminders = Class.forName("com.anyao.app.Reminders");
                Object instance = reminders.getField("INSTANCE").get(null);
                reminders.getMethod("deliver", Context.class, String.class).invoke(instance, this, key);
                reminders.getMethod("reconcile", Context.class).invoke(instance, this);
                getSharedPreferences("anyao_dispatch", MODE_PRIVATE).edit().putLong("finishedAt", System.currentTimeMillis()).apply();
            } catch (Exception failure) {
                Throwable cause = failure.getCause() == null ? failure : failure.getCause();
                Log.e("AnyaoAlarmDispatch", "Reminder dispatch failed", cause);
                getSharedPreferences("anyao_dispatch", MODE_PRIVATE).edit().putString("error", cause.toString()).apply();
            } finally {
                if (wake.isHeld()) wake.release();
                main.post(() -> finish(startId));
            }
        });
        return START_NOT_STICKY;
    }

    private void finish(int startId) {
        if (stopSelfResult(startId)) stopForeground(STOP_FOREGROUND_REMOVE);
    }
    @Override public void onTimeout(int startId) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }
    @Override public void onTimeout(int startId, int type) { onTimeout(startId); }
    @Override public void onDestroy() { worker.shutdownNow(); super.onDestroy(); }
}
