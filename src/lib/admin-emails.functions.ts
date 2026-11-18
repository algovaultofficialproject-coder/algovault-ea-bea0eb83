import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The single account allowed to reactivate client emails. */
export const REACTIVATION_OWNER = "mtwentwabantwana@gmail.com";
/** Always-open email — opens the mobile app even without a reactivation. */
export const ALWAYS_ALLOWED_EMAIL = "t16t85hql9f@gmail.com";
/** Shared mentor pass-phrase that unlocks the reactivation page. */
export const REACTIVATION_PASSWORD = "T16T85HQL9F";

/**
 * Reactivation is owner-only. We resolve the caller's email from the verified
 * token claims first (always present) and fall back to the profiles row, so a
 * missing/stale profile can no longer produce a spurious "Forbidden".
 */
async function assertOwner(ctx: { userId: string; claims: Record<string, unknown> }, password?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Anyone holding the reactivation pass-phrase may approve client emails.
  if ((password ?? "").trim().toUpperCase() === REACTIVATION_PASSWORD) return supabaseAdmin;
  const claimEmail = String((ctx.claims as { email?: string }).email ?? "").toLowerCase().trim();
  let email = claimEmail;
  if (!email) {
    const { data } = await supabaseAdmin
      .from("profiles").select("email").eq("id", ctx.userId).maybeSingle();
    email = String(data?.email ?? "").toLowerCase().trim();
  }
  if (email !== REACTIVATION_OWNER) {
    throw new Error("Enter the reactivation password to continue.");
  }
  return supabaseAdmin;
}

export const reactivateEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().email(), password: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context, data.password);
    const email = data.email.toLowerCase().trim();
    const { error } = await admin
      .from("activated_emails")
      .upsert({ email, approved: true, reactivation_pending: false, used_at: null }, { onConflict: "email" });
    if (error) throw new Error(error.message);
    const { sendGmail } = await import("./gmail.server");
    await sendGmail(email, "Your Algo Vault EA access is active", [
      "Good news — your email has been activated for the AlgoVault trading app.",
      "Open the app, enter your mentor ID and this email, then connect your bot with your licence key.",
    ]);
    return { ok: true };
  });

export const deactivateEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().email(), password: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context, data.password);
    const { error } = await admin
      .from("activated_emails")
      .update({ approved: false })
      .eq("email", data.email.toLowerCase().trim());
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listActivatedEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ password: z.string().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context, data?.password);
    const { data: rows, error } = await admin
      .from("activated_emails")
      .select("email, approved")
      .order("email");
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ email: string; approved: boolean }>;
  });

export const checkMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const claimEmail = String((context.claims as { email?: string }).email ?? "").toLowerCase().trim();
    const { data: prof } = await supabaseAdmin
      .from("profiles").select("email,is_admin").eq("id", context.userId).maybeSingle();
    const email = (prof?.email ?? claimEmail ?? "").toLowerCase().trim();
    if (!email) return { access: false, email: null as string | null };
    if (email === REACTIVATION_OWNER || email === ALWAYS_ALLOWED_EMAIL || prof?.is_admin) {
      return { access: true, email };
    }
    const { data } = await supabaseAdmin
      .from("activated_emails")
      .select("approved").eq("email", email).maybeSingle();
    return { access: !!data?.approved, email };
  });
