import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { useProState } from "@/lib/autotrader-pro/store";
import { entryPerf, libraryStatus, STRATEGY_LIBRARY, type LibraryStatus } from "@/lib/autotrader-pro/strategy-library";
import { SYMBOL_PROFILES } from "@/lib/autotrader-pro/symbol-fit";
import { Panel, pct } from "./ui-bits";

const ORDER: LibraryStatus[] = ["validated", "tested", "untested", "underperforming", "disabled"];

/** Searchable 900+ configuration library; status comes only from stored backtest/paper results. */
export function StrategyLibraryPanel() {
  const pro = useProState();
  const [q, setQ] = useState("");
  const rows = useMemo(() => STRATEGY_LIBRARY.map((e) => {
    const perf = entryPerf(e, pro.perf);
    return { e, perf, status: libraryStatus(perf, pro.engine.enabled[e.strategy] !== false) };
  }), [pro.perf, pro.engine.enabled]);
  const counts = ORDER.map((s) => [s, rows.filter((r) => r.status === s).length] as const);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(({ e, status }) => !needle || `${e.name} ${e.interval} ${SYMBOL_PROFILES[e.market].label} ${e.mode} ${e.role} ${status}`.toLowerCase().includes(needle))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).slice(0, 60);
  return (
    <Panel title={`Strategy library · ${STRATEGY_LIBRARY.length.toLocaleString()} configurations`}>
      <div className="flex flex-wrap gap-2 text-[11px]">
        {counts.map(([s, n]) => <span key={s} className="rounded-full border border-border px-2 py-0.5 capitalize text-muted-foreground">{s} {n}</span>)}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Each strategy × timeframe (1m/5m/15m) × market type it suits. Results come only from your backtests and paper trades — run a backtest to test a configuration.</p>
      <Input className="mt-3" placeholder="Search: gold, 5m, breakout, untested…" value={q} onChange={(ev) => setQ(ev.target.value)} />
      <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
        {shown.map(({ e, perf, status }) => (
          <li key={e.id} className="rounded-xl border border-border p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{e.name}</span>
              <span className="shrink-0 capitalize text-muted-foreground">{status}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">{e.interval} · {SYMBOL_PROFILES[e.market].label} · {e.mode} · {e.role}{perf ? ` · ${perf.trades} trades · win ${pct(perf.winRate)} · PF ${perf.profitFactor.toFixed(2)}` : ""}</div>
            <div className="mt-1 text-[11px]">Entry: {e.entry}</div>
            <div className="text-[11px] text-muted-foreground">Direction: {e.direction}. Stop: {e.stop}. Exit: {e.exit}.</div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
