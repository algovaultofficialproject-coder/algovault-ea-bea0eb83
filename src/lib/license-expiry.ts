const DAY = 24 * 60 * 60 * 1000;

/**
 * When a licence ends, counted from activation. Accepts "30 DAYS", "3 MONTHS",
 * "1 YEAR", "Lifetime"/"∞ LIFETIME". Returns null for lifetime or unknown durations.
 */
export function licenseExpiresAt(duration: string, startMs: number): number | null {
  const d = duration.trim().toUpperCase();
  if (!d || d.includes("LIFETIME") || d.includes("∞")) return null;
  const m = d.match(/^(\d+)\s*(DAY|WEEK|MONTH|YEAR)S?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  if (m[2] === "DAY") return startMs + n * DAY;
  if (m[2] === "WEEK") return startMs + n * 7 * DAY;
  const end = new Date(startMs);
  if (m[2] === "MONTH") end.setMonth(end.getMonth() + n);
  else end.setFullYear(end.getFullYear() + n);
  return end.getTime();
}

/** Ids of licensed bots whose licence has run out (expiresAt null/undefined never expires). */
export function expiredBotIds(eas: { id: string; expiresAt?: number | null }[], now: number): string[] {
  return eas.filter((e) => typeof e.expiresAt === "number" && e.expiresAt <= now).map((e) => e.id);
}
