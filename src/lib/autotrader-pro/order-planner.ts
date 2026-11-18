/**
 * Smart order planner (pure). Decides BUY/SELL MARKET, BUY/SELL STOP, BUY/SELL LIMIT, WAIT or REJECT for one setup,
 * sizes buffers per instrument, rounds to tick size, validates broker pending-order rules, builds TP1–TP4, lot size,
 * setup score, de-duplication keys, cancellation reasons and automation permissions. No I/O, no guessing.
 */
import type { Candidate, Side, Signal } from "./types";
import { marketClass, type MarketClass } from "./tpsl";

export type OrderType = "BUY_MARKET" | "SELL_MARKET" | "BUY_STOP" | "SELL_STOP" | "BUY_LIMIT" | "SELL_LIMIT";
export type Decision = OrderType | "WAIT" | "REJECT";
export const ORDER_LABEL: Record<Decision, string> = {
  BUY_MARKET: "BUY MARKET", SELL_MARKET: "SELL MARKET", BUY_STOP: "BUY STOP", SELL_STOP: "SELL STOP",
  BUY_LIMIT: "BUY LIMIT", SELL_LIMIT: "SELL LIMIT", WAIT: "NO TRADE — WAITING FOR CONFIRMATION", REJECT: "REJECTED",
};
export const isPending = (d: Decision): d is "BUY_STOP" | "SELL_STOP" | "BUY_LIMIT" | "SELL_LIMIT" => /_(STOP|LIMIT)$/.test(d);
export const sideOfOrder = (d: OrderType): Side => (d.startsWith("BUY") ? "BUY" : "SELL");

export interface InstrumentSpec {
  tick: number; digits: number;
  /** Broker minimum distance (stops level) and freeze level, in ticks. */
  minStopTicks: number; freezeTicks: number;
  contract: number; lotStep: number; minLot: number; maxLot: number;
  /** "broker" when read from the connected account, "default" when using built-in class defaults. */
  source: "broker" | "default";
}

const CLASS_SPEC: Record<MarketClass, Omit<InstrumentSpec, "source">> = {
  xau: { tick: 0.01, digits: 2, minStopTicks: 50, freezeTicks: 0, contract: 100, lotStep: 0.01, minLot: 0.01, maxLot: 100 },
  forex: { tick: 0.00001, digits: 5, minStopTicks: 20, freezeTicks: 0, contract: 100000, lotStep: 0.01, minLot: 0.01, maxLot: 100 },
  indices: { tick: 0.1, digits: 1, minStopTicks: 20, freezeTicks: 0, contract: 1, lotStep: 0.01, minLot: 0.01, maxLot: 100 },
  crypto: { tick: 0.01, digits: 2, minStopTicks: 100, freezeTicks: 0, contract: 1, lotStep: 0.01, minLot: 0.01, maxLot: 100 },
};

/** Six-letter currency pairs are forex even when the shared classifier matches an index pattern (USDJPY contains "DJ"). */
const FX = /^(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)/i;
const classOf = (symbol: string): MarketClass => (FX.test(symbol.replace(/[^A-Za-z]/g, "")) ? "forex" : marketClass(symbol));

export function specFor(symbol: string, broker?: Partial<InstrumentSpec>): InstrumentSpec {
  const cls = classOf(symbol);
  const base = { ...CLASS_SPEC[cls] };
  if (cls === "forex" && /JPY/i.test(symbol)) { base.tick = 0.001; base.digits = 3; }
  const merged = { ...base, ...(broker ?? {}), source: broker && broker.tick ? "broker" as const : "default" as const };
  if (broker?.tick && broker.digits == null) merged.digits = Math.max(0, Math.round(-Math.log10(broker.tick)));
  return merged;
}

