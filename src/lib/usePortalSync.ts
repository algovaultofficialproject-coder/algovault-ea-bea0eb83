import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPortalState, savePortalState } from "@/lib/portal-state.functions";
import { publishEAConfig } from "@/lib/ea-config.functions";
import { exportPortalState, hydratePortalState, setPortalScope, subscribePortal } from "@/lib/portal-store";
import { useAuth } from "@/hooks/useAuth";

/**
 * Keeps the local portal workspace (bots, licences, settings) in sync with the
 * signed-in account so everything reappears after logging in elsewhere.
 */
export function usePortalSync() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const load = useServerFn(getPortalState);
  const save = useServerFn(savePortalState);
  const publish = useServerFn(publishEAConfig);
  const ready = useRef(false);
  const lastSaved = useRef<string>("");

  // Scope local storage per account + pull the cloud copy.
  useEffect(() => {
    ready.current = false;
    setPortalScope(userId);
    if (!userId) return;
    let alive = true;
    (async () => {
      try {
        const json = await load({ data: undefined as never });
        if (!alive) return;
        if (json) {
          const parsed = JSON.parse(json as string);
          hydratePortalState(parsed);
          lastSaved.current = JSON.stringify(parsed);
        }
      } catch { /* offline — keep local copy */ }
      if (alive) ready.current = true;
    })();
    return () => { alive = false; };
  }, [userId, load]);

  // Push local changes up (debounced).
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      if (!ready.current) return;
      const json = JSON.stringify(exportPortalState());
      if (json === lastSaved.current) return;
      lastSaved.current = json;
      save({ data: { json } }).catch(() => { lastSaved.current = ""; });
      // Publish each bot's live config so clients pick up new symbols,
      // artwork and background videos automatically.
      for (const ea of exportPortalState().eas) {
        const code = ea.code;
        if (!code) continue;
        publish({ data: { code, payload: {
          id: ea.id,
          name: ea.name,
          image: ea.image ?? null,
          backgroundVideo: ea.backgroundVideo ?? null,
          symbols: (ea.symbols ?? []).map((sy) => ({
            symbol: sy.symbol, lotSize: String(sy.lotSize ?? "0.01"), action: String(sy.action ?? "BOTH"),
            platform: String(sy.platform ?? "MT4"), allowed: sy.allowed !== false,
            ...(sy.trades ? { trades: String(sy.trades) } : {}),
          })),
        } } }).catch(() => { /* offline */ });
      }
    };
    const unsub = subscribePortal(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(push, 600);
    });
    return () => { if (timer) clearTimeout(timer); unsub(); };
  }, [userId, save, publish]);
}
