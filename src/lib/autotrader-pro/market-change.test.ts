import { describe, expect, it } from "vitest";
import { buildSeries } from "./indicators";
import { adaptScore } from "./engine";
import { correlation, rawRegime, readChop, readMarketChange, readSqueeze, readVolume, sessionsAt, smoothRegimes, type Adaptation, type V3Regime } from "./market-change";
import type { Candle } from "./types";

const bars = (closes: number[], v = 100, spread = 0.2): Candle[] =>
  closes.map((c, k) => ({ t: k * 60_000, o: k ? closes[k - 1] : c, h: Math.max(c, k ? closes[k - 1] : c) + spread, l: Math.min(c, k ? closes[k - 1] : c) - spread, c, v }));
const trend = (n: number, step: number) => Array.from({ length: n }, (_, k) => 100 + k * step + Math.sin(k / 3) * Math.abs(step) * 2);

describe("regime hysteresis", () => {
  it("ignores a one- or two-bar flicker", () => {
    const raw: V3Regime[] = [...Array(10).fill("ranging"), "strong_bull", "ranging", "strong_bull", "strong_bull", "ranging", ...Array(5).fill("ranging")];
    expect(smoothRegimes(raw, { confirmBars: 3, minHoldBars: 5 }).current).toBe("ranging");
  });
  it("switches once the new regime repeats for the confirm bars", () => {
    const raw: V3Regime[] = [...Array(10).fill("ranging"), ...Array(4).fill("strong_bull")];
    const r = smoothRegimes(raw, { confirmBars: 3, minHoldBars: 5 });
    expect(r.current).toBe("strong_bull");
    expect(r.previous).toBe("ranging");
  });
  it("does not switch before the minimum hold", () => {
    const raw: V3Regime[] = ["ranging", "ranging", "weak_bull", "weak_bull", "weak_bull"];
    expect(smoothRegimes(raw, { confirmBars: 3, minHoldBars: 5 }).current).toBe("ranging");
  });
});

describe("market reads from real candles", () => {
  it("classifies a steady rise as a bullish trend and a fall as bearish", () => {
    const up = buildSeries(bars(trend(300, 0.5)));
    const dn = buildSeries(bars(trend(300, -0.5)));
    expect(["strong_bull", "weak_bull"]).toContain(rawRegime(up, 299));
    expect(["strong_bear", "weak_bear"]).toContain(rawRegime(dn, 299));
  });
  it("scores a whipsawing market as choppy", () => {
    const zig = Array.from({ length: 200 }, (_, k) => 100 + (k % 4 < 2 ? 1 : -1) * 1.5 + Math.sin(k) * 0.3);
    const b = bars(zig, 100, 1).map((x, k) => ({ ...x, h: k % 7 === 0 ? x.h + 2.5 : x.h, l: k % 11 === 0 ? x.l - 2.5 : x.l }));
    const r = readChop(buildSeries(b), 199);
    expect(r.choppy).toBe(true);
  });
  it("detects a volatility squeeze after a quiet coil", () => {
    const loud = Array.from({ length: 200 }, (_, k) => 100 + Math.sin(k / 2) * 5);
    const quiet = Array.from({ length: 30 }, (_, k) => 100 + Math.sin(k) * 0.05);
    expect(readSqueeze(buildSeries(bars([...loud, ...quiet], 100, 0.02)), 229).state).toBe("squeeze");
  });
  it("never fabricates volume when the feed has none", () => {
    expect(readVolume(buildSeries(bars(trend(200, 0.2), 0)), 199).available).toBe(false);
  });
  it("keeps the market change score within 0–100", () => {
    const r = readMarketChange(buildSeries(bars(trend(300, 0.3))), 299, "15m");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
  it("measures correlation on aligned bars", () => {
    const a = bars(trend(200, 0.3)), b = a.map((x) => ({ ...x, c: x.c * 2 }));
    expect(correlation(a, b)?.now).toBeGreaterThan(0.99);
  });
});

describe("sessions follow daylight saving", () => {
  it("London opens 07:00 UTC in summer and 08:00 UTC in winter", () => {
    expect(sessionsAt(Date.UTC(2026, 6, 15, 7, 30))).toContain("London");
    expect(sessionsAt(Date.UTC(2026, 0, 15, 7, 30))).not.toContain("London");
  });
  it("New York opens 12:00 UTC in summer, 13:00 UTC in winter", () => {
    expect(sessionsAt(Date.UTC(2026, 6, 15, 12, 30))).toContain("New York");
    expect(sessionsAt(Date.UTC(2026, 0, 15, 12, 30))).not.toContain("New York");
  });
});

describe("adaptive switching", () => {
  const chop: Adaptation = { group: "choppy", preferred: ["range"], demoteTrend: true, riskScale: 0.5, avoidSide: "BUY", note: "Unstable / choppy → x" };
  it("demotes trend-following by 10 in choppy markets and blocks repeating the failed direction", () => {
    const r = adaptScore(60, "pb1", "BUY", false, chop);
    expect(r.score).toBe(50);
    expect(r.missing.length).toBe(2);
  });
  it("boosts preferred strategies by 6", () => {
    expect(adaptScore(60, "range", "SELL", false, chop).score).toBe(66);
  });
});
