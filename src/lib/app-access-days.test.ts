import { describe, expect, it } from "vitest";
import { accessExpired, accessUntilFromDays, appAccessDecision, daysLeft, sessionStillValid } from "./app-access";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const DAY = 86_400_000;

describe("access days", () => {
  it("30 days of access ends exactly 30 days from now", () => {
    expect(accessUntilFromDays(30, NOW)).toBe(new Date(NOW + 30 * DAY).toISOString());
  });
  it("access has ended once the end date passes", () => {
    expect(accessExpired(new Date(NOW - 1).toISOString(), NOW)).toBe(true);
    expect(accessExpired(new Date(NOW + DAY).toISOString(), NOW)).toBe(false);
    expect(accessExpired(null, NOW)).toBe(false);
  });
  it("counts days left rounded up", () => {
    expect(daysLeft(new Date(NOW + 2.5 * DAY).toISOString(), NOW)).toBe(3);
    expect(daysLeft(new Date(NOW - DAY).toISOString(), NOW)).toBe(0);
  });
  it("an expired email cannot sign in even if approved", () => {
    const d = appAccessDecision("a@b.com", { email: "a@b.com", approved: true, access_until: new Date(NOW - 1).toISOString() }, NOW);
    expect(d.ok).toBe(false);
  });
});

describe("phone session", () => {
  const until = new Date(NOW + DAY).toISOString();
  it("stays in while the session matches and days remain", () => {
    expect(sessionStillValid("a@b.com", "s1", { session_id: "s1", access_until: until }, NOW)).toBe(true);
  });
  it("is signed out when the owner removes the phone", () => {
    expect(sessionStillValid("a@b.com", "s1", { session_id: null, access_until: until }, NOW)).toBe(false);
    expect(sessionStillValid("a@b.com", "s1", null, NOW)).toBe(false);
  });
  it("is signed out when the email signs in on another phone", () => {
    expect(sessionStillValid("a@b.com", "s1", { session_id: "s2", access_until: until }, NOW)).toBe(false);
  });
  it("is signed out when the access days end", () => {
    expect(sessionStillValid("a@b.com", "s1", { session_id: "s1", access_until: new Date(NOW - 1).toISOString() }, NOW)).toBe(false);
  });
  it("a phone with no saved session is signed out (fresh start)", () => {
    expect(sessionStillValid("a@b.com", null, { session_id: "s1", access_until: until }, NOW)).toBe(false);
  });
});
