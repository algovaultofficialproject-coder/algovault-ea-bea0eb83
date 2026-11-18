export type TvRead = {
  price: number;
  rating5: number; rating15: number; rating60: number; rating240: number;
  ma15: number; rsi15: number; adx15: number;
  ema50_15: number; ema200_60: number; macd15: number; macdSig15: number;
};

/**
 * Multi-timeframe confluence strategy: trades only when the 4h/1h trend,
 * 15m trend filters (EMA, MA rating, MACD), trend strength (ADX) and a
 * non-exhausted RSI all line up with a 5m/15m trigger. Returns null otherwise.
 */
export function ultraSignal(r: TvRead): { side: "BUY" | "SELL"; score: number; reasons: string[] } | null {
  const ok = (n: number) => Number.isFinite(n) && n !== 0;
  for (const side of ["BUY", "SELL"] as const) {
    const s = side === "BUY" ? 1 : -1;
    const reasons: string[] = [];
    let score = 0;
    // Trigger (required): 5m and 15m agree.
    if (!(r.rating5 * s >= 0.2 && r.rating15 * s >= 0.1)) continue;
    // Higher-timeframe bias must not oppose.
    if (r.rating60 * s < 0 || r.rating240 * s < -0.1) continue;
    if (r.rating60 * s >= 0.1) { score++; reasons.push("1h trend"); }
    if (r.rating240 * s >= 0.1) { score++; reasons.push("4h trend"); }
    if (ok(r.ema50_15) && (r.price - r.ema50_15) * s > 0) { score++; reasons.push("above/below EMA50"); }
    if (ok(r.ema200_60) && (r.price - r.ema200_60) * s > 0) { score++; reasons.push("EMA200 1h side"); }
    if (r.ma15 * s >= 0.2) { score++; reasons.push("MA rating"); }
    if (ok(r.macd15) && (r.macd15 - r.macdSig15) * s > 0) { score++; reasons.push("MACD"); }
    if (r.adx15 >= 20) { score++; reasons.push(`ADX ${r.adx15.toFixed(0)}`); }
    // Avoid chasing exhausted moves.
    if (ok(r.rsi15) && (side === "BUY" ? r.rsi15 > 72 : r.rsi15 < 28)) continue;
    if (score >= 4) return { side, score, reasons };
  }
  return null;
}
