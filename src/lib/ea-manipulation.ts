/**
 * EA Manipulation settings (pure, browser + server safe).
 * A strategy picks the robot's trade style plus extra entry filters; the time frame
 * spaces trades (one trade per symbol per candle); the execution time is the hour
 * (device time) from which the robot may trade each day.
 */
import type { StyleChoice } from "./auto-style";

export type EaStrategy = "auto" | "scalping" | "day" | "sniper" | "arbitrage" | "swing" | "trendflow";
export type EaTimeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4";

/** Who makes the trading call: the AI trader (scans and decides) or the built-in engine (with an AI approve/block check). */
export type EaBrain = "ai" | "builtin";
export type EaManipulation = { strategy: EaStrategy; timeframe: EaTimeframe; execHour: number | null; brain: EaBrain };

export const BRAINS: Record<EaBrain, { label: string; hint: string }> = {
  ai: { label: "AI Trader", hint: "AI scans every 5-minute candle and makes the call" },
  builtin: { label: "Built-in", hint: "Built-in engine scans, AI approves or blocks" },
};
export const BRAIN_ORDER: EaBrain[] = ["ai", "builtin"];

export const STRATEGIES: Record<EaStrategy, { label: string; style: StyleChoice; minConfidence: number; trendOnly: boolean; hint: string }> = {
  auto: { label: "Auto (market decides)", style: "auto", minConfidence: 0, trendOnly: false, hint: "Picks scalp, normal or swing from the market and sizes the stop and target to match" },
  scalping: { label: "Scalping", style: "scalp", minConfidence: 0, trendOnly: false, hint: "Quick trades with a close stop and target" },
  day: { label: "Day", style: "normal", minConfidence: 0, trendOnly: false, hint: "Balanced intraday trades" },
  sniper: { label: "Sniper", style: "scalp", minConfidence: 80, trendOnly: false, hint: "Quick trades on very strong setups only" },
  arbitrage: { label: "Arbitrage", style: "scalp", minConfidence: 70, trendOnly: false, hint: "Fast in-and-out on strong price imbalances" },
  swing: { label: "Swing", style: "swing", minConfidence: 0, trendOnly: false, hint: "Follows the bigger move with a wider target" },
  trendflow: { label: "Trend Flow", style: "normal", minConfidence: 0, trendOnly: true, hint: "Only trades in the direction of the main trend" },
};
/** Grid order matches the settings screen (Auto full width, then two columns, left to right). */
export const STRATEGY_ORDER: EaStrategy[] = ["auto", "scalping", "day", "sniper", "arbitrage", "swing", "trendflow"];

export const TIMEFRAME_MS: Record<EaTimeframe, number> = {
  M1: 60_000, M5: 5 * 60_000, M15: 15 * 60_000, M30: 30 * 60_000, H1: 60 * 60_000, H4: 4 * 60 * 60_000,
};
/** Two-column grid order from the settings screen: M1 M30 / M5 H1 / M15 H4. */
export const TIMEFRAME_ORDER: EaTimeframe[] = ["M1", "M30", "M5", "H1", "M15", "H4"];
export const EXEC_HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export const DEFAULT_EA_MANIPULATION: EaManipulation = { strategy: "auto", timeframe: "M15", execHour: null, brain: "ai" };

const isStrategy = (v: unknown): v is EaStrategy => typeof v === "string" && v in STRATEGIES;
const isTimeframe = (v: unknown): v is EaTimeframe => typeof v === "string" && v in TIMEFRAME_MS;

/** Accepts stored data of any shape; unknown values fall back to the defaults. */
export function normalizeEaManipulation(raw: unknown, legacyStyle?: unknown): EaManipulation {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const legacy: EaStrategy | undefined = legacyStyle === "scalp" ? "scalping" : legacyStyle === "swing" ? "swing" : legacyStyle === "normal" ? "day" : undefined;
  const hour = Number(r.execHour);
  return {
    strategy: isStrategy(r.strategy) ? r.strategy : legacy ?? DEFAULT_EA_MANIPULATION.strategy,
    timeframe: isTimeframe(r.timeframe) ? r.timeframe : DEFAULT_EA_MANIPULATION.timeframe,
    execHour: r.execHour !== null && (EXEC_HOURS as readonly number[]).includes(hour) ? hour : null,
    brain: r.brain === "builtin" ? "builtin" : "ai",
  };
}

export const formatHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Trading is allowed from the chosen hour until midnight (device time); no hour = any time. */
export function isWithinExecutionTime(execHour: number | null, now: Date): boolean {
  return execHour === null || now.getHours() >= execHour;
}

/** True when `lastTradeAt` falls in the same candle of the chosen time frame as `now`. */
export function sameCandle(lastTradeAt: number | undefined, now: number, timeframe: EaTimeframe): boolean {
  if (!lastTradeAt || !Number.isFinite(lastTradeAt)) return false;
  const size = TIMEFRAME_MS[timeframe];
  return Math.floor(lastTradeAt / size) === Math.floor(now / size);
}

/** Extra entry filters a strategy adds on top of the engine's own checks. */
export function strategyAllows(strategy: EaStrategy, side: "BUY" | "SELL", confidence: number, trendSide?: "BUY" | "SELL"): { ok: boolean; note?: string } {
  const rule = STRATEGIES[strategy];
  if (confidence < rule.minConfidence) return { ok: false, note: `${rule.label} waits for a stronger setup (needs ${rule.minConfidence}% confidence)` };
  if (rule.trendOnly && trendSide && trendSide !== side) return { ok: false, note: `${rule.label} skips ${side} against the ${trendSide} trend` };
  return { ok: true };
}
