/**
 * Pure rules for AI Trader mode, where the AI scans the market and always makes a BUY or SELL call
 * (the user wants no WAIT signals). Whatever the AI answers, the levels are fitted to these rules
 * before the robot may place it: market entry at the live price, a stop sized to the style's
 * volatility band, a target that never passes the nearest level and a minimum reward:risk.
 * When the AI's levels don't fit, they are repaired, never used as given (browser + server safe).
 */
import type { TradeStyle } from './trade-style';

export type AiTradeCall = { side: 'BUY' | 'SELL' | 'WAIT'; confidence: number; entry: number; stopLoss: number; takeProfit: number; reason: string };
export type AiTradeContext = { price: number; atr15: number; style: TradeStyle; supports: number[]; resistances: number[]; fallbackSide?: 'BUY' | 'SELL' };
export type AiTradeCheck =
  | { ok: true; side: 'BUY' | 'SELL'; confidence: number; entry: number; stopLoss: number; takeProfit: number; reason: string; capped: boolean; adjusted: string[] }
  | { ok: false; reason: string };

/** Stop / target distance limits in 15m ATR for each trade style, plus the minimum reward:risk. */
export const AI_TRADER_LIMITS: Record<TradeStyle, { stop: [number, number]; target: [number, number]; minRewardRisk: number }> = {
  scalp: { stop: [0.5, 1.5], target: [0.5, 2], minRewardRisk: 0.8 },
  normal: { stop: [0.8, 2.5], target: [0.8, 3.5], minRewardRisk: 1 },
  swing: { stop: [1.2, 4], target: [1.5, 6], minRewardRisk: 1 },
};
/** Reward:risk of the compact fallback used when a nearby level leaves little room (same as the built-in engine). */
export const AI_COMPACT_RR = 1.2;
/** Entry must sit this close to the live price (in 15m ATR), otherwise the AI's stop/target distances are moved to the live price. */
export const AI_TRADER_MAX_ENTRY_GAP = 0.35;
/** The AI is asked once per 5-minute candle per pair, so credits stay bounded. */
export const AI_TRADER_SCAN_MS = 5 * 60_000;

