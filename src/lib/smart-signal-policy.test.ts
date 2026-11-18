import { describe, expect, it } from 'vitest';
import { validateSwingSignal, type SwingRead, type SignalVerdict } from './smart-signal-policy';

const read: SwingRead = { price: 100, rating5: .5, rating15: .5, rating60: .5, rating240: .5, ma15: .5, rsi15: 55, adx15: 25, ema50_15: 98, ema200_60: 95, macd15: 1, macdSig15: .5, atr15: .5, atr60: 2, atr240: 4, rsi60: 55, rsi240: 55, adx60: 25, adx240: 25, ema50_60: 96, ema50_240: 94 };
const verdict: SignalVerdict = { side: 'BUY', confidence: 80, entry: 100, stopLoss: 97, takeProfit: 106, timeframe: '1h', timeframeReason: 'Hourly trend', reason: 'Aligned trend' };
describe('larger timeframe setups', () => {
  it('accepts confirmed hourly BUY', () => expect(validateSwingSignal(read, verdict)).toBeNull());
  it('uses 4h volatility rather than small 15m stops', () => expect(validateSwingSignal(read, { ...verdict, timeframe: '4h' })).toContain('volatility'));
  it('rejects missing selected timeframe data', () => expect(validateSwingSignal({ ...read, atr60: undefined }, verdict)).toContain('incomplete'));
  it('rejects opposing higher timeframe trend', () => expect(validateSwingSignal({ ...read, rating240: -.5 }, verdict)).toContain('direction'));
  it('rejects small reward/risk', () => expect(validateSwingSignal(read, { ...verdict, takeProfit: 104 })).toContain('2:1'));
  it('rejects invented oversized targets', () => expect(validateSwingSignal(read, { ...verdict, takeProfit: 140 })).toContain('realistic'));
  it('accepts confirmed SELL', () => expect(validateSwingSignal({ ...read, rating60: -.5, rating240: -.5, ema50_60: 104 }, { ...verdict, side: 'SELL', stopLoss: 103, takeProfit: 94 })).toBeNull());
  it('allows WAIT without inventing trade levels', () => expect(validateSwingSignal(read, { ...verdict, side: 'WAIT', stopLoss: 0, takeProfit: 0 })).toBeNull());
  it('rejects nonfinite higher timeframe direction', () => expect(validateSwingSignal({ ...read, rating240: NaN }, verdict)).toContain('incomplete'));
  it('rejects nonfinite AI confidence', () => expect(validateSwingSignal(read, { ...verdict, confidence: NaN })).toContain('incomplete'));
});