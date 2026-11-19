import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { executeTrade } from "@/lib/metaapi.functions";
import { getCandles } from "@/lib/market-data.functions";
import { getGeminiVerdict } from "@/lib/gemini.functions";
import { getMarketCalendar } from "@/lib/fundamentals.functions";
import { newsBlackout, NEWS_AFTER_MIN, NEWS_BEFORE_MIN, type MarketEvent } from "@/lib/fundamentals";
import { tradeLog } from "@/lib/trade-log";
import { usePortalStore } from "@/lib/portal-store";
import { emailSignal } from "@/lib/signal-email.functions";
import { scanProSignal, type CandlesFn } from "@/lib/autotrader-pro/pro-signal";
import { capLoss } from "@/lib/autotrader-pro/loss-cap";
import { smallAccount } from "@/lib/small-account-prefs";
import { loadRobotProState } from "@/lib/autotrader-pro/shared-config-client";

interface Opts {
  eaId?: string | null; eaName?: string | null;
  login?: string | null; password?: string | null; server?: string | null;
  enabled: boolean;
}

/** Re-scan each pair this often; AutoTrader Pro reads closed candles so a signal repeats until its bar changes. */
const SCAN_MS = 15_000;
const WAIT_RELOG_MS = 5 * 60 * 1000;
// One global lock so overlapping effect runs can never fire trades at once.
let globalBusy = false;

/**
 * Home-page robot. Signals come from the AutoTrader Pro engine (every Pro timeframe, confirmed setups only,
 * market-based stop/target). It never reads balance or positions; lot size and trade count come from each pair,
 * and orders carry broker-side SL/TP. Every START scans at once and gives a signal; after one trade it holds until STOP EA → START.
 */
