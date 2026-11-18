/**
 * Pure small-account growth plan (e.g. R200 → bigger): growth tiers by balance, risk-based lot sizing from
 * the user-entered balance (never read from the broker), and only a failing (C) grade is skipped.
 */
import { FAILING_GRADE, type QualityGrade } from "./momentum";

export type AccountCurrency = "ZAR" | "USD";
/** Approximate rand per US dollar, used only to place a rand balance in a tier and size risk. */
export const ZAR_PER_USD = 18.5;
/** Approximate yen per dollar for JPY-quoted crosses. */
const JPY_PER_USD = 150;

export interface GrowthTier { id: string; name: string; minUsd: number; riskPct: number; maxTrades: number }
export const GROWTH_TIERS: GrowthTier[] = [
  { id: "seed", name: "Seed", minUsd: 0, riskPct: 5, maxTrades: 1 },
  { id: "sprout", name: "Sprout", minUsd: 30, riskPct: 4, maxTrades: 1 },
  { id: "builder", name: "Builder", minUsd: 100, riskPct: 3, maxTrades: 2 },
  { id: "growth", name: "Growth", minUsd: 300, riskPct: 2, maxTrades: 3 },
  { id: "scale", name: "Scale", minUsd: 1000, riskPct: 1.5, maxTrades: 5 },
  { id: "pro", name: "Pro", minUsd: 5000, riskPct: 1, maxTrades: 10 },
];
/** A minimum-lot trade may risk up to this multiple of the tier risk before it is skipped. */
export const MIN_LOT_RISK_MULT = 2;

export const toUsd = (amount: number, cur: AccountCurrency) => (cur === "ZAR" ? amount / ZAR_PER_USD : amount);
export const fromUsd = (usd: number, cur: AccountCurrency) => (cur === "ZAR" ? usd * ZAR_PER_USD : usd);

export function tierFor(balance: number, cur: AccountCurrency): GrowthTier {
  const usd = toUsd(balance, cur);
  return [...GROWTH_TIERS].reverse().find((t) => usd >= t.minUsd) ?? GROWTH_TIERS[0];
}

/** Pure: current tier, next milestone (next tier or doubling) and progress 0–1 toward it. */
export function growthPlan(balance: number, cur: AccountCurrency) {
  const tier = tierFor(balance, cur);
  const next = GROWTH_TIERS[GROWTH_TIERS.indexOf(tier) + 1];
  const target = next ? Math.max(fromUsd(next.minUsd, cur), balance * 1.01) : balance * 2;
  const from = fromUsd(tier.minUsd, cur);
  const progress = next ? Math.max(0, Math.min(1, (balance - from) / (target - from || 1))) : 0;
  return { tier, next, target: Math.ceil(target), progress };
}

/** Pure: approximate contract size per 1.0 lot. */
export function contractSize(symbol: string): number {
  const s = symbol.toUpperCase();
  if (/XAU|GOLD/.test(s)) return 100;
  if (/XAG|SILVER/.test(s)) return 5000;
  if (/BTC|ETH|US30|NAS|SPX|GER|UK100|DAX|DJ/.test(s)) return 1;
  return 100_000;
}

/** Pure: approximate USD loss for 1.0 lot hitting the stop. */
export function lossPerLotUsd(symbol: string, entry: number, stop: number): number {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const quote = Math.abs(entry - stop) * contractSize(symbol);
  const fx = contractSize(symbol) === 100_000;
  if (!fx || s.endsWith("USD") || s.slice(3, 6) === "USD") return quote;
  if (s.startsWith("USD")) return entry > 0 ? quote / entry : quote;
  if (s.slice(3, 6) === "JPY") return quote / JPY_PER_USD;
  return quote; // other crosses: close enough for a small-account risk check
}

export interface SmallAccountInput {
  symbol: string; entry: number; stop: number; balance: number; currency: AccountCurrency; cent: boolean;
  /** The pair's own lot is the maximum per trade. */
  pairLot: number; pairTrades: number; grade?: QualityGrade;
}
export type SmallAccountSize =
  | { ok: true; lot: number; trades: number; riskAmount: number; riskPct: number; tier: GrowthTier; note: string }
  | { ok: false; reason: string; tier: GrowthTier };

/** Pure: lot and trade count for a small account; skips failing (C) signals or ones too risky at the minimum lot. */
export function sizeSmallAccount(x: SmallAccountInput): SmallAccountSize {
  const tier = tierFor(x.balance, x.currency);
  const money = (usd: number) => `${x.currency === "ZAR" ? "R" : "$"}${fromUsd(usd, x.currency).toFixed(2)}`;
  if (!(x.balance > 0)) return { ok: false, reason: "enter your account balance in Settings → Small Account Growth", tier };
  if (x.grade === FAILING_GRADE) return { ok: false, reason: "signal failed the momentum check (grade C) — waiting", tier };
  const balUsd = toUsd(x.balance, x.currency);
  const budget = (balUsd * tier.riskPct) / 100;
  const perMin = (lossPerLotUsd(x.symbol, x.entry, x.stop) * 0.01) / (x.cent ? 100 : 1);
  if (!(perMin > 0)) return { ok: false, reason: "stop distance unusable", tier };
  let units = Math.floor(budget / perMin + 1e-9);
  if (units < 1) {
    if (perMin > budget * MIN_LOT_RISK_MULT) {
      return { ok: false, reason: `0.01 lot would risk ${money(perMin)} (${((perMin / balUsd) * 100).toFixed(1)}%) — too much for this balance${x.cent ? "" : "; a cent account fits small balances"}`, tier };
    }
    units = 1;
  }
  const maxUnits = Math.max(1, Math.round(Math.max(0.01, x.pairLot) * 100));
  const trades = Math.max(1, Math.min(tier.maxTrades, Math.max(1, x.pairTrades), units));
  const per = Math.max(1, Math.min(maxUnits, Math.floor(units / trades)));
  const lot = per / 100;
  const riskUsd = per * perMin * trades;
  const riskPct = Math.round((riskUsd / balUsd) * 1000) / 10;
  return { ok: true, lot, trades, riskAmount: riskUsd, riskPct, tier, note: `Small account ${tier.name}: ${trades}×${lot.toFixed(2)} lot, risk ${money(riskUsd)} (${riskPct}%)` };
}
