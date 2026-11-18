/** Pure helpers deciding which MetaTrader account AutoTrader Pro executes on and how many trades each execution sends. */

/** Broker limit per execution, matching the order endpoint's accepted range. */
export const MAX_TRADES_PER_EXECUTION = 20;

export interface ConnectedAccount {
  platform: "mt4" | "mt5";
  login: string;
  password: string;
  server: string;
  broker: string | null;
  /** Short display text, e.g. "MT5 · Exness #12345". */
  label: string;
}

interface PortalAccountFields {
  metaPlatform: "mt4" | "mt5" | null;
  metaLogin: string | null;
  metaPassword: string | null;
  metaServer: string | null;
  metaBroker: string | null;
}

/**
 * The account connected on the trading app's Metatrader tab, or null when none is connected.
 * Orders always go to this account on its own platform, so no account or platform has to be picked here.
 */
export function connectedAccount(p: PortalAccountFields): ConnectedAccount | null {
  if (!p.metaLogin || !p.metaPassword || !p.metaServer) return null;
  const platform = p.metaPlatform === "mt4" ? "mt4" : "mt5";
  return {
    platform, login: p.metaLogin, password: p.metaPassword, server: p.metaServer, broker: p.metaBroker,
    label: `${platform.toUpperCase()} · ${p.metaBroker ? `${p.metaBroker} ` : ""}#${p.metaLogin}`,
  };
}

/** Whole number of trades from 1 to MAX_TRADES_PER_EXECUTION; anything else (empty, 0, decimals, text) is null. */
export function parseTradeCount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_TRADES_PER_EXECUTION ? n : null;
}
