import { describe, expect, it } from "vitest";
import { buildTargets, cancelReasons, chooseOrderType, entryBuffer, lotSize, mayAutoSubmit, paperFill, roundToTick, scoreSetup, specFor, validateOrder, type Thesis } from "./order-planner";
import { hasActive } from "./order-book";

const xau = specFor("XAUUSD");
const eur = specFor("EURUSD");
const q = { bid: 2649.9, ask: 2650.1, at: 0 };
const now = 1_000;
const base = (p: Partial<Thesis>): Thesis => ({ side: "BUY", kind: "trigger", level: 2650, zone: [2649, 2651], confirmed: true, invalidation: 2640, expiresAt: now + 60_000, ...p });

describe("order type selection", () => {
  it("BUY MARKET fills on the ask inside the zone", () => {
    const c = chooseOrderType(base({}), q, "XAUUSD", xau, 5, now);
    expect(c.decision).toBe("BUY_MARKET"); expect(c.entry).toBe(2650.1);
  });
  it("SELL MARKET fills on the bid inside the zone", () => {
    const c = chooseOrderType(base({ side: "SELL", invalidation: 2660 }), q, "XAUUSD", xau, 5, now);
    expect(c.decision).toBe("SELL_MARKET"); expect(c.entry).toBe(2649.9);
  });
  it("BUY STOP sits above resistance + buffer and above the ask", () => {
    const c = chooseOrderType(base({ kind: "breakout", level: 2655 }), q, "XAUUSD", xau, 5, now);
    expect(c.decision).toBe("BUY_STOP"); expect(c.entry).toBe(2655.4); expect(c.entry!).toBeGreaterThan(q.ask);
  });
  it("SELL STOP sits below support - buffer and below the bid", () => {
    const c = chooseOrderType(base({ side: "SELL", kind: "breakout", level: 2645, invalidation: 2660 }), q, "XAUUSD", xau, 5, now);
    expect(c.decision).toBe("SELL_STOP"); expect(c.entry).toBe(2644.6); expect(c.entry!).toBeLessThan(q.bid);
  });
  it("BUY LIMIT is below the ask at the demand-zone top", () => {
    const c = chooseOrderType(base({ kind: "pullback", zone: [2640.5, 2644] , invalidation: 2638 }), q, "XAUUSD", xau, 5, now);
    expect(c.decision).toBe("BUY_LIMIT"); expect(c.entry).toBe(2644); expect(c.entry!).toBeLessThan(q.ask);
  });
  it("SELL LIMIT is above the bid at the supply-zone bottom", () => {
    const c = chooseOrderType(base({ side: "SELL", kind: "pullback", zone: [2656, 2660], invalidation: 2662 }), q, "XAUUSD", xau, 5, now);
    expect(c.decision).toBe("SELL_LIMIT"); expect(c.entry).toBe(2656); expect(c.entry!).toBeGreaterThan(q.bid);
  });
  it("waits when confirmation is missing and rejects when expired or invalidated", () => {
    expect(chooseOrderType(base({ confirmed: false }), q, "XAUUSD", xau, 5, now).decision).toBe("WAIT");
    expect(chooseOrderType(base({ expiresAt: now - 1 }), q, "XAUUSD", xau, 5, now).decision).toBe("REJECT");
    expect(chooseOrderType(base({ invalidation: 2650 }), q, "XAUUSD", xau, 5, now).decision).toBe("REJECT");
  });
  it("does not chase a breakout that already ran", () => {
    expect(chooseOrderType(base({ kind: "breakout", level: 2640 }), q, "XAUUSD", xau, 5, now).decision).toBe("WAIT");
  });
});

