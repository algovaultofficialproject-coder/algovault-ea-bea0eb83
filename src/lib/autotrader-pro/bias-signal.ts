/**
 * Pure: the home robot never answers WAIT. When no strategy setup passes, the market's lean decides
 * BUY or SELL: 15m–1h structure bias and EMA21/EMA50 trend (heaviest), then 1m/5m, then the last closed
 * candle as tie-break. Stops/targets come from the TP/SL plan when valid, else 1.5×ATR15 stop and 2R target.
 */
import type { Interval, Side } from "./types";

export interface BiasFrame { interval: Interval; bias: "bullish" | "bearish" | "neutral"; price: number; ema21: number; ema50: number; atr: number; lastUp: boolean }
export interface BiasPlan { ok: boolean; stop: number; tp2: { x: number } }
export interface BiasSignal { ok: true; side: Side; id: string; interval: Interval; entry: number; stopLoss: number; takeProfit: number; confidence: number; strategy: string; reason: string; confirmed: false }

const W: Partial<Record<Interval, number>> = { "1m": 0.5, "5m": 1, "15m": 4, "30m": 3, "1h": 4 };
const ok = (n: number) => Number.isFinite(n) && n > 0;

export function biasSide(frames: BiasFrame[], prefer?: Side): { side: Side; score: number } {
  let score = 0;
  for (const f of frames) {
    const w = W[f.interval] ?? 1;
    if (f.bias === "bullish") score += w; else if (f.bias === "bearish") score -= w;
    if (ok(f.ema21) && ok(f.ema50)) score += (f.price > f.ema50 ? 0.5 : -0.5) * w + (f.ema21 > f.ema50 ? 0.5 : -0.5) * w;
  }
  if (score === 0 && prefer) return { side: prefer, score };
  if (score === 0) {
    const last = frames.find((f) => f.interval === "1m") ?? frames[0];
    return { side: last && !last.lastUp ? "SELL" : "BUY", score };
  }
  return { side: score > 0 ? "BUY" : "SELL", score };
}

export function biasSignal(frames: BiasFrame[], why: string, plan?: (side: Side) => BiasPlan | undefined, prefer?: Side, force?: Side): BiasSignal | null {
  if (frames.length === 0) return null;
  const lean = biasSide(frames, prefer);
  const side = force ?? lean.side, score = lean.score;
  const anchor = frames.find((f) => f.interval === "1m") ?? frames.find((f) => f.interval === "5m") ?? frames[0];
  const f15 = frames.find((f) => f.interval === "15m") ?? anchor;
  const entry = anchor.price, atr15 = ok(f15.atr) ? f15.atr : anchor.atr, d = side === "BUY" ? 1 : -1;
  if (!ok(entry) || !ok(atr15)) return null;
  const p = plan?.(side);
  const minStop = atr15; // never tighter than one 15m ATR
  let stop = p && p.ok && ok(p.stop) && (side === "BUY" ? p.stop < entry : p.stop > entry) ? p.stop : entry - d * 1.5 * atr15;
  if (Math.abs(entry - stop) < minStop) stop = entry - d * minStop;
  const risk = Math.abs(entry - stop);
  let tp = p && p.ok && ok(p.tp2.x) && (side === "BUY" ? p.tp2.x > entry : p.tp2.x < entry) ? p.tp2.x : entry + d * 2 * risk;
  if (Math.abs(tp - entry) < risk) tp = entry + d * 1.5 * risk;
  const total = frames.reduce((a, f) => a + 2 * (W[f.interval] ?? 1), 0) || 1;
  const confidence = Math.round(Math.max(50, Math.min(75, 50 + (Math.abs(score) / total) * 50)));
  return {
    ok: true, side, id: `bias-${side}`, interval: anchor.interval, entry, stopLoss: stop, takeProfit: tp, confidence,
    strategy: "Market Bias", confirmed: false,
    reason: `${side} on market lean (15m–1h structure + EMA trend${score === 0 ? ", tie → last candle" : ""}) · ${why}`,
  };
}
