import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  mtConnect,
  mtAccountSummary,
  mtOrderSend,
  mtOrderModify,
  mtOrderClose,
  mtDisconnect,
  mtOpenedOrders,
  type Platform,
} from "@/lib/mtapi-online.server";
import { closeVerified, freshSession } from "@/lib/guard-core.server";

/**
 * Broker integration via mtapi.io (MT4 + MT5).
 * All HTTP/error handling lives in mtapi-online.functions.ts — mtapi.io returns
 * HTTP 200/201 with a JSON error body, so responses are validated by content.
 */

const PlatformIn = z.enum(["mt4", "MT4", "mt5", "MT5"]).transform((v) => v.toLowerCase() as Platform);

const ConnectIn = z.object({
  platform: PlatformIn,
  broker: z.string().min(1),
  login: z.string().min(1).max(32),
  password: z.string().min(1),
  server: z.string().min(2),
});

export const connectBrokerAccount = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ConnectIn.parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, error: c.error };
    const s = await mtAccountSummary(data.platform, c.token);
    await mtDisconnect(data.platform, c.token);
    if (!s.ok) return { ok: false as const, error: s.error };
    return {
      ok: true as const,
      accountId: `mtapi:${data.platform}:${data.login}`,
      region: data.platform,
      balance: s.info.balance ?? 0,
      equity: s.info.equity ?? 0,
      currency: s.info.currency ?? null,
      leverage: s.info.leverage ?? null,
    };
  });

const TradeIn = z.object({
  platform: PlatformIn,
  login: z.string().min(1),
  password: z.string().min(1),
  server: z.string().min(2),
  symbol: z.string().min(1).max(32),
  side: z.enum(["BUY", "SELL"]),
  lot: z.number().positive(),
  sl: z.number().nullable().optional(),
  tp: z.number().nullable().optional(),
  /** Distances from the broker's own fill price; when set, stops are attached after the fill. */
  slDist: z.number().positive().optional(),
  tpDist: z.number().positive().optional(),
  digits: z.number().int().min(0).max(8).optional(),
  comment: z.string().max(64).optional(),
  count: z.number().int().min(1).max(20).optional(),
});

export const executeTrade = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TradeIn.parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, error: c.error, ticket: null, results: [] as Array<{ ok: boolean; ticket?: number | string | null; error?: string }> };
    const n = data.count ?? 1;
    const relative = !!(data.slDist && data.tpDist);
    const send = async () => {
      const r = await mtOrderSend(data.platform, {
        id: c.token,
        symbol: data.symbol,
        side: data.side,
        lots: data.lot,
        stoploss: relative ? 0 : data.sl ?? 0,
        takeprofit: relative ? 0 : data.tp ?? 0,
        comment: data.comment ?? "AlgoVault",
      });
      if (!r.ok || !relative || r.ticket == null) return r;
      // Attach SL/TP from the broker's real fill price so they are always on the valid side.
      const b = (r.raw ?? {}) as Record<string, unknown>;
      const fill = Number(b.openPrice ?? b.OpenPrice ?? b.price ?? b.Price ?? 0);
      if (!Number.isFinite(fill) || fill <= 0) return { ...r, error: "filled without stops (no fill price)" };
      const d = data.digits ?? (Number(b.digits) || 5);
      const rnd = (x: number) => +x.toFixed(d);
      const buy = data.side === "BUY";
      const sl = rnd(buy ? fill - data.slDist! : fill + data.slDist!);
      const tp = rnd(buy ? fill + data.tpDist! : fill - data.tpDist!);
      let m = await mtOrderModify(data.platform, { id: c.token, ticket: r.ticket, stoploss: sl, takeprofit: tp });
      if (!m.ok) {
        // Retry once with 50% wider distances in case the broker's stop level is larger.
        m = await mtOrderModify(data.platform, {
          id: c.token, ticket: r.ticket,
          stoploss: rnd(buy ? fill - data.slDist! * 1.5 : fill + data.slDist! * 1.5),
          takeprofit: rnd(buy ? fill + data.tpDist! * 1.5 : fill - data.tpDist! * 1.5),
        });
      }
      return m.ok ? r : { ...r, error: `filled, but stops rejected: ${m.error}` };
    };
    const responses = await Promise.all(Array.from({ length: n }, send));
    await mtDisconnect(data.platform, c.token);
    const results = responses.map((r) =>
      r.ok ? { ok: true, ticket: r.ticket ?? null, warning: (r as { error?: string }).error } : { ok: false, error: r.error },
    );
    const anyOk = results.some((r) => r.ok);
    const first = results[0];
    return {
      ok: anyOk,
      ticket: first && first.ok ? (first as { ticket?: number | string | null }).ticket ?? null : null,
      error: anyOk ? (first as { warning?: string })?.warning : (first as { error?: string })?.error,
      results,
    };
  });

