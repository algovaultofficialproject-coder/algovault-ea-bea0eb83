import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const normKey = (k: string) => k.trim().toUpperCase().replace(/\s+/g, "");

const eaSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  backgroundVideo: z.string().nullable().optional(),
  symbols: z
    .array(
      z.object({
        symbol: z.string(),
        lotSize: z.string(),
        action: z.string(),
        platform: z.string(),
        allowed: z.boolean(),
      }),
    )
    .default([]),
});

/** Publishes a freshly created licence to the cloud so any client can redeem it. */
export const publishLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        key: z.string().min(4),
        userName: z.string().default(""),
        duration: z.string().default(""),
        clientEmail: z.string().email().optional().nullable(),
        ea: eaSchema,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("portal_licenses").upsert(
      {
        key: normKey(data.key),
        user_name: data.userName,
        ea_name: data.ea.name,
        ea_payload: data.ea as never,
        duration: data.duration,
        issued_by: context.userId,
        active: true,
      } as never,
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    let emailed = false;
    if (data.clientEmail) {
      const { sendGmail } = await import("./gmail.server");
      const lifetime = /LIFETIME|∞/i.test(data.duration);
      const plan = lifetime ? "Lifetime" : data.duration.replace(/^(\d+)\s*(\w)(\w*)$/, (_m, n, a, b) => `${n} ${a}${b.toLowerCase()}`);
      emailed = (await sendGmail(data.clientEmail, "Your Licence Key", [
        `Hi ${data.userName || "there"},`,
        "Your licence key has been generated. Enter it in the AlgoVault app to connect your bot. Each key works once.",
        lifetime ? "This licence never expires." : `This licence lasts ${plan.toLowerCase()} from the day you activate it. After that the bot is removed from the app automatically.`,
      ], { key: normKey(data.key), pills: [["Bot", data.ea.name], ["Plan", plan], ["Status", "Ready to activate"]] })).sent;
    }
    return { ok: true, emailed };
  });

export interface RedeemedLicense {
  key: string;
  userName: string;
  duration: string;
  ea: z.infer<typeof eaSchema>;
}

/**
 * Redeems a licence key from the cloud. Public on purpose: clients activate the
 * robot before they ever create an account, from any device.
 */
export const redeemLicense = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ key: z.string().min(1) }).parse(i))
  .handler(async ({ data }): Promise<RedeemedLicense> => {
    const key = normKey(data.key);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("portal_licenses")
      .select("key, user_name, duration, ea_name, ea_payload, active")
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Invalid license key");
    if (!row.active) throw new Error("This license key has already been used");

    await supabaseAdmin
      .from("portal_licenses")
      .update({ active: false, redeemed_at: new Date().toISOString() } as never)
      .eq("key", key);

    const payload = (row.ea_payload ?? {}) as Record<string, unknown>;
    return {
      key: row.key as string,
      userName: (row.user_name as string) ?? "",
      duration: (row.duration as string) ?? "",
      ea: {
        id: (payload["id"] as string) || crypto.randomUUID(),
        name: (payload["name"] as string) || (row.ea_name as string),
        image: (payload["image"] as string | null) ?? null,
        backgroundVideo: (payload["backgroundVideo"] as string | null) ?? null,
        symbols: (payload["symbols"] as RedeemedLicense["ea"]["symbols"]) ?? [],
      },
    };
  });
