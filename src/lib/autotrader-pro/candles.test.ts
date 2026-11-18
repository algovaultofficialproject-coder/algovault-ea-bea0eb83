import { describe, expect, it } from "vitest";
import { buildSeries } from "./indicators";
import { candleCheck, readCandles } from "./candles";
import type { Candle, MarketRead } from "./types";

const quiet = (): Candle[] => Array.from({ length: 60 }, (_, k) => {
  const o = 100 + (k % 2 ? 0.2 : -0.2), c = 100 + (k % 2 ? -0.2 : 0.2);
  return { t: k * 60_000, o, h: 100.5, l: 99.5, c, v: 0 };
});
const at = (cs: Candle[], o: number, h: number, l: number, c: number) => cs.push({ t: cs.length * 60_000, o, h, l, c, v: 0 });

describe("AutoTrader Pro candle reading", () => {
  it("spots a bullish engulfing candle and confirms a BUY with it", () => {
    const cs = quiet();
    at(cs, 100.3, 100.4, 99.6, 99.7); // red
    at(cs, 99.6, 100.6, 99.55, 100.5); // engulfs it
    const read = readCandles(buildSeries(cs), cs.length - 1);
    expect(read.patterns.some((p) => p.name === "Bullish engulfing")).toBe(true);
    expect(candleCheck(read, 1).confirm).toContain("Bullish engulfing");
  });

  it("holds back a BUY when candles show selling pressure (bearish engulfing)", () => {
    const cs = quiet();
    at(cs, 99.7, 100.4, 99.6, 100.3);
    at(cs, 100.4, 100.45, 99.4, 99.5);
    const read = readCandles(buildSeries(cs), cs.length - 1);
    expect(candleCheck(read, 1).missing).toContain("selling pressure");
  });

});
