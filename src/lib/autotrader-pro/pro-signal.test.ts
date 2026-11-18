import { describe, expect, it } from "vitest";
import { chartWithPro, proDecision, withTpSl, averageTarget, type ChartSignal } from "./pro-signal";
import type { ScanResult } from "./engine";
import { homeRobotState } from "./shared-config";

const base = { summary: "Quiet market", early: [], candidates: [], watchlist: [], blockers: [], active: [], inactive: [] } as unknown as ScanResult;
const sig = (stage: "early" | "confirmed", confidence = 70, side = "BUY") => ({ id: `X:trend:${side}:1`, side, stage, entry: 100, stopLoss: 99, takeProfit: 101.5, confidence, strategyName: "Trend", reason: "Pullback" });
const r = (x: object) => ({ ...base, ...x }) as unknown as ScanResult;

describe("home robot uses AutoTrader Pro signals", () => {
  it("waits only when no timeframe has any setup", () => {
    expect(proDecision({ interval: "15m", result: base })).toMatchObject({ side: "WAIT" });
  });
  it("passes a confirmed signal through with its own stop and target", () => {
    expect(proDecision({ interval: "30m", result: r({ best: sig("confirmed") }) })).toMatchObject({ side: "BUY", interval: "30m", stopLoss: 99, takeProfit: 101.5 });
  });
  it("gives the strongest early setup from any timeframe when nothing is confirmed", () => {
    const chosen = { interval: "15m" as const, result: base };
    const other = { interval: "5m" as const, result: r({ early: [sig("early", 40), sig("early", 65, "SELL")] }) };
    expect(proDecision(chosen, [chosen, other])).toMatchObject({ side: "SELL", interval: "5m", confidence: 65 });
  });
  it("lets the 5m direction outvote a stronger 1m setup so phones agree", () => {
    const m1 = { interval: "1m" as const, result: r({ early: [{ ...sig("early", 80, "SELL"), id: "a" }] }) };
    const m5 = { interval: "5m" as const, result: r({ early: [{ ...sig("early", 60, "BUY"), id: "b" }] }) };
    expect(proDecision(m1, [m1, m5])).toMatchObject({ side: "BUY", interval: "5m" });
  });
  it("adds 5 confidence only when 1m, 5m and 15m all lead the same way", () => {
    const f = (iv: "1m" | "5m" | "15m", side: string, id: string) => ({ interval: iv, result: r({ candidates: [{ ...sig("early", 60, side), id }] }) });
    const all = [f("1m", "BUY", "a"), f("5m", "BUY", "b"), f("15m", "BUY", "c")];
    expect(proDecision(all[2], all)).toMatchObject({ side: "BUY", confidence: 65 });
    const mixed = [f("1m", "SELL", "a"), all[1], all[2]];
    expect(proDecision(mixed[2], mixed)).toMatchObject({ side: "BUY", confidence: 60 });
  });
  it("ignores a confirmed 1m signal that fights the 15m direction", () => {
    const m1 = { interval: "1m" as const, result: r({ best: { ...sig("confirmed", 90, "SELL"), id: "c" } }) };
    const m15 = { interval: "15m" as const, result: r({ early: [{ ...sig("early", 50, "BUY"), id: "d" }] }) };
    expect(proDecision(m1, [m1, m15])).toMatchObject({ side: "BUY", interval: "15m" });
  });
});

describe("chartWithPro", () => {
  const chart: ChartSignal = { symbol: "XAUUSD", side: "BUY", entry: 100, stopLoss: 90, takeProfit: 140, confidence: "low", rationale: "chart" };
  const pro = { ok: true as const, side: "SELL" as const, id: "x", interval: "15m" as const, entry: 101, stopLoss: 103, takeProfit: 97, confidence: 72, strategy: "Fast Movement", reason: "r" };
  it("uses Pro's direction and stop/target when Pro has a setup", () => {
    const out = chartWithPro(chart, pro);
    expect([out.side, out.stopLoss, out.takeProfit]).toEqual(["SELL", 103, 97]);
  });
  it("raises confidence by 10 when chart and Pro agree", () => {
    expect(chartWithPro({ ...chart, side: "SELL" }, pro).confidencePct).toBe(82);
  });
  it("keeps the chart reading when Pro has no setup", () => {
    const out = chartWithPro(chart, { ok: true, side: "WAIT", reason: "none" });
    expect([out.side, out.takeProfit]).toEqual(["BUY", 140]);
  });
});

