import { describe, expect, it } from "vitest";
import { CHECKLIST_ITEMS, normalizeChecklist, textSizePx } from "./trading-prefs";

describe("text size", () => {
  it("maps Small/Normal/Large to 14/16/18px", () => {
    expect([textSizePx("small"), textSizePx("normal"), textSizePx("large")]).toEqual([14, 16, 18]);
  });
  it("falls back to Normal for unknown values", () => {
    expect(textSizePx("huge")).toBe(16);
  });
});

describe("pre-trade checklist", () => {
  it("has five items and starts unticked", () => {
    expect(normalizeChecklist(null)).toEqual([false, false, false, false, false]);
    expect(CHECKLIST_ITEMS).toHaveLength(5);
  });
  it("keeps saved ticks and only accepts true", () => {
    expect(normalizeChecklist([true, "yes", true])).toEqual([true, false, true, false, false]);
  });
});
