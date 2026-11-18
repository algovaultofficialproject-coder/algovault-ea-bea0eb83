import { describe, expect, it } from "vitest";
import { levelPositions, pushHistory, strategyName, tfLabel, HISTORY_MAX } from "./chart-scan-view";

describe("chart scan view", () => {
  it("labels timeframes like M15 / H1", () => {
    expect(tfLabel("AutoTrader Pro 15m")).toBe("M15");
    expect(tfLabel("Recommended 1h · larger setup")).toBe("H1");
    expect(tfLabel("M15")).toBe("M15");
  });
  it("reads the timeframe as printed on the uploaded chart", () => {
    expect(tfLabel("15")).toBe("M15");
    expect(tfLabel("240")).toBe("H4");
    expect(tfLabel("4H")).toBe("H4");
    expect(tfLabel("30 minutes")).toBe("M30");
    expect(tfLabel("1D")).toBe("D1");
    expect(tfLabel("D")).toBe("D1");
  });
  it("prefers the AutoTrader Pro strategy name", () => {
    expect(strategyName({ symbol: "X", side: "SELL", entry: 1, stopLoss: 2, takeProfit: 0.5, confluences: ["AutoTrader Pro · BSL sweep + MSS", "x"], patterns: ["OB"] })).toBe("BSL sweep + MSS");
    expect(strategyName({ symbol: "X", side: "SELL", entry: 1, stopLoss: 2, takeProfit: 0.5, patterns: ["BSL sweep", "MSS", "Bearish OB"] })).toBe("BSL sweep + MSS + Bearish OB");
  });
  it("places a sell's stop above entry and target below", () => {
    const p = levelPositions({ entry: 4035.36, stopLoss: 4040, takeProfit: 4013.01 })!;
    expect(p.sl).toBeLessThan(p.entry);
    expect(p.tp).toBeGreaterThan(p.entry);
    expect(levelPositions({ entry: 0, stopLoss: 1, takeProfit: 2 })).toBeNull();
  });
  it("keeps only the newest 10 scans", () => {
    let list: Parameters<typeof pushHistory>[0] = [];
    for (let i = 0; i < 12; i++) list = pushHistory(list, { at: i, symbol: "X", side: "BUY", entry: 1, stopLoss: 0.9, takeProfit: 1.2, timeframe: "M15" });
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0].at).toBe(11);
  });
});

import { fmtPrice, notChartReply } from "./chart-scan-view";
describe("notChartReply", () => {
  it("is a no-trade only when the AI says the picture is not a chart", () => {
    expect(notChartReply({ isChart: false, reason: "selfie" })).toBe(true);
    expect(notChartReply({ isChart: "false" })).toBe(true);
    expect(notChartReply({ isChart: true, side: "SELL" })).toBe(false);
    expect(notChartReply({ side: "BUY" })).toBe(false);
  });
});
describe("fmtPrice", () => {
  it("rounds long engine prices for display", () => {
    expect(fmtPrice(3892.2193001770243)).toBe("3892.22");
    expect(fmtPrice(155.123456)).toBe("155.123");
    expect(fmtPrice(1.0876543)).toBe("1.08765");
  });
});