export function useAutoScalp({ eaId, eaName, login, password, server, enabled }: Opts) {
  const exec = useServerFn(executeTrade);
  const candles = useServerFn(getCandles) as unknown as CandlesFn;
  const mail = useServerFn(emailSignal);
  const gemini = useServerFn(getGeminiVerdict);
  const calendar = useServerFn(getMarketCalendar);
  const { eas, activatedEmail } = usePortalStore();
  const symbols = (eas.find((e) => e.id === eaId)?.symbols ?? []).filter((s) => s.allowed);
  const key = JSON.stringify(symbols.map((s) => [s.symbol, s.lotSize, s.trades, s.action, s.platform]));

  useEffect(() => {
    if (!enabled || !eaId || symbols.length === 0) return;
    const runVersion = tradeLog.version();
    let alive = true;
    const canExecute = () => alive && tradeLog.canExecute(eaId, runVersion);
    let busy = false;
    const nextScan = new Map<string, number>();
    const waitLogged = new Map<string, { at: number; reason: string }>();
    // High-impact news blackout: calendar refreshed every 15 min; if it can't load, trading is not blocked.
    let news: { at: number; events: MarketEvent[] } = { at: 0, events: [] };
    const newsEvents = async () => {
      if (Date.now() - news.at > 15 * 60_000) {
        const r = await calendar().catch(() => null);
        news = { at: Date.now(), events: r && r.ok ? r.events : news.events };
      }
      return news.events;
    };

    const tick = async () => {
      if (busy || !canExecute() || globalBusy) return;
      busy = true; globalBusy = true;
      try {
        for (const s of symbols) {
          if (!canExecute()) return;
          if (Date.now() < (nextScan.get(s.symbol) ?? 0)) continue;
          nextScan.set(s.symbol, Date.now() + SCAN_MS);
          const blocked = newsBlackout(await newsEvents(), s.symbol, Date.now());
          if (!canExecute()) return;
          if (blocked) {
            const reason = `News blackout: ${blocked.currency} ${blocked.title} at ${new Date(blocked.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — no new trades ${NEWS_BEFORE_MIN} min before to ${NEWS_AFTER_MIN} min after`;
            const last = waitLogged.get(s.symbol);
            if (!last || last.reason !== reason || Date.now() - last.at >= WAIT_RELOG_MS) {
              waitLogged.set(s.symbol, { at: Date.now(), reason });
              tradeLog.wait({ symbol: s.symbol, reason });
              tradeLog.scanning();
            }
            continue;
          }
          const sig = await scanProSignal(s.symbol, candles, Date.now(), await loadRobotProState(), (symbol) => gemini({ data: { symbol } }));
          if (!canExecute()) return;
          if (!sig.ok) { tradeLog.error(`>> ${s.symbol}: market data unavailable (${sig.error.slice(0, 120)}) — retrying`); continue; }
          if (sig.side === "WAIT") {
            const last = waitLogged.get(s.symbol);
            if (!last || last.reason !== sig.reason || Date.now() - last.at >= WAIT_RELOG_MS) {
              waitLogged.set(s.symbol, { at: Date.now(), reason: sig.reason });
              tradeLog.wait({ symbol: s.symbol, reason: `AutoTrader Pro: ${sig.reason}` });
              tradeLog.scanning();
            }
            continue;
          }
          waitLogged.delete(s.symbol);
          const side = sig.side;
          const dir = String(s.action || "BOTH").toUpperCase();
          if (dir !== "BOTH" && dir !== side) continue; // pair set to one direction only
          const digits = /JPY/i.test(s.symbol) ? 3 : /XAU|GOLD|XAG|US30|NAS|SPX|GER|UK|BTC|ETH/i.test(s.symbol) ? 2 : 5;
          const round = (n: number) => +n.toFixed(digits);
          const price = round(sig.entry), sl = round(sig.stopLoss), tp = round(sig.takeProfit);
          const slDist = Math.abs(price - sl), tpDist = Math.abs(tp - price);
          if (![sl, tp, slDist, tpDist].every((n) => Number.isFinite(n) && n > 0) || (side === "BUY" ? !(sl < price && price < tp) : !(tp < price && price < sl))) continue;
          let lot = Math.max(0.01, Number(s.lotSize) || 0.01);
          let count = Math.max(1, Math.min(20, parseInt(String(s.trades ?? "1"), 10) || 1));
          let reason = sig.reason;
          const sa = smallAccount.get();
          // Loss limit (default R100): all trades of this signal together never lose more than the limit at the stop.
          if (sa.lossCap && Number(sa.maxLoss) > 0) {
            const c = capLoss({ symbol: s.symbol, entry: price, stop: sl, lot, trades: count, maxLoss: Number(sa.maxLoss), currency: sa.currency, cent: sa.cent });
            if (!c.ok) {
              const why = `Loss limit: ${c.reason}`;
              const last = waitLogged.get(s.symbol);
              if (!last || last.reason !== why || Date.now() - last.at >= WAIT_RELOG_MS) {
                waitLogged.set(s.symbol, { at: Date.now(), reason: why });
                tradeLog.wait({ symbol: s.symbol, reason: why });
                tradeLog.scanning();
              }
              continue;
            }
            lot = c.lot; count = c.trades; reason = `${c.note} · ${reason}`;
          }
          // One stop loss and one take profit for every trade: the AutoTrader Pro market-based plan.
          const groups = [{ count, tpDist }];
          const shownTp = tp;
          if (activatedEmail) void mail({ data: { to: activatedEmail, symbol: s.symbol, side, entry: price, sl, tp: shownTp, confidence: sig.confidence, reasons: [reason] } }).catch(() => undefined);
          if (!canExecute()) return;
          const id = tradeLog.signal({ side, symbol: s.symbol, sl, tp: shownTp, entry: price, confidence: sig.confidence, strategy: `AutoTrader Pro · ${sig.strategy}${sig.grade ? ` · Grade ${sig.grade}` : ""}`, reason: reason.slice(0, 300), mode: "live" });
          if (!login || !password || !server) { tradeLog.executed(id, 0, count, "No MetaTrader account connected"); continue; }
          try {
            let done = 0, okAny = false, err: string | undefined;
            for (const g of groups) {
              if (!canExecute()) break;
              const res = (await exec({ data: {
                platform: String(s.platform).toUpperCase() === "MT5" ? "mt5" : "mt4",
                login, password, server, symbol: s.symbol, side, lot,
                slDist: round(slDist) || slDist, tpDist: round(g.tpDist) || g.tpDist, digits,
                comment: `${eaName ?? "AlgoVault"}~AlgoVault`, count: g.count,
              } })) as { ok?: boolean; error?: string; results?: Array<{ ok: boolean }> };
              done += (res.results ?? []).filter((x) => x.ok).length || (res?.ok ? g.count : 0);
              okAny ||= !!res?.ok;
              err = res?.error ?? (res?.ok ? err : "Rejected by broker");
            }
            if (okAny) {
              tradeLog.executed(id, done, count, done < count ? err : undefined);
              tradeLog.holdAfterTrade(); // stays on but holds until STOP EA → START
              return;
            }
            tradeLog.executed(id, 0, count, err ?? "Rejected by broker");
          } catch (e) { tradeLog.executed(id, 0, count, e instanceof Error ? e.message : "Network error"); }
        }
      } finally { busy = false; globalBusy = false; }
    };

    void tick();
    const t = setInterval(() => { if (canExecute()) tradeLog.scanning(); void tick(); }, 1000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, eaId, eaName, login, password, server, key, activatedEmail]);
}
