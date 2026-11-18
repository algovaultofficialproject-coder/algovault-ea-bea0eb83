import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCandles } from "@/lib/market-data.functions";
import { getTvSignal } from "@/lib/tradingview.functions";
import { executeTrade } from "@/lib/metaapi.functions";
import { tradeLog } from "@/lib/trade-log";
import { usePortalStore } from "@/lib/portal-store";
import { buildSeries } from "./indicators";
import { correlation, describeCorrelation, readMarketChange, referenceFor, srZones, type ChangeRead, type CorrelationRead, type SrZone } from "./market-change";
import { closedIndex, INTERVAL_MS, runEngine, type ScanResult, type StrategyPerf } from "./engine";
import { contractSizeFor, manageTrade, positionSize, riskGate } from "./risk";
import { accountState, journalPerf } from "./account";
import { perfFromWalkForward, walkForward } from "./backtest";
import { STRATEGIES } from "./strategies";
import { getProState, liveAuthorized, perfKey, proActions, type PaperPosition } from "./store";
import { REGIME_LABEL } from "./regime";
import { connectedAccount, parseTradeCount, type ConnectedAccount } from "./execution";
import { readSmc } from "./smc";
import { confluence, shouldAlert, TIER_LABEL, type MtfResult } from "./mtf";
import { marketClass, optimizeTpSl, tpslFor, TRAIL_LABEL } from "./tpsl";
import { SCAN_BOOK } from "./strategy-policy";
import { pickTimeframe, SCAN_ORDER, SCAN_INTERVALS, summarizeFrame, type FrameSummary } from "./timeframes";
import type { Series } from "./indicators";
import type { Candle, Interval, Signal, StrategyId } from "./types";

export interface SymbolScan {
  /** Exactly as the user typed it; sent to the broker unchanged. */
  symbol: string;
  at: number;
  /** Timeframe picked automatically for signals and entries. */
  interval?: Interval;
  /** What each scanned timeframe currently shows. */
  frames?: FrameSummary[];
  source?: string;
  dataSymbol?: string;
  error?: string;
  needsKey?: boolean;
  price?: number;
  spread?: number;
  result?: ScanResult;
  gate?: { ok: boolean; reasons: string[] };
  size?: { lots: number; note: string };
  tv?: { rating: number; label: string; at: number };
  lastBar?: Candle;
  /** Top-down 1H→1M Smart Money confluence read. */
  mtf?: MtfResult;
  smc?: { interval: Interval; read: ReturnType<typeof readSmc> }[];
  /** V3 market-change detection across every scanned timeframe. */
  change?: { frames: ChangeRead[]; zones: SrZone[]; correlation?: CorrelationRead; correlationNote?: string };
}

interface Frame { interval: Interval; candles: Candle[]; i: number; series: Series; result: ScanResult; source: string; dataSymbol: string; spread?: number }
interface FrameError { interval: Interval; error: string; needsKey: boolean; dataSymbol?: string }

export const SCAN_EVERY_MS = 15_000;
const tvLabel = (r: number) => (r >= 0.5 ? "Strong buy" : r >= 0.1 ? "Buy" : r <= -0.5 ? "Strong sell" : r <= -0.1 ? "Sell" : "Neutral");
const digitsFor = (sym: string) => (/JPY/i.test(sym) ? 3 : /XAU|GOLD|XAG|US30|NAS|SPX|GER|UK|BTC|ETH/i.test(sym) ? 2 : 5);
const marketText = (r: ScanResult) => `${REGIME_LABEL[r.market.regime]} · ${r.market.trend} trend · ${r.market.volatility} volatility`;

/** Paper perf from the Trade Log journal overrides backtests once it has enough trades. */
function mergedPerf(key: string): Partial<Record<StrategyId, StrategyPerf>> {
  const s = getProState();
  const bt = s.perf[key] ?? {};
  const paper = journalPerf(tradeLog.journal(), "paper");
  const out: Partial<Record<StrategyId, StrategyPerf>> = { ...bt };
  for (const def of STRATEGIES) {
    const p = paper[`${def.letter} · ${def.name}`];
    if (p && p.trades >= 15) out[def.id] = p;
  }
  return out;
}

/**
 * AutoTrader Pro scanning loop. Analysis mode only scans and records signals; paper mode simulates trades
 * with full trade management; live mode sends confirmed signals to the connected MetaTrader account only after
 * explicit authorisation and every risk check has passed.
 */
