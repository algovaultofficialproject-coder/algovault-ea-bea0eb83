/** Pure: one take profit kept at an average distance — never under 1:1, never wider than 1:1.8; 1:1.5 when no structure fits. */
export const MIN_TARGET_RR = 1;
export const MAX_TARGET_RR = 1.8;
export const DEFAULT_TARGET_RR = 1.5;

/** Clamp a target into the band for the given entry and stop (unchanged when the stop is invalid). */
export function bandTarget(side: "BUY" | "SELL", entry: number, stop: number, tp: number): number {
  const d = side === "BUY" ? 1 : -1, risk = Math.abs(entry - stop);
  if (!(risk > 0) || !Number.isFinite(tp)) return tp;
  const rr = ((tp - entry) * d) / risk;
  if (rr < MIN_TARGET_RR) return entry + d * MIN_TARGET_RR * risk;
  if (rr > MAX_TARGET_RR) return entry + d * MAX_TARGET_RR * risk;
  return tp;
}
