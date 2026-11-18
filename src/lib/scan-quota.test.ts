import { describe, expect, it } from "vitest";
import { scanDay, scanLimitFor } from "./scan-quota";

describe("chart scan daily allowance", () => {
  it("gives normal users 10 scans per day", () => {
    expect(scanLimitFor("someone@example.com")).toBe(10);
  });
  it("gives t16t85hql9f@gmail.com 45 scans per day, any letter case", () => {
    expect(scanLimitFor(" T16T85HQL9F@gmail.com ")).toBe(45);
  });
  it("resets at Johannesburg midnight", () => {
    expect(scanDay(new Date("2026-11-15T21:59:00Z"))).toBe("2026-11-15");
    expect(scanDay(new Date("2026-11-15T22:01:00Z"))).toBe("2026-11-16");
  });
});
