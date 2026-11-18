import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Broker symbol → TradingView name: "xauusd.m" / "XAUUSDm" / "BTCUSD.m" → "XAUUSD" / "BTCUSD". */
export function tvName(sym: string) {
  let s = sym.toUpperCase().split(/[.\-_#]/)[0].replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{6}M$/.test(s) || /^[A-Z]{6}(PRO|ECN|RAW)$/.test(s)) s = s.slice(0, 6);
  return s;
}

const CRYPTO = /^(BTC|ETH|LTC|XRP|SOL|DOGE|BNB|ADA)/;
function tickers(name: string): { market: string; ticker: string }[] {
  if (CRYPTO.test(name)) return [{ market: "crypto", ticker: `BITSTAMP:${name}` }, { market: "crypto", ticker: `COINBASE:${name}` }];
  return [{ market: "forex", ticker: `OANDA:${name}` }, { market: "cfd", ticker: `OANDA:${name}` }, { market: "forex", ticker: `FX_IDC:${name}` }, { market: "cfd", ticker: `TVC:${name}` }];
}

const BULL_PATTERNS = ["Candle.Engulfing.Bullish", "Candle.Hammer", "Candle.MorningStar", "Candle.3WhiteSoldiers", "Candle.Harami.Bullish", "Candle.InvertedHammer", "Candle.Marubozu.White", "Candle.Kicking.Bullish"];
const BEAR_PATTERNS = ["Candle.Engulfing.Bearish", "Candle.ShootingStar", "Candle.EveningStar", "Candle.3BlackCrows", "Candle.Harami.Bearish", "Candle.HangingMan", "Candle.Marubozu.Black", "Candle.Kicking.Bearish"];
const PATTERNS = [...BULL_PATTERNS, ...BEAR_PATTERNS];
/** Number of bullish / bearish candle patterns TradingView currently flags on a timeframe. */
const patternCount = (v: Record<string, number>, list: string[], tf: string) => list.reduce((a, p) => a + (v[`${p}|${tf}`] ? 1 : 0), 0);

/** Each timeframe is its own section, all scanned at the same time. */
const SECTIONS = {
  m1: ["close", "Recommend.All|1", "RSI|1", "EMA20|1", "ATR|1", "Mom|1"],
  m5: ["Recommend.All|5", "ATR|5", "RSI|5", "ADX|5", "EMA50|5", "MACD.macd|5", "MACD.signal|5"],
  m15: ["Recommend.All|15", "ATR|15", "Recommend.MA|15", "RSI|15", "ADX|15", "EMA50|15", "MACD.macd|15", "MACD.signal|15"],
  h1: ["Recommend.All|60", "EMA200|60", "EMA50|60", "ATR|60", "RSI|60", "ADX|60"],
  h4: ["Recommend.All|240", "EMA50|240", "ATR|240", "RSI|240", "ADX|240"],
  // Extra scanner depth in separate sections: if one is unavailable, the core readings still arrive.
  m1x: ["Stoch.K|1", "Stoch.D|1"],
  m5x: ["Stoch.K|5", "Stoch.D|5", "EMA20|5", "BB.upper|5", "BB.lower|5"],
  m15x: ["BB.upper|15", "BB.lower|15", "ADX+DI|15", "ADX-DI|15", "EMA20|15", "EMA200|15", "Stoch.K|15", "Stoch.D|15"],
  // Price action, breakouts and support/resistance: candles, channels, pivots and patterns.
  m1pa: ["open|1", "high|1", "low|1", "DonchCh20.Upper|1", "DonchCh20.Lower|1"],
  m5pa: ["open|5", "high|5", "low|5", "open[1]|5", "high[1]|5", "low[1]|5", "close[1]|5", "DonchCh20.Upper|5", "DonchCh20.Lower|5"],
  m15pa: ["open|15", "high|15", "low|15", "open[1]|15", "high[1]|15", "low[1]|15", "close[1]|15", "DonchCh20.Upper|15", "DonchCh20.Lower|15", "VWAP|15", "P.SAR|15", "RSI[1]|15"],
  pivots: ["Pivot.M.Classic.S1|15", "Pivot.M.Classic.S2|15", "Pivot.M.Classic.Middle|15", "Pivot.M.Classic.R1|15", "Pivot.M.Classic.R2|15"],
  m5cp: PATTERNS.map((p) => `${p}|5`),
  m15cp: PATTERNS.map((p) => `${p}|15`),
  // Oscillators with previous-candle values: fresh crosses and turns out of extremes.
  osc15: ["CCI20|15", "CCI20[1]|15", "W.R|15", "AO|15", "AO[1]|15", "AO[2]|15", "Stoch.RSI.K|15", "UO|15", "MACD.macd[1]|15", "MACD.signal[1]|15",
    "Stoch.K[1]|15", "Stoch.D[1]|15", "ADX+DI[1]|15", "ADX-DI[1]|15", "Aroon.Up|15", "Aroon.Down|15", "Mom|15", "Mom[1]|15"],
  osc5: ["CCI20|5", "W.R|5", "AO|5", "AO[1]|5", "MACD.macd[1]|5", "MACD.signal[1]|5", "RSI[1]|5", "Stoch.K[1]|5", "Stoch.D[1]|5"],
  // Ichimoku, Keltner (squeeze), Hull and extra averages.
  struct15: ["Ichimoku.CLine|15", "Ichimoku.BLine|15", "Ichimoku.Lead1|15", "Ichimoku.Lead2|15", "HullMA9|15", "KltChnl.upper|15", "KltChnl.lower|15",
    "EMA9|15", "EMA100|15", "EMA20[1]|15", "EMA50[1]|15", "VWMA|15"],
  vol15: ["volume|15", "volume[1]|15", "relative_volume_10d_calc|15"],
  // Higher-timeframe trend and structure.
  h1x: ["EMA20|60", "MACD.macd|60", "MACD.signal|60", "Stoch.K|60", "Stoch.D|60", "DonchCh20.Upper|60", "DonchCh20.Lower|60", "BB.upper|60", "BB.lower|60",
    "open|60", "high|60", "low|60", "open[1]|60", "high[1]|60", "low[1]|60", "close[1]|60"],
  h4x: ["EMA20|240", "EMA200|240", "DonchCh20.Upper|240", "DonchCh20.Lower|240"],
  // Smart strategy library depth: EMA stacks, previous candles and momentum on 1m, 5m and 1h.
  ema1: ["EMA9|1", "EMA50|1", "EMA200|1", "EMA9[1]|1", "EMA20[1]|1", "open[1]|1", "high[1]|1", "low[1]|1", "close[1]|1",
    "MACD.macd|1", "MACD.signal|1", "ADX|1", "RSI[1]|1", "BB.upper|1", "BB.lower|1", "AO|1", "AO[1]|1", "CCI20|1"],
  ema5: ["EMA9|5", "EMA100|5", "EMA200|5", "EMA9[1]|5", "EMA20[1]|5", "EMA50[1]|5", "ADX+DI|5", "ADX-DI|5", "KltChnl.upper|5", "KltChnl.lower|5", "VWAP|5"],
  ema60: ["EMA9|60", "EMA100|60", "ADX+DI|60", "ADX-DI|60", "RSI[1]|60", "EMA20[1]|60", "EMA50[1]|60"],
  // Daily and weekly liquidity levels (no suffix = daily candle).
  levels: ["open", "high", "low", "high[1]", "low[1]", "close[1]", "high|1W", "low|1W"],
};

const ALL_COLUMNS = [...new Set(Object.values(SECTIONS).flat())];

class ScanError extends Error { constructor(public status: number) { super(`scan failed (${status})`); } }

async function scanSection(t: { market: string; ticker: string }, columns: readonly string[]) {
  const r = await fetch(`https://scanner.tradingview.com/${t.market}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: { tickers: [t.ticker], query: { types: [] } }, columns }),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new ScanError(r.status);
  const j: any = await r.json();
  const d = j?.data?.[0]?.d;
  if (!d) throw new Error("no data");
  const out: Record<string, number> = {};
  columns.forEach((c, i) => { out[c] = Number(d[i] ?? 0) || 0; });
  return out;
}

/**
 * One combined request per chart source keeps the feed within TradingView's rate limits.
 * Only if TradingView rejects a column (400) do we fall back to separate sections, so optional
 * readings can never block the core ones. Rate limits (429) are not retried section by section.
 */
async function scanTicker(t: { market: string; ticker: string }) {
  let v: Record<string, number>;
  try {
    v = await scanSection(t, ALL_COLUMNS);
  } catch (e) {
    if (!(e instanceof ScanError) || e.status !== 400) throw e;
    const parts = await Promise.all(Object.values(SECTIONS).map((cols) => scanSection(t, cols).catch(() => ({} as Record<string, number>))));
    v = Object.assign({}, ...parts);
  }
  if (!v["close"]) throw new Error("no price");
  return v;
}

/** Chart sources are tried in order (first with a price wins) instead of all at once. */
async function firstSource(list: { market: string; ticker: string }[]) {
  let last: unknown;
  for (const t of list) {
    try { return { t, v: await scanTicker(t) }; }
    catch (e) { last = e; if (e instanceof ScanError && e.status === 429) break; }
  }
  throw last ?? new Error("no source");
}

/** Reads TradingView's live price + 1m/5m/15m/1h/4h readings, all timeframes in parallel. */
export async function readTradingView(symbol: string) {
    const name = tvName(symbol);
    const list = tickers(name);
    try {
      const { t, v } = await firstSource(list);
      const n = (k: string) => v[k] ?? 0;
      return {
        ok: true as const, tv: name, ticker: t.ticker, price: n("close"),
        rating1: n("Recommend.All|1"), rating5: n("Recommend.All|5"), rating15: n("Recommend.All|15"),
        atr: n("ATR|5"), atr15: n("ATR|15"), rating60: n("Recommend.All|60"), rating240: n("Recommend.All|240"),
        atr5: n("ATR|5"), rsi5: n("RSI|5"), adx5: n("ADX|5"), ema50_5: n("EMA50|5"),
        ma15: n("Recommend.MA|15"), rsi15: n("RSI|15"), adx15: n("ADX|15"), ema50_15: n("EMA50|15"),
        ema200_60: n("EMA200|60"), macd15: n("MACD.macd|15"), macdSig15: n("MACD.signal|15"),
        atr60: n("ATR|60"), atr240: n("ATR|240"),
        rsi60: n("RSI|60"), rsi240: n("RSI|240"), adx60: n("ADX|60"), adx240: n("ADX|240"),
        ema50_60: n("EMA50|60"), ema50_240: n("EMA50|240"),
        rsi1: n("RSI|1"), ema20_1: n("EMA20|1"), atr1: n("ATR|1"), mom1: n("Mom|1"), macd5: n("MACD.macd|5"), macdSig5: n("MACD.signal|5"),
        stochK1: n("Stoch.K|1"), stochD1: n("Stoch.D|1"),
        stochK5: n("Stoch.K|5"), stochD5: n("Stoch.D|5"), ema20_5: n("EMA20|5"), bbUp5: n("BB.upper|5"), bbLo5: n("BB.lower|5"),
        bbUp15: n("BB.upper|15"), bbLo15: n("BB.lower|15"), diPlus15: n("ADX+DI|15"), diMinus15: n("ADX-DI|15"),
        ema20_15: n("EMA20|15"), ema200_15: n("EMA200|15"), stochK15: n("Stoch.K|15"), stochD15: n("Stoch.D|15"),
        open1: n("open|1"), high1: n("high|1"), low1: n("low|1"), donHi1: n("DonchCh20.Upper|1"), donLo1: n("DonchCh20.Lower|1"),
        open5: n("open|5"), high5: n("high|5"), low5: n("low|5"), prevOpen5: n("open[1]|5"), prevHigh5: n("high[1]|5"), prevLow5: n("low[1]|5"), prevClose5: n("close[1]|5"),
        donHi5: n("DonchCh20.Upper|5"), donLo5: n("DonchCh20.Lower|5"),
        open15: n("open|15"), high15: n("high|15"), low15: n("low|15"), prevOpen15: n("open[1]|15"), prevHigh15: n("high[1]|15"), prevLow15: n("low[1]|15"), prevClose15: n("close[1]|15"),
        donHi15: n("DonchCh20.Upper|15"), donLo15: n("DonchCh20.Lower|15"), vwap15: n("VWAP|15"), psar15: n("P.SAR|15"), rsiPrev15: n("RSI[1]|15"),
        pivS1: n("Pivot.M.Classic.S1|15"), pivS2: n("Pivot.M.Classic.S2|15"), pivP: n("Pivot.M.Classic.Middle|15"), pivR1: n("Pivot.M.Classic.R1|15"), pivR2: n("Pivot.M.Classic.R2|15"),
        bullPat5: patternCount(v, BULL_PATTERNS, "5"), bearPat5: patternCount(v, BEAR_PATTERNS, "5"),
        bullPat15: patternCount(v, BULL_PATTERNS, "15"), bearPat15: patternCount(v, BEAR_PATTERNS, "15"),
        cci15: n("CCI20|15"), cciPrev15: n("CCI20[1]|15"), wr15: n("W.R|15"), ao15: n("AO|15"), aoPrev15: n("AO[1]|15"), aoPrev2_15: n("AO[2]|15"),
        stochRsi15: n("Stoch.RSI.K|15"), uo15: n("UO|15"), macdPrev15: n("MACD.macd[1]|15"), macdSigPrev15: n("MACD.signal[1]|15"),
        stochKPrev15: n("Stoch.K[1]|15"), stochDPrev15: n("Stoch.D[1]|15"), diPlusPrev15: n("ADX+DI[1]|15"), diMinusPrev15: n("ADX-DI[1]|15"),
        aroonUp15: n("Aroon.Up|15"), aroonDn15: n("Aroon.Down|15"), mom15: n("Mom|15"), momPrev15: n("Mom[1]|15"),
        cci5: n("CCI20|5"), wr5: n("W.R|5"), ao5: n("AO|5"), aoPrev5: n("AO[1]|5"), macdPrev5: n("MACD.macd[1]|5"), macdSigPrev5: n("MACD.signal[1]|5"),
        rsiPrev5: n("RSI[1]|5"), stochKPrev5: n("Stoch.K[1]|5"), stochDPrev5: n("Stoch.D[1]|5"),
        ichTenkan15: n("Ichimoku.CLine|15"), ichKijun15: n("Ichimoku.BLine|15"), ichSpanA15: n("Ichimoku.Lead1|15"), ichSpanB15: n("Ichimoku.Lead2|15"),
        hull15: n("HullMA9|15"), kcUp15: n("KltChnl.upper|15"), kcLo15: n("KltChnl.lower|15"), ema9_15: n("EMA9|15"), ema100_15: n("EMA100|15"),
        ema20Prev15: n("EMA20[1]|15"), ema50Prev15: n("EMA50[1]|15"), vwma15: n("VWMA|15"),
        vol15: n("volume|15"), volPrev15: n("volume[1]|15"), rvol15: n("relative_volume_10d_calc|15"),
        ema20_60: n("EMA20|60"), macd60: n("MACD.macd|60"), macdSig60: n("MACD.signal|60"), stochK60: n("Stoch.K|60"), stochD60: n("Stoch.D|60"),
        donHi60: n("DonchCh20.Upper|60"), donLo60: n("DonchCh20.Lower|60"), bbUp60: n("BB.upper|60"), bbLo60: n("BB.lower|60"),
        open60: n("open|60"), high60: n("high|60"), low60: n("low|60"), prevOpen60: n("open[1]|60"), prevHigh60: n("high[1]|60"), prevLow60: n("low[1]|60"), prevClose60: n("close[1]|60"),
        ema20_240: n("EMA20|240"), ema200_240: n("EMA200|240"), donHi240: n("DonchCh20.Upper|240"), donLo240: n("DonchCh20.Lower|240"),
        ema9_1: n("EMA9|1"), ema50_1: n("EMA50|1"), ema200_1: n("EMA200|1"), ema9Prev1: n("EMA9[1]|1"), ema20Prev1: n("EMA20[1]|1"),
        prevOpen1: n("open[1]|1"), prevHigh1: n("high[1]|1"), prevLow1: n("low[1]|1"), prevClose1: n("close[1]|1"),
        macd1: n("MACD.macd|1"), macdSig1: n("MACD.signal|1"), adx1: n("ADX|1"), rsiPrev1: n("RSI[1]|1"), bbUp1: n("BB.upper|1"), bbLo1: n("BB.lower|1"),
        ao1: n("AO|1"), aoPrev1: n("AO[1]|1"), cci1: n("CCI20|1"),
        ema9_5: n("EMA9|5"), ema100_5: n("EMA100|5"), ema200_5: n("EMA200|5"), ema9Prev5: n("EMA9[1]|5"), ema20Prev5: n("EMA20[1]|5"), ema50Prev5: n("EMA50[1]|5"),
        diPlus5: n("ADX+DI|5"), diMinus5: n("ADX-DI|5"), kcUp5: n("KltChnl.upper|5"), kcLo5: n("KltChnl.lower|5"), vwap5: n("VWAP|5"),
        ema9_60: n("EMA9|60"), ema100_60: n("EMA100|60"), diPlus60: n("ADX+DI|60"), diMinus60: n("ADX-DI|60"), rsiPrev60: n("RSI[1]|60"),
        ema20Prev60: n("EMA20[1]|60"), ema50Prev60: n("EMA50[1]|60"),
        dayOpen: n("open"), dayHigh: n("high"), dayLow: n("low"), pdHigh: n("high[1]"), pdLow: n("low[1]"), pdClose: n("close[1]"), wkHigh: n("high|1W"), wkLow: n("low|1W"),
      };
    } catch {
      return { ok: false as const, tv: name, error: `TradingView has no chart for ${name}` };
    }
}

export const getTvSignal = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ symbol: z.string().min(2).max(32) }).parse(i))
  .handler(({ data }) => readTradingView(data.symbol));
