import { describe, expect, it } from "vitest";
import { HEALTH_MIN_TRADES, healthReport, parseTradeHistory, recentSize } from "./strategy-health";

const lines = (rs: number[]) => rs.map((r, i) => `2026-10-${String((i % 28) + 1).padStart(2, "0")}, BUY, ${r}R`).join("\n");
const report = (rs: number[]) => healthReport({ trades: rs.map((result) => ({ result })), unit: "R" });

describe("strategy health", () => {
  it("reads a leading R as rand and a trailing R as an R multiple", () => {
    expect(parseTradeHistory("BUY R-250").trades[0].result).toBe(-250);
    expect(parseTradeHistory("BUY R-250").unit).toBe("money");
    expect(parseTradeHistory("SELL 1.5R").trades[0]).toEqual({ side: "SELL", result: 1.5 });
    expect(parseTradeHistory("SELL 1.5R").unit).toBe("R");
  });

  it("skips lines without a result and sorts dated trades oldest first", () => {
    const p = parseTradeHistory("date, side, result\n2026-11-03, SELL, -1R\n2026-11-01, BUY, 2R");
    expect(p.skipped).toBe(1);
    expect(p.trades.map((t) => t.result)).toEqual([2, -1]);
  });

  it("needs 20 trades before judging", () => {
    expect(HEALTH_MIN_TRADES).toBe(20);
    expect(report(Array(19).fill(1)).status).toBe("insufficient");
  });

  it("compares the last ~30% of trades (10 to 50) with the earlier ones", () => {
    expect(recentSize(20)).toBe(10);
    expect(recentSize(100)).toBe(30);
    expect(recentSize(400)).toBe(50);
  });

  it("calls a steady winning strategy healthy", () => {
    expect(report(Array.from({ length: 40 }, (_, i) => (i % 2 ? 1.5 : -1))).status).toBe("healthy");
  });

  it("calls it degraded when recent trades turn into losses", () => {
    const rs = [...Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? -1 : 1.5)), ...Array.from({ length: 12 }, (_, i) => (i % 4 === 0 ? 1 : -1))];
    const r = report(rs);
    expect(r.status).toBe("degraded");
    expect(r.flags.map((f) => f.id)).toContain("expectancy-negative");
  });

  it("calls it no-edge when it lost money before and still loses", () => {
    expect(report(Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 1 : -1))).status).toBe("no-edge");
  });

  it("parses pasted lines end to end", () => {
    expect(parseTradeHistory(lines([1, -1, 2])).trades).toHaveLength(3);
  });
});
