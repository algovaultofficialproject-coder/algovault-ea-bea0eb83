/** Pure: turns one SymbolScan into a scanner-board row with a fully planned order (or WAIT/REJECT), never inventing prices. */
import type { SymbolScan } from "./useAutoTraderPro";
import { INTERVAL_MS } from "./engine";
import {
  buildTargets, chooseOrderType, dataStatus, isPending, kindForStrategy, lotSize, roundToTick, scoreClass, scoreSetup,
  setupKey, specFor, thesisFrom, validateOrder, type DataStatus, type Decision, type InstrumentSpec, type OrderType, type Quote,
} from "./order-planner";
import type { Side } from "./types";

export const DEFAULT_WATCHLIST = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "EURJPY", "GBPJPY", "BTCUSD", "ETHUSD", "NAS100", "US30", "SPX500"];

export interface BoardRow {
  symbol: string; price?: number; spread?: number; bias: "Bullish" | "Bearish" | "Neutral"; regime?: string; volatility?: string;
  setup?: string; strategy?: string; timeframe?: string; side?: Side; decision: Decision; reason: string;
  entry?: number; sl?: number; tps?: [number, number, number, number]; rr?: number; lots?: number; risk?: number; riskPct: number;
  score: number; scoreText: string; data: DataStatus; ageSec?: number; key?: string; expiresAt?: number; invalidation?: number;
  invalidationText?: string; brokerErrors: string[]; spec: InstrumentSpec; alignment: { agree: number; total: number; conflicts: string[] };
}

export function boardRow(scan: SymbolScan | undefined, symbol: string, now: number, risk: { equity: number; pct: number }): BoardRow {
  const spec = specFor(symbol);
  const base: BoardRow = { symbol, riskPct: risk.pct, bias: "Neutral", decision: "WAIT", reason: "Waiting for the first scan", score: 0, scoreText: scoreClass(0), data: "unavailable", brokerErrors: [], spec, alignment: { agree: 0, total: 0, conflicts: [] } };
  if (!scan) return base;
  const iv = scan.interval ?? "15m";
  const data = scan.error ? "unavailable" : dataStatus(scan.lastBar ? scan.lastBar.t + INTERVAL_MS[iv] : scan.at, now, INTERVAL_MS[iv]);
  const res = scan.result;
  const frames = scan.frames ?? [];
  const best = res?.best;
  const side = best?.side;
  const agree = frames.filter((f) => f.side && f.side === side).length;
  const conflicts = frames.filter((f) => f.side && side && f.side !== side).map((f) => `${f.interval} points ${f.side}`);
  const row: BoardRow = {
    ...base, price: scan.price, spread: scan.spread, data, ageSec: Math.round((now - scan.at) / 1000),
    bias: res?.market.trend === "bullish" ? "Bullish" : res?.market.trend === "bearish" ? "Bearish" : "Neutral",
    regime: res?.market.regime, volatility: res?.market.volatility, alignment: { agree, total: frames.filter((f) => f.side).length, conflicts },
  };
  if (scan.error) return { ...row, decision: "REJECT", reason: scan.error };
  if (data === "unavailable") return { ...row, decision: "REJECT", reason: "Market data is stale — not analysed as live" };
  if (!best || !res) return { ...row, reason: res?.summary || "No valid opportunity — NO TRADE" };
  if (!(scan.price && scan.price > 0)) return { ...row, decision: "REJECT", reason: "No live price" };
  const spread = scan.spread && scan.spread > 0 ? scan.spread : 0;
  const q: Quote = { bid: scan.price - spread / 2, ask: scan.price + spread / 2, at: scan.at };
  const kind = kindForStrategy(best.strategy);
  const choice = chooseOrderType(thesisFrom(best, kind), q, symbol, spec, res.market.atr, now);
  const smc = scan.smc?.find((s) => s.interval === iv)?.read;
  const score = scoreSetup({
    htf: row.alignment.total ? agree / row.alignment.total : 0,
    structure: smc && ((smc.bias === "bullish" && side === "BUY") || (smc.bias === "bearish" && side === "SELL")) ? 1 : 0.3,
    liquidity: smc?.sweep?.side === side ? 1 : 0.4,
    zone: smc?.inZone?.side === side || smc?.ote === side ? 1 : 0.4,
    momentum: best.confidence / 100,
    volatility: { low: 0.5, normal: 1, high: 0.6, extreme: 0.1 }[res.market.volatility],
    session: 0.5, news: 0.5,
    spread: res.market.atr > 0 ? Math.max(0, 1 - spread / (0.3 * res.market.atr)) : 0,
    agreement: Math.min(1, res.candidates.filter((c) => c.side === side).length / 3),
  });
  const out: BoardRow = {
    ...row, setup: kind === "breakout" ? "Breakout" : kind === "pullback" ? "Pullback / zone" : "Trigger", strategy: best.strategyName,
    timeframe: `${iv} setup · ${frames.map((f) => f.interval).join("/")}`, side, decision: choice.decision, reason: `${choice.reason}. ${best.reason}`,
    score, scoreText: scoreClass(score), expiresAt: best.expiresAt, invalidation: best.structuralStop, invalidationText: best.invalidation,
  };
  if (choice.decision === "WAIT" || choice.decision === "REJECT" || choice.entry === undefined) return out;
  const type = choice.decision as OrderType;
  const buy = type.startsWith("BUY");
  const entry = isPending(type) ? choice.entry : roundToTick(choice.entry, spec);
  const sl = roundToTick(best.stopLoss + (entry - best.entry), spec, buy ? "down" : "up");
  const levels = [best.takeProfit, best.structuralTarget ?? NaN, ...(smc ? [...smc.bsl, ...smc.ssl, smc.rangeHigh ?? NaN, smc.rangeLow ?? NaN] : [])];
  const tps = buildTargets(best.side, entry, sl, levels, spec, spread);
  const errs = validateOrder(type, entry, sl, tps, q, spec);
  const size = lotSize(risk.equity, risk.pct, entry, sl, spec);
  return {
    ...out, entry, sl, tps, rr: +(Math.abs(tps[1] - entry) / Math.abs(entry - sl)).toFixed(2), lots: size.lots, risk: size.risk,
    brokerErrors: size.note ? [...errs, size.note] : errs, decision: errs.length ? "REJECT" : type,
    reason: errs.length ? `${out.reason} — broker rules: ${errs.join("; ")}` : out.reason,
    key: setupKey(symbol, best.side, type, best.strategy, iv, entry, spec),
  };
}

export type BoardFilter = "all" | "buy" | "sell" | "market" | "BUY_STOP" | "SELL_STOP" | "BUY_LIMIT" | "SELL_LIMIT" | "strong";
export function filterRows(rows: BoardRow[], f: BoardFilter, regime = "all", tf = "all"): BoardRow[] {
  return rows.filter((r) => {
    if (regime !== "all" && r.regime !== regime) return false;
    if (tf !== "all" && !r.timeframe?.startsWith(tf + " ")) return false;
    if (f === "all") return true;
    if (f === "buy") return r.side === "BUY" && r.decision !== "WAIT" && r.decision !== "REJECT";
    if (f === "sell") return r.side === "SELL" && r.decision !== "WAIT" && r.decision !== "REJECT";
    if (f === "market") return /_MARKET$/.test(r.decision);
    if (f === "strong") return r.score >= 80 && r.decision !== "REJECT";
    return r.decision === f;
  });
}
