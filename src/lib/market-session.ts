export type MarketSession = {
  at: string;
  name: string;
  active: string[];
  quality: 'high' | 'normal' | 'low' | 'closed';
  reason: string;
};

export const SESSIONS = [
  { name: 'Sydney', zone: 'Australia/Sydney', start: 8, end: 17 },
  { name: 'Tokyo', zone: 'Asia/Tokyo', start: 9, end: 18 },
  { name: 'London', zone: 'Europe/London', start: 8, end: 17 },
  { name: 'New York', zone: 'America/New_York', start: 8, end: 17 },
];

function localClock(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  return { day: part('weekday'), hour: Number(part('hour')) + Number(part('minute')) / 60 };
}

/** Indicative liquidity windows, not a guarantee that a broker's instrument is open. */
export function marketSession(symbol: string, at = new Date()): MarketSession {
  const name = symbol.toUpperCase().split(/[.\-_#]/)[0];
  const crypto = /^(BTC|ETH|LTC|XRP|SOL|DOGE|BNB|ADA|AVAX|DOT|LINK)/.test(name);
  const forexOrMetal = /^(?:USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|ZAR|SGD|HKD|NOK|SEK){2}(?:M|PRO|ECN|RAW)?$/.test(name) || /^(XAU|XAG|GOLD|SILVER)/.test(name);
  const active = SESSIONS.filter(s => {
    const clock = localClock(at, s.zone);
    return !['Sat', 'Sun'].includes(clock.day) && clock.hour >= s.start && clock.hour < s.end;
  }).map(s => s.name);
  const ny = localClock(at, 'America/New_York');
  const weekend = ny.day === 'Sat' || (ny.day === 'Fri' && ny.hour >= 17) || (ny.day === 'Sun' && ny.hour < 17);
  const rollover = ny.hour >= 17 && ny.hour < 18;
  const base = { at: at.toISOString(), active };
  if (forexOrMetal && weekend) return { ...base, name: 'Weekend closure', quality: 'closed', reason: 'Forex/metals weekly closure; wait for the market to reopen and fresh readings.' };
  if (forexOrMetal && rollover) return { ...base, name: 'New York rollover', quality: 'closed', reason: 'Daily rollover can widen spreads; wait until after 18:00 New York time.' };
  const overlap = active.includes('London') && active.includes('New York');
  const liquid = active.includes('London') || active.includes('New York');
  const asiaRelevant = /JPY|AUD|NZD/.test(name) && active.some(s => s === 'Tokyo' || s === 'Sydney');
  const quality = overlap ? 'high' : liquid || asiaRelevant ? 'normal' : 'low';
  return {
    ...base,
    name: crypto ? `Crypto 24/7 · ${active.join(' / ') || 'off-peak'}` : active.join(' / ') || 'Off-peak',
    quality,
    reason: `${overlap ? 'London/New York overlap offers typically stronger liquidity.' : liquid || asiaRelevant ? 'An instrument-relevant session is active.' : 'Off-peak liquidity: assess cautiously and return WAIT when the setup is unsuitable.'} ${crypto ? 'Crypto trades through weekends; session timing does not prove liquidity.' : 'Broker hours, holidays, spreads and news are not supplied and must not be invented.'}`,
  };
}
export type SessionStatus = { name: string; open: boolean; localTime: string; progress: number };

/** Per-session open/closed board for display only (same windows as marketSession). */
export function sessionStatuses(at = new Date()): SessionStatus[] {
  return SESSIONS.map(s => {
    const clock = localClock(at, s.zone);
    const open = !['Sat', 'Sun'].includes(clock.day) && clock.hour >= s.start && clock.hour < s.end;
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: s.zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    const progress = open ? (clock.hour - s.start) / (s.end - s.start) : 0;
    return { name: s.name, open, localTime, progress };
  });
}
