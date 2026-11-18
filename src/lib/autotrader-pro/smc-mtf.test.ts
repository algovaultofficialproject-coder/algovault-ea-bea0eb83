import { describe, expect, it } from "vitest";
import { buildSeries } from "./indicators";
import { readSmc, structureEvents, type SmcRead } from "./smc";
import { confluence, shouldAlert, type FrameSmc } from "./mtf";
import { performanceBreakdown, sessionOf } from "./account";
import type { JournalRecord } from "@/lib/trade-log";
import type { Candle, Interval } from "./types";

const bar = (t: number, o: number, c: number, h = Math.max(o, c) + 0.2, l = Math.min(o, c) - 0.2): Candle => ({ t, o, h, l, c, v: 1 });

/** Falls in lower highs/lows, then rallies through the last swing high (bearish → bullish). */
function downThenBreak(): Candle[] {
  const out: Candle[] = []; let p = 100, t = 0;
  for (let k = 0; k < 8; k++) {
    for (let j = 0; j < 4; j++) { out.push(bar(t++, p, p - 1, p + 0.05)); p -= 1; }
    for (let j = 0; j < 2; j++) { out.push(bar(t++, p, p + 0.8, p + 1, p - 0.05)); p += 0.8; }
  }
  for (let j = 0; j < 8; j++) { out.push(bar(t++, p, p + 1.5, p + 1.7, p - 0.05)); p += 1.5; }
  return out;
}

describe("SMC structure", () => {
  it("labels the first break against a downtrend as a bullish CHoCH", () => {
    const s = buildSeries(downThenBreak());
    const ev = structureEvents(s, s.candles.length - 1);
    const last = ev[ev.length - 1];
    expect(last.dir).toBe("BUY");
    expect(ev.some((e) => e.dir === "SELL")).toBe(true);
    expect(last.kind).toBe("CHoCH");
  });

  it("never reads bars after the index it is given", () => {
    const c = downThenBreak();
    const s = buildSeries(c), i = c.length - 9;
    const a = readSmc(s, i);
    const b = readSmc(buildSeries(c.slice(0, i + 1).concat(c.slice(i + 1).map((x) => ({ ...x, h: x.h + 50, c: x.c + 50 })))), i);
    expect(a.event).toEqual(b.event);
    expect(a.bias).toBe(b.bias);
  });

  it("detects an unfilled bullish fair value gap", () => {
    const c: Candle[] = [];
    for (let j = 0; j < 30; j++) c.push(bar(j, 100, 100.1, 100.3, 99.8));
    c.push(bar(30, 100, 101, 101.1, 99.9), bar(31, 101, 103, 103.2, 101), bar(32, 103, 103.5, 103.8, 102));
    const r = readSmc(buildSeries(c), c.length - 1);
    expect(r.fvg?.side).toBe("BUY");
    expect(r.fvg?.bottom).toBeCloseTo(101.1);
    expect(r.fvg?.top).toBeCloseTo(102);
  });
});

const read = (p: Partial<SmcRead>): SmcRead => ({ bias: "neutral", freshEvent: false, rangePos: 0.5, zone: "equilibrium", bsl: [], ssl: [], notes: [], ...p });
const frame = (interval: Interval, smc: SmcRead, extra: Partial<FrameSmc> = {}): FrameSmc => ({ interval, smc, price: 100, atr: 1, volatility: "normal", ...extra });
const buyEvent = { kind: "CHoCH" as const, dir: "BUY" as const, level: 99.5, bar: 10 };

function bullishStack(trigger = true): FrameSmc[] {
  return [
    frame("1h", read({ bias: "bullish", bsl: [110, 115] })),
    frame("30m", read({ bias: "bullish" })),
    frame("15m", read({ bias: "bearish", zone: "discount", sweep: { side: "BUY", level: 98, bar: 5, text: "SSL swept" } })),
    frame("5m", read({ bias: "bullish", displacement: { dir: "BUY", bar: 9, bodyAtr: 2 }, bsl: [103, 106] })),
    frame("1m", read(trigger ? { bias: "bullish", event: buyEvent, freshEvent: true, ssl: [99] } : { bias: "bearish", ssl: [99] })),
  ];
}

