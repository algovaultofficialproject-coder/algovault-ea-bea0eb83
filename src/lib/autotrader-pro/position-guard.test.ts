import { describe, expect, it } from "vitest";
import { isAppTrade, profitTier, reversalExit, tradeSide, type FrameRead } from "./position-guard";
import type { Interval } from "./types";

const read = (interval: Interval, o: Partial<FrameRead> = {}): FrameRead => ({
  interval, direction: "neutral", regime: "ranging", earlyTransition: undefined,
  exhaustion: { trend: 0, evidence: [] }, ...o,
});
const buy = { ticket: "1", symbol: "XAUUSD", type: "Buy", comment: "AlgoVault Pro", profit: 4.2 };
const bearish = (iv: Interval) => read(iv, { direction: "bearish", regime: "weak_bear" });
const confirmedTop = (iv: Interval) => read(iv, { exhaustion: { stage: "confirmed", trend: 1, evidence: ["CHoCH"] } });

describe("position guard", () => {
  it("never closes a trade that is in loss, even on a confirmed reversal", () => {
    expect(reversalExit({ ...buy, profit: -1 }, [confirmedTop("5m"), bearish("15m")]).close).toBe(false);
    expect(reversalExit({ ...buy, profit: 0 }, [confirmedTop("5m")]).close).toBe(false);
  });
  it("closes a profitable BUY on a confirmed 5m reversal", () => {
    expect(reversalExit(buy, [read("1m"), confirmedTop("5m"), read("15m")]).close).toBe(true);
  });
  it("does not close on 1m alone", () => {
    expect(reversalExit(buy, [confirmedTop("1m"), read("5m"), read("15m")]).close).toBe(false);
    expect(reversalExit(buy, [bearish("1m"), read("5m"), read("15m")]).close).toBe(false);
  });
  it("closes when two frames including 5m/15m turn against the trade", () => {
    expect(reversalExit(buy, [bearish("1m"), bearish("5m"), read("15m")]).close).toBe(true);
  });
  it("keeps a trade when the direction agrees with it", () => {
    const sell = { ...buy, type: "Sell" };
    expect(reversalExit(sell, [bearish("1m"), bearish("5m"), bearish("15m")]).close).toBe(false);
  });
  it("only touches AlgoVault trades and clear buy/sell positions", () => {
    expect(isAppTrade("EA~AlgoVault")).toBe(true);
    expect(isAppTrade("manual")).toBe(false);
    expect(tradeSide("Sell")).toBe("SELL");
    expect(tradeSide("BuyLimit")).toBe(null);
  });
});

describe("profit-size aware exits", () => {
  const base = { ticket: "9", symbol: "XAUUSD", type: "Buy", profit: 10, comment: "AlgoVault", openPrice: 2000, sl: 1990 };
  const tierOf = (price: number) => profitTier({ ...base, price });
  it("measures profit against the trade's own stop distance", () => {
    expect(tierOf(2003)).toBe("small");   // 0.3R
    expect(tierOf(2010)).toBe("normal");  // 1R
    expect(tierOf(2020)).toBe("big");     // 2R
    expect(profitTier({ ...base, sl: 0, price: 2020 })).toBe("normal");
  });
  it("small profit closes only on a confirmed 5m/15m reversal", () => {
    expect(reversalExit({ ...base, price: 2003 }, [bearish("1m"), bearish("5m")]).close).toBe(false);
    expect(reversalExit({ ...base, price: 2003 }, [confirmedTop("5m")]).close).toBe(true);
  });
  it("normal profit closes on two frames turning, one of them 5m/15m", () => {
    expect(reversalExit({ ...base, price: 2010 }, [bearish("5m")]).close).toBe(false);
    expect(reversalExit({ ...base, price: 2010 }, [bearish("1m"), bearish("5m")]).close).toBe(true);
  });
  it("big profit is protected as soon as 5m or 15m turns against it", () => {
    expect(reversalExit({ ...base, price: 2020 }, [bearish("15m")]).close).toBe(true);
    expect(reversalExit({ ...base, price: 2020 }, [bearish("1m")]).close).toBe(false);
  });
});

describe("candle-confirmed exits", () => {
  const withCandles = (iv: Interval, dir: 1 | -1, strength: 1 | 2) => read(iv, { candles: { dir, strength, text: "Bearish engulfing closed below EMA 9" } });
  const buyTrade = { ticket: "9", symbol: "XAUUSD", type: "Buy", comment: "AlgoVault Pro", profit: 3 };
  it("closes a profitable BUY when 5m candles confirm sellers took over", () => {
    const d = reversalExit(buyTrade, [read("1m"), withCandles("5m", -1, 2), read("15m")]);
    expect(d.close).toBe(true);
    expect(d.reason).toContain("candles confirm");
  });
  it("does not close on a 1m candle turn alone, or when candles agree with the trade", () => {
    expect(reversalExit(buyTrade, [withCandles("1m", -1, 2), read("5m"), read("15m")]).close).toBe(false);
    expect(reversalExit(buyTrade, [read("1m"), withCandles("5m", 1, 2), read("15m")]).close).toBe(false);
  });
  it("never closes a losing trade on candles", () => {
    expect(reversalExit({ ...buyTrade, profit: -2 }, [withCandles("5m", -1, 2), withCandles("15m", -1, 2)]).close).toBe(false);
  });
});

describe("candleTurn", () => {
  it("reads a strong candle breaking the last swing low after a rise as a confirmed seller turn", async () => {
    const { buildSeries } = await import("./indicators");
    const { candleTurn } = await import("./position-guard");
    const c = Array.from({ length: 60 }, (_, k) => ({ t: k * 60_000, o: 100 + k * 0.2, c: 100.2 + k * 0.2, h: 100.35 + k * 0.2, l: 99.9 + k * 0.2, v: 0 }));
    const last = c[59].c;
    c.push({ t: 60 * 60_000, o: last, c: last - 2.5, h: last + 0.05, l: last - 2.6, v: 0 });
    const t = candleTurn(buildSeries(c), 60);
    expect(t.dir).toBe(-1);
    expect(t.strength).toBe(2);
  });
});
