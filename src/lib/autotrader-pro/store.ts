import { useSyncExternalStore } from "react";
import { DEFAULT_ENGINE, type EngineSettings, type StrategyPerf } from "./engine";
import { RISK_PRESETS, type ManagedTrade, type RiskSettings, type RiskTolerance } from "./risk";
import type { WalkForwardResult } from "./backtest";
import { DEFAULT_TPSL, type MarketClass, type TpSlSettings, type TpSlTest } from "./tpsl";
import type { Params } from "./strategies";
import type { Interval, StrategyId, TradingMode } from "./types";

export interface PaperPosition {
  journalId: string;
  symbol: string;
  strategy: StrategyId;
  strategyName: string;
  contract: number;
  riskAmount: number;
  managed: ManagedTrade;
  lastBarT: number;
  openedAt: number;
  /** Chart the trade was opened on; its candles drive management (older saves default to 5m). */
  interval?: Interval;
}

export interface ProState {
  mode: TradingMode;
  /** Symbols exactly as the user typed them (case preserved) — this spelling is sent to the broker. */
  symbols: string[];
  engine: EngineSettings;
  risk: RiskSettings;
  /** Paper mode may also simulate early signals that pass the confirmed score threshold. */
  paperIncludeEarly: boolean;
  /** Apply walk-forward parameters automatically after each backtest. */
  autoOptimize: boolean;
  /** Explicit live-trading authorisation; expires after LIVE_AUTH_MS. */
  liveAuthorizedAt: number | null;
  perf: Record<string, Partial<Record<StrategyId, StrategyPerf>>>;
  optimized: Record<string, Partial<Record<StrategyId, Params>>>;
  backtests: Record<string, { at: number; candles: number; source: string; results: WalkForwardResult[] }>;
  paper: PaperPosition[];
  /** Trades sent per execution (manual and live); null until the user enters it, which blocks execution. */
  tradeCount: number | null;
  /** TP/SL engine settings, plus walk-forward overrides and test results per market class. */
  tpsl: TpSlSettings;
  tpslByMarket: Partial<Record<MarketClass, Partial<TpSlSettings>>>;
  tpslTests: Partial<Record<MarketClass, TpSlTest>>;
  /** Version of the recommended setup already applied to this device's saved engine. */
  setupVersion?: number;
}

export const LIVE_AUTH_MS = 12 * 60 * 60 * 1000;
const KEY = "algo:autotrader-pro";
/** Shared factory settings; the home robot reads these so every phone gets the same signal. */
export const DEFAULT_PRO_STATE: ProState = {
  mode: "analysis", symbols: ["BTCUSD"], engine: DEFAULT_ENGINE, risk: RISK_PRESETS.balanced,
  paperIncludeEarly: false, autoOptimize: true, liveAuthorizedAt: null, perf: {}, optimized: {}, backtests: {}, paper: [], tradeCount: null,
  tpsl: DEFAULT_TPSL, tpslByMarket: {}, tpslTests: {}, setupVersion: 3,
};
const DEFAULT = DEFAULT_PRO_STATE;
/** Recommended thresholds applied once to existing setups (keep in sync with RECOMMENDED_ENGINE). */
/** v3: the 90-strategy book replaced every older strategy, so old per-strategy switches, params and results are reset. */
const SETUP_VERSION = 3;
const SETUP_ENGINE: Partial<EngineSettings> = { earlyThreshold: 45, confirmedThreshold: 60, autoSelect: true, disableUnderperformers: true, adaptive: true, changeConfirmBars: 3, changeMinHold: 5 };
/** Early-profit trade management applied once to saved setups (keep in sync with the risk presets). */
const SETUP_RISK: Partial<RiskSettings> = { breakEvenAtR: 0.6, partialAtR: 0.6, partialPct: 60, trailingAtrMult: 1 };

