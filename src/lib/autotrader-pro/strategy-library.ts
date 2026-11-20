/**
 * Pure strategy library: every book strategy × each timeframe it may scan (1m/5m/15m) × each market class it
 * suits (symbol-fit) is one searchable configuration. Status comes only from real backtest/paper results stored
 * in ProState.perf — never invented: no results means "untested".
 */
import type { StrategyPerf } from "./engine";
import { BOOK } from "./strategy-book";
import { marketClass, SYMBOL_PROFILES, type MarketClass } from "./symbol-fit";
import type { Interval } from "./types";

export type LibraryStatus = "validated" | "tested" | "untested" | "underperforming" | "disabled";
export interface LibraryEntry {
  id: string; strategy: string; name: string; family: string; mode: string; role: string;
  interval: Interval; market: MarketClass; entry: string; exit: string; stop: string; direction: string;
}
export const LIBRARY_INTERVALS: Interval[] = ["1m", "5m", "15m"];
const CLASSES = Object.keys(SYMBOL_PROFILES) as MarketClass[];
const family = (id: string) => id.replace(/\d+$/, "");

export const STRATEGY_LIBRARY: LibraryEntry[] = BOOK.flatMap((d) =>
  (d.frames ?? LIBRARY_INTERVALS).filter((f) => LIBRARY_INTERVALS.includes(f)).flatMap((interval) =>
    CLASSES.filter((m) => !SYMBOL_PROFILES[m].avoid.includes(family(d.id))).map((market) => ({
      id: `${d.id}-${interval}-${market}`, strategy: d.id, name: d.name, family: family(d.id), mode: d.mode, role: d.role, interval, market,
      entry: d.description,
      exit: "One broker-side TP: nearest structure level inside 1:1–1:1.8R (else 1.5R), capped before the next obstacle",
      stop: "Structural stop behind the swing/invalidation + ATR buffer, never tighter than market noise",
      direction: d.mode === "range" ? "Fades range edges only when ADX shows no clean trend" : d.mode === "transition" ? "Trades the confirmed change of state" : "With the EMA trend bias only",
    })),
  ),
);

/** Minimum trades before a configuration counts as tested. */
export const LIBRARY_MIN_TRADES = 20;

/** Pure: merge real results for one strategy across all stored symbols of a market class and timeframe. */
export function entryPerf(e: Pick<LibraryEntry, "strategy" | "interval" | "market">, perf: Record<string, Partial<Record<string, StrategyPerf>>>): StrategyPerf | undefined {
  let trades = 0, wins = 0, exp = 0, pf = 0, under = false;
  for (const [key, rec] of Object.entries(perf)) {
    const [sym, iv] = key.split("|");
    const p = rec[e.strategy];
    if (!p || iv !== e.interval || marketClass(sym ?? "") !== e.market || !(p.trades > 0)) continue;
    trades += p.trades; wins += p.winRate * p.trades; exp += p.expectancyR * p.trades; pf += Math.min(p.profitFactor, 99) * p.trades; under ||= p.underperforming;
  }
  return trades ? { trades, winRate: wins / trades, expectancyR: exp / trades, profitFactor: pf / trades, underperforming: under } : undefined;
}

export function libraryStatus(p: StrategyPerf | undefined, enabled = true): LibraryStatus {
  if (!enabled) return "disabled";
  if (!p || p.trades < LIBRARY_MIN_TRADES) return "untested";
  if (p.underperforming || p.expectancyR <= 0 || p.profitFactor < 1) return "underperforming";
  if (p.trades >= 50 && p.profitFactor >= 1.3) return "validated";
  return "tested";
}
