import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/** Registration itself verifies the recipient; no arbitrary email-send action. */
export const registerMentor = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/),
    phone: z.string().trim().min(1).max(32),
    // Origin only; the auth service's redirect allow-list decides whether it is honoured.
    redirectTo: z.string().url().max(200).refine((v) => {
      const u = new URL(v);
      return (u.protocol === "https:" || u.hostname === "localhost") && u.pathname === "/" && !u.search && !u.hash;
    }),
  }).parse(input))
  .handler(async ({ data }) => {
    const url = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Registration is temporarily unavailable.");
    // Per-request client: never share authentication state between visitors.
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      } },
    });
    const { data: result, error } = await client.auth.signUp({
      email: data.email, password: data.password,
      options: { emailRedirectTo: data.redirectTo, data: { phone: data.phone } },
    });
    if (error) throw new Error(error.message);
    let emailed = false;
    // Existing-address responses deliberately hide whether an account exists.
    if (result.user?.identities?.length) {
      const { sendGmail } = await import("./gmail.server");
      emailed = (await sendGmail(result.user.email ?? data.email, "Welcome to Algo Vault EA", [
        "Your mentor registration has been received. Welcome to AlgoVault.",
        "Your account is approved and ready. You can open your mentor workspace right away.",
        "Keep your account password and client licence keys private.",
      ])).sent;
    }
    return { session: result.session, emailed };
  });