import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { checkAppSession } from "./app-access.functions";
import { accessExpired, isAlwaysOpen } from "./app-access";
import { portalActions, getPortalState } from "./portal-store";
import { tradeLog } from "./trade-log";

const SESSION_KEY = "algo:app-session";
const UNTIL_KEY = "algo:app-until";

export function saveAppSession(session: string, until: string | null) {
  localStorage.setItem(SESSION_KEY, session);
  if (until) localStorage.setItem(UNTIL_KEY, until); else localStorage.removeItem(UNTIL_KEY);
}

/** Sign this phone out of the trading app and clear its bots — a fresh start. */
export function signOutPhone() {
  tradeLog.stop();
  for (const ea of getPortalState().eas) portalActions.removeEA(ea.id);
  portalActions.setActiveEA(null);
  portalActions.setActivatedEmail(null);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(UNTIL_KEY);
}

/**
 * Keeps a signed-in phone honest: it is signed out when its access days end,
 * when the owner removes the email/phone, or when every phone is reset.
 * Network failures never sign anyone out.
 */
export function useAppSessionGuard(email: string | null) {
  const check = useServerFn(checkAppSession);
  useEffect(() => {
    if (!email || isAlwaysOpen(email)) return;
    let alive = true;
    const tick = async () => {
      const session = localStorage.getItem(SESSION_KEY);
      if (!session || accessExpired(localStorage.getItem(UNTIL_KEY), Date.now())) { signOutPhone(); return; }
      try {
        const res = await check({ data: { email, session } });
        if (!alive) return;
        if (res.ok === false) signOutPhone();
        else if (res.ok) saveAppSession(session, res.until);
      } catch { /* offline — keep signed in */ }
    };
    void tick();
    const t = setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [email, check]);
}
