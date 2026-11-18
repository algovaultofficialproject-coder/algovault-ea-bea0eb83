package app.algovault.trader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.RoundedBitmapDrawable;
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Foreground service that floats the AlgoVault bot circle (bot picture + running dot) and its
 * Trade Log window over other apps (SYSTEM_ALERT_WINDOW). It mirrors the in-app circle, only
 * displays the latest snapshot pushed by the app, keeps it in memory, and never places trades.
 */
public class OverlayService extends Service {
    public static final String ACTION_STOP = "app.algovault.trader.STOP_OVERLAY";
    private static final String CHANNEL_ID = "algovault_overlay";
    private static final int NOTIF_ID = 4107;

    static final class Entry {
        final String id; final long ts; final String type; final String text; final String status;
        Entry(String id, long ts, String type, String text, String status) { this.id = id; this.ts = ts; this.type = type; this.text = text; this.status = status; }
        /** Stable key of one Trade Log line, so each new line is typed exactly once. */
        String key() { return id != null && !id.isEmpty() ? id : ts + "|" + type; }
    }

    // ---------- one-by-one typing of new Trade Log lines ----------
    private static final long TYPE_TICK_MS = 30;
    private final java.util.HashSet<String> typed = new java.util.HashSet<>();
    private String typingKey = null;
    private int typingShown = 0;
    private boolean historyMarked = false;
    private boolean ticking = false;
    private final Runnable typeTick = this::stepTyping;

    private static final Object LOCK = new Object();
    private static final List<Entry> entries = new ArrayList<>();
    private static boolean robotRunning = false;
    private static int accent = 0xFF3B82F6;
    private static String botName = "Algo Vault EA";
    private static String symbols = "";
    private static Bitmap avatar;
    private static OverlayService instance;
    static Runnable onUserStopped;
    /** STOP EA in the floating window asks the app to stop the robot (the app owns trading). */
    static Runnable onStopRequested;

    static boolean isActive() { return instance != null; }

