/**
 * Pure rules for the AI trade check that approves or blocks the autotrader's
 * trades just before execution. The AI can never create or flip a trade.
 */
export type ReviewVerdict = { approve: boolean; confidence: number; reason: string };
export type ReviewOutcome =
  | { status: 'approved'; reason: string; confidence: number }
  | { status: 'blocked'; reason: string; confidence: number }
  | { status: 'unavailable'; reason: string };

/** After a block, the same pair and side are skipped without asking again for this long. */
export const AI_BLOCK_COOLDOWN_MS = 5 * 60_000;

export function interpretReview(verdict: ReviewVerdict | null, error?: string): ReviewOutcome {
  if (!verdict) return { status: 'unavailable', reason: (error ?? 'AI check unavailable').slice(0, 200) };
  const confidence = Number.isFinite(verdict.confidence) ? Math.max(0, Math.min(100, Math.round(verdict.confidence))) : 0;
  const reason = verdict.reason.trim().slice(0, 240) || (verdict.approve ? 'Setup confirmed' : 'Setup rejected');
  return verdict.approve ? { status: 'approved', reason, confidence } : { status: 'blocked', reason, confidence };
}

export type BlockMemory = Record<string, { side: 'BUY' | 'SELL'; until: number }>;

export function blockedRecently(memory: BlockMemory, symbol: string, side: 'BUY' | 'SELL', now: number): boolean {
  const b = memory[symbol];
  return !!b && b.side === side && now < b.until;
}

export function rememberBlock(memory: BlockMemory, symbol: string, side: 'BUY' | 'SELL', now: number): BlockMemory {
  return { ...memory, [symbol]: { side, until: now + AI_BLOCK_COOLDOWN_MS } };
}

/** The log line shown for each outcome. */
export function reviewLogLine(symbol: string, side: 'BUY' | 'SELL', outcome: ReviewOutcome): string {
  if (outcome.status === 'approved') return `>> ${symbol}: AI approved ${side} (${outcome.confidence}%) — ${outcome.reason}`;
  if (outcome.status === 'blocked') return `>> ${symbol}: AI blocked ${side} — ${outcome.reason}`;
  return `>> ${symbol}: AI check unavailable — built-in engine decided`;
}
