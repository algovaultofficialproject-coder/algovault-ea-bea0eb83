import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Only this account may view or rotate the trading bridge keys. */
const OWNER_EMAIL = "mtwentwabantwana@gmail.com";

function assertOwner(claims: unknown) {
  const email = String((claims as { email?: string } | null)?.email ?? "").toLowerCase().trim();
  if (email !== OWNER_EMAIL) throw new Error("Forbidden");
  return email;
}

/** Masked view of the current MT4/MT5 bridge keys. */
export const listBridgeKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertOwner(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("mtapi_keys")
      .select("platform, api_key, updated_at, updated_by");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      platform: r.platform,
      preview: `${String(r.api_key).slice(0, 14)}…${String(r.api_key).slice(-8)}`,
      length: String(r.api_key).length,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
    }));
  });

/** Rotates a bridge key. Every connected user reconnects with it instantly. */
export const setBridgeKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      platform: z.enum(["mt4", "mt5"]),
      apiKey: z.string().min(20).max(4000),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const email = assertOwner(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("mtapi_keys")
      .upsert(
        {
          platform: data.platform,
          api_key: data.apiKey.trim(),
          updated_by: email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform" },
      );
    if (error) throw new Error(error.message);
    const { invalidateBridgeKey } = await import("@/lib/mtapi-online.server");
    invalidateBridgeKey(data.platform);
    return { ok: true as const };
  });

/** Masked view of the Gemini keys used by AutoTrader Pro scanning (key 1 first, key 2 fallback). */
export const listGeminiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertOwner(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("gemini_keys").select("slot, api_key, updated_at").order("slot");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      slot: r.slot,
      preview: `${String(r.api_key).slice(0, 8)}…${String(r.api_key).slice(-6)}`,
      updated_at: r.updated_at,
    }));
  });

/** Replaces Gemini key 1 or 2; scanning picks it up within a minute. */
export const setGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ slot: z.union([z.literal(1), z.literal(2)]), apiKey: z.string().trim().min(20).max(400) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const email = assertOwner(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("gemini_keys").upsert(
      { slot: data.slot, api_key: data.apiKey, updated_by: email, updated_at: new Date().toISOString() },
      { onConflict: "slot" },
    );
    if (error) throw new Error(error.message);
    const { invalidateGeminiKeys } = await import("@/lib/gemini.server");
    invalidateGeminiKeys();
    return { ok: true as const };
  });
