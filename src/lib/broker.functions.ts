import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mtAccountSummary, mtConnect, mtDisconnect, mtOrderClose, mtOrderModify, mtOrderSend } from "@/lib/mtapi-online.server";

/** Broker management backed by mtapi.io (MT4 + MT5, with MT5 host fallback). */

const platOf = (acc: { platform?: string | null } | null | undefined) =>
  String(acc?.platform ?? "MT4").toLowerCase() === "mt5" ? "mt5" : "mt4";

const ConnectInput = z.object({
  ownerEmail: z.string().email().max(255),
  bridgeUrl: z.string().max(500).optional(),
  broker: z.string().min(1).max(100),
  platform: z.enum(["MT4", "MT5"]),
  login: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  server: z.string().min(1).max(128),
});

export const connectBroker = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ConnectInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const plat = data.platform === "MT5" ? "mt5" : "mt4";
    const c = await mtConnect(plat, data.login, data.password, data.server);
    if (!c.ok) return { ok: false, error: `${plat}.mtapi.io: ${c.error}` };
    const u = await mtAccountSummary(plat, c.token);
    await mtDisconnect(plat, c.token);
    if (!u.ok) return { ok: false, error: `${plat}.mtapi.io: ${u.error}` };

    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const { data: row, error } = await supabaseAdmin.from("broker_connections").upsert({
      owner_email: data.ownerEmail.toLowerCase(),
      broker: data.broker,
      platform: data.platform,
      account_number: data.login,
      login: data.login,
      server: data.server,
      password_encrypted: Buffer.from(data.password, "utf-8").toString("base64"),
      bridge_url: `mtapi4://${data.server}`,
      status: "connected",
      balance: num(u.info.balance),
      equity: num(u.info.equity),
      currency: u.info.currency ?? null,
      leverage: u.info.leverage ?? null,
      last_sync: new Date().toISOString(),
    }, { onConflict: "owner_email,account_number" }).select().single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, account: row, info: u.info, status: "connected" };
  });

export const listBrokerAccounts = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ ownerEmail: z.string().email() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("broker_connections")
      .select("id,broker,platform,account_number,server,status,balance,equity,currency,leverage,last_sync,bridge_url")
      .eq("owner_email", data.ownerEmail.toLowerCase())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const syncAccount = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ accountId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acc, error } = await supabaseAdmin.from("broker_connections").select("*").eq("id", data.accountId).single();
    if (error || !acc) throw new Error(error?.message ?? "Account not found");

    const bridgeUrl = String(acc.bridge_url ?? "");
    const server = bridgeUrl.startsWith("mtapi4://")
      ? bridgeUrl.slice("mtapi4://".length)
      : String(acc.server ?? "");
    const login = String(acc.login ?? acc.account_number ?? "");
    const password = Buffer.from(String(acc.password_encrypted ?? ""), "base64").toString("utf-8");
    if (!login || !password || !server) return { ok: false as const, error: "Missing broker credentials — reconnect" };

    const c = await mtConnect(platOf(acc), login, password, server);
    if (!c.ok) {
      await supabaseAdmin.from("broker_connections").update({ status: "disconnected" }).eq("id", data.accountId);
      return { ok: false as const, error: c.error };
    }
    const u = await mtAccountSummary(platOf(acc), c.token);
    await mtDisconnect(platOf(acc), c.token);
    if (!u.ok) return { ok: false as const, error: u.error };

    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    await supabaseAdmin.from("broker_connections").update({
      balance: num(u.info.balance),
      equity: num(u.info.equity),
      currency: u.info.currency ?? null,
      leverage: u.info.leverage ?? null,
      last_sync: new Date().toISOString(),
      status: "connected",
      platform: acc.platform ?? "MT4",
      bridge_url: `mtapi4://${server}`,
    }).eq("id", data.accountId);
    return { ok: true as const, balance: num(u.info.balance), equity: num(u.info.equity), currency: u.info.currency ?? null, leverage: u.info.leverage ?? null };
  });

const TradeInput = z.object({
  accountId: z.string().uuid(),
  symbol: z.string().min(1).max(32),
  side: z.enum(["BUY", "SELL"]),
  lot: z.number().min(0.01).max(1000),
  stopLoss: z.number().optional(),
  takeProfit: z.number().optional(),
});

export const placeTrade = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TradeInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acc } = await supabaseAdmin.from("broker_connections").select("*").eq("id", data.accountId).single();
    if (!acc) return { ok: false, error: "Account not found" };

    const { data: exec } = await supabaseAdmin.from("trade_executions").insert({
      owner_email: acc.owner_email,
      broker_connection_id: acc.id,
      symbol: data.symbol,
      side: data.side,
      lot: data.lot,
      stop_loss: data.stopLoss ?? null,
      take_profit: data.takeProfit ?? null,
      action: "OPEN",
      status: "pending",
    }).select().single();

    const bridgeUrl = String(acc.bridge_url ?? "");
    const server = bridgeUrl.startsWith("mtapi4://")
      ? bridgeUrl.slice("mtapi4://".length)
      : String(acc.server ?? "");
    const login = String(acc.login ?? acc.account_number ?? "");
    const password = Buffer.from(String(acc.password_encrypted ?? ""), "base64").toString("utf-8");
    if (!login || !password || !server) {
      await supabaseAdmin.from("trade_executions").update({ status: "failed", message: "Missing broker credentials — reconnect" }).eq("id", exec!.id);
      return { ok: false, error: "Missing broker credentials — reconnect" };
    }

    const c = await mtConnect(platOf(acc), login, password, server);
    if (!c.ok) {
      await supabaseAdmin.from("trade_executions").update({ status: "failed", message: c.error }).eq("id", exec!.id);
      return { ok: false, error: c.error };
    }
    const send = await mtOrderSend(platOf(acc), {
      id: c.token,
      symbol: data.symbol,
      side: data.side,
      lots: data.lot,
      stoploss: data.stopLoss,
      takeprofit: data.takeProfit,
      comment: "AlgoVault",
    });
    await mtDisconnect(platOf(acc), c.token);
    const ticket = send.ok ? send.ticket : null;
    await supabaseAdmin.from("trade_executions").update({
      status: send.ok ? "executed" : "failed",
      ticket: ticket != null ? String(ticket) : null,
      message: send.ok ? null : send.error,
      raw: (send.ok ? send.raw : { error: send.error }) as never,
    }).eq("id", exec!.id);
    return { ok: send.ok, ticket: ticket ?? undefined, error: send.ok ? undefined : send.error };
  });

