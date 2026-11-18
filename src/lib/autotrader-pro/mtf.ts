import type { SmcRead } from "./smc";
import { DEFAULT_TPSL, planTpSl, type TpSlPlan, type TpSlSettings } from "./tpsl";
import type { Interval, Side, Signal, VolatilityClass } from "./types";

/**
 * Top-down multi-timeframe confluence: 1H bias → 30M structure → 15M setup zone → liquidity sweep →
 * 5M confirmation → 1M trigger. Pure and deterministic; uses only closed-bar SMC reads.
 */
export interface FrameSmc {
  interval: Interval; smc: SmcRead; price: number; atr: number; volatility: VolatilityClass;
  /** Best engine signal on this chart (its confidence already reflects measured strategy performance). */
  engine?: Pick<Signal, "side" | "confidence" | "strategyName">;
}
export type MtfMode = "aggressive" | "balanced" | "strict";
export type Tier = "early" | "confirmed" | "high";
export interface Step { key: string; label: string; ok: boolean; detail: string }
export interface MtfSignal {
  side: Side; tier: Tier; setup: string; score: number; maxScore: number; confidence: number;
  entry: number; entryZone: [number, number]; stopLoss: number; tp1: number; tp2: number; tp3: number;
  rr1: number; rr2: number; rr3: number; plan: TpSlPlan; steps: Step[]; countertrend: boolean; invalidation: string; explanation: string;
  timestamp: number; expiresAt: number;
}
export interface MtfResult { signal?: MtfSignal; developing: { side: Side; score: number; steps: Step[] }[]; volatility: VolatilityClass; reason?: string }

/** Steps needed (of 8) for each tier. Confirmed and high-confluence also need the 1M trigger. */
export const MTF_THRESHOLDS: Record<MtfMode, Record<Tier, number>> = {
  aggressive: { early: 3, confirmed: 4, high: 6 },
  balanced: { early: 3, confirmed: 5, high: 7 },
  strict: { early: 4, confirmed: 6, high: 8 },
};
export const TIER_LABEL: Record<Tier, string> = { early: "Early", confirmed: "Confirmed", high: "High-confluence" };
const EXPIRY_MS = 15 * 60_000;

const want = (side: Side) => (side === "BUY" ? "bullish" : "bearish");

function steps(side: Side, f: Partial<Record<Interval, FrameSmc>>): Step[] {
  const m15 = f["15m"]?.smc, m5 = f["5m"]?.smc, m1 = f["1m"]?.smc;
  const w = want(side), disc = side === "BUY" ? "discount" : "premium";
  const sweep = [m15, m5, m1].find((x) => x?.sweep?.side === side)?.sweep;
  const zoneOk = !!m15 && (m15.zone === disc || m15.inZone?.side === side || m15.ote === side);
  const m5ok = !!m5 && (m5.displacement?.dir === side || (m5.freshEvent && m5.event?.dir === side));
  const m1ok = !!m1 && ((m1.freshEvent && m1.event?.dir === side) || m1.sweep?.side === side);
  const vol = f["5m"]?.volatility ?? f["15m"]?.volatility;
  return [
    { key: "h1", label: "15M bias", ok: m15?.bias === w, detail: m15 ? `15M ${m15.bias}${m15.event ? ` (${m15.event.kind})` : ""}, ${m15.zone}` : "15M unavailable" },
    { key: "m30", label: "5M structure", ok: !!m5 && (m5.bias === w), detail: m5 ? `5M ${m5.bias}${m5.event ? ` ${m5.event.kind}` : ""}` : "5M unavailable" },
    { key: "m15", label: `15M ${disc} / zone`, ok: zoneOk, detail: m15 ? `15M in ${m15.zone}${m15.inZone ? `, inside ${m15.inZone.label}` : ""}${m15.ote ? `, OTE ${m15.ote}` : ""}` : "15M unavailable" },
    { key: "sweep", label: side === "BUY" ? "Sell-side sweep" : "Buy-side sweep", ok: !!sweep, detail: sweep?.text ?? "No liquidity sweep yet" },
    { key: "m5", label: "5M confirmation", ok: m5ok, detail: m5 ? [m5.displacement ? `displacement ${m5.displacement.dir} ${m5.displacement.bodyAtr}×ATR` : "", m5.event ? `${m5.event.kind} ${m5.event.dir}${m5.freshEvent ? " (fresh)" : ""}` : ""].filter(Boolean).join(", ") || "No 5M confirmation" : "5M unavailable" },
    { key: "m1", label: "1M trigger", ok: m1ok, detail: m1 ? (m1.freshEvent && m1.event ? `1M ${m1.event.kind} ${m1.event.dir}` : m1.sweep ? `1M ${m1.sweep.text}` : "Waiting for 1M micro BOS/CHoCH") : "1M unavailable" },
    { key: "vol", label: "Volatility acceptable", ok: !!vol && vol !== "extreme", detail: vol ? `${vol} volatility` : "unknown" },
  ];
}

