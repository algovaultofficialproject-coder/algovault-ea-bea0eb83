import { describe, expect, it } from "vitest";
import { biasSignal, biasSide, type BiasFrame } from "./bias-signal";

const f = (interval: BiasFrame["interval"], bias: BiasFrame["bias"], up: boolean, lastUp = true): BiasFrame =>
  ({ interval, bias, price: 100, ema21: up ? 99 : 101, ema50: up ? 98 : 102, atr: 1, lastUp });

describe("bias signal (never WAIT)", () => {
  it("bullish 15m–1h gives BUY", () => expect(biasSide([f("15m", "bullish", true), f("1h", "bullish", true)]).side).toBe("BUY"));
  it("bearish 15m–1h beats bullish 1m and gives SELL", () => expect(biasSide([f("1m", "bullish", true), f("15m", "bearish", false), f("1h", "bearish", false)]).side).toBe("SELL"));
  it("stop is at least one 15m ATR and target beyond the stop distance", () => {
    const s = biasSignal([f("15m", "bearish", false)], "no setup", () => ({ ok: true, stop: 100.2, tp2: { x: 99.9 } }))!;
    expect(s.side).toBe("SELL");
    expect(s.stopLoss).toBe(101);
    expect(s.takeProfit).toBeLessThanOrEqual(98.5);
  });
  it("returns BUY or SELL, never WAIT, on a flat market", () => {
    const flat: BiasFrame = { interval: "1m", bias: "neutral", price: 100, ema21: NaN, ema50: NaN, atr: 1, lastUp: false };
    expect(biasSignal([flat], "none")!.side).toBe("SELL");
  });
});
