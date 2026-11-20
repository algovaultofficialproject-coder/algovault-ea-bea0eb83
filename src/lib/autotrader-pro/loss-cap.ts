/**
 * Pure loss limit: shrinks the trade count, then the lot, so all trades of one signal together can lose at most
 * the user's limit (e.g. R100) if the stop is hit; skips the signal when even one 0.01 lot would lose more.
 */
export type AccountCurrency = "ZAR" | "USD";
/** Approximate rand per US dollar, used only to convert the loss limit. */
export const ZAR_PER_USD = 18.5;
/** Approximate yen per dollar for JPY-quoted crosses. */
const JPY_PER_USD = 150;

export const toUsd = (amount: number, cur: AccountCurrency) => (cur === "ZAR" ? amount / ZAR_PER_USD : amount);
export const fromUsd = (usd: number, cur: AccountCurrency) => (cur === "ZAR" ? usd * ZAR_PER_USD : usd);

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
  return quote; // other crosses: close enough for a loss-limit check
}

export const DEFAULT_MAX_LOSS = 100;
/** Strict ceiling on planned loss per signal (rand); a higher typed limit is cut down to it. */
export const MAX_PLANNED_LOSS_ZAR = 120;
/** Share of the limit the stop may use; the rest is left for spread, commission and slippage. */
export const COST_BUFFER = 0.9;

export interface LossCapInput { symbol: string; entry: number; stop: number; lot: number; trades: number; maxLoss: number; currency: AccountCurrency; cent: boolean }
export type LossCap = { ok: true; lot: number; trades: number; lossAmount: number; note: string } | { ok: false; reason: string };

export function capLoss(x: LossCapInput): LossCap {
  const sym = x.currency === "ZAR" ? "R" : "$";
  const money = (usd: number) => `${sym}${fromUsd(usd, x.currency).toFixed(2)}`;
  const limit = Math.min(x.maxLoss > 0 ? x.maxLoss : Infinity, fromUsd(toUsd(MAX_PLANNED_LOSS_ZAR, "ZAR"), x.currency));
  const capUsd = toUsd(limit, x.currency) * COST_BUFFER;
  const perMin = (lossPerLotUsd(x.symbol, x.entry, x.stop) * 0.01) / (x.cent ? 100 : 1);
  if (!(capUsd > 0) || !(perMin > 0)) return { ok: true, lot: x.lot, trades: x.trades, lossAmount: 0, note: "" };
  const allowed = Math.floor(capUsd / perMin + 1e-9);
  if (allowed < 1) return { ok: false, reason: `0.01 lot would lose ${money(perMin)} at the stop — more than your ${sym}${+limit.toFixed(2)} loss limit (incl. cost buffer)` };
  const lotUnits = Math.max(1, Math.round(x.lot * 100));
  let trades = Math.max(1, x.trades), per = lotUnits;
  if (per * trades > allowed) {
    trades = Math.min(trades, allowed);
    per = Math.max(1, Math.min(lotUnits, Math.floor(allowed / trades)));
  }
  const lossUsd = per * trades * perMin;
  const changed = per !== lotUnits || trades !== x.trades;
  return { ok: true, lot: per / 100, trades, lossAmount: fromUsd(lossUsd, x.currency), note: `Loss limit ${sym}${+limit.toFixed(2)}: ${changed ? `${trades}×${(per / 100).toFixed(2)} lot, ` : ""}max loss ${money(lossUsd)}` };
}
