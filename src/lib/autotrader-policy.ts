import type { ScanTimeframe, SwingRead } from './smart-signal-policy';
import { timeframeRead, type SignalVerdict } from './smart-signal-policy';

/** The autotrader scans the 1m, 5m and 15m charts only. */
export const AUTO_TIMEFRAMES = ['15m', '5m', '1m'] as const;

/** Scale-free selection: compare trend strength, not symbol names or raw prices. */
export function rankAutoTimeframes(read: SwingRead) {
  const candidates = AUTO_TIMEFRAMES.flatMap(timeframe => {
    const data = timeframeRead(read, timeframe);
    if (![read.price, data.atr, data.ema, data.rsi, data.adx, data.rating].every(Number.isFinite) || !(read.price > 0) || !(data.atr && data.atr > 0 && data.atr < read.price) || !(data.ema && data.ema > 0) || !(data.adx && data.adx > 0 && data.adx <= 100) || !(data.rsi && data.rsi > 0 && data.rsi <= 100) || Math.abs(data.rating) > 1) return [];
    // Direction combines observed trend, price location and momentum, rather than rating alone.
    const movement = data.rating * 2 + Math.max(-1, Math.min(1, (read.price - data.ema) / data.atr)) + (data.rsi - 50) / 50;
    const sign = movement >= 0 ? 1 : -1;
    // Bigger-picture agreement inside the scanned range: the 15m and 5m charts.
    const aligned = read.rating15 * sign > 0 && read.rating5 * sign > 0;
    const consistent = data.rating * sign > 0 && (read.price - data.ema) * sign > 0 && (data.rsi - 50) * sign > 0;
    const score = Math.abs(data.rating) * 30 + Math.min(data.adx, 50) + (aligned ? 15 : 0) + (consistent ? 15 : -15) + (timeframe === '15m' ? 4 : timeframe === '5m' ? 2 : -4) - (data.rsi > 72 || data.rsi < 28 ? 20 : 0);
    const side: 'BUY' | 'SELL' = sign > 0 ? 'BUY' : 'SELL';
    return [{ timeframe, score, side, atr: data.atr, priceDistanceAtr: (read.price - data.ema) / data.atr }];
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function recommendAutoTimeframe(read: SwingRead) {
  const selected = rankAutoTimeframes(read)[0];
  if (!selected) return null;
  return { timeframe: selected.timeframe, side: selected.side, reason: `${selected.timeframe} ranks highest for trend, ATR-normalized price movement and RSI momentum across 1m, 5m and 15m` };
}

/** Starting the bot authorizes valid AI signals; reject unusable or stale analysis, not weak confluence. */
export function autoEntryRejection(read: SwingRead, verdict: SignalVerdict) {
  if (verdict.side === 'WAIT') return 'AI did not provide a trading direction';
  const sign = verdict.side === 'BUY' ? 1 : -1;
  const selected = timeframeRead(read, verdict.timeframe);
  const { ema, rsi, adx, rating } = selected;
  // Levels are always sized with 15-minute volatility: 1h/4h stops and targets sit too far away.
  const atr = read.atr15;
  if (![read.price, atr, ema, rsi, adx, verdict.entry, verdict.stopLoss, verdict.takeProfit].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) || !Number.isFinite(rating)) return 'Selected timeframe has incomplete market readings';
  if (!atr || !ema || !rsi || !adx || atr >= read.price || rsi > 100 || adx > 100 || Math.abs(rating) > 1) return 'Selected timeframe has invalid market readings';
  const movement = rating * 2 + Math.max(-1, Math.min(1, (read.price - ema) / atr)) + (rsi - 50) / 50;
  if ((movement >= 0 ? 1 : -1) !== sign) return 'Chart movement changed direction during analysis';
  const risk = (verdict.entry - verdict.stopLoss) * sign;
  const reward = (verdict.takeProfit - verdict.entry) * sign;
  if (risk <= 0 || reward <= 0) return 'Stop and target have invalid direction';
  // Normal, symmetric levels for BUY and SELL: neither stop nor target is widened.
  if (risk < atr * 1 || risk > atr * 2) return 'Stop must be a normal 1-2x 15m volatility';
  if (reward < atr * 1 || reward > atr * 2.5) return 'Target must be a normal 1-2.5x 15m volatility move';
  if (Math.abs(read.price - verdict.entry) > atr * 0.35) return 'AI entry price is stale';
  return null;
}

export const autoScanInterval = (timeframe: ScanTimeframe) => timeframe === '4h' ? 14_400_000 : timeframe === '1h' ? 3_600_000 : timeframe === '15m' ? 900_000 : timeframe === '1m' ? 60_000 : 300_000;