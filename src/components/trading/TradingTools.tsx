import { useEffect, useState } from "react";
import { Calculator, Clock, Target } from "lucide-react";
import { Input } from "@/components/ui/input";
import { marketSession, sessionStatuses } from "@/lib/market-session";
import { calcLots, type CalcMarket } from "@/lib/lot-calculator";

/** Display-only trading helpers. Nothing here reads accounts or places orders. */
export function TradingTools() {
  return (
    <div className="mt-6 space-y-5">
      <SessionsBoard />
      <LotCalculator />
    </div>
  );
}

const card = "rounded-[28px] border border-primary/30 bg-gradient-to-b from-card/80 to-background/70 p-5 backdrop-blur";
const cardStyle = { boxShadow: "0 20px 50px -30px var(--primary)" };

function CardTitle({ icon: Icon, title, right }: { icon: typeof Clock; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-10 shrink-0 rounded-full bg-primary/15 border border-primary/30 grid place-items-center text-primary"><Icon className="size-4" /></span>
      <h3 className="font-display text-base font-extrabold tracking-tight">{title}</h3>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function SessionsBoard() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const sessions = sessionStatuses(now);
  const fx = marketSession("EURUSD", now);
  const label = fx.quality === "closed" ? "Closed" : fx.quality === "high" ? "Best time" : fx.quality === "normal" ? "Active" : "Quiet";
  const tone = fx.quality === "closed" ? "border-destructive/50 bg-destructive/10 text-destructive"
    : fx.quality === "high" ? "border-primary bg-primary text-primary-foreground"
    : "border-primary/40 bg-primary/10 text-primary";

  return (
    <section className={card} style={cardStyle}>
      <CardTitle icon={Clock} title="Market sessions"
        right={<span className={`rounded-full border px-3 py-1 text-[9px] font-black tracking-[0.2em] uppercase ${tone}`}>{label}</span>} />
      <div className="mt-4 space-y-2.5">
        {sessions.map((s) => (
          <div key={s.name} className="rounded-full border border-border/60 bg-background/60 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${s.open ? "bg-primary animate-pulse" : "bg-muted-foreground/50"}`} />
              <span className="text-sm font-bold">{s.name}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{s.localTime}</span>
              <span className={`w-14 text-right text-[9px] font-black tracking-[0.2em] ${s.open ? "text-primary" : "text-muted-foreground"}`}>{s.open ? "OPEN" : "CLOSED"}</span>
            </div>
            {s.open && (
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 px-2 text-[10px] text-muted-foreground">London + New York overlap is usually the busiest time. Times shown are each city's local time.</p>
    </section>
  );
}

const MARKETS: { id: CalcMarket; label: string }[] = [
  { id: "forex", label: "USD pairs" },
  { id: "jpy", label: "JPY pairs" },
  { id: "gold", label: "Gold" },
];

function LotCalculator() {
  const [market, setMarket] = useState<CalcMarket>("forex");
  const [balance, setBalance] = useState("1000");
  const [risk, setRisk] = useState("1");
  const [stop, setStop] = useState("20");
  const [target, setTarget] = useState("40");
  const [jpy, setJpy] = useState("150");
  const num = (v: string) => Number(v.replace(",", "."));
  const r = calcLots({ balance: num(balance), riskPct: num(risk), stopPips: num(stop), targetPips: num(target), market, jpyPrice: num(jpy) });
  const field = "h-12 rounded-full border border-primary/25 bg-background/60 px-5 font-mono text-sm focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/30";
  const lbl = "pl-4 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground";
  const decimal = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value.replace(/[^\d.,]/g, "").slice(0, 10));

  return (
    <section className={card} style={cardStyle}>
      <CardTitle icon={Calculator} title="Lot size calculator" />

      <div className="mt-4 grid grid-cols-3 gap-1 rounded-full border border-primary/30 bg-background/50 p-1">
        {MARKETS.map((m) => (
          <button key={m.id} type="button" onClick={() => setMarket(m.id)}
            className={`h-9 rounded-full text-[11px] font-extrabold tracking-wide transition ${market === m.id ? "bg-primary text-primary-foreground shadow-[0_0_20px_-6px_var(--primary)]" : "text-muted-foreground"}`}
          >{m.label}</button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="space-y-1.5"><span className={lbl}>Balance $</span><Input inputMode="decimal" value={balance} onChange={decimal(setBalance)} className={field} /></label>
        <label className="space-y-1.5"><span className={lbl}>Risk %</span><Input inputMode="decimal" value={risk} onChange={decimal(setRisk)} className={field} /></label>
        <label className="space-y-1.5"><span className={lbl}>Stop loss pips</span><Input inputMode="decimal" value={stop} onChange={decimal(setStop)} className={field} /></label>
        <label className="space-y-1.5"><span className={lbl}>Take profit pips</span><Input inputMode="decimal" value={target} onChange={decimal(setTarget)} className={field} /></label>
        {market === "jpy" && (
          <label className="col-span-2 space-y-1.5"><span className={lbl}>Current price (e.g. USDJPY)</span><Input inputMode="decimal" value={jpy} onChange={decimal(setJpy)} className={field} /></label>
        )}
      </div>

      {r ? (
        <>
          <div className="mt-5 flex items-center justify-between rounded-full bg-primary p-1.5 pl-6 text-primary-foreground shadow-[0_0_36px_-10px_var(--primary)]">
            <span className="text-[10px] font-black tracking-[0.25em]">LOT SIZE</span>
            <span className="rounded-full bg-background/90 px-5 py-2 font-mono text-xl font-black text-primary">{r.lots.toFixed(2)}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="At risk" value={`$${r.actualRisk.toFixed(2)}`} />
            <Stat label="Profit" value={r.profit != null ? `$${r.profit.toFixed(2)}` : "—"} />
            <Stat label="Reward" value={r.rr != null ? `1:${r.rr}` : "—"} icon />
          </div>
          {r.belowMinimum && (
            <p className="mt-3 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-[10px] text-destructive">
              Smallest lot is 0.01 — this risks ${r.actualRisk.toFixed(2)}, more than your {risk}% plan.
            </p>
          )}
        </>
      ) : (
        <p className="mt-5 rounded-full border border-border/60 bg-background/50 px-4 py-2.5 text-center text-xs text-muted-foreground">Enter balance, risk % and stop loss to see your lot size.</p>
      )}
      <p className="mt-3 px-2 text-[10px] text-muted-foreground">Estimate for USD accounts · 1 pip ≈ ${r?.pipValue ?? "—"} per lot. Check with your broker before trading.</p>
    </section>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded-full border border-border/60 bg-background/60 px-2 py-2">
      <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-muted-foreground inline-flex items-center gap-1">{icon && <Target className="size-2.5 text-primary" />}{label}</p>
      <p className="font-mono text-xs font-bold">{value}</p>
    </div>
  );
}
