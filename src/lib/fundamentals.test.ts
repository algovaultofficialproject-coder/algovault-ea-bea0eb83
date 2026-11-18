import { describe, it, expect } from 'vitest';
import { countdown, nextEvent, pairCurrencies, parseCalendar } from './fundamentals';

const raw = [
  { title: 'Non-Farm Employment Change', country: 'USD', date: '2026-11-13T08:30:00-05:00', impact: 'High', forecast: '150K', previous: '120K' },
  { title: 'CPI y/y', country: 'CNY', date: '2026-11-08T20:30:00-05:00', impact: 'Low', forecast: '0.8%', previous: '0.9%' },
  { title: 'broken', country: 'EUR', date: 'not a date', impact: 'High' },
];

describe('Fundamentals calendar', () => {
  it('keeps valid events sorted by time and skips broken rows', () => {
    const events = parseCalendar(raw);
    expect(events.map((e) => e.currency)).toEqual(['CNY', 'USD']);
    expect(events[1].time).toBe('2026-11-13T13:30:00.000Z');
  });
  it('finds the next high-impact event', () => {
    const events = parseCalendar(raw);
    expect(nextEvent(events, Date.parse('2026-11-10T00:00:00Z'), true)?.title).toBe('Non-Farm Employment Change');
    expect(nextEvent(events, Date.parse('2026-11-14T00:00:00Z'), true)).toBeNull();
  });
  it('maps gold to USD news and FX pairs to both currencies', () => {
    expect(pairCurrencies('XAUUSD')).toEqual(['USD']);
    expect(pairCurrencies('GBPJPY')).toEqual(['GBP', 'JPY']);
  });
  it('formats countdowns', () => {
    const t = '2026-11-13T13:30:00.000Z';
    expect(countdown(t, Date.parse(t) - 125 * 60_000)).toBe('in 2h 05m');
    expect(countdown(t, Date.parse(t) + 60_000)).toBe('now');
    expect(countdown(t, Date.parse(t) + 60 * 60_000)).toBe('done');
  });
});
