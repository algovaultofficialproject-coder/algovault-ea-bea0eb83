/**
 * Broker bridge via mtapi.io "full3" nodes.
 *
 *   MT4 → https://mt4full3.mtapi.io   (/ConnectEx → id, /OrderSend)
 *   MT5 → https://mt5full3.mtapi.io   (/ConnectEx → id, /OrderSendSafe)
 *
 * Both nodes require the `apikey` header. The key is managed by the portal
 * owner (Mentor portal → Bridge API keys) and stored in the database, so it can
 * be rotated when it expires without a redeploy. When it changes, every warm
 * session is dropped so connected users re-authenticate instantly with the new
 * key.
 *
 * IMPORTANT: mtapi.io answers errors with HTTP 200/201 and a JSON body
 * `{ message, code, stackTrace }`. A successful /ConnectEx answers with the
 * connection id as a bare string (our own deterministic id). So "HTTP ok" alone
 * must never be treated as success — we always inspect the body first.
 */

import { matchBrokerSymbol, parseSymbolList } from "@/lib/broker-symbol";

export type Platform = "mt4" | "mt5";

const HOST: Record<Platform, string> = {
  mt4: "https://mt4full3.mtapi.io",
  mt5: "https://mt5full3.mtapi.io",
};

const FALLBACK_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VybmFtZSI6Ik5xb2JpbGVsYW5nYSIsIkNvbWlkIjpudWxsLCJSb2xlaWQiOm51bGwsImlzcyI6InRtYXBpIiwic3ViIjoiTnFvYmlsZWxhbmdhIiwiYXVkIjpbIiJdLCJpYXQiOjE3ODU3ODE0Njd9.5kZk-FvUeunam3Kcv0pgyoW6PR-AxiAS1euT9BhDnys";

/** Cached bridge keys (short TTL so a rotation is picked up within seconds). */
const keyCache = new Map<Platform, { key: string; at: number }>();
const KEY_TTL = 15_000;

/** Tokens are auto-minted from a brand new tmapi console account this often. */
const ROTATE_DAYS = 10;
const ROTATE_MS = ROTATE_DAYS * 24 * 60 * 60 * 1000;
let rotating: Promise<string | null> | null = null;

/**
 * Mints a fresh tmapi.io console account + API token and stores it for both
 * platforms. Best effort: on any failure the previous key keeps working.
 */
async function rotateToken(): Promise<string | null> {
  if (rotating) return rotating;
  rotating = (async () => {
    try {
      const { provisionTmapiToken } = await import("./tmapi-provision.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { token, username } = await provisionTmapiToken();
      const now = new Date().toISOString();
      await supabaseAdmin.from("mtapi_keys").upsert(
        (["mt4", "mt5"] as Platform[]).map((p) => ({
          platform: p,
          api_key: token,
          updated_by: `auto:${username}`,
          updated_at: now,
        })),
        { onConflict: "platform" },
      );
      keyCache.clear();
      dropWarmSessions();
      return token;
    } catch {
      return null;
    } finally {
      rotating = null;
    }
  })();
  return rotating;
}

/** Reads the active bridge api key for a platform, auto-rotating when stale. */
export async function bridgeApiKey(platform: Platform): Promise<string> {
  const hit = keyCache.get(platform);
  if (hit && Date.now() - hit.at < KEY_TTL) return hit.key;
  let key = process.env.MTAPI_KEY || FALLBACK_KEY;
  let stale = true;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("mtapi_keys")
      .select("api_key, updated_at, updated_by")
      .eq("platform", platform)
      .maybeSingle();
    if (data?.api_key) {
      key = data.api_key;
      const age = Date.now() - new Date(data.updated_at ?? 0).getTime();
      // Only auto-rotate keys we minted ourselves — never overwrite a key the
      // owner pasted in manually until it is genuinely past its window.
      stale = age > ROTATE_MS;
    }
  } catch {
    /* fall back to env / built-in key */
  }

  if (stale) {
    const fresh = await rotateToken();
    if (fresh) key = fresh;
  }

  const prev = keyCache.get(platform);
  if (prev && prev.key !== key) dropWarmSessions();
  keyCache.set(platform, { key, at: Date.now() });
  return key;
}

/** Called after the owner rotates a key — forces instant reconnect everywhere. */
export function invalidateBridgeKey(platform?: Platform) {
  if (platform) keyCache.delete(platform);
  else keyCache.clear();
  dropWarmSessions();
}

