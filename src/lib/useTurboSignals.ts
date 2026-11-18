import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pullManualSignals } from "@/lib/manual-signals.functions";
import { executeTrade } from "@/lib/metaapi.functions";
import { confirmSignal } from "@/lib/signal-confirm.functions";
import { tradeLog } from "@/lib/trade-log";
import { botCodeFor, usePortalStore } from "@/lib/portal-store";

export function magicForEA(eaId: string): number {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(`ea.magic.${eaId}`);
    if (v && Number(v) > 0) return Number(v);
  }
  return Number(botCodeFor(eaId));
}

interface TurboOpts {
  eaId?: string | null;
  eaName?: string | null;
  login?: string | null;
  password?: string | null;
  server?: string | null;
  enabled?: boolean;
  /** ISO time the bot was switched on — older signals are ignored. */
  since?: string | null;
}

/**
 * Turbo receiver: polls the cloud fast lane every 700ms, writes the signal to
 * the trade log the instant it lands, then executes it on the connected MT4
 * account — no terminal round-trip, no pending state.
 */
export function useTurboSignals({ eaId, eaName, login, password, server, enabled = false, since = null }: TurboOpts) {
  const pull = useServerFn(pullManualSignals);
  const exec = useServerFn(executeTrade);
  const confirm = useServerFn(confirmSignal);
  const { eas, metaPlatform, activatedEmail } = usePortalStore();
  // Symbol setups decide where a signal executes (MT4 or MT5), the lot size and
  // how many trades — same config as the Symbols / Pairs page.
  const symbols = eas.find((e) => e.id === eaId)?.symbols ?? [];
  const setupKey = JSON.stringify(symbols.map((s) => [s.symbol, s.platform, s.lotSize, s.trades]));

  useEffect(() => {
    if (!enabled || !eaId) return;
    const runVersion = tradeLog.version();
    const magic = magicForEA(eaId);
    if (!magic) return;
    let alive = true;
    const canExecute = () => alive && tradeLog.canExecute(eaId, runVersion);
    let busy = false;

    const tick = async () => {
      if (!canExecute() || busy) return;
      busy = true;
      try {
        const rows = (await pull({ data: { magic, since, email: activatedEmail } })) as Array<{
          id: string; symbol: string; side: string; lot: number;
          stop_loss: number | null; take_profit: number | null; created_at?: string;
        }>;
        for (const r of rows) {
          if (!canExecute()) return;
          // A signal older than 2 minutes is stale — never replay it late.
          if (r.created_at && Date.now() - new Date(r.created_at).getTime() > 120000) continue;
          const side = r.side === "SELL" ? "SELL" : "BUY";
          const setup = symbols.find((s) => s.symbol.toLowerCase() === r.symbol.toLowerCase());
          const platform = (String(setup?.platform ?? metaPlatform ?? "mt4").toUpperCase() === "MT5" ? "mt5" : "mt4") as "mt4" | "mt5";
          const lot = Number(r.lot) || Number(setup?.lotSize) || 0.01;
          const count = Math.max(1, Math.min(20, parseInt(setup?.trades || "1") || 1));
          const tradeId = tradeLog.signal({ side, symbol: r.symbol, sl: r.stop_loss ?? "—", tp: r.take_profit ?? "—" });
          if (!login || !password || !server) {
            tradeLog.executed(tradeId, 0, count, "No MetaTrader account connected");
            continue;
          }
          try {
            const v = await confirm({ data: { symbol: r.symbol, side, stopLoss: r.stop_loss, takeProfit: r.take_profit } });
            if (!v.confirm) {
              tradeLog.executed(tradeId, 0, count, `Skipped: ${v.reason}`);
              continue;
            }
          } catch {
            tradeLog.executed(tradeId, 0, count, "Market check failed — trade skipped");
            continue;
          }
          try {
            if (!canExecute()) return;
            const res = (await exec({ data: {
              platform, login, password, server,
              symbol: r.symbol, side, lot,
              sl: r.stop_loss ?? undefined, tp: r.take_profit ?? undefined,
              comment: `${eaName ?? "AlgoVault"}~AlgoVault`,
              count,
            } })) as { ok?: boolean; ticket?: number | string | null; error?: string; results?: Array<{ ok: boolean }> };
            const done = (res?.results ?? []).filter((x) => x.ok).length || (res?.ok ? 1 : 0);
            tradeLog.executed(tradeId, done, count, res?.error ?? (done ? undefined : "Rejected by broker"));
            // The bot stays on but holds: no more scanning until STOP EA → START.
            if (done > 0) tradeLog.holdAfterTrade();
          } catch (e) {
            tradeLog.executed(tradeId, 0, count, e instanceof Error ? e.message : "Network error");
          }
          if (canExecute()) tradeLog.scanning();
        }
      } catch {
        /* keep polling silently */
      } finally {
        busy = false;
      }
    };

    void tick();
    const t = setInterval(tick, 700);
    return () => { alive = false; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, eaId, eaName, login, password, server, since, pull, exec, setupKey, metaPlatform, confirm]);
}
