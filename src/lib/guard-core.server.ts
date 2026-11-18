/** Server-side position reading, verified closing and the 24/7 guard run. Never opens trades. */
import { mtConnect, mtDisconnect, mtOpenedOrders, mtOrderClose, type Platform } from "@/lib/mtapi-online.server";
import { loadCandles } from "@/lib/market-data.server";
import { buildSeries } from "@/lib/autotrader-pro/indicators";
import { closedIndex, INTERVAL_MS } from "@/lib/autotrader-pro/engine";
import { GUARD_FRAMES, readFrame, type FrameRead } from "@/lib/autotrader-pro/position-guard";
import { mergeEvents, planExits, type GuardEvent } from "@/lib/autotrader-pro/cloud-guard";

export interface GuardCreds { platform: Platform; login: string; password: string; server: string }

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Connect, or drop a stale warm session and reconnect once, so one expired session never reads as "no trades". */
export async function freshSession(d: GuardCreds) {
  let c = await mtConnect(d.platform, d.login, d.password, d.server);
  let o = c.ok ? await mtOpenedOrders(d.platform, c.token) : null;
  if (c.ok && o?.ok) return { c: { token: c.token }, o };
  if (c.ok) await mtDisconnect(d.platform, c.token, true);
  await sleep(800);
  c = await mtConnect(d.platform, d.login, d.password, d.server);
  if (!c.ok) return { error: String(c.error) };
  o = await mtOpenedOrders(d.platform, c.token);
  return o.ok ? { c: { token: c.token }, o } : { error: `open trades unreadable (${o.error})` };
}

/** Close tickets (one retry each), then re-read open trades so each close is verified on the broker. */
export async function closeVerified(platform: Platform, token: string, openTickets: Set<string>, tickets: string[]) {
  const attempts = await Promise.all(tickets.map(async (ticket) => {
    if (!openTickets.has(ticket)) return { ticket, sent: false, error: "already closed" as string | undefined };
    let c = await mtOrderClose(platform, token, ticket);
    if (!c.ok) { await sleep(500); c = await mtOrderClose(platform, token, ticket); }
    return { ticket, sent: c.ok, error: c.error };
  }));
  await sleep(700);
  const after = await mtOpenedOrders(platform, token);
  const still = after.ok ? new Set(after.orders.map((o) => o.ticket)) : null;
  return attempts.map((a) => ({
    ticket: a.ticket,
    closed: still ? !still.has(a.ticket) : false,
    verified: !!still,
    error: still && still.has(a.ticket) ? a.error ?? "still open after close" : still ? undefined : `close ${a.sent ? "sent" : "failed"}, position check unavailable`,
  }));
}

/** Closed-candle reads on the guard frames for one symbol (same rules as the in-app guard). */
export async function frameReads(symbol: string, cfg: { confirmBars: number; minHoldBars: number }): Promise<FrameRead[]> {
  const now = Date.now();
  const out = await Promise.all(GUARD_FRAMES.map(async (interval) => {
    const feed = await loadCandles(symbol, interval, 300).catch(() => null);
    if (!feed || !feed.ok || feed.candles.length < 60) return null;
    return readFrame(buildSeries(feed.candles), closedIndex(feed.candles, INTERVAL_MS[interval], now), interval, cfg);
  }));
  return out.filter((r): r is NonNullable<typeof r> => !!r);
}

// ---- password sealing (AES-GCM, key derived from a server-only secret) ----
const enc = new TextEncoder();
async function sealKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.LOVABLE_CRON_SECRET ?? "";
  if (!secret) throw new Error("server key unavailable");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`algovault-guard|${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function seal(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(), enc.encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function unseal(sealed: string): Promise<string | null> {
  try {
    const [iv, ct] = sealed.split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await sealKey(), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

export interface GuardRow { id: string; platform: string; login: string; server: string; password_encrypted: string; events: unknown }

/** One 24/7 check of a stored account: read positions, close AlgoVault trades in profit on a reversal, verify. */
export async function guardAccountOnce(row: GuardRow): Promise<{ status: string; events: GuardEvent[] }> {
  const old = Array.isArray(row.events) ? (row.events as GuardEvent[]) : [];
  const password = await unseal(row.password_encrypted);
  if (!password) return { status: "Saved login unreadable — open the app once to refresh it", events: old };
  const creds: GuardCreds = { platform: row.platform === "mt4" ? "mt4" : "mt5", login: row.login, password, server: row.server };
  const s = await freshSession(creds);
  if ("error" in s) return { status: `Account unavailable: ${String(s.error).slice(0, 100)}`, events: old };
  const trades = s.o.orders;
  const cfg = { confirmBars: 3, minHoldBars: 5 };
  const first = planExits(trades, {});
  const reads: Record<string, FrameRead[]> = {};
  await Promise.all(first.symbols.map(async (sym) => { reads[sym] = await frameReads(sym, cfg); }));
  const plan = planExits(trades, reads);
  const app = trades.filter((t) => /algovault/i.test(t.comment)).length;
  if (plan.due.length === 0) return { status: `${trades.length} open (${app} AlgoVault) · no reversal against profit`, events: old };
  const results = await closeVerified(creds.platform, s.c.token, new Set(trades.map((t) => t.ticket)), plan.due.map((d) => d.ticket));
  const now = Date.now();
  const add: GuardEvent[] = results.map((r) => {
    const d = plan.due.find((x) => x.ticket === r.ticket);
    return r.closed
      ? { at: now, kind: "closed" as const, text: `${d?.symbol ?? ""} #${r.ticket} closed in profit (${d ? d.profit.toFixed(2) : "?"}) by 24/7 watch · verified on broker` }
      : { at: now, kind: "error" as const, text: `${d?.symbol ?? ""} #${r.ticket} not closed: ${(r.error ?? "unknown").slice(0, 100)} — will retry` };
  });
  const closed = results.filter((r) => r.closed).length;
  return { status: `${closed} closed in profit, ${trades.length - closed} still open`, events: mergeEvents(old, add) };
}