/** Manual trigger for the auto-provisioner (owner tool). */
export async function rotateBridgeKeyNow() {
  const token = await rotateToken();
  return token ? { ok: true as const, token } : { ok: false as const, error: "Could not mint a new bridge token right now." };
}

const norm = (p?: string): Platform => (String(p ?? "mt4").toLowerCase() === "mt5" ? "mt5" : "mt4");

/** Remembers which bridge host issued a given connection id. */
const tokenBase = new Map<string, string>();
/** Warm sessions: `${platform}|${login}|${server}` → connection id. */
const warm = new Map<string, string>();

function dropWarmSessions() {
  warm.clear();
  tokenBase.clear();
}

/** Deterministic GUID client id so the same account reuses its session. */
export function clientId(platform: Platform, login: string, server: string): string {
  const seed = `${platform}:${login}:${server.toLowerCase()}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0xdeadbeef, h4 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = (Math.imul(h1 ^ c, 16777619) >>> 0);
    h2 = (Math.imul(h2 + c, 2654435761) >>> 0);
    h3 = (Math.imul(h3 ^ (c + i), 2246822519) >>> 0);
    h4 = (Math.imul(h4 + (c * (i + 1)), 3266489917) >>> 0);
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const s = hex(h1) + hex(h2) + hex(h3) + hex(h4);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

async function req(
  platform: Platform,
  path: string,
  params: Record<string, string | number | undefined>,
  timeoutMs = 30000,
  baseOverride?: string,
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
  }
  const id = typeof params.id === "string" ? params.id : undefined;
  const base = baseOverride ?? (id ? tokenBase.get(id) : undefined) ?? HOST[platform];
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    apikey: await bridgeApiKey(platform),
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}${path}?${qs.toString()}`, { headers, signal: ctrl.signal });
    const text = await r.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    return { ok: r.ok, status: r.status, body, text };
  } catch (e: unknown) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Broker API timed out" : e.message) : "Network error";
    return { ok: false, status: 0, body: null, text: msg };
  } finally {
    clearTimeout(t);
  }
}

/** Account symbol lists, cached per session for 10 minutes. */
const symbolCache = new Map<string, { at: number; list: string[] }>();

/** The account's own name for a typed symbol (e.g. "XAUUSD.M" → "XAUUSD.m"); typed text when the list is unavailable. */
async function brokerSymbol(platform: Platform, id: string, typed: string): Promise<string> {
  const sym = typed.trim();
  let hit = symbolCache.get(id);
  if (!hit || Date.now() - hit.at > 600_000) {
    let list: string[] = [];
    for (const path of platform === "mt5" ? ["/SymbolList", "/Symbols"] : ["/Symbols", "/SymbolList"]) {
      const r = await req(platform, path, { id }, 15000);
      if (!apiError(r)) list = parseSymbolList(r.body);
      if (list.length) break;
    }
    if (!list.length) return sym;
    hit = { at: Date.now(), list };
    symbolCache.set(id, hit);
  }
  return matchBrokerSymbol(sym, hit.list) ?? sym;
}

/** Returns a human error when the payload is an mtapi.io error object, else null. */
function apiError(r: { ok: boolean; status: number; body: unknown; text: string }): string | null {
  const b = r.body;
  if (b && typeof b === "object") {
    const o = b as { message?: string; error?: string; description?: string; code?: string };
    const raw = o.message || o.error || o.description;
    if (raw) return friendly(raw, o.code);
    if (!r.ok) return r.text || `HTTP ${r.status}`;
    return null;
  }
  if (!r.ok) {
    if (typeof b === "string" && b.trim()) return friendly(b.trim());
    return r.text || `HTTP ${r.status}`;
  }
  return null;
}

function friendly(msg: string, code?: string): string {
  const m = msg.trim();
  if (/Symbol not found/i.test(m)) {
    const sym = m.replace(/^Symbol not found:\s*/i, "").split("(")[0].trim();
    return `Symbol "${sym}" is not in this account's Market Watch. Use the exact broker name (some brokers add a suffix, e.g. ${sym}.m or ${sym}m).`;
  }
  if (/Server not found/i.test(m)) {
    return `Broker server name not recognised: ${m.replace(/^Server not found:\s*/i, "").split("(")[0].trim()}. Use the exact server name shown in your MetaTrader terminal (File → Open an Account).`;
  }
  if (/unauthor|api ?key|licen[cs]e|trial/i.test(m)) {
    return "The trading bridge key is not valid right now. The portal owner can update it in Mentor portal → Bridge API keys.";
  }
  if (code === "INVALID_ACCOUNT" || /invalid account|invalid_?password|Authorisation failed/i.test(m)) {
    if (/Please wait/i.test(m)) return "Broker rejected the last login attempt — wait ~10 seconds before retrying (repeated wrong logins are throttled).";
    return "Invalid account — login, password or server was rejected by the broker.";
  }
  if (/not found/i.test(m) && /Client with id/i.test(m)) return "Session expired — reconnecting.";
  if (/timeout|timed out/i.test(m)) return "The broker server did not respond in time. Try again in a moment.";
  return m;
}

