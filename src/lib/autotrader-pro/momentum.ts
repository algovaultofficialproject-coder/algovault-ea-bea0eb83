/**
 * Pure momentum reader: how strong the current push is (per closed-candle series) and how likely the
 * next momentum shift is. Used to grade AutoTrader Pro signals (A+/A/B/C); it never places orders itself.
 */
import type { Series } from "./indicators";
import { readDivergence, readExhaustion, readSqueeze } from "./market-change";
import type { Interval, Side } from "./types";

export type MomentumPhase = "building" | "strong" | "fading" | "flat";
export type QualityGrade = "A+" | "A" | "B" | "C";
/** The weakest grade: it still trades (no WAIT), with lower confidence. */
export const FAILING_GRADE: QualityGrade = "C";
export const GRADE_RANK: Record<QualityGrade, number> = { "A+": 3, A: 2, B: 1, C: 0 };

export interface MomentumShift { toward: Side; probability: number; evidence: string[] }
export interface MomentumRead {
  interval?: Interval;
  /** -1 bearish, 0 none, 1 bullish */
  dir: -1 | 0 | 1;
  /** 0–100 */
  strength: number;
  phase: MomentumPhase;
  /** Likely next momentum shift (probability 30–95), if any. */
  shift?: MomentumShift;
  text: string;
  /** True when the closed candle had too little data to read; such frames never count for or against a grade. */
  noData?: boolean;
  /** Set when this closed candle started a new push (the previous closed candle read differently). */
  turn?: Side;
}

/** Each chart has one job: 15m sets the trend, 5m confirms structure and direction changes, 1m spots the first turn and times entries. */
export const TIMEFRAME_ROLE: Record<"1m" | "5m" | "15m", string> = { "15m": "trend", "5m": "change", "1m": "timing" };

const ok = (...n: number[]) => n.every((x) => Number.isFinite(x));
const sideOf = (d: number): Side => (d > 0 ? "BUY" : "SELL");
const word = (d: number) => (d > 0 ? "bullish" : d < 0 ? "bearish" : "no");

/** Pure: signed momentum score −100…100 on candle i, or NaN when unreadable. */
function scoreAt(s: Series, i: number): number {
  const a = s.atr[i];
  if (i < 30 || !(a > 0) || !ok(s.closes[i], s.closes[i - 5], s.macdHist[i], s.macdHist[i - 3], s.rsi[i])) return NaN;
  const roc = (s.closes[i] - s.closes[i - 5]) / a;
  const hist = s.macdHist[i] / a;
  const rsiBias = (s.rsi[i] - 50) / 50;
  const diSum = (s.diPlus[i] || 0) + (s.diMinus[i] || 0);
  const di = diSum > 0 ? ((s.diPlus[i] || 0) - (s.diMinus[i] || 0)) / diSum : 0;
  let bodies = 0;
  for (let j = i - 2; j <= i; j++) bodies += (s.candles[j].c - s.candles[j].o) / a;
  const raw = 0.3 * Math.tanh(roc / 2) + 0.25 * Math.tanh(hist * 4) + 0.2 * rsiBias * 2 + 0.15 * di + 0.1 * Math.tanh(bodies / 1.5);
  return Math.max(-100, Math.min(100, raw * 100));
}

const dirOf = (score: number): -1 | 0 | 1 => (!Number.isFinite(score) || Math.abs(score) < 15 ? 0 : score > 0 ? 1 : -1);

