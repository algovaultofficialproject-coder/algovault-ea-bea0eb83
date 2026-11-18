import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getOpenTrades } from "@/lib/metaapi.functions";
import { usePortalStore } from "@/lib/portal-store";
import { tradeLog } from "@/lib/trade-log";
import { openTrades } from "@/lib/open-trades-store";
import { connectedAccount } from "@/lib/autotrader-pro/execution";

/** Live P/L refresh: one second after each finished read, so slow brokers never stack requests. */
export const POLL_MS = 1_000;
// One reader at a time across the app, so two screens never stack broker requests.
let readBusy = false;

/**
 * Reads the connected MetaTrader account while the app is open: balance, equity and open trades with
 * their running profit/loss. Read-only: it never closes or opens trades (the 24/7 watch was removed).
 * `keepAwake` holds the screen on while a robot runs.
 */
export function usePositionGuard(keepAwake: boolean) {
  const portal = usePortalStore();
  const acct = connectedAccount(portal);
  const readFn = useServerFn(getOpenTrades);
  const key = acct ? `${acct.platform}|${acct.login}|${acct.server}|${acct.password}` : "";

  useEffect(() => {
    if (!acct) { openTrades.reset(); return; }
    let alive = true;
    const creds = { platform: acct.platform, login: acct.login, password: acct.password, server: acct.server };
    const lastErr = { text: "", at: 0 };

    const tick = async () => {
      if (!alive || readBusy) return;
      readBusy = true;
      try {
        if (openTrades.get().status === "idle") openTrades.set({ status: "loading" });
        const res = await readFn({ data: creds });
        if (!alive) return;
        if (!res.ok) {
          const err = res.error ?? "account unavailable";
          openTrades.set({ status: "error", error: err });
          if (err !== lastErr.text || Date.now() - lastErr.at > 5 * 60_000) {
            lastErr.text = err; lastErr.at = Date.now();
            tradeLog.error(`>> Position check: ${err.slice(0, 120)} — retrying`);
          }
          return;
        }
        openTrades.set({
          status: "ok", error: null, trades: res.trades, notes: {}, updatedAt: Date.now(),
          balance: res.balance != null ? Number(res.balance) : null, equity: res.equity != null ? Number(res.equity) : null, currency: res.currency ?? null,
        });
      } catch (e) {
        openTrades.set({ status: "error", error: e instanceof Error ? e.message : "Network error" });
      } finally { readBusy = false; }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => { await tick(); if (alive) timer = setTimeout(() => void loop(), POLL_MS); };
    void loop();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Keep the screen awake while a robot runs so the browser keeps scanning and guarding.
  useEffect(() => {
    if (!keepAwake || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const grab = async () => {
      try { if (alive && document.visibilityState === "visible") lock = await (navigator as unknown as { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen"); } catch { /* not allowed */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") void grab(); };
    void grab();
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVis); void lock?.release().catch(() => undefined); };
  }, [keepAwake]);
}
