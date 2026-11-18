import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateMentorBots } from "./mentor-bot-limit";

/** Loads the signed-in account's saved workspace (bots, licences, settings) as a JSON string. */
export const getPortalState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string | null> => {
    const { data, error } = await context.supabase
      .from("portal_state")
      .select("data")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.data) return null;
    return JSON.stringify(data.data);
  });

/** Persists the signed-in account's workspace so it follows them to any device/login. */
export const savePortalState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ json: z.string().max(2_000_000) }).parse(i))
  .handler(async ({ data, context }) => {
    let parsed: unknown;
    try { parsed = JSON.parse(data.json); } catch { throw new Error("invalid state payload"); }
    if (!parsed || typeof parsed !== "object" || !("eas" in parsed)) throw new Error("Invalid workspace.");
    const { data: previous, error: readError } = await context.supabase.from("portal_state").select("data").eq("user_id", context.userId).maybeSingle();
    if (readError) throw new Error(readError.message);
    const old = previous?.data;
    validateMentorBots(parsed.eas, old && typeof old === "object" && !Array.isArray(old) ? old.eas : []);
    const { error } = await context.supabase
      .from("portal_state")
      .upsert(
        { user_id: context.userId, data: parsed as never, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
