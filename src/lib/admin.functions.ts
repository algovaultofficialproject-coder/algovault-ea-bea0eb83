import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { adminListUsers, adminSendReset, adminEnsureAdmin } from "./admin.server";

export const listAuthUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await adminEnsureAdmin(context.userId);
    return adminListUsers();
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().email(), origin: z.string().url().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await adminEnsureAdmin(context.userId);
    const redirectTo = data.origin ? `${new URL(data.origin).origin}/reset-password` : undefined;
    return adminSendReset(data.email, redirectTo);
  });
