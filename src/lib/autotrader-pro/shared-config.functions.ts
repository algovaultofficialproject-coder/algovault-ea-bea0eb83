import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KEY = "autotrader_pro_shared";

/** Anyone's robot may read the admin's published AutoTrader Pro setup (tuning only, no account data). */
export const getProShared = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return { value: data?.value ?? null };
});

/** Admin only: publish the AutoTrader Pro setup every trading-app robot follows. */
export const saveProShared = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ config: z.string().max(200_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _uid: context.userId });
    if (!isAdmin) return { ok: false as const, error: "Admin only" };
    try { JSON.parse(data.config); } catch { return { ok: false as const, error: "Invalid setup" }; }
    const value = data.config;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert({ key: KEY, value, updated_at: new Date().toISOString() });
    return error ? { ok: false as const, error: error.message } : { ok: true as const };
  });