describe("broker rules and precision", () => {
  it("rounds to the instrument tick", () => {
    expect(roundToTick(1.123456, eur)).toBe(1.12346);
    expect(roundToTick(2655.123, xau, "up")).toBe(2655.13);
    expect(specFor("USDJPY").tick).toBe(0.001);
  });
  it("uses a different buffer per market", () => {
    expect(entryBuffer("XAUUSD", xau, 0.2, 5)).toBeCloseTo(0.4);
    expect(entryBuffer("EURUSD", eur, 0.00008, 0.001)).toBeCloseTo(0.00008);
  });
  it("rejects pending orders on the wrong side or inside the minimum distance", () => {
    expect(validateOrder("BUY_STOP", 2650.3, 2640, [2660], q, xau)).not.toEqual([]); // 0.2 above ask < 0.5 min
    expect(validateOrder("BUY_STOP", 2655.4, 2645, [2665], q, xau)).toEqual([]);
    expect(validateOrder("BUY_LIMIT", 2651, 2640, [2660], q, xau)).not.toEqual([]);
    expect(validateOrder("SELL_LIMIT", 2649, 2660, [2640], q, xau)).not.toEqual([]);
    expect(validateOrder("SELL_STOP", 2644.6, 2655, [2635], q, xau)).toEqual([]);
    expect(validateOrder("SELL_STOP", 2644.605, 2655, [2635], q, xau)).toContain("Entry is not on the instrument tick size");
  });
});

describe("targets, size, score", () => {
  it("TP1–TP4 are at least 1R..4R and ordered", () => {
    const t = buildTargets("BUY", 100, 99, [100.5, 101.6, 105], specFor("NAS100"));
    expect(t).toEqual([101.5, 102, 103, 104]);
  });
  it("lot size risks the configured % of equity", () => {
    expect(lotSize(10000, 1, 2650, 2640, xau)).toEqual({ lots: 0.1, risk: 100 });
    expect(lotSize(100, 0.1, 2650, 2640, xau).lots).toBe(0);
  });
  it("stacking trend indicators cannot inflate the score", () => {
    const one = scoreSetup({ htf: 1, structure: 0, momentum: 0, agreement: 0, liquidity: 0.5, zone: 0.5, volatility: 1, session: 0.5, spread: 1, news: 0.5 });
    const all = scoreSetup({ htf: 1, structure: 1, momentum: 1, agreement: 1, liquidity: 0.5, zone: 0.5, volatility: 1, session: 0.5, spread: 1, news: 0.5 });
    expect(all - one).toBeLessThanOrEqual(8);
  });
});

describe("lifecycle", () => {
  const o = { side: "BUY" as const, invalidation: 2640, expiresAt: now + 10, status: "pending" as const };
  const w = { now, regimeAtPlan: "trend", riskOk: true, spreadLimit: 1, newsBlackout: false, connected: true };
  it("keeps a valid order during a temporary adverse move", () => {
    expect(cancelReasons(o, { ...w, quote: { bid: 2641, ask: 2641.2, at: 0 } })).toEqual([]);
  });
  it("cancels on invalidation, expiry, spread, news and lost connection", () => {
    expect(cancelReasons(o, { ...w, quote: { bid: 2639, ask: 2639.2, at: 0 } })[0]).toMatch(/invalidated/);
    expect(cancelReasons(o, { ...w, now: now + 11 })).toContain("Signal expired");
    expect(cancelReasons(o, { ...w, quote: { bid: 2645, ask: 2647, at: 0 } })).toContain("Spread above the configured limit");
    expect(cancelReasons(o, { ...w, newsBlackout: true, connected: false })).toHaveLength(2);
  });
  it("paper fills stops through entry and limits back to entry", () => {
    expect(paperFill("BUY_STOP", 10, { h: 10.1, l: 9 })).toBe(true);
    expect(paperFill("BUY_LIMIT", 10, { h: 11, l: 10.1 })).toBe(false);
    expect(paperFill("SELL_LIMIT", 10, { h: 10, l: 9 })).toBe(true);
  });
  it("never duplicates an active setup", () => {
    const s = { mode: "pending" as const, minScore: 70, orders: [{ key: "k", status: "pending" } as never] };
    expect(hasActive(s, "k")).toBe(true); expect(hasActive(s, "x")).toBe(false);
  });
  it("modes gate automatic submission; live needs authorisation", () => {
    expect(mayAutoSubmit("assist", "BUY_STOP", false, false, 90, 70).ok).toBe(false);
    expect(mayAutoSubmit("pending", "BUY_MARKET", false, false, 90, 70).ok).toBe(false);
    expect(mayAutoSubmit("pending", "BUY_LIMIT", false, false, 90, 70).ok).toBe(true);
    expect(mayAutoSubmit("full", "SELL_MARKET", true, false, 90, 70).ok).toBe(false);
    expect(mayAutoSubmit("full", "SELL_MARKET", true, true, 65, 70).ok).toBe(false);
  });
});
