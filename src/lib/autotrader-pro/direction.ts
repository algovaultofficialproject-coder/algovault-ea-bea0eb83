/**
 * Pure direction engine: reads 1m/5m/15m closed candles together (15m bias, 5m confirmation, 1m timing) and
 * scores BUY, SELL and NO-TRADE from measurable evidence — structure, EMA 9/21/50/200, RSI, MACD, ADX,
 * rate of change and the last candle's body/wicks. It explains the decision; it never places orders.
 */
import type { Series } from "./indicators";
import type { SmcRead } from "./smc";
import type { Interval, Side } from "./types";

export interface DirectionFrame { interval: Interval; series: Series; i: number; smc?: SmcRead }
export interface DirectionScores {
  buy: number; sell: number; noTrade: number; side: Side;
  why: { buy: string[]; sell: string[]; noTrade: string[] };
  text: string;
}

/** 15m sets the bias, 5m confirms, 1m only times the entry. */
export const DIRECTION_WEIGHT: Partial<Record<Interval, number>> = { "15m": 4, "5m": 3, "1m": 1 };
const fin = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export function directionScores(frames: DirectionFrame[]): DirectionScores {
  let bull = 0, bear = 0;
  const why = { buy: [] as string[], sell: [] as string[], noTrade: [] as string[] };
  const add = (dir: 1 | -1, pts: number, text: string) => {
    if (dir > 0) { bull += pts; why.buy.push(text); } else { bear += pts; why.sell.push(text); }
  };
  const lean: Partial<Record<Interval, number>> = {};
  for (const f of frames) {
    const s = f.series, i = f.i, w = DIRECTION_WEIGHT[f.interval] ?? 1, tf = f.interval;
    const c = s.candles[i];
    if (!c || i < 30) continue;
    const before = bull - bear;
    if (f.smc && f.smc.bias !== "neutral") add(f.smc.bias === "bullish" ? 1 : -1, 2 * w, `${tf} structure ${f.smc.bias} (BOS/CHoCH)`);
    const e9 = s.ema9[i], e21 = s.ema21[i], e50 = s.ema50[i], e200 = s.ema200[i];
    if (fin(e9) && fin(e21) && fin(e50)) {
      if (e9 > e21 && e21 > e50) add(1, 1.5 * w, `${tf} EMA 9 > 21 > 50`);
      else if (e9 < e21 && e21 < e50) add(-1, 1.5 * w, `${tf} EMA 9 < 21 < 50`);
      const prev = s.ema50[i - 5];
      if (fin(prev) && e50 !== prev) add(e50 > prev ? 1 : -1, 0.5 * w, `${tf} EMA 50 sloping ${e50 > prev ? "up" : "down"}`);
    }
    if (fin(e200) && i >= 200) add(c.c > e200 ? 1 : -1, 0.5 * w, `${tf} price ${c.c > e200 ? "above" : "below"} EMA 200`);
    const r = s.rsi[i];
    if (fin(r) && (r >= 55 || r <= 45)) add(r >= 55 ? 1 : -1, 0.75 * w, `${tf} RSI ${r.toFixed(0)}`);
    const h = s.macdHist[i], hp = s.macdHist[i - 1];
    if (fin(h) && fin(hp) && h !== 0) add(h > 0 ? 1 : -1, (Math.sign(h - hp) === Math.sign(h) ? 0.75 : 0.35) * w, `${tf} MACD ${h > 0 ? "positive" : "negative"}${Math.sign(h - hp) === Math.sign(h) ? " and growing" : ""}`);
    const adx = s.adx[i], dp = s.diPlus[i], dm = s.diMinus[i];
    if (fin(adx) && fin(dp) && fin(dm) && adx >= 20) add(dp > dm ? 1 : -1, 0.75 * w, `${tf} ADX ${adx.toFixed(0)} trend ${dp > dm ? "up" : "down"}`);
    else if (fin(adx) && adx < 18 && tf !== "1m") why.noTrade.push(`${tf} ADX ${adx.toFixed(0)} — choppy`);
    const old = s.closes[i - 10];
    if (fin(old) && old > 0) { const roc = (c.c - old) / old; if (Math.abs(roc) > 0) add(roc > 0 ? 1 : -1, 0.35 * w, `${tf} rate of change ${(roc * 100).toFixed(2)}%`); }
    const range = c.h - c.l;
    if (range > 0) {
      const body = Math.abs(c.c - c.o) / range, upper = (c.h - Math.max(c.o, c.c)) / range, lower = (Math.min(c.o, c.c) - c.l) / range;
      if (body >= 0.6) add(c.c > c.o ? 1 : -1, 0.5 * w, `${tf} strong ${c.c > c.o ? "bull" : "bear"} candle (body ${(body * 100).toFixed(0)}%)`);
      else if (lower >= 0.55) add(1, 0.5 * w, `${tf} lower-wick rejection`);
      else if (upper >= 0.55) add(-1, 0.5 * w, `${tf} upper-wick rejection`);
      else if (body <= 0.1) why.noTrade.push(`${tf} doji — indecision`);
    }
    lean[tf] = bull - bear - before;
  }
  const total = bull + bear;
  const buy = total > 0 ? Math.round((bull / total) * 100) : 50;
  const sell = 100 - buy;
  const gap = Math.abs(buy - sell);
  if (gap < 15) why.noTrade.push(`BUY ${buy} vs SELL ${sell} — too close`);
  const l15 = lean["15m"] ?? 0, l5 = lean["5m"] ?? 0;
  if (l15 * l5 < 0) why.noTrade.push("15m and 5m disagree");
  const noTrade = Math.max(0, Math.min(100, Math.round(100 - gap + why.noTrade.length * 5)));
  const side: Side = bull > bear ? "BUY" : bear > bull ? "SELL" : (frames.find((f) => f.interval === "1m")?.series.candles.at(-1)?.c ?? 0) >= (frames.find((f) => f.interval === "1m")?.series.candles.at(-1)?.o ?? 0) ? "BUY" : "SELL";
  return { buy, sell, noTrade, side, why, text: `Scores BUY ${buy} · SELL ${sell} · NO-TRADE ${noTrade}` };
}
