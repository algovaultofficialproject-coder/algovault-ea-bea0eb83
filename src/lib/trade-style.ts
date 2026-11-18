/** Auto trader trade styles and direction-stability rules (pure, browser + server safe). */
export type TradeStyle = 'scalp' | 'normal' | 'swing';
export const TRADE_STYLES: TradeStyle[] = ['scalp', 'normal', 'swing'];
export const isTradeStyle = (v: unknown): v is TradeStyle => v === 'scalp' || v === 'normal' || v === 'swing';

export const STYLE_RULES: Record<TradeStyle, {
  label: string; hint: string;
  /** Time between scans of one symbol (every style scans the live candles every 15 seconds). */
  scanMs: number;
  /** Faster re-scan while a direction change is waiting for confirmation. */
  confirmMs: number;
  /** Consecutive scans an opposite direction needs before it replaces the current one. */
  confirmScans: number;
  /** The opposite direction must keep showing for at least this long (across several 1m candles). */
  minFlipMs: number;
  /** Against the slower-chart trend, a flip also needs a confirmed 5m/15m structural turn. */
  needsTurnAgainstTrend: boolean;
  /** After a trade or signal, the opposite direction is held back for this long unless confirmed. */
  holdMs: number;
}> = {
  scalp: { label: 'Scalp', hint: 'Quick trades, close stop and target', scanMs: 15_000, confirmMs: 15_000, confirmScans: 2, minFlipMs: 30_000, needsTurnAgainstTrend: false, holdMs: 10 * 60_000 },
  normal: { label: 'Normal', hint: 'Balanced intraday trades', scanMs: 15_000, confirmMs: 15_000, confirmScans: 4, minFlipMs: 3 * 60_000, needsTurnAgainstTrend: true, holdMs: 30 * 60_000 },
  swing: { label: 'Swing', hint: 'Follows the bigger trend, wider target', scanMs: 15_000, confirmMs: 15_000, confirmScans: 5, minFlipMs: 10 * 60_000, needsTurnAgainstTrend: true, holdMs: 2 * 60 * 60_000 },
};

export type DirectionMemory = {
  side?: 'BUY' | 'SELL';
  confidence?: number;
  pending?: { side: 'BUY' | 'SELL'; count: number; lastAt: number; since?: number };
  tradedSide?: 'BUY' | 'SELL';
  tradedAt?: number;
};

/** What the engine observed on this scan, used to tell a real turn from a fast-chart pullback. */
export type DirectionEvidence = {
  /** A 5m/15m structural turn (structure break, direction change, failed break, V-reversal) backs this side. */
  turnConfirmed?: boolean;
  /** Direction of the slower 15m/5m/1h trend. */
  trendSide?: 'BUY' | 'SELL';
};

export type StabilityResult = { memory: DirectionMemory; accept: boolean; note?: string; nextScanMs: number };

/** Gap between confirming scans before a forming direction change starts over. */
const PENDING_GAP_MS = 90_000;

/**
 * Stops the scanner flipping BUY → SELL → BUY on every small wiggle.
 * A new direction must repeat on consecutive scans for a minimum time (one fewer scan and half
 * the time when very strong); in normal/swing, flipping against the slower trend also needs a
 * confirmed structural turn; and the opposite of the last traded direction is held back a while.
 */
export function stabilizeDirection(mem: DirectionMemory, side: 'BUY' | 'SELL', confidence: number, style: TradeStyle, now: number, evidence: DirectionEvidence = {}): StabilityResult {
  const rule = STYLE_RULES[style];
  const strong = confidence >= 85;
  const counterTrend = rule.needsTurnAgainstTrend && evidence.trendSide !== undefined && evidence.trendSide !== side;
  // Inside the hold time only a very strong signal (with a confirmed turn in normal/swing) may trade the other way.
  const holdBreak = strong && (!rule.needsTurnAgainstTrend || evidence.turnConfirmed === true);
  if (!mem.side || mem.side === side) {
    const held = mem.tradedSide && mem.tradedSide !== side && mem.tradedAt !== undefined && now - mem.tradedAt < rule.holdMs && !(mem.side === side && holdBreak);
    const memory: DirectionMemory = { ...mem, side, confidence, pending: undefined };
    if (held) return { memory, accept: false, note: `holding ${mem.tradedSide} bias from the last trade`, nextScanMs: rule.scanMs };
    return { memory, accept: true, nextScanMs: rule.scanMs };
  }
  // Opposite direction to the current one: count confirmations over time.
  const fresh = mem.pending && mem.pending.side === side && now - mem.pending.lastAt <= PENDING_GAP_MS;
  const count = fresh ? mem.pending!.count + 1 : 1;
  const since = fresh ? mem.pending!.since ?? mem.pending!.lastAt : now;
  const needed = Math.max(1, rule.confirmScans - (strong ? 1 : 0));
  const minMs = strong ? rule.minFlipMs / 2 : rule.minFlipMs;
  const pending = { side, count, lastAt: now, since };
  if (count < needed || now - since < minMs) {
    return {
      memory: { ...mem, pending }, accept: false,
      note: `${side} forming against ${mem.side} — confirming (${Math.min(count, needed)}/${needed} scans, ${Math.round((now - since) / 1000)}s of ${Math.round(minMs / 1000)}s)`,
      nextScanMs: rule.confirmMs,
    };
  }
  // A move against the slower trend without a structural turn is a pullback, not a reversal.
  if (counterTrend && !evidence.turnConfirmed) {
    return { memory: { ...mem, pending }, accept: false, note: `${side} is only a pullback against the ${evidence.trendSide} trend — waiting for a confirmed turn`, nextScanMs: rule.confirmMs };
  }
  const memory: DirectionMemory = { ...mem, side, confidence, pending: undefined };
  const held = mem.tradedSide && mem.tradedSide !== side && mem.tradedAt !== undefined && now - mem.tradedAt < rule.holdMs && !holdBreak;
  if (held) return { memory, accept: false, note: `${side} confirmed, but holding ${mem.tradedSide} bias from the last trade`, nextScanMs: rule.scanMs };
  return { memory, accept: true, note: `direction changed to ${side} after ${count} confirming scans`, nextScanMs: rule.scanMs };
}
