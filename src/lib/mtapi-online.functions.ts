import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mtAccountSummary, mtConnect, mtDisconnect } from "@/lib/mtapi-online.server";

export const mtapiOnlineTestConnection = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    platform: z.enum(["MT4", "mt4", "MT5", "mt5"]).default("MT4"),
    login: z.string().min(1),
    password: z.string().min(1),
    server: z.string().min(2),
  }).parse(i))
  .handler(async ({ data }) => {
    const p = String(data.platform).toLowerCase() === "mt5" ? "mt5" : "mt4";
    const c = await mtConnect(p, data.login, data.password, data.server);
    if (!c.ok) return { ok: false as const, error: c.error };
    const u = await mtAccountSummary(p, c.token);
    await mtDisconnect(p, c.token);
    if (!u.ok) return { ok: false as const, error: u.error };
    return {
      ok: true as const,
      balance: u.info.balance ?? 0,
      equity: u.info.equity ?? 0,
      currency: u.info.currency ?? null,
      leverage: u.info.leverage ?? null,
    };
  });
