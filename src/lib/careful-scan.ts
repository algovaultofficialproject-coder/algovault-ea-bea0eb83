/**
 * Careful 15-second scan: the bot samples the market several times inside a 15 s
 * window and only gives a signal when the readings agree. Pure, browser + server safe.
 */
export const CAREFUL_WINDOW_MS = 15_000;
export const CAREFUL_SAMPLE_MS = 5_000;
export const CAREFUL_MIN_SAMPLES = 3;

export type ScanSample = { side: 'BUY' | 'SELL'; confidence: number; price: number; at: number };
export type CarefulResult =
  | { ready: false; note: string; remainingMs: number }
  | { ready: true; side: 'BUY' | 'SELL'; confidence: number; agree: number; total: number; movedAgainst: number; note: string };

/**
 * Decide once the window started at `startedAt` is complete.
 * Needs ≥3 samples, ≥2/3 agreement, and the latest sample on the majority side.
 * Confidence is the majority's average, reduced when the samples weren't unanimous.
 */
export function carefulDecision(samples: ScanSample[], startedAt: number, now: number): CarefulResult {
  const elapsed = now - startedAt;
  const remainingMs = Math.max(0, CAREFUL_WINDOW_MS - elapsed);
  if (remainingMs > 0 || samples.length < CAREFUL_MIN_SAMPLES) {
    return { ready: false, note: `scanning carefully (${samples.length}/${CAREFUL_MIN_SAMPLES} reads)`, remainingMs };
  }
  const buys = samples.filter(s => s.side === 'BUY');
  const sells = samples.filter(s => s.side === 'SELL');
  const major = buys.length >= sells.length ? buys : sells;
  const side = major[0].side;
  const latest = samples[samples.length - 1];
  const total = samples.length;
  const agree = major.length;
  if (agree / total < 2 / 3 || latest.side !== side) {
    return { ready: false, note: `readings disagree (${buys.length} BUY / ${sells.length} SELL) — rescanning`, remainingMs: 0 };
  }
  const avg = major.reduce((a, s) => a + s.confidence, 0) / agree;
  const confidence = Math.round(Math.max(50, Math.min(97, avg - (agree < total ? 4 : 0) + (agree === total && total >= 3 ? 2 : 0))));
  const first = samples[0].price;
  const movedAgainst = side === 'BUY' ? first - latest.price : latest.price - first;
  return { ready: true, side, confidence, agree, total, movedAgainst, note: `${agree}/${total} reads agree over 15 s` };
}
