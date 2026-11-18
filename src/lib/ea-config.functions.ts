import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const symbolSchema = z.object({
  symbol: z.string(),
  lotSize: z.string(),
  action: z.string(),
  platform: z.string(),
  allowed: z.boolean(),
  trades: z.string().optional(),
});

const payloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  backgroundVideo: z.string().nullable().optional(),
  symbols: z.array(symbolSchema).default([]),
});

export type EaConfigPayload = z.infer<typeof payloadSchema>;

/** Mentor pushes the live bot config (symbols, artwork, background video) to the cloud. */
export const publishEAConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().min(4), payload: payloadSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ea_configs").upsert(
      {
        code: data.code,
        owner_id: context.userId,
        payload: data.payload as never,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "code" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Clients pull the latest bot config by 10-digit bot code (public on purpose). */
export const fetchEAConfig = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ code: z.string().min(4) }).parse(i))
  .handler(async ({ data }): Promise<EaConfigPayload | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("ea_configs")
      .select("payload")
      .eq("code", data.code)
      .maybeSingle();
    if (!row?.payload) return null;
    const parsed = payloadSchema.safeParse(row.payload);
    return parsed.success ? parsed.data : null;
  });
