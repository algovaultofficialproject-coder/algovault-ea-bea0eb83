import { Loader2 } from "lucide-react";
import { useOpenTrades } from "@/lib/open-trades-store";
import { tradeSide } from "@/lib/autotrader-pro/position-guard";

const fmt = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2);
const px = (n: number) => (n > 0 ? String(+n.toFixed(5)) : "—");

/** Open trades on the connected MetaTrader account with their running profit/loss, refreshed every second. */
export function OpenTradesList() {
  const s = useOpenTrades();
  const total = s.trades.reduce((a, t) => a + t.profit, 0);
  const cur = s.currency ?? "";

  return (
    <div className="mt-6 text-left">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary">Open trades</p>
        <p className="text-[10px] text-muted-foreground">
          {s.updatedAt ? `updated ${new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
        </p>
      </div>

      {s.status === "ok" && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          {[["Balance", s.balance], ["Equity", s.equity], ["Floating P/L", total]].map(([label, v]) => (
            <div key={String(label)} className="rounded-xl border border-border/60 bg-background/40 px-2 py-2">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className={`font-mono text-sm font-bold ${label === "Floating P/L" ? (total >= 0 ? "text-primary" : "text-destructive") : ""}`}>
                {v == null ? "—" : label === "Floating P/L" ? fmt(Number(v)) : Number(v).toFixed(2)} <span className="text-[9px] text-muted-foreground">{cur}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {(s.status === "idle" || s.status === "loading") && (
          <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Reading your open trades…</p>
        )}
        {s.status === "error" && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">Can't read open trades right now ({s.error?.slice(0, 100)}). Retrying…</p>
        )}
        {s.status === "ok" && s.trades.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No open trades.</p>
        )}
        {s.trades.map((t) => {
          const side = tradeSide(t.type);
          return (
            <div key={t.ticket} className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">
                  <span className={side === "SELL" ? "text-destructive" : "text-primary"}>{side ?? t.type}</span> {t.symbol}
                  <span className="ml-1 text-[10px] text-muted-foreground">{t.lots} lot</span>
                </p>
                <p className={`font-mono font-bold ${t.profit >= 0 ? "text-primary" : "text-destructive"}`}>{fmt(t.profit)} <span className="text-[9px] text-muted-foreground">{cur}</span></p>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                #{t.ticket} · {px(t.openPrice)} → {px(t.price)} · SL {px(t.sl)} · TP {px(t.tp)}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[10px] text-muted-foreground">Trades close at their own stop loss or take profit on MetaTrader.</p>
    </div>
  );
}
