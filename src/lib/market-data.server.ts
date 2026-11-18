import type { Candle, Interval } from "@/lib/autotrader-pro/types";

/**
 * Historical OHLC candles from documented, supported market-data APIs:
 *  - Coinbase Exchange public market data (crypto, no key)
 *  - Twelve Data (forex and metals, used when the TWELVE_DATA_API_KEY secret is set)
 *  - Yahoo Finance public chart data (forex, gold/silver futures, indices; no key; used when no Twelve Data key)
 * TradingView does not offer a public candle-history API, so it is not used for history.
 */
export type CandleFeed =
  | { ok: true; source: string; dataSymbol: string; candles: Candle[]; bid?: number; ask?: number; spread?: number; delayed: boolean }
  | { ok: false; error: string; needsKey?: boolean; dataSymbol?: string };

const CRYPTO = /^(BTC|ETH|LTC|SOL|XRP|DOGE|ADA|AVAX|DOT|LINK|BCH)/;
const GRAN: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600 };
const TD_INTERVAL: Record<Interval, string> = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h" };

export function normalise(symbol: string) {
  let s = symbol.toUpperCase().split(/[.\-_#]/)[0].replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{6}(M|PRO|ECN|RAW)$/.test(s)) s = s.slice(0, 6);
  if (s === "GOLD") s = "XAUUSD";
  if (s === "SILVER") s = "XAGUSD";
  return s;
}

/** Merges sorted candles into fixed buckets (first open, highest high, lowest low, last close, summed volume). */
export function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.t / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.v += c.v; }
    else out.push({ ...c, t });
  }
  return out;
}

const cache = new Map<string, { at: number; feed: CandleFeed }>();
const TTL_MS = 20_000;

