import { describe, expect, it } from "vitest";
import { durationName, keyStats, type KeyRecord } from "./key-stats";

const now = new Date(2026, 10, 15, 12).getTime();
const k = (daysAgo: number, extra: Partial<KeyRecord> = {}): KeyRecord => ({
  key: `K${daysAgo}`, userName: "Sam", ea: "Scalper", duration: "30 DAYS", active: true,
  createdAt: now - daysAgo * 86_400_000, ...extra,
});

describe("key stats", () => {
  it("counts totals, active keys and the last 7 days", () => {
    const s = keyStats([k(0), k(2, { active: false }), k(10, { userName: "Lee" })], now);
    expect(s.total).toBe(3);
    expect(s.active).toBe(2);
    expect(s.today).toBe(1);
    expect(s.last7).toBe(2);
    expect(s.thisMonth).toBe(3);
    expect(s.clients).toBe(2);
  });
  it("names durations plainly", () => {
    expect(durationName("∞ LIFETIME")).toBe("Lifetime");
    expect(durationName("3 MONTHS")).toBe("3 Months");
  });
});
