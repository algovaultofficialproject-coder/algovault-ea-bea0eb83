import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { appAccessDecision, isAlwaysOpen, sessionStillValid } from "./app-access";

/**
 * Single-use app access with a time limit.
 *
 * The owner reactivates an email for a number of days → that email can sign in
 * on one phone. Signing in consumes the approval and gives that phone a session;
 * the phone stays in until the days run out or the owner removes it.
 */
export const consumeAppAccess = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    if (isAlwaysOpen(email)) return { ok: true as const, email, session: "always-open", until: null as string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("activated_emails")
      .select("email, approved, access_until")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      return { ok: false as const, code: "unavailable" as const, error: "Could not verify this email right now. Try again." };
    }

    const decision = appAccessDecision(email, row ?? null);
    if (!decision.ok) return { ok: false as const, code: decision.code, error: decision.error };

    // Consume the approval and bind this phone — one phone per reactivation.
    const session = crypto.randomUUID();
    const { error: upErr } = await supabaseAdmin
      .from("activated_emails")
      .update({ approved: false, reactivation_pending: true, used_at: new Date().toISOString(), session_id: session })
      .eq("email", email);
    if (upErr) return { ok: false as const, code: "unavailable" as const, error: "Could not verify this email right now. Try again." };

    return { ok: true as const, email, session, until: row?.access_until ?? null };
  });

/** Is this phone still allowed in? Answers only yes/no plus the end date. */
export const checkAppSession = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().email(), session: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    if (isAlwaysOpen(email)) return { ok: true as const, until: null as string | null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("activated_emails")
      .select("session_id, access_until")
      .eq("email", email)
      .maybeSingle();
    if (error) return { ok: null, until: null }; // unknown — keep the phone signed in
    return { ok: sessionStillValid(email, data.session, row ?? null, Date.now()), until: row?.access_until ?? null };
  });
