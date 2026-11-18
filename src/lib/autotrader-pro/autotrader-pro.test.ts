import { describe, expect, it } from "vitest";
import { buildSeries } from "./indicators";
import { backtestStrategy } from "./backtest";
import { closedIndex, DEFAULT_ENGINE, runEngine, type ScanResult } from "./engine";
import { cleanSymbols } from "./store";
import { pickTimeframe, SCAN_INTERVALS } from "./timeframes";
import { accountState, LIVE_ASSUME_OPEN_MS } from "./account";
import { manageTrade, positionSize, RISK_PRESETS, riskGate, type AccountState, type ManagedTrade } from "./risk";
import { STRATEGIES } from "./strategies";
import type { Candle, Signal } from "./types";
import type { JournalRecord } from "@/lib/trade-log";

const balanced = RISK_PRESETS.balanced;
const MIN = 60_000;

/** Deterministic random walk with trending phases (seeded LCG) — synthetic test data only. */
function walk(n: number, seed = 7): Candle[] {
  let x = seed, p = 100;
  const rnd = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 60) * 0.08;
    const o = p, c = o + drift + (rnd() - 0.5) * 0.6;
    out.push({ t: i * MIN, o, c, h: Math.max(o, c) + rnd() * 0.25, l: Math.min(o, c) - rnd() * 0.25, v: 100 + rnd() * 50 });
    p = c;
  }
  return out;
}
const account = (patch: Partial<AccountState> = {}): AccountState => ({ equity: 10000, peakEquity: 10000, dailyPnl: 0, openTrades: 0, tradesToday: 0, consecutiveLosses: 0, ...patch });
const bar = (h: number, l: number, c = (h + l) / 2): Candle => ({ t: 0, o: c, h, l, c, v: 1 });

describe("AutoTrader Pro risk rules", () => {
  it("sizes a trade so the stop risks the configured 1% of the account", () => {
    const s = positionSize("EURUSD", 1.1, 1.095, "normal", balanced, 10000);
    expect(s.riskAmount).toBe(100);
    expect(s.lots).toBe(0.2);
  });

  it("blocks new entries once the daily loss limit (4% balanced) is reached", () => {
    const blocked = riskGate(balanced, { account: account({ dailyPnl: -400 }), atr: 1, lastCandle: bar(101, 100), now: Date.now() });
    expect(blocked.ok).toBe(false);
    expect(blocked.reasons.some((r) => r.startsWith("Daily loss limit"))).toBe(true);
    expect(riskGate(balanced, { account: account({ dailyPnl: -399 }), atr: 1, lastCandle: bar(101, 100), now: Date.now() }).ok).toBe(true);
  });

  it("takes the stop first when one bar touches both stop and target", () => {
    const t: ManagedTrade = { side: "BUY", entry: 100, stopLoss: 99, takeProfit: 102, initialStop: 99, lots: 1, remaining: 1, realized: 0, breakEven: false, partialTaken: false, trailing: false };
    const out = manageTrade(t, bar(102.5, 98.5), 1, balanced, 1);
    expect(out.closed?.reason).toBe("Stop loss hit");
    expect(out.realized).toBe(-1);
  });

  it("moves to break-even and books 60% at 0.6R before trailing", () => {
    const t: ManagedTrade = { side: "BUY", entry: 100, stopLoss: 99, takeProfit: 105, initialStop: 99, lots: 1, remaining: 1, realized: 0, breakEven: false, partialTaken: false, trailing: false };
    const out = manageTrade(t, bar(100.7, 99.5, 100.65), 0, balanced, 1);
    expect(out.closed).toBeUndefined();
    expect(out.stopLoss).toBe(100);
    expect(out.remaining).toBe(0.4);
    expect(out.realized).toBeCloseTo(0.36, 10);
  });

  it("counts a live trade as open for 4 hours since live positions are never read", () => {
    const now = 10 * 3_600_000;
    const rec = (ts: number): JournalRecord => ({ id: String(ts), ts, kind: "trade", mode: "live", strategy: "A", symbol: "EURUSD", side: "BUY", outcome: "open" });
    const s = accountState([rec(now - 60_000), rec(now - LIVE_ASSUME_OPEN_MS - 1)], "live", balanced, now);
    expect(s.openTrades).toBe(1);
  });
});

describe("AutoTrader Pro analysis without look-ahead", () => {
  it("ignores the still-forming candle", () => {
    const c = walk(5);
    expect(closedIndex(c, MIN, 4 * MIN + 30_000)).toBe(3);
    expect(closedIndex(c, MIN, 5 * MIN)).toBe(4);
  });

  it("backtests fill at the next bar's open plus slippage, after the signal bar", () => {
    const c = walk(900);
    const s = buildSeries(c);
    let total = 0;
    for (const def of STRATEGIES) {
      const { trades } = backtestStrategy(s, def, def.defaults, balanced, DEFAULT_ENGINE.sessions);
      for (const t of trades) {
        const k = c.findIndex((x) => x.t === t.entryAt);
        expect(k).toBeGreaterThan(0);
        expect(Math.abs(t.entry - c[k].o)).toBeLessThanOrEqual(balanced.slippageAtr * s.atr[k - 1] + 1e-9);
        expect(t.exitAt).toBeGreaterThanOrEqual(t.entryAt);
      }
      total += trades.length;
    }
    expect(total).toBeGreaterThan(0);
  });

  it("gives the same signal on a bar whatever happens afterwards", () => {
    const c = walk(400);
    const i = 300;
    const future = c.map((x, k) => (k > i ? { ...x, o: x.o * 1.2, h: x.h * 1.3, l: x.l * 0.8, c: x.c * 0.9 } : x));
    const input = { symbol: "TEST", interval: "1m" as const, settings: DEFAULT_ENGINE, risk: balanced, ctx: {}, now: c[i].t + MIN };
    const a = runEngine(buildSeries(c), i, input), b = runEngine(buildSeries(future), i, input);
    expect(b.summary).toBe(a.summary);
    expect(b.candidates.map((x) => [x.strategy, x.side, x.confidence])).toEqual(a.candidates.map((x) => [x.strategy, x.side, x.confidence]));
  });
});

describe("AutoTrader Pro symbols and timeframes", () => {
  it("keeps symbols exactly as typed (case preserved) and drops case-only duplicates", () => {
    expect(cleanSymbols(["XAUUSD.m", "btcusd", "XAUUSD.M", " EurUsd "])).toEqual(["XAUUSD.m", "btcusd", "EurUsd"]);
  });

  it("scans only 1m, 5m and 15m automatically", () => {
    expect(SCAN_INTERVALS).toEqual(["1m", "5m", "15m"]);
  });

  it("acts on a confirmed signal over a higher-scored early setup, and prefers the slower chart on a tie", () => {
    const sig = (stage: "early" | "confirmed", confidence: number) => ({ stage, confidence, side: "BUY" }) as Signal;
    const res = (best: Signal | undefined, cands: Signal[]) => ({ best, candidates: cands }) as ScanResult;
    const early90 = sig("early", 90), conf70 = sig("confirmed", 70);
    expect(pickTimeframe([
      { interval: "1m", result: res(undefined, [early90]) },
      { interval: "5m", result: res(conf70, [conf70]) },
    ])?.interval).toBe("5m");
    expect(pickTimeframe([
      { interval: "5m", result: res(conf70, [conf70]) },
      { interval: "15m", result: res(conf70, [conf70]) },
    ])?.interval).toBe("15m");
  });
});
