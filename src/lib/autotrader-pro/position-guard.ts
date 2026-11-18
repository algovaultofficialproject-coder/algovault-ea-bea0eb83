/**
 * Pure exit rules for open trades the app placed: close a trade that is in profit when the closed
 * candles show the market turning against it on more than one fast timeframe. Never opens trades.
 */
import { readMarketChange, type ChangeRead, type SwitchConfig } from "./market-change";
import { readCandles } from "./candles";
import type { Series } from "./indicators";
import type { Interval, Side } from "./types";

/** Frames the guard reads; 1m alone is too noisy to close a trade. */
export const GUARD_FRAMES: Interval[] = ["1m", "5m", "15m"];
const ANCHORS: Interval[] = ["5m", "15m"];

/** What the last closed candles say: dir +1 buyers / -1 sellers taking over; strength 2 = confirmed by price. */
export interface CandleTurn { dir: 1 | -1 | 0; strength: 0 | 1 | 2; text: string }

export type FrameRead = Pick<ChangeRead, "interval" | "direction" | "regime" | "earlyTransition" | "exhaustion"> & { candles?: CandleTurn };

const NO_TURN: CandleTurn = { dir: 0, strength: 0, text: "" };

/**
 * Candle-confirmed direction change on closed bar i ("Candle Turn" exit strategy):
 *  - confirmed (2): a strong reversal pattern (engulfing, star, outside bar…) that also closed through EMA 9,
 *    a reversal pattern on the previous bar followed through by this bar, or a strong candle breaking the last
 *    5-bar swing after a move the other way (micro change of character);
 *  - turning (1): a reliable reversal pattern or clear opposite candle pressure without that price confirmation.
 */
export function candleTurn(s: Series, i: number): CandleTurn {
  const a = s.atr[i];
  if (i < 8 || !Number.isFinite(a) || a <= 0) return NO_TURN;
  const now = readCandles(s, i), prev = readCandles(s, i - 1);
  const c = s.candles[i], c1 = s.candles[i - 1];
  const best = (r: typeof now) => r.patterns.filter((x) => x.dir !== 0).sort((x, y) => y.weight - x.weight)[0];
  const p0 = best(now), p1 = best(prev);
  const e9 = s.ema9[i];
  const bodyR = Math.abs(c.c - c.o) / Math.max(c.h - c.l, 1e-12);
  // 1) strong pattern closing through EMA 9
  if (p0 && p0.weight >= 2 && Number.isFinite(e9) && (c.c - e9) * p0.dir > 0 && (c1.c - e9) * p0.dir <= 0.2 * a)
    return { dir: p0.dir, strength: 2, text: `${p0.name} closed ${p0.dir > 0 ? "above" : "below"} EMA 9` };
  // 2) previous bar's reversal pattern followed through
  if (p1 && p1.weight >= 2 && (c.c - c1.c) * p1.dir > 0 && (c.c - c.o) * p1.dir > 0)
    return { dir: p1.dir, strength: 2, text: `${p1.name} confirmed by the next candle` };
  // 3) micro change of character: strong candle closes beyond the last 5-bar swing against the prior move
  let hi = -Infinity, lo = Infinity;
  for (let j = i - 5; j < i; j++) { hi = Math.max(hi, s.candles[j].h); lo = Math.min(lo, s.candles[j].l); }
  const rose = s.candles[i - 1].c > s.candles[i - 6].c, fell = s.candles[i - 1].c < s.candles[i - 6].c;
  if (bodyR >= 0.5 && rose && c.c < lo) return { dir: -1, strength: 2, text: "candle broke the last swing low (change of character)" };
  if (bodyR >= 0.5 && fell && c.c > hi) return { dir: 1, strength: 2, text: "candle broke the last swing high (change of character)" };
  if (p0 && p0.weight >= 1.5) return { dir: p0.dir, strength: 1, text: p0.name };
  if (Math.abs(now.bias) >= 0.5) return { dir: now.bias > 0 ? 1 : -1, strength: 1, text: `${now.bias > 0 ? "buying" : "selling"} candle pressure` };
  return NO_TURN;
}

/** Everything the guard reads on one closed frame: the market-change read plus the candle turn. */
export function readFrame(s: Series, i: number, interval: Interval, cfg: SwitchConfig): FrameRead {
  return { ...readMarketChange(s, i, interval, cfg), candles: candleTurn(s, i) };
}

export interface GuardTrade { ticket: string; symbol: string; type: string; profit: number; comment: string; openPrice?: number; price?: number; sl?: number }

export type ProfitTier = "small" | "normal" | "big";

