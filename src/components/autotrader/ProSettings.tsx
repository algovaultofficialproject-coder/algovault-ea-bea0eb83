import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { SCAN_BOOK } from "@/lib/autotrader-pro/strategy-policy";
import { LIVE_AUTH_MS, liveAuthorized, proActions, useProState } from "@/lib/autotrader-pro/store";
import type { RiskSettings, RiskTolerance } from "@/lib/autotrader-pro/risk";
import { Panel } from "./ui-bits";

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 py-1.5">
      <span className="min-w-0"><span className="block text-sm">{label}</span>{hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

const RISK_FIELDS: Array<{ k: keyof RiskSettings; label: string; step: number; suffix?: string }> = [
  { k: "accountSize", label: "Account size (for sizing)", step: 100 },
  { k: "riskPerTradePct", label: "Max risk per trade", step: 0.1, suffix: "%" },
  { k: "maxDailyLossPct", label: "Max daily loss", step: 0.5, suffix: "%" },
  { k: "maxDrawdownPct", label: "Max account drawdown", step: 1, suffix: "%" },
  { k: "maxOpenTrades", label: "Max simultaneous trades", step: 1 },
  { k: "maxTradesPerDay", label: "Max trades per day", step: 1 },
  { k: "minMinutesBetweenTrades", label: "Minutes between trades", step: 1 },
  { k: "maxConsecutiveLosses", label: "Pause after losses in a row", step: 1 },
  { k: "lossCooldownMinutes", label: "Loss pause length", step: 5, suffix: "min" },
  { k: "maxSpreadAtr", label: "Max spread (share of ATR)", step: 0.05 },
  { k: "slippageAtr", label: "Slippage allowance (ATR)", step: 0.01 },
  { k: "spikeAtrMult", label: "Spike protection (× ATR)", step: 0.5 },
  { k: "slAtrMult", label: "Stop distance (× ATR)", step: 0.1 },
  { k: "targetRR", label: "Target reward : risk", step: 0.1 },
  { k: "trailingAtrMult", label: "Trailing stop (× ATR)", step: 0.1 },
  { k: "breakEvenAtR", label: "Break-even at (R)", step: 0.1 },
  { k: "partialAtR", label: "Partial profit at (R)", step: 0.1 },
  { k: "partialPct", label: "Partial size", step: 5, suffix: "%" },
  { k: "maxLot", label: "Max lot size", step: 0.01 },
  { k: "contractSize", label: "Contract size per lot (0 = auto)", step: 1 },
];

export function ProSettings() {
  const pro = useProState();
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const authorized = liveAuthorized(pro, Date.now());
  const e = pro.engine;
  return (
    <div className="space-y-3">
      <Panel title="Strategies">
        {SCAN_BOOK.map((s) => <Toggle key={s.id} label={`${s.letter} · ${s.name}`} hint={s.description} checked={e.enabled[s.id] !== false} onChange={() => proActions.toggleStrategy(s.id)} />)}
        <div className="mt-2 border-t border-border pt-2">
          <Toggle label="Automatic strategy selection" hint="Only strategies suited to the detected market can give actionable signals; others still feed the watchlist." checked={e.autoSelect} onChange={(v) => proActions.setEngine({ autoSelect: v })} />
          <Toggle label="Exclude underperforming strategies" hint="Uses out-of-sample backtest or 15+ paper trades." checked={e.disableUnderperformers} onChange={(v) => proActions.setEngine({ disableUnderperformers: v })} />
          <Toggle label="Apply walk-forward parameters" checked={pro.autoOptimize} onChange={(v) => proActions.setFlags({ autoOptimize: v })} />
          <Toggle label="Paper mode: also trade strong early signals" hint="Early signals scoring above the confirmed threshold. Live mode never trades early signals." checked={pro.paperIncludeEarly} onChange={(v) => proActions.setFlags({ paperIncludeEarly: v })} />
        </div>
      </Panel>

      <Panel title="Signal thresholds">
        <div className="space-y-4">
          <div><div className="flex justify-between text-sm"><span>Early signal score</span><span className="font-mono">{e.earlyThreshold}</span></div><Slider value={[e.earlyThreshold]} min={20} max={80} step={1} onValueChange={(v) => proActions.setEngine({ earlyThreshold: v[0] ?? 40 })} aria-label="Early signal score" /></div>
          <div><div className="flex justify-between text-sm"><span>Confirmed signal score</span><span className="font-mono">{e.confirmedThreshold}</span></div><Slider value={[e.confirmedThreshold]} min={30} max={90} step={1} onValueChange={(v) => proActions.setEngine({ confirmedThreshold: v[0] ?? 55 })} aria-label="Confirmed signal score" /></div>
          <p className="text-[11px] text-muted-foreground">Lower values show more opportunities; anything below the early score still appears in the watchlist with what it is missing.</p>
        </div>
      </Panel>

      <Panel title="Trading sessions (UTC)">
        <Toggle label="Asia 23:00–08:00" checked={e.sessions.asia} onChange={(v) => proActions.setEngine({ sessions: { ...e.sessions, asia: v } })} />
        <Toggle label="London 07:00–16:00" checked={e.sessions.london} onChange={(v) => proActions.setEngine({ sessions: { ...e.sessions, london: v } })} />
        <Toggle label="New York 12:00–21:00" checked={e.sessions.newYork} onChange={(v) => proActions.setEngine({ sessions: { ...e.sessions, newYork: v } })} />
      </Panel>

      <Panel title="Risk & volatility">
        <div className="grid grid-cols-3 gap-2">
          {(["conservative", "balanced", "aggressive"] as RiskTolerance[]).map((t) => (
            <Button key={t} type="button" size="sm" variant={pro.risk.tolerance === t ? "default" : "outline"} onClick={() => proActions.setTolerance(t)} className="capitalize">{t}</Button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {RISK_FIELDS.map((f) => (
            <label key={f.k} className="text-[11px] text-muted-foreground">{f.label}{f.suffix ? ` (${f.suffix})` : ""}
              <Input type="number" inputMode="decimal" step={f.step} min={0} value={String(pro.risk[f.k])} className="mt-1 h-9 font-mono text-sm"
                onChange={(ev) => { const v = Number(ev.target.value); if (Number.isFinite(v) && v >= 0) proActions.setRisk({ [f.k]: v } as Partial<RiskSettings>); }} />
            </label>
          ))}
        </div>
        <Toggle label="Volatility-adjusted position size" hint="Smaller size in high volatility, slightly larger in quiet markets." checked={pro.risk.volatilitySizing} onChange={(v) => proActions.setRisk({ volatilitySizing: v })} />
      </Panel>

      <Panel title="Live trading authorisation" right={<ShieldAlert className="size-4 text-destructive" />}>
        {authorized ? (
          <div className="space-y-2 text-sm">
            <p>Live trading is authorised until {new Date((pro.liveAuthorizedAt ?? 0) + LIVE_AUTH_MS).toLocaleString()}.</p>
            <Button variant="destructive" size="sm" onClick={() => proActions.revokeLive()}>Revoke live authorisation</Button>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Live mode sends real orders to the MetaTrader account connected on the Metatrader tab. Only confirmed signals that pass every risk control are sent, with the stop and target attached at the broker. Authorisation lasts 12 hours.</p>
            <label className="flex items-start gap-2"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" /><span>I understand live trading risks real money and that signals and scores do not guarantee profits.</span></label>
            <Input value={typed} onChange={(ev) => setTyped(ev.target.value)} placeholder='Type "LIVE" to confirm' className="h-10" />
            <Button disabled={!ack || typed.trim().toUpperCase() !== "LIVE"} onClick={() => { proActions.authorizeLive(); setAck(false); setTyped(""); }}>Authorise live trading</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