let state: ProState | null = null;
const listeners = new Set<() => void>();
function load(): ProState {
  if (state) return state;
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<ProState>) : {};
    state = { ...DEFAULT, ...saved, engine: { ...DEFAULT.engine, ...saved.engine, enabled: { ...DEFAULT.engine.enabled, ...saved.engine?.enabled }, sessions: { ...DEFAULT.engine.sessions, ...saved.engine?.sessions } }, risk: { ...DEFAULT.risk, ...saved.risk }, tpsl: { ...DEFAULT_TPSL, ...saved.tpsl, atrMult: { ...DEFAULT_TPSL.atrMult, ...saved.tpsl?.atrMult } } };
    if (saved.setupVersion !== SETUP_VERSION) state = { ...state, engine: { ...state.engine, ...SETUP_ENGINE, enabled: DEFAULT.engine.enabled, params: {} }, risk: { ...state.risk, ...SETUP_RISK }, perf: {}, optimized: {}, backtests: {}, setupVersion: SETUP_VERSION };
  } catch { state = DEFAULT; }
  return state;
}
function set(patch: Partial<ProState> | ((s: ProState) => Partial<ProState>)) {
  const cur = load();
  state = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const useProState = () => useSyncExternalStore(subscribe, load, () => DEFAULT);
export const getProState = load;
export const perfKey = (symbol: string, interval: Interval) => `${symbol.toUpperCase()}|${interval}`;
export const liveAuthorized = (s: ProState, now: number) => !!s.liveAuthorizedAt && now - s.liveAuthorizedAt < LIVE_AUTH_MS;

/** Trims and de-duplicates symbols case-insensitively, keeping the first spelling the user typed. */
export function cleanSymbols(symbols: string[], max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const s = raw.trim();
    if (!s || seen.has(s.toUpperCase())) continue;
    seen.add(s.toUpperCase());
    out.push(s);
  }
  return out.slice(0, max);
}
export const hasSymbol = (symbols: string[], s: string) => symbols.some((x) => x.toUpperCase() === s.trim().toUpperCase());

export const proActions = {
  setMode(mode: TradingMode) { set({ mode }); },
  setSymbols(symbols: string[]) { set({ symbols: cleanSymbols(symbols) }); },
  setEngine(patch: Partial<EngineSettings>) { set((s) => ({ engine: { ...s.engine, ...patch } })); },
  toggleStrategy(id: StrategyId) { set((s) => ({ engine: { ...s.engine, enabled: { ...s.engine.enabled, [id]: s.engine.enabled[id] === false } } })); },
  setRisk(patch: Partial<RiskSettings>) { set((s) => ({ risk: { ...s.risk, ...patch } })); },
  setTolerance(t: RiskTolerance) { set((s) => ({ risk: { ...RISK_PRESETS[t], accountSize: s.risk.accountSize, contractSize: s.risk.contractSize, maxLot: s.risk.maxLot } })); },
  setFlags(patch: Partial<Pick<ProState, "paperIncludeEarly" | "autoOptimize">>) { set(patch); },
  authorizeLive() { set({ liveAuthorizedAt: Date.now() }); },
  revokeLive() { set((s) => ({ liveAuthorizedAt: null, mode: s.mode === "live" ? "analysis" : s.mode })); },
  saveBacktest(key: string, entry: ProState["backtests"][string], perf: Partial<Record<StrategyId, StrategyPerf>>, params: Partial<Record<StrategyId, Params>>) {
    set((s) => ({ backtests: { ...s.backtests, [key]: entry }, perf: { ...s.perf, [key]: perf }, optimized: s.autoOptimize ? { ...s.optimized, [key]: params } : s.optimized }));
  },
  clearOptimized(key: string) { set((s) => { const o = { ...s.optimized }; delete o[key]; return { optimized: o }; }); },
  setPaper(paper: PaperPosition[]) { set({ paper }); },
  setTradeCount(tradeCount: number | null) { set({ tradeCount }); },
  setTpSl(patch: Partial<TpSlSettings>) { set((s) => ({ tpsl: { ...s.tpsl, ...patch } })); },
  saveTpSlTest(m: MarketClass, test: TpSlTest) {
    set((s) => ({ tpslTests: { ...s.tpslTests, [m]: test }, tpslByMarket: s.autoOptimize ? { ...s.tpslByMarket, [m]: test.chosen } : s.tpslByMarket }));
  },
  resetTpSlMarket(m: MarketClass) { set((s) => { const o = { ...s.tpslByMarket }; delete o[m]; return { tpslByMarket: o }; }); },
};