/** Pure: current momentum (ROC, MACD histogram, RSI, DI spread, candle bodies in ATR units), a fresh turn on this candle, and next-shift risk. */
export function readMomentum(s: Series, i: number, interval?: Interval): MomentumRead {
  const role = interval && interval in TIMEFRAME_ROLE ? ` ${TIMEFRAME_ROLE[interval as keyof typeof TIMEFRAME_ROLE]}` : "";
  const tf = interval ? `${interval}${role} ` : "";
  const score = scoreAt(s, i);
  if (!Number.isFinite(score)) return { interval, dir: 0, strength: 0, phase: "flat", noData: true, text: `${tf}momentum: not enough data` };
  const histSlope = (s.macdHist[i] - s.macdHist[i - 3]) / s.atr[i];
  const dir = dirOf(score);
  const turn = dir !== 0 && dirOf(scoreAt(s, i - 1)) !== dir ? sideOf(dir) : undefined;
  const strength = Math.round(Math.abs(score));
  const shrinking = dir !== 0 && Math.sign(histSlope) === -dir && Math.abs(s.macdHist[i]) < Math.abs(s.macdHist[i - 3]);
  const phase: MomentumPhase = dir === 0 ? "flat" : shrinking ? "fading" : strength >= 55 ? "strong" : "building";

  // ---- Next momentum shift ----
  const evidence: string[] = [];
  let p = 0;
  let toward: Side | undefined;
  if (dir !== 0) {
    toward = sideOf(-dir);
    if (phase === "fading") { p += 25; evidence.push("MACD histogram shrinking 3 bars"); }
    const crossed = Math.sign(s.macdHist[i]) === -dir || (ok(s.macdHist[i - 1]) && Math.sign(s.macdHist[i - 1]) === -dir);
    if (crossed) { p += 20; evidence.push("MACD histogram crossed zero against the push"); }
    const div = readDivergence(s, i).find((d) => d.kind === "regular" && d.side === toward);
    if (div) { p += 25; evidence.push(div.text); }
    const ex = readExhaustion(s, i);
    if (ex.stage && ex.trend === dir) {
      p += ex.stage === "confirmed" ? 30 : ex.stage === "possible" ? 20 : 10;
      evidence.push(`Trend exhaustion: ${ex.stage}`);
    }
    const rsiTurn = ok(s.rsi[i - 1]) && (dir > 0 ? s.rsi[i] > 70 && s.rsi[i] < s.rsi[i - 1] : s.rsi[i] < 30 && s.rsi[i] > s.rsi[i - 1]);
    if (rsiTurn) { p += 15; evidence.push(`RSI ${Math.round(s.rsi[i])} turning from ${dir > 0 ? "overbought" : "oversold"}`); }
  } else {
    const sq = readSqueeze(s, i);
    if (sq.state !== "normal" && sq.dir) {
      toward = sq.dir;
      p += sq.state === "squeeze" ? 40 : 30;
      if (sq.confirmed) p += 20;
      evidence.push(sq.state === "squeeze" ? "Volatility squeeze — expansion building" : "Range expanding out of compression");
    } else if (Math.abs(histSlope) > 0.05) {
      toward = sideOf(histSlope);
      p += 30;
      evidence.push("MACD histogram turning while price is flat");
    }
  }
  const prob = Math.min(95, p);
  const shift = toward && prob >= 30 ? { toward, probability: prob, evidence } : undefined;
  const text = `${tf}momentum ${word(dir)} ${strength}/100 (${phase})${turn ? ` · just turned ${turn}` : ""}${shift ? ` · next shift ${shift.toward} ${shift.probability}%` : ""}`;
  return { interval, dir, strength, phase, shift, text, turn };
}

export interface DirectionChange { toward: Side; stage: "confirmed" | "early"; text: string }

/**
 * Pure: 1m + 5m detect a direction change against the 15m trend. Confirmed when 5m and 1m both push the new way
 * and the 15m trend is flat, fading or likely to shift; early when that push fights a still-strong 15m, or when
 * the 1m has just turned and the 5m shows a likely shift its way. Needs readable 1m and 5m.
 */
export function readDirectionChange(reads: MomentumRead[]): DirectionChange | undefined {
  const of = (iv: Interval) => { const r = reads.find((x) => x.interval === iv); return r && !r.noData ? r : undefined; };
  const m1 = of("1m"), m5 = of("5m"), m15 = of("15m");
  if (!m1 || !m5) return undefined;
  const trend = m15?.dir ?? 0;
  if (m5.dir !== 0 && m1.dir === m5.dir && trend !== m5.dir) {
    const toward = sideOf(m5.dir);
    const weak = trend === 0 || m15?.phase === "fading" || (m15?.shift?.toward === toward && m15.shift.probability >= 50);
    return weak
      ? { toward, stage: "confirmed", text: `1m + 5m confirm a direction change to ${toward}` }
      : { toward, stage: "early", text: `1m + 5m turning ${toward} against a strong 15m trend` };
  }
  if (m1.dir !== 0 && m1.turn === sideOf(m1.dir) && m5.dir !== m1.dir && m5.shift?.toward === m1.turn && m5.shift.probability >= 50) {
    return { toward: m1.turn, stage: "early", text: `1m just turned ${m1.turn}, 5m shift ${m5.shift.probability}% likely` };
  }
  return undefined;
}

