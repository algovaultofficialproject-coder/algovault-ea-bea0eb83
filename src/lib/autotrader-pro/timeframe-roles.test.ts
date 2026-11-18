import { describe, expect, it } from "vitest";
import { momentumQuality, readDirectionChange, type MomentumRead } from "./momentum";

const r = (interval: "1m" | "5m" | "15m", dir: -1 | 0 | 1, extra: Partial<MomentumRead> = {}): MomentumRead =>
  ({ interval, dir, strength: 60, phase: "strong", text: "", ...extra });

describe("1m + 5m direction change", () => {
  it("1m and 5m SELL against a fading 15m BUY is a confirmed change to SELL", () => {
    const c = readDirectionChange([r("1m", -1), r("5m", -1), r("15m", 1, { phase: "fading" })]);
    expect(c).toMatchObject({ toward: "SELL", stage: "confirmed" });
  });
  it("against a strong 15m trend the change is only early", () => {
    expect(readDirectionChange([r("1m", -1), r("5m", -1), r("15m", 1)])?.stage).toBe("early");
  });
  it("no change when all three charts agree", () => {
    expect(readDirectionChange([r("1m", 1), r("5m", 1), r("15m", 1)])).toBeUndefined();
  });
  it("a BUY against a confirmed change to SELL waits (grade C)", () => {
    expect(momentumQuality("BUY", [r("1m", -1), r("5m", -1), r("15m", 1, { phase: "fading" })]).grade).toBe("C");
  });
  it("a SELL with the confirmed change is lifted to A", () => {
    expect(momentumQuality("SELL", [r("1m", -1), r("5m", -1), r("15m", 1, { phase: "fading" })]).grade).toBe("A");
  });
  it("an early change against the signal steps the grade down one level", () => {
    expect(momentumQuality("BUY", [r("1m", -1), r("5m", -1), r("15m", 1)]).grade).toBe("C");
  });
});