/** Round to the instrument's tick (nearest, or always up/down so a buffer is never lost to rounding). */
export function roundToTick(x: number, spec: Pick<InstrumentSpec, "tick" | "digits">, mode: "nearest" | "up" | "down" = "nearest"): number {
  const n = x / spec.tick;
  const k = mode === "up" ? Math.ceil(n - 1e-9) : mode === "down" ? Math.floor(n + 1e-9) : Math.round(n);
  return +(k * spec.tick).toFixed(spec.digits);
}
export const onTick = (x: number, spec: Pick<InstrumentSpec, "tick" | "digits">) => Math.abs(roundToTick(x, spec) - x) < spec.tick / 1000;

/** Share of ATR used as breakout buffer per market class — gold and crypto need more room than majors. */
const BUFFER_ATR: Record<MarketClass, number> = { forex: 0.05, xau: 0.08, indices: 0.07, crypto: 0.1 };
/** Dynamic entry buffer: the largest of spread, a class share of ATR and two ticks. */
export function entryBuffer(symbol: string, spec: InstrumentSpec, spread: number, atr: number): number {
  return Math.max(spread, BUFFER_ATR[classOf(symbol)] * (atr > 0 ? atr : 0), spec.tick * 2);
}

export interface Quote { bid: number; ask: number; at: number }
export type DataStatus = "live" | "delayed" | "unavailable";
/** Live within 2 scan intervals, delayed up to 6, otherwise unavailable — stale data is never analysed as live. */
export function dataStatus(at: number | undefined, now: number, intervalMs: number): DataStatus {
  if (!at || !Number.isFinite(at)) return "unavailable";
  const age = now - at;
  return age <= 2 * intervalMs ? "live" : age <= 6 * intervalMs ? "delayed" : "unavailable";
}

export type SetupKind = "trigger" | "breakout" | "pullback";
export interface Thesis {
  side: Side; kind: SetupKind;
  /** Breakout: the level to break. Pullback: the zone edge nearest price. Trigger: entry reference. */
  level: number;
  zone: [number, number];
  confirmed: boolean;
  invalidation: number;
  expiresAt: number;
}

export interface OrderChoice { decision: Decision; entry?: number; reason: string }

/**
 * Chooses the order type from where the executable price sits relative to the thesis.
 * BUY uses the ask, SELL uses the bid. Unconfirmed theses WAIT; expired or invalidated theses are REJECTED.
 */
export function chooseOrderType(t: Thesis, q: Quote, symbol: string, spec: InstrumentSpec, atr: number, now: number): OrderChoice {
  if (!(q.bid > 0) || !(q.ask >= q.bid)) return { decision: "REJECT", reason: "No valid bid/ask — cannot price an order" };
  if (now > t.expiresAt) return { decision: "REJECT", reason: "Setup expired" };
  const buy = t.side === "BUY";
  const px = buy ? q.ask : q.bid;
  if (buy ? q.bid <= t.invalidation : q.ask >= t.invalidation) return { decision: "REJECT", reason: `Price already through invalidation ${t.invalidation}` };
  if (!t.confirmed) return { decision: "WAIT", reason: "Confirmation still missing" };
  const buf = entryBuffer(symbol, spec, q.ask - q.bid, atr);
  const lo = Math.min(...t.zone), hi = Math.max(...t.zone);
  if (t.kind === "breakout") {
    const entry = roundToTick(buy ? t.level + buf : t.level - buf, spec, buy ? "up" : "down");
    if (buy ? px < entry : px > entry) return { decision: buy ? "BUY_STOP" : "SELL_STOP", entry, reason: `${buy ? "Above resistance" : "Below support"} ${t.level} + buffer ${+buf.toFixed(spec.digits)}` };
    if (Math.abs(px - entry) <= buf) return { decision: buy ? "BUY_MARKET" : "SELL_MARKET", entry: px, reason: "Breakout triggered and price still near the level" };
    return { decision: "WAIT", reason: "Breakout already ran — waiting for a retest instead of chasing" };
  }
  if (t.kind === "pullback") {
    const edge = roundToTick(buy ? hi : lo, spec, buy ? "down" : "up");
    if (buy ? px > edge : px < edge) return { decision: buy ? "BUY_LIMIT" : "SELL_LIMIT", entry: edge, reason: `Waiting for a retrace into the ${buy ? "demand" : "supply"} zone ${lo}–${hi}` };
    if (px >= lo && px <= hi) return { decision: buy ? "BUY_MARKET" : "SELL_MARKET", entry: px, reason: "Price is inside the entry zone" };
    return { decision: "WAIT", reason: "Price left the zone on the far side — waiting for a reclaim" };
  }
  // Trigger already fired: market only while the executable side is inside the permitted zone, else a limit back to it.
  if (px >= lo - buf && px <= hi + buf) return { decision: buy ? "BUY_MARKET" : "SELL_MARKET", entry: px, reason: "Entry trigger confirmed inside the zone" };
  if (buy ? px > hi : px < lo) {
    const edge = roundToTick(buy ? hi : lo, spec, buy ? "down" : "up");
    return { decision: buy ? "BUY_LIMIT" : "SELL_LIMIT", entry: edge, reason: "Price ran past the zone — limit order back at the zone edge" };
  }
  return { decision: "WAIT", reason: "Price is on the wrong side of the entry zone" };
}

