import { describe, expect, it } from "vitest";
import { growthPlan, sizeSmallAccount, tierFor } from "./small-account";
import { momentumQuality, type MomentumRead } from "./momentum";

const read = (interval: "1m" | "5m" | "15m", dir: -1 | 0 | 1, shift?: MomentumRead["shift"]): MomentumRead => ({ interval, dir, strength: 60, phase: "strong", shift, text: "" });

describe("small account growth", () => {
  it("puts R200 in the Seed tier taking only A+ signals", () => {
    expect(tierFor(200, "ZAR").name).toBe("Seed");
    expect(tierFor(200, "ZAR").minGrade).toBe("A+");
    expect(growthPlan(200, "ZAR").next?.name).toBe("Sprout");
  });
  it("skips a signal below the tier grade", () => {
    const r = sizeSmallAccount({ symbol: "EURUSD", entry: 1.1, stop: 1.099, balance: 200, currency: "ZAR", cent: true, pairLot: 0.1, pairTrades: 3, grade: "B" });
    expect(r.ok).toBe(false);
  });
  it("skips when 0.01 lot risks far more than the tier allows", () => {
    // 0.01 lot gold, $5 stop = $5 loss on ~$10.8 balance
    const r = sizeSmallAccount({ symbol: "XAUUSD", entry: 2000, stop: 1995, balance: 200, currency: "ZAR", cent: false, pairLot: 0.1, pairTrades: 1, grade: "A+" });
    expect(r.ok).toBe(false);
  });
  it("sizes a cent account R200 to one trade, never above the pair lot", () => {
    const r = sizeSmallAccount({ symbol: "XAUUSD", entry: 2000, stop: 1995, balance: 200, currency: "ZAR", cent: true, pairLot: 0.05, pairTrades: 3, grade: "A+" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.trades).toBe(1); expect(r.lot).toBeLessThanOrEqual(0.05); expect(r.riskPct).toBeLessThanOrEqual(10); }
  });
});

describe("momentum quality", () => {
  it("A+ when 5m and 15m push with the signal and nothing turns against it", () => {
    expect(momentumQuality("BUY", [read("1m", 1), read("5m", 1), read("15m", 1)]).grade).toBe("A+");
  });
  it("C when both lead frames push the other way", () => {
    expect(momentumQuality("BUY", [read("5m", -1), read("15m", -1)]).grade).toBe("C");
  });
  it("downgrades when a momentum shift against the trade is likely", () => {
    const g = momentumQuality("BUY", [read("5m", 1), read("15m", 1, { toward: "SELL", probability: 70, evidence: [] })]).grade;
    expect(g).toBe("B");
  });
});
