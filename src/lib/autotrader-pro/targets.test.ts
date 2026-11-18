import { describe, expect, it } from "vitest";
import { MAX_TP_ATR, planLevels, RISK_PRESETS } from "./risk";
import { STRATEGIES } from "./strategies";
import { TARGET_CAP_ATR, type TargetPlan } from "./targets";
import { aggregateCandles } from "@/lib/market-data.server";

const r = RISK_PRESETS.balanced; // stop min 0.8 ATR, RR target 1.8

describe("AutoTrader Pro turning-point targets", () => {
  it("places the take profit 0.1 ATR in front of the nearest turning point when it pays at least 1.2R", () => {
    // BUY at 100, stop 99 (1R = 1), ATR 1, resistance at 101.6 → TP 101.5 = 1.5R
    const lv = planLevels("BUY", 100, 99, 1, "normal", r, undefined, [103, 101.6]);
    expect(lv.takeProfit).toBeCloseTo(101.5, 10);
    expect(lv.tight).toBeUndefined();
    expect(lv.turnLevel).toBeCloseTo(101.6, 10);
  });

  it("flags the setup as tight when the next turning point is closer than 1.2R", () => {
    const lv = planLevels("SELL", 100, 101, 1, "normal", r, undefined, [99]);
    expect(lv.tight).toBeDefined();
    expect(lv.takeProfit).toBeCloseTo(99.1, 10);
  });

  it("never sets a clear-path target further than 3 ATR from entry", () => {
    const lv = planLevels("BUY", 100, 97.5, 1, "normal", r, undefined, []); // 1.8R would be 4.5 ATR
    expect(lv.takeProfit).toBeCloseTo(100 + MAX_TP_ATR, 10);
    expect(MAX_TP_ATR).toBe(4);
  });

  it("letters the 210-strategy book A1…U10", () => {
    expect(STRATEGIES[0].letter).toBe("A1");
    expect(STRATEGIES[89].letter).toBe("I10");
    expect(STRATEGIES[119].letter).toBe("L10");
    expect(STRATEGIES[149].letter).toBe("O10");
    expect(STRATEGIES[189].letter).toBe("S10");
    expect(STRATEGIES[209].letter).toBe("U10");
  });

  it("keeps each market method's target within its ATR cap and tightens a wide stop to fit", () => {
    // Ranging cap 2.5 ATR: a 3 ATR structural stop is tightened to 2.08 ATR so 1.2R still fits.
    const plan: TargetPlan = { method: "range_mean", label: "Range middle", capAtr: TARGET_CAP_ATR.range_mean, rr: 1.4 };
    const lv = planLevels("BUY", 100, 97, 1, "normal", r, undefined, [], plan);
    expect(lv.slDist).toBeCloseTo(2.5 / 1.2, 10);
    expect(lv.takeProfit).toBeCloseTo(102.5, 10);
    expect(TARGET_CAP_ATR.compression_atr).toBe(2.2);
  });

  it("uses the market target (e.g. measured move) when it is closer than the RR target", () => {
    const plan: TargetPlan = { method: "measured_move", label: "Measured move", capAtr: 2.5, rr: 1.6, target: 98.4 };
    const lv = planLevels("SELL", 100, 101, 1, "normal", r, undefined, [], plan); // 1R = 1, target 1.6 away
    expect(lv.takeProfit).toBeCloseTo(98.5, 10); // 0.1 ATR in front of the measured target
  });

  it("does not stretch the target out to a far turning point", () => {
    const lv = planLevels("BUY", 100, 99, 1, "normal", r, undefined, [102.2]); // 1.2 ATR min stop → RR target 2.16, pulled in front of the turn at 2.2
    expect(lv.takeProfit).toBeCloseTo(102.1, 10);
  });

  it("builds 30m candles from pairs of 15m candles", () => {
    const m = 900_000;
    const c = aggregateCandles([
      { t: 0, o: 1, h: 3, l: 0.5, c: 2, v: 1 }, { t: m, o: 2, h: 4, l: 1, c: 3.5, v: 2 }, { t: 2 * m, o: 3.5, h: 3.6, l: 3, c: 3.2, v: 1 },
    ], 1_800_000);
    expect(c).toEqual([{ t: 0, o: 1, h: 4, l: 0.5, c: 3.5, v: 3 }, { t: 1_800_000, o: 3.5, h: 3.6, l: 3, c: 3.2, v: 1 }]);
  });
});
