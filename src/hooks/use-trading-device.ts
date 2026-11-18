import { useEffect } from "react";
import { textSizePx } from "@/lib/trading-prefs";

/** Scales the trading app's text while it is open; restores the page size on leave. */
export function useTextSize(size: string) {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.fontSize;
    root.style.fontSize = `${textSizePx(size)}px`;
    return () => { root.style.fontSize = prev; };
  }, [size]);
}

type Sentinel = { release: () => Promise<void> };

/** Keeps the screen on while enabled (Wake Lock API); silently does nothing where unsupported. */
export function useKeepAwake(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock;
    if (!wl) return;
    let lock: Sentinel | null = null;
    let cancelled = false;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen").then((l) => { if (cancelled) l.release().catch(() => {}); else lock = l; }).catch(() => {});
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", request);
      lock?.release().catch(() => {});
    };
  }, [on]);
}
