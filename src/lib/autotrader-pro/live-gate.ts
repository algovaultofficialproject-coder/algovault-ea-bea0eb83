/**
 * Pure live-entry gate for the home robot. Live broker orders keep a fixed stop, so entries need: at least
 * one 5m–1h setup on the same side, a 15m trend with the trade (trend mode) or no 15m/1h trend against it (range mode), enough confidence, and a stop wide enough for 15m noise and spread.
 * A confirmed setup passes at LIVE_MIN_CONFIDENCE; an early one (candle not yet closed in its favour) passes
 * only when it is stronger (LIVE_EARLY_MIN_CONFIDENCE) and at least two 5m–1h setups clearly agree.
 * Anything else becomes WAIT — skipping a doubtful trade costs nothing, a stop-out costs real money.
 */
import type { Side } from "./types";

export const LIVE_MIN_CONFIDENCE = 60;
export const LIVE_EARLY_MIN_CONFIDENCE = 62;
/** Stop must be at least this share of the 15m ATR (tighter stops get hit by noise). */
export const LIVE_MIN_STOP_ATR = 0.5;
/** Stop must be at least this many spreads away (otherwise the spread alone eats the trade). */
export const LIVE_MIN_STOP_SPREADS = 4;

export type GateInput = {
  side: Side | "WAIT"; confirmed: boolean; confidence: number; entry: number; stopLoss: number;
  /** Sides of every setup found on 15m/30m/1h. */
  trendSides: Side[];
  atr15?: number; spread?: number;
  /** EMA-50 trend bias per chart (1 up, -1 down, 0 flat). Trend trades need 15m with them; 5m and 1h only veto when opposite. */
  bias?: { m5?: -1 | 0 | 1; m15?: -1 | 0 | 1; h1?: -1 | 0 | 1 };
  /** "range" = a mean-reversion setup (M–P): no 15m/1h trend against it. "transition" = a range breakout,
   * retest or exhaustion turn (Q–S): the slower trend lags a change of state, so only 15m AND 1h both against it block. */
  mode?: "trend" | "range" | "transition";
};

export function liveEntryGate(g: GateInput): { pass: true } | { pass: false; reason: string } {
  if (g.side === "WAIT") return { pass: false, reason: "No setup" };
  const dir = g.side === "BUY" ? 1 : -1;
  const b = g.bias, word = g.side === "BUY" ? "up" : "down";
  if (b) {
    if (g.mode === "transition") {
      if (b.m15 === -dir && b.h1 === -dir) return { pass: false, reason: `${g.side} transition fights both the 15m and 1h trend — skipping` };
    } else if (g.mode === "range") {
      if (b.m15 === -dir || b.h1 === -dir) return { pass: false, reason: `Range ${g.side} fights a clean ${b.m15 === -dir ? "15m" : "1h"} trend — skipping` };
    } else {
      if (b.m15 !== undefined && b.m15 !== dir) return { pass: false, reason: `15m trend does not point ${word} — waiting` };
      if (b.m5 === -dir || b.h1 === -dir) return { pass: false, reason: `${b.m5 === -dir ? "5m" : "1h"} trend points the other way — waiting` };
    }
  }
  if (!g.trendSides.includes(g.side)) return { pass: false, reason: `No 5m–1h setup agrees with ${g.side} — 1m alone never decides` };
  if (!g.confirmed) {
    const same = g.trendSides.filter((s) => s === g.side).length;
    if (same < 2 || same * 3 < g.trendSides.length * 2) return { pass: false, reason: "Early setup without clear 15m–1h agreement — waiting for confirmation" };
    if (!(g.confidence >= LIVE_EARLY_MIN_CONFIDENCE)) return { pass: false, reason: `Early setup at ${Math.round(g.confidence)}% — needs ${LIVE_EARLY_MIN_CONFIDENCE}% before the candle confirms` };
  }
  if (g.trendSides.some((s) => s !== g.side)) {
    const same = g.trendSides.filter((s) => s === g.side).length;
    if (same * 2 <= g.trendSides.length) return { pass: false, reason: "15m–1h setups are split — no clear trend" };
  }
  if (!(g.confidence >= LIVE_MIN_CONFIDENCE)) return { pass: false, reason: `Confidence ${Math.round(g.confidence)}% is below ${LIVE_MIN_CONFIDENCE}%` };
  const risk = Math.abs(g.entry - g.stopLoss);
  if (!(risk > 0)) return { pass: false, reason: "Invalid stop" };
  if (g.atr15 && g.atr15 > 0 && risk < LIVE_MIN_STOP_ATR * g.atr15) return { pass: false, reason: "Stop too tight for normal 15m movement — would likely be hit by noise" };
  if (g.spread && g.spread > 0 && risk < LIVE_MIN_STOP_SPREADS * g.spread) return { pass: false, reason: "Stop too close compared with the broker spread" };
  return { pass: true };
}

