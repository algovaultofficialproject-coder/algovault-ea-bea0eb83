import { useSyncExternalStore } from "react";
import { getTradeLogState, subscribeTradeLog, tradeLog, type LogEntry } from "@/lib/trade-log";

/**
 * Bridge to the Android floating bot circle and Trade Log (native TradeLogOverlay plugin).
 * "Display over other apps" is granted on the required first page (OverlayPermissionGate), so the
 * same circle and Trade Log window float over other apps automatically while the bot runs and
 * disappear when it stops. Display only: it never places or changes trades.
 * On the website (no native shell) everything here stays inert.
 */
type OverlayPlugin = {
  status(): Promise<{ permission: boolean; running: boolean }>;
  openPermissionSettings(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  update(data: OverlaySnapshot): Promise<void>;
  addListener(event: "overlayStopped" | "stopRequested", cb: () => void): Promise<unknown>;
};

export interface OverlayProfile { name: string; symbols: string[]; avatarSrc: string }

export interface OverlaySnapshot {
  entries: { id: string; ts: number; type: string; text: string; status?: string }[];
  running: boolean;
  accent?: string;
  name?: string;
  symbols?: string[];
  /** Base64 JPEG of the bot picture; only sent when it changes. */
  avatar?: string;
}

export const OVERLAY_ENTRY_LIMIT = 150;

/** Pure: what the floating circle and its Trade Log show (newest lines, oldest first). */
export function buildOverlaySnapshot(
  entries: LogEntry[], running: boolean, accent?: string, profile?: { name: string; symbols: string[] },
): OverlaySnapshot {
  return {
    entries: entries.slice(-OVERLAY_ENTRY_LIMIT).map((e) => ({ id: e.id, ts: e.ts, type: e.type, text: e.text, status: e.status })),
    running,
    accent,
    name: profile?.name,
    symbols: profile?.symbols,
  };
}

/** Pure: the circle floats over other apps whenever the bot runs, unless the user hid it from the notification. */
export function shouldFloat(o: { native: boolean; permission: boolean; dismissed: boolean; botRunning: boolean }): boolean {
  return o.native && o.permission && !o.dismissed && o.botRunning;
}

/** Pure: in the Android app "Display over other apps" must be allowed before the mentor ID / email entry. */
export function appEntryStep(o: { checked: boolean; native: boolean; permission: boolean; signedIn: boolean }): "loading" | "overlay" | "signin" | "app" {
  if (!o.checked) return "loading";
  if (o.native && !o.permission) return "overlay";
  return o.signedIn ? "app" : "signin";
}

interface OverlayState {
  /** The Android check has finished (always true quickly on the website). */
  checked: boolean;
  native: boolean; permission: boolean; running: boolean;
  /** Hidden from the notification; it comes back the next time the bot starts. */
  dismissed: boolean;
}

let state: OverlayState = { checked: false, native: false, permission: false, running: false, dismissed: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<OverlayState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => state;
export const useNativeOverlay = () => useSyncExternalStore(subscribe, get, get);

let plugin: OverlayPlugin | null = null;
let initialised = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let permissionPoll: ReturnType<typeof setInterval> | undefined;
let syncing: Promise<void> = Promise.resolve();

let profile: OverlayProfile | null = null;
let sentAvatarSrc: string | null = null;
let avatarData: { src: string; b64: string } | null = null;

/** The trading colour as #rrggbb so the native circle matches the app. */
function accentHex(): string | undefined {
  try {
    const el = document.querySelector<HTMLElement>('[style*="--primary"]') ?? document.documentElement;
    const raw = getComputedStyle(el).getPropertyValue("--primary").trim();
    if (!raw) return undefined;
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = "#3b82f6";
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch { return undefined; }
}

/** Bot picture → small square JPEG (base64) for the native circle. */
function encodeAvatar(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 192;
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(null);
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.88).split(",")[1] ?? null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function ensureAvatar() {
  const src = profile?.avatarSrc;
  if (!src || avatarData?.src === src) return;
  const b64 = await encodeAvatar(src);
  if (b64 && profile?.avatarSrc === src) { avatarData = { src, b64 }; schedulePush(); }
}

function schedulePush() {
  if (!plugin || !state.running) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const log = getTradeLogState();
    const snap = buildOverlaySnapshot(log.entries, log.running, accentHex(), profile ?? undefined);
    if (avatarData && avatarData.src !== sentAvatarSrc) { snap.avatar = avatarData.b64; sentAvatarSrc = avatarData.src; }
    void plugin?.update(snap).catch(() => { sentAvatarSrc = null; });
  }, 200);
}

/** Shows or hides the native circle so it follows the bot's Start / Stop. */
function sync() {
  syncing = syncing.then(async () => {
    if (!plugin) return;
    const botRunning = getTradeLogState().running;
    if (!botRunning && state.dismissed) set({ dismissed: false });
    const want = shouldFloat({ ...state, botRunning });
    if (want && !state.running) {
      try {
        await plugin.start();
        sentAvatarSrc = null;
        set({ running: true });
      } catch { set({ running: false }); }
    } else if (!want && state.running) {
      await plugin.stop().catch(() => {});
      set({ running: false });
    }
    if (state.running) { void ensureAvatar(); schedulePush(); }
  });
  return syncing;
}

async function refresh() {
  if (!plugin) return;
  try {
    const s = await plugin.status();
    set({ permission: s.permission, running: s.running });
  } catch { set({ permission: true }); /* plugin unavailable: never lock the app out */ }
  await sync();
}

/** The in-app bot circle reports its picture, name and symbols here. */
export function setOverlayProfile(p: OverlayProfile) {
  if (profile && profile.avatarSrc === p.avatarSrc && profile.name === p.name && profile.symbols.join() === p.symbols.join()) return;
  profile = p;
  if (state.running) { void ensureAvatar(); schedulePush(); }
}

/** Runs once in the Android app; no-op on the website. */
export async function initNativeOverlay() {
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  // The Android shell's bridge marks the app as native; fall back to its bridge object if the helpers aren't ready yet.
  const bridge = !!(window as unknown as { androidBridge?: unknown }).androidBridge;
  const isNative = cap?.isNativePlatform ? cap.isNativePlatform() : bridge;
  const platform = cap?.getPlatform ? cap.getPlatform() : bridge ? "android" : "web";
  if (!cap || !isNative || platform !== "android") { set({ checked: true }); return; }
  const { registerPlugin } = await import("@capacitor/core");
  plugin = registerPlugin<OverlayPlugin>("TradeLogOverlay");
  set({ native: true });
  try {
    // "Hide" in the notification removes the circle until the bot is started again.
    await plugin.addListener("overlayStopped", () => set({ running: false, dismissed: true }));
    // STOP EA in the floating window stops the robot the same way the app's own button does.
    await plugin.addListener("stopRequested", () => tradeLog.stop());
  } catch { /* older shell */ }
  // Open the app straight away: a slow Android answer never holds the screen (the real answer is applied when it arrives).
  const first = await Promise.race([
    plugin.status().catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 800)),
  ]);
  set(first ? { permission: first.permission, running: first.running, checked: true } : { permission: true, checked: true });
  if (first) void sync(); else void refresh();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refresh(); });
  subscribeTradeLog(() => { void sync(); schedulePush(); });
}

export const overlayActions = {
  /** Required first step in the Android app: opens Android's "Display over other apps" page and watches for the answer. */
  async requestPermission() {
    if (!plugin) return;
    set({ dismissed: false });
    await refresh();
    if (state.permission) return;
    await plugin.openPermissionSettings().catch(() => {});
    clearInterval(permissionPoll);
    let tries = 0;
    permissionPoll = setInterval(() => {
      tries += 1;
      void refresh().then(() => { if (state.permission || tries > 90) clearInterval(permissionPoll); });
    }, 2000);
  },
  /** Re-reads the permission after the user comes back from Android settings. */
  async recheck() { await refresh(); },
};
