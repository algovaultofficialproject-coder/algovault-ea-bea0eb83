/**
 * Strategy health check (pure). Parses a pasted trade history and measures whether the
 * recent trades are performing worse than the strategy's own earlier trades. The AI only
 * explains these measured numbers; it never decides the verdict.
 */

export type HealthSide = "BUY" | "SELL";
export type HealthUnit = "R" | "money" | "mixed";
export interface HealthTrade { at?: string; side?: HealthSide; result: number }
export interface ParsedHistory { trades: HealthTrade[]; skipped: number; unit: HealthUnit }

export interface WindowStats {
  trades: number; winRate: number; avgWin: number; avgLoss: number; expectancy: number;
  profitFactor: number; net: number; maxDrawdown: number; longestLosingStreak: number; stdev: number;
}
export type HealthStatus = "insufficient" | "no-edge" | "degraded" | "watch" | "healthy";
export interface HealthFlag { id: string; message: string }
export interface HealthReport {
  status: HealthStatus; unit: HealthUnit; overall: WindowStats;
  baseline: WindowStats | null; recent: WindowStats | null;
  dropT: number | null; flags: HealthFlag[];
  bySide: { side: HealthSide; baseline: WindowStats | null; recent: WindowStats | null }[];
}

/** Fewest trades needed before comparing recent trades with earlier ones. */
export const HEALTH_MIN_TRADES = 20;
export const PF_CAP = 99;

const NUM = /^([+\-−])?([$€£R])?([+\-−])?(\d+(?:\.\d+)?)([Rr])?$/;
const SIDE = /\b(buy|sell|long|short)\b/i;

/** One trade per line, oldest first, result last: "2026-11-02 14:30, BUY, -1R" or "SELL R250". A leading R is rand; a trailing R is an R multiple. */
export function parseTradeHistory(text: string): ParsedHistory {
  const trades: (HealthTrade & { r: boolean; t?: number })[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(/[,;\t|]+|\s+/).filter(Boolean);
    let result: number | null = null; let isR = false;
    for (const tok of tokens) {
      const m = NUM.exec(tok.replace(/[()]/g, ""));
      if (!m) continue;
      const neg = m[1] === "-" || m[1] === "−" || m[3] === "-" || m[3] === "−";
      result = (neg ? -1 : 1) * Number(m[4]);
      isR = !!m[5] && !m[2];
    }
    if (result === null || !Number.isFinite(result)) { skipped++; continue; }
    const s = SIDE.exec(line)?.[1].toLowerCase();
    const side: HealthSide | undefined = s ? (s === "buy" || s === "long" ? "BUY" : "SELL") : undefined;
    const dateTok = tokens.slice(0, 2).join(" ");
    const t = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(tokens[0] ?? "") ? Date.parse(/\d:\d/.test(tokens[1] ?? "") ? dateTok : tokens[0]) : NaN;
    trades.push({ result, side, r: isR, ...(Number.isFinite(t) ? { t, at: new Date(t).toISOString() } : {}) });
  }
  if (trades.length && trades.every((x) => x.t !== undefined)) trades.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const rCount = trades.filter((x) => x.r).length;
  const unit: HealthUnit = rCount === 0 ? "money" : rCount === trades.length ? "R" : "mixed";
  return { trades: trades.map(({ at, side, result }) => ({ ...(at ? { at } : {}), ...(side ? { side } : {}), result })), skipped, unit };
}

export function windowStats(results: number[]): WindowStats {
  const n = results.length;
  const wins = results.filter((r) => r > 0), losses = results.filter((r) => r < 0);
  const gw = wins.reduce((a, r) => a + r, 0), gl = -losses.reduce((a, r) => a + r, 0);
  const net = gw - gl, mean = n ? net / n : 0;
  let eq = 0, peak = 0, dd = 0, streak = 0, worst = 0;
  for (const r of results) {
    eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    streak = r < 0 ? streak + 1 : 0; worst = Math.max(worst, streak);
  }
  const variance = n > 1 ? results.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1) : 0;
  return {
    trades: n, winRate: n ? wins.length / n : 0, avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0,
    expectancy: mean, profitFactor: gl > 0 ? Math.min(PF_CAP, gw / gl) : gw > 0 ? PF_CAP : 0, net, maxDrawdown: dd, longestLosingStreak: worst, stdev: Math.sqrt(variance),
  };
}

