import type { Series } from "./indicators";
import type { Side } from "./types";

/**
 * Smart Money Concepts read of one chart, computed only from closed bars up to index i (no look-ahead).
 * Every field is derived from real candles; anything not present is left undefined rather than guessed.
 */
export type Bias = "bullish" | "bearish" | "neutral";
export interface Zone { top: number; bottom: number; bar: number; side: Side; label: string }
export interface StructureEvent { kind: "BOS" | "CHoCH"; dir: Side; level: number; bar: number }
export interface SmcRead {
  bias: Bias;
  event?: StructureEvent;
  /** The latest structure break happened within the last few closed bars. */
  freshEvent: boolean;
  rangeHigh?: number; rangeLow?: number;
  /** 0 = bottom of the dealing range, 1 = top. */
  rangePos: number;
  zone: "premium" | "discount" | "equilibrium";
  /** Price sits in the 62–79% optimal-trade-entry retracement for this side. */
  ote?: Side;
  bsl: number[]; ssl: number[];
  equalHighs?: number; equalLows?: number;
  /** side = direction the sweep points to (sell-side swept → BUY). */
  sweep?: { side: Side; level: number; bar: number; text: string };
  displacement?: { dir: Side; bar: number; bodyAtr: number };
  fvg?: Zone; ifvg?: Zone; orderBlock?: Zone; breaker?: Zone;
  /** Price is currently trading inside this side's order block or fair value gap. */
  inZone?: { side: Side; label: string };
  /** Nearest unswept minor swing between price and the entry zone — liquidity likely taken before the zone is reached. */
  inducement?: { side: Side; level: number; text: string };
  /** Unfilled fast, one-sided run of candles (thin traded area price often returns to). */
  liquidityVoid?: Zone;
  notes: string[];
}

const FRESH_BARS = 8;

/** Walks closed bars and records each close through the latest confirmed swing (BOS with trend, CHoCH against it). */
export function structureEvents(s: Series, i: number, lookback = 200): StructureEvent[] {
  const c = s.candles, r = s.pivotRight, ev: StructureEvent[] = [];
  let hi: { i: number; p: number } | undefined, lo: { i: number; p: number } | undefined;
  let state: Side | undefined, brokenH = -1, brokenL = -1;
  for (let j = Math.max(1, i - lookback); j <= i; j++) {
    const p = j - r;
    if (p >= 0 && s.pivotHigh[p]) hi = { i: p, p: c[p].h };
    if (p >= 0 && s.pivotLow[p]) lo = { i: p, p: c[p].l };
    if (hi && hi.i !== brokenH && c[j].c > hi.p) { ev.push({ kind: state === "SELL" ? "CHoCH" : "BOS", dir: "BUY", level: hi.p, bar: j }); state = "BUY"; brokenH = hi.i; }
    else if (lo && lo.i !== brokenL && c[j].c < lo.p) { ev.push({ kind: state === "BUY" ? "CHoCH" : "BOS", dir: "SELL", level: lo.p, bar: j }); state = "SELL"; brokenL = lo.i; }
  }
  return ev;
}

function swingsUpTo(s: Series, i: number, kind: "high" | "low", lookback = 200) {
  const out: { i: number; p: number }[] = [];
  const flags = kind === "high" ? s.pivotHigh : s.pivotLow;
  for (let j = Math.max(0, i - lookback); j <= i - s.pivotRight; j++) if (flags[j]) out.push({ i: j, p: kind === "high" ? s.candles[j].h : s.candles[j].l });
  return out;
}

