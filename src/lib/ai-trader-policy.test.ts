import { describe, expect, it } from 'vitest';
import { checkAiTrade, nextAiScanAt, reanchorTrade, AI_TRADER_SCAN_MS } from './ai-trader-policy';

const ctx = { price: 100, atr15: 1, style: 'normal' as const, supports: [95], resistances: [110] };
const buy = { side: 'BUY' as const, confidence: 75, entry: 100, stopLoss: 98.5, takeProfit: 102, reason: 'Trend up' };

describe('AI Trader policy (never WAIT)', () => {
  it('accepts a sound AI BUY at the live price', () => {
    const r = checkAiTrade(buy, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.entry).toBe(100); expect(r.takeProfit).toBe(102); expect(r.stopLoss).toBe(98.5); }
  });

  it('turns an undecided AI into the engine\'s side instead of waiting', () => {
    const r = checkAiTrade({ ...buy, side: 'WAIT' }, { ...ctx, fallbackSide: 'SELL' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.side).toBe('SELL');
  });

  it('still trades a low-confidence call', () => {
    const r = checkAiTrade({ ...buy, confidence: 40 }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.confidence).toBe(50);
  });

  it('rebuilds a stop on the wrong side of price behind the entry', () => {
    const r = checkAiTrade({ ...buy, stopLoss: 101 }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stopLoss).toBeLessThan(100);
  });

  it('fits a stop wider than the style allows (normal: 2.5 ATR)', () => {
    const r = checkAiTrade({ ...buy, stopLoss: 96, takeProfit: 103.4 }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stopLoss).toBeCloseTo(97.5);
  });

  it('pulls the target in before a nearby resistance', () => {
    const r = checkAiTrade({ ...buy, takeProfit: 103 }, { ...ctx, resistances: [102.5] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.takeProfit).toBeCloseTo(102.4); expect(r.capped).toBe(true); }
  });

  it('trades a compact target (normal minimum 0.8 ATR stop, 1.2x reward) when a level leaves little room', () => {
    const r = checkAiTrade(buy, { ...ctx, resistances: [100.5] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.stopLoss).toBeCloseTo(99.2); expect(r.takeProfit).toBeCloseTo(100.96); }
  });

  it('moves the levels with price when the AI entry is away from the live price', () => {
    const r = checkAiTrade({ ...buy, entry: 100.5, stopLoss: 99, takeProfit: 102.5 }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.entry).toBe(100); expect(r.stopLoss).toBeCloseTo(98.5); expect(r.takeProfit).toBeCloseTo(102); }
  });

  it('keeps stop and target distances when re-anchored to a new live price', () => {
    const r = reanchorTrade({ side: 'BUY' as const, entry: 100, stopLoss: 98.5, takeProfit: 102 }, 100.3);
    expect(r.stopLoss).toBeCloseTo(98.8); expect(r.takeProfit).toBeCloseTo(102.3);
  });

  it('only refuses when live chart data is missing', () => {
    expect(checkAiTrade(buy, { ...ctx, atr15: 0 }).ok).toBe(false);
  });

  it('asks the AI again only at the next 5-minute candle', () => {
    const now = Date.UTC(2026, 0, 5, 10, 2);
    expect(nextAiScanAt(now)).toBe(Date.UTC(2026, 0, 5, 10, 5) + 5_000);
    expect(AI_TRADER_SCAN_MS).toBe(300_000);
  });
});

import { aiHoldNote } from './ai-trader-policy';
describe('AI Trader direction hold', () => {
  const hold = { side: 'SELL' as const, at: 0 };
  it('holds back the opposite side inside the hold time', () => {
    expect(aiHoldNote(hold, 'BUY', 80, 30 * 60_000, 10 * 60_000)).not.toBeNull();
  });
  it('lets the same side, an expired hold or an 85%+ call through', () => {
    expect(aiHoldNote(hold, 'SELL', 70, 30 * 60_000, 10 * 60_000)).toBeNull();
    expect(aiHoldNote(hold, 'BUY', 70, 30 * 60_000, 30 * 60_000)).toBeNull();
    expect(aiHoldNote(hold, 'BUY', 85, 30 * 60_000, 10 * 60_000)).toBeNull();
  });
});