/** Broker rules: correct side of market, minimum distance, stop/target distance, tick precision. Empty = valid. */
export function validateOrder(type: OrderType, entry: number, sl: number, tps: number[], q: Quote, spec: InstrumentSpec): string[] {
  const errs: string[] = [];
  const min = spec.minStopTicks * spec.tick;
  const buy = type.startsWith("BUY");
  if (!onTick(entry, spec)) errs.push("Entry is not on the instrument tick size");
  if (type === "BUY_STOP" && !(entry >= q.ask + min)) errs.push(`BUY STOP must be at least ${min} above ask ${q.ask}`);
  if (type === "BUY_LIMIT" && !(entry <= q.ask - min)) errs.push(`BUY LIMIT must be at least ${min} below ask ${q.ask}`);
  if (type === "SELL_STOP" && !(entry <= q.bid - min)) errs.push(`SELL STOP must be at least ${min} below bid ${q.bid}`);
  if (type === "SELL_LIMIT" && !(entry >= q.bid + min)) errs.push(`SELL LIMIT must be at least ${min} above bid ${q.bid}`);
  if (buy ? !(sl < entry - min + 1e-12) : !(sl > entry + min - 1e-12)) errs.push("Stop loss on the wrong side or too close to entry");
  tps.forEach((tp, i) => { if (buy ? !(tp > entry + min - 1e-12) : !(tp < entry - min + 1e-12)) errs.push(`TP${i + 1} on the wrong side or too close to entry`); });
  if (![sl, ...tps].every((x) => onTick(x, spec))) errs.push("Stop or target is not on the tick size");
  return errs;
}

/** Inside the freeze level a pending order cannot be modified or cancelled. */
export const frozen = (type: OrderType, entry: number, q: Quote, spec: InstrumentSpec) =>
  spec.freezeTicks > 0 && Math.abs(entry - (type.startsWith("BUY") ? q.ask : q.bid)) <= spec.freezeTicks * spec.tick;

/** TP1–TP4: TPk is the first liquidity/structure level between kR and (k+1)R after costs (pulled a tick in front), else exactly kR; rounded to tick. */
export function buildTargets(side: Side, entry: number, stop: number, levels: number[], spec: InstrumentSpec, cost = 0): [number, number, number, number] {
  const r = Math.abs(entry - stop);
  const dir = side === "BUY" ? 1 : -1;
  const beyond = levels.filter((x) => Number.isFinite(x) && (x - entry) * dir > 0).sort((a, b) => (a - b) * dir);
  const out: number[] = [];
  for (let k = 1; k <= 4; k++) {
    const floor = entry + dir * (k * r + cost);
    const prev = out[k - 2] ?? entry;
    const lvl = beyond.find((x) => (x - floor) * dir >= 0 && (x - (floor + dir * r)) * dir < 0 && (x - prev) * dir > 0);
    // Pull a liquidity target a tick in front of the level; otherwise use the R multiple.
    const raw = lvl !== undefined ? lvl - dir * spec.tick : floor;
    out.push(roundToTick(raw, spec, side === "BUY" ? "down" : "up"));
  }
  return out as [number, number, number, number];
}

