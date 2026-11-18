import { describe, expect, it } from "vitest";
import { isWithinExecutionTime, normalizeEaManipulation, sameCandle, STRATEGIES, strategyAllows } from "./ea-manipulation";

describe("EA manipulation", () => {
  it("maps each strategy to a robot trade style", () => {
    expect(STRATEGIES.scalping.style).toBe("scalp");
    expect(STRATEGIES.day.style).toBe("normal");
    expect(STRATEGIES.swing.style).toBe("swing");
    expect(STRATEGIES.auto.style).toBe("auto");
  });

  it("uses Auto (market decides) when nothing was saved", () => {
    expect(normalizeEaManipulation(null).strategy).toBe("auto");
  });

  it("Sniper only takes setups of 80% confidence or more", () => {
    expect(strategyAllows("sniper", "BUY", 79).ok).toBe(false);
    expect(strategyAllows("sniper", "BUY", 80).ok).toBe(true);
  });

  it("Trend Flow never trades against the main trend", () => {
    expect(strategyAllows("trendflow", "SELL", 90, "BUY").ok).toBe(false);
    expect(strategyAllows("trendflow", "BUY", 60, "BUY").ok).toBe(true);
  });

  it("only trades from the chosen execution hour", () => {
    expect(isWithinExecutionTime(9, new Date(2026, 0, 5, 8, 59))).toBe(false);
    expect(isWithinExecutionTime(9, new Date(2026, 0, 5, 9, 0))).toBe(true);
    expect(isWithinExecutionTime(null, new Date(2026, 0, 5, 3, 0))).toBe(true);
  });

  it("allows one trade per symbol per chosen candle", () => {
    const at = Date.UTC(2026, 0, 5, 10, 1);
    expect(sameCandle(at, Date.UTC(2026, 0, 5, 10, 14), "M15")).toBe(true);
    expect(sameCandle(at, Date.UTC(2026, 0, 5, 10, 15), "M15")).toBe(false);
  });

  it("keeps the old trade style when no EA settings were saved", () => {
    expect(normalizeEaManipulation(null, "swing").strategy).toBe("swing");
    expect(normalizeEaManipulation({ execHour: 3 }).execHour).toBeNull();
  });
});
