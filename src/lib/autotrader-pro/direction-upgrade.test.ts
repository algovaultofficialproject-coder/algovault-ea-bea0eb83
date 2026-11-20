import { describe, expect, it } from "vitest";
import { capLoss } from "./loss-cap";
import { libraryStatus, STRATEGY_LIBRARY } from "./strategy-library";
import { withMomentum } from "./pro-signal";
import type { MomentumRead } from "./momentum";

const r = (interval: "1m" | "5m" | "15m", dir: -1 | 0 | 1, extra: Partial<MomentumRead> = {}): MomentumRead => ({ interval, dir, strength: 60, phase: "strong", text: "", ...extra });

describe("no WAIT on grade C", () => {
  it("a C-grade BUY still trades with lower confidence", () => {
    const sig = { ok: true as const, side: "BUY" as const, id: "x", interval: "5m" as const, entry: 100, stopLoss: 99, takeProfit: 101.5, confidence: 60, strategy: "t", reason: "r" };
    const out = withMomentum(sig, [r("1m", -1), r("5m", -1), r("15m", 1, { phase: "fading" })]);
    expect(out).toMatchObject({ side: "BUY", grade: "C" });
    if (out.ok && out.side !== "WAIT") expect(out.confidence).toBeLessThan(60);
  });
});

describe("R120 planned-loss ceiling", () => {
  const base = { symbol: "EURUSD", entry: 1.1, stop: 1.099, lot: 1, trades: 1, currency: "ZAR" as const, cent: false };
  it("a typed R500 limit is cut to R120 minus the 10% cost buffer", () => {
    const c = capLoss({ ...base, maxLoss: 500 });
    expect(c.ok && c.lossAmount).toBeLessThanOrEqual(108);
  });
  it("the ceiling still applies when no limit is typed", () => {
    const c = capLoss({ ...base, maxLoss: 0 });
    expect(c.ok && c.lossAmount).toBeLessThanOrEqual(108);
  });
});

describe("strategy library", () => {
  it("holds 900+ unique configurations", () => {
    expect(STRATEGY_LIBRARY.length).toBeGreaterThanOrEqual(900);
    expect(new Set(STRATEGY_LIBRARY.map((e) => e.id)).size).toBe(STRATEGY_LIBRARY.length);
  });
  it("is untested without real results, never invented", () => {
    expect(libraryStatus(undefined)).toBe("untested");
    expect(libraryStatus({ trades: 60, winRate: 0.4, expectancyR: -0.1, profitFactor: 0.8, underperforming: false })).toBe("underperforming");
  });
});

describe("scanProSignal never answers WAIT when prices are available", () => {
  it("returns BUY or SELL with a stop and target on a quiet market", async () => {
    const { scanProSignal } = await import("./pro-signal");
    const now = Date.UTC(2026, 10, 20, 10, 0);
    const ms: Record<string, number> = { "1m": 60e3, "5m": 300e3, "15m": 900e3 };
    const candlesFn = async ({ data }: { data: { interval: string; limit: number } }) => {
      const step = ms[data.interval] ?? 60e3;
      const candles = Array.from({ length: 600 }, (_, k) => {
        const t = now - (600 - k) * step, base = 1.1 + Math.sin(k / 9) * 0.0004 + k * 0.000002;
        return { t, o: base, h: base + 0.0003, l: base - 0.0003, c: base + (k % 2 ? 0.0001 : -0.0001), v: 0 };
      });
      return { ok: true as const, candles };
    };
    const out = await scanProSignal("EURUSD", candlesFn as never, now);
    expect(out.ok && out.side).not.toBe("WAIT");
    if (out.ok && out.side !== "WAIT") {
      expect(out.side === "BUY" ? out.stopLoss < out.entry && out.takeProfit > out.entry : out.stopLoss > out.entry && out.takeProfit < out.entry).toBe(true);
      expect(out.reason).toContain("Scores BUY");
    }
  });
});