/** Size of the "recent" window: about the last 30% of trades, between 10 and 50. */
export const recentSize = (n: number) => Math.max(10, Math.min(50, Math.round(n * 0.3)));

/** Welch t-statistic for how far the recent average result fell below the earlier average (positive = worse now). */
function dropT(b: WindowStats, r: WindowStats): number {
  const se = Math.sqrt(b.stdev ** 2 / b.trades + r.stdev ** 2 / r.trades);
  return se > 0 ? (b.expectancy - r.expectancy) / se : 0;
}

const f2 = (n: number) => n.toFixed(2);
const p0 = (n: number) => `${(n * 100).toFixed(0)}%`;

export function healthReport(history: Pick<ParsedHistory, "trades" | "unit">): HealthReport {
  const { trades, unit } = history;
  const all = trades.map((t) => t.result);
  const overall = windowStats(all);
  if (trades.length < HEALTH_MIN_TRADES) return { status: "insufficient", unit, overall, baseline: null, recent: null, dropT: null, flags: [], bySide: [] };
  const k = trades.length - recentSize(trades.length);
  const baseline = windowStats(all.slice(0, k)), recent = windowStats(all.slice(k));
  const t = dropT(baseline, recent);
  const flags: HealthFlag[] = [];
  if (baseline.expectancy > 0 && recent.expectancy <= 0) flags.push({ id: "expectancy-negative", message: `Average result turned from +${f2(baseline.expectancy)} to ${f2(recent.expectancy)} per trade` });
  if (t >= 2) flags.push({ id: "significant-drop", message: `Recent results are clearly worse than earlier ones (drop strength ${f2(t)}, 2+ is unlikely to be luck)` });
  if (baseline.winRate - recent.winRate >= 0.15) flags.push({ id: "win-rate-drop", message: `Win rate fell from ${p0(baseline.winRate)} to ${p0(recent.winRate)}` });
  if (baseline.profitFactor >= 1 && recent.profitFactor < 1) flags.push({ id: "profit-factor-below-1", message: `Profit factor fell from ${f2(baseline.profitFactor)} to ${f2(recent.profitFactor)} (below 1 loses money)` });
  if (recent.longestLosingStreak >= 4 && recent.longestLosingStreak > baseline.longestLosingStreak) flags.push({ id: "losing-streak", message: `Recent losing streak of ${recent.longestLosingStreak} is longer than any earlier streak (${baseline.longestLosingStreak})` });
  if (baseline.avgLoss > 0 && recent.avgLoss >= baseline.avgLoss * 1.5) flags.push({ id: "bigger-losses", message: `Average loss grew from ${f2(baseline.avgLoss)} to ${f2(recent.avgLoss)}` });
  const status: HealthStatus =
    baseline.expectancy <= 0 && recent.expectancy <= 0 ? "no-edge"
    : (flags.some((x) => x.id === "expectancy-negative") && t >= 1) || t >= 2 || flags.length >= 3 ? "degraded"
    : flags.length ? "watch" : "healthy";
  const bySide = (["BUY", "SELL"] as const).map((side) => {
    const pick = (list: HealthTrade[]) => { const r = list.filter((x) => x.side === side).map((x) => x.result); return r.length ? windowStats(r) : null; };
    return { side, baseline: pick(trades.slice(0, k)), recent: pick(trades.slice(k)) };
  }).filter((s) => s.baseline || s.recent);
  return { status, unit, overall, baseline, recent, dropT: t, flags, bySide };
}

/** Closed AutoTrader journal trades for one strategy as history lines (R multiples, oldest first). */
export function journalHistoryText(records: { kind: string; strategy: string; side: string; closedAt?: number; rMultiple?: number; mode: string }[], strategy: string): string {
  return records
    .filter((r) => r.kind === "trade" && r.strategy === strategy && (r.mode === "paper" || r.mode === "live") && r.closedAt && typeof r.rMultiple === "number")
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
    .map((r) => `${new Date(r.closedAt ?? 0).toISOString().slice(0, 16).replace("T", " ")}, ${r.side}, ${(r.rMultiple ?? 0).toFixed(2)}R`)
    .join("\n");
}
