/**
 * Advanced TP/SL engine (pure, closed bars only, no look-ahead).
 * Stops sit beyond multi-timeframe structure plus a volatility-scaled ATR buffer; three targets come
 * from real liquidity (swing highs/lows, equal highs/lows, opposing order blocks / FVGs, 30M–1H pools)
 * and are never pushed past major opposing structure just to hit a fixed reward-to-risk.
 */
import type { FrameSmc } from "./mtf";
import { readSmc, type SmcRead } from "./smc";
import { contractSizeFor, type RiskSettings } from "./risk";
import type { Series } from "./indicators";
import type { Candle, Interval, Side, VolatilityClass } from "./types";

export type TrailMethod = "atr" | "structure" | "profit_lock";
export type MarketClass = "xau" | "forex" | "indices" | "crypto";
export interface TpSlSettings {
  /** Minimum stop distance in ATR per volatility class. */
  atrMult: Record<VolatilityClass, number>;
  rejectExtreme: boolean;
  /** Reject the entry when the protective stop would need more than this many ATR. */
  maxStopAtr: number;
  /** Extra buffer beyond the structural level, in ATR. */
  bufferAtr: number;
  /** Minimum reward-to-risk at TP2 (main target) for a confirmed signal. */
  minMainRR: number;
  tp1ClosePct: number;
  tp2ClosePct: number;
  breakEvenAfterTp1: boolean;
  trail: "auto" | TrailMethod;
  trailAtrMult: number;
  /** Trailing starts once price has moved this many R in favour. */
  trailActivateR: number;
  /** Profit-lock trail keeps this share of the best open gain. */
  profitLockPct: number;
}
export const DEFAULT_TPSL: TpSlSettings = {
  atrMult: { low: 1.2, normal: 1.5, high: 2, extreme: 2.5 }, rejectExtreme: false, maxStopAtr: 4, bufferAtr: 0.2,
  minMainRR: 2, tp1ClosePct: 40, tp2ClosePct: 30, breakEvenAfterTp1: true, trail: "auto", trailAtrMult: 1.5, trailActivateR: 1, profitLockPct: 50,
};
export const TRAIL_LABEL: Record<TrailMethod, string> = { atr: "ATR trailing", structure: "Structure trailing", profit_lock: "Profit-lock trailing" };

export function marketClass(symbol: string): MarketClass {
  const s = symbol.toUpperCase();
  if (/XAU|GOLD/.test(s)) return "xau";
  if (/BTC|ETH|SOL|XRP|DOGE|ADA|BNB|LTC|AVAX|DOT|LINK|USDT|USDC/.test(s)) return "crypto";
  if (/US30|US100|US500|NAS|NDX|SPX|SP500|DJ|DOW|GER|DAX|DE40|UK100|FTSE|JP225|NIKKEI|USTEC|HK50|AUS200|FRA40|STOXX/.test(s)) return "indices";
  return "forex";
}
export const MARKET_LABEL: Record<MarketClass, string> = { xau: "XAUUSD (gold)", forex: "Forex pairs", indices: "Indices", crypto: "Crypto" };
/** Round-trip cost assumptions as a share of ATR (spread is paid once, slippage on entry and exit). */
export const COSTS: Record<MarketClass, { spreadAtr: number; commissionAtr: number; slippageAtr: number }> = {
  xau: { spreadAtr: 0.06, commissionAtr: 0.01, slippageAtr: 0.03 },
  forex: { spreadAtr: 0.05, commissionAtr: 0.01, slippageAtr: 0.02 },
  indices: { spreadAtr: 0.06, commissionAtr: 0, slippageAtr: 0.03 },
  crypto: { spreadAtr: 0.04, commissionAtr: 0.02, slippageAtr: 0.04 },
};