/** Lot size from account equity × risk % over the stop distance, floored to the broker lot step. */
export function lotSize(equity: number, riskPct: number, entry: number, stop: number, spec: InstrumentSpec): { lots: number; risk: number; note?: string } {
  const dist = Math.abs(entry - stop);
  if (!(equity > 0) || !(riskPct > 0) || !(dist > 0)) return { lots: 0, risk: 0, note: "Account equity, risk % or stop missing" };
  const raw = (equity * riskPct / 100) / (dist * spec.contract);
  const lots = Math.min(spec.maxLot, Math.floor(raw / spec.lotStep + 1e-9) * spec.lotStep);
  if (lots < spec.minLot) return { lots: 0, risk: 0, note: `Risk too small for the minimum lot ${spec.minLot}` };
  return { lots: +lots.toFixed(2), risk: +(lots * dist * spec.contract).toFixed(2) };
}

export interface ScoreInput {
  htf: number; structure: number; liquidity: number; zone: number; momentum: number; volatility: number;
  session: number; agreement: number; spread: number; news: number; history?: number;
}
/**
 * Setup-quality score 0–100 (not a win probability). Trend-measuring inputs (HTF, structure, momentum, agreement)
 * are one evidence group: the group scores its strongest read plus a small share of the rest, so stacking
 * indicators that measure the same thing cannot inflate the score.
 */
export function scoreSetup(f: ScoreInput): number {
  const c = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
  const trend = [f.htf, f.structure, f.momentum, f.agreement].map(c);
  const trendGroup = 0.75 * Math.max(...trend) + 0.25 * (trend.reduce((a, b) => a + b, 0) / trend.length);
  const parts: [number, number][] = [
    [trendGroup, 30], [c(f.liquidity), 15], [c(f.zone), 15], [c(f.volatility), 8], [c(f.session), 7],
    [c(f.spread), 8], [c(f.news), 7], [c(f.history ?? 0.5), 10],
  ];
  return Math.round(parts.reduce((s, [v, w]) => s + v * w, 0));
}
export function scoreClass(score: number): string {
  return score >= 90 ? "Exceptional confluence" : score >= 80 ? "Strong setup" : score >= 70 ? "Qualified setup" : score >= 60 ? "Developing setup" : "Reject or monitor";
}

/** Same setup → same key, so a still-active setup is never signalled twice. */
export const setupKey = (symbol: string, side: Side, type: Decision, strategy: string, tf: string, entry: number | undefined, spec: InstrumentSpec) =>
  [symbol.toUpperCase(), side, type, strategy, tf, entry === undefined ? "-" : roundToTick(entry, spec)].join("|");
let seq = 0;
export const signalId = (key: string, now: number) => `AV-${now.toString(36).toUpperCase()}-${(++seq).toString(36).toUpperCase()}-${Math.abs([...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36).toUpperCase()}`;

export type OrderStatus = "not_submitted" | "submitted" | "pending" | "filled" | "cancelled" | "expired" | "rejected";
export interface PlannedOrder {
  id: string; key: string; symbol: string; side: Side; type: OrderType; entry: number; sl: number; tps: [number, number, number, number];
  lots: number; expiresAt: number; invalidation: number; strategy: string; timeframe: string; regime: string; reason: string;
  status: OrderStatus; brokerId?: string; paper: boolean; createdAt: number;
  history: { at: number; event: string; note?: string }[];
}

export interface WatchContext { quote?: Quote; now: number; regimeAtPlan: string; regimeNow?: string; riskOk: boolean; spreadLimit: number; newsBlackout: boolean; connected: boolean }
/**
 * Reasons a pending order must be cancelled. An adverse move that has not reached the invalidation price is NOT a reason.
 */
