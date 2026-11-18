import { describe, expect, it } from 'vitest';
import type { SwingRead } from './smart-signal-policy';
import { takeProfitPlan, TP_MAX_ATR, TP_MIN_ATR, type TpContext } from './take-profit-strategy';
import { analyzeBuiltinAuto } from './builtin-autotrader';

const read = { price: 100, atr15: 1, bbUp15: 102, bbLo15: 98, ema50_15: 99.5, ema20_15: 99.8 } as SwingRead;
const base: TpContext = { read, sign: 1, setup: 'pullback', adx: 25, volatility: 'normal', style: 'normal' };
const plan = (o: Partial<TpContext>) => takeProfitPlan({ ...base, ...o });

describe('market-adaptive take profit', () => {
  it('lets a strong trend run further than a moderate one', () => {
    expect(plan({ adx: 25 }).targetAtr).toBe(1.7);
    expect(plan({ adx: 32 }).targetAtr).toBe(2);
    expect(plan({ adx: 42 }).targetAtr).toBe(2.3);
    expect(plan({}).method).toBe('trendRunner');
  });

  it('projects a breakout by half the 15m range height', () => {
    const p = plan({ setup: 'breakout', read: { ...read, bbUp15: 104, bbLo15: 99 } });
    expect(p.method).toBe('measuredMove');
    expect(p.targetAtr).toBeCloseTo(2.25, 3); // 5 ATR wide × 0.45
  });

  it('targets the midline in a quiet range but rotates past it in a normal range', () => {
    const r = { ...read, price: 98.4 } as SwingRead;
    const quiet = plan({ setup: 'range', volatility: 'low', adx: 15, read: r });
    expect(quiet.method).toBe('rangeMidline');
    expect(quiet.targetAtr).toBeCloseTo(1.6, 3);
    const normal = plan({ setup: 'range', volatility: 'normal', adx: 15, read: r });
    expect(normal.method).toBe('rangeRotation');
    expect(normal.targetAtr).toBeCloseTo(2.6, 3); // midline 1.6 + half of the 2 ATR to the far band
  });

  it('widens targets in fast markets and tightens them in quiet ones', () => {
    expect(plan({ volatility: 'high' }).targetAtr).toBeCloseTo(1.955, 3);
    expect(plan({ volatility: 'low' }).targetAtr).toBeCloseTo(1.445, 3);
    expect(plan({ volatility: 'high', extreme: true }).targetAtr).toBe(1.7);
  });

  it('takes profit early when price is already stretched', () => {
    expect(plan({ read: { ...read, ema50_15: 97 } }).targetAtr).toBe(0.9);
  });

  it('extends continuation targets with the 1h/4h trend and trims them against it', () => {
    expect(plan({ htfWith: 0.4 }).targetAtr).toBeCloseTo(1.9, 3);
    expect(plan({ htfWith: -0.5 }).targetAtr).toBeCloseTo(1.5, 3);
  });

  it('banks sooner after a spike against the trade', () => {
    expect(plan({ spike: { dir: -1, kind: 'momentum' } }).targetAtr).toBeCloseTo(1.445, 3);
  });

  it('caps intraday targets at the normal 1h move, but not for swing', () => {
    // 1h ATR 2 → normal 1h move 2.5; the 1h candle low is 98.5, so only 1 ATR is left up.
    const hour = { ...read, atr60: 2, low60: 98.5, high60: 100.1 } as SwingRead;
    expect(plan({ read: hour }).targetAtr).toBeCloseTo(0.95, 3);
    expect(plan({ read: hour, style: 'swing' }).targetAtr).toBe(1.7);
  });

  it('shrinks continuation targets once the normal 1h move is used up', () => {
    const used = { ...read, atr60: 2, low60: 97, high60: 100.1 } as SwingRead;
    expect(plan({ read: used }).targetAtr).toBeCloseTo(1.36, 3);
  });

  it('ignores daily ranges: targets read only the 1m to 1h charts', () => {
    const day = { ...read, dayLow: 96, dayHigh: 100.2, pdHigh: 105, pdLow: 100 } as SwingRead;
    expect(plan({ read: day }).targetAtr).toBe(1.7);
  });

  it('banks sooner in a volatility climax and reaches further when the fast charts expand', () => {
    const steady = { state: 'steady', stopScale: 1, targetScale: 1, label: '' } as const;
    expect(plan({ profile: { ...steady, state: 'climax', targetScale: 0.85 } }).targetAtr).toBeCloseTo(1.445, 3);
    expect(plan({ profile: { ...steady, state: 'expanding', targetScale: 1.15 } }).targetAtr).toBeCloseTo(1.836, 3);
  });

  it('lets a trend run a little further when the EMA fan is widening', () => {
    const fan = { ...read, ema20_15: 100.1, ema20Prev15: 99.9, ema50_15: 99.5, ema50Prev15: 99.45 } as SwingRead;
    expect(plan({ read: fan }).targetAtr).toBeCloseTo(1.85, 3);
  });

  it('always stays within the raw target bounds', () => {
    for (const setup of ['pullback', 'breakout', 'exhaustion', 'range', 'reversal', 'momentum'] as const)
      for (const volatility of ['low', 'normal', 'high'] as const)
        for (const sign of [1, -1] as const) {
          const t = plan({ setup, volatility, sign, adx: 45, htfWith: 1 }).targetAtr;
          expect(t).toBeGreaterThanOrEqual(TP_MIN_ATR);
          expect(t).toBeLessThanOrEqual(TP_MAX_ATR);
        }
  });

  it('shows the chosen take-profit strategy in the robot reason', () => {
    const v = analyzeBuiltinAuto({ ...read, rating15: 0.6, rating5: 0.5, rating1: 0.4, rsi15: 60, adx15: 30, diPlus15: 30, diMinus15: 12, ema50_5: 99.6, ema20_5: 99.9, atr5: 0.6, atr1: 0.25, ema20_1: 99.95 } as SwingRead);
    expect(v.side).not.toBe('WAIT');
    expect(v.reason).toMatch(/TP |compact target/);
  });
});
