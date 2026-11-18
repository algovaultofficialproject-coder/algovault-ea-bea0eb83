import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Universal broker web-bridge: user pastes a REST endpoint URL + API key
 * from any broker web terminal / third-party bridge. We POST orders/tests
 * to that URL server-side with the API key attached as a Bearer token so
 * the credentials never live in the browser.
 */

const HeadersIn = z.record(z.string(), z.string()).optional();

async function call(url: string, apiKey: string, body: unknown, extraHeaders?: Record<string, string>) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Api-Key": apiKey,
        ...(extraHeaders || {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { ok: r.ok, status: r.status, body: parsed };
  } catch (e: unknown) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : "Network error" } };
  } finally { clearTimeout(t); }
}

export const testCustomBroker = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    url: z.string().url(),
    apiKey: z.string().min(4),
    headers: HeadersIn,
  }).parse(i))
  .handler(async ({ data }) => {
    const r = await call(data.url, data.apiKey, { action: "ping" }, data.headers);
    const raw = safeStringify(r.body);
    if (!r.ok) return { ok: false as const, error: (r.body as any)?.error || (r.body as any)?.message || `HTTP ${r.status}`, raw };
    return { ok: true as const, error: null as string | null, raw };
  });

export const executeCustomBrokerOrder = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    url: z.string().url(),
    apiKey: z.string().min(4),
    symbol: z.string().min(1),
    side: z.enum(["BUY", "SELL"]),
    volume: z.number().positive(),
    stop_loss: z.number().optional(),
    take_profit: z.number().optional(),
    comment: z.string().optional(),
    headers: HeadersIn,
  }).parse(i))
  .handler(async ({ data }) => {
    const { url, apiKey, headers, ...order } = data;
    const r = await call(url, apiKey, { action: "open", ...order }, headers);
    const raw = safeStringify(r.body);
    if (!r.ok) return { ok: false as const, error: (r.body as any)?.error || (r.body as any)?.message || `HTTP ${r.status}`, raw };
    return { ok: true as const, error: null as string | null, raw };
  });

function safeStringify(v: unknown): string {
  try { return typeof v === "string" ? v : JSON.stringify(v ?? null); } catch { return ""; }
}