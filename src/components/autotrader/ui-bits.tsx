import type { ReactNode } from "react";
import type { Side, Signal } from "@/lib/autotrader-pro/types";

export const sideTone = (side: Side) => (side === "BUY" ? "text-primary" : "text-destructive");
export const fmt = (n: number | undefined, d = 5) => (n === undefined || !Number.isFinite(n) ? "—" : n >= 1000 ? n.toFixed(2) : n >= 10 ? n.toFixed(3) : n.toFixed(d));
export const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
export const ago = (t: number, now: number) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };

export function Panel({ title, right, children, className = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border bg-card/90 backdrop-blur p-4 ${className}`}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-secondary/70 px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={`font-mono text-sm font-semibold truncate ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

/** Five-segment signal-strength meter. */
export function Strength({ value }: { value: Signal["strength"] }) {
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={`Signal strength ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`w-1 rounded-sm ${n <= value ? "bg-primary" : "bg-muted"}`} style={{ height: `${4 + n * 2}px` }} />)}
    </span>
  );
}

export function StageBadge({ stage, side }: { stage: Signal["stage"]; side: Side }) {
  const solid = stage === "confirmed";
  const base = side === "BUY" ? (solid ? "bg-primary text-primary-foreground" : "border border-primary text-primary") : (solid ? "bg-destructive text-destructive-foreground" : "border border-destructive text-destructive");
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${base}`}>{solid ? "Confirmed" : "Early"} {side}</span>;
}