    static void setSnapshot(List<Entry> list, boolean running, String accentHex, String name, String syms, String avatarB64) {
        Bitmap decoded = null;
        if (avatarB64 != null && !avatarB64.isEmpty()) {
            try {
                byte[] bytes = Base64.decode(avatarB64, Base64.DEFAULT);
                decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            } catch (IllegalArgumentException ignored) { }
        }
        synchronized (LOCK) {
            entries.clear();
            entries.addAll(list);
            robotRunning = running;
            if (accentHex != null) {
                try { accent = Color.parseColor(accentHex); } catch (IllegalArgumentException ignored) { }
            }
            if (name != null && !name.isEmpty()) botName = name;
            if (syms != null) symbols = syms;
            if (decoded != null) avatar = decoded;
        }
        OverlayService s = instance;
        if (s != null) s.main.post(s::render);
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private int windowType;

    private FrameLayout bubble;
    private ImageView bubbleImage;
    private View bubbleDot;
    private WindowManager.LayoutParams bubbleLp;
    private Bitmap shownAvatar;
    private boolean avatarShownOnce = false;

    private FrameLayout panel;
    private LinearLayout card;
    private FrameLayout panelAvatarRing, logBox;
    private ImageView panelAvatar;
    private TextView nameText, pillText, connText, emptyText, closeBtn, scriptBtn, liveBtn, stopBtn;
    private View connDot;
    private ScrollView scroll;
    private TextView logText;
    private WindowManager.LayoutParams panelLp;
    private boolean panelShown = false;
    /** LIVE view keeps only signal / order / execution lines; SCRIPT (default) shows every line. */
    private boolean liveView = false;
    private final java.text.SimpleDateFormat clock = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault());

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        windowType = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            userStop();
            return START_NOT_STICKY;
        }
        startInForeground();
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        instance = this;
        showBubble();
        render();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        instance = null;
        main.removeCallbacks(typeTick);
        detach(panel);
        detach(bubble);
        super.onDestroy();
    }

    // ---------- notification ----------

    private void startInForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Floating Trade Log", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while your bot is running and its circle and Trade Log float over other apps");
            nm.createNotificationChannel(ch);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent open = PendingIntent.getActivity(this, 0, launchIntent(), piFlags);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, OverlayService.class).setAction(ACTION_STOP), piFlags);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("Your AlgoVault bot is running")
                .setContentText("Tap its circle on any app to see the live Trade Log.")
                .setOngoing(true)
                .setContentIntent(open)
                .addAction(0, "Hide circle", stop)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIF_ID, n);
    }

    private Intent launchIntent() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return i;
    }

    private void userStop() {
        Runnable cb = onUserStopped;
        if (cb != null) cb.run();
        stopForeground(true);
        stopSelf();
    }

    // ---------- helpers ----------

    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }
    private DisplayMetrics screen() { return getResources().getDisplayMetrics(); }
    private int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(v, Math.max(lo, hi))); }
    private static int alpha(int color, int a) { return (color & 0x00FFFFFF) | (a << 24); }

    private void detach(View v) {
        if (v != null && v.isAttachedToWindow()) {
            try { wm.removeView(v); } catch (Exception ignored) { }
        }
    }

    private WindowManager.LayoutParams overlayParams(int w, int h) {
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(w, h, windowType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        return lp;
    }

    private GradientDrawable roundBg(int fill, float radiusDp, int stroke, float strokeDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(radiusDp));
        if (stroke != 0) g.setStroke(dp(strokeDp), stroke);
        return g;
    }

    private GradientDrawable oval(int fill, int stroke, float strokeDp) {
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(fill);
        if (stroke != 0) g.setStroke(dp(strokeDp), stroke);
        return g;
    }

    private Drawable avatarDrawable(Bitmap bmp) {
        if (bmp != null) {
            RoundedBitmapDrawable d = RoundedBitmapDrawableFactory.create(getResources(), bmp);
            d.setCircular(true);
            d.setAntiAlias(true);
            return d;
        }
        return ContextCompat.getDrawable(this, R.mipmap.ic_launcher_round);
    }

    // ---------- floating bot circle (same as the in-app one) ----------

    private void showBubble() {
        if (bubble == null) buildBubble();
        if (!bubble.isAttachedToWindow()) wm.addView(bubble, bubbleLp);
    }

    private void buildBubble() {
        final int size = dp(72);
        bubble = new FrameLayout(this);
        bubble.setPadding(dp(2), dp(2), dp(2), dp(2));

        bubbleImage = new ImageView(this);
        bubbleImage.setScaleType(ImageView.ScaleType.CENTER_CROP);
        bubble.addView(bubbleImage, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        bubbleDot = new View(this);
        FrameLayout.LayoutParams dotLp = new FrameLayout.LayoutParams(dp(12), dp(12), Gravity.TOP | Gravity.END);
        dotLp.topMargin = dp(2);
        dotLp.rightMargin = dp(2);
        bubble.addView(bubbleDot, dotLp);

        bubbleLp = overlayParams(size, size);
        // Appears in the middle of the screen when the bot starts, like in the app.
        bubbleLp.x = (screen().widthPixels - size) / 2;
        bubbleLp.y = (screen().heightPixels - size) / 2;

        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        bubble.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY; int startX, startY; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX(); downY = e.getRawY();
                        startX = bubbleLp.x; startY = bubbleLp.y; moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                        if (!moved && Math.hypot(dx, dy) > slop) moved = true;
                        if (moved) {
                            bubbleLp.x = clamp(Math.round(startX + dx), 0, screen().widthPixels - v.getWidth());
                            bubbleLp.y = clamp(Math.round(startY + dy), 0, screen().heightPixels - v.getHeight());
                            wm.updateViewLayout(bubble, bubbleLp);
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                        if (!moved) togglePanel();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        return true;
                }
                return false;
            }
        });
    }

    // ---------- floating Trade Log window (same as the in-app one) ----------

    private void buildPanel() {
        DisplayMetrics s = screen();
        panel = new FrameLayout(this);
        panel.setClipChildren(false);
        panel.setClipToPadding(false);

        card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(44), dp(16), dp(14));
        FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        cardLp.topMargin = dp(38);
        panel.addView(card, cardLp);

        // Drag area: status pill + bot name.
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setGravity(Gravity.CENTER_HORIZONTAL);

        pillText = new TextView(this);
        pillText.setTextColor(0xFFF8FAFC);
        pillText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        pillText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        pillText.setLetterSpacing(0.32f);
        pillText.setGravity(Gravity.CENTER);
        pillText.setPadding(dp(22), dp(4), dp(18), dp(4));
        header.addView(pillText, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        nameText = new TextView(this);
        nameText.setTextColor(Color.WHITE);
        nameText.setTypeface(Typeface.create("sans-serif-condensed", Typeface.BOLD));
        nameText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        nameText.setAllCaps(true);
        nameText.setSingleLine(true);
        nameText.setEllipsize(TextUtils.TruncateAt.END);
        nameText.setGravity(Gravity.CENTER);
        nameText.setShadowLayer(dp(5), 0, dp(1), 0xCC000000);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        nameLp.topMargin = dp(8);
        header.addView(nameText, nameLp);
        card.addView(header, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // SCRIPT / LIVE / STOP EA
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        scriptBtn = actionButton("SCRIPT");
        liveBtn = actionButton("LIVE");
        stopBtn = actionButton("STOP EA");
        scriptBtn.setOnClickListener(v -> { liveView = false; render(); scrollToEnd(); });
        liveBtn.setOnClickListener(v -> { liveView = true; render(); scrollToEnd(); });
        stopBtn.setOnClickListener(v -> { Runnable cb = onStopRequested; if (cb != null) cb.run(); });
        actions.addView(scriptBtn, actionLp(1.15f, 0));
        actions.addView(liveBtn, actionLp(0.95f, dp(8)));
        actions.addView(stopBtn, actionLp(1f, dp(8)));
        LinearLayout.LayoutParams actLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        actLp.topMargin = dp(14);
        card.addView(actions, actLp);

        // Terminal box
        logBox = new FrameLayout(this);
        logBox.setPadding(dp(12), dp(10), dp(12), dp(10));
        logBox.setBackground(roundBg(0x4D000000, 16, 0x80FFFFFF, 1.5f));
        logBox.setMinimumHeight(dp(76));
        logText = new TextView(this);
        logText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        logText.setTypeface(Typeface.MONOSPACE);
        logText.setLineSpacing(dp(3), 1f);
        logText.setTextColor(0xFF4ADE80);
        scroll = new ScrollView(this) {
            @Override protected void onMeasure(int w, int h) {
                super.onMeasure(w, MeasureSpec.makeMeasureSpec(dp(92), MeasureSpec.AT_MOST));
            }
        };
        scroll.setVerticalScrollBarEnabled(false);
        scroll.addView(logText);
        emptyText = new TextView(this);
        emptyText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        emptyText.setTypeface(Typeface.MONOSPACE);
        emptyText.setTextColor(0x8CFFFFFF);
        logBox.addView(scroll, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        logBox.addView(emptyText, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams boxLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        boxLp.topMargin = dp(16);
        card.addView(logBox, boxLp);

        // ● SERVER CONNECTED
        LinearLayout status = new LinearLayout(this);
        status.setOrientation(LinearLayout.HORIZONTAL);
        status.setGravity(Gravity.CENTER);
        connDot = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(9), dp(9));
        dotLp.setMarginEnd(dp(10));
        status.addView(connDot, dotLp);
        connText = new TextView(this);
        connText.setTextColor(Color.WHITE);
        connText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        connText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        connText.setLetterSpacing(0.3f);
        status.addView(connText);
        LinearLayout.LayoutParams stLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        stLp.topMargin = dp(14);
        card.addView(status, stLp);

        // Bot picture sitting on the top edge.
        panelAvatarRing = new FrameLayout(this);
        panelAvatarRing.setPadding(dp(3), dp(3), dp(3), dp(3));
        if (Build.VERSION.SDK_INT >= 21) panelAvatarRing.setElevation(dp(6));
        panelAvatar = new ImageView(this);
        panelAvatar.setScaleType(ImageView.ScaleType.CENTER_CROP);
        panelAvatarRing.addView(panelAvatar, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        panel.addView(panelAvatarRing, new FrameLayout.LayoutParams(dp(76), dp(76), Gravity.TOP | Gravity.CENTER_HORIZONTAL));

        closeBtn = new TextView(this);
        closeBtn.setText("\u2715");
        closeBtn.setContentDescription("Close");
        closeBtn.setTextColor(Color.WHITE);
        closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        closeBtn.setGravity(Gravity.CENTER);
        closeBtn.setOnClickListener(v -> closePanel());
        FrameLayout.LayoutParams closeLp = new FrameLayout.LayoutParams(dp(32), dp(32), Gravity.TOP | Gravity.END);
        closeLp.topMargin = dp(38 + 12);
        closeLp.rightMargin = dp(14);
        panel.addView(closeBtn, closeLp);

        int w = Math.min(Math.round(s.widthPixels * 0.92f), dp(300));
        panelLp = overlayParams(w, WindowManager.LayoutParams.WRAP_CONTENT);
        panelLp.x = (s.widthPixels - w) / 2;
        panelLp.y = Math.max(dp(8), s.heightPixels / 2 - dp(190));

        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        // Drag the window by its top area (picture, pill and name).
        View.OnTouchListener dragger = new View.OnTouchListener() {
            float downX, downY; int startX, startY; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX(); downY = e.getRawY(); startX = panelLp.x; startY = panelLp.y; moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                        if (!moved && Math.hypot(dx, dy) > slop) moved = true;
                        if (moved) {
                            panelLp.x = clamp(Math.round(startX + dx), 0, screen().widthPixels - panel.getWidth());
                            panelLp.y = clamp(Math.round(startY + dy), 0, screen().heightPixels - panel.getHeight());
                            wm.updateViewLayout(panel, panelLp);
                        }
                        return true;
                    }
                }
                return true;
            }
        };
        header.setOnTouchListener(dragger);
        panelAvatarRing.setOnTouchListener(dragger);
    }

    private TextView actionButton(String label) {
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        t.setLetterSpacing(0.22f);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(42));
        t.setPadding(dp(6), dp(4), dp(4), dp(4));
        return t;
    }

    private LinearLayout.LayoutParams actionLp(float weight, int startMargin) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, weight);
        lp.setMarginStart(startMargin);
        return lp;
    }

    private void styleAction(TextView b, boolean active, boolean enabled) {
        b.setBackground(roundBg(active ? 0x24FFFFFF : 0x59000000, 999, active ? 0xFFFFFFFF : 0xD1FFFFFF, 2));
        b.setEnabled(enabled);
        b.setAlpha(enabled ? 1f : 0.45f);
    }

    private void togglePanel() { if (panelShown) closePanel(); else openPanel(); }

    private void openPanel() {
        if (panel == null) buildPanel();
        if (!panel.isAttachedToWindow()) wm.addView(panel, panelLp);
        panelShown = true;
        markAllTyped(snapshotEntries());
        historyMarked = true;
        render();
        scrollToEnd();
    }

    private void closePanel() {
        detach(panel);
        panelShown = false;
    }

    private static int charsPerTick(int backlog) {
        if (backlog <= 120) return 1;
        return Math.min(6, (int) Math.ceil(backlog / 120.0));
    }

    private List<Entry> snapshotEntries() {
        synchronized (LOCK) { return new ArrayList<>(entries); }
    }

    /** Lines that arrive while nobody is watching (window closed) are shown at once when it opens. */
    private void markAllTyped(List<Entry> snap) {
        for (Entry e : snap) typed.add(e.key());
        typingKey = null;
        typingShown = 0;
        if (typed.size() > 600) {
            Set<String> keep = new java.util.HashSet<>();
            for (Entry e : snap) keep.add(e.key());
            typed.retainAll(keep);
        }
    }

    private void ensureTyping() {
        if (ticking) return;
        ticking = true;
        main.postDelayed(typeTick, TYPE_TICK_MS);
    }

    /** Types the oldest waiting line a few characters further; the next line waits until it finishes. */
    private void stepTyping() {
        ticking = false;
        List<Entry> snap = snapshotEntries();
        if (!panelShown) { markAllTyped(snap); return; }
        Entry next = null;
        int backlog = 0;
        for (Entry e : snap) {
            if (typed.contains(e.key())) continue;
            if (next == null) next = e;
            backlog += e.text.length();
        }
        if (next == null) { typingKey = null; typingShown = 0; return; }
        if (!next.key().equals(typingKey)) { typingKey = next.key(); typingShown = 0; }
        backlog -= typingShown;
        typingShown += charsPerTick(backlog);
        if (typingShown >= next.text.length()) {
            typed.add(next.key());
            typingKey = null;
            typingShown = 0;
        }
        renderLog(snap);
    }

    private void scrollToEnd() {
        if (scroll != null) scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    /** Same as the app: LIVE keeps signal, order and execution lines only. */
    private static boolean isLive(Entry e) { return "trade".equals(e.type) || e.status != null; }

    /** Errors red, waiting orders amber, everything else terminal green. */
    private static int colourFor(Entry e) {
        String st = e.status == null ? "" : e.status;
        if ("failed".equals(st) || "error".equals(e.type)) return 0xFFF87171;
        if ("submitted".equals(st)) return 0xFFFCD34D;
        return 0xFF4ADE80;
    }

    /** Redraws the circle and window from the latest snapshot. Main thread only. */
    private void render() {
        List<Entry> snap; boolean running; int acc; String name; Bitmap av;
        synchronized (LOCK) {
            snap = new ArrayList<>(entries); running = robotRunning; acc = accent;
            name = botName; av = avatar;
        }
        int live = running ? 0xFF34D399 : 0xFF737373;

        if (bubble != null) {
            bubble.setBackground(oval(0xFF000000, acc, 2));
            if (av != shownAvatar || !avatarShownOnce) {
                bubbleImage.setImageDrawable(avatarDrawable(av));
                if (panelAvatar != null) panelAvatar.setImageDrawable(avatarDrawable(av));
                shownAvatar = av;
                avatarShownOnce = true;
            }
            bubbleDot.setBackground(oval(live, 0xFF000000, 2));
        }

        if (panel == null || !panelShown) return;
        card.setBackground(roundBg(0x94000000, 30, acc, 2));
        panelAvatarRing.setBackground(oval(0xFF000000, acc, 3));
        if (panelAvatar.getDrawable() == null) panelAvatar.setImageDrawable(avatarDrawable(av));
        int success = 0xFF22C55E;
        pillText.setText(running ? "ACTIVE" : "STOPPED");
        pillText.setBackground(roundBg(running ? success : 0x38FFFFFF, 999, 0, 0));
        nameText.setText(name);
        styleAction(scriptBtn, !liveView, true);
        styleAction(liveBtn, liveView, true);
        styleAction(stopBtn, false, running);
        connDot.setBackground(oval(running ? success : 0x66FFFFFF, 0, 0));
        connText.setText(running ? "SERVER CONNECTED" : "OFFLINE");
        renderLog(snap);
    }

    /** Draws the Trade Log text: typed lines in full, the line being typed partly, later lines not yet. */
    private void renderLog(List<Entry> snap) {
        if (panel == null || !panelShown || logText == null) return;
        if (!historyMarked) { markAllTyped(snap); historyMarked = true; }
        boolean atEnd = scroll.getScrollY() + scroll.getHeight() >= logText.getHeight() - dp(24);
        SpannableStringBuilder sb = new SpannableStringBuilder();
        boolean waiting = false;
        int shownLines = 0;
        for (Entry e : snap) {
            String text;
            boolean cursor = false;
            if (typed.contains(e.key())) text = e.text;
            else if (e.key().equals(typingKey)) { text = e.text.substring(0, Math.min(typingShown, e.text.length())); cursor = true; waiting = true; }
            else { waiting = true; break; }
            if (liveView && !isLive(e)) continue;
            if (sb.length() > 0) sb.append('\n');
            int t0 = sb.length();
            sb.append(clock.format(new java.util.Date(e.ts))).append(" ");
            sb.setSpan(new ForegroundColorSpan(0x8CFFFFFF), t0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            int x0 = sb.length();
            sb.append(text);
            if (cursor) sb.append("\u258C");
            sb.setSpan(new ForegroundColorSpan(colourFor(e)), x0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            shownLines++;
        }
        logText.setText(sb);
        boolean empty = shownLines == 0;
        emptyText.setText(liveView ? "No trades yet\u258C" : "Awaiting signal\u258C");
        emptyText.setVisibility(empty ? View.VISIBLE : View.GONE);
        scroll.setVisibility(empty ? View.INVISIBLE : View.VISIBLE);
        if (atEnd) scrollToEnd();
        if (waiting) ensureTyping();
    }
}
