import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Developer end-to-end test for MetaApi.cloud.
 * Provisions an account, polls until CONNECTED/DEPLOYED, fetches
 * account-information, and optionally sends a real trade.
 * Admin-gated via is_admin().
 */

const PROVISIONING_BASE = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const CLIENT_BASE = (region: string) => `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
const DEFAULT_REGION = "new-york";

async function mapi(url: string, init: RequestInit = {}, timeoutMs = 20000) {
  const key = process.env.METAAPI_TOKEN;
  if (!key) return { ok: false, status: 0, body: { error: "METAAPI_TOKEN not configured" }, ms: 0 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(url, {
      ...init,
      headers: {
        "auth-token": key,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { ok: r.ok, status: r.status, body, ms: Date.now() - started };
  } catch (e: unknown) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : "Network error" }, ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

const Input = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
  server: z.string().min(1),
  platform: z.enum(["MT4", "MT5"]).default("MT5"),
  region: z.string().default(DEFAULT_REGION),
  symbol: z.string().default("EURUSD"),
  side: z.enum(["BUY", "SELL"]).default("BUY"),
  volume: z.number().positive().max(1).default(0.01),
  stopLoss: z.number().optional(),
  takeProfit: z.number().optional(),
  execute: z.boolean().default(false),
  cleanup: z.boolean().default(true),
});

export const devTestMtapi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _uid: context.userId });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const region = data.region;
    const steps: Array<{ step: string; request?: any; status: number; ms?: number; response: any; ok: boolean }> = [];

    // 1) Create account
    const createReq = {
      name: `devtest ${data.login}`,
      type: "cloud-g2",
      login: data.login,
      password: "***redacted***",
      server: data.server,
      platform: data.platform.toLowerCase(),
      magic: 0,
      application: "MetaApi",
      region,
      reliability: "regular",
    };
    const create = await mapi(`${PROVISIONING_BASE}/users/current/accounts`, {
      method: "POST",
      body: JSON.stringify({ ...createReq, password: data.password }),
    });
    steps.push({ step: "POST /users/current/accounts", request: createReq, status: create.status, ms: create.ms, response: create.body, ok: create.ok });
    if (!create.ok) return { ok: false, steps, error: create.body?.message || create.body?.error || `HTTP ${create.status}` };

    const accountId: string | undefined = create.body?.id;
    if (!accountId) return { ok: false, steps, error: "No account id in response" };

    // 2) Deploy
    const deploy = await mapi(`${PROVISIONING_BASE}/users/current/accounts/${accountId}/deploy`, { method: "POST" }, 15000);
    steps.push({ step: `POST /users/current/accounts/${accountId}/deploy`, status: deploy.status, ms: deploy.ms, response: deploy.body, ok: deploy.ok });

    // 3) Poll status until connected (up to ~45s)
    const startedAt = Date.now();
    let finalStatus: any = null;
    while (Date.now() - startedAt < 45000) {
      const s = await mapi(`${PROVISIONING_BASE}/users/current/accounts/${accountId}`, { method: "GET" }, 10000);
      finalStatus = s.body;
      if (s.ok && s.body?.state === "DEPLOYED" && s.body?.connectionStatus === "CONNECTED") break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    steps.push({ step: `GET /users/current/accounts/${accountId} (poll)`, status: 200, response: { state: finalStatus?.state, connectionStatus: finalStatus?.connectionStatus }, ok: finalStatus?.connectionStatus === "CONNECTED" });

    // 4) Account information
    const acct = await mapi(`${CLIENT_BASE(region)}/users/current/accounts/${accountId}/account-information`, { method: "GET" }, 15000);
    steps.push({ step: `GET client/${region} /accounts/${accountId}/account-information`, status: acct.status, ms: acct.ms, response: acct.body, ok: acct.ok });

    // 5) Trade payload — dry-run unless execute:true
    const tradePayload = {
      actionType: data.side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
      symbol: data.symbol,
      volume: data.volume,
      stopLoss: data.stopLoss,
      takeProfit: data.takeProfit,
      comment: "AlgoVault-devtest",
    };
    if (data.execute) {
      const tr = await mapi(`${CLIENT_BASE(region)}/users/current/accounts/${accountId}/trade`, { method: "POST", body: JSON.stringify(tradePayload) });
      steps.push({ step: `POST client/${region} /accounts/${accountId}/trade`, request: tradePayload, status: tr.status, ms: tr.ms, response: tr.body, ok: tr.ok });
    } else {
      steps.push({ step: `DRY-RUN POST /accounts/${accountId}/trade`, request: tradePayload, status: 0, response: "not sent (execute=false)", ok: true });
    }

    // 6) Cleanup: undeploy + delete
    if (data.cleanup) {
      const ud = await mapi(`${PROVISIONING_BASE}/users/current/accounts/${accountId}/undeploy`, { method: "POST" }, 10000);
      steps.push({ step: `POST /accounts/${accountId}/undeploy`, status: ud.status, ms: ud.ms, response: ud.body, ok: ud.ok });
      const del = await mapi(`${PROVISIONING_BASE}/users/current/accounts/${accountId}`, { method: "DELETE" }, 10000);
      steps.push({ step: `DELETE /accounts/${accountId}`, status: del.status, ms: del.ms, response: del.body, ok: del.ok });
    }

    return { ok: steps.every((s) => s.ok), accountId, region, steps };
  });
