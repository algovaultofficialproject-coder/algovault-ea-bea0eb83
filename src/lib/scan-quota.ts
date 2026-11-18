/** Pure daily Chart Scanner allowance per trading-app email (server enforces it). */
export const DEFAULT_DAILY_SCANS = 10;
const BOOSTED: Record<string, number> = { "t16t85hql9f@gmail.com": 45 };

export function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function scanLimitFor(email: string): number {
  return BOOSTED[normEmail(email)] ?? DEFAULT_DAILY_SCANS;
}

/** Scan day as YYYY-MM-DD in South Africa time, so the allowance resets at local midnight. */
export function scanDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
