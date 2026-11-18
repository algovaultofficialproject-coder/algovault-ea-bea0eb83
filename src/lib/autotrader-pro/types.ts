/** Shared, JSON-serialisable types for the AutoTrader Pro strategy engine (also reusable by the Android app). */
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export type Side = "BUY" | "SELL";
export type Stage = "early" | "confirmed";
export type Interval = "1m" | "5m" | "15m" | "30m" | "1h";
export type TradingMode = "analysis" | "paper" | "live";

export type Regime =
  | "strong_bull" | "strong_bear" | "ranging" | "high_volatility" | "low_volatility" | "breakout" | "reversal";
export type VolatilityClass = "low" | "normal" | "high" | "extreme";
export type TrendClass = "bullish" | "bearish" | "neutral";

/** Strategy ids come from the 90-strategy book (strategy-book.ts), e.g. "pb1" … "pa10". */
export type StrategyId = string;

export interface MarketRead {
  regime: Regime;
  /** Every condition that currently applies (the primary regime is first). */
  tags: Regime[];
  trend: TrendClass;
  volatility: VolatilityClass;
  atr: number;
  /** Where today's ATR sits among the last 100 bars (0 = quietest, 1 = most volatile). */
  atrRank: number;
  adx: number;
  notes: string[];
}

export interface Candidate {
  strategy: StrategyId;
  side: Side;
  stage: Stage;
  confirmations: string[];
  /** Conditions still missing before an early setup becomes confirmed. */
  missing: string[];
  entry: number;
  entryZone: [number, number];
  /** Structural stop suggested by the strategy; risk sizing may widen it. */
  structuralStop: number;
  /** Optional structural target (e.g. the other side of a range). */
  structuralTarget?: number;
  invalidation: string;
  reason: string;
  /** Bars the setup stays valid for. */
  validBars: number;
}

export interface StrategyOutput { candidate?: Candidate; blockers: string[] }

export interface Signal extends Candidate {
  id: string;
  symbol: string;
  interval: Interval;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  /** Composite score 0–100 from confirmations and measured performance — not a win probability. */
  confidence: number;
  strength: 1 | 2 | 3 | 4 | 5;
  market: MarketRead;
  timestamp: number;
  expiresAt: number;
  strategyName: string;
}