export interface Level { x: number; label: string; htf: boolean }
export interface TpSlPlan {
  ok: boolean; reason?: string;
  side: Side; entry: number; stop: number; risk: number; stopSource: string; stopMult: number; volatility: VolatilityClass;
  tp1: Level; tp2: Level; tp3: Level; rr1: number; rr2: number; rr3: number;
  /** TP2 meets the minimum main-target RR without passing major opposing structure. */
  rrOk: boolean; rrNote: string;
  /** Limit entry that would give the minimum main RR with the same stop and TP2. */
  betterEntry?: number;
  trail: TrailMethod;
}

type Frames = Partial<Record<Interval, FrameSmc>>;
const sideOf = (side: Side) => (side === "BUY" ? 1 : -1);

/** Pick the trailing method: ATR in fast markets, structure when the 5M trend is confirmed, otherwise profit-lock. */
export function chooseTrail(side: Side, vol: VolatilityClass, smc5: SmcRead | undefined, s: TpSlSettings): TrailMethod {
  if (s.trail !== "auto") return s.trail;
  if (vol === "high" || vol === "extreme") return "atr";
  if (smc5 && smc5.bias === (side === "BUY" ? "bullish" : "bearish") && smc5.event?.kind === "BOS") return "structure";
  return "profit_lock";
}

function stopFor(side: Side, entry: number, f: Frames, s: TpSlSettings) {
  const one = f["1m"] ?? f["5m"]!, five = f["5m"] ?? one, d = sideOf(side);
  const atr = five.atr || one.atr, vol = five.volatility;
  const below = (x: number | undefined) => x !== undefined && Number.isFinite(x) && (x - entry) * d < 0;
  const cand: { x: number; label: string }[] = [];
  const add = (x: number | undefined, label: string) => { if (below(x)) cand.push({ x: x!, label }); };
  for (const [tf, fr] of [["1M", f["1m"]], ["5M", f["5m"]], ["15M", f["15m"]], ["30M", f["30m"]], ["1H", f["1h"]]] as const) {
    if (!fr) continue;
    const m = fr.smc;
    if (m.sweep?.side === side) add(m.sweep.level, `${tf} liquidity sweep ${side === "BUY" ? "low" : "high"}`);
    if (m.orderBlock?.side === side) add(side === "BUY" ? m.orderBlock.bottom : m.orderBlock.top, `${tf} order block invalidation`);
    const swing = (side === "BUY" ? m.ssl : m.bsl).filter(below).sort((a, b) => (b - a) * d)[0];
    add(swing, `${tf} swing ${side === "BUY" ? "low" : "high"}`);
    if (tf === "15M" || tf === "1H") add(side === "BUY" ? m.rangeLow : m.rangeHigh, `${tf} structure invalidation`);
  }
  const minDist = atr * 0.3, mult = s.atrMult[vol];
  // Most relevant = nearest structure that is not inside the noise; 1H levels only when nothing nearer qualifies.
  const struct = cand.filter((c) => Math.abs(entry - c.x) >= minDist).sort((a, b) => Math.abs(entry - a.x) - Math.abs(entry - b.x))[0];
  let stop = struct ? struct.x - d * atr * s.bufferAtr : entry - d * atr * mult;
  // Do not rest the stop on obvious liquidity (other swing points / equal levels within a small band).
  const pools = Object.values(f).flatMap((fr) => fr ? [...(side === "BUY" ? fr.smc.ssl : fr.smc.bsl), side === "BUY" ? fr.smc.equalLows : fr.smc.equalHighs] : []).filter((x): x is number => x !== undefined);
  for (const p of pools) if (Math.abs(stop - p) < atr * 0.15 && (p - entry) * d < 0) stop = Math.min(stop * d, (p - d * atr * s.bufferAtr) * d) * d;
  // ATR floor: never tighter than the volatility multiplier.
  if (Math.abs(entry - stop) < atr * mult) stop = entry - d * atr * mult;
  return { stop, atr, vol, mult, source: struct ? `${struct.label} + ${s.bufferAtr}×ATR buffer${Math.abs(entry - stop) > Math.abs(entry - struct.x) + atr * s.bufferAtr + 1e-12 ? ` (widened to ${mult}×ATR)` : ""}` : `${mult}×ATR (no structure nearby)` };
}

