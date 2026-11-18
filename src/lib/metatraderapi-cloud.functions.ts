import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Broker integration via metatraderapi.cloud (Python-SDK compatible REST).
 * MT5 only. Requires METATRADERAPI_CLOUD_API_KEY on the server.
 *
 * Flow:
 *   POST /api/sessions/start/                    → { session_id }
 *   GET  /api/sessions/{id}/account-info/        → account details
 *   POST /api/sessions/{id}/trade/open/          → open a market trade
 *   POST /api/sessions/{id}/trade/close/         → close a trade
 *   POST /api/sessions/{id}/close/               → end session
 */

const BASE = "https://metatraderapi.cloud";

function apiKey() {
  const k = process.env.METATRADERAPI_CLOUD_API_KEY;
  if (!k) throw new Error("METATRADERAPI_CLOUD_API_KEY not configured");
  return k;
}

async function req(path: string, init: RequestInit = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Api-Key ${apiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : "Network error" } };
  } finally { clearTimeout(t); }
}
function err(b: unknown, s: number) {
  const o = b as { message?: string; error?: string; detail?: string } | null;
  return o?.message || o?.error || o?.detail || (typeof b === "string" ? b : `HTTP ${s}`);
}

const ConnectIn = z.object({
  broker: z.string().min(1),
  login: z.string().min(1),
  password: z.string().min(1),
  server: z.string().min(2),
});

async function startSession(d: z.infer<typeof ConnectIn>) {
  const r = await req("/api/sessions/start/", {
    method: "POST",
    body: JSON.stringify({
      platform: "MT5", server: d.server,
      login: Number(d.login) || d.login, password: d.password,
      broker: d.broker,
    }),
  });
  if (!r.ok) return { ok: false as const, error: err(r.body, r.status) };
  const b = r.body as { session_id?: string; id?: string };
  const id = b?.session_id ?? b?.id;
  if (!id) return { ok: false as const, error: "no session id returned" };
  return { ok: true as const, sessionId: String(id) };
}

/** Verify MT5 credentials via a short-lived session. */
export const mtaCloudTestConnection = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ConnectIn.parse(i))
  .handler(async ({ data }) => {
    const s = await startSession(data);
    if (!s.ok) return s;
    const info = await req(`/api/sessions/${s.sessionId}/account-info/`);
    await req(`/api/sessions/${s.sessionId}/close/`, { method: "POST" }).catch(() => {});
    if (!info.ok) return { ok: false as const, error: err(info.body, info.status) };
    const a = (info.body ?? {}) as { balance?: number; equity?: number; currency?: string; leverage?: number };
    return {
      ok: true as const,
      balance: a.balance ?? 0, equity: a.equity ?? 0,
      currency: a.currency ?? null, leverage: a.leverage ?? null,
    };
  });

const TradeIn = z.object({
  sessionId: z.string().min(3),
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  lot: z.number().positive(),
  sl: z.number().nullable().optional(),
  tp: z.number().nullable().optional(),
});

export const mtaCloudOpenTrade = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TradeIn.parse(i))
  .handler(async ({ data }) => {
    const r = await req(`/api/sessions/${data.sessionId}/trade/open/`, {
      method: "POST",
      body: JSON.stringify({
        symbol: data.symbol, trade_type: data.side, volume: data.lot,
        stop_loss: data.sl ?? undefined, take_profit: data.tp ?? undefined,
      }),
    });
    if (!r.ok) return { ok: false as const, error: err(r.body, r.status) };
    const b = r.body as { ticket?: number | string; order?: number };
    return { ok: true as const, ticket: String(b?.ticket ?? b?.order ?? "") };
  });

export const mtaCloudConnectAndStore = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ConnectIn.parse(i))
  .handler(async ({ data }) => {
    const s = await startSession(data);
    if (!s.ok) return s;
    const info = await req(`/api/sessions/${s.sessionId}/account-info/`);
    if (!info.ok) return { ok: false as const, error: err(info.body, info.status) };
    const a = (info.body ?? {}) as { balance?: number; equity?: number; currency?: string; leverage?: number };
    return {
      ok: true as const,
      sessionId: s.sessionId,
      balance: a.balance ?? 0, equity: a.equity ?? 0,
      currency: a.currency ?? null, leverage: a.leverage ?? null,
    };
  });
