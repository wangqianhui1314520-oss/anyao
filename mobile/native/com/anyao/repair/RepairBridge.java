package com.anyao.repair;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;
import java.lang.ref.WeakReference;
import java.util.WeakHashMap;
import org.json.JSONObject;

/** This bridge is installed only in the existing restricted local WebView. */
public final class RepairBridge {
    private static final int CAMERA_REQUEST = 7450;
    private static final WeakHashMap<Activity, WeakReference<RepairBridge>> instances = new WeakHashMap<>();
    private final Activity activity;
    private volatile String cameraState = "idle";
    public RepairBridge(Activity activity) {
        this.activity = activity;
        synchronized (instances) { instances.put(activity, new WeakReference<>(this)); }
    }
    public static void install(Activity activity) { installIn(activity, activity.getWindow().getDecorView()); }
    private static void installIn(Activity activity, View view) {
        if (view instanceof WebView) ((WebView) view).addJavascriptInterface(new RepairBridge(activity), "RepairApi");
        else if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) installIn(activity, group.getChildAt(i));
        }
    }
    @JavascriptInterface public String capabilities() {
        try { return PhoneEffects.status(activity, new JSONObject()).put("cameraRequest", cameraState).toString(); }
        catch (Exception e) { return "{}"; }
    }
    @JavascriptInterface public void requestCamera() {
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            cameraState = "granted"; return;
        }
        if ("pending".equals(cameraState)) return;
        cameraState = "pending";
        activity.runOnUiThread(() -> {
            try { activity.requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST); }
            catch (Exception e) { cameraState = "denied"; }
        });
    }
    @JavascriptInterface public void openSoundSettings() {
        activity.runOnUiThread(() -> activity.startActivity(new Intent(Settings.ACTION_SOUND_SETTINGS)));
    }
    @JavascriptInterface public String scanBarcode() {return scan(false);}
    @JavascriptInterface public String scanBarcodeImage() {return scan(true);}
    private String scan(boolean image) {
        String token=java.util.UUID.randomUUID().toString();
        BarcodeActivity.result(activity,token,"pending","","","");
        activity.runOnUiThread(()->{try{activity.startActivity(new Intent(activity,BarcodeActivity.class).putExtra("token",token).putExtra("imageOnly",image));}
            catch(Exception e){BarcodeActivity.result(activity,token,"error","","","无法打开扫码相机");}});
        return token;
    }
    @JavascriptInterface public String barcodeResult(String token) {
        String raw=activity.getSharedPreferences(BarcodeActivity.PREFS,0).getString("result","{}");
        try{return token.equals(new JSONObject(raw).optString("token"))?raw:"{}";}catch(Exception e){return "{}";}
    }
    @JavascriptInterface public void openAutostartSettings() {
        activity.runOnUiThread(() -> {
            try { activity.startActivity(PhoneEffects.vivoAutostart()); }
            catch (RuntimeException e) { activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + activity.getPackageName()))); }
        });
    }
    @JavascriptInterface public void openVendorBatterySettings() {
        activity.runOnUiThread(() -> {
            try { activity.startActivity(PhoneEffects.vivoBattery()); }
            catch (RuntimeException e) { activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + activity.getPackageName()))); }
        });
    }
    public static void onPermissionResult(Activity activity, int request, int[] grants) {
        if (request != CAMERA_REQUEST) return;
        synchronized (instances) {
            WeakReference<RepairBridge> reference = instances.get(activity);
            RepairBridge bridge = reference == null ? null : reference.get();
            if (bridge != null) bridge.cameraState = grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
        }
    }
}
