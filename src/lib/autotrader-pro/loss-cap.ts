/**
 * Pure loss limit: shrinks the trade count, then the lot, so all trades of one signal together can lose at most
 * the user's limit (e.g. R100) if the stop is hit; skips the signal when even one 0.01 lot would lose more.
 */
import { fromUsd, lossPerLotUsd, toUsd, type AccountCurrency } from "./small-account";

export const DEFAULT_MAX_LOSS = 100;

export interface LossCapInput { symbol: string; entry: number; stop: number; lot: number; trades: number; maxLoss: number; currency: AccountCurrency; cent: boolean }
export type LossCap = { ok: true; lot: number; trades: number; lossAmount: number; note: string } | { ok: false; reason: string };

export function capLoss(x: LossCapInput): LossCap {
  const sym = x.currency === "ZAR" ? "R" : "$";
  const money = (usd: number) => `${sym}${fromUsd(usd, x.currency).toFixed(2)}`;
  const capUsd = toUsd(x.maxLoss, x.currency);
  const perMin = (lossPerLotUsd(x.symbol, x.entry, x.stop) * 0.01) / (x.cent ? 100 : 1);
  if (!(capUsd > 0) || !(perMin > 0)) return { ok: true, lot: x.lot, trades: x.trades, lossAmount: 0, note: "" };
  const allowed = Math.floor(capUsd / perMin + 1e-9);
  if (allowed < 1) return { ok: false, reason: `0.01 lot would lose ${money(perMin)} at the stop — more than your ${sym}${x.maxLoss} loss limit` };
  const lotUnits = Math.max(1, Math.round(x.lot * 100));
  let trades = Math.max(1, x.trades), per = lotUnits;
  if (per * trades > allowed) {
    trades = Math.min(trades, allowed);
    per = Math.max(1, Math.min(lotUnits, Math.floor(allowed / trades)));
  }
  const lossUsd = per * trades * perMin;
  const changed = per !== lotUnits || trades !== x.trades;
  return { ok: true, lot: per / 100, trades, lossAmount: fromUsd(lossUsd, x.currency), note: `Loss limit ${sym}${x.maxLoss}: ${changed ? `${trades}×${(per / 100).toFixed(2)} lot, ` : ""}max loss ${money(lossUsd)}` };
}