/**
 * Profit size measured against the trade's own risk (distance to its stop loss): under 0.5R small,
 * 0.5R–1.5R normal, above 1.5R big. Without a usable stop or prices it counts as normal.
 */
export function profitTier(t: GuardTrade): ProfitTier {
  const { openPrice: o = 0, price: p = 0, sl = 0 } = t;
  const risk = Math.abs(o - sl);
  if (!(o > 0 && p > 0 && sl > 0 && risk > 0)) return "normal";
  const r = Math.abs(p - o) / risk;
  return r < 0.5 ? "small" : r > 1.5 ? "big" : "normal";
}

/** Trades placed by this app carry "AlgoVault" in their comment; anything else is never touched. */
export const isAppTrade = (comment: string) => /algovault/i.test(comment);

/** BUY / SELL from the broker's order type text; null when unclear (pending orders etc.). */
export function tradeSide(type: string): Side | null {
  const t = String(type).toLowerCase();
  if (/limit|stop/.test(t)) return null;
  if (/buy/.test(t) || t === "0") return "BUY";
  if (/sell/.test(t) || t === "1") return "SELL";
  return null;
}

/** 0 = no change against the trade, 1 = turning against it, 2 = confirmed reversal against it. */
export function againstStrength(r: FrameRead, side: Side): 0 | 1 | 2 {
  const sign = side === "BUY" ? 1 : -1;
  if (r.exhaustion.stage === "confirmed" && r.exhaustion.trend === sign) return 2;
  const candle = r.candles && r.candles.dir === -sign ? r.candles.strength : 0;
  if (candle === 2) return 2;
  const opposing = side === "BUY" ? "bearish" : "bullish";
  if (r.direction !== opposing) return 0;
  const oppRegime = side === "BUY" ? r.regime === "strong_bear" || r.regime === "weak_bear" : r.regime === "strong_bull" || r.regime === "weak_bull";
  const possible = r.exhaustion.stage === "possible" && r.exhaustion.trend === sign;
  return r.earlyTransition || possible || oppRegime || candle === 1 ? 1 : 0;
}

const voteText = (r: FrameRead, v: 1 | 2, side: Side) => {
  const sign = side === "BUY" ? 1 : -1;
  const candle = r.candles && r.candles.dir === -sign && r.candles.strength > 0 ? r.candles.text : "";
  if (v === 2) return r.exhaustion.stage === "confirmed" && r.exhaustion.trend === sign ? "confirmed reversal" : `candles confirm: ${candle}`;
  return r.earlyTransition ?? (r.direction !== "neutral" && r.direction !== (side === "BUY" ? "bullish" : "bearish") ? `turning ${r.direction}` : candle ? `candles: ${candle}` : `turning ${r.direction}`);
};

export interface ExitDecision { close: boolean; reason: string }

/**
 * Close only when the trade is in profit (after swap/commission) and the candles turn against it. How much
 * evidence is needed depends on the analysis and the profit size, so trades can grow into normal and big wins:
 *  - small profit: only a confirmed 5m/15m reversal (ordinary wiggles don't cut it early)
 *  - normal profit: a confirmed 5m/15m reversal, or two frames (one of them 5m/15m) turning against it
 *  - big profit: protect it — any 5m/15m frame turning against it is enough
 * A candle-confirmed turn on 5m/15m (see candleTurn) counts as a confirmed reversal.
 */
export function reversalExit(trade: GuardTrade, reads: FrameRead[], minProfit = 0): ExitDecision {
  const side = tradeSide(trade.type);
  if (!side) return { close: false, reason: "unknown direction" };
  if (!(trade.profit > minProfit)) return { close: false, reason: "not in profit" };
  const tier = profitTier(trade);
  const votes = reads.map((r) => ({ r, v: againstStrength(r, side) })).filter((x): x is { r: FrameRead; v: 1 | 2 } => x.v > 0);
  const text = votes.map((x) => `${x.r.interval} ${voteText(x.r, x.v, side)}`).join(" · ");
  const strongAnchor = votes.some((x) => x.v === 2 && ANCHORS.includes(x.r.interval));
  const anchored = votes.some((x) => ANCHORS.includes(x.r.interval));
  const close = tier === "small" ? strongAnchor : tier === "big" ? anchored : strongAnchor || (votes.length >= 2 && anchored);
  if (close) return { close: true, reason: `Direction changing against ${side} (${tier} profit): ${text}` };
  return { close: false, reason: `${tier} profit · ${votes.length ? `watching: ${text}` : "direction holding"}` };
}
