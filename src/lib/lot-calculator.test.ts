import { describe, expect, it } from 'vitest';
import { calcLots } from './lot-calculator';
import { sessionStatuses } from './market-session';

describe('calcLots', () => {
  it('sizes a USD forex trade from balance, risk % and stop', () => {
    const r = calcLots({ balance: 1000, riskPct: 1, stopPips: 20, market: 'forex' })!;
    expect(r.lots).toBe(0.05);
    expect(r.riskAmount).toBe(10);
  });
  it('sizes gold with $10 per pip per lot', () => {
    expect(calcLots({ balance: 1000, riskPct: 2, stopPips: 50, market: 'gold' })!.lots).toBe(0.04);
  });
  it('rounds JPY lots down so risk never exceeds the plan', () => {
    expect(calcLots({ balance: 1000, riskPct: 1, stopPips: 20, market: 'jpy', jpyPrice: 150 })!.lots).toBe(0.07);
  });
  it('shows profit and reward-to-risk for a target', () => {
    const r = calcLots({ balance: 1000, riskPct: 1, stopPips: 20, targetPips: 40, market: 'forex' })!;
    expect(r.profit).toBe(20);
    expect(r.rr).toBe(2);
  });
  it('falls back to the 0.01 minimum and flags it', () => {
    const r = calcLots({ balance: 50, riskPct: 1, stopPips: 30, market: 'forex' })!;
    expect(r.lots).toBe(0.01);
    expect(r.belowMinimum).toBe(true);
  });
  it('rejects a missing stop loss', () => {
    expect(calcLots({ balance: 1000, riskPct: 1, stopPips: 0, market: 'forex' })).toBeNull();
  });
});

describe('sessionStatuses', () => {
  it('shows London and New York open during the overlap (Wed 14:00 UTC)', () => {
    const open = sessionStatuses(new Date('2026-11-18T14:00:00Z')).filter(s => s.open).map(s => s.name);
    expect(open).toEqual(['London', 'New York']);
  });
  it('shows every session closed on Saturday', () => {
    expect(sessionStatuses(new Date('2026-11-21T12:00:00Z')).some(s => s.open)).toBe(false);
  });
});