function setupName(st: Step[], f: Partial<Record<Interval, FrameSmc>>, side: Side) {
  const ok = (k: string) => st.find((s) => s.key === k)?.ok;
  const m15 = f["15m"]?.smc;
  if (ok("sweep") && ok("m5")) return "SMC Liquidity Sweep Reversal";
  if (m15?.inZone?.side === side && /FVG/.test(m15.inZone.label)) return "FVG Entry";
  if (m15?.inZone?.side === side) return "Order Block";
  if (ok("h1") && ok("m15")) return "Trend Continuation Pullback";
  if (f["5m"]?.smc.displacement?.dir === side) return "Momentum / Displacement";
  return "Structure Shift";
}

export function confluence(frames: FrameSmc[], mode: MtfMode = "balanced", now = Date.now(), tpsl: TpSlSettings = DEFAULT_TPSL): MtfResult {
  const f: Partial<Record<Interval, FrameSmc>> = Object.fromEntries(frames.map((x) => [x.interval, x]));
  const volatility = f["5m"]?.volatility ?? frames[0]?.volatility ?? "normal";
  if (!f["1m"] && !f["5m"]) return { developing: [], volatility, reason: "Lower timeframes unavailable" };
  const th = MTF_THRESHOLDS[mode];
  const sides = (["BUY", "SELL"] as Side[]).map((side) => {
    const st = steps(side, f);
    const lv = planTpSl(side, f, tpsl);
    st.push({ key: "room", label: "Reward vs risk", ok: lv.ok && lv.rrOk, detail: lv.ok ? lv.rrNote : lv.reason! });
    return { side, st, lv, score: st.filter((s) => s.ok).length };
  }).sort((a, b) => b.score - a.score);
  const developing = sides.filter((x) => x.score > 0).map((x) => ({ side: x.side, score: x.score, steps: x.st }));
  const best = sides[0];
  if (best.score === sides[1].score) return { developing, volatility, reason: "Buy and sell evidence are balanced" };
  const trigger = best.st.find((s) => s.key === "m1")!.ok, room = best.st.find((s) => s.key === "room")!.ok, volOk = best.st.find((s) => s.key === "vol")!.ok;
  if (!volOk) return { developing, volatility, reason: "Volatility too extreme for an acceptable stop" };
  const tier: Tier | undefined = best.score >= th.high && trigger && room ? "high" : best.score >= th.confirmed && trigger && room ? "confirmed" : best.score >= th.early ? "early" : undefined;
  if (!tier) return { developing, volatility, reason: "Setup still developing" };
  const { side, st, lv } = best;
  const countertrend = !st[0].ok && !st[1].ok;
  const engine = frames.filter((x) => x.engine?.side === side).map((x) => x.engine!.confidence);
  const perf = engine.length ? Math.max(...engine) : 0;
  const confidence = Math.round(Math.min(95, (best.score / st.length) * 70 + perf * 0.3 - (countertrend ? 10 : 0)));
  const setup = setupName(st, f, side);
  const f1Atr = (f["1m"] ?? f["5m"])!.atr;
  const passed = st.filter((s) => s.ok).map((s) => s.detail);
  return {
    developing, volatility,
    signal: {
      side, tier, setup, score: best.score, maxScore: st.length, confidence,
      entry: lv.entry, entryZone: [lv.entry - f1Atr * 0.25, lv.entry + f1Atr * 0.25], stopLoss: lv.stop, tp1: lv.tp1.x, tp2: lv.tp2.x, tp3: lv.tp3.x,
      rr1: lv.rr1, rr2: lv.rr2, rr3: lv.rr3, plan: lv, steps: st, countertrend,
      invalidation: `Invalid if a candle closes ${side === "BUY" ? "below" : "above"} ${lv.stop.toPrecision(6)} or after expiry`,
      explanation: `${TIER_LABEL[tier]} ${side} — ${setup}${countertrend ? " (countertrend)" : ""}: ${passed.join("; ")}`,
      timestamp: now, expiresAt: now + EXPIRY_MS,
    },
  };
}

export const DEFAULT_MTF_ALERTS: Record<Tier, boolean> = { early: false, confirmed: true, high: true };
/** Whether a newly graded signal should raise a device alert under the user's per-grade settings. */
export function shouldAlert(alerts: Partial<Record<Tier, boolean>> | undefined, tier: Tier): boolean {
  return alerts?.[tier] ?? DEFAULT_MTF_ALERTS[tier];
}
