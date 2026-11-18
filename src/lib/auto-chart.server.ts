import type { AutoChart, ChartCandle } from "./auto-chart";

function tickerFor(raw: string) {
  const symbol = raw.toUpperCase().split(/[.\-_#]/)[0].replace(/[^A-Z0-9]/g, "");
  const aliases: Record<string, string> = { XAUUSD: "GC=F", GOLD: "GC=F", XAGUSD: "SI=F", SILVER: "SI=F", USOIL: "CL=F", WTI: "CL=F", UKOIL: "BZ=F", BTCUSD: "BTC-USD", ETHUSD: "ETH-USD", US30: "^DJI", DJ30: "^DJI", NAS100: "^NDX", USTEC: "^NDX", SPX500: "^GSPC", US500: "^GSPC", GER40: "^GDAXI", UK100: "^FTSE", JP225: "^N225" };
  const alias = Object.keys(aliases).find((key) => symbol.startsWith(key));
  if (alias) return aliases[alias];
  const fx = symbol.slice(0, 6);
  return /^[A-Z]{6}$/.test(fx) ? `${fx}=X` : null;
}

async function readCandles(ticker: string, interval: string, range: string): Promise<ChartCandle[]> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error("Live chart prices unavailable");
  const json = await response.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> } }> } };
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const candles: ChartCandle[] = [];
  for (const [i, time] of (result?.timestamp ?? []).entries()) {
    const open = quote?.open?.[i], high = quote?.high?.[i], low = quote?.low?.[i], close = quote?.close?.[i];
    if (typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number") continue;
    if (![open, high, low, close].every(Number.isFinite) || low <= 0 || high < low) continue;
    candles.push({ time, open, high, low, close });
  }
  return candles.slice(-80);
}

export async function fetchAutoChart(symbol: string): Promise<AutoChart> {
  const primary = tickerFor(symbol);
  if (!primary) throw new Error(`Live chart unavailable for ${symbol}`);
  const candidates = primary === "GC=F" ? ["GC=F", "XAUUSD=X", "MGC=F"] : primary === "SI=F" ? ["SI=F", "XAGUSD=X"] : [primary];
  let lastErr = `Prices for ${symbol} are stale or the market is closed`;
  for (const ticker of candidates) {
    try {
      const [m1, m5, m15, h1] = await Promise.all([readCandles(ticker, "1m", "5d"), readCandles(ticker, "5m", "5d"), readCandles(ticker, "15m", "5d"), readCandles(ticker, "60m", "1mo")]);
      if ([m1, m5, m15, h1].some((candles) => candles.length < 30)) { lastErr = `Not enough live candles for ${symbol}`; continue; }
      const latest = m1.at(-1);
      if (!latest || Date.now() - latest.time * 1000 > 30 * 60 * 1000) continue;
      return { symbol, source: ticker, fetchedAt: Date.now(), m1, m5, m15, h1 };
    } catch (e) { lastErr = e instanceof Error ? e.message : lastErr; }
  }
  throw new Error(lastErr);
}