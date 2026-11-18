import type { Series } from "./indicators";
import type { Interval, MarketRead, Regime, StrategyId, StrategyOutput } from "./types";
import { BOOK } from "./strategy-book";

export type Params = Record<string, number>;

/** Price text with sensible precision for the instrument size (5 dp for FX, 2 dp for BTC/indices). */
export const px = (n: number) => n.toFixed(n >= 1000 ? 2 : n >= 10 ? 3 : 5);

/** Live context that is not part of the candles (configured sessions, measured spread). */
export interface StrategyContext {
  sessionOk: boolean;
  sessionNote?: string;
  /** Spread as a share of ATR, when the data source provides bid/ask. */
  spreadAtr?: number;
  maxSpreadAtr: number;
}

export interface StrategyDef {
  id: StrategyId;
  name: string;
  letter: string;
  description: string;
  /** Market conditions this strategy is designed for (drives automatic activation). */
  suited: Regime[];
  /** Strategies that may trade against the slower trend (the 90-strategy book never does). */
  reversal: boolean;
  /** Charts this strategy scans; omitted = every scanned chart. */
  frames?: Interval[];
  defaults: Params;
  /** Small parameter grid used by walk-forward optimisation. */
  grid: Record<string, number[]>;
  evaluate(s: Series, i: number, p: Params, m: MarketRead, ctx: StrategyContext): StrategyOutput;
}

/** The AutoTrader Pro book: 90 with-trend strategies (strategy-book.ts). Every older strategy was erased. */
export const STRATEGIES: StrategyDef[] = BOOK;

const RETIRED = (id: StrategyId): StrategyDef => ({
  id, letter: "–", name: "Retired strategy", description: "Removed from the book.", suited: [], reversal: false,
  defaults: {}, grid: {}, evaluate: () => ({ blockers: ["Retired"] }),
});
/** Looks up a strategy; ids from older saved results resolve to a retired placeholder. */
export const strategyById = (id: StrategyId) => STRATEGIES.find((x) => x.id === id) ?? RETIRED(id);