function liquidity(side: Side, entry: number, f: Frames, frontRun: number): Level[] {
  const d = sideOf(side), out: Level[] = [];
  const add = (x: number | undefined, label: string, htf: boolean) => { if (x !== undefined && Number.isFinite(x) && (x - entry) * d > 0) out.push({ x: x - d * frontRun, label, htf }); };
  for (const [tf, fr, htf] of [["1M", f["1m"], false], ["5M", f["5m"], false], ["15M", f["15m"], false], ["30M", f["30m"], true], ["1H", f["1h"], true]] as const) {
    if (!fr) continue;
    const m = fr.smc;
    for (const x of side === "BUY" ? m.bsl : m.ssl) add(x, `${tf} ${side === "BUY" ? "buy" : "sell"}-side liquidity`, htf);
    add(side === "BUY" ? m.equalHighs : m.equalLows, `${tf} equal ${side === "BUY" ? "highs" : "lows"}`, htf);
    const ob = m.orderBlock?.side !== side ? m.orderBlock : undefined;
    if (ob) add(side === "BUY" ? ob.bottom : ob.top, `${tf} opposing order block`, htf);
    const g = m.fvg?.side !== side ? m.fvg : undefined;
    if (g) add(side === "BUY" ? g.bottom : g.top, `${tf} opposing FVG`, htf);
    if (htf || tf === "15M") add(side === "BUY" ? m.rangeHigh : m.rangeLow, `${tf} swing ${side === "BUY" ? "high" : "low"}`, htf);
  }
  return out.sort((a, b) => (a.x - b.x) * d);
}

/** Full TP/SL plan for one side. `entryOverride` lets an existing signal keep its own entry. */
export function planTpSl(side: Side, frames: FrameSmc[] | Frames, s: TpSlSettings = DEFAULT_TPSL, entryOverride?: number): TpSlPlan {
  const f: Frames = Array.isArray(frames) ? Object.fromEntries(frames.map((x) => [x.interval, x])) : frames;
  const one = f["1m"] ?? f["5m"] ?? f["15m"] ?? Object.values(f)[0]!;
  if (!f["1m"] && !f["5m"]) { f["5m"] = one; }
  const entry = entryOverride ?? one.price, d = sideOf(side);
  const st = stopFor(side, entry, f, s);
  const risk = Math.abs(entry - st.stop);
  const lv = liquidity(side, entry, f, st.atr * 0.1);
  const rr = (x: number) => (risk > 0 ? ((x - entry) * d) / risk : 0);
  const cap = lv.find((l) => l.htf && rr(l.x) >= 0.5); // major opposing structure (30M/1H)
  const within = (x: number) => !cap || (x - cap.x) * d <= 1e-12;
  const at = (k: number, label: string): Level => ({ x: entry + d * risk * k, label, htf: false });
  const tp1 = lv.find((l) => rr(l.x) >= 0.8 && within(l.x)) ?? (cap && rr(cap.x) < 1.2 ? cap : at(1.2, "1.2R (no nearer liquidity)"));
  const t1 = rr(tp1.x);
  const next = (from: number, gap: number, minRR = 0, capped = true) => lv.find((l) => (l.x - from) * d >= gap * risk && rr(l.x) >= minRR && (!capped || within(l.x)));
  const tp2 = next(tp1.x, 0.4, s.minMainRR * 0.9) ?? next(tp1.x, 0.4) ?? (cap && (cap.x - tp1.x) * d > 0 ? cap : at(Math.max(t1 + 0.6, s.minMainRR), "R-multiple (no mapped liquidity)"));
  const tp3 = lv.find((l) => l.htf && (l.x - tp2.x) * d >= 0.5 * risk) ?? next(tp2.x, 0.5, 0, false) ?? at(rr(tp2.x) + 1, "Trailing runner (no mapped liquidity)");
  const rr2 = rr(tp2.x);
  const blocked = !within(tp2.x);
  const rrOk = rr2 >= s.minMainRR - 1e-9 && !blocked;
  const reject = (st.vol === "extreme" && s.rejectExtreme) ? "Extreme volatility — entry rejected by settings"
    : risk > st.atr * s.maxStopAtr ? `Stop needs ${(risk / st.atr).toFixed(1)}×ATR, above the ${s.maxStopAtr}×ATR limit` : undefined;
  const R = s.minMainRR;
  const better = !rrOk && !blocked ? (tp2.x + R * st.stop) / (1 + R) : undefined;
  return {
    ok: !reject, reason: reject, side, entry, stop: st.stop, risk, stopSource: st.source, stopMult: st.mult, volatility: st.vol,
    tp1, tp2, tp3, rr1: +t1.toFixed(2), rr2: +rr2.toFixed(2), rr3: +rr(tp3.x).toFixed(2), rrOk,
    rrNote: rrOk ? `TP2 ${rr2.toFixed(2)}R meets the ${R}R minimum` : blocked ? `TP2 would pass ${cap!.label} — reward limited` : `TP2 only ${rr2.toFixed(2)}R (needs ${R}R)${better !== undefined ? ` — better entry near ${better.toPrecision(6)}` : ""}`,
    betterEntry: better, trail: chooseTrail(side, st.vol, f["5m"]?.smc, s),
  };
}

