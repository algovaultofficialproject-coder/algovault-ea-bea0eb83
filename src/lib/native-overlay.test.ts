import { describe, expect, it } from "vitest";
import { appEntryStep, buildOverlaySnapshot, OVERLAY_ENTRY_LIMIT, shouldFloat } from "@/lib/native-overlay";
import type { LogEntry } from "@/lib/trade-log";

const entry = (i: number): LogEntry => ({ id: `e${i}`, ts: 1000 + i, type: "info", text: `line ${i}` });
const ready = { native: true, permission: true, dismissed: false, botRunning: true };

describe("floating bot circle snapshot", () => {
  it("sends only the newest 150 lines, oldest first", () => {
    const snap = buildOverlaySnapshot(Array.from({ length: 200 }, (_, i) => entry(i)), true);
    expect(OVERLAY_ENTRY_LIMIT).toBe(150);
    expect(snap.entries).toHaveLength(150);
    expect(snap.entries[0].text).toBe("line 50");
    expect(snap.entries[149].text).toBe("line 199");
  });

  it("carries the bot name and symbols", () => {
    const snap = buildOverlaySnapshot([entry(1)], true, undefined, { name: "Gold Bot", symbols: ["XAUUSD"] });
    expect(snap.name).toBe("Gold Bot");
    expect(snap.symbols).toEqual(["XAUUSD"]);
  });
});

describe("when the bot circle floats over other apps", () => {
  it("floats while the bot is running", () => {
    expect(shouldFloat(ready)).toBe(true);
  });
  it("disappears when the bot is stopped", () => {
    expect(shouldFloat({ ...ready, botRunning: false })).toBe(false);
  });
  it("never floats without the Display over other apps permission", () => {
    expect(shouldFloat({ ...ready, permission: false })).toBe(false);
  });
  it("stays hidden after the user hides it from the notification", () => {
    expect(shouldFloat({ ...ready, dismissed: true })).toBe(false);
  });
});

describe("Android app entry", () => {
  const base = { checked: true, native: true, permission: false, signedIn: false };
  it("asks for Display over other apps before the mentor ID and email page", () => {
    expect(appEntryStep(base)).toBe("overlay");
  });
  it("keeps asking even after sign-in until it is allowed", () => {
    expect(appEntryStep({ ...base, signedIn: true })).toBe("overlay");
  });
  it("goes to sign-in once it is allowed", () => {
    expect(appEntryStep({ ...base, permission: true })).toBe("signin");
  });
  it("never asks on the website", () => {
    expect(appEntryStep({ ...base, native: false })).toBe("signin");
  });
  it("sends line ids so the floating log can type each new line once", () => {
    expect(buildOverlaySnapshot([entry(1)], true).entries[0].id).toBe("e1");
  });
});
