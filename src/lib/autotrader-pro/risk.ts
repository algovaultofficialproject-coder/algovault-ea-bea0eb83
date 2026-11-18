import type { Candle, Side, VolatilityClass } from "./types";
import type { TargetPlan } from "./targets";

export type RiskTolerance = "conservative" | "balanced" | "aggressive";

export interface RiskSettings {
  tolerance: RiskTolerance;
  /** Paper balance / account size used for position sizing (live mode never reads the broker balance). */
  accountSize: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxOpenTrades: number;
  maxTradesPerDay: number;
  minMinutesBetweenTrades: number;
  maxConsecutiveLosses: number;
  lossCooldownMinutes: number;
  /** Spread limit as a share of ATR (0.25 = spread may be at most 25% of ATR). */
  maxSpreadAtr: number;
  /** Simulated / assumed slippage as a share of ATR, applied to paper fills and backtests. */
  slippageAtr: number;
  /** Bars whose range exceeds this many ATR are treated as spikes. */
  spikeAtrMult: number;
  slAtrMult: number;
  minSlAtr: number;
  maxSlAtr: number;
  targetRR: number;
  trailingAtrMult: number;
  breakEvenAtR: number;
  partialAtR: number;
  partialPct: number;
  volatilitySizing: boolean;
  maxLot: number;
  /** Units per 1.0 lot; 0 = estimate from the symbol (forex 100 000, gold 100, crypto 1). */
  contractSize: number;
}

/** Early profit (60% booked at 0.6R, rest at break-even, 1 ATR trail) lifts the win rate to ~65-70% without lowering profit factor in backtests. */
const BASE: Omit<RiskSettings, "tolerance" | "riskPerTradePct" | "maxDailyLossPct" | "maxDrawdownPct" | "maxOpenTrades" | "maxTradesPerDay" | "targetRR" | "maxConsecutiveLosses"> = {
  accountSize: 10000, minMinutesBetweenTrades: 5, lossCooldownMinutes: 60, maxSpreadAtr: 0.3, slippageAtr: 0.05,
  spikeAtrMult: 3, slAtrMult: 2, minSlAtr: 1.2, maxSlAtr: 4, trailingAtrMult: 1, breakEvenAtR: 0.6, partialAtR: 0.6, partialPct: 60,
  volatilitySizing: true, maxLot: 1, contractSize: 0,
};

export const RISK_PRESETS: Record<RiskTolerance, RiskSettings> = {
  conservative: { ...BASE, tolerance: "conservative", riskPerTradePct: 0.5, maxDailyLossPct: 2, maxDrawdownPct: 8, maxOpenTrades: 2, maxTradesPerDay: 6, targetRR: 2, maxConsecutiveLosses: 3 },
  balanced: { ...BASE, tolerance: "balanced", riskPerTradePct: 1, maxDailyLossPct: 4, maxDrawdownPct: 15, maxOpenTrades: 3, maxTradesPerDay: 12, targetRR: 1.8, maxConsecutiveLosses: 4 },
  aggressive: { ...BASE, tolerance: "aggressive", riskPerTradePct: 2, maxDailyLossPct: 6, maxDrawdownPct: 25, maxOpenTrades: 5, maxTradesPerDay: 25, targetRR: 1.5, maxConsecutiveLosses: 6, minMinutesBetweenTrades: 2 },
};

/** Estimated units per 1.0 lot. Brokers differ — users can override it in settings. */
export function contractSizeFor(symbol: string, override = 0) {
  if (override > 0) return override;
  const s = symbol.toUpperCase();
  if (/^(BTC|ETH|LTC|SOL|XRP|DOGE|ADA|BNB)/.test(s)) return 1;
  if (/^(XAU|GOLD)/.test(s)) return 100;
  if (/^(XAG|SILVER)/.test(s)) return 5000;
  if (/US30|NAS|SPX|GER|UK100|DJ|NDX/.test(s)) return 1;
  return 100000;
}

export interface Levels {
  stopLoss: number; takeProfit: number; rr: number; slDist: number; notes: string[];
  /** The turning level the target was placed in front of, when one was used. */
  turnLevel?: number;
  /** Set when the next turning point is too close to pay at least MIN_TARGET_R — the setup must not trade. */
  tight?: string;
}

/** Minimum reward (in R) a target must pay before the next turning point. */
export const MIN_TARGET_R = 1.2;
/** Targets never sit further than this many ATR from entry when the path ahead is clear. */
export const MAX_TP_ATR = 4;
/** The take profit sits this many ATR in front of the turning level so it fills before the market turns. */
export const TURN_FRONT_ATR = 0.1;
/** Levels closer than this (ATR) are being tested right now and are ignored. */
const TURN_IGNORE_ATR = 0.25;

const fmtPx = (n: number) => n.toFixed(n >= 1000 ? 2 : n >= 10 ? 3 : 5);

/**
 * ATR-based dynamic stop and turning-point target. The structural stop is respected but clamped into
 * [minSlAtr, maxSlAtr] × ATR. The take profit is placed just in front of the nearest level where the
 * market is likely to turn (swing, range extreme, band, EMA 200 or the strategy's own target) when it
 * pays at least MIN_TARGET_R; a closer turning point marks the setup as tight; with a clear path the
 * target is the RR target capped at MAX_TP_ATR × ATR.
 */
