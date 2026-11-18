/**
 * Pure matcher: turns what the user typed (XAUUSD.M, xauusd, GOLD, XAUUSDm…)
 * into the exact symbol name the connected account lists (e.g. "XAUUSD.m").
 */

const ALIASES: Record<string, string[]> = {
  XAUUSD: ["GOLD"], XAGUSD: ["SILVER"],
  NAS100: ["USTEC", "US100", "NDX100", "NAS"], US30: ["DJ30", "WS30", "DOW30", "DJI"],
  SPX500: ["US500", "SP500", "SPX"], GER40: ["DE40", "DAX40", "GER30", "DE30"],
  UK100: ["FTSE100"], USOIL: ["WTI", "XTIUSD", "CRUDE"], UKOIL: ["BRENT", "XBRUSD"],
};
const GROUPS = new Map<string, string>();
for (const [k, list] of Object.entries(ALIASES)) for (const a of [k, ...list]) GROUPS.set(a, k);

const flat = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Market part before any broker suffix: "XAUUSD.M" → "XAUUSD". */
export const symbolBase = (s: string) => flat(s.trim().split(/[.\-_#!+]/)[0] ?? "");
const group = (base: string) => GROUPS.get(base) ?? base;

/** Parses the bridge's symbol list (string[], object[] or name→info map) into names. */
export function parseSymbolList(body: unknown): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { if (typeof v === "string" && v.trim()) out.push(v.trim()); };
  if (Array.isArray(body)) {
    for (const item of body) {
      if (typeof item === "string") add(item);
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        add(o.name ?? o.Name ?? o.symbol ?? o.Symbol ?? o.currency ?? o.Currency);
      }
    }
  } else if (body && typeof body === "object") {
    for (const k of Object.keys(body as object)) add(k);
  }
  return [...new Set(out)];
}

/** Exact broker name for the typed symbol, or null when the account has no such market. */
export function matchBrokerSymbol(typed: string, symbols: readonly string[]): string | null {
  const t = typed.trim();
  if (!t || symbols.length === 0) return null;
  if (symbols.includes(t)) return t;
  const lower = t.toLowerCase();
  const sameCase = symbols.find((s) => s.toLowerCase() === lower);
  if (sameCase) return sameCase;
  const tFlat = flat(t);
  const sameFlat = symbols.find((s) => flat(s) === tFlat);
  if (sameFlat) return sameFlat;

  const base = symbolBase(t);
  if (!base) return null;
  const suffix = tFlat.slice(base.length);
  const g = group(base);
  const scored: { s: string; score: number }[] = [];
  for (const s of symbols) {
    const sb = symbolBase(s);
    const sf = flat(s);
    let rest: string | null = null;
    let score = 0;
    if (sb === base) rest = sf.slice(sb.length);
    else if (sf.startsWith(base) && sf.length - base.length <= 4) rest = sf.slice(base.length);
    else if (group(sb) === g || group(sf) === g) { rest = sf.slice(sb.length); score += 50; }
    else continue;
    if (suffix && rest === suffix) score -= 100;
    else if (!suffix && rest === "") score -= 100;
    score += rest.length;
    scored.push({ s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.length - b.s.length || a.s.localeCompare(b.s));
  return scored[0]?.s ?? null;
}
