/**
 * AutoTrader Pro signal source for the home-page robot: scans every Pro timeframe on closed candles,
 * picks the strongest frame and returns only a confirmed setup with its broker-side stop and target.
 */
import { buildSeries } from "./indicators";
import { readMarketChange } from "./market-change";
import { closedIndex, INTERVAL_MS, runEngine, type ScanResult } from "./engine";
import { perfKey, type ProState } from "./store";
import { homeRobotState } from "./shared-config";
import { pickTimeframe, SCAN_ORDER } from "./timeframes";
import type { Candle, Interval, Side, Signal } from "./types";
import { readSmc } from "./smc";
import { planTpSl, tpslFor, type TpSlPlan } from "./tpsl";
import type { FrameSmc } from "./mtf";
import { refereeAction, type GeminiVerdict } from "./gemini-referee";
import { bookMode, isBreakout } from "./strategy-book";
import { momentumQuality, readMomentum, type MomentumRead, type QualityGrade } from "./momentum";

/** Pure: apply the TP/SL engine to a directional decision: structure + ATR stop and one average structure-based target. */
import { DEFAULT_TARGET_RR, MAX_TARGET_RR, MIN_TARGET_RR } from "./target-band";
export { DEFAULT_TARGET_RR, MAX_TARGET_RR, MIN_TARGET_RR };

/** Pure: one average, structure-based target. Nearest mapped level (TP1, then TP2) inside the band wins; otherwise 1.5R, never past TP2's structure. */
export function averageTarget(plan: TpSlPlan): { x: number; rr: number; label: string } {
  const d = plan.side === "BUY" ? 1 : -1;
  for (const [lv, rr] of [[plan.tp1, plan.rr1], [plan.tp2, plan.rr2]] as const) {
    if (rr >= MIN_TARGET_RR && rr <= MAX_TARGET_RR) return { x: lv.x, rr, label: lv.label };
  }
  const k = Math.min(MAX_TARGET_RR, Math.max(MIN_TARGET_RR, Math.min(plan.rr2, DEFAULT_TARGET_RR)));
  return { x: plan.entry + d * k * plan.risk, rr: k, label: `${k}R (before ${plan.tp2.label})` };
}

export function withTpSl(sig: ProSignal, plan: TpSlPlan | undefined): ProSignal {
  if (!sig.ok || sig.side === "WAIT") return sig;
  const d = sig.side === "BUY" ? 1 : -1;
  if (sig.breakout) {
    // Breakouts: the level being broken is the obstacle a liquidity plan would stop short of, so keep the
    // strategy's breakout stop (behind the broken level / higher low) and its measured-move target, clamped to the band.
    const risk = Math.abs(sig.entry - sig.stopLoss);
    if (!(risk > 0)) return sig;
    const rr = ((sig.takeProfit - sig.entry) * d) / risk;
    const k = rr < MIN_TARGET_RR ? DEFAULT_TARGET_RR : Math.min(MAX_TARGET_RR, rr);
    return { ...sig, takeProfit: sig.entry + d * k * risk, reason: `${sig.reason} · Breakout TP/SL: SL behind the broken level, TP measured move (${Math.round(k * 100) / 100}R)` };
  }
  if (!plan || !plan.ok || plan.side !== sig.side) {
    // No usable market plan (e.g. stop too wide): keep the engine stop and keep its target inside the 1:1–1:1.8 band.
    const risk = Math.abs(sig.entry - sig.stopLoss);
    if (!(risk > 0)) return sig;
    const rr = ((sig.takeProfit - sig.entry) * d) / risk;
    if (rr >= MIN_TARGET_RR - 1e-9 && rr <= MAX_TARGET_RR + 1e-9) return sig;
    const k = rr < MIN_TARGET_RR ? MIN_TARGET_RR : MAX_TARGET_RR;
    return { ...sig, takeProfit: sig.entry + d * k * risk, reason: `${sig.reason} · TP set to ${k}R (target band 1:${MIN_TARGET_RR}–1:${MAX_TARGET_RR})` };
  }
  const t = averageTarget(plan);
  return { ...sig, stopLoss: plan.stop, takeProfit: t.x, reason: `${sig.reason} · TP/SL engine: SL ${plan.stopSource}; TP ${t.label} (${t.rr}R)` };
}

