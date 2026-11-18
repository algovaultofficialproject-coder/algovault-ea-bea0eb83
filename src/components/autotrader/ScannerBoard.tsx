import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { OctagonX, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, ago, fmt } from "./ui-bits";
import { boardRow, filterRows, type BoardFilter, type BoardRow } from "@/lib/autotrader-pro/scanner-board";
import {
  AUTOMATION_MODES, ORDER_LABEL, cancelReasons, isPending, mayAutoSubmit, paperFill, signalId, type OrderType, type PlannedOrder,
} from "@/lib/autotrader-pro/order-planner";
import { getOrderBook, orderBook, useOrderBook } from "@/lib/autotrader-pro/order-book";
import { liveAuthorized, useProState } from "@/lib/autotrader-pro/store";
import { connectedAccount } from "@/lib/autotrader-pro/execution";
import { usePortalStore } from "@/lib/portal-store";
import { cancelPendingOrder, pendingOrderStatus, placePendingOrder } from "@/lib/pending-orders.functions";
import { tradeLog } from "@/lib/trade-log";
import { createManualSignal } from "@/lib/manual-signals.functions";
import { rowRelaySignal } from "@/lib/autotrader-pro/bot-relay";
import { magicForEA } from "@/lib/useTurboSignals";
import type { SymbolScan } from "@/lib/autotrader-pro/useAutoTraderPro";
import type { Signal } from "@/lib/autotrader-pro/types";

const FILTERS: { id: BoardFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "strong", label: "Strong" }, { id: "buy", label: "Buy" }, { id: "sell", label: "Sell" }, { id: "market", label: "Market" },
  { id: "BUY_STOP", label: "Buy stop" }, { id: "SELL_STOP", label: "Sell stop" }, { id: "BUY_LIMIT", label: "Buy limit" }, { id: "SELL_LIMIT", label: "Sell limit" },
];
const tone = (d: string) => (d.startsWith("BUY") ? "text-primary" : d.startsWith("SELL") ? "text-destructive" : "text-muted-foreground");
const dataTone = { live: "bg-primary/15 text-primary", delayed: "bg-accent text-accent-foreground", unavailable: "bg-destructive/15 text-destructive" } as const;

interface Props { scans: Record<string, SymbolScan>; symbols: string[]; now: number; onMarket: (symbol: string, sig: Signal, count: number) => Promise<{ ok: boolean; message: string }> }

