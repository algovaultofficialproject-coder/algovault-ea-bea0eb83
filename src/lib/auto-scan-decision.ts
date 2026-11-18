type Setup = { side: "BUY" | "SELL"; entry: number; stopLoss: number; takeProfit: number; confidencePct: number; grade: string; confluences: string[] };

/** A directional scanner signal is not permission to chase a distant entry. */
export function autoScanDecision(signal: Setup, price: number, atr15: number, direction: string) {
  const { side, entry, stopLoss, takeProfit } = signal;
  if (![price, atr15, entry, stopLoss, takeProfit].every((n) => Number.isFinite(n) && n > 0)) return "Invalid signal prices or volatility";
  if (direction !== "BOTH" && direction !== side) return `Signal ${side} is outside the allowed direction`;
  if (signal.confidencePct < 60 || !["A+", "A", "B"].includes(signal.grade) || signal.confluences.length < 3) return "Signal needs stronger confirmation before automatic execution";
  if (side === "BUY" ? !(stopLoss < entry && entry < takeProfit) : !(takeProfit < entry && entry < stopLoss)) return "Invalid stop/target direction";
  if (Math.abs(price - entry) > atr15 * 0.35) return `Waiting for the scanner entry at ${entry}`;
  if (side === "BUY" ? !(stopLoss < price && price < takeProfit) : !(takeProfit < price && price < stopLoss)) return "Price has crossed the signal's stop or target";
  if (Math.abs(takeProfit - price) / Math.abs(price - stopLoss) < 1.5) return "Reward/risk is below 1.5 at the current price";
  return null;
}