import type { ScanResult } from "./engine";
import { STRATEGIES } from "./strategies";
import type { Interval, Side, Signal, Stage } from "./types";

/** Every chart AutoTrader Pro scans automatically; the user never picks one. */
export const SCAN_INTERVALS: Interval[] = ["1m", "5m", "15m"];

/** Top-down scan order: slow charts set the context before fast charts time the entry. */
export const SCAN_ORDER: Interval[] = [...SCAN_INTERVALS].reverse();

export interface FrameRead { interval: Interval; result: ScanResult }
export interface FrameSummary { interval: Interval; side?: Side; stage?: Stage; confidence?: number; error?: string }

const lead = (r: ScanResult) => r.best ?? r.candidates[0];

/** 1m/5m change-of-direction focus: ranking bonus for a fast-chart turn, larger when 1m and 5m turn the same way. */
export const TURN_BONUS = 6, TURN_AGREE_BONUS = 6;
const FAST_TURN: Interval[] = ["1m", "5m"];
const REVERSAL = new Set(STRATEGIES.filter((d) => d.reversal).map((d) => d.id));
const isTurn = (sig?: Signal) => !!sig && REVERSAL.has(sig.strategy);

/** Pure: which fast frames lead with a change-of-direction setup, and whether 1m and 5m agree on its side. */
export function turnFocus(frames: FrameRead[]): { bonus: Partial<Record<Interval, number>>; agree?: Side } {
  const fast = frames.filter((f) => FAST_TURN.includes(f.interval)).map((f) => ({ f, s: lead(f.result) })).filter((x) => isTurn(x.s));
  const agree = fast.length === 2 && fast[0].s!.side === fast[1].s!.side ? fast[0].s!.side : undefined;
  const bonus: Partial<Record<Interval, number>> = {};
  for (const x of fast) bonus[x.f.interval] = TURN_BONUS + (agree ? TURN_AGREE_BONUS : 0);
  return { bonus, agree };
}

/**
 * Chooses the timeframe to act on: a confirmed signal beats any early setup, then the higher score wins —
 * with the 1m/5m change-of-direction bonus — and ties go to the slower chart. With no setups the slowest chart leads.
 * A chosen fast turn carries a note in its confirmations; scores and stages are never changed here.
 */
export function pickTimeframe<T extends FrameRead>(frames: T[]): T | undefined {
  const { bonus, agree } = turnFocus(frames);
  const rank = (f: FrameRead) => [f.result.best ? 1 : 0, (lead(f.result)?.confidence ?? 0) + (bonus[f.interval] ?? 0), SCAN_INTERVALS.indexOf(f.interval)];
  const chosen = [...frames].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let k = 0; k < ra.length; k++) if (ra[k] !== rb[k]) return rb[k] - ra[k];
    return 0;
  })[0];
  const l = chosen && bonus[chosen.interval] ? lead(chosen.result) : undefined;
  if (!chosen || !l) return chosen;
  const note = agree ? `Turn focus: 1m and 5m both changed direction ${agree === "BUY" ? "up" : "down"}` : `Turn focus: ${chosen.interval} change of direction`;
  const tag = (x: Signal) => (x === l ? { ...x, confirmations: [...x.confirmations, note] } : x);
  return { ...chosen, result: { ...chosen.result, best: chosen.result.best && tag(chosen.result.best), candidates: chosen.result.candidates.map(tag) } };
}

export function summarizeFrame(f: FrameRead): FrameSummary {
  const s = lead(f.result);
  return s ? { interval: f.interval, side: s.side, stage: f.result.best ? s.stage : "early", confidence: s.confidence } : { interval: f.interval };
}
