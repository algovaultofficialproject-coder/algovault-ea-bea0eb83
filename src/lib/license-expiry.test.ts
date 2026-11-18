import { describe, expect, it } from "vitest";
import { expiredBotIds, licenseExpiresAt } from "./license-expiry";

const start = Date.UTC(2026, 0, 1);
const DAY = 86400000;

describe("licence expiry", () => {
  it("a 30 day key ends 30 days after activation", () => {
    expect(licenseExpiresAt("30 DAYS", start)).toBe(start + 30 * DAY);
  });
  it("a 3 day key ends 3 days after activation", () => {
    expect(licenseExpiresAt("3 DAYS", start)).toBe(start + 3 * DAY);
  });
  it("a 1 year key ends one year later", () => {
    expect(licenseExpiresAt("1 YEAR", start)).toBe(Date.UTC(2027, 0, 1));
  });
  it("lifetime keys never expire", () => {
    expect(licenseExpiresAt("∞ LIFETIME", start)).toBeNull();
  });
  it("only bots past their end date are removed", () => {
    const eas = [{ id: "a", expiresAt: start }, { id: "b", expiresAt: start + DAY }, { id: "c", expiresAt: null }, { id: "d" }];
    expect(expiredBotIds(eas, start)).toEqual(["a"]);
  });
});
