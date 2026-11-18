/**
 * Alternative MT5 provider: MetaApi (https://metaapi.cloud).
 *
 * Swagger references:
 *  - Provisioning API: https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/swagger
 *  - MetaTrader Client API: https://mt-client-api-v1.new-york.agiliumtrade.ai/swagger
 *
 * Flow: create (or reuse) a cloud MetaTrader account from login/password/server,
 * deploy it, wait until the broker connection is established, then use the
 * client API for account information and trading.
 *
 * Requires the METAAPI_TOKEN server secret.
 */

const REGION = () => process.env.METAAPI_REGION?.trim() || "new-york";
const PROV = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

export const metaApiConfigured = () => Boolean(process.env.METAAPI_TOKEN);

type Res = { ok: boolean; status: number; body: unknown; text: string };

async function call(
  base: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<Res> {
  const token = process.env.METAAPI_TOKEN;
  if (!token) return { ok: false, status: 0, body: null, text: "METAAPI_TOKEN not configured" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "auth-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    return { ok: r.ok, status: r.status, body, text };
  } catch (e: unknown) {
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "MetaApi timed out"
          : e.message
        : "Network error";
    return { ok: false, status: 0, body: null, text: msg };
  } finally {
    clearTimeout(t);
  }
}

function errOf(r: Res): string {
  const b = r.body as { message?: string; error?: string; details?: unknown } | null;
  return b?.message || b?.error || (r.text ? r.text.slice(0, 240) : `HTTP ${r.status}`);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Client-API region per account id (MetaApi accounts are region-pinned). */
const accountRegion = new Map<string, string>();
const clientFor = (id: string) =>
  `https://mt-client-api-v1.${accountRegion.get(id) ?? REGION()}.agiliumtrade.ai`;

async function findAccount(login: string, server: string): Promise<string | null> {
  const r = await call(
    PROV,
    `/users/current/accounts?login=${encodeURIComponent(login)}&limit=100`,
    { method: "GET" },
    20000,
  );
  if (!Array.isArray(r.body)) return null;
  const hit = (
    r.body as Array<{ _id?: string; login?: string; server?: string; region?: string }>
  ).find(
    (a) =>
      String(a.login) === String(login) && String(a.server).toLowerCase() === server.toLowerCase(),
  );
  if (hit?._id && hit.region) accountRegion.set(hit._id, hit.region);
  return hit?._id ?? null;
}

/** Connect an MT5 account through MetaApi. Returns a `metaapi:<accountId>` token. */
export async function metaApiConnect(login: string, password: string, server: string) {
  if (!metaApiConfigured()) {
    return {
      ok: false as const,
      error: "MetaApi fallback is not configured (missing METAAPI_TOKEN).",
    };
  }

  let accountId = await findAccount(login, server);

  if (!accountId) {
    const create = await call(
      PROV,
      "/users/current/accounts",
      {
        method: "POST",
        body: JSON.stringify({
          name: `algovault-${login}`,
          type: "cloud-g2",
          login: String(login),
          password,
          server,
          platform: "mt5",
          magic: 0,
          region: REGION(),
          keywords: ["algovault"],
        }),
      },
      45000,
    );
    const b = create.body as { id?: string; _id?: string } | null;
    accountId = b?.id ?? b?._id ?? null;
    if (!accountId) return { ok: false as const, error: `MetaApi: ${errOf(create)}` };
    accountRegion.set(accountId, REGION());
  }

  // Deploy (idempotent — already-deployed accounts answer 2xx or a conflict we can ignore).
  await call(PROV, `/users/current/accounts/${accountId}/deploy`, { method: "POST" }, 30000);

  // Wait for the broker connection to come up.
  for (let i = 0; i < 20; i++) {
    const st = await call(PROV, `/users/current/accounts/${accountId}`, { method: "GET" }, 20000);
    const a = st.body as { state?: string; connectionStatus?: string; region?: string } | null;
    if (a?.region) accountRegion.set(accountId, a.region);
    if (a?.connectionStatus === "CONNECTED") {
      return {
        ok: true as const,
        token: `metaapi:${accountId}`,
        server,
        base: clientFor(accountId),
        route: "metaapi.cloud",
      };
    }
    if (a?.state === "UNDEPLOYED" && i > 2) {
      await call(PROV, `/users/current/accounts/${accountId}/deploy`, { method: "POST" }, 20000);
    }
    await sleep(3000);
  }
  return {
    ok: false as const,
    error: "MetaApi: the broker connection did not come up in time. Try again in a minute.",
  };
}

const idOf = (token: string) => token.replace(/^metaapi:/, "");

export async function metaApiAccountSummary(token: string) {
  const r = await call(
    clientFor(idOf(token)),
    `/users/current/accounts/${idOf(token)}/account-information`,
    { method: "GET" },
    25000,
  );

  if (!r.ok) return { ok: false as const, error: `MetaApi: ${errOf(r)}` };
  const b = (r.body ?? {}) as {
    balance?: number;
    equity?: number;
    currency?: string;
    leverage?: number;
    profit?: number;
  };
  return { ok: true as const, info: b };
}

export async function metaApiOrderSend(p: {
  token: string;
  symbol: string;
  side: "BUY" | "SELL";
  lots: number;
  stoploss?: number;
  takeprofit?: number;
  comment?: string;
}) {
  const r = await call(
    clientFor(idOf(p.token)),
    `/users/current/accounts/${idOf(p.token)}/trade`,
    {
      method: "POST",
      body: JSON.stringify({
        actionType: p.side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
        symbol: p.symbol,
        volume: p.lots,
        stopLoss: p.stoploss || undefined,
        takeProfit: p.takeprofit || undefined,
        comment: p.comment ?? "AlgoVault",
      }),
    },
    35000,
  );
  const b = (r.body ?? {}) as {
    orderId?: string | number;
    positionId?: string | number;
    stringCode?: string;
    message?: string;
  };
  if (!r.ok || (b.stringCode && !/^TRADE_RETCODE_(DONE|PLACED)/.test(b.stringCode))) {
    return { ok: false as const, error: `MetaApi: ${b.message ?? errOf(r)}`, raw: r.body };
  }
  return { ok: true as const, ticket: b.positionId ?? b.orderId ?? null, raw: r.body };
}

export async function metaApiOrderModify(p: {
  token: string;
  ticket: string | number;
  stoploss?: number;
  takeprofit?: number;
}) {
  const r = await call(
    clientFor(idOf(p.token)),
    `/users/current/accounts/${idOf(p.token)}/trade`,
    {
      method: "POST",
      body: JSON.stringify({
        actionType: "POSITION_MODIFY",
        positionId: String(p.ticket),
        stopLoss: p.stoploss || undefined,
        takeProfit: p.takeprofit || undefined,
      }),
    },
    30000,
  );
  return { ok: r.ok, raw: r.body, error: r.ok ? undefined : `MetaApi: ${errOf(r)}` };
}

export async function metaApiOrderClose(token: string, ticket: string) {
  const r = await call(
    clientFor(idOf(token)),
    `/users/current/accounts/${idOf(token)}/trade`,
    {
      method: "POST",
      body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: String(ticket) }),
    },
    30000,
  );
  return { ok: r.ok, raw: r.body, error: r.ok ? undefined : `MetaApi: ${errOf(r)}` };
}

/** MetaApi accounts stay deployed between calls; nothing to tear down per request. */
export async function metaApiDisconnect(_token: string) {
  return;
}
