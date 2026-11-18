import { describe, expect, it } from "vitest";
import { liveEntryGate, type GateInput } from "./live-gate";

const ok: GateInput = { side: "BUY", confirmed: true, confidence: 70, entry: 100, stopLoss: 99, trendSides: ["BUY"], atr15: 1, spread: 0.1 };

describe("live entry gate", () => {
  it("passes a confirmed, trend-agreeing, well-placed entry", () => expect(liveEntryGate(ok).pass).toBe(true));
  it("blocks an early setup with only one agreeing 15m–1h setup", () => expect(liveEntryGate({ ...ok, confirmed: false }).pass).toBe(false));
  it("passes an early setup at 62% when two 15m–1h setups agree", () => expect(liveEntryGate({ ...ok, confirmed: false, confidence: 62, trendSides: ["BUY", "BUY"] }).pass).toBe(true));
  it("blocks an early setup below 62%", () => expect(liveEntryGate({ ...ok, confirmed: false, confidence: 61, trendSides: ["BUY", "BUY"] }).pass).toBe(false));
  it("trend trades need the 15m trend with them; 1h and 5m only block when opposite", () => {
    expect(liveEntryGate({ ...ok, bias: { m15: 0, h1: 1 } }).pass).toBe(false);
    expect(liveEntryGate({ ...ok, bias: { m15: 1, h1: -1 } }).pass).toBe(false);
    expect(liveEntryGate({ ...ok, bias: { m5: -1, m15: 1 } }).pass).toBe(false);
    expect(liveEntryGate({ ...ok, bias: { m5: 0, m15: 1, h1: 0 } }).pass).toBe(true);
  });
  it("range trades pass without a trend but never against a 15m or 1h trend", () => {
    expect(liveEntryGate({ ...ok, mode: "range", bias: { m15: 0, h1: 0 } }).pass).toBe(true);
    expect(liveEntryGate({ ...ok, mode: "range", bias: { m15: -1, h1: 0 } }).pass).toBe(false);
    expect(liveEntryGate({ ...ok, mode: "range", bias: { m15: 0, h1: -1 } }).pass).toBe(false);
  });
  it("transition trades (breakouts, retests, turns) are only blocked when 15m and 1h both point against them", () => {
    expect(liveEntryGate({ ...ok, mode: "transition", bias: { m15: -1, h1: 0 } }).pass).toBe(true);
    expect(liveEntryGate({ ...ok, mode: "transition", bias: { m15: 0, h1: -1 } }).pass).toBe(true);
    expect(liveEntryGate({ ...ok, mode: "transition", bias: { m15: -1, h1: -1 } }).pass).toBe(false);
  });
  it("blocks when no 15m–1h setup agrees", () => expect(liveEntryGate({ ...ok, trendSides: [] }).pass).toBe(false));
  it("blocks when 15m–1h setups are split evenly", () => expect(liveEntryGate({ ...ok, trendSides: ["BUY", "SELL"] }).pass).toBe(false));
  it("blocks confidence below 60%", () => expect(liveEntryGate({ ...ok, confidence: 59 }).pass).toBe(false));
  it("blocks a stop tighter than half the 15m ATR", () => expect(liveEntryGate({ ...ok, stopLoss: 99.6 }).pass).toBe(false));
  it("blocks a stop closer than 4 spreads", () => expect(liveEntryGate({ ...ok, spread: 0.3 }).pass).toBe(false));
});