export interface PositionPlan { lots: number; riskPct: number; lossAtSl: number; profit: [number, number, number]; slDistance: number; tpDistance: [number, number, number] }
/** Money view of a plan: lots from the risk settings, loss at SL and cumulative profit with partial closes at each TP. */
export function positionPlan(symbol: string, p: Pick<TpSlPlan, "entry" | "stop" | "tp1" | "tp2" | "tp3">, r: RiskSettings, s: TpSlSettings = DEFAULT_TPSL): PositionPlan {
  const contract = contractSizeFor(symbol, r.contractSize);
  const dist = Math.abs(p.entry - p.stop);
  const riskAmt = r.accountSize * (r.riskPerTradePct / 100);
  const lots = dist > 0 && contract > 0 ? Math.min(r.maxLot, Math.max(0.01, Math.floor((riskAmt / (dist * contract)) * 100) / 100)) : 0;
  const tpD = [p.tp1.x, p.tp2.x, p.tp3.x].map((x) => Math.abs(x - p.entry)) as [number, number, number];
  const sh1 = s.tp1ClosePct / 100, sh2 = Math.min(1 - sh1, s.tp2ClosePct / 100), sh3 = Math.max(0, 1 - sh1 - sh2);
  const v = lots * contract;
  // After TP1 the rest is protected at break-even (if enabled), so each figure is the total if the trade ends at that TP.
  const p1 = v * (tpD[0] * sh1 + (s.breakEvenAfterTp1 ? 0 : tpD[0] * (1 - sh1)));
  const p2 = v * (tpD[0] * sh1 + tpD[1] * sh2 + (s.breakEvenAfterTp1 ? 0 : tpD[1] * sh3));
  const p3 = v * (tpD[0] * sh1 + tpD[1] * sh2 + tpD[2] * sh3);
  return { lots, riskPct: r.accountSize > 0 ? (lots * contract * dist / r.accountSize) * 100 : 0, lossAtSl: lots * contract * dist, profit: [p1, p2, p3], slDistance: dist, tpDistance: tpD };
}

// ---------------- Trade management ----------------
export interface TpTrade {
  side: Side; entry: number; stop: number; initialStop: number; tps: [number, number, number];
  hit: 0 | 1 | 2 | 3; remaining: number; realized: number; best: number; trailing: boolean; method: TrailMethod;
  closed?: { price: number; reason: string; at: number };
}
export const openTpTrade = (p: Pick<TpSlPlan, "side" | "entry" | "stop" | "tp1" | "tp2" | "tp3" | "trail">): TpTrade => ({
  side: p.side, entry: p.entry, stop: p.stop, initialStop: p.stop, tps: [p.tp1.x, p.tp2.x, p.tp3.x], hit: 0, remaining: 1, realized: 0, best: p.entry, trailing: false, method: p.trail,
});

