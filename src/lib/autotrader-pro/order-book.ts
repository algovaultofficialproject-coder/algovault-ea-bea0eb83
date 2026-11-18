/** Device-local order book for the smart pending-order engine (paper + broker-confirmed orders) with lifecycle history. */
import { useSyncExternalStore } from "react";
import type { AutomationMode, OrderStatus, PlannedOrder } from "./order-planner";

export interface OrderBookState { mode: AutomationMode; minScore: number; orders: PlannedOrder[] }
const KEY = "av_order_book_v1";
const DEFAULT: OrderBookState = { mode: "scan", minScore: 70, orders: [] };
let state: OrderBookState | null = null;
const subs = new Set<() => void>();
const load = (): OrderBookState => {
  if (state) return state;
  try { state = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { state = DEFAULT; }
  return state!;
};
const set = (fn: (s: OrderBookState) => OrderBookState) => {
  state = fn(load());
  state.orders = state.orders.slice(0, 200);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full */ }
  subs.forEach((f) => f());
};
export const useOrderBook = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, load, () => DEFAULT);
export const getOrderBook = load;

const OPEN: OrderStatus[] = ["not_submitted", "submitted", "pending"];
/** An active order (or one still being submitted) already covers this setup — never place it twice. */
export const hasActive = (s: OrderBookState, key: string) => s.orders.some((o) => o.key === key && OPEN.includes(o.status));

export const orderBook = {
  setMode(mode: AutomationMode) { set((s) => ({ ...s, mode })); },
  setMinScore(minScore: number) { set((s) => ({ ...s, minScore })); },
  add(o: PlannedOrder): boolean {
    if (hasActive(load(), o.key)) return false;
    set((s) => ({ ...s, orders: [o, ...s.orders] }));
    return true;
  },
  update(id: string, patch: Partial<PlannedOrder>, event: string, note?: string) {
    set((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch, history: [...o.history, { at: Date.now(), event, note }] } : o)) }));
  },
  clearClosed() { set((s) => ({ ...s, orders: s.orders.filter((o) => OPEN.includes(o.status)) })); },
};
