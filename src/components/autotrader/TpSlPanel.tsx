import { DEFAULT_TPSL, MARKET_LABEL, positionPlan, TRAIL_LABEL, type MarketClass, type TpSlMetrics, type TpSlPlan, type TrailMethod } from "@/lib/autotrader-pro/tpsl";
import { proActions, useProState } from "@/lib/autotrader-pro/store";
import type { VolatilityClass } from "@/lib/autotrader-pro/types";
import { fmt, Panel, pct, Stat } from "./ui-bits";

const money = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—");

/** Colour-coded price ladder: targets, entry and stop placed by price (top = highest). */
function Ladder({ plan }: { plan: TpSlPlan }) {
  const rows = [
    { k: "TP3", x: plan.tp3.x, c: "bg-primary/40" }, { k: "TP2", x: plan.tp2.x, c: "bg-primary/70" }, { k: "TP1", x: plan.tp1.x, c: "bg-primary" },
    { k: "Entry", x: plan.entry, c: "bg-foreground" }, { k: "SL", x: plan.stop, c: "bg-destructive" },
  ];
  const hi = Math.max(...rows.map((r) => r.x)), lo = Math.min(...rows.map((r) => r.x)), span = hi - lo || 1;
  return (
    <div className="relative h-36 rounded-xl bg-secondary/50" aria-label="Trade levels">
      {rows.map((r) => (
        <div key={r.k} className="absolute inset-x-2 flex items-center gap-2" style={{ top: `${6 + ((hi - r.x) / span) * 82}%` }}>
          <span className={`h-0.5 flex-1 rounded ${r.c}`} />
          <span className="font-mono text-[10px]">{r.k} {fmt(r.x)}</span>
        </div>
      ))}
    </div>
  );
}

/** Full TP/SL breakdown for a graded signal: distances, money at each level, sources and trailing plan. */
export function TpSlCard({ plan, symbol }: { plan: TpSlPlan; symbol: string }) {
  const pro = useProState();
  const pos = positionPlan(symbol, plan, pro.risk, pro.tpsl);
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_180px]">
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="SL distance" value={fmt(pos.slDistance)} tone="text-destructive" />
          <Stat label="TP1 / TP2 / TP3 dist" value={pos.tpDistance.map((d) => fmt(d)).join(" / ")} />
          <Stat label="RR 1 / 2 / 3" value={`${plan.rr1} / ${plan.rr2} / ${plan.rr3}`} tone={plan.rrOk ? "text-primary" : ""} />
          <Stat label="Position size" value={`${pos.lots} lot`} />
          <Stat label="Risk" value={`${pos.riskPct.toFixed(2)}%`} />
          <Stat label="Loss at SL" value={`-${money(pos.lossAtSl)}`} tone="text-destructive" />
          <Stat label="Profit at TP1" value={money(pos.profit[0])} tone="text-primary" />
          <Stat label="Profit at TP2" value={money(pos.profit[1])} tone="text-primary" />
          <Stat label="Profit at TP3" value={money(pos.profit[2])} tone="text-primary" />
        </div>
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          <li><b className="text-foreground">Stop:</b> {plan.stopSource} · {plan.volatility} volatility ({plan.stopMult}×ATR floor)</li>
          <li><b className="text-foreground">Targets:</b> TP1 {plan.tp1.label} · TP2 {plan.tp2.label} · TP3 {plan.tp3.label}</li>
          <li><b className="text-foreground">Reward filter:</b> {plan.rrNote}</li>
          <li><b className="text-foreground">Management:</b> close {pro.tpsl.tp1ClosePct}% at TP1{pro.tpsl.breakEvenAfterTp1 ? " then stop to break-even" : ""}, {pro.tpsl.tp2ClosePct}% at TP2, rest runs with {TRAIL_LABEL[plan.trail]} (starts at {pro.tpsl.trailActivateR}R)</li>
        </ul>
      </div>
      <Ladder plan={plan} />
    </div>
  );
}

const num = "w-full rounded-lg border border-border bg-background px-2 py-1 font-mono text-xs";
function Field({ label, value, step = 0.1, onChange }: { label: string; value: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}
      <input type="number" step={step} value={value} className={num} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) onChange(n); }} />
    </label>
  );
}

function MetricsRow({ title, m }: { title: string; m: TpSlMetrics }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-2 font-medium">{title}</td><td className="pr-2">{m.trades}</td><td className="pr-2">{pct(m.winRate)}</td>
      <td className="pr-2">{m.profitFactor >= 99 ? "∞" : m.profitFactor.toFixed(2)}</td><td className="pr-2">{m.expectancyR.toFixed(2)}R</td>
      <td className="pr-2">{m.avgWinR.toFixed(2)} / {m.avgLossR.toFixed(2)}</td><td className="pr-2">{m.maxDrawdownR.toFixed(1)}R</td>
      <td className="pr-2">{pct(m.tp1Rate)} / {pct(m.tp2Rate)} / {pct(m.tp3Rate)}</td><td className="pr-2">{pct(m.slRate)}</td><td>{m.trailExits} ({m.trailAvgR.toFixed(2)}R)</td>
    </tr>
  );
}

