/**
 * Auto trade style (pure, browser + server safe): reads the market and picks scalp, normal or swing,
 * which then sizes the stop and target. Missing readings fall back to normal; nothing here trades.
 */
import type { SwingRead } from './smart-signal-policy';
import type { MarketSession } from './market-session';
import { isExtremeVolatility } from './volatility-strategy';
import type { TradeStyle } from './trade-style';

/** What the robot was told to use: a fixed style, or let the market decide. */
export type StyleChoice = TradeStyle | 'auto';
export const isStyleChoice = (v: unknown): v is StyleChoice => v === 'auto' || v === 'scalp' || v === 'normal' || v === 'swing';

export type AutoStyle = { style: TradeStyle; reason: string };

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const side = (a?: number, b?: number) => (ok(a) && ok(b) ? (a > b ? 1 : a < b ? -1 : 0) : 0);

/**
 * Swing: a strong 15m trend that the 1h and 4h charts agree with and that is not stretched — ride the bigger leg.
 * Scalp: extreme volatility, a choppy/ranging 15m market or a thin session — take the quick move with a close stop.
 * Normal: everything in between.
 */
export function pickTradeStyle(read: SwingRead, session?: MarketSession): AutoStyle {
  const atr = read.atr15, price = read.price;
  if (!ok(atr) || !ok(price) || atr >= price) return { style: 'normal', reason: 'not enough chart data — normal sizing' };
  if (isExtremeVolatility(read)) return { style: 'scalp', reason: 'extreme volatility — quick in and out' };
  const adx = ok(read.adx15) ? read.adx15 : 20;
  const width = ok(read.bbUp15) && ok(read.bbLo15) && read.bbUp15 > read.bbLo15 ? (read.bbUp15 - read.bbLo15) / atr : undefined;
  if (adx < 18 || (width !== undefined && width < 2.6 && adx < 22)) return { style: 'scalp', reason: `ranging market (ADX ${Math.round(adx)}) — quick range trades` };
  if (session?.quality === 'low') return { style: 'scalp', reason: `thin ${session.name} session — quick trades` };
  const d15 = side(read.ema20_15, read.ema50_15) || side(price, read.ema50_15);
  const d60 = side(price, read.ema50_60) || side(read.ema20_60, read.ema50_60);
  const d240 = side(price, read.ema50_240) || side(read.ema20_240, read.ema50_240);
  const stretch = ok(read.ema50_15) ? Math.abs(price - read.ema50_15) / atr : 0;
  const htfStrong = !ok(read.adx60) || read.adx60 >= 20;
  if (adx >= 25 && d15 !== 0 && d15 === d60 && d15 === d240 && htfStrong && stretch < 3) {
    return { style: 'swing', reason: `strong ${d15 > 0 ? 'up' : 'down'}trend on 15m, 1h and 4h (ADX ${Math.round(adx)}) — riding the bigger move` };
  }
  return { style: 'normal', reason: adx >= 22 ? `15m trend (ADX ${Math.round(adx)}) without full 1h/4h agreement — balanced trade` : 'transitioning market — balanced trade' };
}

/** A fixed style is kept as chosen; 'auto' reads the market. */
export function resolveTradeStyle(choice: StyleChoice, read: SwingRead, session?: MarketSession): AutoStyle & { auto: boolean } {
  if (choice !== 'auto') return { style: choice, reason: 'chosen in settings', auto: false };
  return { ...pickTradeStyle(read, session), auto: true };
}
