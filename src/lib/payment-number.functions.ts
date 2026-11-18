import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, timingSafeEqual } from "crypto";

const PASSWORD = "t16t85hql9f@gmail.com";

export const getPaymentNumber = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", "payment_whatsapp").maybeSingle();
  return { number: data?.value ?? "27642060527" };
});

export const setPaymentNumber = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200), number: z.string().max(30) }).parse(d))
  .handler(async ({ data }) => {
    const a = createHash("sha256").update(data.password.trim().toLowerCase()).digest();
    const b = createHash("sha256").update(PASSWORD).digest();
    if (!timingSafeEqual(a, b)) return { ok: false as const, error: "Wrong password." };
    let n = data.number.replace(/\D/g, "");
    if (n.startsWith("0")) n = "27" + n.slice(1);
    if (n.length < 9) return { ok: false as const, error: "Enter a valid phone number." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings")
      .upsert({ key: "payment_whatsapp", value: n, updated_at: new Date().toISOString() });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, number: n };
  });