/** TP/SL engine settings and per-market backtest results (filled by "Run backtest"). */
export function TpSlSettingsPanel() {
  const pro = useProState();
  const t = pro.tpsl;
  const setMult = (v: VolatilityClass, n: number) => proActions.setTpSl({ atrMult: { ...t.atrMult, [v]: n } });
  return (
    <Panel title="TP / SL engine" right={<button type="button" className="text-[10px] text-muted-foreground underline" onClick={() => proActions.setTpSl(DEFAULT_TPSL)}>Reset</button>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(["low", "normal", "high", "extreme"] as VolatilityClass[]).map((v) => <Field key={v} label={`${v} vol × ATR`} value={t.atrMult[v]} onChange={(n) => setMult(v, n)} />)}
        <Field label="Min main RR (TP2)" value={t.minMainRR} onChange={(n) => proActions.setTpSl({ minMainRR: n })} />
        <Field label="Max stop × ATR" value={t.maxStopAtr} onChange={(n) => proActions.setTpSl({ maxStopAtr: n })} />
        <Field label="Close % at TP1" value={t.tp1ClosePct} step={5} onChange={(n) => proActions.setTpSl({ tp1ClosePct: Math.min(100, n) })} />
        <Field label="Close % at TP2" value={t.tp2ClosePct} step={5} onChange={(n) => proActions.setTpSl({ tp2ClosePct: Math.min(100, n) })} />
        <Field label="Trail starts at R" value={t.trailActivateR} onChange={(n) => proActions.setTpSl({ trailActivateR: n })} />
        <Field label="Trail × ATR" value={t.trailAtrMult} onChange={(n) => proActions.setTpSl({ trailAtrMult: n })} />
        <Field label="Profit lock %" value={t.profitLockPct} step={5} onChange={(n) => proActions.setTpSl({ profitLockPct: Math.min(100, n) })} />
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Trailing method
          <select className={num} value={t.trail} onChange={(e) => proActions.setTpSl({ trail: e.target.value as "auto" | TrailMethod })}>
            <option value="auto">Auto</option>{(Object.keys(TRAIL_LABEL) as TrailMethod[]).map((m) => <option key={m} value={m}>{TRAIL_LABEL[m]}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={t.breakEvenAfterTp1} onChange={(e) => proActions.setTpSl({ breakEvenAfterTp1: e.target.checked })} /> Break-even after TP1</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={t.rejectExtreme} onChange={(e) => proActions.setTpSl({ rejectExtreme: e.target.checked })} /> Reject entries in extreme volatility</label>
      </div>
      <h3 className="mt-4 mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Backtest by market (spread, commission and slippage included)</h3>
      {(Object.keys(MARKET_LABEL) as MarketClass[]).map((m) => {
        const r = pro.tpslTests[m], o = pro.tpslByMarket[m];
        return (
          <div key={m} className="mt-2 rounded-xl border border-border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">{MARKET_LABEL[m]}
              {r ? <span className="text-[10px] font-normal text-muted-foreground">{r.symbol} {r.interval} · {r.candles} candles · {new Date(r.at).toLocaleString()}</span> : <span className="text-[10px] font-normal text-muted-foreground">Not tested — run a backtest on a {m === "xau" ? "XAUUSD" : m} symbol</span>}
            </div>
            {r && (
              <>
                <div className="overflow-x-auto"><table className="mt-1 w-full text-[10px]">
                  <thead className="text-muted-foreground"><tr className="text-left"><th /><th>Trades</th><th>Win</th><th>PF</th><th>Exp.</th><th>Avg win/loss</th><th>Max DD</th><th>TP1/2/3 hit</th><th>SL hit</th><th>Trail exits</th></tr></thead>
                  <tbody>
                    <MetricsRow title="Unseen data" m={r.outOfSample} /><MetricsRow title="Defaults (unseen)" m={r.baseline} />
                    {(Object.keys(r.byTrail) as TrailMethod[]).map((k) => <MetricsRow key={k} title={TRAIL_LABEL[k]} m={r.byTrail[k]!} />)}
                  </tbody>
                </table></div>
                <p className="mt-1 text-[10px] text-muted-foreground">{r.verdict}. {o && Object.keys(o).length ? `In use for ${MARKET_LABEL[m]}: ${o.minMainRR}R min, ${o.trail} trail, normal ${o.atrMult?.normal}×ATR.` : "Your own settings are in use."}
                  {o && Object.keys(o).length ? <button type="button" className="ml-1 underline" onClick={() => proActions.resetTpSlMarket(m)}>Use my settings</button> : null}</p>
              </>
            )}
          </div>
        );
      })}
    </Panel>
  );
}