function tokenFrom(body: unknown): string | null {
  if (typeof body === "string") {
    const s = body.replace(/^"|"$/g, "").trim();
    // A connection id is a GUID-ish token; never accept an error sentence.
    if (/^[A-Za-z0-9._-]{8,}$/.test(s)) return s;
    return null;
  }
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const k of ["id", "Id", "ID", "token", "Token", "connectionId", "ConnectExResult"]) {
      const v = b[k];
      if (typeof v === "string" && v.trim().length >= 8) return v.trim();
    }
  }
  return null;
}

/** Look up official server entries (name + access host:port list) via /Search. */
async function searchServers(platform: Platform, server: string) {
  const q = server.split(/[-_ ]/)[0];
  if (!q || q.length < 2) return [] as Array<{ name: string; access: string[] }>;
  const r = await req(platform, "/Search", { company: q }, 15000, HOST[platform]);
  if (!r.body || !Array.isArray(r.body)) return [];
  const out: Array<{ name: string; access: string[] }> = [];
  for (const c of r.body as Array<{ results?: Array<{ name?: string; access?: string[] }> }>) {
    for (const s of c.results ?? []) if (s.name) out.push({ name: s.name, access: s.access ?? [] });
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolve the closest official server name via /Search when the given one is unknown. */
async function resolveServerName(platform: Platform, server: string): Promise<string | null> {
  const hit = (await searchServers(platform, server)).find((s) => slug(s.name) === slug(server));
  return hit && hit.name !== server ? hit.name : null;
}

/** Is this connection id still alive on the bridge? */
async function isAlive(platform: Platform, id: string): Promise<boolean> {
  const r = await req(platform, "/AccountSummary", { id }, 8000);
  return apiError(r) === null;
}

const warmCheckedAt = new Map<string, number>();

export async function mtConnect(platform: Platform | string, user: string, password: string, server: string) {
  const p = norm(platform as string);
  const base = HOST[p];
  const login = user.trim();
  const srv = server.trim();
  const key = `${p}|${login}|${srv}`;

  // Turbo path — reuse a warm session instead of a fresh handshake.
  const cached = warm.get(key);
  if (cached) {
    tokenBase.set(cached, base);
    // Checked moments ago — skip the extra round trip so per-second refreshes stay fast; a dead session
    // still surfaces on the next call and callers reconnect.
    if (Date.now() - (warmCheckedAt.get(key) ?? 0) < 15_000) return { ok: true as const, token: cached, server: srv, base, route: "warm" };
    if (await isAlive(p, cached)) { warmCheckedAt.set(key, Date.now()); return { ok: true as const, token: cached, server: srv, base, route: "warm" }; }
    warm.delete(key); warmCheckedAt.delete(key);
  }

  const connect = async (serverName: string) => {
    const id = clientId(p, login, serverName);
    const r = await req(p, "/ConnectEx", {
      user: login,
      password,
      server: serverName,
      id,
      connectTimeoutSeconds: 30,
    }, 45000, base);

    // The bridge echoes our own id back on success.
    const token = tokenFrom(r.body) ?? (r.text.includes(id) ? id : null);
    if (token) {
      tokenBase.set(token, base);
      warm.set(key, token);
      warmCheckedAt.set(key, Date.now());
      return { ok: true as const, token, server: serverName, base, route: "/ConnectEx" };
    }
    return { ok: false as const, error: apiError(r) ?? `Unexpected broker response: ${r.text.slice(0, 200)}` };
  };

  const res = await connect(srv);
  if (res.ok) return res;

  // Unknown server name → resolve the official spelling and retry once.
  if (/server name not recognised|Server not found/i.test(res.error)) {
    const alt = await resolveServerName(p, srv);
    if (alt) return await connect(alt);
  }
  return res;
}

export async function mtAccountSummary(platform: Platform | string, id: string) {
  const p = norm(platform as string);
  const r = await req(p, "/AccountSummary", { id }, 20000);
  const err = apiError(r);
  if (err) return { ok: false as const, error: err };
  const b = (r.body ?? {}) as { balance?: number; equity?: number; currency?: string; leverage?: number; profit?: number };
  return { ok: true as const, info: b };
}

export async function mtOrderSend(platform: Platform | string, p: {
  id: string; symbol: string; side: "BUY" | "SELL";
  lots: number; stoploss?: number; takeprofit?: number; comment?: string; slippage?: number;
}) {
  const plat = norm(platform as string);
  const operation = p.side === "BUY" ? 0 : 1;
  const path = plat === "mt5" ? "/OrderSendSafe" : "/OrderSend";
  const r = await req(plat, path, {
    id: p.id,
    symbol: await brokerSymbol(plat, p.id, p.symbol),
    operation,
    volume: p.lots,
    stoploss: p.stoploss ?? 0,
    takeprofit: p.takeprofit ?? 0,
    slippage: p.slippage ?? 20,
    comment: p.comment ?? "AlgoVault",
  }, 45000);
  const err = apiError(r);
  if (err) return { ok: false as const, error: err, raw: r.body };
  const b = (r.body ?? {}) as { ticket?: number | string; order?: number | string };
  const ticket = b.ticket ?? b.order ?? (typeof r.body === "string" ? r.body.replace(/"/g, "").trim() : null);
  return { ok: true as const, ticket, raw: r.body };
}

export async function mtOrderModify(platform: Platform | string, p: {
  id: string; ticket: string | number; stoploss?: number; takeprofit?: number;
}) {
  const r = await req(norm(platform as string), "/OrderModify", {
    id: p.id,
    ticket: String(p.ticket),
    stoploss: p.stoploss ?? 0,
    takeprofit: p.takeprofit ?? 0,
  });
  const err = apiError(r);
  return { ok: !err, raw: r.body, error: err ?? undefined };
}

export async function mtOrderClose(platform: Platform | string, id: string, ticket: string) {
  const plat = norm(platform as string);
  // MT5 node only offers /OrderCloseSafe (retries on requote); MT4 uses /OrderClose.
  const r = plat === "mt5"
    ? await req(plat, "/OrderCloseSafe", { id, ticket, slippage: 20 }, 20000)
    : await req(plat, "/OrderClose", { id, ticket });
  const err = apiError(r);
  return { ok: !err, raw: r.body, error: err ?? undefined };
}

/**
 * Sessions are kept warm for turbo execution, so this is a no-op unless the
 * caller really wants the bridge session torn down (`force`).
 */
export async function mtDisconnect(platform: Platform | string, id: string, force = false) {
  if (!force) return;
  await req(norm(platform as string), "/Disconnect", { id }, 8000).catch(() => {});
  tokenBase.delete(id);
  symbolCache.delete(id);
  for (const [k, v] of warm) if (v === id) warm.delete(k);
}

export interface OpenOrder {
  ticket: string; symbol: string; profit: number; lots: number; comment: string; type: string; openedAt: number;
  openPrice: number; price: number; sl: number; tp: number;
}

/** Currently open orders on the account (ticket, profit, ...). */
export async function mtOpenedOrders(platform: Platform | string, id: string) {
  const r = await req(norm(platform as string), "/OpenedOrders", { id }, 20000);
  const err = apiError(r);
  if (err) return { ok: false as const, error: err, orders: [] as OpenOrder[] };
  const arr = Array.isArray(r.body) ? (r.body as Record<string, unknown>[]) : [];
  const orders: OpenOrder[] = arr.map((o) => ({
    ticket: String(o.ticket ?? o.order ?? ""),
    symbol: String(o.symbol ?? ""),
    profit: Number(o.profit ?? 0) + Number(o.swap ?? 0) + Number(o.commission ?? 0),
    lots: Number(o.lots ?? o.volume ?? 0),
    comment: String(o.comment ?? ""),
    type: String(o.type ?? o.orderType ?? ""),
    openedAt: Number(o.openTimestampUTC ?? 0) || Date.parse(String(o.openTime ?? "")) || Date.now(),
    openPrice: Number(o.openPrice ?? o.OpenPrice ?? 0) || 0,
    price: Number(o.closePrice ?? o.currentPrice ?? o.ClosePrice ?? 0) || 0,
    sl: Number(o.stopLoss ?? o.StopLoss ?? o.sl ?? 0) || 0,
    tp: Number(o.takeProfit ?? o.TakeProfit ?? o.tp ?? 0) || 0,
  })).filter((o) => o.ticket);
  return { ok: true as const, orders };
}

/** mtapi.io operation codes shared by MT4 and MT5: 0 Buy, 1 Sell, 2 BuyLimit, 3 SellLimit, 4 BuyStop, 5 SellStop. */
export const PENDING_OP = { BUY_LIMIT: 2, SELL_LIMIT: 3, BUY_STOP: 4, SELL_STOP: 5 } as const;

/** Places a pending order at an exact price. Broker confirmation = a ticket in the response; anything else is a rejection. */
export async function mtPendingSend(platform: Platform | string, p: {
  id: string; symbol: string; type: keyof typeof PENDING_OP; price: number; lots: number;
  stoploss: number; takeprofit: number; expiration?: number; comment?: string;
}) {
  const plat = norm(platform as string);
  const params: Record<string, string | number> = {
    id: p.id, symbol: await brokerSymbol(plat, p.id, p.symbol), operation: PENDING_OP[p.type], volume: p.lots, price: p.price,
    stoploss: p.stoploss, takeprofit: p.takeprofit, slippage: 0, comment: p.comment ?? "AlgoVault Pending",
  };
  if (p.expiration) {
    params.expiration = new Date(p.expiration).toISOString().slice(0, 19);
    if (plat === "mt5") params.expirationType = "Specified";
  }
  const r = await req(plat, "/OrderSend", params, 45000);
  const err = apiError(r);
  if (err) return { ok: false as const, error: err, raw: r.body };
  const b = (r.body ?? {}) as { ticket?: number | string; order?: number | string };
  const ticket = b.ticket ?? b.order ?? (typeof r.body === "string" ? r.body.replace(/"/g, "").trim() : null);
  if (!ticket) return { ok: false as const, error: "Broker did not confirm the order (no ticket returned)", raw: r.body };
  return { ok: true as const, ticket: String(ticket), raw: r.body };
}

/** Cancels a pending order (MT4 /OrderDelete, MT5 /OrderClose on the pending ticket). */
export async function mtPendingCancel(platform: Platform | string, id: string, ticket: string) {
  const plat = norm(platform as string);
  const r = plat === "mt5" ? await req(plat, "/OrderClose", { id, ticket }, 20000) : await req(plat, "/OrderDelete", { id, ticket }, 20000);
  const err = apiError(r);
  return { ok: !err, error: err ?? undefined };
}

/** Live bid/ask plus the broker's symbol rules (tick size, digits, stops/freeze level, lot limits) when the bridge reports them. */
export async function mtSymbolInfo(platform: Platform | string, id: string, symbol: string) {
  const plat = norm(platform as string);
  symbol = await brokerSymbol(plat, id, symbol);
  const [q, s] = await Promise.all([req(plat, "/GetQuote", { id, symbol }, 15000), req(plat, "/SymbolParams", { id, symbol }, 15000)]);
  const qe = apiError(q);
  const qb = (q.body ?? {}) as Record<string, unknown>;
  const sb = (s.body ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const flat = { ...(sb.symbolInfo ?? {}), ...(sb.symbol ?? {}), ...(sb.symbolGroup ?? {}) } as Record<string, unknown>;
  const num = (...keys: string[]) => { for (const k of keys) { const v = Number(flat[k]); if (Number.isFinite(v) && v > 0) return v; } return undefined; };
  const digits = num("digits", "Digits");
  return {
    quote: qe ? null : { bid: Number(qb.bid ?? qb.Bid), ask: Number(qb.ask ?? qb.Ask), at: Date.now() },
    quoteError: qe ?? undefined,
    spec: {
      tick: num("tickSize", "TickSize", "point", "Point", "points") ?? (digits ? 10 ** -digits : undefined),
      digits, minStopTicks: num("stopsLevel", "StopsLevel", "stopLevel", "StopLevel"), freezeTicks: num("freezeLevel", "FreezeLevel"),
      contract: num("contractSize", "ContractSize", "lotSize"), lotStep: num("lotStep", "LotStep", "volumeStep", "VolumeStep"),
      minLot: num("minLot", "MinLot", "volumeMin", "MinVolume"), maxLot: num("maxLot", "MaxLot", "volumeMax", "MaxVolume"),
    },
  };
}
