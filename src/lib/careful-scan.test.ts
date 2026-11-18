import { describe, expect, it } from 'vitest';
import { carefulDecision, type ScanSample } from './careful-scan';

const s = (side: 'BUY' | 'SELL', at: number, confidence = 80, price = 100): ScanSample => ({ side, confidence, price, at });

describe('careful 15-second scan', () => {
  it('does not signal before 15 seconds have passed', () => {
    const r = carefulDecision([s('BUY', 0), s('BUY', 5000), s('BUY', 10000)], 0, 14_000);
    expect(r.ready).toBe(false);
  });
  it('needs at least 3 reads', () => {
    expect(carefulDecision([s('BUY', 0), s('BUY', 15000)], 0, 15_000).ready).toBe(false);
  });
  it('signals when the reads agree after 15 seconds', () => {
    const r = carefulDecision([s('SELL', 0), s('SELL', 5000), s('SELL', 10000), s('SELL', 15000)], 0, 15_000);
    expect(r.ready && r.side).toBe('SELL');
  });
  it('rescans when the reads disagree', () => {
    const r = carefulDecision([s('BUY', 0), s('SELL', 5000), s('BUY', 10000), s('SELL', 15000)], 0, 15_000);
    expect(r.ready).toBe(false);
  });
  it('rescans when the latest read turned against the majority', () => {
    expect(carefulDecision([s('BUY', 0), s('BUY', 5000), s('SELL', 15000)], 0, 15_000).ready).toBe(false);
  });
});
