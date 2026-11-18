import { describe, expect, it } from 'vitest';
import { STYLE_RULES, stabilizeDirection } from './trade-style';

describe('direction stability', () => {
  it('does not flip on a single opposite scan', () => {
    const r = stabilizeDirection({ side: 'SELL', confidence: 70 }, 'BUY', 70, 'normal', 1000);
    expect(r.accept).toBe(false);
    expect(r.memory.side).toBe('SELL');
  });

  it('scans every 15 seconds in every style', () => {
    for (const s of ['scalp', 'normal', 'swing'] as const) expect(STYLE_RULES[s].scanMs).toBe(15_000);
  });

  it('normal mode flips only after four confirming scans spread over at least 3 minutes', () => {
    let m = stabilizeDirection({ side: 'SELL', confidence: 70 }, 'BUY', 70, 'normal', 0).memory;
    for (const t of [15_000, 30_000, 45_000]) { const r = stabilizeDirection(m, 'BUY', 72, 'normal', t); expect(r.accept).toBe(false); m = r.memory; }
    for (let t = 60_000; t < 180_000; t += 15_000) m = stabilizeDirection(m, 'BUY', 72, 'normal', t).memory;
    const c = stabilizeDirection(m, 'BUY', 72, 'normal', 180_000, { turnConfirmed: true });
    expect(c.accept).toBe(true);
    expect(c.memory.side).toBe('BUY');
  });

  it('swing needs five confirming scans over at least 10 minutes', () => {
    let m = stabilizeDirection({ side: 'BUY', confidence: 70 }, 'SELL', 70, 'swing', 0).memory;
    for (const t of [15_000, 30_000, 45_000, 60_000]) { const r = stabilizeDirection(m, 'SELL', 70, 'swing', t); expect(r.accept).toBe(false); m = r.memory; }
    for (let t = 75_000; t < 600_000; t += 15_000) m = stabilizeDirection(m, 'SELL', 70, 'swing', t).memory;
    expect(stabilizeDirection(m, 'SELL', 70, 'swing', 600_000).accept).toBe(true);
  });

  it('holds back the opposite of the last trade during the hold time', () => {
    const r = stabilizeDirection({ side: 'BUY', confidence: 70, tradedSide: 'BUY', tradedAt: 0 }, 'SELL', 75, 'scalp', 1000);
    const r2 = stabilizeDirection(r.memory, 'SELL', 75, 'scalp', 31_000);
    expect(r2.accept).toBe(false);
  });
});