const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Fits the AI's call to the style's limits; a target past the nearest level is pulled in just before it. */
export function checkAiTrade(call: AiTradeCall, ctx: AiTradeContext): AiTradeCheck {
  const reason = call.reason.trim().slice(0, 280) || 'AI call';
  if (!pos(ctx.price) || !pos(ctx.atr15) || ctx.atr15 >= ctx.price) return { ok: false, reason: 'Live chart data incomplete — retrying' };
  const adjusted: string[] = [];
  // No WAIT: an undecided AI takes the built-in engine's side.
  const side: 'BUY' | 'SELL' = call.side === 'WAIT' ? ctx.fallbackSide ?? 'BUY' : call.side;
  if (call.side === 'WAIT') adjusted.push(`AI undecided — following the engine's ${side}`);
  const confidence = clamp(Math.round(Number(call.confidence) || 50), 50, 100);
  const atr = ctx.atr15;
  const sign = side === 'BUY' ? 1 : -1;
  const limits = AI_TRADER_LIMITS[ctx.style];
  const entry = ctx.price; // market order at the live price
  // The AI's distances, measured from its own entry (or the live price when its entry is unusable).
  const base = pos(call.entry) && Math.abs(call.entry - entry) <= atr * 3 ? call.entry : entry;
  if (base !== call.entry) adjusted.push('entry moved to the live price');
  else if (Math.abs(call.entry - entry) > atr * AI_TRADER_MAX_ENTRY_GAP) adjusted.push('levels moved with price');
  let riskAtr = pos(call.stopLoss) ? ((base - call.stopLoss) * sign) / atr : NaN;
  let rewardAtr = pos(call.takeProfit) ? ((call.takeProfit - base) * sign) / atr : NaN;
  const midStop = (limits.stop[0] + limits.stop[1]) / 2;
  if (!(riskAtr > 0)) { riskAtr = midStop; adjusted.push('stop rebuilt behind price'); }
  if (!(rewardAtr > 0)) { rewardAtr = Math.max(riskAtr * 1.5, limits.target[0]); adjusted.push('target rebuilt'); }
  if (riskAtr < limits.stop[0] || riskAtr > limits.stop[1]) { riskAtr = clamp(riskAtr, limits.stop[0], limits.stop[1]); adjusted.push(`stop fitted to ${ctx.style} volatility`); }
  if (rewardAtr > limits.target[1]) { rewardAtr = limits.target[1]; adjusted.push(`target fitted to ${ctx.style} range`); }
  // Raise a too-small target to the minimum reward:risk while staying inside the style range.
  if (rewardAtr / riskAtr < limits.minRewardRisk) rewardAtr = Math.min(limits.target[1], riskAtr * limits.minRewardRisk);
  if (rewardAtr < limits.target[0]) rewardAtr = limits.target[0];
  // Never aim past the nearest level in the trade direction: stop just before it.
  const obstacle = sign > 0 ? ctx.resistances.filter((l) => pos(l) && l > entry).sort((a, b) => a - b)[0]
    : ctx.supports.filter((l) => pos(l) && l < entry).sort((a, b) => b - a)[0];
  let capped = false;
  if (obstacle !== undefined) {
    const roomAtr = ((obstacle - entry) * sign) / atr - 0.1;
    if (rewardAtr > roomAtr) { rewardAtr = roomAtr; capped = true; }
  }
  // Tight room or poor reward: tighten the stop, then fall back to a compact protected trade (no WAIT).
  if (rewardAtr / riskAtr < limits.minRewardRisk) {
    const tighter = rewardAtr / limits.minRewardRisk;
    if (tighter >= limits.stop[0] && rewardAtr >= limits.target[0]) { riskAtr = tighter; adjusted.push('stop tightened for reward:risk'); }
    else { riskAtr = limits.stop[0]; rewardAtr = Math.max(rewardAtr, riskAtr * AI_COMPACT_RR); adjusted.push('tight room — compact target'); }
  } else if (rewardAtr < limits.target[0] * 0.75) {
    riskAtr = limits.stop[0]; rewardAtr = Math.max(rewardAtr, riskAtr * AI_COMPACT_RR); adjusted.push('tight room — compact target');
  }
  return {
    ok: true, side, confidence, entry, reason, capped, adjusted,
    stopLoss: entry - sign * atr * riskAtr,
    takeProfit: entry + sign * atr * rewardAtr,
  };
}

/** Moves a checked trade to a new live price, keeping its stop and target distances. */
export function reanchorTrade<T extends { side: 'BUY' | 'SELL'; entry: number; stopLoss: number; takeProfit: number }>(trade: T, price: number): T {
  const shift = price - trade.entry;
  return { ...trade, entry: price, stopLoss: trade.stopLoss + shift, takeProfit: trade.takeProfit + shift };
}

/** When the AI should look at a pair again: the start of the next 5-minute candle (a few seconds in). */
export function nextAiScanAt(now: number): number {
  return (Math.floor(now / AI_TRADER_SCAN_MS) + 1) * AI_TRADER_SCAN_MS + 5_000;
}

/** AI calls at or above this confidence may trade against the last trade's direction inside the hold time. */
export const AI_TRADER_HOLD_BREAK = 85;

/**
 * After a trade, the opposite direction is held back for the style's hold time so the AI
 * cannot sell and then buy on a small bounce; only a very strong AI call may break the hold.
 */
export function aiHoldNote(hold: { side: 'BUY' | 'SELL'; at: number } | undefined, side: 'BUY' | 'SELL', confidence: number, holdMs: number, now: number): string | null {
  if (!hold || hold.side === side || now - hold.at >= holdMs || confidence >= AI_TRADER_HOLD_BREAK) return null;
  return `AI ${side} held back — last trade was ${hold.side} ${Math.round((now - hold.at) / 60_000)} min ago`;
}
