import { useSyncExternalStore } from "react";
import type { AccountCurrency } from "@/lib/autotrader-pro/loss-cap";

/** Device-local loss-limit settings (typed by the user, never read from the broker). */
export interface SmallAccountPrefs { currency: AccountCurrency; cent: boolean; lossCap: boolean; maxLoss: string }
const KEY = "algovault-small-account";
const DEFAULTS: SmallAccountPrefs = { currency: "ZAR", cent: false, lossCap: true, maxLoss: "100" };
let state: SmallAccountPrefs | null = null;
const listeners = new Set<() => void>();

function load(): SmallAccountPrefs {
  if (state) return state;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SmallAccountPrefs> | null;
    state = { ...DEFAULTS, ...(v ?? {}), currency: v?.currency === "USD" ? "USD" : "ZAR" };
  } catch { state = { ...DEFAULTS }; }
  return state;
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const smallAccount = {
  get: (): SmallAccountPrefs => (typeof window === "undefined" ? DEFAULTS : load()),
  set(patch: Partial<SmallAccountPrefs>) {
    state = { ...load(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    listeners.forEach((l) => l());
  },
};
export const useSmallAccount = () => useSyncExternalStore(subscribe, smallAccount.get, () => DEFAULTS);