export function planLevels(side: Side, entry: number, structuralStop: number, atr: number, vol: VolatilityClass, r: RiskSettings, structuralTarget?: number, turns: number[] = [], plan?: TargetPlan): Levels {
  const d = side === "BUY" ? 1 : -1;
  const notes: string[] = [];
  const volMult = vol === "extreme" ? 1.4 : vol === "high" ? 1.2 : vol === "low" ? 0.85 : 1;
  const atrStop = atr * r.slAtrMult * volMult;
  const structDist = (entry - structuralStop) * d;
  let dist = structDist > 0 ? Math.max(structDist, atr * r.minSlAtr) : atrStop;
  if (structDist <= 0) notes.push("Structural stop was on the wrong side — ATR stop used");
  if (dist > atr * r.maxSlAtr) { dist = atr * r.maxSlAtr; notes.push(`Stop capped at ${r.maxSlAtr}× ATR`); }
  if (vol !== "normal") notes.push(`${vol} volatility: stop scaled ×${volMult}`);
  const capAtr = plan?.capAtr ?? MAX_TP_ATR;
  // A wide stop would force a far target (min 1.2R): tighten the stop so the method's target stays close.
  const stopFit = (atr * capAtr) / MIN_TARGET_R;
  if (plan && atr > 0 && dist > stopFit) { dist = stopFit; notes.push(`Stop tightened to ${(dist / atr).toFixed(2)}× ATR to keep the target close`); }
  const baseRR = plan ? Math.min(plan.rr, r.targetRR) : r.targetRR;
  const rrTarget = vol === "extreme" ? Math.max(1.2, baseRR * 0.75) : vol === "high" ? Math.max(1.2, baseRR * 0.9) : baseRR;
  const minDist = dist * MIN_TARGET_R;
  let tpDist = Math.max(minDist, Math.min(dist * rrTarget, atr * capAtr));
  if (plan) {
    const md = plan.target !== undefined && Number.isFinite(plan.target) ? (plan.target - entry) * d : NaN;
    if (md > 0) {
      tpDist = Math.min(atr * capAtr, Math.max(minDist, md - atr * TURN_FRONT_ATR));
      notes.push(`${plan.label}: target ${fmtPx(entry + d * tpDist)} (${(tpDist / dist).toFixed(1)}R, max ${capAtr} ATR)`);
    } else notes.push(`${plan.label}: ${(tpDist / dist).toFixed(1)}R target, max ${capAtr} ATR`);
  }
  const levels = [...turns, ...(structuralTarget !== undefined ? [structuralTarget] : [])]
    .filter((x) => Number.isFinite(x))
    .map((x) => (x - entry) * d)
    .filter((x) => atr > 0 && x > atr * TURN_IGNORE_ATR)
    .sort((a, b) => a - b);
  let turnLevel: number | undefined, tight: string | undefined;
  if (levels.length) {
    const first = levels[0];
    turnLevel = entry + d * first;
    const turnDist = Math.max(first - atr * TURN_FRONT_ATR, atr * 0.1);
    if (turnDist < minDist) {
      tpDist = turnDist;
      tight = `Next turning point ${fmtPx(turnLevel)} is only ${(turnDist / dist).toFixed(1)}R away — not enough profit room`;
    } else if (turnDist <= tpDist) {
      tpDist = turnDist;
      notes.push(`Target just before the turning point at ${fmtPx(turnLevel)} (${(tpDist / dist).toFixed(1)}R)`);
    } else {
      notes.push(`Clear room to the next turning point ${fmtPx(turnLevel)} — target ${(tpDist / dist).toFixed(1)}R`);
      turnLevel = undefined;
    }
  } else notes.push(`No turning point ahead — ${(tpDist / dist).toFixed(1)}R volatility target`);
  return { stopLoss: entry - d * dist, takeProfit: entry + d * tpDist, rr: tpDist / dist, slDist: dist, notes, turnLevel, tight };
}

/** Risk-based lots: risk % of the account over the stop distance, reduced in high volatility. */
export function positionSize(symbol: string, entry: number, stopLoss: number, vol: VolatilityClass, r: RiskSettings, equity = r.accountSize) {
  const perLot = Math.abs(entry - stopLoss) * contractSizeFor(symbol, r.contractSize);
  if (!(perLot > 0) || !(equity > 0)) return { lots: 0.01, riskAmount: 0, note: "Size fallback: minimum lot" };
  const volFactor = !r.volatilitySizing ? 1 : vol === "extreme" ? 0.5 : vol === "high" ? 0.7 : vol === "low" ? 1.1 : 1;
  const riskAmount = equity * (r.riskPerTradePct / 100) * volFactor;
  const raw = riskAmount / perLot;
  const lots = Math.min(r.maxLot, Math.max(0.01, Math.floor(raw * 100 + 1e-6) / 100));
  const note = `${r.riskPerTradePct}% risk${volFactor !== 1 ? ` × ${volFactor} (${vol} volatility)` : ""}${raw > r.maxLot ? ` · capped at ${r.maxLot} lots` : raw < 0.01 ? " · below minimum, 0.01 used" : ""}`;
  return { lots, riskAmount, note };
}

