import { useEffect, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, Clock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { proActions, useProState } from "@/lib/autotrader-pro/store";
import { strategyById } from "@/lib/autotrader-pro/strategies";
import { GROUP_LABEL, nextOpens, ORDER_FLOW_NOTE, sastTime, V3_LABEL, YIELDS_NOTE, type ChangeRead } from "@/lib/autotrader-pro/market-change";
import type { SymbolScan } from "@/lib/autotrader-pro/useAutoTraderPro";
import { fmt, Panel, Stat } from "./ui-bits";

const ORDER = ["1m", "5m", "15m", "30m", "1h"];
const dirTone = (d: ChangeRead["direction"]) => (d === "bullish" ? "text-primary" : d === "bearish" ? "text-destructive" : "text-muted-foreground");
const DirIcon = ({ d }: { d: ChangeRead["direction"] }) => (d === "bullish" ? <ArrowUpRight className="size-3.5" /> : d === "bearish" ? <ArrowDownRight className="size-3.5" /> : <ArrowRight className="size-3.5" />);
const scoreTone = (n: number) => (n >= 65 ? "text-destructive" : n >= 40 ? "text-primary" : "text-muted-foreground");

/** V3 market-change dashboard: score, regime transitions, per-timeframe alerts, sessions (SAST), zones, volume and correlation. */
export function MarketChangePanel({ scan, now }: { scan?: SymbolScan; now: number }) {
  const pro = useProState();
  const [opens, setOpens] = useState<{ name: string; at: number }[]>([]);
  useEffect(() => { setOpens(nextOpens(Date.now())); }, [Math.floor(now / 300_000)]);
  const ch = scan?.change;
  const frames = [...(ch?.frames ?? [])].sort((a, b) => ORDER.indexOf(a.interval) - ORDER.indexOf(b.interval));
  const lead = frames.find((f) => f.interval === scan?.interval) ?? frames.find((f) => f.interval === "15m") ?? frames[0];
  const s15 = (frames.find((f) => f.interval === "15m") ?? lead)?.session;
  const confirm = pro.engine.changeConfirmBars ?? 3, hold = pro.engine.changeMinHold ?? 5;

  return (
    <Panel title="Market change detection" right={<span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="size-3" />{sastTime(now)} SAST</span>}>
      {!lead ? (
        <p className="text-sm text-muted-foreground">Start scanning to read how the market is changing on 1M, 5M, 15M, 30M and 1H.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[auto_1fr] items-center gap-3">
            <div className="grid size-20 place-items-center rounded-2xl bg-secondary/70">
              <div className="text-center">
                <div className={`font-mono text-2xl font-bold ${scoreTone(lead.score)}`}>{lead.score}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Change score</div>
              </div>
            </div>
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold">{V3_LABEL[lead.regime]}</div>
              <div className="text-xs text-muted-foreground">Previous: {lead.previous ? V3_LABEL[lead.previous] : "—"}{lead.changedAgo !== undefined ? ` · changed ${lead.changedAgo} bar(s) ago` : ""}</div>
              <div className={`inline-flex items-center gap-1 text-xs font-semibold ${dirTone(lead.direction)}`}><DirIcon d={lead.direction} />Transition {lead.direction} · evidence {lead.evidence}/100</div>
            </div>
          </div>
          {lead.earlyTransition && <p className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">{lead.earlyTransition}</p>}
          <div className="rounded-xl bg-secondary/50 p-3 text-xs space-y-1">
            <div><span className="text-muted-foreground">Recommended ({lead.interval.toUpperCase()}): </span><b>{GROUP_LABEL[lead.group]}</b></div>
            <div className="text-muted-foreground">{lead.strategies.map((id) => strategyById(id).name).join(" · ")}</div>
            {lead.adaptation.riskScale < 1 && <div className="text-destructive">Reduce exposure: risk ×{lead.adaptation.riskScale} suggested</div>}
            <div className="text-muted-foreground">Why: {lead.reason}</div>
          </div>
          <p className="text-[10px] text-muted-foreground">The change score and evidence are explainable weights from live candles, not a guaranteed probability of a reversal.</p>

          <div className="overflow-hidden rounded-xl border border-border">
            {frames.map((f) => (
              <div key={f.interval} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 border-b border-border px-3 py-2 last:border-0 text-xs">
                <span className="font-mono font-bold">{f.interval.toUpperCase()}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{V3_LABEL[f.regime]}{f.pending ? <span className="text-muted-foreground"> → {V3_LABEL[f.pending.regime]}? ({f.pending.bars}/{confirm})</span> : null}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{f.alerts[0] ?? "No change events"}</div>
                </div>
                <span className={`inline-flex items-center gap-0.5 font-mono font-semibold ${dirTone(f.direction)}`}><DirIcon d={f.direction} />{f.score}</span>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><BellRing className="size-3" />Change alerts</h3>
            <ul className="space-y-1 text-xs">
              {frames.flatMap((f) => f.alerts).slice(0, 12).map((a, k) => <li key={k} className="rounded-lg bg-secondary/50 px-2 py-1">{a}</li>)}
              {!frames.some((f) => f.alerts.length) && <li className="text-muted-foreground">No market-change alerts on this scan.</li>}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Choppiness" value={`${lead.chop.score}/100`} tone={lead.chop.choppy ? "text-destructive" : undefined} />
            <Stat label="Squeeze" value={lead.squeeze.state === "squeeze" ? "Breakout watch" : lead.squeeze.state === "expanding" ? `Expanding ${lead.squeeze.dir ?? ""}` : "Normal"} />
            <Stat label="Exhaustion" value={lead.exhaustion.stage ?? "None"} />
            <Stat label="Divergence" value={lead.divergences.length ? `${lead.divergences.length} found` : "None"} />
          </div>
          {(lead.chop.choppy || lead.exhaustion.evidence.length > 0 || lead.divergences.length > 0 || lead.trap) && (
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {lead.chop.choppy && <li>Choppy range {fmt(lead.chop.rangeLow)} – {fmt(lead.chop.rangeHigh)}: {lead.chop.flags.join(", ")}</li>}
              {lead.exhaustion.evidence.map((e, k) => <li key={`e${k}`}>• {e}</li>)}
              {lead.divergences.map((d, k) => <li key={`d${k}`}>• {d.text}</li>)}
              {lead.trap && <li>• {lead.trap.text}</li>}
            </ul>
          )}

          {s15 && (
            <div className="rounded-xl border border-border p-3 text-xs space-y-1">
              <div className="font-semibold">Session: {s15.label}{s15.overlap ? " (highest liquidity)" : ""}</div>
              {s15.high !== undefined && <div className="text-muted-foreground">Session high/low {fmt(s15.high)} / {fmt(s15.low)}</div>}
              {s15.prevLabel && <div className="text-muted-foreground">Previous {s15.prevLabel} high/low {fmt(s15.prevHigh)} / {fmt(s15.prevLow)}</div>}
              {s15.events.map((e, k) => <div key={k} className="text-primary">{e}</div>)}
              <div className="text-[10px] text-muted-foreground">Next opens (SAST, daylight saving handled): {opens.filter((o) => Number.isFinite(o.at)).map((o) => `${o.name} ${sastTime(o.at)}`).join(" · ")}</div>
            </div>
          )}

          {!!ch?.zones.length && (
            <div>
              <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Support & resistance (multi-timeframe strength)</h3>
              <div className="space-y-1">
                {ch.zones.map((z, k) => (
                  <div key={k} className="rounded-lg bg-secondary/50 px-2 py-1 text-xs">
                    <div className="flex justify-between gap-2"><span className={z.kind === "support" ? "text-primary" : "text-destructive"}>{z.kind} {fmt(z.bottom)}–{fmt(z.top)}</span><span className="font-mono">{z.strength}</span></div>
                    <div className="text-[10px] text-muted-foreground">{z.touches} touches · {z.frames.map((f) => f.toUpperCase()).join("/")}{z.event ? ` · ${z.event}` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border p-3 text-xs space-y-1">
            <div className="font-semibold">Volume & intermarket</div>
            {lead.volume.available ? (
              <div className="text-muted-foreground">
                Relative volume {lead.volume.rvol?.toFixed(2) ?? "—"}{lead.volume.spike ? " (spike)" : ""} · {lead.volume.pressure !== undefined ? (lead.volume.pressure > 0.1 ? "buying" : lead.volume.pressure < -0.1 ? "selling" : "balanced") : "—"} pressure
                · POC {fmt(lead.volume.poc)} · VAH {fmt(lead.volume.vah)} · VAL {fmt(lead.volume.val)}{lead.volume.divergence ? ` · ${lead.volume.divergence}` : ""}
              </div>
            ) : null}
            <div className="text-[10px] text-muted-foreground">{lead.volume.note}</div>
            <div className="text-[10px] text-muted-foreground">{ORDER_FLOW_NOTE}</div>
            <div className={ch?.correlation?.breakdown ? "text-destructive" : "text-muted-foreground"}>{ch?.correlation?.text ?? ch?.correlationNote ?? "Correlation not available yet."}</div>
            <div className="text-[10px] text-muted-foreground">{YIELDS_NOTE} Correlation is a confirmation factor only.</div>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2 rounded-xl border border-border p-3 text-xs">
        <label className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 font-semibold"><Activity className="size-3.5" />Adaptive strategy switching</span>
          <Switch checked={pro.engine.adaptive !== false} onCheckedChange={(v) => proActions.setEngine({ adaptive: v })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-muted-foreground">Confirm bars</span>
            <select className="w-full rounded-lg border border-input bg-background px-2 py-1" value={confirm} onChange={(e) => proActions.setEngine({ changeConfirmBars: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-muted-foreground">Minimum hold bars</span>
            <select className="w-full rounded-lg border border-input bg-background px-2 py-1" value={hold} onChange={(e) => proActions.setEngine({ changeMinHold: Number(e.target.value) })}>
              {[2, 3, 5, 8, 10, 15].map((n) => <option key={n} value={n}>{n}</option>)}
            </select></label>
        </div>
        <p className="text-[10px] text-muted-foreground">A new regime must repeat for the confirm bars and the current one must be held for the minimum bars before strategies switch.</p>
      </div>
    </Panel>
  );
}
