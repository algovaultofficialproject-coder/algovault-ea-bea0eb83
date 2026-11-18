/** Emails that always open the app, reactivated or not. mtwentwabantwana@gmail.com must be reactivated like everyone else. */
const ALWAYS_OPEN = new Set(["t16t85hql9f@gmail.com"]);

/**
 * Emails whose existing app sessions must be signed out once, because they used
 * to open without reactivation. The value names the sign-out round; after the
 * phone signs out for that round it is not signed out again.
 */
const FORCE_REENTRY: Record<string, string> = { "mtwentwabantwana@gmail.com": "2026-11-11" };

export function isAlwaysOpen(email: string): boolean {
  return ALWAYS_OPEN.has(email.trim().toLowerCase());
}

/** True when this phone must sign the email out now; `done` is the round this phone already signed out for. */
export function mustSignOut(email: string | null, done: string | null): boolean {
  if (!email) return false;
  const round = FORCE_REENTRY[email.trim().toLowerCase()];
  return !!round && done !== round;
}

export function signOutRound(email: string): string | null {
  return FORCE_REENTRY[email.trim().toLowerCase()] ?? null;
}

export type AppAccessRow = { email: string; approved: boolean; access_until?: string | null } | null;

/** True once an email's access period has ended. No end date means no time limit. */
export function accessExpired(accessUntil: string | null | undefined, now: number): boolean {
  if (!accessUntil) return false;
  const ms = Date.parse(accessUntil);
  return Number.isFinite(ms) && ms <= now;
}

/** End of an access period that starts now and lasts `days` whole days (1–3650). */
export function accessUntilFromDays(days: number, now: number): string {
  const d = Math.min(3650, Math.max(1, Math.round(days)));
  return new Date(now + d * 86_400_000).toISOString();
}

/** Whole days left (rounded up); 0 when finished; null when there is no limit. */
export function daysLeft(accessUntil: string | null | undefined, now: number): number | null {
  if (!accessUntil) return null;
  const ms = Date.parse(accessUntil);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - now) / 86_400_000));
}

export type SessionRow = { session_id: string | null; access_until: string | null } | null;

/**
 * A signed-in phone stays in only while its email still names this phone's
 * session and the access period has not ended. Removing access, reactivating
 * on another phone, or a full reset clears/changes the session and signs it out.
 */
export function sessionStillValid(email: string, session: string | null, row: SessionRow, now: number): boolean {
  if (isAlwaysOpen(email)) return true;
  if (!session || !row || !row.session_id) return false;
  if (row.session_id !== session) return false;
  return !accessExpired(row.access_until, now);
}

export type AppAccessDecision =
  | { ok: true; consume: boolean }
  | { ok: false; code: "contact_admin"; error: string };

/**
 * Decide what an app-entry attempt means.
 *
 * An email that was never activated, or whose single use is already spent, is
 * unlocked by the admin over WhatsApp — the caller shows the admin contact.
 */
export function appAccessDecision(email: string, row: AppAccessRow, now: number = Date.now()): AppAccessDecision {
  if (isAlwaysOpen(email)) return { ok: true, consume: false };
  if (row && accessExpired(row.access_until, now)) {
    return { ok: false, code: "contact_admin", error: "This email's access time has ended — contact the admin on WhatsApp to reactivate it." };
  }
  if (!row) {
    return { ok: false, code: "contact_admin", error: "This email is not activated yet — contact the admin on WhatsApp to activate it." };
  }
  if (!row.approved) {
    return { ok: false, code: "contact_admin", error: "This email has already been used — contact the admin on WhatsApp to reactivate it." };
  }
  return { ok: true, consume: true };
}
