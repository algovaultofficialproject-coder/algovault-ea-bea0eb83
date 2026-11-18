import { ORDER_LABEL, type Decision } from "./order-planner";
import type { BoardRow } from "./scanner-board";

export interface BotRelaySignal { symbol: string; side: "BUY" | "SELL"; lot: number; stop_loss: number; take_profit: number; comment: string }

/**
 * Which AutoTrader Pro signals go to the trading-app bot. Every BUY/SELL signal on the scanner board
 * (market, stop or limit) is sent straight away as a plain BUY or SELL with its stop and TP2 — no waiting
 * for a stop/limit entry to trigger. WAIT/REJECT rows, rows without live data and already-sent signals are skipped.
 */
export function rowRelaySignal(
  r: Pick<BoardRow, "symbol" | "side" | "decision" | "lots" | "sl" | "tps" | "key" | "data">,
  sent: ReadonlySet<string>,
): BotRelaySignal | null {
  const d: Decision = r.decision;
  if (d === "WAIT" || d === "REJECT" || !r.key || sent.has(r.key)) return null;
  if (r.side !== "BUY" && r.side !== "SELL") return null;
  if (r.data === "unavailable" || !r.sl || !r.tps) return null;
  return { symbol: r.symbol, side: r.side, lot: r.lots && r.lots > 0 ? r.lots : 0.01, stop_loss: r.sl, take_profit: r.tps[1], comment: `AutoTrader Pro ${ORDER_LABEL[d]}`.slice(0, 64) };
}
