/** Wider stops based on the slower chart, never a nearby 5-minute scalp stop. */
export function automaticStops(price: number, side: "BUY" | "SELL", atr5?: number, atr15?: number) {
  if (!Number.isFinite(price) || price <= 0) return null;
  const volatility = Math.max(Number.isFinite(atr5) ? atr5 ?? 0 : 0, Number.isFinite(atr15) ? atr15 ?? 0 : 0);
  if (volatility <= 0) return null;
  const distance = Math.max(volatility * 3, price * 0.003);
  const sl = +(side === "BUY" ? price - distance : price + distance).toFixed(5);
  const tp = +(side === "BUY" ? price + distance * 2 : price - distance * 2).toFixed(5);
  if (sl <= 0 || tp <= 0) return null;
  return { sl, tp };
}