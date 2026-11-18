import { useEffect, useState } from "react";
import { BellRing, CircleCheck, CircleDashed } from "lucide-react";
import { tradeLog } from "@/lib/trade-log";
import { performanceBreakdown, type BreakdownKey } from "@/lib/autotrader-pro/account";
import { proActions, useProState } from "@/lib/autotrader-pro/store";
import { DEFAULT_MTF_ALERTS, TIER_LABEL, type MtfMode, type Tier } from "@/lib/autotrader-pro/mtf";
import type { SymbolScan } from "@/lib/autotrader-pro/useAutoTraderPro";
import type { SmcRead } from "@/lib/autotrader-pro/smc";
import { fmt, Panel, sideTone, Stat } from "./ui-bits";
import { TpSlCard } from "./TpSlPanel";

const biasTone = (b: SmcRead["bias"]) => (b === "bullish" ? "text-primary" : b === "bearish" ? "text-destructive" : "text-muted-foreground");
const ORDER = ["1h", "30m", "15m", "5m", "1m"];
const MODES: MtfMode[] = ["aggressive", "balanced", "strict"];
const TIERS: Tier[] = ["early", "confirmed", "high"];
const BY: { key: BreakdownKey; label: string }[] = [{ key: "symbol", label: "Symbol" }, { key: "session", label: "Session" }, { key: "volatility", label: "Volatility" }];
const chip = (on: boolean) => `rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`;

