import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), scan: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ inputValidator: () => ({ handler: (fn: (args: unknown) => unknown) => (args: unknown) => fn(args) }) }) }));
vi.mock('./tradingview.functions', () => ({ readTradingView: mocks.read, tvName: (s: string) => s }));
vi.mock('./smart-signal.server', () => ({ runSmartSignal: mocks.scan }));
import { getSmartSignal } from './smart-signal.functions';

const reading = { ok: true, ticker: 'TEST:BTCUSD', price: 100, rating5: .5, rating15: .5, rating60: .5, rating240: .5, ma15: .5, rsi15: 55, adx15: 25, ema50_15: 98, ema200_60: 95, macd15: 1, macdSig15: .5, atr15: .5, atr60: 2, atr240: 4, rsi60: 55, rsi240: 55, adx60: 25, adx240: 25, ema50_60: 96, ema50_240: 94 };
const result = { ok: true, side: 'BUY', confidence: 80, entry: 100, stopLoss: 99.25, takeProfit: 100.75, timeframe: '4h', reason: '', ready: true, price: 100, ruleScore: 0, ruleReasons: [] };

describe('live movement recheck after AI', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T14:00:00Z'));
    mocks.read.mockReset();
    mocks.scan.mockReset().mockResolvedValue({ ...result });
    mocks.read.mockResolvedValueOnce({ ...reading });
  });
  it('never executes on closed forex sessions', async () => {
    vi.setSystemTime(new Date('2026-10-24T14:00:00Z'));
    const signal = await getSmartSignal({ data: { symbol: 'EURUSD', directional: true } });
    expect(signal.ready).toBe(false);
  });
  it('blocks a rollover starting during the scan', async () => {
    vi.setSystemTime(new Date('2026-10-21T20:59:00Z'));
    mocks.scan.mockImplementationOnce(async () => { vi.setSystemTime(new Date('2026-10-21T21:01:00Z')); return { ...result }; });
    mocks.read.mockResolvedValueOnce({ ...reading });
    const signal = await getSmartSignal({ data: { symbol: 'XAUUSD', directional: true } });
    expect(signal.ready).toBe(false);
  });
  it('sampling reads inside the careful scan skip the live recheck', async () => {
    await getSmartSignal({ data: { symbol: 'BTCUSD', directional: true, recheck: false } });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it('retains confirmation when fresh movement agrees', async () => {
    mocks.read.mockResolvedValueOnce({ ...reading });
    expect((await getSmartSignal({ data: { symbol: 'BTCUSD', directional: true } })).ready).toBe(true);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it('blocks a direction flip during the live recheck', async () => {
    mocks.scan.mockResolvedValueOnce({ ...result }).mockResolvedValueOnce({ ...result, side: 'SELL' });
    mocks.read.mockResolvedValueOnce({ ...reading });
    const signal = await getSmartSignal({ data: { symbol: 'BTCUSD', directional: true } });
    expect(signal.ready).toBe(false);
    expect(signal.executionNote).toContain('flipped');
  });
  it('blocks execution if the fresh chart source differs', async () => {
    mocks.read.mockResolvedValueOnce({ ...reading, ticker: 'OTHER:BTCUSD' });
    const signal = await getSmartSignal({ data: { symbol: 'BTCUSD', directional: true } });
    expect(signal.ready).toBe(false);
    expect(signal.executionNote).toContain('source changed');
  });
  it('blocks execution when the live recheck is unavailable', async () => {
    mocks.read.mockResolvedValueOnce({ ok: false });
    expect((await getSmartSignal({ data: { symbol: 'BTCUSD', directional: true } })).ready).toBe(false);
  });
});