export function cancelReasons(o: Pick<PlannedOrder, "side" | "invalidation" | "expiresAt" | "status">, w: WatchContext): string[] {
  if (o.status !== "pending" && o.status !== "submitted") return [];
  const r: string[] = [];
  if (w.now > o.expiresAt) r.push("Signal expired");
  if (w.quote && (o.side === "BUY" ? w.quote.bid <= o.invalidation : w.quote.ask >= o.invalidation)) r.push(`Thesis invalidated — price crossed ${o.invalidation}`);
  if (w.regimeNow && w.regimeNow !== w.regimeAtPlan && /range|chop|volatile|news/i.test(w.regimeNow)) r.push(`Market regime changed to ${w.regimeNow}`);
  if (!w.riskOk) r.push("Risk limits breached");
  if (w.quote && w.spreadLimit > 0 && w.quote.ask - w.quote.bid > w.spreadLimit) r.push("Spread above the configured limit");
  if (w.newsBlackout) r.push("High-impact news restriction active");
  if (!w.connected) r.push("Broker connection lost — order safety cannot be verified");
  return r;
}

/** Paper fill on one candle: stops fill when the bar trades through entry, limits when it trades back to entry. */
export function paperFill(type: OrderType, entry: number, bar: { h: number; l: number }): boolean {
  return type === "BUY_STOP" || type === "SELL_LIMIT" ? bar.h >= entry : type === "SELL_STOP" || type === "BUY_LIMIT" ? bar.l <= entry : true;
}

export type AutomationMode = "scan" | "signal" | "assist" | "pending" | "full";
export const AUTOMATION_MODES: { id: AutomationMode; label: string; hint: string }[] = [
  { id: "scan", label: "Scan only", hint: "Analyse markets, no orders" },
  { id: "signal", label: "Signal only", hint: "Publish qualified signals" },
  { id: "assist", label: "Manual assist", hint: "Plan the order, you submit it" },
  { id: "pending", label: "Auto pending", hint: "Auto-place approved STOP/LIMIT orders" },
  { id: "full", label: "Full auto", hint: "Market + pending with management" },
];
/** Whether this mode may submit this order type automatically. Live accounts additionally need an explicit authorisation. */
export function mayAutoSubmit(mode: AutomationMode, type: OrderType, live: boolean, liveAuthorized: boolean, score: number, minScore: number): { ok: boolean; reason?: string } {
  if (mode === "scan" || mode === "signal" || mode === "assist") return { ok: false, reason: "This mode never submits orders automatically" };
  if (mode === "pending" && !isPending(type)) return { ok: false, reason: "Auto-pending mode does not send market orders" };
  if (live && !liveAuthorized) return { ok: false, reason: "Live trading is not authorised" };
  if (score < minScore) return { ok: false, reason: `Score ${score} below the ${minScore} minimum` };
  return { ok: true };
}

/** Builds the thesis from an engine signal: breakout strategies anticipate with stops, zone strategies retrace with limits. */
export function thesisFrom(sig: Pick<Signal, "side" | "stage" | "entry" | "entryZone" | "structuralStop" | "expiresAt" | "strategy"> & Partial<Pick<Candidate, "structuralTarget">>, kind: SetupKind): Thesis {
  return {
    side: sig.side, kind, level: sig.entry, zone: sig.entryZone, confirmed: sig.stage === "confirmed" || kind !== "trigger",
    invalidation: sig.structuralStop, expiresAt: sig.expiresAt,
  };
}
export function kindForStrategy(strategy: string): SetupKind {
  if (/break|squeeze|expan|momentum|orb|donchian/i.test(strategy)) return "breakout";
  if (/pullback|retest|ob|fvg|order|zone|vwap|fib|mean|support|demand|supply|reversion/i.test(strategy)) return "pullback";
  return "trigger";
}