export function readSmc(s: Series, i: number): SmcRead {
  const c = s.candles, bar = c[i], price = bar.c, atr = s.atr[i] || Math.abs(bar.h - bar.l) || 1e-9;
  const notes: string[] = [];
  const events = structureEvents(s, i);
  const event = events[events.length - 1];
  const bias: Bias = event ? (event.dir === "BUY" ? "bullish" : "bearish") : "neutral";
  const highs = swingsUpTo(s, i, "high"), lows = swingsUpTo(s, i, "low");

  // Dealing range from the last two swings each side → premium / discount / OTE.
  const rh = highs.length ? Math.max(...highs.slice(-2).map((x) => x.p)) : undefined;
  const rl = lows.length ? Math.min(...lows.slice(-2).map((x) => x.p)) : undefined;
  const rangePos = rh !== undefined && rl !== undefined && rh > rl ? Math.max(0, Math.min(1, (price - rl) / (rh - rl))) : 0.5;
  const zone = rangePos > 0.55 ? "premium" : rangePos < 0.45 ? "discount" : "equilibrium";
  const ote: Side | undefined = rangePos >= 0.21 && rangePos <= 0.38 ? "BUY" : rangePos >= 0.62 && rangePos <= 0.79 ? "SELL" : undefined;

  // Liquidity: unbroken swing highs above (buy-side) and swing lows below (sell-side).
  const closedAbove = (lvl: number, from: number) => { for (let j = from + 1; j <= i; j++) if (c[j].c > lvl) return true; return false; };
  const closedBelow = (lvl: number, from: number) => { for (let j = from + 1; j <= i; j++) if (c[j].c < lvl) return true; return false; };
  const bsl = highs.filter((x) => x.p > price && !closedAbove(x.p, x.i)).map((x) => x.p).sort((a, b) => a - b).slice(0, 3);
  const ssl = lows.filter((x) => x.p < price && !closedBelow(x.p, x.i)).map((x) => x.p).sort((a, b) => b - a).slice(0, 3);
  const eq = (xs: { p: number }[]) => { const t = xs.slice(-4); for (let a = t.length - 1; a > 0; a--) for (let b = a - 1; b >= 0; b--) if (Math.abs(t[a].p - t[b].p) <= atr * 0.1) return (t[a].p + t[b].p) / 2; return undefined; };
  const equalHighs = eq(highs), equalLows = eq(lows);

  // Liquidity sweep / stop hunt: a recent wick through a prior swing that closed back inside.
  let sweep: SmcRead["sweep"];
  for (let j = i; j > i - 5 && j > 0 && !sweep; j--) {
    const h = [...highs].reverse().find((x) => x.i + s.pivotRight < j && c[j].h > x.p && c[j].c < x.p);
    const l = [...lows].reverse().find((x) => x.i + s.pivotRight < j && c[j].l < x.p && c[j].c > x.p);
    if (l) sweep = { side: "BUY", level: l.p, bar: j, text: `Sell-side liquidity swept at ${l.p.toPrecision(6)} and reclaimed` };
    else if (h) sweep = { side: "SELL", level: h.p, bar: j, text: `Buy-side liquidity swept at ${h.p.toPrecision(6)} and rejected` };
  }

  // Displacement: a large, decisive body in the last few bars.
  let displacement: SmcRead["displacement"];
  for (let j = i; j > i - 6 && j > 0 && !displacement; j--) {
    const body = Math.abs(c[j].c - c[j].o), range = c[j].h - c[j].l, a = s.atr[j] || atr;
    if (body >= a * 1.5 && range > 0 && body / range >= 0.6) displacement = { dir: c[j].c > c[j].o ? "BUY" : "SELL", bar: j, bodyAtr: +(body / a).toFixed(2) };
  }

  // Fair value gaps; a gap closed through becomes an inverse FVG facing the other way.
  let fvg: Zone | undefined, ifvg: Zone | undefined;
  for (let j = Math.max(2, i - 60); j <= i; j++) {
    const bull = c[j].l > c[j - 2].h, bear = c[j].h < c[j - 2].l;
    if (!bull && !bear) continue;
    const z: Zone = bull ? { top: c[j].l, bottom: c[j - 2].h, bar: j, side: "BUY", label: "Bullish FVG" } : { top: c[j - 2].l, bottom: c[j].h, bar: j, side: "SELL", label: "Bearish FVG" };
    let inverted = false, filled = false;
    for (let k = j + 1; k <= i; k++) {
      if (z.side === "BUY" ? c[k].c < z.bottom : c[k].c > z.top) { inverted = true; break; }
      if (z.side === "BUY" ? c[k].l <= z.bottom : c[k].h >= z.top) filled = true;
    }
    if (inverted) ifvg = { ...z, side: z.side === "BUY" ? "SELL" : "BUY", label: z.side === "BUY" ? "Bearish IFVG" : "Bullish IFVG" };
    else if (!filled) fvg = z;
  }

  // Order block: last opposite candle before the move that broke structure; a violated block becomes a breaker.
  let orderBlock: Zone | undefined, breaker: Zone | undefined;
  if (event) {
    for (let j = event.bar - 1; j >= Math.max(0, event.bar - 12); j--) {
      const opp = event.dir === "BUY" ? c[j].c < c[j].o : c[j].c > c[j].o;
      if (!opp) continue;
      const z: Zone = { top: c[j].h, bottom: c[j].l, bar: j, side: event.dir, label: event.dir === "BUY" ? "Bullish order block" : "Bearish order block" };
      let broken = false, touched = false;
      for (let k = event.bar + 1; k <= i; k++) {
        if (event.dir === "BUY" ? c[k].c < z.bottom : c[k].c > z.top) { broken = true; break; }
        if (c[k].l <= z.top && c[k].h >= z.bottom) touched = true;
      }
      if (broken) breaker = { ...z, side: event.dir === "BUY" ? "SELL" : "BUY", label: event.dir === "BUY" ? "Bearish breaker" : "Bullish breaker" };
      else orderBlock = { ...z, label: touched ? `${z.label} (mitigated)` : z.label };
      break;
    }
  }

  const inside = (z?: Zone) => !!z && price <= z.top + atr * 0.1 && price >= z.bottom - atr * 0.1;
  const inZone = inside(orderBlock) ? { side: orderBlock!.side, label: orderBlock!.label } : inside(fvg) ? { side: fvg!.side, label: fvg!.label } : inside(breaker) ? { side: breaker!.side, label: breaker!.label } : undefined;

  // Inducement: for a bullish read, the nearest minor swing low above the order block / FVG that price has not taken yet (mirror for bearish).
  let inducement: SmcRead["inducement"];
  const zoneFor = (side: Side) => [orderBlock, fvg].find((z) => z && z.side === side);
  if (bias !== "neutral") {
    const side: Side = bias === "bullish" ? "BUY" : "SELL", z = zoneFor(side);
    if (z) {
      const from = event ? event.bar - s.pivotRight : 0;
      const cand = side === "BUY"
        ? lows.filter((x) => x.i >= from && x.p > z.top && x.p < price && !closedBelow(x.p, x.i)).sort((a, b) => b.p - a.p)[0]
        : highs.filter((x) => x.i >= from && x.p < z.bottom && x.p > price && !closedAbove(x.p, x.i)).sort((a, b) => a.p - b.p)[0];
      if (cand) inducement = { side, level: cand.p, text: `Inducement ${side === "BUY" ? "low" : "high"} at ${cand.p.toPrecision(6)} sits before the ${z.label.toLowerCase()}` };
    }
  }

  // Liquidity void: ≥3 consecutive strong same-direction candles covering ≥2.5 ATR, not yet traded back through its midpoint.
  let liquidityVoid: Zone | undefined;
  for (let j = Math.max(3, i - 40); j <= i; j++) {
    let n = 0; const dir = Math.sign(c[j].c - c[j].o);
    while (n < 8 && j - n >= 0 && Math.sign(c[j - n].c - c[j - n].o) === dir && dir !== 0 && Math.abs(c[j - n].c - c[j - n].o) >= (c[j - n].h - c[j - n].l) * 0.6) n++;
    if (n < 3) continue;
    const start = c[j - n + 1].o, end = c[j].c, a = s.atr[j] || atr;
    if (Math.abs(end - start) < a * 2.5) continue;
    const mid = (start + end) / 2;
    let filled = false;
    for (let k = j + 1; k <= i; k++) if (dir > 0 ? c[k].l <= mid : c[k].h >= mid) { filled = true; break; }
    if (!filled) liquidityVoid = { top: Math.max(start, end), bottom: Math.min(start, end), bar: j, side: dir > 0 ? "BUY" : "SELL", label: dir > 0 ? "Bullish liquidity void" : "Bearish liquidity void" };
  }
  if (inducement) notes.push(inducement.text);
  if (liquidityVoid) notes.push(`${liquidityVoid.label} ${liquidityVoid.bottom.toPrecision(6)}–${liquidityVoid.top.toPrecision(6)}`);
  if (equalHighs) notes.push("Equal highs (resting buy-side liquidity)");
  if (equalLows) notes.push("Equal lows (resting sell-side liquidity)");
  return {
    bias, event, freshEvent: !!event && i - event.bar < FRESH_BARS, rangeHigh: rh, rangeLow: rl, rangePos, zone, ote,
    bsl, ssl, equalHighs, equalLows, sweep, displacement, fvg, ifvg, orderBlock, breaker, inZone, inducement, liquidityVoid, notes,
  };
}
