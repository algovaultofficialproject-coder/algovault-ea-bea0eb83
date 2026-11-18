import type { Series } from "./indicators";
import { classifyMarket, REGIME_LABEL } from "./regime";
import { planLevels, type RiskSettings } from "./risk";
import { targetPlan, turningPoints } from "./targets";
import { bandTarget, MAX_TARGET_RR, MIN_TARGET_RR } from "./target-band";
import { candleCheck, readCandles } from "./candles";
import { SCAN_BOOK } from "./strategy-policy";
import { STRATEGIES, type Params, type StrategyContext, type StrategyDef } from "./strategies";
import type { MtfMode } from "./mtf";
import { TREND_FOLLOWERS, type Adaptation, type ChangeRead } from "./market-change";
import type { Candle, Candidate, Interval, MarketRead, Side, Signal, StrategyId } from "./types";

export const INTERVAL_MS: Record<Interval, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000 };

/** Closed-bar index: the last candle is still forming until its interval has elapsed. */
export function closedIndex(candles: Candle[], intervalMs: number, now: number) {
  let i = candles.length - 1;
  while (i > 0 && candles[i].t + intervalMs > now) i--;
  return i;
}

export interface EngineSettings {
  enabled: Record<StrategyId, boolean>;
  /** Optimised parameter overrides per strategy. */
  params: Partial<Record<StrategyId, Params>>;
  /** Only strategies suited to the detected market can produce actionable signals. */
  autoSelect: boolean;
  /** Minimum score for an early signal to be shown as a signal (lower ones go to the watchlist). */
  earlyThreshold: number;
  /** Minimum score for a confirmed, actionable signal. */
  confirmedThreshold: number;
  sessions: { asia: boolean; london: boolean; newYork: boolean };
  disableUnderperformers: boolean;
  /** How many top-down confluence steps each multi-timeframe tier needs. */
  mtfMode: MtfMode;
  /** Which multi-timeframe signal grades raise a device alert (all grades are always written to the Trade Log). */
  mtfAlerts?: Record<"early" | "confirmed" | "high", boolean>;
  /** V3 adaptive strategy switching from the market-change engine. */
  adaptive?: boolean;
  /** Hysteresis: closed bars a new regime must repeat before switching, and minimum bars to hold the current one. */
  changeConfirmBars?: number;
  changeMinHold?: number;
}

export const DEFAULT_ENGINE: EngineSettings = {
  enabled: Object.fromEntries(STRATEGIES.map((d) => [d.id, true])) as Record<StrategyId, boolean>,
  params: {}, autoSelect: true, earlyThreshold: 40, confirmedThreshold: 55,
  sessions: { asia: true, london: true, newYork: true }, disableUnderperformers: true, mtfMode: "balanced",
  mtfAlerts: { early: false, confirmed: true, high: true },
  adaptive: true, changeConfirmBars: 3, changeMinHold: 5,
};

/** Measured performance of one strategy (from backtests or paper/live trades). */
export interface StrategyPerf { trades: number; winRate: number; expectancyR: number; profitFactor: number; underperforming: boolean }

