import { describe, expect, it } from "vitest";
import { buildSeries } from "./indicators";
import { BOOK, trendBias } from "./strategy-book";
import { SCAN_BOOK, ROLE_ORDER, roleOf } from "./strategy-policy";
import { STRATEGIES, strategyById } from "./strategies";
import type { Candle, MarketRead } from "./types";

const ctx = { sessionOk: true, maxSpreadAtr: 0.3 };
const m = { trend: "neutral", volatility: "normal" } as unknown as MarketRead;
/** Deterministic trending walk with pullbacks. */
function walk(n: number, drift: number): Candle[] {
  const out: Candle[] = []; let p = 100, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let k = 0; k < n; k++) {
    const o = p; p = p + drift + rnd() * 0.6 + Math.sin(k / 9) * 0.15;
    out.push({ t: k * 300_000, o, h: Math.max(o, p) + Math.abs(rnd()) * 0.3, l: Math.min(o, p) - Math.abs(rnd()) * 0.3, c: p, v: 100 });
  }
  return out;
}

describe("220-strategy book", () => {
  it("has exactly 220 strategies with unique ids, 10 in each of 22 families", () => {
    expect(BOOK.length).toBe(220);
    expect(new Set(BOOK.map((d) => d.id)).size).toBe(220);
    expect(BOOK.filter((d) => d.mode === "range").length).toBe(40);
    expect(BOOK.filter((d) => d.mode === "transition").length).toBe(50);
    for (const f of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V"]) expect(BOOK.filter((d) => d.letter.replace(/\d+$/, "") === f).length).toBe(10);
    expect(STRATEGIES).toBe(BOOK);
  });

  it("every older strategy is erased", () => {
    for (const id of ["trend", "pullback", "volatility", "macdturn", "squeezego", "stochhook"]) expect(strategyById(id).name).toBe("Retired strategy");
  });

  it("scans only 1m, 5m and 15m; only range and transition strategies may trade against the old trend", () => {
    expect(BOOK.every((d) => (d.frames ?? []).length > 0 && d.frames!.every((f) => ["1m", "5m", "15m"].includes(f)) && d.reversal === (d.mode !== "trend"))).toBe(true);
  });

  it("range breakout fires in the breakout direction after a tight box, with the stop inside the box", () => {
    for (const dir of [1, -1]) {
      const out: Candle[] = []; let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
      for (let k = 0; k < 300; k++) { const o = k ? out[k - 1].c : 100, c = 100 + rnd() * 0.6; out.push({ t: k, o, h: Math.max(o, c) + 0.2, l: Math.min(o, c) - 0.2, c, v: 1 }); }
      const o = out[299].c, c = dir > 0 ? Math.max(...out.slice(-12).map((x) => x.h)) + 0.25 : Math.min(...out.slice(-12).map((x) => x.l)) - 0.25;
      out.push({ t: 300, o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, c, v: 1 });
      const s = buildSeries(out);
      const hits = BOOK.filter((d) => d.id.startsWith("rb")).map((d) => d.evaluate(s, 300, d.defaults, m, ctx).candidate).filter(Boolean);
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) { expect(h!.side).toBe(dir > 0 ? "BUY" : "SELL"); expect((h!.entry - h!.structuralStop) * dir).toBeGreaterThan(0); }
    }
  });

  it("breakout pressure buys under a tested ceiling with rising lows, stop under the last higher low", () => {
    const out: Candle[] = [];
    for (let k = 0; k < 280; k++) { const c = 100 + (k % 2 ? 0.4 : -0.4); out.push({ t: k, o: 100, h: Math.max(100, c) + 0.2, l: Math.min(100, c) - 0.2, c, v: 1 }); }
    // last 6 candles: lows rising into a 100.6 ceiling that keeps getting tested
    for (const [l, c] of [[99.4, 100.2], [99.6, 100.35], [99.75, 100.4], [99.9, 100.45], [100.05, 100.5], [100.2, 100.55]]) out.push({ t: out.length, o: l + 0.1, h: 100.6, l, c, v: 1 });
    const s = buildSeries(out), i = out.length - 1;
    const hits = BOOK.filter((d) => d.id.startsWith("pp")).map((d) => d.evaluate(s, i, d.defaults, m, ctx).candidate).filter(Boolean);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) { expect(h!.side).toBe("BUY"); expect(h!.structuralStop).toBeLessThan(h!.entry); expect(h!.structuralTarget!).toBeGreaterThan(100.6); }
  });

  it("momentum candle break fires on a wide full-bodied close through the high, stop at or below the broken level", () => {
    const out: Candle[] = []; let seed = 9;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let k = 0; k < 300; k++) { const o = k ? out[k - 1].c : 100, c = 100 + rnd() * 0.5; out.push({ t: k, o, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, c, v: 1 }); }
    const top = Math.max(...out.slice(-10).map((x) => x.h)), o = out[299].c, c = top + 0.3;
    out.push({ t: 300, o, h: c + 0.02, l: o - 0.02, c, v: 1 });
    const s = buildSeries(out);
    const hits = BOOK.filter((d) => d.id.startsWith("mc")).map((d) => d.evaluate(s, 300, d.defaults, m, ctx).candidate).filter(Boolean);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) { expect(h!.side).toBe("BUY"); expect(h!.structuralStop).toBeLessThanOrEqual(top); }
  });

  it("micro range scalps buy the floor and sell the ceiling of a tight box", () => {
    const out: Candle[] = []; let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let k = 0; k < 600; k++) { const o = k ? out[k - 1].c : 100, c = 100 + Math.sin(k / 3) * 0.5 + rnd() * 0.2; out.push({ t: k, o, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, c, v: 1 }); }
    const s = buildSeries(out), sides = new Set<string>();
    for (let i = 200; i < 600; i++) for (const d of BOOK.filter((x) => x.id.startsWith("mr"))) {
      const c = d.evaluate(s, i, d.defaults, m, ctx).candidate;
      if (!c) continue;
      sides.add(c.side);
      expect(c.side === "BUY" ? c.structuralStop < c.entry && c.structuralTarget! > c.entry : c.structuralStop > c.entry && c.structuralTarget! < c.entry).toBe(true);
    }
    expect([...sides].sort()).toEqual(["BUY", "SELL"]);
  });

  it("range strategies stand aside in a clean, strong trend", () => {
    const s = buildSeries(walk(500, 0.25));
    let fired = 0;
    for (let i = 200; i < 500; i++) for (const d of BOOK.filter((x) => x.mode === "range")) {
      if (trendBias(s, i, 50) && s.adx[i] >= 25 && d.evaluate(s, i, d.defaults, m, ctx).candidate) fired++;
    }
    expect(fired).toBe(0);
  });

  it("range strategies trade both ways in a sideways market with the stop on the protective side", () => {
    const out: Candle[] = []; let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let k = 0; k < 600; k++) { const o = k ? out[k - 1].c : 100, c = 100 + Math.sin(k / 15) * 0.8 + rnd() * 1.0; out.push({ t: k, o, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 0.3, c, v: 1 }); }
    const s = buildSeries(out), sides = new Set<string>();
    for (let i = 200; i < 600; i++) for (const d of BOOK.filter((x) => x.mode === "range")) {
      const c = d.evaluate(s, i, d.defaults, m, ctx).candidate;
      if (!c) continue;
      sides.add(c.side);
      expect(c.side === "BUY" ? c.structuralStop < c.entry : c.structuralStop > c.entry).toBe(true);
    }
    expect([...sides].sort()).toEqual(["BUY", "SELL"]);
  });

  it("only signals BUY in an uptrend and SELL in a downtrend, with the stop on the protective side", () => {
    for (const [drift, side] of [[0.12, "BUY"], [-0.12, "SELL"]] as const) {
      const s = buildSeries(walk(500, drift));
      let seen = 0;
      for (let i = 200; i < 500; i++) {
        for (const d of BOOK.filter((x) => x.mode === "trend")) {
          const c = d.evaluate(s, i, d.defaults, m, ctx).candidate;
          if (!c) continue;
          seen++;
          expect(c.side).toBe(trendBias(s, i, d.id.startsWith("ls") ? 100 : 50) > 0 ? "BUY" : "SELL");
          expect(side === "BUY" ? c.structuralStop < c.entry : c.structuralStop > c.entry).toBe(true);
        }
      }
      expect(seen).toBeGreaterThan(20);
    }
  });

  it("stands aside when there is no trend", () => {
    const flat: Candle[] = Array.from({ length: 300 }, (_, k) => ({ t: k, o: 100, h: 100.2, l: 99.8, c: 100 + (k % 2 ? 0.05 : -0.05), v: 1 }));
    const s = buildSeries(flat);
    expect(BOOK.filter((d) => d.mode === "trend").every((d) => !d.evaluate(s, 299, d.defaults, m, ctx).candidate)).toBe(true);
  });

  it("scans structure first, then breakouts, then pullback entries", () => {
    const ranks = SCAN_BOOK.map((d) => ROLE_ORDER.indexOf(roleOf(d)));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(SCAN_BOOK.length).toBe(220);
  });
  it("smart money buys the first rejected retest of a fair-value gap left by a structure-breaking displacement", () => {
    const out: Candle[] = [];
    for (let k = 0; k < 300; k++) { const o = 100 + k * 0.05, c = o + (k % 3 === 2 ? -0.1 : 0.12); out.push({ t: k, o, h: Math.max(o, c) + 0.08, l: Math.min(o, c) - 0.08, c, v: 1 }); }
    const b = out[299].c, top = Math.max(...out.slice(-20).map((x) => x.h));
    out.push({ t: 300, o: b, h: top + 0.9, l: b - 0.02, c: top + 0.85, v: 1 }); // displacement through structure
    const gapBot = out[299].h, gapTop = gapBot + 0.4;
    out.push({ t: 301, o: top + 0.85, h: top + 1.0, l: gapTop, c: top + 0.9, v: 1 }); // leaves a gap above out[299].h
    out.push({ t: 302, o: top + 0.9, h: top + 0.95, l: gapTop + 0.1, c: top + 0.6, v: 1 });
    out.push({ t: 303, o: gapTop + 0.1, h: gapTop + 0.45, l: gapTop - 0.15, c: gapTop + 0.42, v: 1 }); // taps the gap, closes strong
    const s = buildSeries(out), i = out.length - 1;
    const hits = BOOK.filter((d) => d.id.startsWith("sm")).map((d) => d.evaluate(s, i, d.defaults, m, ctx)).filter((r) => r.candidate);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) { expect(h.candidate!.side).toBe("BUY"); expect(h.candidate!.structuralStop).toBeLessThan(gapBot); }
  });

  it("blocks trend and breakout signals whose candle shows a long opposing rejection wick", () => {
    const s = buildSeries(walk(500, 0.12));
    for (let i = 200; i < 500; i++) {
      const k = s.candles[i], r = k.h - k.l, up = r > 0 ? (k.h - Math.max(k.o, k.c)) / r : 0;
      if (up < 0.5) continue;
      for (const d of BOOK.filter((x) => x.mode !== "range")) expect(d.evaluate(s, i, d.defaults, m, ctx).candidate?.side).not.toBe("BUY");
    }
  });
});
