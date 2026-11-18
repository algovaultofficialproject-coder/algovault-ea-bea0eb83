/**
 * Pure: the admin's AutoTrader Pro setup that every trading-app robot follows. Only tuning travels
 * (strategies, thresholds, risk, TP/SL, optimised params) — never a phone's own trade history — so all
 * phones read the market the same way.
 */
import { DEFAULT_ENGINE, type EngineSettings } from "./engine";
import { DEFAULT_PRO_STATE, type ProState } from "./store";

/** Recommended setup: stricter confirmation, adaptive regime weighting, weak strategies switched off. */
export const RECOMMENDED_ENGINE: EngineSettings = {
  ...DEFAULT_ENGINE, earlyThreshold: 45, confirmedThreshold: 60, autoSelect: true,
  disableUnderperformers: true, adaptive: true, changeConfirmBars: 3, changeMinHold: 5, mtfMode: "balanced",
};

export type SharedProConfig = Pick<ProState, "engine" | "risk" | "tpsl" | "tpslByMarket" | "optimized">;

export const sharedFromState = (s: ProState): SharedProConfig =>
  ({ engine: s.engine, risk: s.risk, tpsl: s.tpsl, tpslByMarket: s.tpslByMarket, optimized: s.optimized });

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** Pure: the state a trading-app robot scans with — admin's published setup over the recommended one. */
export function homeRobotState(shared: unknown): ProState {
  const s = obj(shared);
  const e = obj(s.engine);
  const base = DEFAULT_PRO_STATE;
  return {
    ...base,
    engine: { ...RECOMMENDED_ENGINE, ...e, enabled: { ...RECOMMENDED_ENGINE.enabled, ...obj(e.enabled) }, sessions: { ...RECOMMENDED_ENGINE.sessions, ...obj(e.sessions) }, params: obj(e.params) },
    risk: { ...base.risk, ...obj(s.risk) },
    tpsl: { ...base.tpsl, ...obj(s.tpsl), atrMult: { ...base.tpsl.atrMult, ...obj(obj(s.tpsl).atrMult) } },
    tpslByMarket: obj(s.tpslByMarket),
    optimized: obj(s.optimized),
    perf: {},
  };
}
