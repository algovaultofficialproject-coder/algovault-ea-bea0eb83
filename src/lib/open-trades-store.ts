import { useSyncExternalStore } from "react";

/** One open broker trade as returned by getOpenTrades (profit includes swap + commission). */
export interface OpenOrder {
  ticket: string; symbol: string; profit: number; lots: number; comment: string; type: string; openedAt: number;
  openPrice: number; price: number; sl: number; tp: number;
}

/** Device-local snapshot of the connected account's open trades, shared by the guard and the MetaTrader tab. */
export interface OpenTradesState {
  status: "idle" | "loading" | "ok" | "error";
  trades: OpenOrder[];
  balance: number | null; equity: number | null; currency: string | null;
  updatedAt: number | null; error: string | null;
  /** Latest guard note per ticket, e.g. "watching: 5m turning bearish". */
  notes: Record<string, string>;
  /** 24/7 server watch state for this account; null until first sync. */
  cloud: { enabled: boolean; lastCheckAt: number | null; status: string | null } | null;
}

const empty: OpenTradesState = { status: "idle", trades: [], balance: null, equity: null, currency: null, updatedAt: null, error: null, notes: {}, cloud: null };
let state = empty;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const openTrades = {
  get: () => state,
  set(patch: Partial<OpenTradesState>) { state = { ...state, ...patch }; emit(); },
  reset() { if (state !== empty) { state = empty; emit(); } },
};

export function useOpenTrades() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => empty);
}
