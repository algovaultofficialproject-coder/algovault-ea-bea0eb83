import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * FastForex.io live FX/crypto quotes.
 * NOTE: FastForex is a data provider only — it cannot execute trades or
 * connect to a broker account. Order execution still runs through MetaApi.
 */

const BASE = "https://api.fastforex.io";

function key() {
  const k = process.env.FASTFOREX_API_KEY;
  if (!k) throw new Error("FASTFOREX_API_KEY not configured");
  return k;
}

async function ff(path: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ ...params, api_key: key() });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${BASE}${path}?${q}`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!r.ok) return { ok: false as const, error: json?.error || json?.message || `HTTP ${r.status}` };
    return { ok: true as const, data: json };
  } catch (e: unknown) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Network error" };
  } finally { clearTimeout(t); }
}

/** Get a single live quote, e.g. { from: "EUR", to: "USD" }. */
export const getLiveQuote = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    from: z.string().min(3).max(6),
    to: z.string().min(3).max(6),
  }).parse(i))
  .handler(async ({ data }) => {
    const r = await ff("/fetch-one", { from: data.from.toUpperCase(), to: data.to.toUpperCase() });
    if (!r.ok) return { ok: false as const, error: r.error };
    const price = r.data?.result?.[data.to.toUpperCase()];
    return { ok: true as const, price: Number(price), updated: r.data?.updated ?? null };
  });

/** Get multiple quotes at once from a base currency. */
export const getLiveQuotes = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    from: z.string().min(3).max(6),
    to: z.array(z.string().min(3).max(6)).min(1).max(30),
  }).parse(i))
  .handler(async ({ data }) => {
    const r = await ff("/fetch-multi", {
      from: data.from.toUpperCase(),
      to: data.to.map((s) => s.toUpperCase()).join(","),
    });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, results: (r.data?.results ?? {}) as Record<string, number>, updated: r.data?.updated ?? null };
  });

/** Historical daily close for a currency pair. */
export const getHistoricalQuote = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    from: z.string().min(3).max(6),
    to: z.string().min(3).max(6),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(i))
  .handler(async ({ data }) => {
    const r = await ff("/historical", {
      from: data.from.toUpperCase(),
      to: data.to.toUpperCase(),
      date: data.date,
    });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, data: r.data };
  });

/** List all supported currencies. */
export const listSupportedCurrencies = createServerFn({ method: "GET" })
  .handler(async () => {
    const r = await ff("/currencies");
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, currencies: r.data?.currencies ?? {} };
  });
