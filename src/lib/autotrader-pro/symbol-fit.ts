/**
 * Pure per-symbol strategy fit: each market class keeps only the strategy families that suit how it moves,
 * and fast markets take confirmed (closed-candle) setups only. Used by the home robot through proDecision.
 */
import type { Signal } from "./types";

export type MarketClass = "gold" | "silver" | "crypto" | "index" | "jpy" | "forex";

export function marketClass(symbol: string): MarketClass {
  const s = symbol.toUpperCase();
  if (/XAU|GOLD/.test(s)) return "gold";
  if (/XAG|SILVER/.test(s)) return "silver";
  if (/BTC|ETH|SOL|XRP|LTC|DOGE|CRYPTO/.test(s)) return "crypto";
  if (/US30|NAS|SPX|US500|US100|GER|DAX|UK100|DJ|JP225|NIKKEI/.test(s)) return "index";
  if (/JPY/.test(s)) return "jpy";
  return "forex";
}

export interface SymbolProfile { label: string; avoid: string[]; confirmedOnly: boolean; why: string }

/** Family keys (strategy id prefix) each market class stands aside from. */
export const SYMBOL_PROFILES: Record<MarketClass, SymbolProfile> = {
  // Gold/silver sweep liquidity and spike: no tiny-range fades, snapbacks, counter-trend turns or candle chasing.
  gold: { label: "Gold", avoid: ["mr", "rf", "rx", "ex", "mc"], confirmedOnly: true, why: "gold spikes through small ranges" },
  silver: { label: "Silver", avoid: ["mr", "rf", "rx", "ex", "mc"], confirmedOnly: true, why: "silver spikes through small ranges" },
  // Crypto and indices trend and gap: no range fades or exhaustion turns against the move.
  crypto: { label: "Crypto", avoid: ["mr", "rf", "rx", "ex"], confirmedOnly: true, why: "crypto trends hard and runs over fades" },
  index: { label: "Index", avoid: ["mr", "rf", "rx", "ex"], confirmedOnly: true, why: "indices trend and gap past fades" },
  // JPY crosses jump on flows: no micro-range scalps.
  jpy: { label: "JPY pair", avoid: ["mr"], confirmedOnly: false, why: "yen pairs jump out of tiny ranges" },
  forex: { label: "Forex", avoid: [], confirmedOnly: false, why: "" },
};

const family = (id: string) => id.replace(/\d+$/, "");

/** Pure: true when the strategy suits the symbol (and is confirmed when the symbol needs that). */
export function fitsSymbol(symbol: string, sig: Pick<Signal, "strategy" | "stage">): boolean {
  const p = SYMBOL_PROFILES[marketClass(symbol)];
  if (p.avoid.includes(family(String(sig.strategy)))) return false;
  return !p.confirmedOnly || sig.stage === "confirmed";
}
