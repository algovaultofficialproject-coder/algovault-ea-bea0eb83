package app.algovault.trader;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TradeLogOverlayPlugin.class);
        super.onCreate(savedInstanceState);
        // Android 13+ needs this for the "floating Trade Log is on" notification.
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 41);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebAlive();
    }

    /** While the floating log is on, keep the robot's page running so the log stays live. */
    private void keepWebAlive() {
        if (!OverlayService.isActive() || getBridge() == null) return;
        WebView web = getBridge().getWebView();
        if (web == null) return;
        web.onResume();
        web.resumeTimers();
    }
}
