/** Pure helpers for the economic calendar shown on the Fundamentals page. */
export type Impact = "High" | "Medium" | "Low" | "Holiday";
export type MarketEvent = {
  id: string;
  title: string;
  currency: string;
  time: string; // ISO timestamp
  impact: Impact;
  forecast: string;
  previous: string;
};

const IMPACTS: Impact[] = ["High", "Medium", "Low", "Holiday"];

/** Turn the raw calendar feed into clean, time-sorted events; bad rows are skipped. */
export function parseCalendar(raw: unknown): MarketEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const currency = typeof r.country === "string" ? r.country.trim().toUpperCase() : "";
    const ms = typeof r.date === "string" ? Date.parse(r.date) : NaN;
    if (!title || !currency || !Number.isFinite(ms)) continue;
    const impact = IMPACTS.includes(r.impact as Impact) ? (r.impact as Impact) : "Low";
    const time = new Date(ms).toISOString();
    out.push({
      id: `${currency}-${time}-${title}`,
      title, currency, time, impact,
      forecast: typeof r.forecast === "string" ? r.forecast : "",
      previous: typeof r.previous === "string" ? r.previous : "",
    });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Currencies a trading pair is exposed to, e.g. XAUUSD → USD (gold reacts to USD news). */
export function pairCurrencies(pair: string): string[] {
  const p = pair.toUpperCase().replace(/[^A-Z]/g, "");
  if (p.length < 6) return [];
  return [...new Set([p.slice(0, 3), p.slice(3, 6)])].filter((c) => c !== "XAU" && c !== "XAG" && c !== "BTC" && c !== "ETH");
}

/** The next event that has not started yet, optionally limited to high impact. */
export function nextEvent(events: MarketEvent[], now: number, highOnly = false): MarketEvent | null {
  return events.find((e) => Date.parse(e.time) > now && (!highOnly || e.impact === "High")) ?? null;
}

/** "in 2h 05m", "in 12m", "now", or "done". */
export function countdown(time: string, now: number): string {
  const diff = Date.parse(time) - now;
  if (diff <= -30 * 60_000) return "done";
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `in ${h}h ${String(m).padStart(2, "0")}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Minutes before / after a high-impact event when the robot opens no new trades. */
export const NEWS_BEFORE_MIN = 30;
export const NEWS_AFTER_MIN = 30;

/** Currencies whose news moves a symbol; indices (NAS100, US30, SPX500) follow USD news. */
export function newsCurrencies(symbol: string): string[] {
  const s = symbol.toUpperCase();
  if (/NAS|US30|US100|US500|SPX|DOW|DJ/.test(s)) return ["USD"];
  const own = pairCurrencies(s);
  return own.length ? own : /XAU|XAG|GOLD|SILVER|BTC|ETH/.test(s) ? ["USD"] : [];
}

/**
 * Pure: the high-impact event that blocks new entries on this symbol right now (NEWS_BEFORE_MIN before
 * to NEWS_AFTER_MIN after its time), or null. An empty or unavailable calendar never blocks.
 */
export function newsBlackout(events: MarketEvent[], symbol: string, now: number, beforeMin = NEWS_BEFORE_MIN, afterMin = NEWS_AFTER_MIN): MarketEvent | null {
  const ccy = newsCurrencies(symbol);
  if (!ccy.length) return null;
  return events.find((e) => {
    if (e.impact !== "High" || !ccy.includes(e.currency)) return false;
    const t = Date.parse(e.time);
    return now >= t - beforeMin * 60_000 && now <= t + afterMin * 60_000;
  }) ?? null;
}
