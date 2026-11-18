import { describe, expect, it } from 'vitest';
import { AI_BLOCK_COOLDOWN_MS, blockedRecently, interpretReview, rememberBlock, reviewLogLine } from './ai-trade-review';

describe('AI trade check', () => {
  it('blocks the trade when the AI does not approve', () => {
    expect(interpretReview({ approve: false, confidence: 80, reason: 'Target blocked by resistance' }).status).toBe('blocked');
  });
  it('approves the trade when the AI approves', () => {
    expect(interpretReview({ approve: true, confidence: 74, reason: '1h and 4h agree' })).toEqual({ status: 'approved', confidence: 74, reason: '1h and 4h agree' });
  });
  it('lets the built-in engine decide when the AI is unavailable', () => {
    const out = interpretReview(null, 'credits exhausted');
    expect(out.status).toBe('unavailable');
    expect(reviewLogLine('XAUUSD', 'BUY', out)).toContain('built-in engine decided');
  });
  it('skips the same pair and side for 5 minutes after a block', () => {
    const mem = rememberBlock({}, 'EURUSD', 'SELL', 1_000);
    expect(AI_BLOCK_COOLDOWN_MS).toBe(5 * 60_000);
    expect(blockedRecently(mem, 'EURUSD', 'SELL', 1_000 + 4 * 60_000)).toBe(true);
    expect(blockedRecently(mem, 'EURUSD', 'SELL', 1_000 + 5 * 60_000)).toBe(false);
  });
  it('a block on one side does not stop the opposite side', () => {
    const mem = rememberBlock({}, 'EURUSD', 'SELL', 0);
    expect(blockedRecently(mem, 'EURUSD', 'BUY', 1)).toBe(false);
  });
});
