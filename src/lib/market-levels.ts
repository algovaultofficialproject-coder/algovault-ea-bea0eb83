import type { ChartCandle } from "./auto-chart";

/** True range includes gaps; averages actual available observations. */
export function chartAtr(candles: ChartCandle[], period = 14) {
  const ranges = candles.slice(-period).map((c, i, recent) => {
    const prev = i ? recent[i - 1]?.close : candles[candles.length - recent.length - 1]?.close;
    return Math.max(c.high - c.low, prev == null ? 0 : Math.abs(c.high - prev), prev == null ? 0 : Math.abs(c.low - prev));
  });
  return ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
}

/** Target before the nearest obstacle, never beyond it to manufacture a reward ratio. */
export function movementLevels(candles: ChartCandle[], price: number, side: "BUY" | "SELL", gold = false) {
  if (candles.length < 30 || !Number.isFinite(price) || price <= 0 || candles.some((c) => ![c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0) || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close))) return null;
  const atr = chartAtr(candles, gold ? 20 : 14);
  if (!(atr > 0)) return null;
  const s = side === "BUY" ? 1 : -1;
  const wide = candles.slice(-80), recent = candles.slice(-12);
  const invalidation = s > 0 ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high));
  const distance = Math.max(atr * (gold ? 3.5 : 3), (price - invalidation) * s + atr * (gold ? 1.5 : 1));
  const obstacles: number[] = [];
  for (let i = 2; i < wide.length - 2; i++) {
    const bar = wide[i];
    const window = wide.slice(i - 2, i + 3);
    const level = s > 0 ? bar.high : bar.low;
    if ((level - price) * s > 0 && (s > 0 ? level === Math.max(...window.map((c) => c.high)) : level === Math.min(...window.map((c) => c.low)))) obstacles.push(level);
  }
  const last = candles.at(-1), past = candles.at(-5);
  if (!last || !past) return null;
  // A conservative volatility projection, capped by measured recent movement.
  const projected = Math.min(atr * (gold ? 1.2 : 1.5), Math.max(atr * 0.65, Math.abs(last.close - past.close) * 0.5));
  const nearestDistance = obstacles.length ? Math.min(...obstacles.map((level) => (level - price) * s)) : Infinity;
  const targetDistance = Math.min(projected, nearestDistance - atr * (gold ? 0.25 : 0.15));
  // Too little clear space: publish direction but do not automatically enter.
  const clearPath = targetDistance >= atr * 0.35;
  const tpDistance = Math.max(atr * 0.05, targetDistance);
  const stopLoss = price - s * distance, takeProfit = price + s * tpDistance;
  if (stopLoss <= 0 || takeProfit <= 0) return null;
  return { stopLoss, takeProfit, atr, clearPath, reason: Number.isFinite(nearestDistance) ? "Target before nearby opposing liquidity, capped by recent movement" : "Conservative target based on recent displacement and true-range volatility" };
}