const STEP_DOWN: Record<QualityGrade, QualityGrade> = { "A+": "A", A: "B", B: "C", C: "C" };

export interface MomentumQuality { grade: QualityGrade; delta: number; notes: string[] }

/**
 * Pure: grade a BUY/SELL against current momentum (5m + 15m lead, 1m times) and the next-shift risk.
 * A+ both lead frames push with it, nothing turning against it; C (failing) fights momentum or a likely shift.
 */
export function momentumQuality(side: Side, reads: MomentumRead[]): MomentumQuality {
  const d = side === "BUY" ? 1 : -1;
  const of = (iv: Interval) => reads.find((r) => r.interval === iv);
  const lead = [of("5m"), of("15m")].filter((r): r is MomentumRead => !!r && !r.noData);
  const m1raw = of("1m");
  const m1 = m1raw?.noData ? undefined : m1raw;
  const notes: string[] = [];
  const aligned = lead.filter((r) => r.dir === d).length;
  const against = lead.filter((r) => r.dir === -d).length;
  const shiftAgainst = Math.max(0, ...lead.map((r) => (r.shift && r.shift.toward !== side ? r.shift.probability : 0)));
  const shiftFor = Math.max(0, ...lead.filter((r) => r.dir !== d).map((r) => (r.shift && r.shift.toward === side ? r.shift.probability : 0)));
  const fading15 = of("15m")?.phase === "fading" && of("15m")?.dir === d;
  const m1Against = m1?.dir === -d;
  let grade: QualityGrade;
  if (lead.length >= 2 && aligned === 2 && shiftAgainst < 50 && !m1Against && !fading15) grade = "A+";
  else if ((aligned === 2 && shiftAgainst < 60) || (aligned >= 1 && against === 0 && shiftFor >= 50)) grade = "A";
  else if (aligned >= 1 && (shiftAgainst < 60 || aligned === 2)) grade = "B";
  // Neutral lead momentum (flat / unreadable, nothing pushing against) is a normal B, not a failure.
  else if (aligned === 0 && against === 0 && shiftAgainst < 60) grade = "B";
  else grade = "C";
  if (aligned === 2) notes.push(`5m + 15m momentum push ${side}`);
  else if (aligned === 1) notes.push(`One lead frame pushes ${side}`);
  if (against > 0) notes.push(`${against} lead frame${against > 1 ? "s" : ""} push the other way`);
  if (shiftFor >= 50) notes.push(`Next momentum shift toward ${side} (${shiftFor}%) — early entry`);
  if (shiftAgainst >= 50) notes.push(`Warning: momentum may shift against ${side} (${shiftAgainst}%)`);
  if (fading15) notes.push("15m momentum fading");
  if (m1Against) notes.push("1m still against — timing not ideal");
  // 1m + 5m change detection: a confirmed change toward the signal lifts it to A; one against it steps the grade down (confirmed → C, lower confidence).
  const change = readDirectionChange(reads);
  if (change && change.toward === side) {
    if (change.stage === "confirmed" && shiftAgainst < 60 && GRADE_RANK[grade] < GRADE_RANK.A) grade = "A";
    notes.push(change.text);
  } else if (change) {
    grade = change.stage === "confirmed" ? "C" : STEP_DOWN[grade];
    notes.push(`${change.text} — against ${side}`);
  } else if (m1?.turn === side) notes.push(`1m just turned ${side} — entry timed`);
  const delta = grade === "A+" ? 6 : grade === "A" ? 3 : grade === "B" ? 0 : -8;
  return { grade, delta, notes };
}