export type ProSignal =
  | { ok: true; side: Side; id: string; interval: Interval; entry: number; stopLoss: number; takeProfit: number; confidence: number; strategy: string; reason: string; confirmed?: boolean; mode?: "trend" | "range" | "transition"; breakout?: boolean; grade?: QualityGrade; momentum?: string }
  | { ok: true; side: "WAIT"; reason: string }
  | { ok: false; error: string };

const toSignal = (best: Signal, interval: Interval, early: boolean): ProSignal => ({
  ok: true, side: best.side, id: best.id, interval, entry: best.entry, stopLoss: best.stopLoss, takeProfit: best.takeProfit,
  confidence: best.confidence, strategy: best.strategyName, confirmed: !early, mode: bookMode(best.strategy), breakout: isBreakout(best.strategy),
  reason: `${interval} · ${best.strategyName}${early ? " (early setup)" : ""}: ${best.reason}`,
});

/** Direction comes from 5m + 15m with 15m leading; 1m only times entries. */
const TF_WEIGHT: Record<string, number> = { "1m": 1, "5m": 3, "15m": 4 };
const DIRECTION_FRAMES = new Set<Interval>(["5m", "15m"]);
/** Confidence bonus when the leading setups on 1m, 5m and 15m all point the same way. */
export const ALIGN_BONUS = 5;

/**
 * Pure: the 5m–1h setups vote the direction (confidence x timeframe weight, 15m heaviest). A confirmed best on the
 * chosen frame is used when it agrees with that direction; otherwise the strongest setup on the direction
 * side (confirmed first) is returned. Without any 5m–1h setup every frame votes. WAIT only with no setup.
 */
/** Pure: +ALIGN_BONUS confidence (max 95) when 1m, 5m and 15m all lead with a setup on the signal's side. */
function aligned(sig: ProSignal, frames: { interval: Interval; result: ScanResult }[]): ProSignal {
  if (!sig.ok || sig.side === "WAIT") return sig;
  const lead = (iv: Interval) => { const r = frames.find((f) => f.interval === iv)?.result; return (r?.best ?? r?.candidates[0])?.side; };
  if (!(["1m", "5m", "15m"] as Interval[]).every((iv) => lead(iv) === sig.side)) return sig;
  return { ...sig, confidence: Math.min(95, sig.confidence + ALIGN_BONUS), reason: `${sig.reason} · 1m, 5m and 15m aligned` };
}

export function proDecision(chosen: { interval: Interval; result: ScanResult } | undefined, frames: { interval: Interval; result: ScanResult }[] = chosen ? [chosen] : []): ProSignal {
  const all: { sig: Signal; interval: Interval; w: number }[] = [];
  for (const f of frames) {
    const seen = new Set<string>();
    for (const sig of [f.result.best, ...f.result.early, ...f.result.candidates]) {
      if (!sig || seen.has(sig.id) || (sig.side !== "BUY" && sig.side !== "SELL")) continue;
      seen.add(sig.id);
      all.push({ sig, interval: f.interval, w: TF_WEIGHT[f.interval] ?? 1 });
    }
  }
  const best = chosen?.result.best;
  if (all.length === 0) {
    if (chosen && best && best.stage === "confirmed") return toSignal(best, chosen.interval, false);
    return { ok: true, side: "WAIT", reason: chosen ? chosen.result.conflict ?? chosen.result.summary : "No timeframe has a setup yet" };
  }
  const voteOf = (list: typeof all) => {
    const v = { BUY: 0, SELL: 0 } as Record<string, number>;
    for (const a of list) v[a.sig.side] += a.sig.confidence * a.w;
    if (v.BUY === v.SELL) return list.length ? [...list].sort((a, b) => b.w - a.w || b.sig.confidence - a.sig.confidence)[0].sig.side : undefined;
    return v.BUY > v.SELL ? "BUY" : "SELL";
  };
  const side = voteOf(all.filter((a) => DIRECTION_FRAMES.has(a.interval))) ?? voteOf(all)!;
  if (chosen && best && best.stage === "confirmed" && best.side === side) return aligned(toSignal(best, chosen.interval, false), frames);
  const pick = all.filter((a) => a.sig.side === side)
    .sort((a, b) => Number(b.sig.stage === "confirmed") - Number(a.sig.stage === "confirmed") || b.sig.confidence - a.sig.confidence || b.w - a.w)[0];
  return aligned(toSignal(pick.sig, pick.interval, pick.sig.stage !== "confirmed"), frames);
}