describe("multi-timeframe confluence", () => {
  it("grades a full top-down bullish stack as a high-confluence BUY with ordered targets", () => {
    const r = confluence(bullishStack(), "balanced", 0);
    expect(r.signal?.side).toBe("BUY");
    expect(r.signal?.tier).toBe("high");
    const s = r.signal!;
    expect(s.stopLoss).toBeLessThan(s.entry);
    expect(s.tp1).toBeGreaterThan(s.entry);
    expect(s.tp2).toBeGreaterThan(s.tp1);
    expect(s.tp3).toBeGreaterThan(s.tp2);
    expect(s.expiresAt).toBe(15 * 60_000);
  });

  it("keeps a 1M pullback against a bullish 1H as an early BUY instead of rejecting it", () => {
    const r = confluence(bullishStack(false), "balanced", 0);
    expect(r.signal?.side).toBe("BUY");
    expect(r.signal?.tier).toBe("early");
  });

  it("never grades a setup during extreme volatility", () => {
    const r = confluence(bullishStack().map((f) => ({ ...f, volatility: "extreme" as const })), "aggressive", 0);
    expect(r.signal).toBeUndefined();
  });

  it("strict mode needs more steps than aggressive mode", () => {
    const frames = bullishStack().map((f) => (f.interval === "30m" || f.interval === "1h" ? { ...f, smc: read({ bias: "neutral", bsl: f.smc.bsl }) } : f));
    expect(confluence(frames, "aggressive", 0).signal?.tier).toBe("high");
    expect(confluence(frames, "strict", 0).signal?.tier).toBe("confirmed");
  });
});

describe("Remaining SMC + learning pieces", () => {
  it("detects an unfilled bullish liquidity void after a fast one-sided run", () => {
    const c: Candle[] = []; let p = 100, t = 0;
    for (let k = 0; k < 30; k++) { const o = p, cl = p + (k % 2 ? 0.3 : -0.3); c.push(bar(t++, o, cl)); p = cl; }
    for (let k = 0; k < 4; k++) { c.push(bar(t++, p, p + 3, p + 3.1, p - 0.1)); p += 3; }
    c.push(bar(t++, p, p + 0.2));
    const r = readSmc(buildSeries(c), c.length - 1);
    expect(r.liquidityVoid?.side).toBe("BUY");
    expect(r.liquidityVoid?.label).toBe("Bullish liquidity void");
  });

  it("alerts per grade: early off, confirmed and high on by default, and respects user switches", () => {
    expect(shouldAlert(undefined, "early")).toBe(false);
    expect(shouldAlert(undefined, "confirmed")).toBe(true);
    expect(shouldAlert(undefined, "high")).toBe(true);
    expect(shouldAlert({ early: true, confirmed: false, high: true }, "confirmed")).toBe(false);
    expect(shouldAlert({ early: true, confirmed: false, high: true }, "early")).toBe(true);
  });

  it("splits closed trade results by symbol, session and volatility", () => {
    const at = (h: number) => Date.UTC(2026, 0, 5, h);
    const rec = (symbol: string, h: number, r: number, vol: string): JournalRecord => ({ id: `${symbol}${h}`, ts: at(h), kind: "trade", mode: "paper", strategy: "x", symbol, side: "BUY", outcome: r > 0 ? "win" : "loss", rMultiple: r, pnl: r * 10, market: `Trend · up trend · ${vol} volatility` } as JournalRecord);
    const j = [rec("XAUUSD", 8, 2, "high"), rec("XAUUSD", 9, -1, "high"), rec("EURUSD", 14, 1, "low")];
    expect(sessionOf(at(3))).toBe("Asia"); expect(sessionOf(at(8))).toBe("London"); expect(sessionOf(at(14))).toBe("New York"); expect(sessionOf(at(22))).toBe("Off-hours");
    const bySym = performanceBreakdown(j, "paper", "symbol");
    expect(bySym.XAUUSD.trades).toBe(2); expect(bySym.XAUUSD.winRate).toBe(0.5); expect(bySym.XAUUSD.profitFactor).toBe(2);
    expect(performanceBreakdown(j, "paper", "session").London.trades).toBe(2);
    expect(performanceBreakdown(j, "paper", "volatility").low.expectancyR).toBe(1);
    expect(performanceBreakdown(j, "live", "symbol")).toEqual({});
  });
});