const ModifyIn = z.object({
  platform: PlatformIn,
  login: z.string().min(1), password: z.string().min(1), server: z.string().min(2),
  ticket: z.union([z.string(), z.number()]),
  sl: z.number().nullable().optional(),
  tp: z.number().nullable().optional(),
});

export const modifyTrade = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ModifyIn.parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, error: c.error };
    const r = await mtOrderModify(data.platform, {
      id: c.token, ticket: data.ticket, stoploss: data.sl ?? 0, takeprofit: data.tp ?? 0,
    });
    await mtDisconnect(data.platform, c.token);
    return r.ok ? { ok: true as const, raw: JSON.stringify(r.raw ?? null) } : { ok: false as const, error: r.error ?? "Modify failed" };
  });

const CloseIn = z.object({
  platform: PlatformIn,
  login: z.string().min(1), password: z.string().min(1), server: z.string().min(2),
  ticket: z.union([z.string(), z.number()]),
});

export const closeTrade = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => CloseIn.parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, error: c.error };
    const r = await mtOrderClose(data.platform, c.token, String(data.ticket));
    await mtDisconnect(data.platform, c.token);
    return r.ok ? { ok: true as const, raw: JSON.stringify(r.raw ?? null) } : { ok: false as const, error: r.error ?? "Close failed" };
  });

const DisconnectIn = z.object({
  platform: PlatformIn,
  login: z.string().min(1), password: z.string().min(1), server: z.string().min(2),
});

export const disconnectBrokerAccount = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => DisconnectIn.parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: true as const };
    await mtDisconnect(data.platform, c.token);
    return { ok: true as const };
  });

const InfoIn = z.object({
  platform: PlatformIn, login: z.string().min(1), password: z.string().min(1), server: z.string().min(2),
});

export const getAccountInfo = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => InfoIn.parse(i))
  .handler(async ({ data }) => {
    const c = await mtConnect(data.platform, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, error: c.error };
    const s = await mtAccountSummary(data.platform, c.token);
    await mtDisconnect(data.platform, c.token);
    if (!s.ok) return { ok: false as const, error: s.error };
    return { ok: true as const, info: s.info };
  });

const ManageIn = z.object({
  platform: PlatformIn, login: z.string().min(1), password: z.string().min(1), server: z.string().min(2),
  tickets: z.array(z.string()).default([]),
  /** Auto trader: only ever close trades that are in profit; losers are left to their stop loss. */
  profitOnly: z.boolean().optional(),
  /** Also manage open trades whose comment marks them as placed by the auto trader. */
  botComment: z.boolean().optional(),
});

/**
 * Fast scalp manager (polled every ~2 s). For each tracked ticket from OpenedOrders:
 *  - close as soon as profit >= target (0.2% of balance, min 0.30),
 *  - after 15 s close any trade that is in profit at all,
 *  - after 25 s close if loss is small (<= target), cutting dead trades,
 *  - always close if loss reaches 3x target (hard scalp stop).
 */
