import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mtConnect, mtOpenedOrders, mtPendingCancel, mtPendingSend, mtSymbolInfo, type Platform } from "@/lib/mtapi-online.server";
import { specFor, validateOrder, roundToTick, type InstrumentSpec } from "@/lib/autotrader-pro/order-planner";

/**
 * Pending-order execution on the connected MetaTrader account (mtapi.io bridge).
 * Every order is re-validated here against the broker's LIVE bid/ask and symbol rules before it is sent,
 * and is only reported as placed when the broker returns a ticket.
 */
const Acct = {
  platform: z.enum(["mt4", "MT4", "mt5", "MT5"]).transform((v) => v.toLowerCase() as Platform),
  login: z.string().min(1).max(32), password: z.string().min(1), server: z.string().min(2),
};
const clean = (spec: Partial<Record<keyof InstrumentSpec, number | undefined>>) =>
  Object.fromEntries(Object.entries(spec).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Partial<InstrumentSpec>;

export const placePendingOrder = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    ...Acct, symbol: z.string().min(1).max(32), type: z.enum(["BUY_STOP", "SELL_STOP", "BUY_LIMIT", "SELL_LIMIT"]),
    entry: z.number().positive(), sl: z.number().positive(), tp: z.number().positive(), lots: z.number().positive().max(100),
    expiresAt: z.number().int().positive(),
  }).parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, status: "rejected" as const, error: `Broker connection failed: ${c.error}` };
    const info = await mtSymbolInfo(data.platform, c.token, data.symbol);
    if (!info.quote || !(info.quote.bid > 0)) return { ok: false as const, status: "rejected" as const, error: `No live broker quote: ${info.quoteError ?? "empty"}` };
    const spec = specFor(data.symbol, clean(info.spec));
    const entry = roundToTick(data.entry, spec), sl = roundToTick(data.sl, spec), tp = roundToTick(data.tp, spec);
    const errs = validateOrder(data.type, entry, sl, [tp], info.quote, spec);
    if (errs.length) return { ok: false as const, status: "rejected" as const, error: `Not sent — ${errs.join("; ")}`, quote: info.quote };
    if (Date.now() >= data.expiresAt) return { ok: false as const, status: "rejected" as const, error: "Not sent — setup expired" };
    const r = await mtPendingSend(data.platform, { id: c.token, symbol: data.symbol, type: data.type, price: entry, lots: data.lots, stoploss: sl, takeprofit: tp, expiration: data.expiresAt });
    if (!r.ok) return { ok: false as const, status: "rejected" as const, error: `Broker rejected: ${r.error}`, quote: info.quote };
    return { ok: true as const, status: "pending" as const, ticket: r.ticket, entry, sl, tp, quote: info.quote, specSource: spec.source };
  });

export const cancelPendingOrder = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ ...Acct, ticket: z.string().min(1).max(40) }).parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false, error: `Broker connection failed: ${c.error}` };
    return mtPendingCancel(data.platform, c.token, data.ticket);
  });

/** Where each ticket is now: still pending, filled (now a position), or gone from the book (cancelled/expired/closed). */
export const pendingOrderStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ ...Acct, tickets: z.array(z.string().max(40)).max(50) }).parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, error: c.error, statuses: {} as Record<string, string> };
    const r = await mtOpenedOrders(data.platform, c.token);
    if (!r.ok) return { ok: false as const, error: r.error, statuses: {} as Record<string, string> };
    const statuses: Record<string, string> = {};
    for (const t of data.tickets) {
      const o = r.orders.find((x) => x.ticket === t);
      statuses[t] = !o ? "gone" : /limit|stop/i.test(o.type) ? "pending" : "filled";
    }
    return { ok: true as const, statuses };
  });