export const closeTrade = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    accountId: z.string().uuid(),
    ticket: z.string().min(1).max(64),
  }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acc } = await supabaseAdmin.from("broker_connections").select("*").eq("id", data.accountId).single();
    if (!acc) return { ok: false, error: "Account not found" };

    const { data: exec } = await supabaseAdmin.from("trade_executions").insert({
      owner_email: acc.owner_email,
      broker_connection_id: acc.id,
      symbol: "?",
      side: "BUY",
      lot: 0,
      action: "CLOSE",
      ticket: data.ticket,
      status: "pending",
    }).select().single();

    const bridgeUrl = String(acc.bridge_url ?? "");
    const server = bridgeUrl.startsWith("mtapi4://")
      ? bridgeUrl.slice("mtapi4://".length)
      : String(acc.server ?? "");
    const login = String(acc.login ?? acc.account_number ?? "");
    const password = Buffer.from(String(acc.password_encrypted ?? ""), "base64").toString("utf-8");
    if (!login || !password || !server) {
      await supabaseAdmin.from("trade_executions").update({ status: "failed", message: "Missing broker credentials — reconnect" }).eq("id", exec!.id);
      return { ok: false, error: "Missing broker credentials — reconnect" };
    }

    const c = await mtConnect(platOf(acc), login, password, server);
    if (!c.ok) {
      await supabaseAdmin.from("trade_executions").update({ status: "failed", message: c.error }).eq("id", exec!.id);
      return { ok: false, error: c.error };
    }
    const close = await mtOrderClose(platOf(acc), c.token, data.ticket);
    await mtDisconnect(platOf(acc), c.token);
    await supabaseAdmin.from("trade_executions").update({
      status: close.ok ? "executed" : "failed",
      message: close.ok ? null : close.error,
      raw: (close.ok ? close.raw : { error: close.error }) as never,
    }).eq("id", exec!.id);
    return close.ok ? { ok: true, result: JSON.stringify(close.raw ?? null) } : { ok: false, error: close.error };
  });

export const modifyTrade = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    accountId: z.string().uuid(),
    ticket: z.string().min(1).max(64),
    stopLoss: z.number().optional(),
    takeProfit: z.number().optional(),
  }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acc } = await supabaseAdmin.from("broker_connections").select("*").eq("id", data.accountId).single();
    if (!acc) return { ok: false, error: "Account not found" };

    const { data: exec } = await supabaseAdmin.from("trade_executions").insert({
      owner_email: acc.owner_email,
      broker_connection_id: acc.id,
      symbol: "?",
      side: "BUY",
      lot: 0,
      ticket: data.ticket,
      stop_loss: data.stopLoss ?? null,
      take_profit: data.takeProfit ?? null,
      action: "MODIFY",
      status: "pending",
    }).select().single();

    const bridgeUrl = String(acc.bridge_url ?? "");
    const server = bridgeUrl.startsWith("mtapi4://")
      ? bridgeUrl.slice("mtapi4://".length)
      : String(acc.server ?? "");
    const login = String(acc.login ?? acc.account_number ?? "");
    const password = Buffer.from(String(acc.password_encrypted ?? ""), "base64").toString("utf-8");
    if (!login || !password || !server) {
      await supabaseAdmin.from("trade_executions").update({ status: "failed", message: "Missing broker credentials — reconnect" }).eq("id", exec!.id);
      return { ok: false, error: "Missing broker credentials — reconnect" };
    }

    const c = await mtConnect(platOf(acc), login, password, server);
    if (!c.ok) {
      await supabaseAdmin.from("trade_executions").update({ status: "failed", message: c.error }).eq("id", exec!.id);
      return { ok: false, error: c.error };
    }
    const modify = await mtOrderModify(platOf(acc), {
      id: c.token,
      ticket: data.ticket,
      stoploss: data.stopLoss,
      takeprofit: data.takeProfit,
    });
    await mtDisconnect(platOf(acc), c.token);
    await supabaseAdmin.from("trade_executions").update({
      status: modify.ok ? "executed" : "failed",
      message: modify.ok ? null : modify.error,
      raw: (modify.ok ? modify.raw : { error: modify.error }) as never,
    }).eq("id", exec!.id);
    return modify.ok ? { ok: true, result: JSON.stringify(modify.raw ?? null) } : { ok: false, error: modify.error };
  });

export const removeBrokerAccount = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ accountId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("broker_connections").delete().eq("id", data.accountId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
