import { describe, expect, it } from 'vitest';
import { marketSession } from './market-session';

describe('session-aware auto trader', () => {
  it('recognizes London/New York overlap in summer and winter', () => {
    for (const date of ['2026-07-15T13:00:00Z', '2026-12-16T14:00:00Z']) {
      const session = marketSession('EURUSD', new Date(date));
      expect(session.active).toContain('London');
      expect(session.active).toContain('New York');
      expect(session.quality).toBe('high');
    }
  });
  it('uses each city clock during mismatched daylight-saving weeks', () => {
    expect(marketSession('EURUSD', new Date('2026-10-28T12:30:00Z')).active).toContain('New York');
    expect(marketSession('EURUSD', new Date('2026-12-16T12:30:00Z')).active).not.toContain('New York');
  });
  it('recognizes Tokyo as relevant to yen signals', () => {
    expect(marketSession('USDJPY.m', new Date('2026-10-21T02:00:00Z')).quality).toBe('normal');
    expect(marketSession('XAUUSD', new Date('2026-10-21T02:00:00Z')).quality).toBe('low');
  });
  it('blocks forex weekend scans but keeps crypto open', () => {
    const at = new Date('2026-10-24T14:00:00Z');
    expect(marketSession('EURUSD', at).quality).toBe('closed');
    expect(marketSession('BTCUSD', at).quality).not.toBe('closed');
  });
  it('recognizes New York rollover and its end', () => {
    expect(marketSession('XAUUSD', new Date('2026-10-21T21:30:00Z')).quality).toBe('closed');
    expect(marketSession('XAUUSD', new Date('2026-10-21T22:00:00Z')).quality).not.toBe('closed');
  });
});