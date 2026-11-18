/** Pure position-size maths for the in-app calculator. Display only — never places orders. */
export type CalcMarket = 'forex' | 'jpy' | 'gold';

export type CalcInput = {
  balance: number;
  riskPct: number;
  stopPips: number;
  targetPips?: number;
  market: CalcMarket;
  /** Current price, only used for JPY pairs (pip value depends on it). */
  jpyPrice?: number;
};

export type CalcResult = {
  lots: number;
  riskAmount: number;
  actualRisk: number;
  pipValue: number;
  profit: number | null;
  rr: number | null;
  belowMinimum: boolean;
};

/** Approximate account-currency (USD) value of 1 pip for 1 standard lot. */
export function pipValuePerLot(market: CalcMarket, jpyPrice = 150): number {
  if (market === 'jpy') return jpyPrice > 0 ? 1000 / jpyPrice : 0;
  return 10; // xxxUSD forex: 0.0001 × 100,000; gold: 0.10 × 100 oz
}

export function calcLots(input: CalcInput): CalcResult | null {
  const { balance, riskPct, stopPips, targetPips, market, jpyPrice } = input;
  const pipValue = pipValuePerLot(market, jpyPrice);
  if (!(balance > 0) || !(riskPct > 0) || riskPct > 100 || !(stopPips > 0) || !(pipValue > 0)) return null;
  const riskAmount = (balance * riskPct) / 100;
  const raw = riskAmount / (stopPips * pipValue);
  const floored = Math.floor(raw * 100 + 1e-9) / 100;
  const belowMinimum = floored < 0.01;
  const lots = belowMinimum ? 0.01 : floored;
  const actualRisk = round2(lots * stopPips * pipValue);
  const hasTarget = targetPips != null && targetPips > 0;
  return {
    lots,
    riskAmount: round2(riskAmount),
    actualRisk,
    pipValue: round2(pipValue),
    profit: hasTarget ? round2(lots * targetPips! * pipValue) : null,
    rr: hasTarget ? round2(targetPips! / stopPips) : null,
    belowMinimum,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