export function ScannerBoard({ scans, symbols, now, onMarket }: Props) {
  const pro = useProState();
  const book = useOrderBook();
  const portal = usePortalStore();
  const acct = connectedAccount(portal);
  const live = pro.mode === "live";
  const authorized = liveAuthorized(pro, now);
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [note, setNote] = useState<string | null>(null);
  const placeFn = useServerFn(placePendingOrder), cancelFn = useServerFn(cancelPendingOrder), statusFn = useServerFn(pendingOrderStatus);
  const relayFn = useServerFn(createManualSignal);
  const relayEaId = portal.activeEAId ?? portal.eas[0]?.id ?? null;
  const [relayOn, setRelayOn] = useState(true);
  useEffect(() => { setRelayOn(localStorage.getItem("avpro.relay") !== "off"); }, []);
  const toggleRelay = () => setRelayOn((v) => { localStorage.setItem("avpro.relay", v ? "off" : "on"); return !v; });
  const rows = useMemo(() => symbols.map((s) => boardRow(scans[s], s, now, { equity: pro.risk.accountSize, pct: pro.risk.riskPerTradePct })), [scans, symbols, now, pro.risk.accountSize, pro.risk.riskPerTradePct]);
  const shown = filterRows(rows, filter);
  // Every BUY/SELL signal goes to the trading-app bot straight away, once per signal (retried on failure).
  const sentRef = useRef<Set<string>>(new Set());
  useEffect(() => { try { sentRef.current = new Set(JSON.parse(localStorage.getItem("avpro.relayed") ?? "[]")); } catch { /* fresh */ } }, []);
  useEffect(() => {
    if (!relayOn || !relayEaId) return;
    const magic = magicForEA(relayEaId), sent = sentRef.current;
    for (const r of rows) {
      const sig = rowRelaySignal(r, sent);
      if (!sig || !r.key) continue;
      const key = r.key;
      sent.add(key);
      localStorage.setItem("avpro.relayed", JSON.stringify([...sent].slice(-200)));
      void relayFn({ data: { magic, ...sig } })
        .then(() => tradeLog.info(`${sig.comment}: ${sig.side} ${sig.symbol} sent to the trading-app bot`))
        .catch((e) => { sent.delete(key); tradeLog.info(`Bot send failed for ${sig.symbol}: ${e instanceof Error ? e.message : "network error"}`); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, relayOn, relayEaId]);

  async function submit(r: BoardRow, how: "auto" | "manual") {
    if (!r.entry || !r.sl || !r.tps || !r.key || !r.side || !r.expiresAt || r.invalidation === undefined) return;
    const type = r.decision as OrderType;
    const order: PlannedOrder = {
      id: signalId(r.key, Date.now()), key: r.key, symbol: r.symbol, side: r.side, type, entry: r.entry, sl: r.sl, tps: r.tps, lots: r.lots || 0.01,
      expiresAt: r.expiresAt, invalidation: r.invalidation, strategy: r.strategy ?? "", timeframe: r.timeframe ?? "", regime: r.regime ?? "", reason: r.reason,
      status: "not_submitted", paper: !live, createdAt: Date.now(), history: [{ at: Date.now(), event: "Opportunity validated", note: `${how} · score ${r.score}` }],
    };
    if (!orderBook.add(order)) { setNote(`${r.symbol}: this setup already has an active order.`); return; }
    if (!live) { orderBook.update(order.id, { status: isPending(type) ? "pending" : "filled" }, isPending(type) ? "Paper pending order placed" : "Paper market fill"); return; }
    if (!authorized) { orderBook.update(order.id, { status: "rejected" }, "Rejected", "Live trading not authorised"); return; }
    if (!acct) { orderBook.update(order.id, { status: "rejected" }, "Rejected", "No MetaTrader account connected"); return; }
    orderBook.update(order.id, { status: "submitted" }, "Submitted to broker");
    if (!isPending(type)) {
      const sig = scans[r.symbol]?.result?.best;
      const res = sig ? await onMarket(r.symbol, sig, 1) : { ok: false, message: "Signal gone" };
      orderBook.update(order.id, { status: res.ok ? "filled" : "rejected" }, res.ok ? "Broker confirmed market fill" : "Broker rejected", res.message);
      return;
    }
    try {
      const res = await placeFn({ data: { platform: acct.platform, login: acct.login, password: acct.password, server: acct.server, symbol: r.symbol, type: type as "BUY_STOP", entry: r.entry, sl: r.sl, tp: r.tps[1], lots: order.lots, expiresAt: r.expiresAt } });
      if (res.ok) { orderBook.update(order.id, { status: "pending", brokerId: res.ticket }, "Broker confirmed pending order", `Ticket ${res.ticket}`); tradeLog.info(`${ORDER_LABEL[type]} ${r.symbol} @ ${res.entry} placed · ticket ${res.ticket}`); }
      else orderBook.update(order.id, { status: "rejected" }, "Broker rejected", res.error);
    } catch (e) { orderBook.update(order.id, { status: "rejected" }, "Submission failed", e instanceof Error ? e.message : "Network error"); }
  }

  // Automatic placement (modes 4 and 5) — only fully validated rows that pass the permission check.
  const rowsRef = useRef(rows); rowsRef.current = rows;
  useEffect(() => {
    for (const r of rowsRef.current) {
      if (r.decision === "WAIT" || r.decision === "REJECT" || !r.key) continue;
      if (getOrderBook().orders.some((o) => o.key === r.key)) continue;
      if (mayAutoSubmit(book.mode, r.decision, live, authorized, r.score, book.minScore).ok) void submit(r, "auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, book.mode, book.minScore, live, authorized]);

  // Monitor: paper fills/expiry and thesis-based cancellation every tick; broker status every 30 s.
  const lastPoll = useRef(0);
  useEffect(() => {
    for (const o of book.orders) {
      if (o.status !== "pending") continue;
      const scan = scans[o.symbol];
      const q = scan?.price ? { bid: scan.price - (scan.spread ?? 0) / 2, ask: scan.price + (scan.spread ?? 0) / 2, at: scan.at } : undefined;
      const reasons = cancelReasons(o, { quote: q, now, regimeAtPlan: o.regime, regimeNow: scan?.result?.market.regime, riskOk: scan?.gate?.ok ?? true, spreadLimit: 0, newsBlackout: false, connected: o.paper || !!acct });
      if (o.paper && scan?.lastBar && scan.lastBar.t > o.createdAt && paperFill(o.type, o.entry, scan.lastBar)) { orderBook.update(o.id, { status: "filled" }, "Paper order activated", `Bar traded through ${o.entry}`); continue; }
      if (reasons.length) {
        const expired = reasons.length === 1 && reasons[0] === "Signal expired";
        if (o.paper || !o.brokerId || !acct) { orderBook.update(o.id, { status: expired ? "expired" : "cancelled" }, expired ? "Expired" : "Cancelled", reasons.join("; ")); continue; }
        orderBook.update(o.id, { status: "submitted" }, "Cancel requested", reasons.join("; "));
        void cancelFn({ data: { platform: acct.platform, login: acct.login, password: acct.password, server: acct.server, ticket: o.brokerId } })
          .then((r) => orderBook.update(o.id, { status: r.ok ? (expired ? "expired" : "cancelled") : "pending" }, r.ok ? "Broker confirmed cancellation" : "Cancel failed", r.ok ? reasons.join("; ") : r.error));
      }
    }
    const live = book.orders.filter((o) => !o.paper && o.status === "pending" && o.brokerId);
    if (acct && live.length && now - lastPoll.current > 30_000) {
      lastPoll.current = now;
      void statusFn({ data: { platform: acct.platform, login: acct.login, password: acct.password, server: acct.server, tickets: live.map((o) => o.brokerId!) } }).then((r) => {
        if (!r.ok) return;
        for (const o of live) {
          const s = r.statuses[o.brokerId!];
          if (s === "filled") orderBook.update(o.id, { status: "filled" }, "Broker: order activated");
          else if (s === "gone") orderBook.update(o.id, { status: now > o.expiresAt ? "expired" : "cancelled" }, "Broker: order no longer on the book");
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  async function emergencyStop() {
    orderBook.setMode("scan");
    const open = getOrderBook().orders.filter((o) => o.status === "pending" || o.status === "not_submitted");
    for (const o of open) {
      if (!o.paper && o.brokerId && acct) {
        const r = await cancelFn({ data: { platform: acct.platform, login: acct.login, password: acct.password, server: acct.server, ticket: o.brokerId } });
        orderBook.update(o.id, { status: r.ok ? "cancelled" : o.status }, r.ok ? "Emergency stop — cancelled" : "Emergency stop — cancel failed", r.error);
      } else orderBook.update(o.id, { status: "cancelled" }, "Emergency stop — cancelled");
    }
    setNote(`Emergency stop: automation set to Scan only, ${open.length} pending order(s) cancelled. Open positions stay under the position guard.`);
  }

  return (
    <div className="space-y-3">
      <Panel title="Automation" right={<Button size="sm" variant="destructive" className="rounded-full" onClick={emergencyStop}><OctagonX className="size-4" />Emergency stop</Button>}>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5" role="radiogroup" aria-label="Automation mode">
          {AUTOMATION_MODES.map((m, i) => (
            <button key={m.id} type="button" role="radio" aria-checked={book.mode === m.id} onClick={() => orderBook.setMode(m.id)}
              className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${book.mode === m.id ? "border-primary bg-primary/10" : "border-border bg-secondary/40"}`}>
              <span className="block text-[10px] font-mono text-muted-foreground">MODE {i + 1}</span>
              <span className="block text-sm font-bold">{m.label}</span>
              <span className="block text-[10px] leading-tight text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">Auto minimum score
            <input type="number" min={50} max={100} value={book.minScore} onChange={(e) => orderBook.setMinScore(Math.max(50, Math.min(100, Number(e.target.value) || 70)))} className="h-7 w-14 rounded-md border border-border bg-background px-1.5 text-foreground" />
          </label>
          <span className={`rounded-full px-2 py-0.5 ${live ? (authorized ? "bg-destructive/15 text-destructive" : "bg-secondary") : "bg-primary/15 text-primary"}`}>
            {live ? (authorized ? "LIVE — real orders" : "Live not authorised") : "Paper / analysis — no real orders"}
          </span>
          <span>{acct ? `Broker: ${acct.label}` : "No broker connected"}</span>
          <button type="button" role="switch" aria-checked={relayOn} onClick={toggleRelay} disabled={!relayEaId}
            className={`rounded-full border px-2.5 py-0.5 font-semibold ${relayOn && relayEaId ? "border-primary bg-primary/15 text-primary" : "border-border bg-secondary"}`}>
            {relayEaId ? `Send to trading-app bot: ${relayOn ? "ON" : "OFF"}` : "No bot to send to"}
          </button>
        </div>
        {note && <p className="mt-2 text-xs text-foreground">{note}</p>}
      </Panel>

      <Panel title={`Market scanner · ${rows.length} instruments`}>
        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${filter === f.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{f.label}</button>
          ))}
        </div>
        <div className="space-y-2">
          {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No instruments match this filter.</p>}
          {shown.map((r) => <SignalCard key={r.symbol} r={r} now={now} mode={book.mode} onSubmit={() => submit(r, "manual")} />)}
        </div>
      </Panel>

      <OrdersMonitor orders={book.orders} now={now} />
    </div>
  );
}

function SignalCard({ r, now, mode, onSubmit }: { r: BoardRow; now: number; mode: string; onSubmit: () => void }) {
  const [open, setOpen] = useState(false);
  const actionable = r.decision !== "WAIT" && r.decision !== "REJECT";
  const d = r.spec.digits;
  return (
    <article className="rounded-xl border border-border bg-background/60 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><span className="font-bold">{r.symbol}</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${dataTone[r.data]}`}>{r.data}</span></div>
          <div className={`mt-0.5 text-sm font-bold ${tone(r.decision)}`}>{ORDER_LABEL[r.decision]}</div>
          <div className="text-[11px] text-muted-foreground truncate">{r.bias} · {r.regime ?? "—"} · vol {r.volatility ?? "—"}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm">{fmt(r.price, d)}</div>
          <div className={`font-mono text-lg font-bold ${r.score >= 80 ? "text-primary" : r.score >= 60 ? "text-foreground" : "text-muted-foreground"}`}>{r.strategy ? r.score : "—"}</div>
          <div className="text-[10px] text-muted-foreground">{r.strategy ? r.scoreText : "No setup"}</div>
        </div>
      </button>
      {actionable && r.entry !== undefined && (
        <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-xs">
          <Cell k="Entry" v={fmt(r.entry, d)} /><Cell k="Stop" v={fmt(r.sl, d)} /><Cell k="TP2" v={fmt(r.tps?.[1], d)} />
        </div>
      )}
      {open && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px]">
          {([
            ["INSTRUMENT", r.symbol], ["DIRECTION", r.side ?? "—"], ["ORDER TYPE", ORDER_LABEL[r.decision]], ["ENTRY", fmt(r.entry, d)], ["STOP LOSS", fmt(r.sl, d)],
            ...(r.tps ?? []).map((t, i) => [`TP${i + 1}`, fmt(t, d)]), ["RISK", `${r.riskPct}% of account${r.risk ? ` · ${r.risk} at the stop` : ""}`], ["LOT SIZE", r.lots ? String(r.lots) : "—"],
            ["RISK/REWARD", r.rr ? `1:${r.rr} (TP2)` : "—"], ["TIMEFRAME", r.timeframe ?? "—"], ["ALIGNMENT", `${r.alignment.agree}/${r.alignment.total} frames agree${r.alignment.conflicts.length ? ` · conflicts: ${r.alignment.conflicts.join(", ")}` : ""}`],
            ["MARKET BIAS", r.bias], ["MARKET REGIME", r.regime ?? "—"], ["SETUP SCORE", `${r.score} — ${r.scoreText} (quality, not win chance)`], ["STRATEGY", r.strategy ?? "—"],
            ["EXPIRATION", r.expiresAt ? new Date(r.expiresAt).toLocaleTimeString() : "—"], ["INVALIDATION", r.invalidation !== undefined ? `${fmt(r.invalidation, d)} · ${r.invalidationText ?? ""}` : "—"],
            ["REASON", r.reason], ["DATA STATUS", `${r.data}${r.ageSec !== undefined ? ` · scanned ${ago(now - r.ageSec * 1000, now)}` : ""}`], ["SPREAD", r.spread ? fmt(r.spread, d) : "not reported by feed"],
            ["TICK / RULES", `${r.spec.tick} · min distance ${r.spec.minStopTicks} ticks (${r.spec.source === "broker" ? "broker" : "default until broker reports"})`],
          ] as [string, string][]).map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}
        </dl>
      )}
      {actionable && mode !== "scan" && mode !== "signal" && (
        <Button size="sm" className="mt-2 w-full rounded-full" onClick={onSubmit}><Send className="size-4" />Place {ORDER_LABEL[r.decision]}</Button>
      )}
    </article>
  );
}
const Cell = ({ k, v }: { k: string; v: string }) => <div className="rounded-lg bg-secondary/70 px-2 py-1"><div className="text-[9px] uppercase text-muted-foreground">{k}</div><div className="font-semibold">{v}</div></div>;

const TABS = [["pending", "Active"], ["filled", "Filled"], ["cancelled", "Cancelled"], ["expired", "Expired"], ["rejected", "Rejected"]] as const;
function OrdersMonitor({ orders, now }: { orders: PlannedOrder[]; now: number }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("pending");
  const list = orders.filter((o) => (tab === "pending" ? o.status === "pending" || o.status === "submitted" || o.status === "not_submitted" : o.status === tab));
  return (
    <Panel title="Pending orders" right={<button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => orderBook.clearClosed()}>Clear closed</button>}>
      <div className="mb-3 grid grid-cols-5 gap-0.5 rounded-xl bg-secondary p-1 text-[10px]">
        {TABS.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-lg py-1 font-semibold ${tab === id ? "bg-background text-foreground" : "text-muted-foreground"}`}>{label}</button>)}
      </div>
      {list.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground"><ShieldAlert className="mx-auto mb-1 size-5" />No {tab} orders.</p> : (
        <ul className="space-y-2">
          {list.map((o) => (
            <li key={o.id} className="rounded-xl border border-border p-3 text-xs">
              <div className="flex justify-between gap-2"><span className={`font-bold ${tone(o.type)}`}>{ORDER_LABEL[o.type]} {o.symbol}</span><span className="font-mono">{o.status.toUpperCase()}</span></div>
              <div className="mt-1 font-mono text-muted-foreground">@ {o.entry} · SL {o.sl} · TP {o.tps.join(" / ")} · {o.lots} lots</div>
              <div className="mt-1 text-muted-foreground">{o.paper ? "Paper order" : `Broker ticket: ${o.brokerId ?? "not confirmed"}`} · ID {o.id} · expires {new Date(o.expiresAt).toLocaleTimeString()}</div>
              <ol className="mt-2 space-y-0.5 border-l border-border pl-2 text-[11px]">
                {o.history.map((h, i) => <li key={i}><span className="text-muted-foreground">{new Date(h.at).toLocaleTimeString()}</span> {h.event}{h.note ? ` — ${h.note}` : ""}</li>)}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
