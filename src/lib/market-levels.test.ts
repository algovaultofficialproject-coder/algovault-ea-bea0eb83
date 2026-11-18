import { describe, expect, it } from "vitest";
import { chartAtr, movementLevels } from "./market-levels";
import { scan15m } from "./local-scanner";
import type { AutoChart, ChartCandle } from "./auto-chart";

function candles(direction: number, n = 80): ChartCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const open = 2400 + direction * i * 2;
    const close = open + direction * 1.5;
    return { time: 1700000000 + i * 900, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1 };
  });
}
function chart(direction: number): AutoChart {
  const c = candles(direction);
  return { symbol: "XAUUSD", source: "test", fetchedAt: 0, m1: c, m5: c, m15: c, h1: c };
}
describe("Movement-led 15m scanner", () => {
  it("scores bullish and bearish movement symmetrically", () => {
    expect(scan15m(chart(1), undefined, "XAUUSD").side).toBe("BUY");
    expect(scan15m(chart(-1), undefined, "GOLD").side).toBe("SELL");
  });
  it("keeps gold stops wide with nearer estimated targets", () => {
    for (const direction of [1, -1]) {
      const c = candles(direction), price = c[c.length - 1].close;
      const result = movementLevels(c, price, direction > 0 ? "BUY" : "SELL", true);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(Math.abs(price - result.stopLoss)).toBeGreaterThanOrEqual(result.atr * 3.5 - 1e-8);
      expect(Math.abs(price - result.takeProfit)).toBeLessThanOrEqual(result.atr * 1.2 + 1e-8);
      expect((result.takeProfit - price) * direction).toBeGreaterThan(0);
      expect((result.stopLoss - price) * direction).toBeLessThan(0);
    }
  });
  it("accounts for price gaps in volatility", () => {
    const c = candles(1);
    c[c.length - 1] = { ...c[c.length - 1], open: 2700, close: 2701, high: 2702, low: 2699 };
    expect(chartAtr(c)).toBeGreaterThan(10);
  });
  it("does not turn a gold spike into an automatic entry", () => {
    const input = chart(1), last = input.m15.at(-1);
    if (!last) return;
    input.m15 = [...input.m15.slice(0, -1), { ...last, high: last.high + 100 }];
    const signal = scan15m(input, undefined, "XAUUSD");
    expect(signal.ready).toBe(true);
  });
  it("rejects unreliable candle inputs", () => {
    expect(movementLevels([], 2500, "BUY", true)).toBeNull();
    const c = candles(1); c[5].high = NaN;
    expect(movementLevels(c, 2500, "BUY", true)).toBeNull();
    expect(() => scan15m({ ...chart(1), m15: [] })).toThrow();
  });
  it("places a target before an opposing swing instead of beyond it", () => {
    const c = candles(0);
    c[60] = { ...c[60], high: 2405 };
    const result = movementLevels(c, 2400, "BUY", true);
    expect(result?.takeProfit).toBeLessThan(2405);
  });
});