/** Candidate trailing stop for the chosen method; `swing` is the last confirmed higher low (BUY) / lower high (SELL). */
export function trailLevel(t: TpTrade, close: number, atr: number, s: TpSlSettings, swing?: number): number | undefined {
  const d = sideOf(t.side);
  if (t.method === "structure" && swing !== undefined && (swing - t.entry) * d > 0) return swing - d * atr * s.bufferAtr;
  if (t.method === "profit_lock") return t.entry + d * Math.max(0, (t.best - t.entry) * d) * (s.profitLockPct / 100);
  return atr > 0 ? close - d * atr * s.trailAtrMult : undefined;
}

/**
 * Advances a trade through one closed candle: stop first when a bar touches both (conservative), then TP1/TP2/TP3
 * partials, break-even after TP1, and trailing once in profit. The stop only ever moves in the trade's favour.
 * `structureFlip` = an opposing CHoCH closed: before TP1 the trade is invalidated at the close.
 */
export function manageTpTrade(t: TpTrade, c: Candle, atr: number, s: TpSlSettings, opts: { swing?: number; structureFlip?: boolean } = {}): TpTrade {
  if (t.closed) return t;
  const d = sideOf(t.side), risk = Math.abs(t.entry - t.initialStop);
  const n: TpTrade = { ...t, tps: [...t.tps] as TpTrade["tps"] };
  const gain = (px: number, share: number) => (px - n.entry) * d * share;
  const adverse = d > 0 ? c.l : c.h, fav = d > 0 ? c.h : c.l;
  if ((adverse - n.stop) * d <= 0) {
    n.realized += gain(n.stop, n.remaining);
    n.closed = { price: n.stop, at: c.t, reason: n.trailing ? `${TRAIL_LABEL[n.method]} stop hit` : n.hit > 0 && (n.stop - n.entry) * d >= -1e-12 ? "Break-even stop hit" : "Stop loss hit" };
    n.remaining = 0; return n;
  }
  const shares = [s.tp1ClosePct / 100, s.tp2ClosePct / 100, 1];
  while (n.hit < 3 && (fav - n.tps[n.hit as 0 | 1 | 2]) * d >= 0) {
    const k = n.hit as 0 | 1 | 2, share = k === 2 ? n.remaining : Math.min(n.remaining, shares[k]);
    n.realized += gain(n.tps[k], share);
    n.remaining = +(n.remaining - share).toFixed(6);
    n.hit = (k + 1) as TpTrade["hit"];
    if (k === 0 && s.breakEvenAfterTp1 && (n.entry - n.stop) * d > 0) n.stop = n.entry;
    if (k === 1 && (n.tps[0] - n.stop) * d > 0) n.stop = n.tps[0]; // lock TP1 after TP2
    if (n.remaining <= 1e-9 || k === 2) { n.closed = { price: n.tps[k], at: c.t, reason: `TP${k + 1} hit` }; n.remaining = 0; return n; }
  }
  if ((fav - n.best) * d > 0) n.best = fav;
  if (opts.structureFlip && n.hit === 0) {
    n.realized += gain(c.c, n.remaining);
    n.closed = { price: c.c, at: c.t, reason: "Invalidated: structure changed against the trade" }; n.remaining = 0; return n;
  }
  if (!n.trailing && risk > 0 && ((n.best - n.entry) * d) / risk >= s.trailActivateR) n.trailing = true;
  if (n.trailing || opts.structureFlip) {
    const tl = trailLevel(n, c.c, atr, s, opts.swing);
    if (tl !== undefined && (tl - n.stop) * d > 0 && (c.c - tl) * d > 0) n.stop = tl;
  }
  return n;
}