type Feed = { ok: true; candles: Candle[]; spread?: number } | { ok: false; error: string };
export type CandlesFn = (a: { data: { symbol: string; interval: Interval; limit: number } }) => Promise<Feed>;

/** Scans with the admin's published setup (pass loadRobotProState()); never this phone's own history. */
export type RefereeFn = (symbol: string) => Promise<GeminiVerdict | null>;

/** Scans with the admin's published setup (pass loadRobotProState()); never this phone's own history. Optional Gemini referee checks direction. */
export async function scanProSignal(symbol: string, candlesFn: CandlesFn, now = Date.now(), pro: ProState = homeRobotState(null), referee?: RefereeFn): Promise<ProSignal> {
  let lastError = "Market data unavailable";
  const frames = (await Promise.all(SCAN_ORDER.map(async (interval) => {
    const feed = await candlesFn({ data: { symbol, interval, limit: 600 } }).catch((e: unknown): Feed => ({ ok: false, error: e instanceof Error ? e.message : lastError }));
    if (!feed.ok) { lastError = feed.error; return null; }
    const i = closedIndex(feed.candles, INTERVAL_MS[interval], now);
    const series = buildSeries(feed.candles);
    const key = perfKey(symbol, interval);
    const atrNow = series.atr[i];
    const change = readMarketChange(series, i, interval, { confirmBars: pro.engine.changeConfirmBars ?? 3, minHoldBars: pro.engine.changeMinHold ?? 5 });
    const result = runEngine(series, i, {
      change,
      symbol, interval, now, risk: pro.risk, perf: pro.perf[key] ?? {},
      settings: { ...pro.engine, params: { ...pro.engine.params, ...(pro.optimized[key] ?? {}) } },
      ctx: { spreadAtr: feed.spread !== undefined && atrNow > 0 ? feed.spread / atrNow : undefined },
    });
    const smc: FrameSmc = { interval, smc: readSmc(series, i), price: feed.candles[i].c, atr: atrNow, volatility: result.market.volatility };
    return { interval, result, smc, spread: feed.spread, momentum: readMomentum(series, i, interval) };
  }))).filter((f): f is { interval: Interval; result: ScanResult; smc: FrameSmc; spread: number | undefined; momentum: MomentumRead } => !!f);
  if (frames.length === 0) return { ok: false, error: lastError };
  const chosen = pickTimeframe(frames);
  const sig = proDecision(chosen, frames);
  if (!sig.ok) return sig;
  const plan = (side: Side, entry?: number) => { try { return planTpSl(side, frames.map((f) => f.smc), tpslFor(symbol, pro.tpsl, pro.tpslByMarket), entry); } catch { return undefined; } };
  const verdict = referee ? await referee(symbol).catch(() => null) : null;
  const act = refereeAction(sig.side, verdict);
  // The trading-app robot follows AutoTrader Pro: Gemini can only add confidence when it agrees, never turn a Pro signal into WAIT.
  if (sig.side === "WAIT") return sig;
  const out = act === "agree" && verdict ? { ...sig, confidence: Math.min(95, sig.confidence + 5), reason: `${sig.reason} · Gemini agrees: ${verdict.reason}` } : sig;
  return withMomentum(withTpSl(out, plan(out.side, out.entry)), frames.map((f) => f.momentum));
}

