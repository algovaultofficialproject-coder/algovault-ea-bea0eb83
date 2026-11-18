import type { TvRead } from './tv-strategy';

export type ScanTimeframe = '1m' | '5m' | '15m' | '1h' | '4h';
export type SwingRead = TvRead & {
  atr5?: number; atr15?: number; atr60?: number; atr240?: number;
  rsi5?: number; rsi60?: number; rsi240?: number; adx5?: number; adx60?: number; adx240?: number;
  ema50_5?: number; ema50_60?: number; ema50_240?: number;
  rating1?: number; rsi1?: number; ema20_1?: number; atr1?: number; mom1?: number; macd5?: number; macdSig5?: number;
  stochK1?: number; stochD1?: number; stochK5?: number; stochD5?: number; ema20_5?: number; bbUp5?: number; bbLo5?: number;
  bbUp15?: number; bbLo15?: number; diPlus15?: number; diMinus15?: number; ema20_15?: number; ema200_15?: number; stochK15?: number; stochD15?: number;
  // Price action / structure (optional: missing readings simply skip that strategy).
  open1?: number; high1?: number; low1?: number; donHi1?: number; donLo1?: number;
  open5?: number; high5?: number; low5?: number; prevOpen5?: number; prevHigh5?: number; prevLow5?: number; prevClose5?: number; donHi5?: number; donLo5?: number;
  open15?: number; high15?: number; low15?: number; prevOpen15?: number; prevHigh15?: number; prevLow15?: number; prevClose15?: number; donHi15?: number; donLo15?: number;
  vwap15?: number; psar15?: number; rsiPrev15?: number;
  pivS1?: number; pivS2?: number; pivP?: number; pivR1?: number; pivR2?: number;
  bullPat5?: number; bearPat5?: number; bullPat15?: number; bearPat15?: number;
  // Oscillators and the previous candle's values (fresh crossovers / turns out of extremes).
  cci15?: number; cciPrev15?: number; wr15?: number; ao15?: number; aoPrev15?: number; aoPrev2_15?: number; stochRsi15?: number; uo15?: number;
  macdPrev15?: number; macdSigPrev15?: number; stochKPrev15?: number; stochDPrev15?: number; diPlusPrev15?: number; diMinusPrev15?: number;
  aroonUp15?: number; aroonDn15?: number; mom15?: number; momPrev15?: number;
  cci5?: number; wr5?: number; ao5?: number; aoPrev5?: number; macdPrev5?: number; macdSigPrev5?: number; rsiPrev5?: number; stochKPrev5?: number; stochDPrev5?: number;
  // 15m structure: Ichimoku, Keltner (squeeze), Hull and extra moving averages.
  ichTenkan15?: number; ichKijun15?: number; ichSpanA15?: number; ichSpanB15?: number; hull15?: number; kcUp15?: number; kcLo15?: number;
  ema9_15?: number; ema100_15?: number; ema20Prev15?: number; ema50Prev15?: number; vwma15?: number;
  // Volume (tick volume on forex, real volume on crypto).
  vol15?: number; volPrev15?: number; rvol15?: number;
  // Higher timeframes (1h / 4h) and their structure.
  ema20_60?: number; macd60?: number; macdSig60?: number; stochK60?: number; stochD60?: number; donHi60?: number; donLo60?: number; bbUp60?: number; bbLo60?: number;
  open60?: number; high60?: number; low60?: number; prevOpen60?: number; prevHigh60?: number; prevLow60?: number; prevClose60?: number;
  ema20_240?: number; ema200_240?: number; donHi240?: number; donLo240?: number;
  // Extra EMA / momentum depth for the 1m, 5m and 1h charts (smart strategy library).
  ema9_1?: number; ema50_1?: number; ema200_1?: number; ema9Prev1?: number; ema20Prev1?: number;
  prevOpen1?: number; prevHigh1?: number; prevLow1?: number; prevClose1?: number;
  macd1?: number; macdSig1?: number; adx1?: number; rsiPrev1?: number; bbUp1?: number; bbLo1?: number; ao1?: number; aoPrev1?: number; cci1?: number;
  ema9_5?: number; ema100_5?: number; ema200_5?: number; ema9Prev5?: number; ema20Prev5?: number; ema50Prev5?: number;
  diPlus5?: number; diMinus5?: number; kcUp5?: number; kcLo5?: number; vwap5?: number;
  ema9_60?: number; ema100_60?: number; diPlus60?: number; diMinus60?: number; rsiPrev60?: number; ema20Prev60?: number; ema50Prev60?: number;
  // Daily / weekly liquidity levels.
  dayOpen?: number; dayHigh?: number; dayLow?: number; pdHigh?: number; pdLow?: number; pdClose?: number; wkHigh?: number; wkLow?: number;
};
export type SignalVerdict = {
  side: 'BUY' | 'SELL' | 'WAIT'; confidence: number;
  entry: number; stopLoss: number; takeProfit: number;
  timeframe: ScanTimeframe; timeframeReason: string; reason: string;
  /** Built-in engine only: a 5m/15m structural turn backs this side. */
  turnConfirmed?: boolean;
  /** Built-in engine only: direction of the clear slower-chart trend, if any. */
  trendSide?: 'BUY' | 'SELL';
};