export const manageAccount = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ManageIn.parse(i))
  .handler(async ({ data }) => {
    // A warm bridge session can expire between polls; drop it and reconnect once
    // before reporting that the account cannot be read.
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    let c = await mtConnect(data.platform, data.login, data.password, data.server);
    let s = c.ok ? await mtAccountSummary(data.platform, c.token) : null;
    let o = c.ok && s?.ok ? await mtOpenedOrders(data.platform, c.token) : null;
    if (!c.ok || !s?.ok || !o?.ok) {
      if (c.ok) await mtDisconnect(data.platform, c.token, true);
      await wait(800);
      c = await mtConnect(data.platform, data.login, data.password, data.server);
      if (!c.ok) return { ok: false as const, error: c.error };
      s = await mtAccountSummary(data.platform, c.token);
      if (!s.ok) return { ok: false as const, error: s.error };
      o = await mtOpenedOrders(data.platform, c.token);
    }
    if (!c.ok || !s?.ok || !o) return { ok: false as const, error: "Account summary unavailable" };
    const balance = Number(s.info.balance ?? 0);
    const equity = Number(s.info.equity ?? balance);
    const target = Math.max(0.3, balance * 0.002);
    // Open positions unknown: report it so the caller never assumes the account is flat.
    if (!o.ok) {
      return { ok: false as const, error: `open trades unreadable (${o.error})`, balance, equity };
    }
    const orders = o.orders;
    const tracked = new Set(data.tickets);
    // Also manage any open trade the auto trader placed (by its comment), so trades
    // survive page reloads or missing ticket numbers from the fill response.
    const isBot = (ord: { ticket: string; comment: string }) =>
      tracked.has(ord.ticket) || (!!data.botComment && /algovault/i.test(ord.comment));
    const now = Date.now();
    const due = orders.filter((ord) => {
      if (!isBot(ord)) return false;
      const age = (now - ord.openedAt) / 1000;
      if (data.profitOnly) return ord.profit >= Math.max(0.1, target * 0.35) || (age >= 60 && ord.profit >= 0.05);
      return ord.profit >= target || (age >= 15 && ord.profit > 0)
        || (age >= 25 && ord.profit >= -target) || ord.profit <= -3 * target;
    });
    const closed = await Promise.all(due.map(async (ord) => {
      let r = await mtOrderClose(data.platform, c.token, ord.ticket);
      if (!r.ok) { await new Promise((res) => setTimeout(res, 400)); r = await mtOrderClose(data.platform, c.token, ord.ticket); }
      return { ticket: ord.ticket, ok: r.ok, profit: ord.profit, error: r.error };
    }));
    const live = new Set(orders.map((x) => x.ticket));
    const gone = data.tickets.filter((t) => !live.has(t));
    const closedOk = new Set(closed.filter((x) => x.ok).map((x) => x.ticket));
    const botTickets = orders.filter((ord) => isBot(ord) && !closedOk.has(ord.ticket)).map((ord) => ord.ticket);
    return {
      ok: true as const, balance, equity, currency: s.info.currency,
      open: orders.length - closedOk.size, target, closed, gone, botTickets,
    };
  });

const AccountIn = z.object({
  platform: PlatformIn, login: z.string().min(1), password: z.string().min(1), server: z.string().min(2),
});

/** Live open trades on the connected account with their running profit/loss (profit includes swap + commission). */
export const getOpenTrades = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AccountIn.parse(i))
  .handler(async ({ data }) => {
    const r = await freshSession(data);
    if ("error" in r) return { ok: false as const, error: r.error };
    const s = await mtAccountSummary(data.platform, r.c.token);
    const info = s.ok ? s.info : {};
    return {
      ok: true as const,
      balance: info.balance ?? null, equity: info.equity ?? null, currency: info.currency ?? null,
      trades: r.o.orders,
    };
  });

/**
 * Close the given tickets (one retry each), then re-read the account's open trades so each close is
 * verified on the broker side. `closed` is true only when the ticket is no longer open.
 */
export const closeTradesVerified = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AccountIn.extend({ tickets: z.array(z.string().min(1).max(64)).min(1).max(50) }).parse(i))
  .handler(async ({ data }) => {
    const r = await freshSession(data);
    if ("error" in r) return { ok: false as const, error: r.error, results: [] };
    const results = await closeVerified(data.platform, r.c.token, new Set(r.o.orders.map((o) => o.ticket)), data.tickets);
    return { ok: true as const, results };
  });