async function coinbase(name: string, interval: Interval, limit: number): Promise<CandleFeed> {
  const base = name.match(CRYPTO)?.[1] ?? name.slice(0, 3);
  const product = `${base}-USD`;
  // Coinbase has no 30-minute candles: 30m is built from pairs of closed 15m candles.
  const gran = interval === "30m" ? GRAN["15m"] : GRAN[interval];
  const need = interval === "30m" ? limit * 2 : limit;
  const rows: number[][] = [];
  let end = Math.floor(Date.now() / 1000);
  for (let page = 0; page < 4 && rows.length < need; page++) {
    const start = end - gran * 300;
    const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${gran}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    const r = await fetch(url, { headers: { "User-Agent": "AlgoVault/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { if (page === 0) return { ok: false, error: `Coinbase market data unavailable (${r.status}) for ${product}`, dataSymbol: product }; break; }
    const j = (await r.json()) as number[][];
    if (!Array.isArray(j) || !j.length) break;
    rows.push(...j);
    end = start;
  }
  const seen = new Set<number>();
  const raw = rows
    .filter((x) => Array.isArray(x) && x.length >= 6 && !seen.has(x[0]) && seen.add(x[0]))
    .map((x) => ({ t: x[0] * 1000, l: +x[1], h: +x[2], o: +x[3], c: +x[4], v: +x[5] }))
    .sort((a, b) => a.t - b.t);
  const candles = (interval === "30m" ? aggregateCandles(raw, 1_800_000) : raw).slice(-limit);
  if (candles.length < 30) return { ok: false, error: `Not enough Coinbase history for ${product}`, dataSymbol: product };
  let bid: number | undefined, ask: number | undefined;
  try {
    const t = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, { headers: { "User-Agent": "AlgoVault/1.0" }, signal: AbortSignal.timeout(5000) });
    if (t.ok) { const q = (await t.json()) as { bid?: string; ask?: string }; bid = Number(q.bid) || undefined; ask = Number(q.ask) || undefined; }
  } catch { /* quote is optional */ }
  return { ok: true, source: "Coinbase Exchange", dataSymbol: product, candles, bid, ask, spread: bid && ask ? ask - bid : undefined, delayed: false };
}

function twelveSymbol(name: string) {
  if (/^(XAU|XAG|XPT|XPD)USD$/.test(name)) return `${name.slice(0, 3)}/USD`;
  if (/^[A-Z]{6}$/.test(name)) return `${name.slice(0, 3)}/${name.slice(3)}`;
  return null;
}

async function twelveData(name: string, interval: Interval, limit: number): Promise<CandleFeed> {
  const sym = twelveSymbol(name);
  if (!sym) return { ok: false, error: `${name} is not available from the connected data feeds (crypto via Coinbase, forex/metals via Twelve Data).` };
  const key = process.env["TWELVE_DATA_API_KEY"];
  if (!key) return { ok: false, needsKey: true, dataSymbol: sym, error: `Price history for ${sym} needs a Twelve Data key (free plan available). Crypto symbols work without one.` };
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${TD_INTERVAL[interval]}&outputsize=${limit}&timezone=UTC&order=ASC&apikey=${encodeURIComponent(key)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return { ok: false, error: `Twelve Data unavailable (${r.status})`, dataSymbol: sym };
  const j = (await r.json()) as { status?: string; message?: string; values?: Array<Record<string, string>> };
  if (j.status === "error" || !Array.isArray(j.values)) return { ok: false, error: `Twelve Data: ${String(j.message ?? "no data").slice(0, 160)}`, dataSymbol: sym };
  const candles = j.values.map((v) => ({ t: Date.parse(`${v.datetime.replace(" ", "T")}Z`), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: Number(v.volume) || 0 }))
    .filter((c) => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite));
  if (candles.length < 30) return { ok: false, error: `Not enough Twelve Data history for ${sym}`, dataSymbol: sym };
  return { ok: true, source: "Twelve Data", dataSymbol: sym, candles, delayed: false };
}

const YAHOO_INTERVAL: Record<Interval, { i: string; range: string }> = {
  "1m": { i: "1m", range: "2d" }, "5m": { i: "5m", range: "10d" }, "15m": { i: "15m", range: "30d" }, "30m": { i: "30m", range: "1mo" }, "1h": { i: "60m", range: "3mo" },
};
const YAHOO_ALIAS: Record<string, string> = {
  XAUUSD: "GC=F", XAGUSD: "SI=F", XPTUSD: "PL=F", XPDUSD: "PA=F", USOIL: "CL=F", WTI: "CL=F", UKOIL: "BZ=F",
  US30: "YM=F", DJ30: "YM=F", NAS100: "NQ=F", US100: "NQ=F", USTEC: "NQ=F", SPX500: "ES=F", US500: "ES=F", GER40: "^GDAXI", DE40: "^GDAXI", UK100: "^FTSE",
};

function yahooSymbol(name: string) {
  if (YAHOO_ALIAS[name]) return YAHOO_ALIAS[name];
  const crypto = name.match(CRYPTO)?.[1];
  if (crypto) return `${crypto}-USD`;
  if (/^[A-Z]{6}$/.test(name)) return `${name}=X`;
  return null;
}

/** Keyless fallback: Yahoo Finance public chart data. Metals/indices use futures prices, so levels can differ slightly from a broker's spot quote. */
async function yahoo(name: string, interval: Interval, limit: number): Promise<CandleFeed> {
  const sym = yahooSymbol(name);
  if (!sym) return { ok: false, error: `${name} is not available from the connected data feeds (crypto, forex, gold/silver and major indices are supported).` };
  const cfg = YAHOO_INTERVAL[interval];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${cfg.i}&range=${cfg.range}&includePrePost=false`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AlgoVault/1.0)", Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return { ok: false, error: `Free forex price feed unavailable right now (${r.status}) for ${name}. Try again shortly.`, dataSymbol: sym };
  type Q = { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] };
  const j = (await r.json()) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number }; timestamp?: number[]; indicators?: { quote?: Q[] } }> } };
  const res = j.chart?.result?.[0];
  const ts = res?.timestamp ?? [];
  const q = res?.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let k = 0; k < ts.length; k++) {
    const o = q.open?.[k], h = q.high?.[k], l = q.low?.[k], c = q.close?.[k];
    if (o == null || h == null || l == null || c == null || ![o, h, l, c].every(Number.isFinite)) continue;
    candles.push({ t: ts[k] * 1000, o, h, l, c, v: Number(q.volume?.[k]) || 0 });
  }
  const seen = new Set<number>();
  const clean = candles.filter((c) => !seen.has(c.t) && seen.add(c.t)).sort((a, b) => a.t - b.t).slice(-limit);
  if (clean.length < 30) return { ok: false, error: `Not enough price history for ${name} right now (market may be closed).`, dataSymbol: sym };
  const label = sym.endsWith("=X") ? "Yahoo Finance (free forex feed)" : sym.endsWith("-USD") ? "Yahoo Finance (crypto feed)" : "Yahoo Finance (futures/index feed)";
  return { ok: true, source: label, dataSymbol: sym, candles: clean, delayed: !(sym.endsWith("=X") || sym.endsWith("-USD")) };
}

/** Forex/metals: Twelve Data when a key is configured, otherwise the keyless Yahoo feed. */
async function forex(name: string, interval: Interval, limit: number): Promise<CandleFeed> {
  if (process.env["TWELVE_DATA_API_KEY"] && twelveSymbol(name)) {
    const td = await twelveData(name, interval, limit);
    if (td.ok) return td;
  }
  return yahoo(name, interval, limit);
}

/** Crypto: Coinbase first; if it is blocked, times out or lacks the coin, fall back to the keyless Yahoo crypto feed. */
async function cryptoFeed(name: string, interval: Interval, limit: number): Promise<CandleFeed> {
  const cb = await coinbase(name, interval, limit).catch((): CandleFeed => ({ ok: false, error: "Coinbase market data request failed" }));
  if (cb.ok) return cb;
  const y = await yahoo(name, interval, limit).catch((): CandleFeed => ({ ok: false, error: "Crypto feed request failed" }));
  return y.ok ? y : cb;
}

export async function loadCandles(symbol: string, interval: Interval, limit: number): Promise<CandleFeed> {
  const name = normalise(symbol);
  const k = `${name}|${interval}|${limit}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.feed;
  let feed: CandleFeed;
  try { feed = CRYPTO.test(name) ? await cryptoFeed(name, interval, limit) : await forex(name, interval, limit); }
  catch (e) { feed = { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "Market data request timed out" : "Market data request failed" }; }
  if (feed.ok) cache.set(k, { at: Date.now(), feed });
  return feed;
}
