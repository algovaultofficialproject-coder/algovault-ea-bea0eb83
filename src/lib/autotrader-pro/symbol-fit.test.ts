import { describe, expect, it } from "vitest";
import { fitsSymbol, marketClass } from "./symbol-fit";
import { capLoss } from "./loss-cap";

describe("symbol strategy fit", () => {
  it("gold stands aside from micro-range scalps and early setups", () => {
    expect(marketClass("XAUUSD")).toBe("gold");
    expect(fitsSymbol("XAUUSD", { strategy: "mr3", stage: "confirmed" })).toBe(false);
    expect(fitsSymbol("XAUUSD", { strategy: "pb2", stage: "early" })).toBe(false);
    expect(fitsSymbol("XAUUSD", { strategy: "ls1", stage: "confirmed" })).toBe(true);
  });
  it("forex majors keep every family", () => {
    expect(fitsSymbol("EURUSD", { strategy: "mr3", stage: "early" })).toBe(true);
  });
});

describe("R100 loss limit", () => {
  it("cuts trades and lot so a stop-out loses at most R100", () => {
    // EURUSD 0.01 lot, 20 pip stop = $2 ≈ R37 → only 2 units fit under R100
    const r = capLoss({ symbol: "EURUSD", entry: 1.1, stop: 1.098, lot: 0.05, trades: 3, maxLoss: 100, currency: "ZAR", cent: false });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.trades * r.lot * 100).toBeLessThanOrEqual(2); expect(r.lossAmount).toBeLessThanOrEqual(100); }
  });
  it("skips when one 0.01 lot would lose more than R100", () => {
    // Gold 0.01 lot, $10 stop = $10 ≈ R185
    expect(capLoss({ symbol: "XAUUSD", entry: 2000, stop: 1990, lot: 0.01, trades: 1, maxLoss: 100, currency: "ZAR", cent: false }).ok).toBe(false);
  });
  it("keeps the pair size when it already fits", () => {
    const r = capLoss({ symbol: "EURUSD", entry: 1.1, stop: 1.099, lot: 0.01, trades: 1, maxLoss: 100, currency: "ZAR", cent: false });
    expect(r.ok && r.lot === 0.01 && r.trades === 1).toBe(true);
  });
});