/** Per-grade alert switches and closed-trade results split by symbol / session / volatility. */
function AlertsAndPerformance() {
  const pro = useProState();
  const alerts = { ...DEFAULT_MTF_ALERTS, ...pro.engine.mtfAlerts };
  const [by, setBy] = useState<BreakdownKey>("symbol");
  const [perm, setPerm] = useState<string>("default");
  const [rows, setRows] = useState<[string, ReturnType<typeof performanceBreakdown>[string]][]>([]);
  const mode = pro.mode === "live" ? "live" : "paper";
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  useEffect(() => { setRows(Object.entries(performanceBreakdown(tradeLog.journal(), mode, by)).sort((a, b) => b[1].trades - a[1].trades)); }, [by, mode, pro]);
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <BellRing className="size-3.5 text-muted-foreground" /><span className="mr-1 font-semibold">Alerts</span>
        {TIERS.map((t) => (
          <button key={t} type="button" aria-pressed={alerts[t]} className={chip(alerts[t])} onClick={() => proActions.setEngine({ mtfAlerts: { ...alerts, [t]: !alerts[t] } })}>{TIER_LABEL[t]}</button>
        ))}
        {perm !== "granted" && typeof Notification !== "undefined" && (
          <button type="button" className="ml-auto text-[10px] font-semibold text-primary underline" onClick={() => Notification.requestPermission().then(setPerm)}>Allow device notifications</button>
        )}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 font-semibold">{mode === "live" ? "Live" : "Paper"} results by</span>
          {BY.map((b) => <button key={b.key} type="button" aria-pressed={by === b.key} className={chip(by === b.key)} onClick={() => setBy(b.key)}>{b.label}</button>)}
        </div>
        {rows.length ? (
          <table className="mt-2 w-full text-[11px]">
            <thead className="text-muted-foreground"><tr className="text-left"><th className="font-medium">{BY.find((b) => b.key === by)?.label}</th><th className="font-medium">Trades</th><th className="font-medium">Win</th><th className="font-medium">PF</th><th className="font-medium">Exp R</th></tr></thead>
            <tbody>{rows.map(([k, g]) => (
              <tr key={k} className="border-t border-border"><td className="py-1 capitalize">{k}</td><td>{g.trades}</td><td>{Math.round(g.winRate * 100)}%</td><td>{g.profitFactor.toFixed(2)}</td><td className={g.expectancyR >= 0 ? "text-primary" : "text-destructive"}>{g.expectancyR.toFixed(2)}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="mt-2 text-[11px] text-muted-foreground">No closed {mode} trades yet.</p>}
      </div>
    </div>
  );
}

/** Top-down 1H→1M Smart Money view: per-timeframe structure plus the graded confluence signal. Display only — never places orders. */
export function MtfPanel({ scan, now }: { scan?: SymbolScan; now: number }) {
  const pro = useProState();
  const mode = pro.engine.mtfMode ?? "balanced";
  if (!scan?.smc?.length) return null;
  const rows = [...scan.smc].sort((a, b) => ORDER.indexOf(a.interval) - ORDER.indexOf(b.interval));
  const sig = scan.mtf?.signal;
  return (
    <Panel title="Multi-timeframe SMC" right={
      <div className="flex gap-1" role="group" aria-label="Confluence threshold">
        {MODES.map((m) => (
          <button key={m} type="button" onClick={() => proActions.setEngine({ mtfMode: m })} aria-pressed={m === mode}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${m === mode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{m}</button>
        ))}
      </div>
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground"><tr className="text-left"><th className="pr-2 font-medium">TF</th><th className="pr-2 font-medium">Bias</th><th className="pr-2 font-medium">Structure</th><th className="pr-2 font-medium">Zone</th><th className="pr-2 font-medium">Liquidity</th><th className="font-medium">OB / FVG</th></tr></thead>
          <tbody>
            {rows.map(({ interval, read: r }) => (
              <tr key={interval} className="border-t border-border align-top">
                <td className="py-1.5 pr-2 font-mono font-bold">{interval.toUpperCase()}</td>
                <td className={`py-1.5 pr-2 font-semibold ${biasTone(r.bias)}`}>{r.bias}</td>
                <td className="py-1.5 pr-2">{r.event ? `${r.event.kind} ${r.event.dir}${r.freshEvent ? " •" : ""}` : "—"}{r.displacement ? ` · disp ${r.displacement.dir}` : ""}</td>
                <td className="py-1.5 pr-2">{r.zone}{r.ote ? ` · OTE ${r.ote}` : ""}</td>
                <td className="py-1.5 pr-2 font-mono">{r.bsl[0] !== undefined ? `B ${fmt(r.bsl[0])}` : ""}{r.ssl[0] !== undefined ? ` S ${fmt(r.ssl[0])}` : ""}{r.sweep ? ` · swept ${r.sweep.side === "BUY" ? "SSL" : "BSL"}` : ""}</td>
                <td className="py-1.5">{[r.orderBlock?.label, r.breaker?.label, r.fvg?.label, r.ifvg?.label, r.liquidityVoid?.label, r.inducement ? `inducement ${fmt(r.inducement.level)}` : undefined].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sig ? (
        <div className="mt-3 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`font-bold ${sideTone(sig.side)}`}>{TIER_LABEL[sig.tier]} {sig.side} · <span className="text-foreground">{sig.setup}</span>{sig.countertrend && <span className="ml-1 text-[10px] text-muted-foreground">countertrend</span>}</div>
            <div className="text-[11px] text-muted-foreground">{sig.score}/{sig.maxScore} steps · expires in {Math.max(0, Math.round((sig.expiresAt - now) / 60000))}m</div>
          </div>
          <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Stat label="Entry" value={fmt(sig.entry)} /><Stat label="Stop" value={fmt(sig.stopLoss)} tone="text-destructive" />
            <Stat label="TP1" value={fmt(sig.tp1)} tone="text-primary" /><Stat label="TP2" value={fmt(sig.tp2)} tone="text-primary" />
            <Stat label="TP3" value={fmt(sig.tp3)} tone="text-primary" /><Stat label="RR" value={`${sig.rr1} / ${sig.rr2} / ${sig.rr3}`} />
          </div>
          {sig.plan && <TpSlCard plan={sig.plan} symbol={scan.symbol} />}
          <ul className="mt-2 space-y-1">
            {sig.steps.map((s) => (
              <li key={s.key} className="flex items-start gap-1.5 text-[11px]">{s.ok ? <CircleCheck className="mt-0.5 size-3 text-primary shrink-0" /> : <CircleDashed className="mt-0.5 size-3 text-muted-foreground shrink-0" />}<span><b>{s.label}:</b> {s.detail}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">Score {sig.confidence}/100 from confluence and measured strategy results — not a win probability. {sig.invalidation}. Analysis only: no order is placed from this card.</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No graded setup: {scan.mtf?.reason ?? "waiting for data"}.{scan.mtf?.developing[0] ? ` Developing ${scan.mtf.developing[0].side} (${scan.mtf.developing[0].score} steps): ${scan.mtf.developing[0].steps.filter((s) => s.ok).map((s) => s.label).join(", ") || "none yet"}.` : ""}</p>
      )}
      <AlertsAndPerformance />
    </Panel>
  );
}