export function useAutoTraderPro(running: boolean) {
  const candlesFn = useServerFn(getCandles);
  const tvFn = useServerFn(getTvSignal);
  const execFn = useServerFn(executeTrade);
  const portal = usePortalStore();
  const portalRef = useRef(portal);
  portalRef.current = portal;
  const [scans, setScans] = useState<Record<string, SymbolScan>>({});
  const [busy, setBusy] = useState(false);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const lastSignal = useRef(new Map<string, string>());
  const refCache = useRef(new Map<string, { at: number; candles: Candle[] }>());
  const changeAlerts = useRef(new Map<string, string[]>());
  const tvAt = useRef(new Map<string, SymbolScan["tv"]>());
  const liveBusy = useRef(false);

  /** Sends `count` orders to the connected account and records how many the broker filled. */
  const sendOrders = useCallback(async (
    journalId: string, acct: ConnectedAccount,
    o: { symbol: string; side: Signal["side"]; lot: number; slDist: number; tpDist: number; digits: number; count: number },
  ): Promise<{ filled: number; error?: string }> => {
    try {
      const res = await execFn({ data: { platform: acct.platform, login: acct.login, password: acct.password, server: acct.server, ...o, comment: "AlgoVault Pro" } });
      const results = (res?.results ?? []) as Array<{ ok: boolean; error?: string }>;
      const filled = res?.ok ? results.filter((r) => r.ok).length || 1 : 0;
      const failed = results.find((r) => !r.ok)?.error;
      const error = filled > 0 ? failed : res?.error ?? failed ?? "Rejected by broker";
      tradeLog.executed(journalId, filled, o.count, error ?? undefined);
      return { filled, error: error ?? undefined };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      tradeLog.executed(journalId, 0, o.count, msg);
      return { filled: 0, error: msg };
    }
  }, [execFn]);

  const scanOne = useCallback(async (symbol: string): Promise<SymbolScan> => {
    const pro = getProState();
    const now = Date.now();
    // TradingView technical rating as an independent cross-check (display only), at most once a minute.
    let tv = tvAt.current.get(symbol);
    if (!tv || now - tv.at > 60_000) {
      const r = await tvFn({ data: { symbol } }).catch(() => null);
      if (r && r.ok && typeof r.rating15 === "number") { tv = { rating: r.rating15, label: tvLabel(r.rating15), at: now }; tvAt.current.set(symbol, tv); }
    }

    // ---- Read every timeframe, then act on the one with the strongest setup ----
    const reads = await Promise.all(SCAN_ORDER.map(async (interval): Promise<Frame | FrameError> => {
      const feed = await candlesFn({ data: { symbol, interval, limit: 600 } }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Market data unavailable", needsKey: false, dataSymbol: undefined }));
      if (!feed.ok) return { interval, error: feed.error, needsKey: "needsKey" in feed ? !!feed.needsKey : false, dataSymbol: feed.dataSymbol };
      const candles = feed.candles;
      const i = closedIndex(candles, INTERVAL_MS[interval], now);
      const series = buildSeries(candles);
      const key = perfKey(symbol, interval);
      const atrNow = series.atr[i];
      const change = readMarketChange(series, i, interval, { confirmBars: pro.engine.changeConfirmBars ?? 3, minHoldBars: pro.engine.changeMinHold ?? 5 });
      const result = runEngine(series, i, {
        change,
        symbol, interval, now, risk: pro.risk, perf: mergedPerf(key),
        settings: { ...pro.engine, params: { ...pro.engine.params, ...(pro.optimized[key] ?? {}) } },
        ctx: { spreadAtr: feed.spread !== undefined && atrNow > 0 ? feed.spread / atrNow : undefined },
      });
      return { interval, candles, i, series, result, source: feed.source, dataSymbol: feed.dataSymbol, spread: feed.spread };
    }));
    const frames = reads.filter((f): f is Frame => "result" in f);
    const summaries = reads.map((f): FrameSummary => ("result" in f ? summarizeFrame(f) : { interval: f.interval, error: f.error }));
    const chosen = pickTimeframe(frames);
    if (!chosen) {
      const err = reads.find((f): f is FrameError => "error" in f);
      return { symbol, at: now, error: err?.error ?? "Market data unavailable", needsKey: err?.needsKey ?? false, dataSymbol: err?.dataSymbol, tv, frames: summaries };
    }
    const { candles, i, result, interval, source, dataSymbol, spread } = chosen;
    const price = candles[candles.length - 1].c;
    const scan: SymbolScan = { symbol, at: now, interval, frames: summaries, source, dataSymbol, price, spread, result, tv, lastBar: candles[i] };

    // ---- Multi-timeframe Smart Money confluence (closed bars only) ----
    const smc = frames.map((f) => ({ interval: f.interval, read: readSmc(f.series, f.i) }));
    scan.smc = smc;

    // ---- V3 market-change detection: per-frame reads, MTF zones, intermarket correlation ----
    const changes = frames.map((f) => f.result.change).filter((x): x is ChangeRead => !!x);
    const zf = frames.find((f) => f.interval === "15m") ?? chosen;
    const zones = srZones(frames.map((f) => ({ interval: f.interval, series: f.series, i: f.i })), price, zf.series.atr[zf.i]);
    let corr: CorrelationRead | undefined, correlationNote: string | undefined;
    const ref = referenceFor(symbol);
    if (ref && zf.interval === "15m") {
      let rc = refCache.current.get(ref.symbol);
      if (!rc || now - rc.at > 5 * 60_000) {
        const feed = await candlesFn({ data: { symbol: ref.symbol, interval: "15m", limit: 300 } }).catch(() => null);
        rc = { at: now, candles: feed && feed.ok ? feed.candles : [] };
        refCache.current.set(ref.symbol, rc);
      }
      const r = rc.candles.length ? correlation(zf.candles.slice(0, zf.i + 1), rc.candles) : undefined;
      if (r) corr = describeCorrelation(ref, r); else correlationNote = `Reference market ${ref.symbol} has no aligned data right now — correlation not used.`;
    } else if (!ref) correlationNote = "No reliable reference market for this symbol — correlation not used.";
    scan.change = { frames: changes, zones, correlation: corr, correlationNote };
    for (const ch of changes) {
      const ak = `${symbol}|chg|${ch.interval}`, prevAlerts = changeAlerts.current.get(ak) ?? [];
      const fresh = ch.alerts.filter((a) => !prevAlerts.includes(a));
      changeAlerts.current.set(ak, ch.alerts);
      for (const a of fresh.slice(0, 3)) tradeLog.info(`${symbol} · ${a}`);
    }
    scan.mtf = confluence(frames.map((f, k) => {
      const eng = f.result.best ?? f.result.candidates[0];
      return { interval: f.interval, smc: smc[k].read, price: f.candles[f.i].c, atr: f.series.atr[f.i], volatility: f.result.market.volatility, engine: eng ? { side: eng.side, confidence: eng.confidence, strategyName: eng.strategyName } : undefined };
    }), pro.engine.mtfMode ?? "balanced", now, tpslFor(symbol, pro.tpsl, pro.tpslByMarket));
    const ms = scan.mtf.signal, mk = `${symbol}|mtf`, mv = ms ? `${ms.side}|${ms.tier}` : "";
    if (lastSignal.current.get(mk) !== mv) {
      lastSignal.current.set(mk, mv);
      if (ms) {
        const dg = digitsFor(symbol);
        tradeLog.record({
          kind: "signal", mode: pro.mode, strategy: `MTF ${TIER_LABEL[ms.tier]} · ${ms.setup}`, symbol, side: ms.side, stage: ms.tier === "early" ? "early" : "confirmed",
          entry: +ms.entry.toFixed(dg), stopLoss: +ms.stopLoss.toFixed(dg), takeProfit: +ms.tp2.toFixed(dg),
          confidence: ms.confidence, outcome: "signal", market: `${scan.mtf.volatility} volatility · RR 1:${ms.rr2}`,
          reasonEntry: `${ms.explanation} · SL: ${ms.plan.stopSource} · TP ${ms.plan.tp2.label} · ${ms.plan.rrNote} · ${TRAIL_LABEL[ms.plan.trail]} · ${ms.invalidation}`,
        });
        if (shouldAlert(pro.engine.mtfAlerts, ms.tier)) {
          const msg = `${TIER_LABEL[ms.tier]} ${ms.side} ${symbol} · ${ms.setup} · entry ${ms.entry.toFixed(dg)}`;
          try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("AutoTrader Pro signal", { body: msg }); } catch { /* notifications unsupported */ }
          try { navigator.vibrate?.(200); } catch { /* vibration unsupported */ }
        }
      }
    }

    // ---- Record signals in the Trade Log (once per strategy/side/stage change) ----
    const shown = [result.best, ...result.early].filter((x): x is Signal => !!x);
    for (const sig of shown) {
      const k = `${symbol}|${sig.strategy}`, v = `${sig.side}|${sig.stage}|${sig.interval}`;
      if (lastSignal.current.get(k) === v) continue;
      lastSignal.current.set(k, v);
      tradeLog.record({
        kind: "signal", mode: pro.mode, strategy: sig.strategyName, symbol, side: sig.side, stage: sig.stage,
        entry: +sig.entry.toFixed(digitsFor(symbol)), stopLoss: +sig.stopLoss.toFixed(digitsFor(symbol)), takeProfit: +sig.takeProfit.toFixed(digitsFor(symbol)),
        confidence: sig.confidence, outcome: "signal", market: marketText(result),
        reasonEntry: `${sig.reason} ${sig.confirmations.filter((x) => !x.startsWith("Risk:")).join("; ")}${sig.missing.length ? ` · Missing: ${sig.missing.join("; ")}` : ""}`,
      });
    }
    for (const def of STRATEGIES) if (!shown.some((x) => x.strategy === def.id)) lastSignal.current.delete(`${symbol}|${def.id}`);

    // ---- Paper trade management (break-even, partials, trailing, SL/TP) on each trade's own chart ----
    if (pro.paper.some((p) => p.symbol === symbol)) {
      const next: PaperPosition[] = [];
      for (const pos of getProState().paper) {
        const frame = pos.symbol === symbol ? frames.find((f) => f.interval === (pos.interval ?? "5m")) : undefined;
        if (!frame) { next.push(pos); continue; }
        const posMs = INTERVAL_MS[frame.interval];
        let m = pos.managed, lastBarT = pos.lastBarT;
        for (let j = 0; j < frame.candles.length && !m.closed; j++) {
          const c = frame.candles[j];
          if (c.t <= pos.lastBarT || c.t < pos.openedAt - posMs) continue;
          m = manageTrade(m, c, frame.series.atr[j], pro.risk, pos.contract);
          if (j <= frame.i) lastBarT = c.t; // forming bar is re-checked next scan
        }
        if (m.closed) {
          const riskMoney = Math.abs(m.entry - m.initialStop) * m.lots * pos.contract;
          const pnl = +m.realized.toFixed(2);
          const outcome = Math.abs(pnl) < riskMoney * 0.05 ? "breakeven" : pnl > 0 ? "win" : "loss";
          tradeLog.updateRecord(pos.journalId, { outcome, exit: m.closed.price, pnl, rMultiple: riskMoney > 0 ? +(pnl / riskMoney).toFixed(2) : 0, closedAt: Date.now(), reasonExit: m.closed.reason },
            `Paper ${pos.managed.side === "BUY" ? "Buy" : "Sell"} ${symbol} closed: ${m.closed.reason} · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`);
        } else next.push({ ...pos, managed: m, lastBarT });
      }
      proActions.setPaper(next);
    }

    // ---- Entries ----
    const fresh = getProState();
    const entrySig = result.best ?? (fresh.mode === "paper" && fresh.paperIncludeEarly ? result.early.find((x) => x.confidence >= fresh.engine.confirmedThreshold) : undefined);
    if (fresh.mode !== "analysis" && entrySig) {
      const mode = fresh.mode;
      const account = accountState(tradeLog.journal(), mode, fresh.risk, now);
      const gate = riskGate(fresh.risk, { account, atr: result.market.atr, lastCandle: candles[i], spread, now });
      const sameOpen = mode === "paper" ? fresh.paper.some((p) => p.symbol === symbol) : false;
      if (sameOpen) gate.reasons.push(`A paper trade on ${symbol} is already open`);
      if (now > entrySig.expiresAt) gate.reasons.push("Signal expired before entry");
      const size = positionSize(symbol, entrySig.entry, entrySig.stopLoss, result.market.volatility, fresh.risk, account.equity);
      scan.gate = { ok: gate.reasons.length === 0, reasons: gate.reasons };
      scan.size = { lots: size.lots, note: size.note };
      if (scan.gate.ok && mode === "paper") {
        const d = entrySig.side === "BUY" ? 1 : -1;
        const fill = price + d * fresh.risk.slippageAtr * result.market.atr;
        const shift = fill - entrySig.entry;
        const contract = contractSizeFor(symbol, fresh.risk.contractSize);
        const id = tradeLog.record({
          kind: "trade", mode: "paper", strategy: entrySig.strategyName, symbol, side: entrySig.side, stage: entrySig.stage,
          entry: +fill.toFixed(digitsFor(symbol)), stopLoss: +(entrySig.stopLoss + shift).toFixed(digitsFor(symbol)), takeProfit: +(entrySig.takeProfit + shift).toFixed(digitsFor(symbol)),
          lots: size.lots, confidence: entrySig.confidence, outcome: "open", market: marketText(result), reasonEntry: `${entrySig.reason} ${entrySig.confirmations.filter((x) => !x.startsWith("Risk:")).join("; ")}`,
        });
        proActions.setPaper([...getProState().paper, {
          journalId: id, symbol, interval, strategy: entrySig.strategy, strategyName: entrySig.strategyName, contract, riskAmount: size.riskAmount, openedAt: now, lastBarT: candles[candles.length - 1].t,
          managed: { side: entrySig.side, entry: fill, stopLoss: entrySig.stopLoss + shift, takeProfit: entrySig.takeProfit + shift, initialStop: entrySig.stopLoss + shift, lots: size.lots, remaining: 1, realized: 0, breakEven: false, partialTaken: false, trailing: false },
        }]);
      }
      if (scan.gate.ok && mode === "live") {
        const acct = connectedAccount(portalRef.current);
        const count = fresh.tradeCount;
        if (!liveAuthorized(fresh, now)) scan.gate = { ok: false, reasons: ["Live trading is not authorised (or the 12-hour authorisation expired)"] };
        else if (!acct) scan.gate = { ok: false, reasons: ["No MetaTrader account connected — connect one on the Metatrader tab"] };
        else if (!count) scan.gate = { ok: false, reasons: ["Enter the number of trades in the market condition card"] };
        else if (entrySig.stage !== "confirmed") scan.gate = { ok: false, reasons: ["Live mode only executes confirmed signals"] };
        else if (!liveBusy.current) {
          liveBusy.current = true;
          const digits = digitsFor(symbol);
          const slDist = +Math.abs(entrySig.entry - entrySig.stopLoss).toFixed(digits), tpDist = +Math.abs(entrySig.takeProfit - entrySig.entry).toFixed(digits);
          const id = tradeLog.signal({ side: entrySig.side, symbol, sl: +entrySig.stopLoss.toFixed(digits), tp: +entrySig.takeProfit.toFixed(digits), entry: +price.toFixed(digits), confidence: entrySig.confidence, strategy: entrySig.strategyName, reason: entrySig.reason, market: marketText(result), mode: "live" });
          tradeLog.updateRecord(id, { lots: size.lots, stage: entrySig.stage });
          await sendOrders(id, acct, { symbol, side: entrySig.side, lot: size.lots, slDist, tpDist, digits, count }).finally(() => { liveBusy.current = false; });
        }
      }
    }
    return scan;
  }, [candlesFn, tvFn, sendOrders]);

  useEffect(() => {
    if (!running) { setNextAt(null); return; }
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const loop = async () => {
      setBusy(true);
      for (const sym of getProState().symbols) {
        if (!alive) break;
        const scan = await scanOne(sym).catch((e: unknown): SymbolScan => ({ symbol: sym, at: Date.now(), error: e instanceof Error ? e.message : "Scan failed" }));
        if (alive) setScans((s) => ({ ...s, [sym]: scan }));
      }
      if (!alive) return;
      setBusy(false);
      setNextAt(Date.now() + SCAN_EVERY_MS);
      t = setTimeout(loop, SCAN_EVERY_MS);
    };
    void loop();
    return () => { alive = false; clearTimeout(t); setBusy(false); };
  }, [running, scanOne]);

  /** Runs walk-forward backtests for every strategy on every scanned timeframe of real history and stores the results. */
  const runBacktest = useCallback(async (symbol: string) => {
    const pro = getProState();
    let tested = 0;
    for (const interval of SCAN_ORDER) {
      const feed = await candlesFn({ data: { symbol, interval, limit: 1200 } });
      if (!feed.ok) { tradeLog.info(`Backtest ${symbol} ${interval}: ${feed.error}`); continue; }
      const candles = feed.candles.slice(0, closedIndex(feed.candles, INTERVAL_MS[interval], Date.now()) + 1);
      const series = buildSeries(candles);
      const results = [];
      for (const def of SCAN_BOOK) {
        await new Promise((r) => setTimeout(r, 0)); // keep the page responsive between strategies
        results.push(walkForward(series, def, pro.risk, pro.engine.sessions));
      }
      const perf: Partial<Record<StrategyId, StrategyPerf>> = {};
      const params: Partial<Record<StrategyId, Record<string, number>>> = {};
      for (const r of results) { perf[r.strategy] = perfFromWalkForward(r); params[r.strategy] = r.chosen; }
      proActions.saveBacktest(perfKey(symbol, interval), { at: Date.now(), candles: candles.length, source: feed.source, results }, perf, params);
      tradeLog.info(`Backtest ${symbol} ${interval}: ${results.length} strategies tested on ${candles.length} real candles (${feed.source})`);
      tested++;
      if (interval === "15m" || (interval === "5m" && !SCAN_INTERVALS.includes("15m"))) {
        await new Promise((r) => setTimeout(r, 0));
        const test = optimizeTpSl(series, symbol, getProState().tpsl, interval);
        proActions.saveTpSlTest(marketClass(symbol), test);
        tradeLog.info(`TP/SL backtest ${symbol} ${interval}: ${test.outOfSample.trades} unseen-data trades · ${test.verdict}`);
      }
    }
    if (!tested) throw new Error(`No market data available to backtest ${symbol}`);
  }, [candlesFn]);

  /**
   * Manual execution: the user tapped Execute in the market condition card. Sends `count` orders for that signal
   * to the connected MetaTrader account with broker-side stop loss and take profit, and records them in the Trade Log.
   */
  const executeSignal = useCallback(async (symbol: string, sig: Signal, countInput: number): Promise<{ ok: boolean; message: string }> => {
    const acct = connectedAccount(portalRef.current);
    if (!acct) return { ok: false, message: "No MetaTrader account connected — connect one on the Metatrader tab first." };
    const count = parseTradeCount(countInput);
    if (!count) return { ok: false, message: "Enter the number of trades first." };
    if (Date.now() > sig.expiresAt) return { ok: false, message: "This signal has expired — wait for the next scan." };
    const p = portalRef.current;
    const scan = scans[symbol];
    const digits = digitsFor(symbol);
    const pair = p.eas.find((e) => e.id === p.activeEAId)?.symbols.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
    const pairLot = Number(pair?.lotSize);
    const lot = Number.isFinite(pairLot) && pairLot > 0 ? pairLot : scan?.size?.lots ?? 0.01;
    const ref = scan?.price ?? sig.entry;
    const slDist = +Math.abs(ref - sig.stopLoss).toFixed(digits), tpDist = +Math.abs(sig.takeProfit - ref).toFixed(digits);
    if (!(slDist > 0) || !(tpDist > 0)) return { ok: false, message: "Price has already moved past the stop or target — signal no longer valid." };
    const market = scan?.result ? marketText(scan.result) : undefined;
    const id = tradeLog.signal({ side: sig.side, symbol, sl: +sig.stopLoss.toFixed(digits), tp: +sig.takeProfit.toFixed(digits), entry: +ref.toFixed(digits), confidence: sig.confidence, strategy: sig.strategyName, reason: `Manual execute: ${sig.reason}`, market, mode: "live" });
    tradeLog.updateRecord(id, { lots: lot, stage: sig.stage });
    const { filled, error } = await sendOrders(id, acct, { symbol, side: sig.side, lot, slDist, tpDist, digits, count });
    return filled > 0
      ? { ok: true, message: `${filled} of ${count} ${sig.side} ${symbol} trade${count > 1 ? "s" : ""} (${lot} lots each) sent to ${acct.label} with stop loss and take profit.` }
      : { ok: false, message: error ?? "Rejected by broker" };
  }, [sendOrders, scans]);

  return { scans, busy, nextAt, runBacktest, executeSignal };
}