export function timeframeRead(read: SwingRead, timeframe: ScanTimeframe) {
  if (timeframe === '4h') return { atr: read.atr240, rsi: read.rsi240, adx: read.adx240, ema: read.ema50_240, rating: read.rating240 };
  if (timeframe === '1h') return { atr: read.atr60, rsi: read.rsi60, adx: read.adx60, ema: read.ema50_60, rating: read.rating60 };
  if (timeframe === '1m') return { atr: read.atr1, rsi: read.rsi1, adx: read.adx1, ema: read.ema50_1, rating: read.rating1 ?? Number.NaN };
  if (timeframe === '5m') return { atr: read.atr5, rsi: read.rsi5, adx: read.adx5, ema: read.ema50_5, rating: read.rating5 };
  return { atr: read.atr15, rsi: read.rsi15, adx: read.adx15, ema: read.ema50_15, rating: read.rating15 };
}

/** Larger setups must be supported by observed volatility, not inflated targets. */
export function validateSwingSignal(read: SwingRead, verdict: SignalVerdict): string | null {
  if (verdict.side === 'WAIT') return null;
  const selected = timeframeRead(read, verdict.timeframe);
  if (![read.price, selected.atr, selected.rsi, selected.adx, selected.ema, verdict.entry, verdict.stopLoss, verdict.takeProfit].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)) return 'Selected timeframe has incomplete market readings';
  const atr = selected.atr;
  if (!atr) return 'Selected timeframe has no reliable volatility';
  const sign = verdict.side === 'BUY' ? 1 : -1;
  if (![read.rating60, read.rating240, selected.rating, verdict.confidence].every(Number.isFinite)) return 'Selected timeframe has incomplete direction readings';
  if (read.rating60 * sign < 0.1 || read.rating240 * sign < 0.1 || selected.rating * sign < 0.1) return 'Higher timeframes do not confirm the direction';
  if (verdict.confidence < 70 || (selected.adx ?? 0) < 20) return 'Setup needs stronger confirmation';
  if ((selected.rsi ?? 0) > 72 || (selected.rsi ?? 0) < 28) return 'Selected timeframe is exhausted';
  if ((read.price - (selected.ema ?? 0)) * sign <= 0) return 'Price does not confirm the timeframe trend';
  const risk = (verdict.entry - verdict.stopLoss) * sign;
  const reward = (verdict.takeProfit - verdict.entry) * sign;
  if (risk <= 0 || reward <= 0) return 'Stop and target have invalid direction';
  if (risk < atr * 1.5 || risk > atr * 4) return 'Stop must reflect the selected timeframe volatility';
  if (reward / risk < 2 || reward > atr * 8) return 'Target lacks a realistic 2:1 reward/risk setup';
  if (Math.abs(read.price - verdict.entry) > atr * 0.35) return 'Waiting for price to reach the suggested entry';
  return null;
}