export interface ScanResult {
  market: MarketRead;
  active: StrategyId[];
  inactive: { id: StrategyId; why: string }[];
  candidates: Signal[];
  best?: Signal;
  early: Signal[];
  watchlist: Signal[];
  blockers: { strategy: StrategyId; text: string }[];
  conflict?: string;
  summary: string;
  /** V3 market-change read for this chart (when supplied by the caller). */
  change?: ChangeRead;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const MIN_PERF_TRADES = 15;

/** UTC session windows used by the trading session filter. */
export function sessionOpen(s: EngineSettings["sessions"], now: number) {
  const h = new Date(now).getUTCHours();
  const open = (s.asia && (h >= 23 || h < 8)) || (s.london && h >= 7 && h < 16) || (s.newYork && h >= 12 && h < 21);
  return { ok: open, note: open ? undefined : "Outside the configured trading sessions (Asia 23–08, London 07–16, New York 12–21 UTC)" };
}

/** Composite score 0–100. Explicitly not a probability of winning. */
export function scoreCandidate(c: Candidate, def: StrategyDef, m: MarketRead, perf?: StrategyPerf) {
  const total = c.confirmations.length + c.missing.length;
  let score = 30 + 50 * (total ? c.confirmations.length / total : 0) + Math.min(10, c.confirmations.length * 2);
  if (def.suited.includes(m.regime)) score += 8; else if (def.suited.some((r) => m.tags.includes(r))) score += 4; else score -= 8;
  const counter = (c.side === "BUY" && m.trend === "bearish") || (c.side === "SELL" && m.trend === "bullish");
  if (counter && !def.reversal) score -= 15;
  if (m.volatility === "extreme") score -= 8;
  if (perf && perf.trades >= MIN_PERF_TRADES) {
    const perfScore = clamp(50 + perf.expectancyR * 40 + (Math.min(perf.profitFactor, 3) - 1) * 10, 10, 90);
    score = score * 0.65 + perfScore * 0.35;
  }
  return Math.round(clamp(score, 1, 99));
}

const strengthOf = (n: number): Signal["strength"] => (n >= 80 ? 5 : n >= 68 ? 4 : n >= 55 ? 3 : n >= 42 ? 2 : 1);

export interface EngineInput {
  symbol: string;
  interval: Interval;
  settings: EngineSettings;
  risk: RiskSettings;
  perf?: Partial<Record<StrategyId, StrategyPerf>>;
  ctx: Omit<StrategyContext, "sessionOk" | "sessionNote" | "maxSpreadAtr">;
  now: number;
  /** Market-change read; its adaptation re-weights strategies when settings.adaptive is on. */
  change?: ChangeRead;
}

/** Adaptive switching: preferred strategies gain score, choppy/ranging markets demote trend-followers. */
export function adaptScore(score: number, id: StrategyId, side: Side, reversal: boolean, ad?: Adaptation): { score: number; missing: string[]; notes: string[] } {
  if (!ad) return { score, missing: [], notes: [] };
  const missing: string[] = [], notes: string[] = [];
  let out = score;
  if (ad.preferred.includes(id)) { out += 6; notes.push(`Adaptive: preferred in ${ad.note.split(" → ")[0].toLowerCase()}`); }
  if (ad.demoteTrend && TREND_FOLLOWERS.includes(id)) { out -= 10; if (ad.group === "choppy") missing.push("Choppy market — trend-following demoted"); }
  if (ad.avoidSide === side && !reversal) missing.push(`Choppy: the last ${side === "BUY" ? "upside" : "downside"} breakout failed — avoid repeating that direction`);
  return { score: Math.round(clamp(out, 1, 99)), missing, notes };
}

/** Runs every strategy on bar i (closed bars only), selects suited ones, scores and resolves conflicts. */
export function runEngine(s: Series, i: number, input: EngineInput): ScanResult {
  const market = classifyMarket(s, i);
  const { settings, risk, perf = {} } = input;
  const sess = sessionOpen(settings.sessions, input.now);
  const ctx: StrategyContext = { ...input.ctx, sessionOk: sess.ok, sessionNote: sess.note, maxSpreadAtr: risk.maxSpreadAtr };
  const active: StrategyId[] = [];
  const inactive: ScanResult["inactive"] = [];
  const blockers: ScanResult["blockers"] = [];
  const all: Signal[] = [];
  const bar = s.candles[i];
  const candleRead = readCandles(s, i);
  // Top-down book order (context → breakout → continuation → reversal); stable sorting keeps that order on equal scores.
  for (const def of SCAN_BOOK) {
    if (settings.enabled[def.id] === false) { inactive.push({ id: def.id, why: "Switched off in settings" }); continue; }
    if (def.frames && !def.frames.includes(input.interval)) { inactive.push({ id: def.id, why: `Runs on ${def.frames.join("/")} only` }); continue; }
    const p = perf[def.id];
    const under = settings.disableUnderperformers && p && p.trades >= MIN_PERF_TRADES && p.underperforming;
    const suited = def.suited.some((r) => market.tags.includes(r));
    const isActive = !under && (!settings.autoSelect || suited);
    if (isActive) active.push(def.id);
    else inactive.push({ id: def.id, why: under ? "Underperforming in measured results" : `Not designed for ${REGIME_LABEL[market.regime].toLowerCase()}` });
    const out = def.evaluate(s, i, { ...def.defaults, ...(settings.params[def.id] ?? {}) }, market, ctx);
    for (const b of out.blockers) blockers.push({ strategy: def.id, text: b });
    if (!out.candidate) continue;
    const c = out.candidate;
    const lv = planLevels(c.side, c.entry, c.structuralStop, market.atr, market.volatility, risk, c.structuralTarget, turningPoints(s, i, c.side), targetPlan(s, i, c.side, market));
    const missing = [...c.missing];
    const extra: string[] = [];
    if (c.strategy !== "candles") {
      const ck = candleCheck(candleRead, c.side === "BUY" ? 1 : -1);
      if (ck.confirm) extra.push(ck.confirm);
      if (ck.missing) missing.push(ck.missing);
    }
    if (lv.tight) missing.push(lv.tight);
    if (!isActive) missing.push(under ? "Strategy is underperforming — watch only" : "Strategy not suited to the current market — watch only");
    const counter = (c.side === "BUY" && market.trend === "bearish") || (c.side === "SELL" && market.trend === "bullish");
    if (counter && !def.reversal && !missing.some((x) => x.startsWith("Trend is"))) missing.push(`Counter-trend (${market.trend}) — needs a reversal strategy to confirm`);
    const ad = settings.adaptive !== false ? input.change?.adaptation : undefined;
    const adPre = adaptScore(0, def.id, c.side, def.reversal, ad);
    missing.push(...adPre.missing);
    const cand: Candidate = { ...c, confirmations: [...c.confirmations, ...extra, ...adPre.notes], missing, stage: missing.length ? "early" : "confirmed" };
    const confidence = adaptScore(scoreCandidate(cand, def, market, p), def.id, c.side, def.reversal, ad).score;
    all.push({
      ...cand, id: `${input.symbol}:${def.id}:${c.side}:${bar.t}`, symbol: input.symbol, interval: input.interval,
      stopLoss: lv.stopLoss, takeProfit: bandTarget(c.side, c.entry, lv.stopLoss, lv.takeProfit), rr: Math.min(MAX_TARGET_RR, Math.max(MIN_TARGET_RR, lv.rr)), confidence, strength: strengthOf(confidence),
      market, timestamp: input.now, expiresAt: bar.t + INTERVAL_MS[input.interval] * (c.validBars + 1), strategyName: `${def.letter} · ${def.name}`,
      confirmations: [...cand.confirmations, ...lv.notes.map((n) => `Risk: ${n}`)],
    });
  }
  all.sort((a, b) => b.confidence - a.confidence);

  // Conflict resolution: when both sides have confirmed signals, the stronger side must lead clearly
  // and counter-trend non-reversal signals are demoted; reversal strategies may only lead when confirmed.
  let conflict: string | undefined;
  const confirmed = all.filter((x) => x.stage === "confirmed" && x.confidence >= settings.confirmedThreshold);
  const bestOf = (side: Side) => confirmed.find((x) => x.side === side);
  const b = bestOf("BUY"), se = bestOf("SELL");
  let best: Signal | undefined = confirmed[0];
  if (b && se) {
    const gap = Math.abs(b.confidence - se.confidence);
    const support = (side: Side) => all.filter((x) => x.side === side && x.confidence >= settings.earlyThreshold).length;
    if (gap < 10 && support("BUY") === support("SELL")) {
      conflict = `Conflicting confirmed signals (${b.strategyName} BUY ${b.confidence} vs ${se.strategyName} SELL ${se.confidence}) — no trade until one side leads`;
      best = undefined;
    } else {
      const lead = gap >= 10 ? (b.confidence > se.confidence ? b : se) : support("BUY") > support("SELL") ? b : se;
      conflict = `Resolved conflict: ${lead.side} leads (${lead.strategyName} ${lead.confidence}, ${support(lead.side)} supporting setups)`;
      best = lead;
    }
  }
  const early = all.filter((x) => x !== best && x.confidence >= settings.earlyThreshold);
  const watchlist = all.filter((x) => x !== best && !early.includes(x));
  const label = REGIME_LABEL[market.regime];
  const top = best ?? all[0];
  const summary = best
    ? `${best.stage === "confirmed" ? "Confirmed" : "Early"} ${best.side} from ${best.strategyName} (score ${best.confidence}) in a ${label.toLowerCase()} market.`
    : top
      ? `Best available setup: ${top.stage} ${top.side} from ${top.strategyName} (score ${top.confidence}). Waiting on: ${top.missing.slice(0, 2).join("; ") || "score threshold"}.`
      : `${label}: no strategy has a setup on this bar. ${blockers[0]?.text ?? ""}`.trim();
  return { market, active, inactive, candidates: all, best, early, watchlist, blockers, conflict, summary, change: input.change };
}
