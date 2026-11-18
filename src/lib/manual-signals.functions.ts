import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateIn = z.object({
  magic: z.coerce.number().int().positive(),
  symbol: z.string().min(1).max(32),
  side: z.enum(["BUY", "SELL", "CLOSE"]),
  lot: z.coerce.number().positive().max(1000),
  stop_loss: z.coerce.number().optional().nullable(),
  take_profit: z.coerce.number().optional().nullable(),
  comment: z.string().max(64).optional(),
});

export const createManualSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateIn.parse(d))
  .handler(async ({ data, context }) => {
    const { error, data: row } = await context.supabase
      .from("manual_signals")
      .insert({
        owner_id: context.userId,
        magic: data.magic,
        symbol: data.symbol.trim(),
        side: data.side,
        lot: data.lot,
        stop_loss: data.stop_loss ?? null,
        take_profit: data.take_profit ?? null,
        comment: data.comment ?? "AlgoVault mentor",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listManualSignals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ magic: z.coerce.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("manual_signals")
      .select("*")
      .eq("magic", data.magic)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const deleteManualSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("manual_signals").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Client-side fast lane: pulls every undelivered signal for a magic number and
 * instantly marks it delivered, so the app can execute without waiting for a
 * MetaTrader terminal to poll.
 */
export const pullManualSignals = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      magic: z.coerce.number().int().positive(),
      // Only signals broadcast AFTER the client switched the bot on are eligible.
      since: z.string().optional().nullable(),
      email: z.string().email().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("manual_signals")
      .select("id,symbol,side,lot,stop_loss,take_profit,comment,created_at")
      .eq("magic", data.magic)
      .is("consumed_at", null);
    if (data.since) q = q.gte("created_at", data.since);
    const { data: rows, error } = await q
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    if (list.length) {
      await supabaseAdmin
        .from("manual_signals")
        .update({ consumed_at: new Date().toISOString() })
        .in("id", list.map((r) => r.id));
      if (data.email) {
        const { sendGmail } = await import("./gmail.server");
        await sendGmail(data.email, "Algo Vault EA signal executed", [
          "Your AlgoVault bot executed the following signal(s):",
          ...list.map((r) => `${r.side} ${r.symbol} — lot ${r.lot}${r.stop_loss ? `, SL ${r.stop_loss}` : ""}${r.take_profit ? `, TP ${r.take_profit}` : ""}`),
        ]);
      }
    }
    return list;
  });