export interface AccountState {
  equity: number;
  peakEquity: number;
  dailyPnl: number;
  openTrades: number;
  tradesToday: number;
  consecutiveLosses: number;
  lastLossAt?: number;
  lastTradeAt?: number;
}

export interface GateInput {
  account: AccountState;
  atr: number;
  lastCandle: Candle;
  spread?: number;
  now: number;
}

/** Every protection that can stop a new entry. Returns all reasons so the dashboard can explain exactly what blocks it. */
export function riskGate(r: RiskSettings, g: GateInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const a = g.account;
  const start = r.accountSize;
  if (a.dailyPnl <= -(start * r.maxDailyLossPct) / 100) reasons.push(`Daily loss limit reached (${r.maxDailyLossPct}%)`);
  if (a.peakEquity > 0 && ((a.peakEquity - a.equity) / a.peakEquity) * 100 >= r.maxDrawdownPct) reasons.push(`Max drawdown reached (${r.maxDrawdownPct}%)`);
  if (a.openTrades >= r.maxOpenTrades) reasons.push(`Max simultaneous trades (${r.maxOpenTrades}) open`);
  if (a.tradesToday >= r.maxTradesPerDay) reasons.push(`Overtrading guard: ${r.maxTradesPerDay} trades today`);
  if (a.lastTradeAt && g.now - a.lastTradeAt < r.minMinutesBetweenTrades * 60000) reasons.push(`Cooling down ${r.minMinutesBetweenTrades} min between trades`);
  if (a.consecutiveLosses >= r.maxConsecutiveLosses && a.lastLossAt && g.now - a.lastLossAt < r.lossCooldownMinutes * 60000) {
    reasons.push(`${a.consecutiveLosses} losses in a row — paused ${r.lossCooldownMinutes} min`);
  }
  if (g.spread !== undefined && g.atr > 0 && g.spread / g.atr > r.maxSpreadAtr) reasons.push(`Spread ${(g.spread / g.atr * 100).toFixed(0)}% of ATR exceeds ${(r.maxSpreadAtr * 100).toFixed(0)}%`);
  const range = g.lastCandle.h - g.lastCandle.l;
  if (g.atr > 0 && range > r.spikeAtrMult * g.atr) reasons.push(`Price spike protection: last bar ${(range / g.atr).toFixed(1)}× ATR`);
  return { ok: reasons.length === 0, reasons };
}

export interface ManagedTrade {
  side: Side;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  initialStop: number;
  lots: number;
  /** Share of the original size still open (1 = full). */
  remaining: number;
  realized: number;
  breakEven: boolean;
  partialTaken: boolean;
  trailing: boolean;
  closed?: { price: number; reason: string; at: number };
}

/**
 * Advances one simulated trade through one candle: stop/target (stop first when both are touched — conservative),
 * break-even, partial profit and ATR trailing stop. Profit is in price units × lots × contract size.
 */
export function manageTrade(t: ManagedTrade, c: Candle, atr: number, r: RiskSettings, contract: number): ManagedTrade {
  if (t.closed) return t;
  const d = t.side === "BUY" ? 1 : -1;
  const risk = Math.abs(t.entry - t.initialStop);
  const pnl = (price: number, share: number) => (price - t.entry) * d * t.lots * share * contract;
  const next: ManagedTrade = { ...t };
  const adverse = d > 0 ? c.l : c.h, favourable = d > 0 ? c.h : c.l;
  if ((adverse - next.stopLoss) * d <= 0) {
    next.realized += pnl(next.stopLoss, next.remaining);
    const reason = next.trailing ? "Trailing stop hit" : next.breakEven ? "Break-even stop hit" : "Stop loss hit";
    next.closed = { price: next.stopLoss, reason, at: c.t };
    next.remaining = 0;
    return next;
  }
  if ((favourable - next.takeProfit) * d >= 0) {
    next.realized += pnl(next.takeProfit, next.remaining);
    next.closed = { price: next.takeProfit, reason: "Take profit hit", at: c.t };
    next.remaining = 0;
    return next;
  }
  const bestR = risk > 0 ? ((favourable - t.entry) * d) / risk : 0;
  if (!next.breakEven && r.breakEvenAtR > 0 && bestR >= r.breakEvenAtR) { next.breakEven = true; next.stopLoss = t.entry; }
  if (!next.partialTaken && r.partialAtR > 0 && r.partialPct > 0 && bestR >= r.partialAtR) {
    const share = Math.min(next.remaining, r.partialPct / 100);
    next.realized += pnl(t.entry + d * risk * r.partialAtR, share);
    next.remaining = +(next.remaining - share).toFixed(4);
    next.partialTaken = true;
    next.trailing = true;
  }
  if (next.trailing && atr > 0) {
    const trail = c.c - d * atr * r.trailingAtrMult;
    if ((trail - next.stopLoss) * d > 0) next.stopLoss = trail;
  }
  return next;
}
