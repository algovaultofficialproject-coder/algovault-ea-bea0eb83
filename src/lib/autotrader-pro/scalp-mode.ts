/**
 * Profit Sniper scalp mode (per pair). Pure: keeps the engine's protective structural stop and
 * takes profit early — at most 1R (one stop-distance) and never beyond the engine's own target —
 * so scalp pairs bank quick moves while "normal" pairs keep the full AutoTrader Pro plan.
 */
export type PairMode = "normal" | "scalp";
export const SCALP_TARGET_R = 1;

export function pairMode(v: unknown): PairMode {
  return v === "scalp" ? "scalp" : "normal";
}

export function scalpTarget(side: "BUY" | "SELL", entry: number, stopLoss: number, takeProfit: number): number {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  const dist = Math.min(reward, risk * SCALP_TARGET_R);
  return side === "BUY" ? entry + dist : entry - dist;
}
