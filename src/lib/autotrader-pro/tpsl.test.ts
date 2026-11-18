import { describe, expect, it } from "vitest";
import { DEFAULT_TPSL, manageTpTrade, marketClass, openTpTrade, planTpSl, positionPlan, type TpTrade } from "./tpsl";
import { withTpSl } from "./pro-signal";
import type { FrameSmc } from "./mtf";
import type { SmcRead } from "./smc";
import { RISK_PRESETS } from "./risk";

const smc = (o: Partial<SmcRead> = {}): SmcRead => ({ bias: "bullish", freshEvent: false, rangePos: 0.3, zone: "discount", bsl: [], ssl: [], notes: [], ...o });
const fr = (interval: FrameSmc["interval"], o: Partial<SmcRead> = {}, vol: FrameSmc["volatility"] = "normal"): FrameSmc => ({ interval, smc: smc(o), price: 100, atr: 1, volatility: vol });

describe("TP/SL engine", () => {
  it("BUY stop sits below the swing low plus buffer, never tighter than the volatility ATR multiple", () => {
    const p = planTpSl("BUY", [fr("1m", { ssl: [98] }), fr("5m", { ssl: [98] })]);
    expect(p.stop).toBeLessThan(98);
    expect(100 - p.stop).toBeGreaterThanOrEqual(1.5 - 1e-9);
    const hi = planTpSl("BUY", [fr("1m", { ssl: [99.5] }), fr("5m", { ssl: [99.5] }, "high")]);
    expect(100 - hi.stop).toBeCloseTo(2, 6); // high volatility = 2.0 × ATR
  });
  it("SELL stop sits above the swing high and avoids resting on equal highs", () => {
    const p = planTpSl("SELL", [fr("1m", { bias: "bearish", bsl: [102.6] }), fr("5m", { bias: "bearish", bsl: [102.6], equalHighs: 102.7 })]);
    expect(p.stop).toBeGreaterThan(102.7);
  });
  it("targets are liquidity-based, ordered, and TP2 does not pass major 1H structure", () => {
    const f = [fr("1m"), fr("5m", { ssl: [98.5], bsl: [101.8, 103.4] }), fr("15m", { bsl: [104.2] }), fr("1h", { bsl: [106] })];
    const p = planTpSl("BUY", f);
    expect(p.tp1.x).toBeLessThan(p.tp2.x);
    expect(p.tp2.x).toBeLessThan(p.tp3.x);
    expect(p.tp2.x).toBeLessThan(106);
    expect(p.tp1.label).toMatch(/liquidity/);
  });
  it("poor reward fails the 2R filter and suggests a better entry", () => {
    const p = planTpSl("BUY", [fr("1m"), fr("5m", { ssl: [98.4], bsl: [101.6] }), fr("1h", { bsl: [102] })]);
    expect(p.rrOk).toBe(false);
    expect(p.rr2).toBeLessThan(2);
    expect(p.tp2.x).toBeLessThanOrEqual(102);
    expect(p.betterEntry).toBeLessThan(100);
  });
  it("rejects when the stop would exceed the max ATR limit, and in extreme volatility when configured", () => {
    expect(planTpSl("BUY", [fr("1m"), fr("5m", { ssl: [94] })], { ...DEFAULT_TPSL, maxStopAtr: 3 }).ok).toBe(false); // swing low at 94 needs >6×ATR
    expect(planTpSl("BUY", [fr("1m"), fr("5m", {}, "extreme")], { ...DEFAULT_TPSL, rejectExtreme: true }).ok).toBe(false);
  });
  it("manages partials, break-even after TP1, and never widens the stop", () => {
    let t: TpTrade = openTpTrade({ side: "BUY", entry: 100, stop: 98, tp1: { x: 102, label: "", htf: false }, tp2: { x: 104, label: "", htf: false }, tp3: { x: 106, label: "", htf: false }, trail: "atr" });
    t = manageTpTrade(t, { t: 1, o: 100, h: 102.2, l: 99.5, c: 102, v: 0 }, 1, DEFAULT_TPSL);
    expect(t.hit).toBe(1);
    expect(t.remaining).toBeCloseTo(0.6);
    expect(t.stop).toBeGreaterThanOrEqual(100);
    const before = t.stop;
    t = manageTpTrade(t, { t: 2, o: 102, h: 102.1, l: 101, c: 101.2, v: 0 }, 3, DEFAULT_TPSL);
    expect(t.stop).toBeGreaterThanOrEqual(before);
    t = manageTpTrade(t, { t: 3, o: 101, h: 101, l: 99, c: 99.5, v: 0 }, 1, DEFAULT_TPSL);
    expect(t.closed?.reason).toMatch(/stop/i);
    expect(t.realized).toBeGreaterThan(0);
  });
  it("stop-first when one bar touches both stop and TP1", () => {
    const t = manageTpTrade(openTpTrade({ side: "SELL", entry: 100, stop: 102, tp1: { x: 98, label: "", htf: false }, tp2: { x: 96, label: "", htf: false }, tp3: { x: 94, label: "", htf: false }, trail: "atr" }), { t: 1, o: 100, h: 102.5, l: 97, c: 99, v: 0 }, 1, DEFAULT_TPSL);
    expect(t.closed?.reason).toBe("Stop loss hit");
  });
  it("position plan risks the configured percentage and classifies markets", () => {
    const pos = positionPlan("BTCUSD", { entry: 100, stop: 98, tp1: { x: 102, label: "", htf: false }, tp2: { x: 104, label: "", htf: false }, tp3: { x: 106, label: "", htf: false } }, { ...RISK_PRESETS.balanced, accountSize: 10000, riskPerTradePct: 1, maxLot: 1000 });
    expect(pos.lossAtSl).toBeLessThanOrEqual(100 + 1e-9);
    expect(marketClass("XAUUSD")).toBe("xau"); expect(marketClass("US30")).toBe("indices"); expect(marketClass("EURUSD")).toBe("forex"); expect(marketClass("ETHUSD")).toBe("crypto");
  });
  it("trading-app robot signal takes the engine stop and one average structure target", () => {
    const plan = planTpSl("BUY", [fr("1m"), fr("5m", { ssl: [98.5], bsl: [101.8, 103.4] }), fr("1h", { bsl: [106] })]);
    const out = withTpSl({ ok: true, side: "BUY", id: "x", interval: "5m", entry: 100, stopLoss: 99, takeProfit: 101, confidence: 70, strategy: "s", reason: "r" }, plan);
    expect(out.ok && out.side === "BUY" && out.stopLoss).toBe(plan.stop);
    if (!out.ok || out.side !== "BUY") throw new Error("expected BUY");
    const rr = (out.takeProfit - out.entry) / (out.entry - out.stopLoss);
    expect(rr).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(rr).toBeLessThanOrEqual(1.8 + 1e-6);
  });
});
