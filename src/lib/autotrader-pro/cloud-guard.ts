/**
 * Pure helpers shared by the in-app guard and the 24/7 server guard, so both judge open trades the
 * same way. Never opens trades.
 */
import { isAppTrade, reversalExit, tradeSide, type FrameRead, type GuardTrade } from "./position-guard";

export interface ExitPlan {
  notes: Record<string, string>;
  due: { ticket: string; symbol: string; profit: number; reason: string }[];
  /** Symbols whose candles are needed (AlgoVault trades in profit). */
  symbols: string[];
}

/** Symbols worth reading candles for: only AlgoVault trades that are currently in profit. */
export function symbolsToRead(trades: GuardTrade[]): string[] {
  return [...new Set(trades.filter((t) => isAppTrade(t.comment) && tradeSide(t.type) && t.profit > 0).map((t) => t.symbol))];
}

/** Decide which trades to close from the frame reads per symbol (missing reads = not judged). */
export function planExits(trades: GuardTrade[], reads: Record<string, FrameRead[] | undefined>): ExitPlan {
  const notes: Record<string, string> = {};
  const due: ExitPlan["due"] = [];
  for (const t of trades) {
    if (!isAppTrade(t.comment) || !tradeSide(t.type)) continue;
    if (!(t.profit > 0)) { notes[t.ticket] = "in loss — stop loss protects it"; continue; }
    const r = reads[t.symbol];
    if (!r || r.length < 2) { notes[t.ticket] = "market data unavailable — not judged"; continue; }
    const d = reversalExit(t, r);
    notes[t.ticket] = d.reason;
    if (d.close) due.push({ ticket: t.ticket, symbol: t.symbol, profit: t.profit, reason: d.reason });
  }
  return { notes, due, symbols: symbolsToRead(trades) };
}

export interface GuardEvent { at: number; text: string; kind: "closed" | "error" }

export const MAX_GUARD_EVENTS = 20;

/** Newest first, de-duplicated by time+text, capped so the stored list never grows without bound. */
export function mergeEvents(old: GuardEvent[], add: GuardEvent[], max = MAX_GUARD_EVENTS): GuardEvent[] {
  const seen = new Set<string>();
  return [...add, ...old]
    .filter((e) => e && typeof e.at === "number" && typeof e.text === "string")
    .sort((a, b) => b.at - a.at)
    .filter((e) => { const k = `${e.at}|${e.text}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

/** Events newer than what this device already showed. */
export const unseenEvents = (events: GuardEvent[], lastSeen: number) => events.filter((e) => e.at > lastSeen).sort((a, b) => a.at - b.at);