/** Pure: grade a signal by current momentum and next-shift risk (A+…C), adjusting confidence and explaining why. */
export function withMomentum(sig: ProSignal, reads: MomentumRead[]): ProSignal {
  if (!sig.ok || sig.side === "WAIT" || reads.length === 0) return sig;
  const q = momentumQuality(sig.side, reads);
  const momentum = reads.map((r) => r.text).join(" · ");
  const confidence = Math.max(5, Math.min(95, sig.confidence + q.delta));
  return { ...sig, confidence, grade: q.grade, momentum, reason: `${sig.reason} · Quality ${q.grade}${q.notes.length ? `: ${q.notes.join("; ")}` : ""}` };
}

/** Minimal chart-scanner signal shape shared by uploaded-chart and live scans. */
export type ChartSignal = {
  symbol: string; side: string; entry: number; stopLoss: number; takeProfit: number;
  confidence: string; confidencePct?: number; rationale: string; riskReward?: number;
  confluences?: string[]; warnings?: string[]; model?: string; timeframe?: string; grade?: string;
};

/** Pure: turn an AutoTrader Pro decision into a chart-scanner signal. */
export function proToChart(symbol: string, pro: Extract<ProSignal, { ok: true }>): ChartSignal & { timeframe: string } {
  if (pro.side === "WAIT") {
    return { symbol, side: "WAIT", entry: 0, stopLoss: 0, takeProfit: 0, confidence: "low", rationale: `AutoTrader Pro: ${pro.reason}`, model: "AutoTrader Pro", timeframe: "All frames · no setup", warnings: ["No setup on 1m–1h yet. Scan again shortly."], grade: "—" };
  }
  const risk = Math.abs(pro.entry - pro.stopLoss);
  return {
    symbol, side: pro.side, entry: pro.entry, stopLoss: pro.stopLoss, takeProfit: pro.takeProfit,
    confidence: pro.confidence >= 70 ? "high" : "low", confidencePct: Math.round(pro.confidence),
    rationale: `AutoTrader Pro ${pro.reason}`, riskReward: risk > 0 ? Math.round((Math.abs(pro.takeProfit - pro.entry) / risk) * 100) / 100 : undefined,
    confluences: [`AutoTrader Pro · ${pro.strategy}`, `Timeframe ${pro.interval}`], model: "AutoTrader Pro",
    timeframe: `AutoTrader Pro ${pro.interval}`, warnings: ["Profits are not guaranteed."], grade: pro.confidence >= 70 ? "A" : "B",
  };
}

/**
 * Pure: give an uploaded-chart reading the AutoTrader Pro mentality. When Pro has a live setup on
 * the same symbol its direction and market-based stop/target win (agreement raises confidence,
 * disagreement is flagged); without a Pro setup the chart reading stands, marked unconfirmed.
 */
export function chartWithPro<T extends ChartSignal>(chart: T, pro: ProSignal): T {
  if (!pro.ok || pro.side === "WAIT") {
    const why = pro.ok ? pro.reason : pro.error;
    return { ...chart, warnings: [...(chart.warnings ?? []), `AutoTrader Pro has no live setup (${why.slice(0, 120)}) — chart reading only.`] };
  }
  const p = proToChart(chart.symbol, pro);
  const agrees = chart.side === pro.side;
  const pct = Math.min(95, Math.round(pro.confidence + (agrees ? 10 : 0)));
  return {
    ...chart, side: p.side, entry: p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit, riskReward: p.riskReward,
    confidencePct: pct, confidence: pct >= 70 ? "high" : "low", model: "Chart + AutoTrader Pro",
    rationale: `${agrees ? "Chart and AutoTrader Pro agree." : `Chart read ${chart.side}, AutoTrader Pro's live scan says ${pro.side} — following Pro.`} ${p.rationale}`,
    confluences: [...(p.confluences ?? []), ...(chart.confluences ?? [])],
    warnings: [...(agrees ? [] : ["Chart reading disagreed with the live market scan."]), ...(chart.warnings ?? [])],
  };
}
