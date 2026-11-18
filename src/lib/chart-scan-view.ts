/** Pure presentation helpers for the in-settings chart scanner (never decide or place trades). */
export type ScanView = {
  symbol: string; side: string; entry: number; stopLoss: number; takeProfit: number;
  timeframe?: string; strategy?: string; confluences?: string[]; patterns?: string[]; structure?: string;
};

/** Chart timeframe text ("15", "15m", "M15", "1h", "4H", "1D", "30 minutes") → "M15" / "H1" / "H4" / "D1". */
export function tfLabel(tf?: string): string {
  const s = (tf ?? "").trim();
  if (!s) return "—";
  const mt = /\b([MHDW])(\d{1,3})\b/i.exec(s);
  if (mt) return `${mt[1].toUpperCase()}${mt[2]}`;
  const m = /(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)(?![a-z])/i.exec(s);
  if (m) {
    const n = Number(m[1]), u = m[2][0].toLowerCase();
    if (u === "m") return n % 60 === 0 && n >= 60 ? `H${n / 60}` : `M${n}`;
    return `${u.toUpperCase()}${n}`;
  }
  if (/^\d{1,4}$/.test(s)) { const n = Number(s); return n >= 60 && n % 60 === 0 ? `H${n / 60}` : `M${n}`; }
  if (/^(d|day|daily)$/i.test(s)) return "D1";
  if (/^(w|week|weekly)$/i.test(s)) return "W1";
  return s.slice(0, 8).toUpperCase();
}

/** Strategies offered for chart scans — the AutoTrader Pro strategy book, read off a picture. */
export const SCAN_STRATEGIES = [
  { id: "auto", label: "Auto", minRR: 1.5, focus: "Test every strategy below against the chart and trade the one with the strongest confluence." },
  { id: "smc", label: "SMC Money", minRR: 2, focus: "Smart Money Concepts: higher-timeframe bias, BOS/CHoCH, a liquidity sweep, then entry on the return into the order block or FVG in discount (buys) or premium (sells)." },
  { id: "orderblock", label: "Order Blocks", minRR: 2, focus: "Last opposite candle before the impulse that broke structure; enter on the first retest of that unmitigated order block." },
  { id: "sweep", label: "Liquidity Sweep", minRR: 2, focus: "Wick through equal highs/lows or a prior swing that closes back inside; trade the reversal toward the opposite pool." },
  { id: "grabshift", label: "Grab + Shift", minRR: 2, focus: "Liquidity grab followed by a market-structure shift (CHoCH); enter on the pullback into the shift leg." },
  { id: "fvg", label: "Fair Value Gap", minRR: 1.8, focus: "Three-candle imbalance left by displacement; enter when price returns to fill the gap in the trend direction." },
  { id: "ote", label: "OTE Pullback", minRR: 2, focus: "Optimal trade entry: 62–79% retracement of the last impulse leg in the trend direction." },
  { id: "retest", label: "Break & Retest", minRR: 1.8, focus: "Clean break of a key level, then a retest that holds it as support/resistance." },
  { id: "trend", label: "Trend Following", minRR: 2, focus: "Higher highs/lows (or lower) with moving averages aligned; enter on the pullback to the dynamic level." },
  { id: "breakout", label: "Breakout", minRR: 1.8, focus: "Compression or range break with strong-bodied candles closing beyond the level." },
  { id: "priceaction", label: "Price Action", minRR: 1.5, focus: "Rejection wicks, engulfing and pin bars at key support/resistance." },
  { id: "supertrend", label: "Supertrend", minRR: 1.8, focus: "ATR Supertrend flips with the candle closing on the new side; trade the fresh trend with the stop beyond the Supertrend line." },
  { id: "ichimoku", label: "Ichimoku", minRR: 1.8, focus: "Price closes outside the Kumo cloud with Tenkan crossing Kijun the same way; stop beyond Kijun or the cloud edge." },
  { id: "session", label: "Session Breakout", minRR: 1.8, focus: "Asian session range (00:00–07:00 UTC) broken by a strong London/New York close; target a range-height move, stop at the range middle." },
  { id: "donchian", label: "Donchian Breakout", minRR: 1.8, focus: "Close beyond the 20-bar highest high / lowest low channel; stop at the opposite 10-bar extreme." },
  { id: "vwap", label: "VWAP Reclaim", minRR: 1.5, focus: "Intraday trend pulls back to the day's VWAP and a candle closes back on the trend side; stop past the pullback extreme." },
  { id: "range", label: "Range Trading", minRR: 1.5, focus: "Clear horizontal range: sell the premium edge, buy the discount edge, target the opposite side." },
] as const;
export type ScanStrategyId = (typeof SCAN_STRATEGIES)[number]["id"];
export const SCAN_STRATEGY_IDS = SCAN_STRATEGIES.map((s) => s.id) as [ScanStrategyId, ...ScanStrategyId[]];
export function scanStrategy(id: string) {
  return SCAN_STRATEGIES.find((s) => s.id === id) ?? SCAN_STRATEGIES[0];
}

/** Strategy name: the scan's own strategy, then AutoTrader Pro's strategy first, then the chart's own patterns, then its structure read. */
export function strategyName(s: ScanView): string {
  if (s.strategy?.trim()) return s.strategy.trim().slice(0, 60);
  const pro = s.confluences?.find((c) => c.startsWith("AutoTrader Pro · "));
  if (pro) return pro.replace("AutoTrader Pro · ", "");
  if (s.patterns?.length) return s.patterns.slice(0, 3).join(" + ");
  if (s.structure) return s.structure.split(/[.;]/)[0].slice(0, 60);
  return "Price action";
}

/** Vertical position (% from the top) of entry, stop and target lines over the chart preview. */
export function levelPositions(s: Pick<ScanView, "entry" | "stopLoss" | "takeProfit">): { entry: number; sl: number; tp: number } | null {
  const v = [s.entry, s.stopLoss, s.takeProfit];
  if (v.some((x) => !Number.isFinite(x) || x <= 0)) return null;
  const hi = Math.max(...v), lo = Math.min(...v);
  if (hi === lo) return null;
  const at = (p: number) => Math.round((24 + ((hi - p) / (hi - lo)) * 62) * 10) / 10;
  return { entry: at(s.entry), sl: at(s.stopLoss), tp: at(s.takeProfit) };
}

export type HistoryItem = { at: number; symbol: string; side: string; entry: number; stopLoss: number; takeProfit: number; confidence?: number; timeframe: string };
const KEY = "algovault.scanHistory";
export const HISTORY_MAX = 10;

/** Pure: newest scan first, capped. */
export function pushHistory(list: HistoryItem[], item: HistoryItem): HistoryItem[] {
  return [item, ...list].slice(0, HISTORY_MAX);
}
export function loadHistory(): HistoryItem[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, HISTORY_MAX) : []; } catch { return []; }
}
export function saveHistory(list: HistoryItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

/** Display a price with sensible decimals (2 for gold/indices, 3 for JPY-size, 5 for FX). */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  const a = Math.abs(n);
  return n.toFixed(a >= 1000 ? 2 : a >= 20 ? 3 : 5);
}

/** Pure: the AI said the uploaded picture is not a price chart ({"isChart": false}). */
export function notChartReply(obj: Record<string, unknown>): boolean {
  const v = obj.isChart ?? obj.is_chart;
  return v === false || String(v).trim().toLowerCase() === "false";
}
