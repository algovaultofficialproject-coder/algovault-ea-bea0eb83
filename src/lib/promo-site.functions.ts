import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SLUG_PATTERN } from "./promo-site";

/** Per-request publishable client: public reads only, no shared session. */
function publicClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("This page is temporarily unavailable.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export type PublicPromoSite = {
  slug: string;
  bot_name: string;
  headline: string;
  tagline: string;
  description: string;
  features: string[];
  price_text: string;
  whatsapp: string;
  telegram: string;
  cta_label: string;
  image: string | null;
  accent: string;
  old_price: string;
  offer_percent: number;
  offer_ends_at: string | null;
  stat_text: string;
  phone_interface: string;
};

export const getPublicPromoSite = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ slug: z.string().regex(SLUG_PATTERN) }).parse(i))
  .handler(async ({ data }): Promise<PublicPromoSite | null> => {
    const client = publicClient();
    const { data: row, error } = await client
      .from("promo_sites")
      .select("slug,bot_name,headline,tagline,description,features,price_text,whatsapp,telegram,cta_label,image,accent,old_price,offer_percent,offer_ends_at,stat_text,phone_interface")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw new Error("Could not load this page right now.");
    return (row as PublicPromoSite | null) ?? null;
  });

export const recordPromoView = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ slug: z.string().regex(SLUG_PATTERN) }).parse(i))
  .handler(async ({ data }) => {
    await publicClient().rpc("bump_promo_view", { _slug: data.slug });
    return { ok: true };
  });

export const submitPromoLead = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      slug: z.string().regex(SLUG_PATTERN),
      name: z.string().trim().min(1).max(80),
      contact: z.string().trim().min(3).max(120),
      message: z.string().trim().max(1000).default(""),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { data: ok, error } = await publicClient().rpc("submit_promo_lead", {
      _slug: data.slug, _name: data.name, _contact: data.contact, _message: data.message,
    });
    if (error || !ok) return { ok: false, error: "Could not send your details. Please try again later." };
    return { ok: true as const };
  });
