/** Pure Gemini referee rules for AutoTrader Pro signals (no network). */
import type { Side } from "./types";

export type GeminiVerdict = { side: Side | "WAIT"; confidence: number; reason: string };

/** Pure: read Gemini's JSON reply; anything malformed is ignored (null). */
export function parseGeminiVerdict(text: string | null | undefined): GeminiVerdict | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { side?: unknown; confidence?: unknown; reason?: unknown };
    const side = String(j.side ?? "").toUpperCase();
    if (side !== "BUY" && side !== "SELL" && side !== "WAIT") return null;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(j.confidence) || 0)));
    return { side, confidence, reason: String(j.reason ?? "").slice(0, 240) };
  } catch { return null; }
}

/** Gemini must be at least this sure to overrule or open a trade on its own. */
export const GEMINI_OVERRULE_MIN = 60;

/**
 * Pure: how a Gemini verdict changes the engine's decision.
 * - none / WAIT / unsure → keep the engine signal
 * - agrees → keep it, confidence +5
 * - disagrees (or engine WAIT) with ≥60% → trade Gemini's side (caller re-plans stop/target)
 */
export function refereeAction(engineSide: Side | "WAIT", v: GeminiVerdict | null): "keep" | "agree" | "follow" {
  if (!v || v.side === "WAIT") return "keep";
  if (v.side === engineSide) return "agree";
  return v.confidence >= GEMINI_OVERRULE_MIN ? "follow" : "keep";
}