describe("robots follow the admin's AutoTrader Pro setup", () => {
  it("uses the admin's published thresholds and never a phone's own trade history", () => {
    const s = homeRobotState({ engine: { confirmedThreshold: 70 }, perf: { "XAUUSD|1m": { trades: 9 } } });
    expect([s.engine.confirmedThreshold, s.perf]).toEqual([70, {}]);
  });
  it("falls back to the recommended confirmation threshold of 60", () => {
    expect(homeRobotState(null).engine.confirmedThreshold).toBe(60);
  });
});

describe("withTpSl single target quality", () => {
  const base = { ok: true as const, side: "SELL" as const, id: "x", interval: "5m" as const, entry: 1.1, stopLoss: 1.101, takeProfit: 1.0995, confidence: 60, strategy: "s", reason: "r" };
  it("raises a fallback take profit below 1:1 up to 1:1 when no market plan is usable", () => {
    const out = withTpSl(base, undefined);
    if (!out.ok || out.side === "WAIT") throw new Error("expected signal");
    expect(out.stopLoss).toBe(1.101);
    expect(out.takeProfit).toBeCloseTo(1.099, 10);
  });
  it("keeps a fallback take profit inside 1:1 to 1:1.8", () => {
    const out = withTpSl({ ...base, takeProfit: 1.0985 }, undefined);
    if (!out.ok || out.side === "WAIT") throw new Error("expected signal");
    expect(out.takeProfit).toBe(1.0985);
  });
  it("breakout signals keep the breakout stop and ignore the liquidity plan, target inside 1:1–1:1.8", () => {
    const plan = { ok: true, side: "SELL", entry: 1.1, stop: 1.103, risk: 0.003, tp1: { x: 1.0995, label: "a" }, tp2: { x: 1.099, label: "b" }, rr1: 0.17, rr2: 0.33 } as never;
    const wide = withTpSl({ ...base, breakout: true, takeProfit: 1.095 }, plan);
    if (!wide.ok || wide.side === "WAIT") throw new Error("expected signal");
    expect(wide.stopLoss).toBe(1.101);
    expect(wide.takeProfit).toBeCloseTo(1.0982, 10);
    const short = withTpSl({ ...base, breakout: true, takeProfit: 1.0997 }, plan);
    if (!short.ok || short.side === "WAIT") throw new Error("expected signal");
    expect(short.takeProfit).toBeCloseTo(1.0985, 10);
  });
  it("pulls a too-wide fallback take profit in to 1:1.8", () => {
    const out = withTpSl({ ...base, takeProfit: 1.095 }, undefined);
    if (!out.ok || out.side === "WAIT") throw new Error("expected signal");
    expect(out.takeProfit).toBeCloseTo(1.0982, 10);
  });
  it("uses the nearest structure level inside the band, and 1.5R when none fits", () => {
    const plan = (rr1: number, rr2: number) => ({ ok: true, side: "BUY", entry: 100, stop: 99, risk: 1, tp1: { x: 100 + rr1, label: "a" }, tp2: { x: 100 + rr2, label: "b" }, rr1, rr2 }) as never;
    expect(averageTarget(plan(1.3, 2.6)).x).toBeCloseTo(101.3, 10);
    expect(averageTarget(plan(0.8, 1.6)).x).toBeCloseTo(101.6, 10);
    expect(averageTarget(plan(0.8, 2.6)).x).toBeCloseTo(101.5, 10);
  });
});
