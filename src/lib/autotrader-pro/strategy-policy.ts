import { BOOK, type BookRole } from "./strategy-book";
import type { StrategyDef } from "./strategies";
import type { Interval } from "./types";

/**
 * Strategy policy (pure). The book holds trend, range and transition (range breakout, retest, exhaustion turn)
 * strategies; each declares the charts it scans (5m–1h, never the noisy 1m) and its role.
 */
export const WITH_TREND_ONLY = true;

/** Scan order: trend context first, then breakouts, then continuation entries, then reversal turns. */
export type ScanRole = BookRole;
export const ROLE_ORDER: ScanRole[] = ["context", "breakout", "continuation", "reversal"];
const ROLE = new Map(BOOK.map((d) => [d.id, d.role]));
export const roleOf = (d: StrategyDef): ScanRole => ROLE.get(d.id) ?? "continuation";

/** Frames a strategy scans. */
export const framesOf = (d: StrategyDef): Interval[] => d.frames ?? [];

/** The live strategy book, ordered by scan role (stable inside a role). */
export const SCAN_BOOK: StrategyDef[] = BOOK
  .map((d, k) => ({ d, k }))
  .sort((a, b) => ROLE_ORDER.indexOf(roleOf(a.d)) - ROLE_ORDER.indexOf(roleOf(b.d)) || a.k - b.k)
  .map((x) => x.d);