// ---------------- Backtesting ----------------
export interface TpSlMetrics {
  trades: number; winRate: number; avgRR: number; profitFactor: number; maxDrawdownR: number; expectancyR: number;
  avgWinR: number; avgLossR: number; tp1Rate: number; tp2Rate: number; tp3Rate: number; slRate: number; trailExits: number; trailAvgR: number;
}
export function tpslMetrics(tr: { r: number; plannedRR: number; hit: number; reason: string }[]): TpSlMetrics {
  const n = tr.length, w = tr.filter((t) => t.r > 0.02), l = tr.filter((t) => t.r < -0.02);
  const gw = w.reduce((a, t) => a + t.r, 0), gl = -l.reduce((a, t) => a + t.r, 0);
  let eq = 0, pk = 0, dd = 0; for (const t of tr) { eq += t.r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const trail = tr.filter((t) => /trailing/i.test(t.reason));
  const rate = (f: (t: (typeof tr)[number]) => boolean) => (n ? tr.filter(f).length / n : 0);
  return {
    trades: n, winRate: n ? w.length / n : 0, avgRR: n ? tr.reduce((a, t) => a + t.plannedRR, 0) / n : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? 99 : 0, maxDrawdownR: dd, expectancyR: n ? eq / n : 0,
    avgWinR: w.length ? gw / w.length : 0, avgLossR: l.length ? -gl / l.length : 0,
    tp1Rate: rate((t) => t.hit >= 1), tp2Rate: rate((t) => t.hit >= 2), tp3Rate: rate((t) => t.hit >= 3), slRate: rate((t) => t.reason === "Stop loss hit"),
    trailExits: trail.length, trailAvgR: trail.length ? trail.reduce((a, t) => a + t.r, 0) / trail.length : 0,
  };
}

/** Closed-bar SMC reads for a series (bar i uses bars 0..i only). */
export const smcReads = (s: Series, from: number, to: number) => { const out: (SmcRead | undefined)[] = []; for (let i = from; i < to; i++) out[i] = readSmc(s, i); return out; };

/**
 * Backtests one TP/SL configuration on one chart. Entries: a fresh structure break with displacement in the
 * direction of bias (an objective SMC trigger); fill at the next bar's open plus half-spread and slippage;
 * exits use manageTpTrade bar by bar; costs come from the market class. Results are in R.
 */
export function backtestTpSl(series: Series, symbol: string, s: TpSlSettings, from: number, to: number, reads?: (SmcRead | undefined)[], interval: Interval = "15m") {
  const c = series.candles, cost = COSTS[marketClass(symbol)];
  const rd = reads ?? smcReads(series, from, to);
  const trades: { r: number; plannedRR: number; hit: number; reason: string }[] = [];
  let i = Math.max(from, 60);
  while (i < to - 2) {
    const m = rd[i], atr = series.atr[i];
    const side: Side | undefined = m?.freshEvent && m.event && m.displacement?.dir === m.event.dir && m.bias === (m.event.dir === "BUY" ? "bullish" : "bearish") ? m.event.dir : undefined;
    if (!m || !side || !(atr > 0) || m.event!.bar < i - 1) { i++; continue; }
    const vol: VolatilityClass = (c[i].h - c[i].l) > atr * 2.5 ? "extreme" : (c[i].h - c[i].l) > atr * 1.6 ? "high" : (c[i].h - c[i].l) < atr * 0.5 ? "low" : "normal";
    const d = sideOf(side), fill = c[i + 1].o + d * atr * (cost.spreadAtr / 2 + cost.slippageAtr);
    const plan = planTpSl(side, { [interval]: { interval, smc: m, price: c[i].c, atr, volatility: vol } } as Frames, s, fill);
    if (!plan.ok || !plan.rrOk) { i++; continue; }
    let t = openTpTrade(plan), j = i + 1;
    for (; j < to; j++) {
      const r2 = rd[j - 1];
      const swing = r2 ? (side === "BUY" ? r2.ssl : r2.bsl).filter((x) => (x - t.entry) * d > 0).sort((a, b) => (b - a) * d)[0] : undefined;
      t = manageTpTrade(t, c[j], series.atr[j - 1], s, { swing, structureFlip: !!r2?.freshEvent && r2.event?.kind === "CHoCH" && r2.event.dir !== side && r2.event.bar === j - 1 });
      if (t.closed) break;
    }
    if (!t.closed) { j = to - 1; t = { ...t, realized: t.realized + (c[j].c - t.entry) * d * t.remaining, closed: { price: c[j].c, at: c[j].t, reason: "End of data" } }; }
    const exitCost = atr * (cost.spreadAtr / 2 + cost.slippageAtr + cost.commissionAtr);
    trades.push({ r: plan.risk > 0 ? (t.realized - exitCost) / plan.risk : 0, plannedRR: plan.rr2, hit: t.hit, reason: t.closed!.reason });
    i = j + 1;
  }
  return { trades, metrics: tpslMetrics(trades) };
}

export interface TpSlTest { at: number; symbol: string; interval: Interval; candles: number; chosen: Partial<TpSlSettings>; inSample: TpSlMetrics; outOfSample: TpSlMetrics; baseline: TpSlMetrics; byTrail: Partial<Record<TrailMethod, TpSlMetrics>>; overfit: boolean; verdict: string }

/** Grid of configurations tried; defaults must be beaten by 0.05 R in-sample with enough trades to limit overfitting. */
export const TPSL_GRID: Partial<TpSlSettings>[] = [0.8, 1, 1.25].flatMap((k) => [1.5, 2, 2.5].flatMap((rr) => (["atr", "structure", "profit_lock"] as TrailMethod[]).map((trail) => ({
  atrMult: { low: +(1.2 * k).toFixed(2), normal: +(1.5 * k).toFixed(2), high: +(2 * k).toFixed(2), extreme: +(2.5 * k).toFixed(2) }, minMainRR: rr, trail,
}))));

/** Optimise on the first 65% of closed bars, then report the chosen settings on the unseen 35%. */
export function optimizeTpSl(series: Series, symbol: string, base: TpSlSettings, interval: Interval = "15m"): TpSlTest {
  const n = series.candles.length, split = Math.floor(60 + (n - 60) * 0.65);
  const reads = smcReads(series, 0, n);
  const baseIS = backtestTpSl(series, symbol, base, 60, split, reads, interval).metrics;
  let chosen: Partial<TpSlSettings> = {}, best = baseIS;
  for (const g of TPSL_GRID) {
    const m = backtestTpSl(series, symbol, { ...base, ...g }, 60, split, reads, interval).metrics;
    if (m.trades >= 5 && m.expectancyR > best.expectancyR + 0.05) { chosen = g; best = m; }
  }
  const outOfSample = backtestTpSl(series, symbol, { ...base, ...chosen }, split, n, reads, interval).metrics;
  const baseline = backtestTpSl(series, symbol, base, split, n, reads, interval).metrics;
  const byTrail: TpSlTest["byTrail"] = {};
  for (const t of ["atr", "structure", "profit_lock"] as TrailMethod[]) byTrail[t] = backtestTpSl(series, symbol, { ...base, ...chosen, trail: t }, 60, n, reads, interval).metrics;
  const overfit = best.trades > 0 && outOfSample.trades > 0 && best.expectancyR - outOfSample.expectancyR > 0.3;
  const verdict = outOfSample.trades < 10 ? `Only ${outOfSample.trades} unseen-data trades — not enough to judge` : overfit ? "Weaker on unseen data — possible overfitting, defaults kept"
    : `${outOfSample.expectancyR >= 0 ? "Positive" : "Negative"} expectancy on unseen data (${outOfSample.expectancyR.toFixed(2)} R) — past results do not guarantee future results`;
  return { at: Date.now(), symbol, interval, candles: n, chosen: overfit ? {} : chosen, inSample: best, outOfSample, baseline, byTrail, overfit, verdict };
}

/** Effective TP/SL settings for a symbol: user settings plus any optimised overrides for its market class. */
export const tpslFor = (symbol: string, base: TpSlSettings | undefined, byMarket: Partial<Record<MarketClass, Partial<TpSlSettings>>> | undefined): TpSlSettings =>
  ({ ...DEFAULT_TPSL, ...base, ...(byMarket?.[marketClass(symbol)] ?? {}) });
