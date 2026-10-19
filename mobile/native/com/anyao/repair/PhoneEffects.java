package com.anyao.repair;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.app.NotificationManager;
import android.service.notification.StatusBarNotification;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class PhoneEffects {
    private PhoneEffects() {}
    private static String torch(CameraManager camera) throws Exception {
        for (String id : camera.getCameraIdList()) {
            CameraCharacteristics c = camera.getCameraCharacteristics(id);
            if (Boolean.TRUE.equals(c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE)) &&
                Integer.valueOf(CameraCharacteristics.LENS_FACING_BACK).equals(c.get(CameraCharacteristics.LENS_FACING))) return id;
        }
        return null;
    }
    public static JSONObject status(Context context, JSONObject status) throws JSONException {
        status.put("alarmDispatch", "shortForegroundService");
        android.content.SharedPreferences dispatch = context.getSharedPreferences("anyao_dispatch", Context.MODE_PRIVATE);
        status.put("dispatchStatus", new JSONObject().put("key", dispatch.getString("lastKey", ""))
                .put("startedAt", dispatch.getLong("startedAt", 0)).put("finishedAt", dispatch.getLong("finishedAt", 0))
                .put("error", dispatch.getString("error", "")));
        status.put("cameraAllowed", context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED);
        Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        status.put("vibratorAvailable", vibrator != null && vibrator.hasVibrator());
        status.put("amplitudeControl", vibrator != null && vibrator.hasAmplitudeControl());
        AudioManager audio = context.getSystemService(AudioManager.class);
        status.put("notificationVibrationAllowed", audio.shouldVibrate(AudioManager.VIBRATE_TYPE_NOTIFICATION));
        Intent autostart = vivoAutostart();
        boolean vivo = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(java.util.Locale.ROOT).matches(".*(vivo|iqoo).*");
        boolean available = vivo && autostart.resolveActivity(context.getPackageManager()) != null;
        status.put("vendorAutostartAvailable", available);
        status.put("vendorBatteryAvailable", vivo && vivoBattery().resolveActivity(context.getPackageManager()) != null);
        JSONObject guide = status.optJSONObject("deviceGuide");
        if (available && guide != null) guide.put("autostartSettings", true).put("instruction",
                "先允许安药自启动，再进入电池 → 后台耗电管理 → 安药，选择允许后台耗电。厂商的后台耗电设置需要单独设置，并在锁屏后实测。验证版请选择安药验证。");
        try { status.put("torchAvailable", torch(context.getSystemService(CameraManager.class)) != null); }
        catch (Exception e) { status.put("torchAvailable", false); }
        return status;
    }
    public static Intent vivoAutostart() {
        return new Intent().setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
    }
    public static Intent vivoBattery() {
        return new Intent().setComponent(new ComponentName("com.iqoo.powersaving", "com.iqoo.powersaving.PowerSavingManagerActivity"));
    }
    public static JSONObject previewResult(Context context, JSONObject result) throws JSONException {
        if (result.optBoolean("notified")) {
            boolean active = false;
            for (StatusBarNotification notification : context.getSystemService(NotificationManager.class).getActiveNotifications())
                if (notification.getId() == ("preview".hashCode() & Integer.MAX_VALUE)) active = true;
            result.put("notified", active);
            if (!active) result.getJSONArray("skipped").put("通知：未找到测试通知，请检查通知权限与频道设置");
        }
        return result;
    }
    /** Uses the notification vibration path that worked in the previous phone test. */
    public static void vibrate(Context context, JSONObject profiles, JSONArray done, JSONArray skipped) {
        Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        try {
            if (context.getSystemService(NotificationManager.class).getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL)
                throw new IllegalStateException("勿扰模式开着，请检查系统允许的提醒方式");
            if (vibrator == null || !vibrator.hasVibrator()) throw new IllegalStateException("本机不支持震动");
            if (!context.getSystemService(AudioManager.class).shouldVibrate(AudioManager.VIBRATE_TYPE_NOTIFICATION))
                throw new IllegalStateException("系统未允许通知震动，请在声音与振动设置中开启响铃时振动");
            JSONObject p = profiles.getJSONObject("vibration");
            int repeats = p.getInt("repeats"), level = p.getInt("level");
            long pulse = p.getLong("pulseMs"), gap = p.getLong("intervalMs");
            long[] timings = new long[repeats * 2];
            int[] amplitudes = new int[timings.length];
            String curve = p.optString("curve", p.optBoolean("ramp") ? "up" : "steady");
            long duration = 0;
            for (int i = 0; i < repeats; i++) {
                double factor = "up".equals(curve) ? (i + 1.0) / repeats : "down".equals(curve) ? (repeats - i) / (double) repeats : 1;
                timings[i * 2] = i == 0 ? 0 : gap;
                timings[i * 2 + 1] = pulse;
                amplitudes[i * 2 + 1] = vibrator.hasAmplitudeControl() ? Math.max(1, Math.min(255, (int) Math.round(level * 2.55 * factor))) : VibrationEffect.DEFAULT_AMPLITUDE;
                duration += timings[i * 2] + pulse;
            }
            vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
            Thread.sleep(duration);
            synchronized (done) { done.put("震动"); }
        } catch (Exception e) {
            synchronized (skipped) { skipped.put("震动：" + e.getMessage()); }
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
        } finally {
            if (vibrator != null) vibrator.cancel();
        }
    }
    public static void flash(Context context, JSONObject profiles, JSONArray done, JSONArray skipped) {
        CameraManager camera = context.getSystemService(CameraManager.class);
        String id = null;
        try {
            if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                throw new IllegalStateException("请先允许相机权限以使用背面闪光灯");
            id = torch(camera);
            if (id == null) throw new IllegalStateException("本机没有可用的背面闪光灯");
            JSONObject p = profiles.getJSONObject("flash");
            // Binary torch mode is supported more widely than vendor strength control.
            for (int i = 0; i < p.getInt("repeats"); i++) {
                camera.setTorchMode(id, true);
                Thread.sleep(p.getLong("pulseMs"));
                camera.setTorchMode(id, false);
                if (i + 1 < p.getInt("repeats")) Thread.sleep(p.getLong("intervalMs"));
            }
            synchronized (done) { done.put("闪光"); }
        } catch (Exception e) {
            synchronized (skipped) { skipped.put("闪光：" + e.getMessage()); }
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
        } finally {
            if (id != null) try { camera.setTorchMode(id, false); } catch (Exception ignored) {}
        }
    }
}
