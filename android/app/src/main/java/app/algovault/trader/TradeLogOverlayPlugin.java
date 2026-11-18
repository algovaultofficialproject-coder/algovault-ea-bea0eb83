package app.algovault.trader;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Bridge between the AlgoVault web app and the native floating Trade Log. Display only. */
@CapacitorPlugin(name = "TradeLogOverlay")
public class TradeLogOverlayPlugin extends Plugin {

    @Override
    public void load() {
        OverlayService.onUserStopped = () -> notifyListeners("overlayStopped", new JSObject());
        OverlayService.onStopRequested = () -> notifyListeners("stopRequested", new JSObject());
    }

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("permission", canDraw());
        r.put("running", OverlayService.isActive());
        call.resolve(r);
    }

    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open overlay settings");
        }
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!canDraw()) {
            call.reject("Display over other apps is not allowed yet");
            return;
        }
        ContextCompat.startForegroundService(getContext(), new Intent(getContext(), OverlayService.class));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), OverlayService.class));
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSArray arr = call.getArray("entries", new JSArray());
        List<OverlayService.Entry> list = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String status = o.isNull("status") ? null : o.optString("status", null);
            list.add(new OverlayService.Entry(o.optString("id", ""), o.optLong("ts"), o.optString("type", "info"), o.optString("text", ""), status));
        }
        Boolean running = call.getBoolean("running", false);
        JSArray syms = call.getArray("symbols", new JSArray());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < syms.length(); i++) {
            String sym = syms.optString(i, "");
            if (sym.isEmpty()) continue;
            if (sb.length() > 0) sb.append(", ");
            sb.append(sym);
        }
        OverlayService.setSnapshot(list, running != null && running, call.getString("accent", null),
                call.getString("name", null), call.getData().has("symbols") ? sb.toString() : null, call.getString("avatar", null));
        call.resolve();
    }
}
